// 내 숫자 알기 (insights.js) 테스트: node --test tests/insights.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../js/core/insights.js';
import { learnClub, newRound } from '../js/core/score.js';
import { analyzeShot, shotSummary } from '../js/physics/shotfit.js';
import { airDensity } from '../js/physics/flight.js';
import { defaultBag } from '../js/core/state.js';

// node에는 localStorage가 없음 → 간단한 대용품
globalThis.localStorage ??= (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } }; })();

const shotAt = (total, tempC, along = 0) => {
  const rho = airDensity(tempC, 1013, 50), fit = shotSummary(analyzeShot({ clubId: '7i', total, err: 3, wind: { along, cross: 0 }, rho }));
  return { id: Math.random(), club: '7i', total, carry: fit.est.carry, fit, rho, power: 100, partial: false };
};

test('표준 거리: 추운 날·맞바람 샷은 보통 날씨로 바꾸면 더 길고, 20°C 무풍 샷은 거의 그대로', () => {
  const warm = shotAt(135, 20), cold = shotAt(128, 0), head = shotAt(125, 20, -5);
  assert.ok(Math.abs(I.stdCarry(warm) - warm.carry) < 1.5, `warm ${I.stdCarry(warm)} vs ${warm.carry}`);
  assert.ok(I.stdCarry(cold) > cold.carry + 1, `cold ${I.stdCarry(cold)} vs ${cold.carry}`);
  assert.ok(I.stdCarry(head) > head.carry + 4, `headwind ${I.stdCarry(head)} vs ${head.carry}`);
});

test('클럽 학습은 표준 거리(stdCarry)를 씀 → 겨울에 친 샷으로 거리가 짧게 굳지 않음', () => {
  const club = { id: '7i', carry: 130, sdDist: 0.065, sdLat: 3.8 };
  const shots = [1, 2, 3, 4, 5, 6].map(() => ({ club: '7i', carry: 120, stdCarry: 130 }));
  assert.equal(learnClub(club, shots).carry, 130);
  const raw = shots.map(s => ({ club: s.club, carry: s.carry }));
  assert.ok(learnClub(club, raw).carry < 126);
});

test('10번 중 8번 범위: 샷 5개 이상이면 내 샷의 10~90%, 아니면 클럽 퍼짐으로 어림 + 믿음 정도', () => {
  const club = { id: '7i', carry: 140, sdDist: 0.065, enabled: true };
  const g = I.clubRange(club, []);
  assert.equal(g.src, 'guess'); assert.ok(g.lo < 140 && g.hi > 140); assert.equal(g.trust.dots, 0);
  const shots = [120, 125, 130, 132, 135, 138, 140, 150].map(c => ({ club: '7i', carry: c, total: c + 4 }));
  const r = I.clubRange(club, shots);
  assert.equal(r.src, 'shots'); assert.equal(r.n, 8); assert.equal(r.trust.dots, 3);
  assert.ok(r.lo >= 120 && r.lo <= 126 && r.hi >= 140 && r.hi <= 150, `${r.lo}~${r.hi}`);
  assert.equal(I.dots(2), '●●○○');
});

test('웨지 표: 친 샷이 2개 이상인 칸만 실제 값, 나머지는 스윙 크기 비율로 어림', () => {
  const bag = defaultBag(18, 'M');
  const sw = bag.find(c => c.id === 'SW');
  const shots = [{ club: 'SW', carry: 50, power: 75, partial: true }, { club: 'SW', carry: 54, power: 72, partial: true }];
  const m = I.wedgeMatrix(bag, shots), row = m.find(r => r.id === 'SW');
  assert.ok(row);
  assert.equal(row.cells[1].src, 'shots'); assert.equal(row.cells[1].v, 52);
  assert.equal(row.cells[0].src, 'guess'); assert.equal(row.cells[0].v, sw.carry);
  assert.equal(row.cells[2].v, Math.round(sw.carry * 0.59));
});

test('스크린 거리로 시작: 7번 스크린 150m → 필드 약 141m, 이미 배운 클럽은 그대로', () => {
  const bag = defaultBag(18, 'M').map(c => (c.id === 'D' ? { ...c, learned: true, carry: 222 } : c));
  const r = I.fromScreen(bag, 150, '7i');
  assert.equal(r.field, 141);
  assert.equal(r.bag.find(c => c.id === '7i').carry, 141);
  assert.equal(r.bag.find(c => c.id === 'D').carry, 222);
  const pw = bag.find(c => c.id === 'PW').carry, pw2 = r.bag.find(c => c.id === 'PW').carry;
  assert.ok(Math.abs(pw2 / pw - 141 / bag.find(c => c.id === '7i').carry) < 0.02);
  const gap = I.screenGap([{ id: '7i', name: '7번 아이언', carry: 135, learned: true }], { club: '7i', carry: 150 });
  assert.match(gap.text, /15m 짧아요/);
});

test('잠정구: OB·숲 쪽 확률이 25% 넘으면 알림, 물은 잠정구 대상이 아님', () => {
  const parts = Array.from({ length: 100 }, (_, i) => ({ x: i < 40 ? 30 : 0, y: 150, w: 0.01 }));
  const est = { parts };
  assert.equal(I.provisionalRisk(est, [{ x: 30, y: 150, r: 5, type: 'ob' }]).kind, 'ob');
  assert.equal(I.provisionalRisk(est, [{ x: 30, y: 150, r: 5, type: 'water' }]).kind, null);
  assert.equal(I.provisionalRisk(est, [{ x: 30, y: 150, r: 5, type: 'trees' }]).kind, 'trees');
  const few = { parts: parts.map((p, i) => ({ ...p, x: i < 10 ? 30 : 0 })) };
  assert.equal(I.provisionalRisk(few, [{ x: 30, y: 150, r: 5, type: 'ob' }]).kind, null);
});

test('오늘 컨디션: 0°C면 한 클럽 길게, 20°C면 그대로, 바람·그린 빠르기 한 줄', () => {
  const bag = defaultBag(18, 'M');
  const c0 = I.conditionBrief({ temp: 0, windSpeed: 8, gust: 14 }, bag, { stimp: 11.5, src: 'club' });
  assert.match(c0[0].t, /추워서/); assert.match(c0[0].s, /한 클럽 길게/);
  assert.match(c0[1].t, /강해요/); assert.match(c0[1].t, /돌풍/);
  assert.match(c0[2].t, /빨라요 \(골프장 발표\)/);
  assert.match(I.conditionBrief({ temp: 20, windSpeed: 1 }, bag)[0].t, /그대로/);
  assert.deepEqual(I.conditionBrief(null, bag), []);
});

test('체감 이유: 3m 넘게 다를 때만, 맞바람·추위·오르막을 한 줄로', () => {
  assert.equal(I.playsWhy(140, { total: 141, parts: {} }), null);
  const w = I.playsWhy(140, { total: 152, parts: { wind: 7, temp: 4, elev: 1, alt: 0 } });
  assert.equal(w.text, '체감 152m · 맞바람 +7 · 추워서 +4');
});

const course = { id: 'c1', name: '테스트CC', holes: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, par: i === 2 ? 3 : i === 4 ? 5 : 4, hdcp: i + 1 })) };
function playedRound(fill) {
  const r = newRound({ course, players: ['나'], mode: 'casual', games: {} });
  r.holes.forEach((h, i) => Object.assign(h.scores[0], fill(h, i)));
  return r;
}

test('이 홀 지난 기록: 평균 타수 · 벌타 · 티샷이 자주 간 쪽 → 반대쪽을 보고', () => {
  const rs = [1, 2, 3].map(() => playedRound((h, i) => ({ strokes: i === 0 ? 6 : h.par, putts: 2, fw: i === 0 ? 'R' : 'C', penalties: i === 0 ? 1 : 0 })));
  const hh = I.holeHistory(rs, 'c1', 1);
  assert.equal(hh.n, 3); assert.equal(hh.avg, 6); assert.equal(hh.pen, 3);
  assert.match(hh.tip, /오른쪽으로 자주.*왼쪽을 보고/);
  assert.equal(I.holeHistory(rs, 'other', 1), null);
  assert.equal(I.holeHistory([{ ...rs[0], mode: 'practice' }], 'c1', 1), null);
});

test('공략 미리 보기: 어려운 홀(핸디 1·지난 기록 나쁨)은 지키기, 쉬운 홀은 노려 보기', () => {
  const rs = [playedRound((h, i) => ({ strokes: i === 0 ? 7 : h.par, putts: 2 }))];
  const b = I.roundBriefing(course, course.holes.map(h => h.n), rs);
  assert.equal(b.length, 9);
  assert.equal(b[0].tag, 'safe');
  assert.equal(b[4].tag, 'attack'); // 파 5
  assert.ok(b.every(x => x.line));
});

test('라운드 진단: 퍼트를 많이 친 라운드 → 퍼팅이 가장 아쉬움 · 레슨 영상 링크', () => {
  const r = playedRound(h => ({ strokes: h.par + 2, putts: 3 }));
  const d = I.roundDiagnosis(r, 18);
  assert.equal(d.k, 'putt'); assert.ok(d.strokes >= 5);
  const v = I.lessonVideos('putt');
  assert.equal(v.length, 2); assert.ok(v[0].url.startsWith('https://www.youtube.com/results?search_query='));
  assert.match(I.lessonVideos('fw', 'L')[1].title, /훅/);
  const good = playedRound(h => ({ strokes: h.par, putts: 2, fw: 'C' }));
  assert.equal(I.roundDiagnosis(good, 18).ok, true);
  assert.equal(I.roundDiagnosis(playedRound((h, i) => (i < 3 ? { strokes: 4, putts: 2 } : {})), 18), null);
});

test('처방 효과: 최근 3라운드 퍼트가 줄면 좋아지고 있어요', () => {
  const recent = [1, 2, 3].map(() => playedRound(h => ({ strokes: h.par + 1, putts: 2 })));
  const before = [1, 2, 3].map(() => playedRound(h => ({ strokes: h.par + 2, putts: 3 })));
  const t = I.lessonTrend([...recent, ...before], 'putt');
  assert.ok(t.better); assert.match(t.text, /3\.00번 → 2\.00번.*좋아지고/);
  assert.equal(I.lessonTrend(recent, 'putt'), null);
});

test('오늘 그린 빠르기: 짧았어요 → 느리게(세게), 길었어요 → 빠르게, 내 결과가 골프장 발표보다 우선', () => {
  localStorage.clear();
  const c = { id: 'g1', todayPins: { date: '2026-11-21', stimp: 10 } };
  assert.deepEqual(I.greenToday(c, '2026-11-21'), { stimp: 10, n: 0, src: 'club' });
  assert.equal(I.greenToday(c, '2026-11-22'), null);
  I.recordPuttFeel(c, 10, 'short', '2026-11-21');
  const f = I.recordPuttFeel(c, 9.5, 'short', '2026-11-21');
  assert.equal(f.stimp, 9); assert.equal(f.n, 2);
  assert.deepEqual(I.greenToday(c, '2026-11-21'), { stimp: 9, n: 2, src: 'feel' });
  assert.equal(I.greenToday({ id: 'other' }, '2026-11-21'), null);
  assert.equal(I.nextStimp(14, 'long'), 14); assert.equal(I.nextStimp(6, 'short'), 6); assert.equal(I.nextStimp(10, 'good'), 10);
});
