// 3D 그린 매핑: 높이 색(낮음 파랑 → 높음 빨강) · 물 흐름(내리막) 화살표 · 높이 과장 · 끌어서 돌리기
// surf: { height(x,y), grad(x,y) } (로컬 m), bounds: {x0,y0,x1,y1}, inside(p): 그린 안인지

const RAMP = [[0, [40, 70, 200]], [0.2, [40, 160, 230]], [0.4, [60, 200, 150]], [0.6, [150, 215, 70]], [0.8, [245, 190, 50]], [1, [225, 60, 40]]];
export function heightColor(t, shade = 1) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RAMP.length; i++) if (t <= RAMP[i][0]) {
    const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i], k = (t - t0) / (t1 - t0);
    return `rgb(${c0.map((v, j) => Math.round((v + (c1[j] - v) * k) * shade)).join(',')})`;
  }
  return `rgb(${RAMP.at(-1)[1].map(v => Math.round(v * shade)).join(',')})`;
}

// 그린 모양: 측량 범위 안의 타원 (실제 외곽선이 있으면 inside로 대체)
export function ovalInside(b, margin = 0.04) {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2 * (1 - margin), ry = (b.y1 - b.y0) / 2 * (1 - margin);
  return p => ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1;
}

export function drawGreen3D(cv, surf, { bounds: b, inside, ball = null, hole = null, ex = 5, yaw = 0, tilt = 55, n = 84 }) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const dx = (b.x1 - b.x0) / n, dy = (b.y1 - b.y0) / n;
  // 높이 샘플
  const N = n + 1, hs = new Float64Array(N * N), ok = new Uint8Array(N * N);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p = { x: b.x0 + i * dx, y: b.y0 + j * dy };
    if (!inside(p)) continue;
    const h = surf.height(p.x, p.y); hs[j * N + i] = h; ok[j * N + i] = 1; if (h < lo) lo = h; if (h > hi) hi = h;
  }
  if (!isFinite(lo)) return null;
  const range = Math.max(hi - lo, 0.01), base = -span * 0.025; // 옆면(흙) 두께
  const ya = yaw * Math.PI / 180, ph = tilt * Math.PI / 180, cs = Math.cos(ya), sn = Math.sin(ya);
  const s = Math.min(W / (span * 1.15), H / (span * (Math.cos(ph) + 0.25) * 1.15 + 1e-9));
  const ox = W / 2, oy = H * 0.52;
  // 월드(x,y,높이) → 화면. z는 과장된 높이(m)
  const rot = (x, y) => { const u = x - cx, v = y - cy; return [u * cs - v * sn, u * sn + v * cs]; };
  const P = (x, y, z) => { const [u, v] = rot(x, y); return [ox + u * s, oy - (v * Math.cos(ph) + z * Math.sin(ph)) * s]; };
  const Z = h => (h - lo) * ex;
  const pt = (i, j, z) => P(b.x0 + i * dx, b.y0 + j * dy, z ?? Z(hs[j * N + i]));
  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(ox, oy + span * 0.06 * s, span * 0.52 * s, span * 0.52 * s * Math.cos(ph) * 0.9, 0, 0, Math.PI * 2); ctx.fill();
  // 칸 정렬: 화면 뒤(먼 쪽)부터
  const cells = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * N + i; if (!(ok[k] && ok[k + 1] && ok[k + N] && ok[k + N + 1])) continue;
    cells.push([i, j, rot(b.x0 + (i + 0.5) * dx, b.y0 + (j + 0.5) * dy)[1]]);
  }
  cells.sort((a, c) => c[2] - a[2]);
  const has = (i, j) => i >= 0 && j >= 0 && i < n && j < n && ok[j * N + i] && ok[j * N + i + 1] && ok[(j + 1) * N + i] && ok[(j + 1) * N + i + 1];
  const L = [-0.45, 0.55, 0.7], Ln = Math.hypot(...L);
  for (const [i, j] of cells) {
    // 바깥 가장자리: 옆면
    const edges = [[[i, j], [i + 1, j], !has(i, j - 1)], [[i + 1, j], [i + 1, j + 1], !has(i + 1, j)], [[i + 1, j + 1], [i, j + 1], !has(i, j + 1)], [[i, j + 1], [i, j], !has(i - 1, j)]];
    for (const [a, c, open] of edges) {
      if (!open) continue;
      const a1 = pt(a[0], a[1]), c1 = pt(c[0], c[1]), a0 = pt(a[0], a[1], base), c0 = pt(c[0], c[1], base);
      ctx.fillStyle = '#7d7466'; ctx.strokeStyle = '#6b6357'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(...a1); ctx.lineTo(...c1); ctx.lineTo(...c0); ctx.lineTo(...a0); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    const k = j * N + i, h00 = hs[k], h10 = hs[k + 1], h01 = hs[k + N], h11 = hs[k + N + 1];
    // 음영: 과장된 면의 법선과 빛
    const gx = ((h10 - h00) + (h11 - h01)) / 2 / dx * ex, gy = ((h01 - h00) + (h11 - h10)) / 2 / dy * ex;
    const nrm = [-gx, -gy, 1], nl = Math.hypot(...nrm), lam = Math.max(0, (nrm[0] * L[0] + nrm[1] * L[1] + nrm[2] * L[2]) / (nl * Ln));
    const t = ((h00 + h10 + h01 + h11) / 4 - lo) / range;
    ctx.fillStyle = heightColor(t, 0.72 + 0.38 * lam);
    const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
    ctx.beginPath(); ctx.moveTo(...q[0]); q.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke();
  }
  // 내리막 화살표 (공이 흘러가는 방향) — 경사 크기에 비례
  const step = Math.max(1.2, span / 14), aw = Math.max(1.2, W / 420);
  ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = aw; ctx.lineCap = 'round';
  for (let y = b.y0 + step / 2; y < b.y1; y += step) for (let x = b.x0 + step / 2; x < b.x1; x += step) {
    if (!inside({ x, y })) continue;
    const g = surf.grad(x, y), m = Math.hypot(g[0], g[1]); if (m < 0.003) continue;
    const len = step * Math.min(0.8, 0.35 + m * 12), ux = -g[0] / m, uy = -g[1] / m;
    const x1 = x - ux * len / 2, y1 = y - uy * len / 2, x2 = x + ux * len / 2, y2 = y + uy * len / 2;
    if (!inside({ x: x2, y: y2 }) || !inside({ x: x1, y: y1 })) continue;
    const A = P(x1, y1, Z(surf.height(x1, y1)) + 0.02), B = P(x2, y2, Z(surf.height(x2, y2)) + 0.02);
    const an = Math.atan2(B[1] - A[1], B[0] - A[0]), hd = Math.max(4, aw * 3.2);
    ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...B); ctx.lineTo(B[0] - hd * Math.cos(an - 0.5), B[1] - hd * Math.sin(an - 0.5)); ctx.lineTo(B[0] - hd * Math.cos(an + 0.5), B[1] - hd * Math.sin(an + 0.5)); ctx.closePath(); ctx.fill();
  }
  // 공 · 홀(깃발)
  const mark = (p, kind) => {
    if (!p || !inside(p)) return;
    const [X, Y] = P(p.x, p.y, Z(surf.height(p.x, p.y)));
    if (kind === 'hole') {
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(X, Y, 6, 6 * Math.cos(ph) + 1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, Y - 46); ctx.stroke();
      ctx.fillStyle = '#ff4d3d'; ctx.beginPath(); ctx.moveTo(X, Y - 46); ctx.lineTo(X + 22, Y - 39); ctx.lineTo(X, Y - 32); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X, Y - 5, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  };
  if (ball && hole && inside(ball) && inside(hole)) { // 공 → 홀 점선
    ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2; ctx.beginPath();
    for (let t = 0; t <= 1.0001; t += 0.05) { const x = ball.x + (hole.x - ball.x) * t, y = ball.y + (hole.y - ball.y) * t, q = P(x, y, Z(surf.height(x, y)) + 0.03); t ? ctx.lineTo(...q) : ctx.moveTo(...q); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  mark(hole, 'hole'); mark(ball, 'ball');
  return { lo, hi, range };
}

// 상호작용 붙이기: 끌어서 돌리기(좌우)·기울이기(상하), 높이 과장 단계
export function mountGreen3D(wrap, getData) {
  wrap.innerHTML = `<div class="g3-box"><canvas class="g3" width="900" height="900"></canvas>
    <div class="g3-legend"><span>높음</span><i></i><span>낮음</span></div>
    <div class="g3-ex">${[3, 5, 10].map(v => `<button data-ex="${v}">${v}×</button>`).join('')}</div>
    <p class="g3-note"></p></div>`;
  const cv = wrap.querySelector('canvas'), note = wrap.querySelector('.g3-note');
  const d0 = getData(), st = { yaw: d0?.yaw0 ?? 0, tilt: 55, ex: 5 };
  const draw = () => {
    const d = getData(); if (!d) return;
    const r = drawGreen3D(cv, d.surf, { ...d, ex: st.ex, yaw: st.yaw, tilt: st.tilt });
    wrap.querySelectorAll('[data-ex]').forEach(b => b.classList.toggle('on', +b.dataset.ex === st.ex));
    note.textContent = r ? `높이를 ${st.ex}배로 키워서 보여줘요 · 가장 높은 곳과 낮은 곳 차이 ${(r.range * 100).toFixed(0)}cm · 흰 화살표 = 공이 흘러가는 쪽 · 끌어서 돌려 보세요` : '그린 높이 자료가 없어요';
  };
  wrap.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { st.ex = +b.dataset.ex; draw(); });
  let drag = null;
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: st.yaw, tilt: st.tilt }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    st.yaw = drag.yaw + (e.clientX - drag.x) * 0.5;
    st.tilt = Math.max(20, Math.min(80, drag.tilt - (e.clientY - drag.y) * 0.3));
    draw();
  });
  cv.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('pointercancel', () => { drag = null; });
  draw();
  return { draw, state: st };
}
