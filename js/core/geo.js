// 좌표 계산 유틸 (WGS84 ↔ 로컬 ENU 평면 근사, 코스 규모 ~2km 이내에서 오차 무시 가능)
export const EARTH_R = 6371008.8;
export const M2YD = 1.0936133;
export const toRad = d => d * Math.PI / 180;
export const toDeg = r => r * 180 / Math.PI;

export function distance(a, b) {
  if (!a || !b) return NaN;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function destination(p, brgDeg, d) {
  const dr = d / EARTH_R, b = toRad(brgDeg), p1 = toRad(p.lat), l1 = toRad(p.lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
  return { lat: toDeg(p2), lon: ((toDeg(l2) + 540) % 360) - 180 };
}

// 로컬 평면 좌표: x = 동(m), y = 북(m)
export function toLocal(origin, p) {
  return {
    x: toRad(p.lon - origin.lon) * Math.cos(toRad(origin.lat)) * EARTH_R,
    y: toRad(p.lat - origin.lat) * EARTH_R,
  };
}
export function fromLocal(origin, q) {
  return {
    lat: origin.lat + toDeg(q.y / EARTH_R),
    lon: origin.lon + toDeg(q.x / (EARTH_R * Math.cos(toRad(origin.lat)))),
  };
}

// -180..180
export function normAngle(a) { return ((a % 360) + 540) % 360 - 180; }
// 로컬 벡터의 나침반 방위(0=북, 시계방향)
export function vecBearing(dx, dy) { return (toDeg(Math.atan2(dx, dy)) + 360) % 360; }
export function bearingVec(brgDeg, len = 1) { const b = toRad(brgDeg); return { x: Math.sin(b) * len, y: Math.cos(b) * len }; }

export function fmtDist(m, unit = 'm', digits = 0) {
  if (m == null || !isFinite(m)) return '—';
  if (unit === 'yd') return (m * M2YD).toFixed(digits) + 'yd';
  return m.toFixed(digits) + 'm';
}
export function fmtNum(m, unit = 'm', digits = 0) {
  if (m == null || !isFinite(m)) return '—';
  return (unit === 'yd' ? m * M2YD : m).toFixed(digits);
}

// 점과 선분 사이 최단거리 (로컬 좌표)
export function pointSegDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, wx = p.x - a.x, wy = p.y - a.y;
  const L2 = vx * vx + vy * vy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2)) : 0;
  const cx = a.x + t * vx, cy = a.y + t * vy;
  return Math.hypot(p.x - cx, p.y - cy);
}
export function polylineDist(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, pointSegDist(p, pts[i], pts[i + 1]));
  return pts.length === 1 ? Math.hypot(p.x - pts[0].x, p.y - pts[0].y) : best;
}

// 결정적 난수 (몬테카를로 재현성)
export function rng(seed = 12345) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  next.gauss = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = next();
    v = next();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
  return next;
}

// 가중 표본 → 평균/공분산/타원
export function weightedStats(pts) {
  let W = 0, mx = 0, my = 0;
  for (const p of pts) { const w = p.w ?? 1; W += w; mx += w * p.x; my += w * p.y; }
  mx /= W; my /= W;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const w = p.w ?? 1, dx = p.x - mx, dy = p.y - my; sxx += w * dx * dx; syy += w * dy * dy; sxy += w * dx * dy; }
  sxx /= W; syy /= W; sxy /= W;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
  const angle = Math.atan2(l1 - sxx, sxy || 1e-12); // 장축의 수학 각도 (x축 기준)
  return { mean: { x: mx, y: my }, cov: { sxx, syy, sxy }, sd1: Math.sqrt(l1), sd2: Math.sqrt(l2), angle: sxy === 0 ? (sxx >= syy ? 0 : Math.PI / 2) : angle };
}
export function ellipsePoints(stats, k = 2, n = 48) {
  const out = [];
  const c = Math.cos(stats.angle), s = Math.sin(stats.angle);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const ex = k * stats.sd1 * Math.cos(t), ey = k * stats.sd2 * Math.sin(t);
    out.push({ x: stats.mean.x + ex * c - ey * s, y: stats.mean.y + ex * s + ey * c });
  }
  return out;
}

// ---------- 📏 정밀 거리 (WGS84 타원체 · Vincenty 역해) ----------
//  구(haversine)는 10km에서 최대 약 30m(0.3%)까지 틀릴 수 있어서, 먼 거리·지도 재기는 타원체로 계산 (mm 정밀)
const WGS_A = 6378137, WGS_F = 1 / 298.257223563, WGS_B = WGS_A * (1 - WGS_F);
export function geodesic(p, q) {
  const L = toRad(q.lon - p.lon), U1 = Math.atan((1 - WGS_F) * Math.tan(toRad(p.lat))), U2 = Math.atan((1 - WGS_F) * Math.tan(toRad(q.lat)));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, it = 0, sS, cS, sig, ca2, c2m;
  do {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    sS = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl);
    if (sS === 0) return 0;
    cS = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(sS, cS);
    const sa = cU1 * cU2 * sl / sS; ca2 = 1 - sa * sa;
    c2m = ca2 ? cS - 2 * sU1 * sU2 / ca2 : 0;
    const C = WGS_F / 16 * ca2 * (4 + WGS_F * (4 - 3 * ca2)), prev = lam;
    lam = L + (1 - C) * WGS_F * sa * (sig + C * sS * (c2m + C * cS * (-1 + 2 * c2m * c2m)));
    if (Math.abs(lam - prev) < 1e-12) break;
  } while (++it < 200);
  if (it >= 200) return distance(p, q); // 거의 정반대 지점 (골프장에선 없음)
  const u2 = ca2 * (WGS_A * WGS_A - WGS_B * WGS_B) / (WGS_B * WGS_B);
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = B * sS * (c2m + B / 4 * (cS * (-1 + 2 * c2m * c2m) - B / 6 * c2m * (-3 + 4 * sS * sS) * (-3 + 4 * c2m * c2m)));
  return WGS_B * A * (sig - dS);
}
