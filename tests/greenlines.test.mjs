// AR 그린 굴곡 표현: 등고선 · 능선/골 · 단면
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineFrame, contours, ridgeLines, lineProfile, slopeHue } from '../js/core/greenar.js';
import { buildSurface, demoGreen, fitGridFromGradients, fitQuadFromGradients, gridSurface, windSlope } from '../js/physics/putt.js';

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

test('직접 재기 면: 좌우까지 잰 기울기 → 높이 격자가 지형(골)을 이차식보다 정확히 · 등고선이 휨', () => {
  const H = (x, y) => 0.012 * y + 0.05 * Math.exp(-((x + 0.8) ** 2) / 1.2) * Math.min(1, y / 4); // 왼쪽에 둔덕이 자라는 그린
  const Gd = (x, y, e = 1e-4) => [(H(x + e, y) - H(x - e, y)) / 2 / e, (H(x, y + e) - H(x, y - e)) / 2 / e];
  const P = [[0, 0], [0, 4], [0, 7], [-1, 4], [1, 4], [-1, 7], [1, 7]].map(([x, y]) => { const [gx, gy] = Gd(x, y); return { x, y, gx, gy }; });
  const err = s => { let e = 0; for (let y = 0; y <= 8; y += 0.5) for (let x = -1.5; x <= 1.5; x += 0.5) e = Math.max(e, Math.abs(s.height(x, y) - s.height(0, 0) - (H(x, y) - H(0, 0)))); return e; };
  const g = gridSurface(fitGridFromGradients(P, { x0: -4, y0: -1.5, x1: 4, y1: 10.5 }, { dx: 0.3, smooth: 0.01 })), q = fitQuadFromGradients(P);
  assert.ok(err(g) < 0.02, `격자 오차 ${err(g)}`); assert.ok(err(g) < err(q), '이차식보다 정확');
  const f = lineFrame({ x: 0, y: 0 }, { x: 0, y: 8 }, 0.6), c = contours(g, f, () => true, { rMax: 9 });
  // 휜 정도: 한 등고선 위 점들의 y가 x에 따라 달라짐 (평행 직선이면 거의 같음)
  const L = c.lines.filter(l => l.segs.length > 20).sort((a, b) => b.segs.length - a.segs.length)[0], ys = L.segs.map(s => f.toSurf(s[0]).y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.5, '등고선이 지형 따라 휨');
});

test('바람: 뒤바람은 내리막처럼, 옆바람은 그쪽으로 · 10m/s 예보면 경사 1% 안팎', () => {
  const tail = windSlope(10, 180, 0); // 남쪽에서 불어 북쪽(홀 쪽)으로 미는 바람 · 홀이 북쪽
  assert.ok(tail.b < 0 && Math.abs(tail.a) < 1e-9 && tail.along > 0); assert.ok(tail.pct > 0.6 && tail.pct < 1.6, `${tail.pct}`);
  const cross = windSlope(10, 270, 0); // 서풍 → 오른쪽(동)으로 밂
  assert.ok(cross.a < 0 && cross.cross > 0);
  assert.equal(windSlope(5, 90, null), null, '방향을 모르면 반영 안 함');
});
