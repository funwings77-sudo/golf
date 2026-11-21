// AR 그린 굴곡 표현: 등고선 · 능선/골 · 단면
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineFrame, contours, ridgeLines, lineProfile, slopeHue } from '../js/core/greenar.js';
import { buildSurface, demoGreen } from '../js/physics/putt.js';

const plane = (gx, gy) => ({ height: (x, y) => gx * x + gy * y, grad: () => [gx, gy] });
const all = () => true;

test('등고선: 기울어진 평면이면 같은 간격의 곧은 선 · 높이 2cm마다 · 10cm마다 굵은 선', () => {
  const f = lineFrame({ x: 0, y: 0 }, { x: 0, y: 8 }, 0.6);
  const c = contours(plane(0, 0.02), f, all, { rMax: 9 }); // 앞으로 2% 오르막
  assert.ok(c.lines.length >= 7, `lines ${c.lines.length}`);
  for (const L of c.lines) for (const [a, b] of L.segs) assert.ok(Math.abs(a.y - b.y) < 0.02, '앞뒤 경사면 등고선은 좌우로 곧음');
  assert.ok(c.lines.some(L => L.major) && c.lines.some(L => !L.major));
  assert.equal(contours(plane(0, 0), f, all, { rMax: 9 }).lines.length, 0, '평지는 선 없음');
});

test('능선·골: 2단 그린은 단 경계에서 능선/골을 찾고, 평평한 기울기면 아무것도 없음', () => {
  const s = buildSurface(demoGreen('tier').spec ?? { kind: 'grid', grid: demoGreen('tier').grid ?? demoGreen('tier') });
  const f = lineFrame({ x: 0, y: 8 }, { x: 0, y: 22 }, 0.6);
  const r = ridgeLines(s, f, p => p.x > -14 && p.x < 14 && p.y > -4 && p.y < 29, { rMax: 15, h0: 0 });
  // 2단(y≈16에서 계단): 공→홀 '가로' 단면에선 계단이 평행이라 꺾임이 약함 → 세로 방향 그린으로도 확인
  const f2 = lineFrame({ x: -10, y: 16 }, { x: 10, y: 16 }, 0.6);
  const r2 = ridgeLines(s, f2, p => p.x > -14 && p.x < 14 && p.y > -4 && p.y < 29, { rMax: 18, h0: 0 });
  assert.ok(r.length + r2.length >= 1, `ridges ${r.length}+${r2.length}`);
  assert.ok([...r, ...r2].every(L => L.pts.length >= 4));
  assert.equal(ridgeLines(plane(0.02, 0.01), f, all, { rMax: 10 }).length, 0);
});

test('단면: 공에서 0cm로 시작해 홀 높이에서 끝남 · 경사 색은 %에 따라', () => {
  const p = lineProfile(plane(0, 0.02), { x: 0, y: 0 }, { x: 0, y: 5 }, 10);
  assert.equal(p.length, 11); assert.equal(p[0].h, 0); assert.ok(Math.abs(p[10].h - 10) < 1e-9, '5m × 2% = 10cm');
  assert.deepEqual([0.5, 1.5, 2.5, 4].map(slopeHue), ['#5ee6a8', '#ffe066', '#ff9f43', '#ff5a4f']);
});
