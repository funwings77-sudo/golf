// 🔀 센서 융합: 한 가지 기술에만 기대지 않고, 같은 값을 잰 여러 기술을 정확도(표준편차)만큼 믿어서 합침
//  역분산 가중 평균: w = 1/σ² · 합친 σ = 1/√Σw  (정확한 기술일수록 크게, 여러 개면 더 정확해짐)
//  튀는 값 거르기: 가중 가운데값에서 3σ(그 값의 σ와 가운데값 σ 합) 넘게 벗어나면 뺌 (예: GPS가 튄 경우)
//  상황마다 쓰는 기술 (적재적소):
//   · 퍼팅 거리:  LiDAR/깊이 카메라(±1~2cm) · 카메라 탭(땅 투영) · 걸음 · GPS · 직접 입력
//   · 그린 경사:  그린 측량 격자 · 깊이 스캔 · 휴대폰 기울기 센서(빠른/정밀)
//   · 라이 경사:  깊이 카메라 바닥면 · 기울기 센서
//   · 코스 거리·높이: GPS · 지형 자료(고도 타일) · 그린 측량 · 깃대 카메라 · 지도
export const SRC = {
  lidar: '📏 LiDAR', depth: '📏 깊이 카메라', plane: '📷 AR 바닥 인식', camera: '📷 카메라', steps: '👣 걸음', gps: '🛰️ GPS', typed: '✍️ 직접 입력',
  survey: '🗺️ 그린 측량', tilt: '📐 기울기 센서', tiltPrecise: '📐 기울기 센서(정밀)', dem: '⛰️ 지형 자료', flag: '🚩 깃대 카메라', map: '🗺️ 지도',
};

// 기술별 기본 정확도 (σ) — 거리는 m(거리 d의 함수), 경사는 % (기울기 1° ≈ 1.75%)
export const SIGMA = {
  dist: {
    lidar: d => 0.01 + 0.005 * d, depth: d => 0.02 + 0.01 * d, plane: d => 0.04 + 0.02 * d, camera: d => 0.05 + 0.04 * d,
    steps: d => 0.2 + 0.04 * d, gps: (d, acc = 4) => Math.max(1.5, acc), typed: () => 0.15, map: (d, acc = 3) => Math.max(1, acc),
  },
  slope: { survey: 0.15, lidar: 0.35, depth: 0.7, plane: 1.2, tilt: 0.9, tiltPrecise: 0.3, dem: 3 },
};

// ests: [{ v, sd, src }] → { v, sd, srcs, used, dropped }
export function fuse(ests) {
  const ok = (ests || []).filter(e => e && Number.isFinite(e.v) && e.sd > 0);
  if (!ok.length) return null;
  if (ok.length === 1) return { v: ok[0].v, sd: ok[0].sd, srcs: [ok[0].src], used: ok, dropped: [] };
  // 가중 가운데값 (튀는 값에 끌려가지 않는 기준)
  const sorted = ok.map(e => ({ e, w: 1 / (e.sd * e.sd) })).sort((a, b) => a.e.v - b.e.v);
  const W = sorted.reduce((s, x) => s + x.w, 0); let acc = 0, med = sorted[0].e.v, medSd = sorted[0].e.sd;
  for (const x of sorted) { acc += x.w; if (acc >= W / 2) { med = x.e.v; medSd = x.e.sd; break; } }
  const used = ok.filter(e => Math.abs(e.v - med) <= 3 * Math.hypot(e.sd, medSd) || e.v === med);
  const dropped = ok.filter(e => !used.includes(e));
  const w = used.map(e => 1 / (e.sd * e.sd)), sw = w.reduce((a, b) => a + b, 0);
  const v = used.reduce((s, e, i) => s + e.v * w[i], 0) / sw;
  return { v, sd: 1 / Math.sqrt(sw), srcs: [...new Set(used.map(e => e.src))], used, dropped };
}

// 2차원 값(경사 x·y 같은 벡터)도 같은 방식으로: [{ x, y, sd, src }]
export function fuse2(ests) {
  const fx = fuse(ests.map(e => ({ v: e.x, sd: e.sd, src: e.src }))), fy = fuse(ests.map(e => ({ v: e.y, sd: e.sd, src: e.src })));
  return fx && fy ? { x: fx.v, y: fy.v, sd: Math.max(fx.sd, fy.sd), srcs: [...new Set([...fx.srcs, ...fy.srcs])] } : null;
}

// 이미 가진 값(prior)에 새 측정을 정확도만큼 섞는 비율: 0 = 그대로, 1 = 새 값으로
export const blendWeight = (sdPrior, sdNew) => (sdPrior * sdPrior) / (sdPrior * sdPrior + sdNew * sdNew);

export const srcLine = srcs => (srcs || []).map(s => SRC[s] || s).join(' + ');
