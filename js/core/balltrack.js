// 🎥 날아가는 공 따라가기: 카메라 영상에서 움직이는 작은 점(공)을 찾아 '보이는 각도'를 모으고,
//  탄도 모델(중력·공기 저항·스핀·바람)에 맞춰 공 속도·발사각·좌우 방향·최고 높이·비행 시간·착지 거리를 계산
//  휴대폰 카메라는 공까지 거리를 못 재지만, 시간에 따라 각도가 바뀌는 모양이 공 속도·발사각마다 달라서 물리로 풀 수 있음
//   · 관측: { t: 초(첫 관측 기준), az: 조준 방향 기준 좌우 각(°, 오른쪽 +), el: 올려다보는 각(°) } — 친 자리(≈ 내 자리)에서 본 각도
//   · 미지수: 공 속도 v · 발사각 L · 좌우 S · 스핀 배율 k · 시간 어긋남 τ(누른 시각과 친 시각 차이)
import { simulateFlight, clubType, RHO_STD, speedForCarry } from '../physics/flight.js';
import { destination } from './geo.js';

const DEG = 180 / Math.PI;

// ---------- 모델: 주어진 값으로 날려서 시간마다 보이는 각도 ----------
export function flightModel({ v, L, S, k = 1, club = '7i', wind = null, rho = RHO_STD, aim = 0 }) {
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
  const angle = t => { const p = at(t), h = Math.hypot(p.x, p.y) || 1e-6; return { az: Math.atan2(p.x, p.y) * DEG, el: Math.atan2(p.z, h) * DEG }; };
  return { f, ct, path, at, angle };
}

// 오차: 관측 각과 모델 각의 차이 제곱 평균 (°²)
function cost(obs, prm, base) {
  if (prm.v < 15 || prm.v > 90 || prm.L < 2 || prm.L > 45 || Math.abs(prm.S) > 25 || prm.k < 0.5 || prm.k > 1.6 || prm.tau < 0 || prm.tau > 9) return 1e9;
  const m = flightModel({ ...base, ...prm });
  let e = 0;
  for (const o of obs) { const t = o.t + prm.tau; if (t > m.f.time) { e += 25; continue; } const a = m.angle(t); e += (a.az - o.az) ** 2 + (a.el - o.el) ** 2; }
  e /= obs.length;
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

// 관측 → 맞춘 비행 (obs ≥ 6개, 0.4초 이상)
//  base: { club, wind, rho, aim(조준 방위°), from(친 곳 위경도), guessCarry(클럽 거리) }
export function fitTrajectory(obs, base) {
  if (!obs || obs.length < 6 || obs.at(-1).t - obs[0].t < 0.4) return null;
  const ct = clubType(base.club) || clubType('7i');
  if (base.guessCarry && !base.v0) base = { ...base, v0: speedForCarry(ct, base.guessCarry), L0: ct.launch };
  const toP = x => ({ v: x[0], L: x[1], S: x[2], k: x[3], tau: x[4] });
  // 여러 출발점에서 (공 속도·처음 본 시각이 넓게 다를 수 있어서)
  let best = null;
  const taus = base.tau0 != null ? [base.tau0] : [0.1, 0.8, 2];
  for (const v0 of [35, 50, 65]) for (const tau0 of taus) {
    const r = nelderMead(x => cost(obs, toP(x), base), [v0, ct.launch, obs[0].az * 0.8, 1, tau0], [8, 4, 3, 0.2, 0.5]);
    if (!best || r.f < best.f) best = r;
  }
  const p = toP(best.x), m = flightModel({ ...base, ...p }), f = m.f, rms = Math.sqrt(best.f);
  // 오차: 각도 잔차·관측 길이 + (친 시각을 모르면) 친 시각을 바꿔 가며 똑같이 잘 맞는 비행들의 거리 범위
  const span = obs.at(-1).t - obs[0].t;
  let sd = f.carry * (0.012 + 0.02 * rms + 0.03 / Math.max(0.3, span)), lo = f.carry, hi = f.carry;
  if (base.tau0 == null) {
    for (const ft of [0, 0.3, 0.6, 1, 1.5, 2.2, 3]) {
      const r = nelderMead(x => cost(obs, toP(x), { ...base, fixTau: ft }), [p.v, p.L, p.S, p.k, ft], [6, 3, 2, 0.15, 0.05], 160);
      if (r.f > best.f * 1.12 + 0.004) continue;
      const c = flightModel({ ...base, ...toP(r.x) }).f.carry; lo = Math.min(lo, c); hi = Math.max(hi, c);
    }
    sd = Math.max(sd, (hi - lo) / 2);
  }
  const rollM = f.carry * (ct.roll ?? 0.03), side = Math.atan2(f.x, f.y) * DEG;
  const out = {
    v: p.v, kmh: p.v * 3.6, launch: p.L, side: p.S, spinRpm: ct.spin * p.k, tau: p.tau,
    carry: f.carry, total: f.carry + rollM, apex: f.apex, time: f.time, landAngle: f.landAngle, lateral: f.x, sideDeg: side,
    rms, sd, lo, hi, n: obs.length, span, timed: base.tau0 != null,
  };
  if (base.from) {
    const land = destination(destination(base.from, base.aim, f.y), base.aim + 90, f.x);
    out.landing = land; out.rest = destination(land, base.aim + side, rollM);
    out.path = m.path.filter((_, i) => i % 3 === 0).map(q => ({ ...destination(destination(base.from, base.aim, q.y), base.aim + 90, q.x), h: q.z, t: q.t }));
  }
  return out;
}

// ---------- 영상에서 움직이는 작은 점 찾기 (하늘·나무 앞을 지나는 공) ----------
//  앞 프레임과의 밝기 차이 → 작은 덩어리만 · 화면 전체가 많이 바뀌면(휴대폰을 휘두름) 그 프레임은 건너뜀
export class FlightSpotter {
  constructor({ width = 240 } = {}) { this.W = width; this.prev = null; this.cv = null; }
  detect(video) {
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return [];
    const W = this.W, H = Math.round(W * vh / vw), sc = vw / W;
    if (!this.cv) { this.cv = document.createElement('canvas'); this.ctx = this.cv.getContext('2d', { willReadFrequently: true }); }
    this.cv.width = W; this.cv.height = H; this.ctx.drawImage(video, 0, 0, W, H);
    const d = this.ctx.getImageData(0, 0, W, H).data, N = W * H, g = new Uint8Array(N);
    for (let i = 0, k = 0; i < N; i++, k += 4) g[i] = (d[k] * 3 + d[k + 1] * 4 + d[k + 2]) >> 3;
    const prev = this.prev; this.prev = g;
    if (!prev || prev.length !== N) return [];
    let sum = 0, sum2 = 0; const diff = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const v = Math.abs(g[i] - prev[i]); diff[i] = v; sum += v; sum2 += v * v; }
    const mean = sum / N, sd = Math.sqrt(Math.max(0, sum2 / N - mean * mean)), thr = Math.max(28, mean + 5 * sd);
    let on = 0; const mask = new Uint8Array(N); for (let i = 0; i < N; i++) if (diff[i] > thr) { mask[i] = 1; on++; }
    if (on > N * 0.03) return []; // 휴대폰이 크게 움직인 프레임
    const lab = new Uint8Array(N), out = [], st = [];
    for (let i = 0; i < N; i++) {
      if (!mask[i] || lab[i]) continue;
      lab[i] = 1; st.push(i); let area = 0, sx = 0, sy = 0, sv = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
      while (st.length) {
        const j = st.pop(), x = j % W, y = (j / W) | 0; area++; sx += x; sy += y; sv += diff[j];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (area > 120) continue;
        for (const n of [j - 1, j + 1, j - W, j + W]) if (n >= 0 && n < N && mask[n] && !lab[n]) { lab[n] = 1; st.push(n); }
      }
      if (area < 1 || area > 60 || x1 - x0 > 14 || y1 - y0 > 14) continue;
      out.push({ x: (sx / area + 0.5) * sc, y: (sy / area + 0.5) * sc, area, score: sv / area });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 8);
  }
}

// 각도 공간에서 이어 붙이기: 예상 위치(속도 유지)에서 가장 가까운 점 · 게이트(예상 비행 근처)만
export class AngleTrack {
  constructor() { this.obs = []; this.t0 = null; }
  add(cands, now, gate) {
    if (!cands.length) return null;
    const t = this.t0 == null ? 0 : (now - this.t0) / 1000;
    let pred = null;
    if (this.obs.length >= 2) { const a = this.obs.at(-2), b = this.obs.at(-1), dt = Math.max(0.01, b.t - a.t), k = (t - b.t) / dt; pred = { az: b.az + (b.az - a.az) * k, el: b.el + (b.el - a.el) * k }; }
    else if (this.obs.length === 1) pred = this.obs[0];
    let best = null, bd = Infinity;
    for (const c of cands) {
      if (gate && !gate(c)) continue;
      const dd = pred ? Math.hypot(c.az - pred.az, c.el - pred.el) : -c.score;
      const lim = pred ? 2.5 + 4 * Math.max(0.05, t - (this.obs.at(-1)?.t ?? 0)) : Infinity;
      if (dd < bd && dd < lim) { bd = dd; best = c; }
    }
    if (!best) return null;
    if (this.t0 == null) this.t0 = now;
    const o = { t: (now - this.t0) / 1000, az: best.az, el: best.el };
    this.obs.push(o); return o;
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
