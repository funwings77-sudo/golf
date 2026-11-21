// 센서 융합 테스트 (core/fusion.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuse, fuse2, blendWeight, SIGMA, srcLine } from '../js/core/fusion.js';

test('정확한 기술일수록 크게 믿음 · 여러 개면 합친 오차가 더 작아짐', () => {
  const r = fuse([{ v: 8.52, sd: SIGMA.dist.lidar(8.5), src: 'lidar' }, { v: 8.9, sd: SIGMA.dist.steps(8.5), src: 'steps' }]);
  assert.ok(Math.abs(r.v - 8.52) < 0.01, String(r.v)); // LiDAR 쪽으로
  assert.ok(r.sd < SIGMA.dist.lidar(8.5)); assert.deepEqual(r.srcs, ['lidar', 'steps']);
  const two = fuse([{ v: 10, sd: 1, src: 'a' }, { v: 12, sd: 1, src: 'b' }]);
  assert.equal(two.v, 11); assert.ok(Math.abs(two.sd - 1 / Math.SQRT2) < 1e-9);
});

test('튀는 값(GPS 튐 등)은 빼고 합침', () => {
  const r = fuse([{ v: 8.5, sd: 0.05, src: 'lidar' }, { v: 8.6, sd: 0.4, src: 'camera' }, { v: 21, sd: 3, src: 'gps' }]);
  assert.ok(!r.srcs.includes('gps')); assert.equal(r.dropped.length, 1); assert.ok(Math.abs(r.v - 8.5) < 0.02);
});

test('한 개뿐이거나 없을 때 · 2차원(경사 벡터) · 섞는 비율 · 출처 글', () => {
  assert.equal(fuse([]), null);
  assert.deepEqual(fuse([{ v: 3, sd: 0.2, src: 'typed' }]).srcs, ['typed']);
  const s = fuse2([{ x: 1.0, y: -0.5, sd: 0.3, src: 'lidar' }, { x: 1.6, y: -0.2, sd: 0.9, src: 'tilt' }]);
  assert.ok(s.x > 1.0 && s.x < 1.1 && s.srcs.length === 2);
  assert.ok(Math.abs(blendWeight(0.3, 0.3) - 0.5) < 1e-9); assert.ok(blendWeight(0.1, 1) < 0.02);
  assert.equal(srcLine(['lidar', 'tilt']), '📏 LiDAR + 📐 기울기 센서');
});

test('AR 선 만들기: 그린 격자·경사 화살표·홀·퍼팅 길이 측정한 표면 높이 위에 · 라이 격자', async () => {
  const { greenOverlay, lieOverlay } = await import('../js/core/depth.js');
  const nx = 21, ny = 41, grid = { x0: -2.5, y0: -1, dx: 0.25, nx, ny, h: [] };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) grid.h.push(0.02 * (grid.y0 + j * 0.25)); // 홀 쪽 2% 오르막
  const scan = { D: 6, dh: 0.12, grid, slope: { along: 0.02, cross: 0 }, kind: 'lidar' };
  const path = Array.from({ length: 30 }, (_, i) => ({ x: 0.1 * Math.sin(i / 10), y: i * 0.2 }));
  const ov = greenOverlay(scan, { path, aimPoint: { x: 0.2, y: 6 }, aimCups: 1.8 }, { info: '테스트' });
  assert.equal(ov.info, '테스트'); assert.ok(ov.lines.length > 20);
  const pl = ov.lines.find(l => l.w === 4); // 퍼팅 길
  for (let i = 0; i < pl.p.length; i += 3) assert.ok(Math.abs(pl.p[i + 2] - (0.02 * pl.p[i + 1] + 0.012)) < 0.01, '길이 표면 위 (+1.2cm)');
  assert.ok(ov.lines.some(l => l.c[0] === 143), '경사 화살표'); assert.ok(ov.labels.some(l => l.t.includes('6.00m')));
  const lo = lieOverlay({ ...scan, D: 1.5 }, { info: 'x' });
  assert.ok(lo.lines.length >= 11); assert.match(lo.labels[0].t, /오르막 1\.1°/);
});
