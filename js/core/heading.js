// 🧭 휴대폰이 가리키는 방위 (정밀)
//  · 방위: 회전행렬로 휴대폰 '윗변(+Y)'의 수평 방향. 거의 세워 들어 윗변이 하늘을 향하면 '카메라(−Z)' 방향으로 넘어감
//      (윗변은 옆으로 기울여도 방향이 그대로라 '윗부분으로 가리키기'에 맞음)
//      (나침반 alpha만 쓰면 세워 들 때 짐벌 현상으로 크게 흔들림)
//  · 떨림: One-Euro 필터 (천천히 움직일 땐 강하게 거르고, 빨리 돌릴 땐 지연을 줄임)
//  · 화면: 화살표를 최단 경로로 부드럽게 돌림 (359°→1°에서 한 바퀴 돌지 않게)
import { rotationMatrix } from './arproj.js';

const D = Math.PI / 180;
export const wrap180 = d => ((((d % 360) + 540) % 360) - 180);
export const norm360 = d => ((d % 360) + 360) % 360;

// alphaAbs(북 기준), beta, gamma(°) → { deg, quality(0~1) } · 휴대폰이 거의 하늘/땅을 향하면 null
export function pointingHeading(alphaAbs, beta, gamma) {
  if (alphaAbs == null || beta == null || gamma == null) return null;
  const R = rotationMatrix(alphaAbs, beta, gamma);
  const tx = R[0][1], ty = R[1][1], tm = Math.hypot(tx, ty);   // 윗변(+Y)의 (동, 북) 성분 — 옆으로 기울여도(gamma) 그대로
  const cx = -R[0][2], cy = -R[1][2], cm = Math.hypot(cx, cy); // 카메라(−Z) — 세워 들 때 대신 씀
  const w = Math.max(0, Math.min(1, (tm - 0.2) / 0.3));        // 윗변이 충분히 눕혀져 있으면 윗변만
  const x = (tm > 1e-6 ? w * tx / tm : 0) + (cm > 1e-6 ? (1 - w) * cx / cm : 0);
  const y = (tm > 1e-6 ? w * ty / tm : 0) + (cm > 1e-6 ? (1 - w) * cy / cm : 0);
  const m = Math.hypot(x, y);
  if (m < 0.25 || Math.max(tm, cm) < 0.2) return null;
  return { deg: norm360(Math.atan2(x, y) / D), quality: Math.min(1, Math.max(tm, cm)) };
}

const lpAlpha = (dt, fc) => { const tau = 1 / (2 * Math.PI * fc); return 1 / (1 + tau / dt); };
export class AngleFilter {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1 } = {}) { Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: null }); }
  update(deg, t = Date.now()) {
    if (this.x == null || !Number.isFinite(this.x)) { this.x = deg; this.dx = 0; this.t = t; return norm360(deg); }
    const dt = Math.max(0.001, Math.min(0.5, (t - this.t) / 1000)); this.t = t;
    const target = this.x + wrap180(deg - this.x); // 이전 값 가까이로 펼친 각
    this.dx += lpAlpha(dt, this.dCutoff) * ((target - this.x) / dt - this.dx);
    this.x += lpAlpha(dt, this.minCutoff + this.beta * Math.abs(this.dx)) * (target - this.x);
    return norm360(this.x);
  }
  get speed() { return Math.abs(this.dx); } // 돌리는 빠르기 (°/초)
  reset() { this.x = null; }
}

// 각도 묶음의 원형 평균·표준편차 (흔들림 판정, 2초 평균 방위)
export function circMean(degs) {
  let s = 0, c = 0; for (const d of degs) { s += Math.sin(d * D); c += Math.cos(d * D); }
  return degs.length ? norm360(Math.atan2(s, c) / D) : null;
}
export function circStd(degs) {
  if (degs.length < 2) return 0;
  let s = 0, c = 0; for (const d of degs) { s += Math.sin(d * D); c += Math.cos(d * D); }
  const R = Math.min(1, Math.hypot(s, c) / degs.length);
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, R))) / D;
}

// 16방위 한국어 (북 · 북북동 …)
const NAMES = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
export const dirName = deg => NAMES[Math.round(norm360(deg) / 22.5) % 16];

// 화살표 부드럽게 돌리기 (요소마다 하나). set(deg)만 부르면 매 프레임 따라감
const spinners = new WeakMap();
export function spin(el, deg) {
  if (!el) return;
  let s = spinners.get(el);
  if (!s) {
    s = { cur: deg, target: deg, raf: 0 };
    s.step = () => {
      const d = s.target - s.cur;
      s.cur = Math.abs(d) < 0.05 ? s.target : s.cur + d * 0.5;
      el.style.transform = `rotate(${s.cur.toFixed(2)}deg)`;
      s.raf = s.cur === s.target || !el.isConnected ? 0 : requestAnimationFrame(s.step);
    };
    spinners.set(el, s); el.style.transform = `rotate(${deg}deg)`; return;
  }
  s.target = s.cur + wrap180(deg - s.cur); // 최단 경로
  // 센서 값마다 한 걸음(초당 ~60번) + 화면 프레임마다 마무리 → 프레임이 느린 기기에서도 늦지 않음
  const raf = s.raf; s.step(); if (raf && s.raf !== raf) cancelAnimationFrame(raf);
}
