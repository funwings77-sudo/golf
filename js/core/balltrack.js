// 🎥 날아가는 공 따라가기: 카메라 영상에서 움직이는 작은 점(공)을 찾아 '보이는 각도'를 모으고,
//  탄도 모델(중력·공기 저항·스핀·바람)에 맞춰 공 속도·발사각·좌우 방향·최고 높이·비행 시간·착지 거리를 계산
//  휴대폰 카메라는 공까지 거리를 못 재지만, 시간에 따라 각도가 바뀌는 모양이 공 속도·발사각마다 달라서 물리로 풀 수 있음
//   · 관측: { t: 초(첫 관측 기준), az: 조준 방향 기준 좌우 각(°, 오른쪽 +), el: 올려다보는 각(°) } — 친 자리(≈ 내 자리)에서 본 각도
//   · 미지수: 공 속도 v · 발사각 L · 좌우 S · 스핀 배율 k · 시간 어긋남 τ(누른 시각과 친 시각 차이)
//  🚓 교통 단속 카메라 원리 적용: 흔들림 보정(MTI) · CFAR 문턱 · 칼만 추적+M-of-N 확정 · 회귀 잔차 검사/무효 처리
//     · 센서 교차 검증(소리↔영상) · 설치 기하 보정(눈높이·선 위치) · 프레임 촬영 시각 동기
import { simulateFlight, clubType, RHO_STD, speedForCarry } from '../physics/flight.js';
import { destination } from './geo.js';

const DEG = 180 / Math.PI;

// ---------- 모델: 주어진 값으로 날려서 시간마다 보이는 각도 ----------
//  obsAt: 찍는 사람(카메라) 위치 — 친 곳 기준 조준 좌표계 {x: 오른쪽, y: 앞, z: 위} m
//   단속 카메라가 '설치 각도·높이'를 측량해 1/cosθ 보정을 하듯, 눈높이·뒤로 물러선 거리만큼 보이는 각을 바로잡음
export function flightModel({ v, L, S, k = 1, club = '7i', wind = null, rho = RHO_STD, aim = 0, obsAt = null }) {
  const ct = clubType(club) || clubType('7i');
  let w = { x: 0, y: 0 };
  if (wind?.windSpeed) { const to = (wind.windFrom + 180 - aim) * Math.PI / 180; w = { x: wind.windSpeed * Math.sin(to), y: wind.windSpeed * Math.cos(to) }; }
  const f = simulateFlight({ speed: v, launchDeg: L, spinRpm: ct.spin * k, azimuthDeg: S, wind: w, rho, dt: 0.02, record: true });
  const path = f.path.map(([x, y, z], i) => ({ t: i * 0.02, x, y, z }));
  const at = t => {
    if (t <= 0) return { x: 0, y: 0, z: 0 };
    const i = Math.min(path.length - 1, Math.floor(t / 0.02)), a = path[i], b = path[Math.min(path.length - 1, i + 1)], u = Math.min(1, (t - a.t) / 0.02);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
  };
  const o = obsAt || { x: 0, y: 0, z: 0 };
  const angle = t => { const p = at(t), dx = p.x - o.x, dy = p.y - o.y, h = Math.hypot(dx, dy) || 1e-6; return { az: Math.atan2(dx, dy) * DEG, el: Math.atan2(p.z - o.z, h) * DEG }; };
  return { f, ct, path, at, angle };
}

const OUT = prm => prm.v < 15 || prm.v > 90 || prm.L < 2 || prm.L > 45 || Math.abs(prm.S) > 25 || prm.k < 0.5 || prm.k > 1.6 || prm.tau < 0 || prm.tau > 9;
// 관측마다 각도 잔차(°) · 공이 이미 떨어진 뒤의 관측 = 5°
function residuals(obs, prm, base) {
  const m = flightModel({ ...base, ...prm });
  return obs.map(o => { const t = o.t + prm.tau; if (t > m.f.time) return 5; const a = m.angle(t); return Math.hypot(a.az - o.az, a.el - o.el); });
}
const angMS = (obs, prm, base) => { const r = residuals(obs, prm, base); return r.reduce((s, x) => s + x * x, 0) / r.length; };

// 오차: 관측 각과 모델 각의 차이 제곱 평균 (°²) + 사전 정보
function cost(obs, prm, base) {
  if (OUT(prm)) return 1e9;
  let e = angMS(obs, prm, base);
  // 🔀 내 클럽 거리(사전 정보)와 합침: 카메라가 짧게 봤을 때 속도·친 시각이 서로 바뀌어도 맞아 보이는 걸 잡아 줌
  //   (오래 보면 카메라 각도가 훨씬 강하게 이김)
  // 친 시각을 알면(🎤 마이크 '딱' 소리 · ⌚ 워치/휴대폰 스윙) 시간 어긋남 τ를 거의 고정 → 속도·거리가 하나로 정해짐
  if (base.tau0 != null) e += 0.05 * ((prm.tau - base.tau0) / (base.tauSd || 0.05)) ** 2;
  if (base.fixTau != null) e += 50 * (prm.tau - base.fixTau) ** 2;
  if (base.v0) e += 0.001 * ((prm.v - base.v0) / (0.25 * base.v0)) ** 2 + 0.002 * ((prm.L - (base.L0 ?? prm.L)) / 5) ** 2; // 내 클럽 거리: 같을 때만 고르는 약한 정보
  return e;
}

// Nelder–Mead (간단 · 변수 5개)
function nelderMead(fn, x0, step, iters = 260) {
  const n = x0.length; let pts = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[j] : v)))].map(x => ({ x, f: fn(x) }));
  for (let it = 0; it < iters; it++) {
    pts.sort((a, b) => a.f - b.f);
    const c = Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i].x[j] / n;
    const w = pts[n], ref = c.map((v, j) => v + (v - w.x[j])), fr = fn(ref);
    if (fr < pts[0].f) { const ex = c.map((v, j) => v + 2 * (v - w.x[j])), fe = fn(ex); pts[n] = fe < fr ? { x: ex, f: fe } : { x: ref, f: fr }; }
    else if (fr < pts[n - 1].f) pts[n] = { x: ref, f: fr };
    else { const co = c.map((v, j) => v + 0.5 * (w.x[j] - v)), fc = fn(co); if (fc < w.f) pts[n] = { x: co, f: fc }; else pts = pts.map((p, i) => (i === 0 ? p : (q => ({ x: q, f: fn(q) }))(p.x.map((v, j) => pts[0].x[j] + 0.5 * (v - pts[0].x[j]))))); }
    if (Math.abs(pts[n].f - pts[0].f) < 1e-6) break;
  }
  pts.sort((a, b) => a.f - b.f); return pts[0];
}
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const toP = x => ({ v: x[0], L: x[1], S: x[2], k: x[3], tau: x[4] });

// 🚓 측정 유효성 기준 (레이저 단속기: 잔차·샘플 수·가속도가 이상하면 측정 전체를 버림)
export const VALID = { minN: 6, minSpan: 0.4, maxRms: 0.9, maxReject: 0.25 };

// 관측 → 맞춘 비행 (obs ≥ 6개, 0.4초 이상)
//  base: { club, wind, rho, aim(조준 방위°), from(친 곳 위경도), guessCarry(클럽 거리), obsAt(찍는 사람 위치), tau0·tauSd(친 시각) }
//  단속 카메라 방식 그대로:
//   ① 회귀: 측정 창 전체 샘플을 한 번에 물리 모델에 맞춤 (한두 점이 아니라)
//   ② 잔차 검사: 모델에서 크게 벗어난 점(새·나뭇잎·잔상 = '스윕·다중 표적')은 버리고 다시 맞춤
//   ③ 교차 검증: 친 시각은 🎤 소리 ↔ ⌚ 스윙 두 센서가 맞을 때만 확정 (fuseHitTime · 루프+영상 이중 판정)
//   ④ 무효 처리: 버린 점이 많거나 잔차가 크거나 물리 범위 끝에 붙으면 valid:false (결과를 쓰지 않음)
export function fitTrajectory(obs0, base) {
  if (!obs0 || obs0.length < VALID.minN || obs0.at(-1).t - obs0[0].t < VALID.minSpan) return null;
  const ct = clubType(base.club) || clubType('7i');
  if (base.guessCarry && !base.v0) base = { ...base, v0: speedForCarry(ct, base.guessCarry), L0: ct.launch };
  // ① 여러 출발점에서 (공 속도·처음 본 시각이 넓게 다를 수 있어서)
  const solve = (obs, b) => {
    let best = null;
    const taus = b.tau0 != null ? [b.tau0] : [0.1, 0.8, 2];
    for (const v0 of [35, 50, 65]) for (const tau0 of taus) {
      const r = nelderMead(x => cost(obs, toP(x), b), [v0, ct.launch, obs[0].az * 0.8, 1, tau0], [8, 4, 3, 0.2, 0.5]);
      if (!best || r.f < best.f) best = r;
    }
    return best;
  };
  const refine = (obs, b, x) => nelderMead(z => cost(obs, toP(z), b), x, [3, 2, 1, 0.1, 0.15], 200);
  let obs = obs0, best = solve(obs, base);
  // ② 잔차 검사 → 이상 샘플 버리고 다시 (2번까지)
  let rejected = 0;
  for (let pass = 0; pass < 2; pass++) {
    const res = residuals(obs, toP(best.x), base), sig = median(res) / 1.1774; // 2차원 잔차 중앙값 → 축당 σ
    const cut = Math.max(0.5, 3.72 * sig); // χ²(2) 99.9%
    const keep = obs.filter((_, i) => res[i] <= cut);
    if (keep.length === obs.length) break;
    rejected += obs.length - keep.length; obs = keep;
    if (obs.length < VALID.minN) break;
    best = refine(obs, base, best.x);
  }
  // ③ 친 시각은 영상만으로는 검증이 안 됨 (친 곳에서 보면 '빠른 공을 늦게 봄'과 '느린 공을 일찍 봄'이 각도가 거의 같음)
  //    → 친 시각 교차 검증은 서로 독립인 센서끼리(🎤 소리 ↔ ⌚ 스윙): fuseHitTime
  const timingConflict = !!base.timingConflict;
  const p = toP(best.x), m = flightModel({ ...base, ...p }), f = m.f, rms = Math.sqrt(angMS(obs, p, base));
  // 오차: 각도 잔차·관측 길이 + (친 시각을 모르면) 친 시각을 바꿔 가며 똑같이 잘 맞는 비행들의 거리 범위
  const span = obs.length ? obs.at(-1).t - obs[0].t : 0;
  let sd = f.carry * (0.012 + 0.02 * rms + 0.03 / Math.max(0.3, span)), lo = f.carry, hi = f.carry;
  if (base.tau0 == null) {
    for (const ft of [0, 0.3, 0.6, 1, 1.5, 2.2, 3]) {
      const r = nelderMead(x => cost(obs, toP(x), { ...base, fixTau: ft }), [p.v, p.L, p.S, p.k, ft], [6, 3, 2, 0.15, 0.05], 160);
      if (r.f > best.f * 1.12 + 0.004) continue;
      const c = flightModel({ ...base, ...toP(r.x) }).f.carry; lo = Math.min(lo, c); hi = Math.max(hi, c);
    }
    sd = Math.max(sd, (hi - lo) / 2);
  }
  // ④ 유효성
  let reason = null;
  const edge = p.v < 15.5 || p.v > 89.5 || p.L < 2.3 || p.L > 44.7 || Math.abs(p.S) > 24.7 || p.tau > 8.8;
  if (obs.length < VALID.minN || span < VALID.minSpan) reason = '쓸 수 있는 점이 너무 적어요';
  else if (rejected > VALID.maxReject * obs0.length) reason = `엉뚱한 점이 많아요 (${rejected}/${obs0.length})`;
  else if (rms > VALID.maxRms) reason = `공 비행과 안 맞아요 (잔차 ${rms.toFixed(2)}°)`;
  else if (edge) reason = '공 비행으로 볼 수 없는 움직임이에요';
  const rollM = f.carry * (ct.roll ?? 0.03), side = Math.atan2(f.x, f.y) * DEG;
  const out = {
    v: p.v, kmh: p.v * 3.6, launch: p.L, side: p.S, spinRpm: ct.spin * p.k, tau: p.tau,
    carry: f.carry, total: f.carry + rollM, apex: f.apex, time: f.time, landAngle: f.landAngle, lateral: f.x, sideDeg: side,
    rms, sd, lo, hi, n: obs.length, n0: obs0.length, rejected, span, timed: base.tau0 != null, timingConflict,
    valid: !reason, reason,
  };
  if (base.from) {
    const land = destination(destination(base.from, base.aim, f.y), base.aim + 90, f.x);
    out.landing = land; out.rest = destination(land, base.aim + side, rollM);
    out.path = m.path.filter((_, i) => i % 3 === 0).map(q => ({ ...destination(destination(base.from, base.aim, q.y), base.aim + 90, q.x), h: q.z, t: q.t }));
  }
  return out;
}

// ---------- ⏱️ 친 시각 이중 판정 (단속기: 루프 신호와 영상 궤적이 모두 맞을 때만 확정) ----------
//  mic: 🎤 '딱' 소리 시각(ms, ±30ms) · swing: ⌚ 워치/휴대폰 스윙 시각(ms, ±120ms)
//   · 둘 다 있고 0.25초 안에서 맞음 → 정확도로 가중 평균 (더 정확해짐)
//   · 둘 다 있는데 어긋남 → 어느 쪽도 믿지 않음 (옆 사람 샷 소리일 수 있음) → 친 시각 모름으로 범위를 정직하게
//   · 하나만 → 그것
export const HIT_SD = { mic: 0.03, swing: 0.12 };
export function fuseHitTime(mic, swing, agree = 250) {
  if (mic != null && swing != null) {
    if (Math.abs(mic - swing) > agree) return { t: null, conflict: true, src: null };
    const wm = 1 / HIT_SD.mic ** 2, ws = 1 / HIT_SD.swing ** 2;
    return { t: (mic * wm + swing * ws) / (wm + ws), sd: 1 / Math.sqrt(wm + ws), src: 'both', conflict: false };
  }
  if (mic != null) return { t: mic, sd: HIT_SD.mic, src: 'mic', conflict: false };
  if (swing != null) return { t: swing, sd: HIT_SD.swing, src: 'swing', conflict: false };
  return { t: null, conflict: false, src: null };
}

// ---------- 영상에서 움직이는 작은 점 찾기 (하늘·나무 앞을 지나는 공) ----------
//  ① 흔들림 보정 (레이더 MTI처럼 '배경'을 지움): 앞 프레임을 통째로 몇 픽셀 밀어 가장 잘 겹치는 곳을 찾음
//  ② 3장 차이: 지금-1장 전, 지금-2장 전 둘 다 바뀐 곳만 → 공이 '있던 자리' 잔상은 사라지고 '지금 자리'만 남음
//  ③ CFAR(일정 오경보율): 문턱 = 주변 칸(자기 칸은 빼고)의 잡음 평균 + 5σ → 흔들리는 나뭇잎 쪽은 문턱이 저절로 높아짐
//  ④ 작은 덩어리만 · 차이 크기로 가중한 중심(픽셀 아래까지)
export function estimateShift(g, prev, W, H, maxShift = 6, step = 4) {
  const m = maxShift;
  const sadAt = (dx, dy) => {
    let s = 0, n = 0;
    for (let y = m; y < H - m; y += step) for (let x = m, i = y * W + m, j = (y + dy) * W + m + dx; x < W - m; x += step, i += step, j += step) { s += Math.abs(g[i] - prev[j]); n++; }
    return n ? s / n : 0;
  };
  const base = sadAt(0, 0); let best = base, sx = 0, sy = 0;
  for (let dy = -m; dy <= m; dy++) for (let dx = -m; dx <= m; dx++) {
    if (!dx && !dy) continue;
    const s = sadAt(dx, dy); if (s < best) { best = s; sx = dx; sy = dy; }
  }
  if (base - best < 0.3) return { dx: 0, dy: 0, sad: base }; // 무늬 없는 하늘: 안 움직였다고 봄
  return { dx: sx, dy: sy, sad: best };
}
//  g·p1·p2: 밝기(0~255) 지금·1장 전·2장 전 (W×H) · s1·s2: g의 (x,y)가 p1·p2의 (x+dx, y+dy)에 해당
export function spotMoving(g, p1, W, H, { p2 = null, s1 = { dx: 0, dy: 0 }, s2 = { dx: 0, dy: 0 }, floor = 20, k = 5, tile = 16, maxArea = 60, maxSide = 14 } = {}) {
  const N = W * H, diff = new Uint8Array(N);
  const dAt = (p, s, x, y, v) => { const X = x + s.dx, Y = y + s.dy; return X < 0 || Y < 0 || X >= W || Y >= H ? 0 : Math.abs(v - p[Y * W + X]); };
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
    const v = g[i], a = dAt(p1, s1, x, y, v);
    diff[i] = p2 ? Math.min(a, dAt(p2, s2, x, y, v)) : a;
  }
  // 칸별 잡음 통계 → 칸마다 문턱 (주변 8칸 = 학습 칸, 자기 칸 = 보호 칸)
  const TW = Math.ceil(W / tile), TH = Math.ceil(H / tile), tS = new Float64Array(TW * TH), tS2 = new Float64Array(TW * TH), tN = new Uint32Array(TW * TH);
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) { const t = ((y / tile) | 0) * TW + ((x / tile) | 0), v = diff[i]; tS[t] += v; tS2[t] += v * v; tN[t]++; }
  const thr = new Float32Array(TW * TH);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    let s = 0, s2 = 0, n = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const X = tx + ox, Y = ty + oy; if (X < 0 || Y < 0 || X >= TW || Y >= TH) continue;
      const t = Y * TW + X; s += tS[t]; s2 += tS2[t]; n += tN[t];
    }
    if (!n) { const t = ty * TW + tx; s = tS[t]; s2 = tS2[t]; n = tN[t]; }
    const mu = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mu * mu));
    thr[ty * TW + tx] = Math.max(floor, mu + k * sd);
  }
  let on = 0; const mask = new Uint8Array(N);
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (diff[i] > thr[((y / tile) | 0) * TW + ((x / tile) | 0)]) { mask[i] = 1; on++; }
  if (on > N * 0.03) return []; // 보정으로도 안 되는 큰 흔들림
  const lab = new Uint8Array(N), out = [], st = [];
  for (let i = 0; i < N; i++) {
    if (!mask[i] || lab[i]) continue;
    lab[i] = 1; st.push(i); let area = 0, sw = 0, sx = 0, sy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
    while (st.length) {
      const j = st.pop(), x = j % W, y = (j / W) | 0, w = diff[j]; area++; sw += w; sx += x * w; sy += y * w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (area > 2 * maxArea) continue;
      for (const n of [j - 1, j + 1, j - W, j + W]) if (n >= 0 && n < N && mask[n] && !lab[n] && Math.abs((n % W) - x) <= 1) { lab[n] = 1; st.push(n); }
    }
    if (area > maxArea || x1 - x0 > maxSide || y1 - y0 > maxSide) continue;
    const cx = sx / sw, cy = sy / sw, th = thr[((cy / tile) | 0) * TW + ((cx / tile) | 0)] || floor;
    out.push({ x: cx + 0.5, y: cy + 0.5, area, score: sw / area, snr: sw / area / th });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

export class FlightSpotter {
  constructor({ width = 240 } = {}) { this.W = width; this.prev = null; this.prev2 = null; this.s1 = null; this.cv = null; this.shift = { dx: 0, dy: 0 }; }
  detect(video) {
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return [];
    const W = this.W, H = Math.round(W * vh / vw), sc = vw / W;
    if (!this.cv) { this.cv = document.createElement('canvas'); this.ctx = this.cv.getContext('2d', { willReadFrequently: true }); }
    this.cv.width = W; this.cv.height = H; this.ctx.drawImage(video, 0, 0, W, H);
    const d = this.ctx.getImageData(0, 0, W, H).data, N = W * H, g = new Uint8Array(N);
    for (let i = 0, k = 0; i < N; i++, k += 4) g[i] = (d[k] * 3 + d[k + 1] * 4 + d[k + 2]) >> 3;
    return this.step(g, W, H).map(c => ({ ...c, x: c.x * sc, y: c.y * sc }));
  }
  // 밝기 배열 한 장 → 후보 (축소 픽셀 좌표)
  step(g, W, H) {
    const p1 = this.prev?.length === g.length ? this.prev : null, p2 = p1 && this.prev2?.length === g.length ? this.prev2 : null;
    let out = [];
    if (p1) {
      const s1 = estimateShift(g, p1, W, H);
      // 2장 전에 대한 흔들림 = 이번 흔들림 + 지난번 흔들림 (누적)
      const s2 = p2 && this.s1 ? { dx: s1.dx + this.s1.dx, dy: s1.dy + this.s1.dy } : null;
      out = spotMoving(g, p1, W, H, { p2: s2 ? p2 : null, s1, s2: s2 || s1 });
      this.shift = s1; this.s1 = s1;
    } else this.s1 = null;
    this.prev2 = this.prev; this.prev = g;
    return out;
  }
}

// ---------- 각도 공간 추적: 칼만 필터 + M-of-N 확정 (단속 레이더의 다중 표적 추적) ----------
//  · 점 하나하나가 '후보 궤적'을 엶 → 예상 위치(칼만 예측) 근처 게이트(마할라노비스 거리, χ² 99%) 안의 점만 이어 붙임
//  · 0.25초 안에 3번 이어지면 '확정' (정지선 통과 = 후보, 2차 검지 = 확정) → 그때부터 그 궤적만 따라감
//  · 확정 뒤에는 점이 잠깐 안 보여도 예측으로 버팀(구름·나무 뒤) → 다시 보이면 게이트가 넓어진 만큼 이어 붙임
const KF_R = 0.35, KF_Q = 4000, KF_V0 = 80, GATE = 9.21, CONFIRM = 3, TENT_TTL = 250;
const kfInit = z => ({ p: z, v: 0, P: [KF_R * KF_R, 0, 0, KF_V0 * KF_V0] });
const kfPred = (s, dt) => { const [a, b, , d] = s.P; return { p: s.p + s.v * dt, v: s.v, P: [a + 2 * dt * b + dt * dt * d + KF_Q * dt ** 3 / 3, b + dt * d + KF_Q * dt * dt / 2, 0, d + KF_Q * dt] }; };
const kfUpd = (s, z) => { const [a, b, , d] = s.P, S = a + KF_R * KF_R, k0 = a / S, k1 = b / S, y = z - s.p; return { p: s.p + k0 * y, v: s.v + k1 * y, P: [(1 - k0) * a, (1 - k0) * b, 0, d - k1 * b] }; };
const gateOf = (T, c, now) => {
  const dt = Math.max(0.001, (now - T.t) / 1000), a = kfPred(T.az, dt), e = kfPred(T.el, dt), R2 = KF_R * KF_R + 0.04;
  return { d2: (c.az - a.p) ** 2 / (a.P[0] + R2) + (c.el - e.p) ** 2 / (e.P[0] + R2), a, e };
};
const takeHit = (T, c, now, g) => { T.az = kfUpd(g.a, c.az); T.el = kfUpd(g.e, c.el); T.t = now; T.hits.push({ now, az: c.az, el: c.el }); };
export class AngleTrack {
  constructor() { this.obs = []; this.t0 = null; this.tent = []; this.lock = null; }
  get candidates() { return this.tent.length; }
  // cands: [{az, el, score}] · now: 촬영 시각(ms) · gate: 들어갈 수 있는 곳 (예: 조준 ±28° · 지평선 위)
  add(cands, now, gate) {
    const C = cands.filter(c => !gate || gate(c));
    if (this.lock) {
      const T = this.lock; let best = null;
      for (const c of C) { const g = gateOf(T, c, now); if (g.d2 < GATE && (!best || g.d2 < best.g.d2)) best = { c, g }; }
      if (!best) return null;
      takeHit(T, best.c, now, best.g);
      const o = { t: (now - this.t0) / 1000, az: best.c.az, el: best.c.el }; this.obs.push(o); return o;
    }
    const used = new Set();
    this.tent = this.tent.filter(T => now - T.t <= TENT_TTL);
    for (const T of this.tent) {
      let best = null;
      for (const c of C) { if (used.has(c)) continue; const g = gateOf(T, c, now); if (g.d2 < GATE && (!best || g.d2 < best.g.d2)) best = { c, g }; }
      if (best) { used.add(best.c); takeHit(T, best.c, now, best.g); T.cost += best.g.d2; }
    }
    for (const c of C) if (!used.has(c) && this.tent.length < 12) this.tent.push({ az: kfInit(c.az), el: kfInit(c.el), t: now, hits: [{ now, az: c.az, el: c.el }], cost: 0 });
    const ok = this.tent.filter(T => T.hits.length >= CONFIRM).sort((a, b) => b.hits.length - a.hits.length || a.cost - b.cost)[0];
    if (!ok) return null;
    this.lock = ok; this.tent = []; this.t0 = ok.hits[0].now;
    this.obs = ok.hits.map(h => ({ t: (h.now - this.t0) / 1000, az: h.az, el: h.el }));
    return this.obs.at(-1);
  }
}

// ---------- 🎤 임팩트 소리: 클럽이 공을 때리는 '딱' (짧고 큰 고음 충격음) → 친 시각 ----------
//  웹 오디오: 고역 통과(2kHz) 에너지가 바로 앞 0.3초 평균의 8배 넘게 튀고, 0.03초 안에 꺼지면 임팩트
export class ImpactListener {
  constructor() { this.hits = []; this.on = false; }
  async start() {
    if (this.on) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const AC = window.AudioContext || window.webkitAudioContext; this.ac = new AC();
      const src = this.ac.createMediaStreamSource(this.stream), hp = this.ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
      this.an = this.ac.createAnalyser(); this.an.fftSize = 512; src.connect(hp); hp.connect(this.an);
      const buf = new Float32Array(this.an.fftSize), hist = [];
      this.on = true;
      const tick = () => {
        if (!this.on) return;
        this.an.getFloatTimeDomainData(buf);
        let e = 0; for (const v of buf) e += v * v; e /= buf.length;
        const now = performance.now(), base = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : e;
        if (hist.length > 10 && e > base * 8 && e > 1e-4 && (!this.hits.length || now - this.hits.at(-1).t > 1500)) this.hits.push({ t: now - (buf.length / this.ac.sampleRate) * 500, e });
        hist.push(e); if (hist.length > 30) hist.shift();
        this.raf = requestAnimationFrame(tick);
      };
      tick(); return true;
    } catch { this.on = false; return false; }
  }
  stop() { this.on = false; cancelAnimationFrame(this.raf); try { this.stream?.getTracks().forEach(t => t.stop()); this.ac?.close(); } catch {} }
  // t 이전 maxAge ms 안에서 가장 최근 임팩트 (performance.now 기준)
  last(before, maxAge = 10000) { return [...this.hits].reverse().find(h => h.t <= before && before - h.t <= maxAge) || null; }
}
