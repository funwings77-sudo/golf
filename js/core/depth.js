// 📏 깊이 카메라 (아이폰 LiDAR · 안드로이드 ARCore 깊이)
//  네이티브 플러그인 'PinpointDepth' (android/.../DepthPlugin.java · ios/App/App/DepthPlugin.swift)
//   available() → { ok, kind: 'lidar' | 'depth' | 'plane' | 'none', reason }
//   measure({ scan }) → { ok, kind, ball:{x,y,z}, hole:{x,y,z}, points:[x,y,z, …], frames }  (월드 좌표, y = 위쪽, 미터)
//  여기서는 점들을 퍼팅 엔진이 쓰는 높이 지도 { x0, y0, dx, nx, ny, h } 로 바꿈
//   로컬 좌표: 공 = (0,0), +y = 홀 쪽(수평), +x = 오른쪽, 높이 = 공 기준 (m)

const plugin = () => globalThis.window?.Capacitor?.Plugins?.PinpointDepth || null;
const native = () => !!globalThis.window?.Capacitor?.isNativePlatform?.();

let cached = null;
export async function depthInfo(force = false) {
  if (cached && !force) return cached;
  const p = plugin();
  if (!native() || !p) return (cached = { ok: false, kind: 'none', reason: 'web' });
  try { cached = await p.available(); } catch (e) { cached = { ok: false, kind: 'none', reason: e?.message || 'error' }; }
  return cached;
}
export const KIND_WORD = { lidar: 'LiDAR', depth: '깊이 카메라', plane: '카메라 (바닥 인식)' };

// 재기 화면 열기 → 결과 처리
export async function measureWithDepth({ scan = true } = {}) {
  const p = plugin(); if (!p) throw new Error('이 휴대폰에서는 깊이 카메라를 쓸 수 없어요');
  const raw = await p.measure({ scan });
  if (!raw || raw.cancelled || !raw.ok) return { cancelled: true };
  return processScan(raw);
}

const med = a => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// 월드 → 로컬 (공 원점, 홀 쪽 +y)
export function toLocalFrame(ball, hole) {
  const fx = hole.x - ball.x, fz = hole.z - ball.z, D = Math.hypot(fx, fz) || 1e-6;
  const f = [fx / D, fz / D], r = [-f[1], f[0]]; // 오른쪽 = 앞 × 위
  return { D, dh: hole.y - ball.y, map: (x, y, z) => ({ x: (x - ball.x) * r[0] + (z - ball.z) * r[1], y: (x - ball.x) * f[0] + (z - ball.z) * f[1], h: y - ball.y }) };
}

// 점들 → 높이 지도
//  1) 공~홀 둘레 띠 안의 점만 (발·퍼터·깃대처럼 튀는 점 제거: 평면에서 15cm 넘게 벗어난 점)
//  2) 25cm 칸마다 가운데 값(median) · 2) 빈칸은 이웃 평균으로 채움 · 3) 3×3 한 번 부드럽게
//  점이 너무 적으면 기울어진 평면 하나로 (kind: 'plane')
export function processScan(raw, { dx = 0.25 } = {}) {
  const { ball, hole } = raw, kind = raw.kind || 'plane';
  const L = toLocalFrame(ball, hole), D = L.D;
  const W = Math.max(1.5, Math.min(4, 0.25 * D + 1)), Y0 = -1, Y1 = D + 1.5;
  const P = [];
  const pts = raw.points || [];
  for (let i = 0; i + 2 < pts.length; i += 3) {
    const q = L.map(pts[i], pts[i + 1], pts[i + 2]);
    if (q.x >= -W && q.x <= W && q.y >= Y0 && q.y <= Y1 && Math.abs(q.h) < 1.2) P.push(q);
  }
  // 공·홀 점은 확실한 바닥 → 무게를 줘서 넣음
  for (let k = 0; k < 6; k++) { P.push({ x: 0, y: 0, h: 0 }); P.push({ x: 0, y: D, h: L.dh }); }
  // 평면 맞추기 (h = a + b x + c y), 큰 잔차 버리고 한 번 더
  const fitPlane = A => {
    let n = 0, sx = 0, sy = 0, sh = 0, sxx = 0, syy = 0, sxy = 0, sxh = 0, syh = 0;
    for (const p of A) { n++; sx += p.x; sy += p.y; sh += p.h; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y; sxh += p.x * p.h; syh += p.y * p.h; }
    const M = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]], v = [sh, sxh, syh];
    const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d = det(M); if (Math.abs(d) < 1e-9) return { a: med(A.map(p => p.h)) || 0, b: 0, c: L.dh / D };
    const col = (k) => M.map((row, i) => row.map((x, j) => (j === k ? v[i] : x)));
    return { a: det(col(0)) / d, b: det(col(1)) / d, c: det(col(2)) / d };
  };
  let pl = fitPlane(P);
  const res = p => p.h - (pl.a + pl.b * p.x + pl.c * p.y);
  let keep = P.filter(p => Math.abs(res(p)) < 0.15);
  if (keep.length >= 20) pl = fitPlane(keep);
  keep = P.filter(p => Math.abs(res(p)) < 0.12);
  const noise = 1.4826 * med(keep.map(p => Math.abs(res(p)))) || 0;

  const nx = Math.round(2 * W / dx) + 1, ny = Math.round((Y1 - Y0) / dx) + 1, x0 = -W, y0 = Y0;
  const bins = Array.from({ length: nx * ny }, () => []);
  for (const p of keep) {
    const i = Math.round((p.x - x0) / dx), j = Math.round((p.y - y0) / dx);
    if (i >= 0 && i < nx && j >= 0 && j < ny) bins[j * nx + i].push(p.h);
  }
  let h = bins.map(b => (b.length >= 2 ? med(b) : NaN));
  // 띠 가운데(|x| ≤ 1m)에서 채워진 칸 비율 = 공이 지나갈 길을 얼마나 봤나
  let core = 0, coreN = 0, filled = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * dx, y = y0 + j * dx, ok = Number.isFinite(h[j * nx + i]);
    if (ok) filled++;
    if (Math.abs(x) <= 1 && y >= 0 && y <= D) { coreN++; if (ok) core++; }
  }
  const coverage = coreN ? core / coreN : 0;
  const planeOnly = kind === 'plane' || coverage < 0.2 || filled < 12;
  if (planeOnly) h = h.map((_, k) => pl.a + pl.b * (x0 + (k % nx) * dx) + pl.c * (y0 + Math.floor(k / nx) * dx));
  else {
    // 빈칸 채우기: 이웃 평균을 여러 번 (평면 값에서 시작)
    const empty = h.map(v => !Number.isFinite(v));
    for (let k = 0; k < h.length; k++) if (empty[k]) h[k] = pl.a + pl.b * (x0 + (k % nx) * dx) + pl.c * (y0 + Math.floor(k / nx) * dx);
    for (let it = 0; it < 30; it++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!empty[k]) continue;
      let s = 0, c = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a >= 0 && a < nx && b >= 0 && b < ny) { s += h[b * nx + a]; c++; } }
      h[k] = s / c;
    }
    // 3×3 부드럽게 한 번 (잔디·센서 잡음)
    const sm = h.slice();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && a < nx && b >= 0 && b < ny) { s += h[b * nx + a]; c++; } }
      sm[j * nx + i] = s / c;
    }
    h = sm;
  }
  // 믿을 만한 정도: 센서 종류 · 길 덮은 비율 · 잡음
  const base = { lidar: 0.9, depth: 0.75, plane: 0.55 }[kind] ?? 0.5;
  const conf = Math.max(0.3, Math.min(0.92, base * (planeOnly ? 0.85 : 0.6 + 0.4 * coverage) - Math.max(0, noise - 0.01) * 4));
  const r4 = v => Math.round(v * 10000) / 10000;
  return {
    kind, D: Math.round(D * 100) / 100, dh: Math.round(L.dh * 1000) / 1000, conf: Math.round(conf * 100) / 100,
    coverage: Math.round(coverage * 100) / 100, noise: Math.round(noise * 1000) / 1000, nPts: keep.length - 12, planeOnly,
    slope: { along: pl.c, cross: pl.b }, // 평균 기울기 (홀 쪽 +: 오르막, 오른쪽 +: 오른쪽이 높음)
    grid: { x0, y0, dx, nx, ny, h: h.map(r4) },
  };
}

// ---------- 🛰️ 그린 전체 측량 (골프장 직원용) ----------
//  재기 화면에서 그린 앞 끝(A) · 뒤 끝(B)을 찍고 그린 전체를 걸으며 비춤 → 점들
//  A·B를 이 홀의 그린 앞·뒤 좌표(관리자 지정)에 맞춰 놓아 위도·경도 기준으로 바꾸고,
//  관리자 그린맵과 같은 격자 { origin = 그린 중앙, grid: x 동쪽 · y 북쪽 (m) } 로 만듦
export async function surveyWithDepth() {
  const p = plugin(); if (!p) throw new Error('이 휴대폰에서는 깊이 카메라를 쓸 수 없어요');
  const raw = await p.measure({ scan: true, survey: true });
  if (!raw || raw.cancelled || !raw.ok) return { cancelled: true, error: raw?.error };
  return raw;
}
const EARTH_R = 6371008.8, rad = d => d * Math.PI / 180;
const enu = (o, p) => ({ x: rad(p.lon - o.lon) * Math.cos(rad(o.lat)) * EARTH_R, y: rad(p.lat - o.lat) * EARTH_R });

export function processSurvey(raw, hole, { dx = 0.25, date = new Date() } = {}) {
  if (!hole?.front || !hole?.back || !hole?.green) throw new Error('이 홀의 그린 앞·뒤·가운데 위치가 있어야 측량을 지도에 맞출 수 있어요');
  const L = toLocalFrame(raw.ball, raw.hole); // A = 앞 끝, +y = 뒤 끝 쪽
  const A = enu(hole.green, hole.front), B = enu(hole.green, hole.back);
  const gD = Math.hypot(B.x - A.x, B.y - A.y) || 1, f = [(B.x - A.x) / gD, (B.y - A.y) / gD], r = [f[1], -f[0]]; // 동·북 좌표의 앞/오른쪽
  // 점 → 동·북 (A 기준 위치 + 회전), 높이는 A 기준
  const P = [], pts = raw.points || [];
  for (let i = 0; i + 2 < pts.length; i += 3) {
    const q = L.map(pts[i], pts[i + 1], pts[i + 2]);
    if (Math.abs(q.h) > 2.5) continue; // 사람·깃대·나무
    P.push({ x: A.x + q.x * r[0] + q.y * f[0], y: A.y + q.x * r[1] + q.y * f[1], h: q.h });
  }
  if (P.length < 200) throw new Error('점이 너무 적어요. 그린을 더 천천히, 가까이(1~3m) 비춰 주세요');
  // 범위: 점의 1~99% (튀는 점 제외), 최대 50m
  const qs = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) * q)]; };
  const xs = P.map(p => p.x), ys = P.map(p => p.y);
  let x0 = Math.floor(qs(xs, 0.01) / dx) * dx, x1 = Math.ceil(qs(xs, 0.99) / dx) * dx, y0 = Math.floor(qs(ys, 0.01) / dx) * dx, y1 = Math.ceil(qs(ys, 0.99) / dx) * dx;
  if (x1 - x0 > 50) { const c = (x0 + x1) / 2; x0 = c - 25; x1 = c + 25; }
  if (y1 - y0 > 50) { const c = (y0 + y1) / 2; y0 = c - 25; y1 = c + 25; }
  const nx = Math.round((x1 - x0) / dx) + 1, ny = Math.round((y1 - y0) / dx) + 1;
  const bins = Array.from({ length: nx * ny }, () => []);
  for (const p of P) { const i = Math.round((p.x - x0) / dx), j = Math.round((p.y - y0) / dx); if (i >= 0 && i < nx && j >= 0 && j < ny) bins[j * nx + i].push(p.h); }
  let h = bins.map(b => (b.length >= 3 ? med(b) : NaN));
  // 이웃 5×5 가운데 값에서 8cm 넘게 벗어난 칸 버림 (발·가방·공)
  const h0 = h.slice();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (!Number.isFinite(h0[k])) continue;
    const nb = []; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const a = i + di, b = j + dj; if (a >= 0 && a < nx && b >= 0 && b < ny && Number.isFinite(h0[b * nx + a])) nb.push(h0[b * nx + a]); }
    if (nb.length >= 6 && Math.abs(h0[k] - med(nb)) > 0.08) h[k] = NaN;
  }
  const known = h.map(Number.isFinite), coverage = known.filter(Boolean).length / h.length;
  // 빈칸: 가까운 값으로 채움 (반복 확산) → 3×3 부드럽게
  const base = med(h.filter(Number.isFinite));
  h = h.map(v => (Number.isFinite(v) ? v : base));
  for (let it = 0; it < 60; it++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (known[k]) continue;
    let s = 0, c = 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a >= 0 && a < nx && b >= 0 && b < ny) { s += h[b * nx + a]; c++; } }
    h[k] = s / c;
  }
  const sm = h.slice();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let s = 0, c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && a < nx && b >= 0 && b < ny) { s += h[b * nx + a]; c++; } } sm[j * nx + i] = s / c; }
  // 높이 기준 = 그린 가운데 0
  const ci = Math.round((0 - x0) / dx), cj = Math.round((0 - y0) / dx), z0 = ci >= 0 && ci < nx && cj >= 0 && cj < ny ? sm[cj * nx + ci] : base;
  const d = date, day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    greenGrid: {
      origin: { lat: hole.green.lat, lon: hole.green.lon },
      grid: { x0: Math.round(x0 * 1000) / 1000, y0: Math.round(y0 * 1000) / 1000, dx, nx, ny, h: sm.map(v => Math.round((v - z0) * 10000) / 10000) },
      source: `${KIND_WORD[raw.kind] || '카메라'} 측량 ${day}`, by: 'user', surveyedAt: d.toISOString(), coverage: Math.round(coverage * 100) / 100,
    },
    coverage, nPts: P.length, arLen: Math.round(L.D * 10) / 10, mapLen: Math.round(gD * 10) / 10,
    warn: Math.abs(L.D - gD) > Math.max(3, gD * 0.2) ? `찍은 앞·뒤 거리(${L.D.toFixed(1)}m)가 지도(${gD.toFixed(1)}m)와 많이 달라요. 그린 앞·뒤 끝을 정확히 찍었는지 확인하세요` : null,
  };
}
