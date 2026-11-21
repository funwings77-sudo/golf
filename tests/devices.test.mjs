// 장비 연동 테스트: 골프장 풍속계·카메라 피드 · 그린 측량 · 그립 센서 · 워치 스윙
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLive, holeWind, withHoleWind, matchBall, sampleLive } from '../js/core/live.js';
import { processSurvey } from '../js/core/depth.js';
import { parseTag, signature, GripTracker, clubForEvent } from '../js/core/grip.js';
import { swingAction } from '../js/core/watch.js';
import { destination, distance, toLocal } from '../js/core/geo.js';
import { gridSurface } from '../js/physics/putt.js';

const NOW = Date.parse('2026-11-21T09:00:00+09:00');

test('장비 피드: 이상한 값 버리기 · 10분 넘은 바람 안 씀 · 예보 바람을 홀 바람으로 덮기', () => {
  const live = normalizeLive({ format: 'pinpoint-live', updatedAt: NOW, wind: [
    { hole: 3, speed: 4.2, from: 630, gust: 7, ts: NOW - 60000 }, { hole: 3, speed: 9, from: 0, ts: NOW - 20 * 60000 },
    { hole: 'x', speed: 1, from: 0, ts: NOW }, { hole: 4, speed: -1, from: 0, ts: NOW }], balls: [{ hole: 3, lat: 99, lon: 0, ts: NOW }] });
  assert.equal(live.wind.length, 2); assert.equal(live.balls.length, 0);
  assert.equal(live.wind[0].from, 270);
  assert.deepEqual(holeWind(live, 3, NOW), { windSpeed: 4.2, windFrom: 270, gust: 7, windSrc: 'course', ts: NOW - 60000 });
  assert.equal(holeWind(live, 5, NOW), null);
  const w = withHoleWind({ temp: 5, rho: 1.27, windSpeed: 1, windFrom: 90 }, live, 3, NOW);
  assert.equal(w.temp, 5); assert.equal(w.windSpeed, 4.2); assert.equal(w.windSrc, 'course');
  assert.equal(withHoleWind({ windSpeed: 1 }, live, 9, NOW).windSpeed, 1);
  assert.throws(() => normalizeLive({ format: 'other' }));
});

test('카메라 낙구: 친 뒤 90초 안 · 예상 구역 근처만, 가장 가까운 것', () => {
  const start = { lat: 37.5, lon: 127 }, pred = destination(start, 0, 150);
  const shot = { hole: 3, ts: NOW, pred, r80: 15 };
  const near = destination(pred, 90, 12), far = destination(pred, 90, 200);
  const live = normalizeLive({ balls: [
    { hole: 3, ...far, ts: NOW + 10000 }, { hole: 3, ...near, ts: NOW + 12000 }, { hole: 4, ...pred, ts: NOW + 9000 }, { hole: 3, ...pred, ts: NOW - 5000 }] });
  const m = matchBall(live, shot, NOW + 20000);
  assert.ok(m && Math.abs(distance(m, near)) < 0.5, JSON.stringify(m)); assert.equal(m.off, 12);
  assert.equal(matchBall(normalizeLive({ balls: [{ hole: 3, ...near, ts: NOW + 200000 }] }), shot, NOW + 300000), null);
  const s = sampleLive([{ type: 'wind', hole: 1, id: 'w1' }, { type: 'camera', hole: 2, id: 'c2', lat: 37, lon: 127 }], NOW);
  const n = normalizeLive(s); assert.equal(n.wind.length, 1); assert.equal(n.balls.length, 1);
});

test('그린 측량: 앞·뒤 끝을 지도에 맞춰 동·북 격자로, 그린 가운데 높이 0, 경사 방향 유지', () => {
  // 그린: 가운데 (37.5,127), 앞 끝은 남쪽 12m, 뒤 끝은 북쪽 12m → 앞→뒤 = 북쪽. 높이: 북쪽으로 2% 오르막 + 동쪽으로 1% 오르막
  const green = { lat: 37.5, lon: 127 }, hole = { green, front: destination(green, 180, 12), back: destination(green, 0, 12) };
  const H = (e, n) => 0.02 * n + 0.01 * e;
  // AR 월드: 앞 끝 A=(2,−1.3,4), 앞→뒤 = 월드 −z, 오른쪽(동쪽) = 월드 +x
  const A = { x: 2, y: -1.3, z: 4 }, pts = [];
  let s = 7; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40000; i++) {
    const e = (R() - 0.5) * 24, n = (R() - 0.5) * 26; // 동·북 (그린 가운데 기준)
    pts.push(A.x + e, A.y + H(e, n) - H(0, -12) + (R() - 0.5) * 0.004, A.z - (n + 12));
  }
  const raw = { ok: true, kind: 'lidar', ball: A, hole: { x: A.x, y: A.y + H(0, 12) - H(0, -12), z: A.z - 24 }, points: pts };
  const r = processSurvey(raw, hole, { date: new Date(NOW) });
  const gg = r.greenGrid, surf = gridSurface(gg.grid);
  assert.equal(gg.by, 'user'); assert.deepEqual(gg.origin, green); assert.ok(r.coverage > 0.6, `coverage ${r.coverage}`);
  assert.ok(Math.abs(surf.height(0, 0)) < 0.01, `center ${surf.height(0, 0)}`);
  const [gx, gy] = surf.grad(3, 4);
  assert.ok(Math.abs(gx - 0.01) < 0.003 && Math.abs(gy - 0.02) < 0.003, `grad ${gx} ${gy}`);
  assert.equal(r.warn, null);
  assert.ok(gg.grid.h.every(Number.isFinite));
  assert.throws(() => processSurvey(raw, { green }), /앞·뒤/);
  // 지도 거리와 찍은 거리가 많이 다르면 경고
  const bad = processSurvey({ ...raw, hole: { ...raw.hole, z: A.z - 40 } }, hole, { date: new Date(NOW) });
  assert.match(bad.warn, /많이 달라요/);
  void toLocal;
});

test('그립 센서: PinPoint 태그 친 횟수 증가 = 쳤다 · 다른 태그는 광고 내용이 바뀌면 · 3초에 한 번', () => {
  assert.deepEqual(parseTag({ 65535: '50 54 01 05 00 57' }), { count: 5, battery: 87 });
  assert.equal(parseTag({ 76: '5054010500' }), null);
  assert.equal(signature({ manufacturerData: { 76: 'AA BB' }, serviceData: { x: '01' } }), 'm76:aabb|sx:01');
  const t = new GripTracker();
  const tag = (c, b = 90) => ({ device: { deviceId: 'D1', name: 'Tag' }, rssi: -60, manufacturerData: { 65535: `505401${(c & 255).toString(16).padStart(2, '0')}${(c >> 8).toString(16).padStart(2, '0')}${b.toString(16)}` } });
  assert.equal(t.feed(tag(5), 1000), null, '처음 본 신호는 기준');
  assert.equal(t.feed(tag(5), 1500), null, '같은 횟수');
  const ev = t.feed(tag(6, 80), 2000); assert.equal(ev.deviceId, 'D1'); assert.equal(ev.battery, 80);
  assert.equal(t.feed(tag(7), 3000), null, '3초 안 두 번째는 무시');
  assert.ok(t.feed(tag(8), 6000));
  const g = (v) => ({ device: { deviceId: 'G', name: 'Generic' }, manufacturerData: { 76: v } });
  t.feed(g('0001'), 1000); assert.equal(t.feed(g('0001'), 2000), null); assert.ok(t.feed(g('0002'), 9000));
  assert.deepEqual(clubForEvent([{ deviceId: 'D1', club: '7i' }], ev), { deviceId: 'D1', club: '7i' });
  assert.equal(t.nearby(6500)[0].deviceId, 'D1');
});

test('워치 스윙: 임팩트만 · 그린 위·라운드 밖은 무시 · 공 찾으러 가던 중이면 찾았어요 → 쳤어요', () => {
  const base = { impact: true, inRound: true, onGreen: false, liveShot: false, sinceShotMs: 0 };
  assert.equal(swingAction(base), 'hit');
  assert.equal(swingAction({ ...base, impact: false }), null);
  assert.equal(swingAction({ ...base, onGreen: true }), null);
  assert.equal(swingAction({ ...base, inRound: false }), null);
  assert.equal(swingAction({ ...base, liveShot: true, sinceShotMs: 8000 }), null);
  assert.equal(swingAction({ ...base, liveShot: true, sinceShotMs: 60000 }), 'found-hit');
});
