// ④ 그린 경사 히트맵 · 등고선 · 물 흐름 화살표 · ⑤ 퍼팅 라인 렌더링
import { HOLE_R } from '../physics/putt.js';

export function slopeColor(pct) {
  // 0%: 짙은 초록 → 2%: 노랑 → 4%+: 빨강
  const t = Math.max(0, Math.min(1, pct / 4));
  const stops = [[0, [34, 110, 62]], [0.25, [86, 160, 70]], [0.5, [230, 210, 70]], [0.75, [235, 140, 50]], [1, [205, 60, 45]]];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], k = (t - t0) / (t1 - t0);
    return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
  }
  return 'rgb(205,60,45)';
}

// 화면 변환: 공→홀이 화면 위쪽이 되도록 회전
export function makeView(cv, ball, hole, extra = 6) {
  const W = cv.width, H = cv.height;
  const dx = hole.x - ball.x, dy = hole.y - ball.y, D = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx), rot = Math.PI / 2 - ang;
  const c = { x: (ball.x + hole.x) / 2, y: (ball.y + hole.y) / 2 };
  const span = Math.max(D + extra * 2, 10);
  const s = Math.min(H / span, W / Math.max(span * 0.62, 8));
  const cs = Math.cos(rot), sn = Math.sin(rot);
  return {
    W, H, s, D,
    toS(p) { const x = p.x - c.x, y = p.y - c.y; const rx = x * cs - y * sn, ry = x * sn + y * cs; return [W / 2 + rx * s, H / 2 - ry * s]; },
    toW(px, py) { const rx = (px - W / 2) / s, ry = -(py - H / 2) / s; return { x: c.x + rx * cs + ry * sn, y: c.y - rx * sn + ry * cs }; },
    rotVec(vx, vy) { return [vx * cs - vy * sn, -(vx * sn + vy * cs)]; },
  };
}

export function drawGreen(cv, surf, { ball, hole, result = null, inside = () => true, showLine = true, stimpNote = '' }) {
  const ctx = cv.getContext('2d'), V = makeView(cv, ball, hole);
  const { W, H } = V, cell = Math.max(6, Math.round(W / 70));
  ctx.fillStyle = '#16301f'; ctx.fillRect(0, 0, W, H);
  // 히트맵 + 높이 샘플
  const nx = Math.ceil(W / cell) + 1, ny = Math.ceil(H / cell) + 1, hs = new Float32Array(nx * ny), ok = new Uint8Array(nx * ny);
  let hmin = Infinity, hmax = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const w = V.toW(i * cell, j * cell);
    if (!inside(w)) continue;
    const g = surf.grad(w.x, w.y), h = surf.height(w.x, w.y);
    hs[j * nx + i] = h; ok[j * nx + i] = 1; if (h < hmin) hmin = h; if (h > hmax) hmax = h;
    ctx.fillStyle = slopeColor(Math.hypot(g[0], g[1]) * 100);
    ctx.fillRect(i * cell - cell / 2, j * cell - cell / 2, cell + 1, cell + 1);
  }
  // 등고선 (마칭 스퀘어)
  const range = hmax - hmin, step = range > 0.4 ? 0.05 : range > 0.15 ? 0.02 : 0.01;
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(1, W / 500);
  if (isFinite(range) && range > 0) {
    ctx.beginPath();
    for (let lv = Math.ceil(hmin / step) * step; lv < hmax; lv += step) {
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const k = j * nx + i; if (!(ok[k] && ok[k + 1] && ok[k + nx] && ok[k + nx + 1])) continue;
        const a = hs[k], b = hs[k + 1], c = hs[k + nx + 1], d = hs[k + nx];
        const pts = [];
        const e = (v0, v1, x0, y0, x1, y1) => { if ((v0 - lv) * (v1 - lv) < 0) { const t = (lv - v0) / (v1 - v0); pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); } };
        const X = i * cell, Y = j * cell;
        e(a, b, X, Y, X + cell, Y); e(b, c, X + cell, Y, X + cell, Y + cell); e(c, d, X + cell, Y + cell, X, Y + cell); e(d, a, X, Y + cell, X, Y);
        if (pts.length >= 2) { ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); if (pts.length === 4) { ctx.moveTo(...pts[2]); ctx.lineTo(...pts[3]); } }
      }
    }
    ctx.stroke();
  }
  // 물 흐름(내리막) 화살표
  const as = Math.round(W / 9);
  ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1.5, W / 320);
  for (let py = as / 2; py < H; py += as) for (let px = as / 2; px < W; px += as) {
    const w = V.toW(px, py); if (!inside(w)) continue;
    const g = surf.grad(w.x, w.y), m = Math.hypot(g[0], g[1]); if (m < 0.002) continue;
    const [vx, vy] = V.rotVec(-g[0] / m, -g[1] / m), L = as * 0.38 * Math.min(1, m / 0.03) + as * 0.08;
    const x2 = px + vx * L, y2 = py + vy * L;
    ctx.beginPath(); ctx.moveTo(px - vx * L * 0.4, py - vy * L * 0.4); ctx.lineTo(x2, y2); ctx.stroke();
    const hx = -vy, hy = vx, hl = L * 0.35;
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - vx * hl + hx * hl * 0.6, y2 - vy * hl + hy * hl * 0.6); ctx.lineTo(x2 - vx * hl - hx * hl * 0.6, y2 - vy * hl - hy * hl * 0.6); ctx.closePath(); ctx.fill();
  }
  const sz = Math.max(W / 90, 5);
  if (result && showLine) {
    // 몬테카를로 정지점
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    for (const p of result.mc?.stops || []) { const [x, y] = V.toS(p); ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
    // 조준선
    const [bx, by] = V.toS(ball), [ax, ay] = V.toS(result.aimPoint);
    ctx.setLineDash([sz, sz]); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = Math.max(1.5, W / 400);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ax, ay); ctx.stroke();
    // 퍼팅 라인
    ctx.setLineDash([sz * 0.4, sz * 1.2]); ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = Math.max(3, W / 140); ctx.lineCap = 'round';
    ctx.beginPath(); result.path.forEach(([x, y], i) => { const [sx, sy] = V.toS({ x, y }); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke();
    ctx.setLineDash([]); ctx.lineCap = 'butt';
    ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ax, ay, sz * 1.3, 0, 7); ctx.stroke();
    ctx.fillStyle = '#ffe27a'; ctx.font = `bold ${Math.round(W / 30)}px sans-serif`; ctx.fillText('조준점', ax + sz * 1.8, ay + 4);
  }
  // 홀·공
  const [hx, hy] = V.toS(hole);
  ctx.fillStyle = '#0a0a0a'; ctx.beginPath(); ctx.arc(hx, hy, Math.max(HOLE_R * V.s, sz * 0.9), 0, 7); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy - sz * 6); ctx.stroke();
  ctx.fillStyle = '#e84c3d'; ctx.beginPath(); ctx.moveTo(hx, hy - sz * 6); ctx.lineTo(hx + sz * 3, hy - sz * 5); ctx.lineTo(hx, hy - sz * 4); ctx.fill();
  const [bx, by] = V.toS(ball);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, Math.max(sz * 0.8, 4), 0, 7); ctx.fill();
  // 범례
  ctx.font = `${Math.round(W / 36)}px sans-serif`; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(8, H - W / 14 - 8, W - 16, W / 14);
  const lw = (W - 40) / 5;
  ['0%', '1%', '2%', '3%', '4%+'].forEach((t, i) => { ctx.fillStyle = slopeColor(i); ctx.fillRect(16 + i * lw, H - W / 14, lw * 0.3, W / 28); ctx.fillStyle = '#fff'; ctx.fillText(t, 16 + i * lw + lw * 0.36, H - W / 14 + W / 34); });
  if (stimpNote) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(stimpNote, 12, W / 24 + 6); }
  return V;
}
