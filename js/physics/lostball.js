// ⑦ 분실구 낙하 확률 추정 (파티클 + 베이지안 융합)
//  입력: 출발점, 가리킨 방위(나침반), 클럽 비거리 분포, 바람 밀림, 동반자 마킹, 코스 지형(해저드)
//  출력: 낙하 확률 분포, 중심, 2σ 타원, 80% 탐색 반경, 신뢰도
import { rng, bearingVec, weightedStats, ellipsePoints, vecBearing, normAngle } from '../core/geo.js';

export function estimateLanding({
  start, bearing, sigmaBearing = 6, club = { carry: 180, sdDist: 0.08, roll: 0.06 },
  distFeel = 'normal', curve = 'straight', drift = 0, hazards = [], marks = [], n = 2500, seed = 3,
}) {
  const R = rng(seed);
  const feel = { short: 0.86, normal: 1, long: 1.12 }[distFeel] ?? 1;
  const curveShift = { left: -3, straight: 0, right: 3 }[curve] ?? 0; // 가리킨 방향이 "공이 사라진 쪽"이면 휨은 작게만 반영
  const parts = [];
  for (let i = 0; i < n; i++) {
    const b = bearing + curveShift + R.gauss() * sigmaBearing;
    const c = club.carry * feel * (1 + R.gauss() * (club.sdDist ?? 0.08) * (distFeel === 'normal' ? 1 : 0.8));
    const u = bearingVec(b);
    let x = start.x + u.x * c + u.y * drift, y = start.y + u.y * c - u.x * drift;
    // 런: 지형에 따라 감소 (숲·러프·벙커·물에서는 거의 굴러가지 않음)
    let rollF = 1;
    for (const hz of hazards) if (Math.hypot(x - hz.x, y - hz.y) <= hz.r) { rollF = hz.type === 'trees' ? 0.15 : hz.type === 'bunker' ? 0.05 : hz.type === 'water' ? 0 : 0.6; break; }
    const roll = c * (club.roll ?? 0.06) * rollF * (0.3 + 1.2 * R());
    const rb = b + R.gauss() * 8; // 튀는 방향 랜덤
    const ru = bearingVec(rb);
    x += ru.x * roll; y += ru.y * roll;
    parts.push({ x, y, w: 1 });
  }
  let est = finalize({ parts, start, bearing });
  for (const m of marks) est = addMark(est, m);
  return est;
}

// 동반자 마킹 / "여기 근처" 관측으로 가중치 갱신 (가우시안 우도)
export function addMark(est, mark) {
  const s2 = 2 * (mark.sigma || 10) ** 2;
  const parts = est.parts.map(p => ({ ...p, w: p.w * Math.exp(-((p.x - mark.x) ** 2 + (p.y - mark.y) ** 2) / s2) }));
  const W = parts.reduce((a, p) => a + p.w, 0);
  if (W < 1e-12) { // 관측이 사전분포와 모순: 마킹 주변으로 재표본
    const R = rng(99);
    const np = Array.from({ length: est.parts.length }, () => ({ x: mark.x + R.gauss() * (mark.sigma || 10), y: mark.y + R.gauss() * (mark.sigma || 10), w: 1 }));
    return finalize({ ...est, parts: np, marks: [...(est.marks || []), mark] });
  }
  parts.forEach(p => p.w /= W);
  return finalize({ ...est, parts: resampleIfNeeded(parts), marks: [...(est.marks || []), mark] });
}

// 이미 수색한 구역(반경 r, 공 못 찾음)은 확률을 낮춤 — 수색할수록 다음 후보로 안내
export function markSearched(est, at, r = 6, pDetect = 0.7) {
  const parts = est.parts.map(p => Math.hypot(p.x - at.x, p.y - at.y) <= r ? { ...p, w: p.w * (1 - pDetect) } : p);
  const W = parts.reduce((a, p) => a + p.w, 0) || 1;
  parts.forEach(p => p.w /= W);
  return finalize({ ...est, parts: resampleIfNeeded(parts) });
}

function resampleIfNeeded(parts) {
  const ess = 1 / parts.reduce((a, p) => a + p.w * p.w, 0);
  if (ess > parts.length * 0.3) return parts;
  // 체계적 재표본 + 작은 흔들기
  const R = rng(17), n = parts.length, out = [];
  let u = R() / n, c = parts[0].w, i = 0;
  for (let k = 0; k < n; k++) {
    while (u > c && i < n - 1) { i++; c += parts[i].w; }
    out.push({ x: parts[i].x + R.gauss() * 0.8, y: parts[i].y + R.gauss() * 0.8, w: 1 / n });
    u += 1 / n;
  }
  return out;
}

function finalize(est) {
  const parts = est.parts;
  const W = parts.reduce((a, p) => a + p.w, 0);
  if (Math.abs(W - 1) > 1e-6) parts.forEach(p => p.w /= W);
  const st = weightedStats(parts);
  const r80 = massRadius(parts, st.mean, 0.8);
  const conf = massWithin(parts, st.mean, 12);
  return { ...est, parts, stats: st, center: st.mean, ellipse: ellipsePoints(st, 2), r80, confidence: conf };
}

export function massWithin(parts, c, r) {
  let m = 0; for (const p of parts) if (Math.hypot(p.x - c.x, p.y - c.y) <= r) m += p.w; return m;
}
export function massRadius(parts, c, q) {
  const arr = parts.map(p => [Math.hypot(p.x - c.x, p.y - c.y), p.w]).sort((a, b) => a[0] - b[0]);
  let m = 0; for (const [d, w] of arr) { m += w; if (m >= q) return d; } return arr.at(-1)?.[0] || 0;
}

// 히트맵 셀 (지도/레이더 표시용)
export function heatGrid(est, cell = 3) {
  const map = new Map(); let max = 0;
  for (const p of est.parts) {
    const k = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell);
    const v = (map.get(k) || 0) + p.w; map.set(k, v); if (v > max) max = v;
  }
  return [...map].map(([k, v]) => { const [i, j] = k.split(',').map(Number); return { x: i * cell, y: j * cell, cell, v: v / max }; });
}

// 탐색 안내: 거리·방위·핫/콜드
export function guidance(est, me, prev = null) {
  const target = est.center;
  const dist = Math.hypot(target.x - me.x, target.y - me.y);
  const brg = vecBearing(target.x - me.x, target.y - me.y);
  let trend = 'same';
  if (prev != null) trend = dist < prev - 0.7 ? 'closer' : dist > prev + 0.7 ? 'farther' : 'same';
  const inZone = dist <= Math.max(8, est.r80);
  return { dist, bearing: brg, trend, inZone, nearDetect: dist <= 15 };
}
// 진동 간격(ms): 가까울수록 빠르게
export function hapticInterval(dist) { return Math.round(Math.max(180, Math.min(2000, dist * 40))); }
export function relativeArrow(bearingDeg, headingDeg) { return headingDeg == null ? bearingDeg : normAngle(bearingDeg - headingDeg); }
