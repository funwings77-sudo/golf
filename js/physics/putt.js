// ⑤ 퍼팅 물리 엔진
//  a = -(5/7)·g·∇h(x,y) − μ_roll·g·v̂   (구르는 구의 경사 성분 + 구름 마찰)
//  μ_roll = v0² / (2·g·S)   (스팀프미터: v0 ≈ 1.83 m/s, S = 굴러간 거리)
//  역문제: 조준각 θ, 초기속도 v 를 슈팅법(중첩 이분법)으로 찾고 몬테카를로로 성공확률 평가
import { rng } from '../core/geo.js';

export const G = 9.81;
export const HOLE_R = 0.054;      // 홀컵 지름 108mm
export const CUP_W = 0.108;
export const CAPTURE_V = 1.63;    // 홀 중앙 진입 시 포획 한계속도 (Holmes, 1991)
export const STIMP_V0 = 1.83;

export function muFromStimp(stimpFt) {
  const S = stimpFt * 0.3048;
  return STIMP_V0 * STIMP_V0 / (2 * G * S);
}
export function flatEquivalent(v0, mu) { return v0 * v0 / (2 * mu * G); }
export function speedForFlat(d, mu) { return Math.sqrt(2 * mu * G * Math.max(0, d)); }

// ---------- 지면(높이 함수) ----------
// 모든 표면은 { height(x,y), grad(x,y) -> [gx, gy] } 형태
export function planeSurface(gx, gy, h0 = 0) {
  return { kind: 'plane', height: (x, y) => h0 + gx * x + gy * y, grad: () => [gx, gy] };
}
// h = a x + b y + c x² + d x y + e y²
export function quadSurface({ a = 0, b = 0, c = 0, d = 0, e = 0 }) {
  return {
    kind: 'quad', coeffs: { a, b, c, d, e },
    height: (x, y) => a * x + b * y + c * x * x + d * x * y + e * y * y,
    grad: (x, y) => [a + 2 * c * x + d * y, b + d * x + 2 * e * y],
  };
}
// 사전 측량 높이 격자 { x0, y0, dx, nx, ny, h: number[] }  (행 우선, y 증가 방향)
export function gridSurface(grid) {
  const { x0, y0, dx, nx, ny } = grid;
  const h = Float64Array.from(grid.h);
  const gxA = new Float64Array(nx * ny), gyA = new Float64Array(nx * ny);
  const H = (i, j) => h[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    gxA[j * nx + i] = (H(i + 1, j) - H(i - 1, j)) / ((i > 0 && i < nx - 1 ? 2 : 1) * dx);
    gyA[j * nx + i] = (H(i, j + 1) - H(i, j - 1)) / ((j > 0 && j < ny - 1 ? 2 : 1) * dx);
  }
  const bil = (A, x, y) => {
    let fx = (x - x0) / dx, fy = (y - y0) / dx;
    fx = Math.max(0, Math.min(nx - 1.0001, fx)); fy = Math.max(0, Math.min(ny - 1.0001, fy));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const k = j * nx + i;
    return (A[k] * (1 - tx) + A[k + 1] * tx) * (1 - ty) + (A[k + nx] * (1 - tx) + A[k + nx + 1] * tx) * ty;
  };
  return {
    kind: 'grid', grid,
    bounds: { x0, y0, x1: x0 + (nx - 1) * dx, y1: y0 + (ny - 1) * dx },
    height: (x, y) => bil(h, x, y),
    grad: (x, y) => [bil(gxA, x, y), bil(gyA, x, y)],
  };
}
// 사전 지도 + 현장 측정 보정 평면 융합
export function withCorrection(surface, a, b) {
  if (!a && !b) return surface;
  return {
    ...surface, kind: surface.kind + '+fix', correction: { a, b },
    height: (x, y) => surface.height(x, y) + a * x + b * y,
    grad: (x, y) => { const g = surface.grad(x, y); return [g[0] + a, g[1] + b]; },
  };
}
export function fuseMeasurements(surface, measures) {
  if (!measures?.length) return surface;
  let a = 0, b = 0;
  for (const m of measures) { const g = surface.grad(m.x, m.y); a += m.gx - g[0]; b += m.gy - g[1]; }
  return withCorrection(surface, a / measures.length, b / measures.length);
}

// 현장 기울기 측정점(경사 벡터)들로 2차 곡면을 최소제곱 적합 (곡률 항은 정규화)
export function fitQuadFromGradients(measures, lambda = 0.02) {
  if (!measures.length) return quadSurface({});
  if (measures.length === 1) return quadSurface({ a: measures[0].gx, b: measures[0].gy });
  // 미지수 [a,b,c,d,e]; gx = a + 2c x + d y ; gy = b + d x + 2e y
  const rows = [], rhs = [];
  for (const m of measures) {
    rows.push([1, 0, 2 * m.x, m.y, 0]); rhs.push(m.gx);
    rows.push([0, 1, 0, m.x, 2 * m.y]); rhs.push(m.gy);
  }
  const n = 5, A = Array.from({ length: n }, () => new Array(n).fill(0)), B = new Array(n).fill(0);
  rows.forEach((r, k) => { for (let i = 0; i < n; i++) { B[i] += r[i] * rhs[k]; for (let j = 0; j < n; j++) A[i][j] += r[i] * r[j]; } });
  const scale = rows.length / 2;
  for (let i = 2; i < n; i++) A[i][i] += lambda * scale; // 곡률은 데이터가 충분할 때만
  const sol = solveLinear(A, B);
  return quadSurface({ a: sol[0], b: sol[1], c: sol[2], d: sol[3], e: sol[4] });
}
export function solveLinear(A, B) {
  const n = B.length, M = A.map((r, i) => [...r, B[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / piv; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

// ---------- 굴림 시뮬레이션 ----------
export function simulate(surface, mu, start, v0, dir, opts = {}) {
  const { hole = null, capture = true, dt = 0.004, maxT = 25, record = true, bounds = null } = opts;
  let x = start.x, y = start.y, vx = v0 * Math.cos(dir), vy = v0 * Math.sin(dir);
  const path = record ? [[x, y]] : null;
  const fr = mu * G, k = (5 / 7) * G;
  let t = 0, holed = false, closest = { d: Infinity, signed: 0, v: 0, x, y, t: 0 };
  let lvx = vx, lvy = vy, step = 0;
  while (t < maxT) {
    const [gx, gy] = surface.grad(x, y);
    const sx = -k * gx, sy = -k * gy; // 경사 가속
    let sp = Math.hypot(vx, vy);
    if (sp < 1e-3) {
      if (Math.hypot(sx, sy) <= fr * 1.05) { vx = vy = 0; break; } // 정지 마찰이 이김
      vx = sx * dt; vy = sy * dt; sp = Math.hypot(vx, vy);
    }
    const ax = sx - fr * vx / sp, ay = sy - fr * vy / sp;
    let nvx = vx + ax * dt, nvy = vy + ay * dt;
    // 마찰에 의한 역방향 전환 방지
    if (nvx * vx + nvy * vy < 0 && Math.hypot(sx, sy) <= fr) { nvx = 0; nvy = 0; }
    const nx = x + (vx + nvx) / 2 * dt, ny = y + (vy + nvy) / 2 * dt;
    if (hole) {
      // 선분 위 홀 최근접점
      const ex = nx - x, ey = ny - y, L2 = ex * ex + ey * ey;
      const tt = L2 > 0 ? Math.max(0, Math.min(1, ((hole.x - x) * ex + (hole.y - y) * ey) / L2)) : 0;
      const cx = x + tt * ex, cy = y + tt * ey, d = Math.hypot(hole.x - cx, hole.y - cy);
      const v = Math.hypot(vx + (nvx - vx) * tt, vy + (nvy - vy) * tt);
      if (d < closest.d) {
        const tvx = Math.abs(vx) + Math.abs(vy) > 1e-6 ? vx : lvx, tvy = Math.abs(vx) + Math.abs(vy) > 1e-6 ? vy : lvy;
        const cross = tvx * (hole.y - cy) - tvy * (hole.x - cx); // >0 : 홀이 진행방향 왼쪽 = 공은 홀 오른쪽으로 지나감
        closest = { d, signed: cross > 0 ? d : -d, v, x: cx, y: cy, t: t + tt * dt };
      }
      if (capture && d < HOLE_R) {
        const vc = CAPTURE_V * Math.sqrt(Math.max(0, 1 - (d / HOLE_R) ** 2));
        if (v <= vc || (v < 0.25 && d < HOLE_R * 0.95)) {
          x = hole.x; y = hole.y; holed = true; if (record) path.push([x, y]); break;
        }
      }
    }
    if (Math.abs(nvx) + Math.abs(nvy) > 1e-6) { lvx = nvx; lvy = nvy; }
    x = nx; y = ny; vx = nvx; vy = nvy; t += dt; step++;
    if (record && step % 5 === 0) path.push([x, y]);
    if (bounds && (x < bounds.x0 - 3 || x > bounds.x1 + 3 || y < bounds.y0 - 3 || y > bounds.y1 + 3)) break;
  }
  if (record && !holed) path.push([x, y]);
  return { path, holed, stop: { x, y }, closest, time: t };
}

// 조준각 θ(라디안, +는 왼쪽)와 초기속도로 홀 정중앙을 지나며 홀 통과 속도가 목표값이 되도록 역산
export function solvePutt(surface, mu, ball, hole, { pastDist = 0.43, bounds = null } = {}) {
  const base = Math.atan2(hole.y - ball.y, hole.x - ball.x);
  const D = Math.hypot(hole.x - ball.x, hole.y - ball.y);
  const vTarget = speedForFlat(pastDist, mu);
  const dt = D > 8 ? 0.006 : 0.004;
  const opt = { hole, capture: false, record: false, dt, bounds };
  const missFor = (th, v0) => simulate(surface, mu, ball, v0, base + th, opt).closest;
  // 조준각 탐색: 구간 스캔으로 부호 변화(근) 구간을 찾은 뒤 이분법. 근이 없으면 |빗나감| 최소 각도
  const solveTheta = (v0, center = 0, half = 1.0, step = 0.05) => {
    let best = { th: center, a: Infinity }, bracket = null, prev = null;
    for (let th = center - half; th <= center + half + 1e-9; th += step) {
      const f = missFor(th, v0).signed;
      if (Math.abs(f) < best.a) best = { th, a: Math.abs(f) };
      if (prev && prev.f * f <= 0) {
        const mid = (prev.th + th) / 2;
        if (!bracket || Math.abs(mid - center) < Math.abs((bracket[0] + bracket[1]) / 2 - center)) bracket = [prev.th, th, prev.f];
      }
      prev = { th, f };
    }
    if (!bracket) return { th: best.th, ok: false };
    let [lo, hi, flo] = bracket;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2, f = missFor(mid, v0).signed;
      if (f === 0) return { th: mid, ok: true };
      if ((f > 0) === (flo > 0)) { lo = mid; flo = f; } else hi = mid;
    }
    const th = (lo + hi) / 2;
    // 불연속(짧게 멈춘 공의 부호 반전)으로 생긴 가짜 구간은 버린다
    if (Math.abs(missFor(th, v0).signed) > HOLE_R) return { th: best.th, ok: false };
    return { th, ok: true };
  };
  let vlo = 0.15, vhi = Math.max(1.5, speedForFlat(D * 3 + 3, mu));
  let theta = 0, first = true;
  for (let i = 0; i < 24; i++) {
    const v = (vlo + vhi) / 2;
    let r = first ? solveTheta(v) : solveTheta(v, theta, 0.16, 0.04);
    if (!r.ok && !first) r = solveTheta(v);
    first = false; theta = r.th;
    const c = missFor(theta, v);
    if (c.v < vTarget) vlo = v; else vhi = v;
  }
  const v0 = (vlo + vhi) / 2;
  theta = solveTheta(v0, theta, 0.08, 0.02).th;
  const final = simulate(surface, mu, ball, v0, base + theta, { hole, capture: true, dt, bounds });
  const residual = missFor(theta, v0).d;
  return { theta, v0, base, distance: D, pastDist, path: final.path, holed: final.holed, residual, solved: residual < HOLE_R * 0.6 };
}

export function monteCarlo(surface, mu, ball, hole, base, theta, v0, { sigmaAimDeg = 1.0, sigmaSpeed = 0.06, n = 160, seed = 7, bounds = null } = {}) {
  const R = rng(seed), sA = sigmaAimDeg * Math.PI / 180;
  let made = 0, leaveSum = 0, under1 = 0, over2 = 0;
  const stops = [];
  for (let i = 0; i < n; i++) {
    const th = theta + R.gauss() * sA, v = v0 * (1 + R.gauss() * sigmaSpeed);
    const r = simulate(surface, mu, ball, v, base + th, { hole, capture: true, record: false, dt: 0.005, bounds });
    if (r.holed) { made++; continue; }
    const leave = Math.hypot(r.stop.x - hole.x, r.stop.y - hole.y);
    leaveSum += leave; if (leave < 1) under1++; if (leave > 2) over2++;
    if (stops.length < 80) stops.push(r.stop);
  }
  const miss = n - made;
  return { pMake: made / n, pTwoPuttOrBetter: (made + under1) / n, pLongLeave: over2 / n, meanLeave: miss ? leaveSum / miss : 0, stops };
}

// 여러 "지나치는 거리" 후보 중 성공확률이 가장 높은 라인 선택
export function optimizePutt(surface, mu, ball, hole, skill = {}, { candidates = [0.25, 0.43, 0.6], bounds = null } = {}) {
  let best = null; const alts = [];
  for (const pd of candidates) {
    const sol = solvePutt(surface, mu, ball, hole, { pastDist: pd, bounds });
    const mc = monteCarlo(surface, mu, ball, hole, sol.base, sol.theta, sol.v0, { ...skill, bounds });
    const score = mc.pMake + 0.35 * mc.pTwoPuttOrBetter - 0.3 * mc.pLongLeave;
    const item = { ...sol, mc, score };
    alts.push(item);
    if (!best || score > best.score) best = item;
  }
  return describePutt(surface, mu, ball, hole, best, alts);
}

export function describePutt(surface, mu, ball, hole, sol, alts = []) {
  const D = sol.distance;
  const aimOffset = D * Math.tan(sol.theta); // +왼쪽
  // 최대 휨: 경로의 직선(공→홀)으로부터 최대 수직거리
  const ux = (hole.x - ball.x) / D, uy = (hole.y - ball.y) / D;
  let maxDev = 0;
  for (const [px, py] of sol.path) {
    const along = (px - ball.x) * ux + (py - ball.y) * uy;
    if (along < 0 || along > D) continue;
    const dev = (px - ball.x) * -uy + (py - ball.y) * ux; // +왼쪽
    if (Math.abs(dev) > Math.abs(maxDev)) maxDev = dev;
  }
  const dh = surface.height(hole.x, hole.y) - surface.height(ball.x, ball.y);
  const [gx, gy] = surface.grad(ball.x, ball.y);
  const alongSlope = gx * ux + gy * uy, crossSlope = gx * -uy + gy * ux; // cross>0: 왼쪽이 높음
  return {
    ...sol, alts,
    aimOffset, aimCups: aimOffset / CUP_W, breakM: maxDev, dh,
    flatEquiv: flatEquivalent(sol.v0, mu),
    slopeAtBall: { along: alongSlope * 100, cross: crossSlope * 100 },
    aimPoint: { x: ball.x + (ux * Math.cos(sol.theta) - uy * Math.sin(sol.theta)) * D / Math.cos(sol.theta), y: ball.y + (uy * Math.cos(sol.theta) + ux * Math.sin(sol.theta)) * D / Math.cos(sol.theta) },
  };
}

// ---------- "힘" → 백스윙 크기 ----------
// 일정한 템포에서 공 속도 ∝ 백스윙 크기 → √(평지거리) = a·cm + b  (연습 그린 캘리브레이션으로 적합)
export const DEFAULT_CALIB = { a: 0.1118, b: 0, samples: [] };
export function fitCalibration(samples) {
  const pts = samples.filter(s => s.cm > 0 && s.dist > 0);
  if (pts.length === 0) return { ...DEFAULT_CALIB };
  if (pts.length === 1) return { a: Math.sqrt(pts[0].dist) / pts[0].cm, b: 0, samples };
  let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = pts.length;
  for (const p of pts) { const X = p.cm, Y = Math.sqrt(p.dist); sx += X; sy += Y; sxx += X * X; sxy += X * Y; }
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1e-9), b = (sy - a * sx) / n;
  return a > 0 ? { a, b, samples } : { a: sy / sx, b: 0, samples };
}
export function backswingCm(flatDist, calib = DEFAULT_CALIB) {
  return Math.max(2, (Math.sqrt(Math.max(0, flatDist)) - (calib.b || 0)) / calib.a);
}

// ---------- 데모용 사전 측량 그린 (가상) ----------
export function demoGreen(kind = 'tier') {
  const dx = 0.25, nx = 121, ny = 141, x0 = -15, y0 = -5; // 30m x 35m
  const h = new Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * dx, y = y0 + j * dx;
    let z = 0;
    if (kind === 'tier') z = 0.012 * y - 0.018 * x + 0.16 / (1 + Math.exp(-(y - 16) / 1.6)) + 0.05 * Math.exp(-((x - 6) ** 2 + (y - 6) ** 2) / 18);
    else if (kind === 'saddle') z = 0.015 * y + 0.0016 * (x * x - (y - 14) * (y - 14)) * 0.6;
    else z = -0.025 * x + 0.01 * y + 0.12 * Math.exp(-((x + 2) ** 2 + (y - 12) ** 2) / 30) - 0.06 * Math.exp(-((x - 7) ** 2 + (y - 22) ** 2) / 12);
    h[j * nx + i] = z;
  }
  return { x0, y0, dx, nx, ny, h, name: { tier: '2단 그린', saddle: '말안장 그린', mound: '마운드 그린' }[kind] || kind };
}

// 직렬화 가능한 표면 명세 → 표면 (워커/메인 공용)
//  { kind:'grid', grid, correction? } | { kind:'quad', coeffs } | { kind:'plane', gx, gy }
export function buildSurface(spec) {
  let s;
  if (spec.kind === 'grid') s = gridSurface(spec.grid);
  else if (spec.kind === 'quad') s = quadSurface(spec.coeffs);
  else s = planeSurface(spec.gx || 0, spec.gy || 0);
  if (spec.correction) s = withCorrection(s, spec.correction.a, spec.correction.b);
  if (spec.bounds) s.bounds = spec.bounds;
  return s;
}
