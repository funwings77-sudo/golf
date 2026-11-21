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
