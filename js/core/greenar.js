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
