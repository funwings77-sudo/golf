// 카메라 + 단안 지면 투영 (AR-lite) + 근접 공 탐지(컴퓨터 비전)
//  지면 투영: 카메라 높이 h, 광축의 하향각(피치) p, 세로 화각 → 화면 좌표 ↔ 지면 좌표
import { Sensors } from './sensors.js';

export async function openCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true;
  await video.play();
  return () => stream.getTracks().forEach(t => t.stop());
}

// video(object-fit: cover)의 표시 변환
export function coverTransform(video, el) {
  const vw = video.videoWidth || 1, vh = video.videoHeight || 1, cw = el.clientWidth, ch = el.clientHeight;
  const s = Math.max(cw / vw, ch / vh);
  return { s, ox: (cw - vw * s) / 2, oy: (ch - vh * s) / 2, vw, vh, cw, ch };
}

// 🔍 카메라 화면 확대 (1×~4×): 영상을 가운데 기준으로 키우고, 위에 그리는 선·눌러 재기도 같은 배율로 맞춤
//   zoomed(t, z): coverTransform 결과를 확대 배율만큼 바꿈 → 초점거리(f = focalPx·t.s)와 화면 위치가 함께 맞음
//   attachZoom(target, video, btn): 두 손가락 벌리기·오므리기 + 버튼(1× → 2× → 3× → 1×) · 배율은 기억
export function zoomed(t, z) {
  if (!z || z <= 1.001) return t;
  const cx = t.ox + t.vw * t.s / 2, cy = t.oy + t.vh * t.s / 2;
  return { ...t, s: t.s * z, ox: cx - (cx - t.ox) * z, oy: cy - (cy - t.oy) * z };
}
export function attachZoom(target, video, btn, key = 'pinpoint.camZoom') {
  let z = 1; try { z = Math.min(4, Math.max(1, +localStorage.getItem(key) || 1)); } catch {}
  const apply = (v, keep = true) => {
    z = Math.min(4, Math.max(1, Math.round(v * 10) / 10));
    video.style.transform = z > 1 ? `scale(${z})` : ''; video.style.transformOrigin = 'center center';
    if (btn) { btn.textContent = `${z % 1 ? z.toFixed(1) : z}×`; btn.classList.toggle('on', z > 1); btn.setAttribute('aria-label', `화면 확대 ${z}배 (누르면 바꿔요)`); }
    if (keep) try { localStorage.setItem(key, String(z)); } catch {}
  };
  apply(z, false);
  if (btn) btn.onclick = e => { e.stopPropagation(); apply(z < 1.95 ? 2 : z < 2.95 ? 3 : 1); };
  // 두 손가락: 벌리면 확대 · 오므리면 축소 (한 손가락 누르기는 그대로 '눌러 재기')
  const pts = new Map(); let d0 = 0, z0 = 1, pinched = false;
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  target.addEventListener('pointerdown', e => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { d0 = dist(); z0 = z; pinched = true; } });
  target.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2 && d0 > 20) apply(z0 * dist() / d0); });
  const up = e => { pts.delete(e.pointerId); if (!pts.size) setTimeout(() => { pinched = false; }, 50); };
  target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  // 벌리기 직후 손가락을 뗄 때 '눌러 재기'로 잘못 처리되지 않게
  target.addEventListener('click', e => { if (pinched) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  return { get z() { return z; }, set: v => apply(v) };
}

// 휴대폰을 세로로 들었을 때 beta=90 이 수평. 아래로 기울이면 beta 감소 → 하향각 = 90 - beta
export function cameraPitchDeg() { return Sensors.beta == null ? null : 90 - Sensors.beta; }

export class GroundProjector {
  constructor({ height = 1.45, vfovDeg = 63, pitchDeg = 20, yawDeg = 0 } = {}) { Object.assign(this, { height, vfovDeg, pitchDeg, yawDeg }); }
  focal(vh) { return (vh / 2) / Math.tan(this.vfovDeg * Math.PI / 360); }
  // 지면점 (x: 오른쪽, y: 앞, z: 내 발 기준 높이) → 비디오 픽셀
  toImage(x, y, vw, vh, z = 0) {
    const f = this.focal(vh), p = this.pitchDeg * Math.PI / 180, yw = this.yawDeg * Math.PI / 180, H = this.height - z;
    const X = x * Math.cos(yw) - y * Math.sin(yw), Y = x * Math.sin(yw) + y * Math.cos(yw); // 요 보정
    const cz = Y * Math.cos(p) + H * Math.sin(p);      // 광축 방향 깊이
    const cy = -Y * Math.sin(p) + H * Math.cos(p);     // 아래쪽(+)
    if (cz <= 0.05) return null;
    return { u: vw / 2 + f * X / cz, v: vh / 2 + f * cy / cz, depth: cz };
  }
  // 비디오 픽셀 → 지면점
  toGround(u, v, vw, vh) {
    const f = this.focal(vh), p = this.pitchDeg * Math.PI / 180;
    const a = (v - vh / 2) / f, b = (u - vw / 2) / f; // 정규화 좌표
    const den = Math.sin(p) + a * Math.cos(p);
    if (den <= 1e-4) return null; // 수평선 위
    const t = this.height / den;
    const Y = t * (Math.cos(p) - a * Math.sin(p)), X = t * b;
    const yw = -this.yawDeg * Math.PI / 180;
    return { x: X * Math.cos(yw) - Y * Math.sin(yw), y: X * Math.sin(yw) + Y * Math.cos(yw), dist: Math.hypot(X, Y) };
  }
  // 알려진 거리 D의 점을 화면 (u,v)에서 탭 → 피치·요를 역산 (1탭 보정)
  calibrateFromTap(u, v, D, vw, vh) {
    const f = this.focal(vh);
    const a = Math.atan((v - vh / 2) / f);                 // 광축 대비 아래 각
    const dep = Math.atan2(this.height, D);                // 목표점 하향각
    this.pitchDeg = (dep - a) * 180 / Math.PI;
    this.yawDeg = -Math.atan((u - vw / 2) / f) * 180 / Math.PI; // 목표가 화면 오른쪽 → 카메라가 왼쪽을 향함
    return this;
  }
}

// ---------- 근접 공 탐지 ----------
// 흰 공 = 밝고 채도가 낮은 작은 원형 덩어리 + 주변보다 확연히 밝음. 여러 프레임 연속 검출만 확정
export class BallDetector {
  constructor({ width = 320 } = {}) {
    this.W = width; this.cv = document.createElement('canvas'); this.ctx = this.cv.getContext('2d', { willReadFrequently: true });
    this.tracks = []; this.nextId = 1;
  }
  detect(video, projector = null) {
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return [];
    const W = this.W, H = Math.round(W * vh / vw), sc = vw / W;
    this.cv.width = W; this.cv.height = H;
    this.ctx.drawImage(video, 0, 0, W, H);
    const d = this.ctx.getImageData(0, 0, W, H).data;
    const N = W * H, val = new Uint8Array(N), mask = new Uint8Array(N);
    const hist = new Uint32Array(256);
    for (let i = 0, k = 0; i < N; i++, k += 4) { const mx = Math.max(d[k], d[k + 1], d[k + 2]); val[i] = mx; hist[mx]++; }
    // 상위 1.5% 밝기를 적응 임계값으로 (최소 165)
    let acc = 0, thr = 255; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > N * 0.015) { thr = v; break; } }
    thr = Math.max(165, thr);
    for (let i = 0, k = 0; i < N; i++, k += 4) {
      const mx = val[i]; if (mx < thr) continue;
      const mn = Math.min(d[k], d[k + 1], d[k + 2]);
      if ((mx - mn) / mx < 0.22) mask[i] = 1;
    }
    const lab = new Int32Array(N), cands = []; let L = 0; const st = [];
    for (let i = 0; i < N; i++) {
      if (!mask[i] || lab[i]) continue;
      L++; st.push(i); lab[i] = L;
      let area = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, sv = 0;
      while (st.length) {
        const j = st.pop(), x = j % W, y = (j / W) | 0;
        area++; sx += x; sy += y; sv += val[j];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (area > 1500) continue;
        for (const n of [j - 1, j + 1, j - W, j + W]) {
          if (n < 0 || n >= N || lab[n] || !mask[n]) continue;
          if ((n === j - 1 && x === 0) || (n === j + 1 && x === W - 1)) continue;
          lab[n] = L; st.push(n);
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (area < 3 || area > 900) continue;
      const aspect = bw / bh, fill = area / (bw * bh);
      if (aspect < 0.55 || aspect > 1.8 || fill < 0.5) continue;
      // 주변 고리 밝기
      const pad = Math.max(2, Math.round(Math.max(bw, bh) * 0.8));
      let rs = 0, rn = 0;
      for (let y = Math.max(0, y0 - pad); y <= Math.min(H - 1, y1 + pad); y += 1) for (let x = Math.max(0, x0 - pad); x <= Math.min(W - 1, x1 + pad); x += 1) {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
        rs += val[y * W + x]; rn++;
      }
      const ring = rn ? rs / rn : 255, mean = sv / area, contrast = mean - ring;
      if (contrast < 45) continue;
      const cx = (sx / area) * sc, cy = (sy / area) * sc, r = Math.max(bw, bh) * sc / 2;
      let dist = null, sizeOk = true;
      if (projector) {
        const g = projector.toGround(cx, cy, vw, vh);
        if (g) {
          dist = g.dist;
          const expR = projector.focal(vh) * 0.02135 / Math.hypot(g.dist, projector.height);
          sizeOk = r / expR > 0.33 && r / expR < 3.5;
        }
      }
      if (!sizeOk) continue;
      cands.push({ x: cx, y: cy, r, score: fill * Math.min(1, contrast / 100), dist });
    }
    // 추적: 최근접 매칭, 3프레임 이상 연속이면 확정
    const R = 14 * sc;
    for (const t of this.tracks) t.seen = false;
    for (const c of cands.sort((a, b) => b.score - a.score).slice(0, 12)) {
      let best = null, bd = R;
      for (const t of this.tracks) { const dd = Math.hypot(t.x - c.x, t.y - c.y); if (!t.seen && dd < bd) { bd = dd; best = t; } }
      if (best) { Object.assign(best, { x: best.x * 0.4 + c.x * 0.6, y: best.y * 0.4 + c.y * 0.6, r: c.r, dist: c.dist, score: c.score }); best.hits++; best.miss = 0; best.seen = true; }
      else this.tracks.push({ id: this.nextId++, ...c, hits: 1, miss: 0, seen: true });
    }
    for (const t of this.tracks) if (!t.seen) t.miss++;
    this.tracks = this.tracks.filter(t => t.miss < 4);
    return this.tracks.filter(t => t.hits >= 3).sort((a, b) => b.hits * b.score - a.hits * a.score).slice(0, 3);
  }
}
