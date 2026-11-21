// 공 비행 추적 테스트: 친 자리에서 본 각도만으로 공 속도·발사각·좌우·착지 거리를 되찾음
import test from 'node:test';
import assert from 'node:assert/strict';
import { flightModel, fitTrajectory, AngleTrack } from '../js/core/balltrack.js';
import { distance, bearing } from '../js/core/geo.js';

// 가짜 관측: 실제 비행(v, L, S)을 tau초 뒤부터 span초 동안 30fps로, 각도 잡음 sd°
function observe({ v, L, S, club = '7i', tau = 0.6, span = 2.2, noise = 0.15, seed = 3 }) {
  let s = seed; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647), gauss = () => Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(2 * Math.PI * R());
  const m = flightModel({ v, L, S, club });
  const obs = [];
  for (let t = 0; t <= span; t += 1 / 30) { const a = m.angle(t + tau); obs.push({ t, az: a.az + gauss() * noise, el: a.el + gauss() * noise }); }
  return { obs, truth: m.f };
}

test('7번 아이언 (공 속도 42m/s · 발사 17° · 오른쪽 2°): 각도만 보고 속도·발사각·착지 거리를 되찾음', () => {
  const { obs, truth } = observe({ v: 42, L: 17, S: 2 });
  const from = { lat: 37.5, lon: 127 };
  const r = fitTrajectory(obs, { club: '7i', aim: 30, from, guessCarry: 140, tau0: 0.6, tauSd: 0.03 }); // 마이크로 친 시각을 앎
  assert.ok(Math.abs(r.v - 42) < 2.5, `v ${r.v}`);
  assert.ok(Math.abs(r.launch - 17) < 2, `L ${r.launch}`);
  assert.ok(Math.abs(r.carry - truth.carry) < Math.max(4, truth.carry * 0.03), `carry ${r.carry} vs ${truth.carry}`);
  assert.ok(Math.abs(r.tau - 0.6) < 0.1, `tau ${r.tau}`);
  assert.ok(r.sd > 0 && r.sd < 15, `sd ${r.sd}`);
  // 위치: 조준 방위 30° · 오른쪽으로 살짝
  assert.ok(Math.abs(distance(from, r.landing) - truth.carry) < 6);
  assert.ok(bearing(from, r.landing) > 30 && bearing(from, r.landing) < 36);
  assert.ok(r.path.length > 10 && r.path.some(p => p.h > 15));
});

test('친 시각을 모르면: 짧게 본 비행은 거리 범위를 넓게(정직하게) · 친 시각(마이크·워치)을 알면 하나로 좁혀짐', () => {
  const { obs, truth } = observe({ v: 42, L: 17, S: 2, tau: 0.6, span: 2.2 });
  const blind = fitTrajectory(obs, { club: '7i', aim: 0, guessCarry: 140 });
  assert.ok(blind.lo <= truth.carry + 3 && blind.hi >= truth.carry - 3, `range ${blind.lo}~${blind.hi} vs ${truth.carry}`);
  const timed = fitTrajectory(obs, { club: '7i', aim: 0, guessCarry: 140, tau0: 0.6, tauSd: 0.03 });
  assert.ok(Math.abs(timed.carry - truth.carry) < 4, `timed ${timed.carry} vs ${truth.carry}`);
  assert.ok(Math.abs(timed.v - 42) < 1.5, `v ${timed.v}`); assert.equal(timed.timed, true);
  assert.ok(timed.sd < blind.sd);
});

test('드라이버 (65m/s · 12°): 짧게(1초) 봐도 대략 맞고 오차(±)는 더 큼', () => {
  const long = fitTrajectory(observe({ v: 65, L: 12, S: -1, club: 'D', span: 2.5, tau: 0.3 }).obs, { club: 'D', aim: 0, guessCarry: 220, tau0: 0.3 });
  const { obs, truth } = observe({ v: 65, L: 12, S: -1, club: 'D', span: 1.0, tau: 0.3 });
  const short = fitTrajectory(obs, { club: 'D', aim: 0, guessCarry: 220, tau0: 0.3 });
  assert.ok(Math.abs(short.carry - truth.carry) < truth.carry * 0.08, `${short.carry} vs ${truth.carry}`);
  assert.ok(short.sd > long.sd);
  assert.equal(fitTrajectory(obs.slice(0, 4), { club: 'D' }), null, '점이 너무 적으면 계산 안 함');
});

test('각도 이어 붙이기: 예상 위치 근처 점만 · 엉뚱한 점(새·나뭇잎)은 건너뜀', () => {
  const tr = new AngleTrack();
  tr.add([{ az: 0, el: 5, score: 9 }], 0);
  tr.add([{ az: 0.3, el: 6, score: 9 }, { az: 20, el: 30, score: 99 }], 33);
  const o = tr.add([{ az: 0.6, el: 7.1, score: 5 }, { az: -15, el: 2, score: 50 }], 66);
  assert.ok(Math.abs(o.az - 0.6) < 0.01 && tr.obs.length === 3);
  assert.equal(tr.add([{ az: 30, el: 40, score: 99 }], 100), null);
});

// ---------- 🚓 교통 단속 카메라 원리 ----------
import { spotMoving, estimateShift, FlightSpotter, VALID, fuseHitTime, HIT_SD } from '../js/core/balltrack.js';

test('잔차 검사: 엉뚱한 점(새·잔상) 몇 개가 섞여도 버리고 다시 맞춤 · 버린 수를 알려 줌', () => {
  const { obs, truth } = observe({ v: 42, L: 17, S: 2 });
  for (const i of [10, 25, 40, 55]) obs[i] = { ...obs[i], el: obs[i].el + 4, az: obs[i].az - 3 };
  const r = fitTrajectory(obs, { club: '7i', aim: 0, guessCarry: 140, tau0: 0.6, tauSd: 0.03 });
  assert.equal(r.valid, true, r.reason);
  assert.ok(r.rejected >= 4 && r.rejected <= 6, `rejected ${r.rejected}`);
  assert.ok(Math.abs(r.carry - truth.carry) < 4, `${r.carry} vs ${truth.carry}`);
  assert.ok(r.rms < 0.4, `rms ${r.rms}`);
});

test('측정 무효: 공 비행이 아닌 움직임(무작위 점)은 valid:false — 결과를 쓰지 않음', () => {
  let s = 7; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const obs = Array.from({ length: 30 }, (_, i) => ({ t: i / 30, az: (R() - 0.5) * 30, el: R() * 25 }));
  const r = fitTrajectory(obs, { club: '7i', aim: 0, guessCarry: 140 });
  assert.equal(r.valid, false); assert.ok(r.reason);
  assert.ok(VALID.maxRms < 1);
});

test('친 시각 이중 판정: 🎤 소리 ↔ ⌚ 스윙이 맞으면 합쳐서 더 정확 · 어긋나면(남의 샷 소리) 둘 다 안 믿음', () => {
  const both = fuseHitTime(1000, 1080);
  assert.equal(both.src, 'both'); assert.ok(both.sd < HIT_SD.mic && Math.abs(both.t - 1005) < 5, JSON.stringify(both));
  const bad = fuseHitTime(1000, 2600);
  assert.equal(bad.conflict, true); assert.equal(bad.t, null);
  assert.equal(fuseHitTime(null, 900).src, 'swing'); assert.equal(fuseHitTime(null, null).t, null);
  // 영상만으로는 친 시각을 못 가림: 틀린 시각을 넣어도 각도는 잘 맞음 → 그래서 센서끼리 교차 검증이 필요
  const { obs } = observe({ v: 42, L: 17, S: 2, tau: 0.6 });
  const wrong = fitTrajectory(obs, { club: '7i', aim: 0, guessCarry: 140, tau0: 1.6, tauSd: 0.03 });
  assert.ok(wrong.rms < 0.5);
  const blind = fitTrajectory(obs, { club: '7i', aim: 0, guessCarry: 140, timingConflict: true });
  assert.equal(blind.timingConflict, true); assert.equal(blind.timed, false); assert.ok(blind.hi - blind.lo > 5);
});

test('설치 기하 보정: 눈높이 1.45m · 2m 뒤에서 찍어도 보정하면 정확 · 안 하면 틀어짐', () => {
  const obsAt = { x: 0.5, y: -2, z: 1.45 };
  const m = flightModel({ v: 42, L: 17, S: 2, club: '7i', obsAt });
  const obs = []; for (let t = 0; t <= 2.2; t += 1 / 30) { const a = m.angle(t + 0.6); obs.push({ t, ...a }); }
  const good = fitTrajectory(obs, { club: '7i', aim: 0, guessCarry: 140, tau0: 0.6, tauSd: 0.03, obsAt });
  const bad = fitTrajectory(obs, { club: '7i', aim: 0, guessCarry: 140, tau0: 0.6, tauSd: 0.03 });
  assert.ok(Math.abs(good.carry - m.f.carry) < 3, `good ${good.carry} vs ${m.f.carry}`);
  assert.ok(good.rms < bad.rms, `${good.rms} vs ${bad.rms}`);
});

// 가짜 영상: 무늬 있는 배경 + 작은 공 (W×H)
function frame(W, H, { shx = 0, shy = 0, ball = null, flicker = 0, seed = 1 } = {}) {
  const g = new Uint8Array(W * H);
  let s = seed; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const X = x + shx, Y = y + shy; // 배경 무늬 (휴대폰이 움직이면 통째로 밀림)
    let v = 120 + 50 * Math.sin(X * 0.37) * Math.cos(Y * 0.29) + 30 * Math.sin((X + 2 * Y) * 0.11);
    if (flicker && x > W * 0.6 && y > H * 0.5) v += (R() - 0.5) * flicker; // 흔들리는 나뭇잎 자리
    g[y * W + x] = Math.max(0, Math.min(255, v));
  }
  if (ball) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) g[(ball.y + dy) * W + ball.x + dx] = 250;
  return g;
}

test('흔들림 보정(MTI): 휴대폰이 3·2픽셀 흔들려도 배경은 지워지고 공만 남음', () => {
  const W = 160, H = 120, a = frame(W, H), b = frame(W, H, { shx: 3, shy: 2, ball: { x: 60, y: 40 } });
  const s = estimateShift(b, a, W, H);
  assert.deepEqual([s.dx, s.dy], [3, 2]);
  const c = spotMoving(b, a, W, H, { s1: s });
  assert.equal(c.length, 1); assert.ok(Math.abs(c[0].x - 60.5) < 1 && Math.abs(c[0].y - 40.5) < 1);
  const raw = spotMoving(b, a, W, H); // 보정 없이: 배경이 통째로 바뀌어 공의 SNR이 떨어지거나 놓침
  assert.ok(!raw.length || raw[0].snr < c[0].snr * 0.7, `${raw[0]?.snr} vs ${c[0].snr}`);
});

test('3장 차이: 공이 있던 자리(잔상)는 사라지고 지금 자리만 · CFAR: 나뭇잎 흔들림 쪽은 문턱이 올라감', () => {
  const W = 160, H = 120, sp = new FlightSpotter({ width: W });
  sp.step(frame(W, H, { ball: { x: 30, y: 60 }, flicker: 60, seed: 1 }), W, H);
  sp.step(frame(W, H, { ball: { x: 40, y: 55 }, flicker: 60, seed: 2 }), W, H);
  const c = sp.step(frame(W, H, { ball: { x: 50, y: 50 }, flicker: 60, seed: 3 }), W, H);
  assert.equal(c.length, 1, JSON.stringify(c));
  assert.ok(Math.abs(c[0].x - 50.5) < 1 && Math.abs(c[0].y - 50.5) < 1);
});

test('칼만 추적 M-of-N: 먼저 보인 새(반대로 움직임)가 아니라 3번 이어진 공 궤적을 확정', () => {
  const tr = new AngleTrack();
  const ball = i => ({ az: 1 + 0.1 * i, el: 4 + 0.9 * i, score: 5 }), bird = i => ({ az: 15 - 2.5 * i, el: 20 - 3 * i * i, score: 40 });
  assert.equal(tr.add([bird(0), ball(0)], 0), null);
  assert.equal(tr.add([bird(1), ball(1)], 33), null);
  const o = tr.add([ball(2), { az: -10, el: 2, score: 60 }], 66);
  assert.ok(o && Math.abs(o.el - ball(2).el) < 1e-9, '공 궤적 확정');
  assert.equal(tr.obs.length, 3); assert.equal(tr.t0, 0);
  tr.add([], 100); // 한 장 놓침
  const o2 = tr.add([bird(4), ball(4)], 133);
  assert.ok(o2 && Math.abs(o2.el - ball(4).el) < 1e-9, '잠깐 놓쳐도 예측으로 다시 이어 붙임');
});
