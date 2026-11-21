// 카메라 화면의 입체 지도·공 비행 계산 테스트 (terrain.js · flight3d.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTerrarium, tileXY, makeSampler, withGreen, tilesFor } from '../js/core/terrain.js';
import { flightPath, flightAt } from '../js/physics/flight3d.js';
import { distance, bearing, destination } from '../js/core/geo.js';

test('고도 타일: Terrarium 색 → 높이, 위경도 → 타일·화소', () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  assert.equal(decodeTerrarium(128, 100, 128), 100.5);
  const t = tileXY(37.5, 127, 15);
  assert.deepEqual([t.tx, t.ty], [27943, 12697]); // x = (127+180)/360 × 2^15 = 27943.8
  assert.ok(t.px >= 0 && t.px < 256 && t.py >= 0 && t.py < 256);
  assert.ok(tilesFor([{ lat: 37.5, lon: 127 }], 100).length >= 1);
});

test('높이 읽개: 동쪽으로 오르는 경사면을 화소 사이까지 부드럽게 (타일 경계 넘어도)', () => {
  // 가짜 타일: 높이 = 100 + 0.05 × (전체 화소 x) → 동쪽으로 약 0.05m/화소(≈ 4m) = 1.2% 오르막
  const z = 15, c = tileXY(37.5, 127, z), tiles = new Map();
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    const a = new Float32Array(256 * 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) a[j * 256 + i] = 100 + 0.05 * ((c.tx + dx) * 256 + i - c.tx * 256);
    tiles.set(`${c.tx + dx}/${c.ty + dy}`, a);
  }
  const T = makeSampler(tiles, z), p = { lat: 37.5, lon: 127 }, e = destination(p, 90, 40);
  const slope = (T(e.lat, e.lon) - T(p.lat, p.lon)) / 40;
  assert.ok(Math.abs(slope - 0.05 / (40075016.7 * Math.cos(37.5 * Math.PI / 180) / 2 ** 15 / 256)) < 0.001, `slope ${slope}`);
  assert.ok(Math.abs(T(37.5, 127) - T(37.5, 127.00001)) < 0.05, '부드럽게');
  // 북쪽으로는 평평
  const n = destination(p, 0, 40); assert.ok(Math.abs(T(n.lat, n.lon) - T(p.lat, p.lon)) < 0.01);
});

test('그린 측량 격자를 지형에 붙임: 그린 안은 측량 높이(가운데를 지형에 맞춤), 밖은 지형', () => {
  const flat = () => 50, origin = { lat: 37.5, lon: 127 };
  const g = { x0: -10, y0: -10, dx: 0.5, nx: 41, ny: 41, h: [] };
  for (let j = 0; j < 41; j++) for (let i = 0; i < 41; i++) g.h.push(0.02 * (g.y0 + j * 0.5)); // 북쪽 2% 오르막
  const T = withGreen(flat, { origin, grid: g });
  const n5 = destination(origin, 0, 5), far = destination(origin, 0, 30);
  assert.ok(Math.abs(T(origin.lat, origin.lon) - 50) < 1e-6);
  assert.ok(Math.abs(T(n5.lat, n5.lon) - 50.1) < 0.002);
  assert.equal(T(far.lat, far.lon), 50);
});

test('공 비행 3D: 바람 없으면 조준 방향으로 클럽 거리만큼 · 옆바람이면 휘고 · 맞바람이면 짧게', () => {
  const from = { lat: 37.5, lon: 127 };
  const calm = flightPath({ from, aim: 30, club: '7i', stdCarry: 140 });
  assert.ok(Math.abs(calm.carry - 140) < 2, `carry ${calm.carry}`);
  assert.ok(Math.abs(bearing(from, calm.landing) - 30) < 0.5);
  assert.ok(calm.apex > 15 && calm.apex < 40, `apex ${calm.apex}`);
  assert.ok(calm.total > calm.carry && calm.time > 4 && calm.time < 8);
  assert.ok(Math.abs(distance(from, calm.rest) - calm.total) < 1.5);
  // 왼쪽에서 부는 바람(서풍, 샷은 북쪽) → 오른쪽(동쪽)으로 밀림
  const cross = flightPath({ from, aim: 0, club: '7i', stdCarry: 140, wind: { windSpeed: 6, windFrom: 270 } });
  assert.ok(cross.lateral > 3 && bearing(from, cross.landing) > 1, `lat ${cross.lateral}`);
  const head = flightPath({ from, aim: 0, club: '7i', stdCarry: 140, wind: { windSpeed: 6, windFrom: 0 } });
  assert.ok(head.carry < calm.carry - 8, `head ${head.carry}`);
});

test('재생 위치: 시간에 따라 앞으로 · 가장 높은 곳 지나 착지 → 굴러서 멈춤', () => {
  const f = flightPath({ from: { lat: 37.5, lon: 127 }, aim: 0, club: '7i', stdCarry: 140 });
  const p0 = flightAt(f, 0), pm = flightAt(f, f.time / 2), pl = flightAt(f, f.time), pe = flightAt(f, f.totalTime + 5);
  assert.equal(p0.h, 0);
  assert.ok(pm.h > 10 && distance(p0, pm) > 40 && distance(p0, pm) < distance(p0, pl));
  assert.ok(Math.abs(pl.h) < 0.5 && Math.abs(distance(p0, pl) - f.carry) < 1.5);
  assert.ok(Math.abs(distance(p0, pe) - f.total) < 1.5);
});
