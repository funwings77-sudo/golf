// AR 그린 리딩 화면 (스마트 글라스식): 거리 링 격자 · 경사 흐름 · 퍼팅 라인 점선 · 홀 거리 태그 · 오르막/내리막
//  좌표: 표면 좌표(그린맵/현장, x·y m) ↔ 시야 좌표(x 오른쪽, y 앞, 원점 = 내 발 = 공 뒤 standBack m)
import { rng } from './geo.js';

// 공→홀 방향을 '앞'으로 하는 시야 좌표계
export function lineFrame(ball, hole, standBack = 0.6) {
  const D = Math.hypot(hole.x - ball.x, hole.y - ball.y) || 1, ux = (hole.x - ball.x) / D, uy = (hole.y - ball.y) / D;
  return {
    D, standBack,
    toView: p => { const dx = p.x - ball.x, dy = p.y - ball.y; return { x: dx * uy - dy * ux, y: dx * ux + dy * uy + standBack }; },
    toSurf: q => { const a = q.y - standBack, r = q.x; return { x: ball.x + a * ux + r * uy, y: ball.y + a * uy - r * ux }; },
  };
}

// 내 위치를 중심으로 한 거리 링 (1m 실선 + 0.5m 점선). 각 점의 z = 그 지점 높이 − 내 발 높이 → 링이 지형 따라 휨
//  그린 밖(inside=false)은 끊어서 반환. dots = 1m 링 위 1m 간격 점(격자 꼭짓점)
export function distanceRings(surf, frame, inside, { rMax, step = 0.5, spanDeg = 42, heights = true } = {}) {
  const h0 = surf.height(...xy(frame.toSurf({ x: 0, y: 0 })));
  const zAt = s => (heights ? surf.height(s.x, s.y) - h0 : 0);
  const rings = [], dots = [], span = spanDeg * Math.PI / 180;
  for (let r = step; r <= rMax + 1e-9; r += step) {
    const major = Math.abs(r - Math.round(r)) < 1e-6, n = Math.max(8, Math.ceil(2 * span * r / 0.25));
    let seg = []; const segs = [];
    for (let i = 0; i <= n; i++) {
      const a = -span + 2 * span * i / n, v = { x: r * Math.sin(a), y: r * Math.cos(a) }, s = frame.toSurf(v);
      if (!inside(s)) { if (seg.length > 1) segs.push(seg); seg = []; continue; }
      seg.push({ ...v, z: zAt(s) });
    }
    if (seg.length > 1) segs.push(seg);
    rings.push({ r, major, segs });
    if (major) {
      const m = Math.max(1, Math.round(2 * span * r));
      for (let i = 0; i <= m; i++) {
        const a = -span + 2 * span * i / m, v = { x: r * Math.sin(a), y: r * Math.cos(a) }, s = frame.toSurf(v);
        if (inside(s)) dots.push({ ...v, z: zAt(s) });
      }
    }
  }
  return { rings, dots, h0 };
}
const xy = p => [p.x, p.y];

// 경사 흐름(물이 흘러가는 방향) 입자: 내리막(−∇h)으로 경사만큼 빠르게 흐르며 꼬리를 남김
export class SlopeFlow {
  constructor(surf, frame, inside, { n = 60, rMin = 0.8, rMax = 10, spanDeg = 42, seed = 3, gain = 30, trail = 16 } = {}) {
    Object.assign(this, { surf, frame, inside, n, rMin, rMax, span: spanDeg * Math.PI / 180, gain, trail, R: rng(seed), ps: [] });
    for (let i = 0; i < n; i++) { const p = this.spawn(); if (p) { p.age = this.R() * p.life; this.ps.push(p); } }
  }
  spawn() {
    for (let k = 0; k < 12; k++) {
      const r = this.rMin + (this.rMax - this.rMin) * Math.sqrt(this.R()), a = (this.R() * 2 - 1) * this.span;
      const s = this.frame.toSurf({ x: r * Math.sin(a), y: r * Math.cos(a) });
      const [gx, gy] = this.surf.grad(s.x, s.y);
      if (this.inside(s) && Math.hypot(gx, gy) > 0.003) return { x: s.x, y: s.y, age: 0, life: 1.6 + this.R() * 2, tr: [] };
    }
    return null;
  }
  // dt 초 진행. 반환: 시야 좌표 꼬리 [[{x,y}…]…] (머리가 마지막)
  step(dt) {
    for (let i = 0; i < this.ps.length; i++) {
      let p = this.ps[i];
      const [gx, gy] = this.surf.grad(p.x, p.y), g = Math.hypot(gx, gy);
      p.age += dt;
      if (p.age > p.life || g < 0.003 || !this.inside(p)) { p = this.spawn(); if (!p) { this.ps.splice(i--, 1); continue; } this.ps[i] = p; continue; }
      const sp = Math.min(1.2, this.gain * g); // 2% 경사 ≈ 0.6 m/s (눈에 보이는 속도로 과장)
      p.x -= gx / g * sp * dt; p.y -= gy / g * sp * dt;
      p.tr.push({ x: p.x, y: p.y }); if (p.tr.length > this.trail) p.tr.shift();
    }
    return this.ps.map(p => ({ fade: Math.min(1, p.age / 0.4, (p.life - p.age) / 0.4), pts: p.tr.map(q => ({ ...this.frame.toView(q), s: q })) }));
  }
}

// 경로를 일정한 길이 간격 점으로 (퍼팅 라인 점선)
export function resamplePath(path, step = 0.25) {
  if (!path?.length) return [];
  const out = [{ x: path[0][0], y: path[0][1], s: 0 }];
  let carry = 0, s = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], L = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= L) { out.push({ x: ax + (bx - ax) * t / L, y: ay + (by - ay) * t / L, s: s + t }); t += step; }
    carry = L - (t - step); s += L;
  }
  const [lx, ly] = path[path.length - 1], last = out[out.length - 1];
  if (Math.hypot(lx - last.x, ly - last.y) > step * 0.3) out.push({ x: lx, y: ly, s });
  return out;
}

// 오르막/내리막 판정 (홀 − 공 높이차)
export function slopeVerdict(dh, D) {
  const pct = D > 0 ? dh / D * 100 : 0;
  if (Math.abs(dh) < 0.02) return { en: 'FLAT', ko: '평지', dh, pct };
  return dh > 0 ? { en: 'UPHILL', ko: '오르막', dh, pct } : { en: 'DOWNHILL', ko: '내리막', dh, pct };
}

// 공 위치의 물 흐름(내리막) 방향: 시야 기준 각도(0 = 앞(홀 쪽), +오른쪽, °)와 경사 %
export function fallLine(surf, frame, p) {
  const [gx, gy] = surf.grad(p.x, p.y), g = Math.hypot(gx, gy);
  if (g < 1e-4) return { deg: 0, pct: 0 };
  const a = frame.toView({ x: p.x, y: p.y }), b = frame.toView({ x: p.x - gx / g, y: p.y - gy / g });
  return { deg: Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI, pct: g * 100 };
}

// ---------- 🗺️ 그린 굴곡 표현 (측량·지도에서 오래 써 온 일반 기법: 등고선 · 능선/골 · 단면) ----------
// 시야 좌표의 부채꼴(내 앞 ±spanDeg, 0.3~rMax m) 안을 격자로 나눠 높이를 재고 → 같은 높이 선(마칭 스퀘어)
//  interval: 선 간격(m, 기본 2cm) · major: 굵은 선 간격(기본 10cm) · 높이는 내 발(h0) 기준
export function contours(surf, frame, inside, { rMax, spanDeg = 42, cell = 0.15, interval = 0.02, major = 0.1 } = {}) {
  const span = spanDeg * Math.PI / 180, xMax = rMax * Math.sin(span), y0 = 0.3;
  const nx = Math.ceil(2 * xMax / cell) + 1, ny = Math.ceil((rMax - y0) / cell) + 1;
  const h0 = surf.height(...xy(frame.toSurf({ x: 0, y: 0 })));
  const H = new Float32Array(nx * ny), ok = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = { x: -xMax + i * cell, y: y0 + j * cell }, k = j * nx + i;
    if (Math.atan2(Math.abs(v.x), v.y) > span || Math.hypot(v.x, v.y) > rMax) continue;
    const s = frame.toSurf(v); if (!inside(s)) continue;
    H[k] = surf.height(s.x, s.y) - h0; ok[k] = 1;
  }
  let lo = Infinity, hi = -Infinity; for (let k = 0; k < H.length; k++) if (ok[k]) { lo = Math.min(lo, H[k]); hi = Math.max(hi, H[k]); }
  const lines = [];
  if (!isFinite(lo) || hi - lo < interval * 0.9) return { lines, lo: isFinite(lo) ? lo : 0, hi: isFinite(hi) ? hi : 0, h0 };
  const P = (i, j) => ({ x: -xMax + i * cell, y: y0 + j * cell });
  for (let lv = Math.ceil(lo / interval) * interval; lv <= hi + 1e-9; lv += interval) {
    const segs = [], mj = Math.abs(lv / major - Math.round(lv / major)) < 1e-6;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
      if (!(ok[a] && ok[b] && ok[c] && ok[d])) continue;
      const v = [H[a], H[b], H[c], H[d]], p = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], cut = [];
      for (let e = 0; e < 4; e++) {
        const v1 = v[e], v2 = v[(e + 1) % 4];
        if ((v1 < lv) !== (v2 < lv)) { const t = (lv - v1) / (v2 - v1), p1 = p[e], p2 = p[(e + 1) % 4]; cut.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t, z: lv }); }
      }
      if (cut.length >= 2) segs.push([cut[0], cut[1]]); if (cut.length === 4) segs.push([cut[2], cut[3]]);
    }
    if (segs.length) lines.push({ level: lv, major: mj, segs });
  }
  return { lines, lo, hi, h0 };
}

// 능선(볼록하게 솟은 줄 · 공이 갈라지는 곳)과 골(오목한 줄 · 공이 모이는 곳)
//  퍼팅 방향을 가로지르는 단면마다 높이의 휨(2차 미분)을 보고, 기울어진 그린 전체 경사는 빼고 '꺾임'만 찾음
//  minCurv: 이보다 크게 휘어야 능선/골 (1/m · 0.004 ≈ 1m 안에서 0.4cm 꺾임)
//  → [{ kind: 'ridge'|'valley', pts: [{x,y,z}…] }] (시야 좌표 · 높이는 h0 기준)
export function ridgeLines(surf, frame, inside, { rMax, half = 4, dy = 0.25, dx = 0.2, d = 0.6, minCurv = 0.003, h0 = 0 } = {}) {
  const out = { ridge: [], valley: [] };
  for (let y = 0.6; y <= rMax; y += dy) {
    const row = [];
    for (let x = -half; x <= half + 1e-9; x += dx) {
      const s = frame.toSurf({ x, y }), sl = frame.toSurf({ x: x - d, y }), sr = frame.toSurf({ x: x + d, y });
      if (!inside(s) || !inside(sl) || !inside(sr)) { row.push(null); continue; }
      const h = surf.height(s.x, s.y), k = (surf.height(sl.x, sl.y) + surf.height(sr.x, sr.y) - 2 * h) / (d * d); // 휨(1/m) · < 0 볼록(능선) · > 0 오목(골)
      row.push({ x, y, z: h - h0, k });
    }
    for (let i = 1; i < row.length - 1; i++) {
      const a = row[i - 1], b = row[i], c = row[i + 1]; if (!a || !b || !c) continue;
      if (b.k < -minCurv && b.k <= a.k && b.k <= c.k) out.ridge.push(b);
      if (b.k > minCurv && b.k >= a.k && b.k >= c.k) out.valley.push(b);
    }
  }
  // 이웃한 단면끼리 가까운 점을 이어 선으로 (가로 0.6m 안 · 한 단면 건너뛰기까지)
  const chain = (pts, kind) => {
    const lines = [], used = new Set(), byY = new Map();
    for (const p of pts) { const k = Math.round(p.y / dy); if (!byY.has(k)) byY.set(k, []); byY.get(k).push(p); }
    for (const p of pts) {
      if (used.has(p)) continue; used.add(p); const line = [p]; let cur = p;
      for (;;) {
        let nxt = null;
        for (const step of [1, 2]) { for (const q of byY.get(Math.round(cur.y / dy) + step) || []) if (!used.has(q) && Math.abs(q.x - cur.x) <= 0.6 && (!nxt || Math.abs(q.x - cur.x) < Math.abs(nxt.x - cur.x))) nxt = q; if (nxt) break; }
        if (!nxt) break; used.add(nxt); line.push(nxt); cur = nxt;
      }
      if (line.length >= 4) lines.push({ kind, pts: line.map(({ x, y, z }) => ({ x, y, z })) });
    }
    return lines;
  };
  // 나란히 붙은 같은 종류 선(평균 0.8m 안)은 하나로: 가장 긴 것만 남김 (화면이 지저분하지 않게)
  const merge = lines => {
    const keep = [];
    for (const L of lines.sort((a, b) => b.pts.length - a.pts.length)) {
      const near = keep.some(K => { let n = 0; for (const p of L.pts) if (K.pts.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 0.8)) n++; return n >= L.pts.length * 0.6; });
      if (!near) keep.push(L);
    }
    return keep;
  };
  return [...merge(chain(out.ridge, 'ridge')), ...merge(chain(out.valley, 'valley'))];
}

// 퍼팅 길 단면: 공 → 홀 직선을 따라 높이(cm) · n개
export function lineProfile(surf, ball, hole, n = 40) {
  const h0 = surf.height(ball.x, ball.y), D = Math.hypot(hole.x - ball.x, hole.y - ball.y);
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return { s: D * t, h: (surf.height(ball.x + (hole.x - ball.x) * t, ball.y + (hole.y - ball.y) * t) - h0) * 100 }; });
}
// 경사 %에 따른 색 (흐름 화살표 · 범례 공통): 초록 <1% · 노랑 <2% · 주황 <3% · 빨강 ≥3%
export const slopeHue = pct => (pct < 1 ? '#5ee6a8' : pct < 2 ? '#ffe066' : pct < 3 ? '#ff9f43' : '#ff5a4f');
