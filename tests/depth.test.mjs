// 깊이 카메라 점 → 높이 지도 (depth.js) 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { processScan, toLocalFrame } from '../js/core/depth.js';
import { gridSurface } from '../js/physics/putt.js';

// 월드(y 위) 안에 그린을 만듦: 공에서 홀 쪽(방위 theta)으로 D m, 홀 쪽 오르막 a%, 오른쪽이 높은 b%
function synth({ D = 6, theta = 0.7, along = 0.02, cross = -0.015, bump = 0, noise = 0.004, n = 9000, outliers = 0, seed = 1 }) {
  let s = seed; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(2 * Math.PI * R());
  const ball = { x: 1.2, y: -1.4, z: -0.8 };
  const f = [Math.sin(theta), -Math.cos(theta)], r = [-f[1], f[0]];
  const H = (lx, ly) => along * ly + cross * lx + bump * Math.exp(-((lx - 0.5) ** 2 + (ly - D / 2) ** 2) / 0.8);
  const W = (lx, ly, h) => [ball.x + lx * r[0] + ly * f[0], ball.y + h, ball.z + lx * r[1] + ly * f[1]];
  const pts = [];
  for (let k = 0; k < n; k++) { const lx = (R() - 0.5) * 5, ly = -1 + R() * (D + 2.5); pts.push(...W(lx, ly, H(lx, ly) + gauss() * noise)); }
  for (let k = 0; k < outliers; k++) { const lx = (R() - 0.5) * 2, ly = R() * D; pts.push(...W(lx, ly, H(lx, ly) + 0.3 + R() * 0.6)); } // 발·퍼터·깃대
  const [hx, hy, hz] = W(0, D, H(0, D));
  return { ok: true, kind: 'lidar', ball, hole: { x: hx, y: hy, z: hz }, points: pts, H };
}

test('로컬 좌표: 공 원점, 홀 = (0, D), 오른쪽 +x', () => {
  const L = toLocalFrame({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.1, z: -5 }); // ARKit/ARCore: 앞 = −z
  const q = L.map(0, 0.1, -5); assert.ok(Math.abs(q.x) < 1e-9 && Math.abs(q.y - 5) < 1e-9 && Math.abs(q.h - 0.1) < 1e-9);
  assert.ok(L.map(1, 0, 0).x > 0.99, '+x 월드 = 오른쪽');
});

test('LiDAR 점: 거리·고저차·경사를 되찾음 (튀는 점 무시)', () => {
  const raw = synth({ outliers: 400 }), r = processScan(raw);
  assert.ok(Math.abs(r.D - 6) < 0.01, `D ${r.D}`);
  assert.ok(Math.abs(r.dh - 0.12) < 0.002, `dh ${r.dh}`);
  assert.ok(Math.abs(r.slope.along - 0.02) < 0.002 && Math.abs(r.slope.cross + 0.015) < 0.002, JSON.stringify(r.slope));
  assert.equal(r.planeOnly, false); assert.ok(r.coverage > 0.9); assert.ok(r.conf >= 0.8, `conf ${r.conf}`);
  const s = gridSurface(r.grid), [gx, gy] = s.grad(0.2, 3);
  assert.ok(Math.abs(gy - 0.02) < 0.004 && Math.abs(gx + 0.015) < 0.004, `grad ${gx} ${gy}`);
});

test('그린 위 볼록한 곳(마운드)도 높이 지도에 남음', () => {
  const raw = synth({ bump: 0.05, noise: 0.003 }), r = processScan(raw), s = gridSurface(r.grid);
  const top = s.height(0.5, 3), side = s.height(-1.4, 3) + (0.5 + 1.4) * -0.015;
  assert.ok(top - side > 0.025, `bump ${top - side}`);
});

test('점이 거의 없으면 평면 하나로 (믿음 낮춤), 공·홀 높이 차이는 유지', () => {
  const raw = { ...synth({ n: 30 }), kind: 'plane' }, r = processScan(raw);
  assert.equal(r.planeOnly, true); assert.ok(r.conf < 0.6);
  const s = gridSurface(r.grid); assert.ok(Math.abs(s.height(0, 6) - s.height(0, 0) - 0.12) < 0.03);
  const none = processScan({ ok: true, kind: 'depth', ball: { x: 0, y: 0, z: 0 }, hole: { x: 3, y: -0.05, z: 0 }, points: [] });
  assert.equal(none.D, 3); assert.equal(none.planeOnly, true);
  assert.ok(none.grid.h.every(Number.isFinite));
});
