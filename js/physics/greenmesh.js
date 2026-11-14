// 사전 측량 그린 격자 → 지도용 데이터 (3D 지도에 정밀 그린 경사를 겹치기 위함)
//  · 등고선 선분(마칭 스퀘어) · 경사(%) 격자 · 격자 네 모서리 위경도
import { fromLocal } from '../core/geo.js';

const at = (g, i, j) => g.h[Math.max(0, Math.min(g.ny - 1, j)) * g.nx + Math.max(0, Math.min(g.nx - 1, i))];

export function slopeAt(g, i, j) {
  const gx = (at(g, i + 1, j) - at(g, i - 1, j)) / ((i > 0 && i < g.nx - 1 ? 2 : 1) * g.dx);
  const gy = (at(g, i, j + 1) - at(g, i, j - 1)) / ((j > 0 && j < g.ny - 1 ? 2 : 1) * g.dx);
  return { pct: Math.hypot(gx, gy) * 100, gx, gy };
}

// 등고선: step(m) 간격, 5칸마다 굵은 선. 결과는 로컬 좌표 선분 목록
export function contourSegments(g, step = 0.02) {
  let lo = Infinity, hi = -Infinity; for (const v of g.h) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const out = [];
  for (let lv = Math.ceil(lo / step) * step, k = 0; lv <= hi && k < 300; lv += step, k++) {
    const major = Math.abs(Math.round(lv / (step * 5)) * step * 5 - lv) < step / 10;
    for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
      const v = [at(g, i, j), at(g, i + 1, j), at(g, i + 1, j + 1), at(g, i, j + 1)], p = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const cr = [];
      for (let e = 0; e < 4; e++) {
        const a = v[e], b = v[(e + 1) % 4];
        if ((a - lv) * (b - lv) < 0) { const t = (lv - a) / (b - a), [ai, aj] = p[e], [bi, bj] = p[(e + 1) % 4]; cr.push({ x: g.x0 + (ai + (bi - ai) * t) * g.dx, y: g.y0 + (aj + (bj - aj) * t) * g.dx }); }
      }
      for (let q = 0; q + 1 < cr.length; q += 2) out.push({ a: cr[q], b: cr[q + 1], major });
    }
  }
  return out;
}

// GeoJSON (MapLibre용): 등고선 + 내리막 화살표 선
export function greenGeoJSON(greenGrid, { step = 0.02, arrowEvery = 2 } = {}) {
  const g = greenGrid.grid, o = greenGrid.origin, ll = q => { const p = fromLocal(o, q); return [p.lon, p.lat]; };
  const features = contourSegments(g, step).map(s => ({ type: 'Feature', properties: { k: s.major ? 'major' : 'minor' }, geometry: { type: 'LineString', coordinates: [ll(s.a), ll(s.b)] } }));
  const n = Math.max(1, Math.round(arrowEvery / g.dx));
  for (let j = n >> 1; j < g.ny; j += n) for (let i = n >> 1; i < g.nx; i += n) {
    const s = slopeAt(g, i, j); if (s.pct < 0.5) continue;
    const m = Math.hypot(s.gx, s.gy), L = Math.min(1, s.pct / 4) * arrowEvery * 0.45, x = g.x0 + i * g.dx, y = g.y0 + j * g.dx;
    features.push({ type: 'Feature', properties: { k: 'flow', pct: +s.pct.toFixed(2) }, geometry: { type: 'LineString', coordinates: [ll({ x: x + s.gx / m * L, y: y + s.gy / m * L }), ll({ x: x - s.gx / m * L, y: y - s.gy / m * L })] } });
  }
  return { type: 'FeatureCollection', features };
}

// 격자 사각형 네 모서리 [좌상, 우상, 우하, 좌하] (MapLibre image source 순서, [lon,lat])
export function gridCorners(greenGrid) {
  const g = greenGrid.grid, o = greenGrid.origin, x1 = g.x0 + (g.nx - 1) * g.dx, y1 = g.y0 + (g.ny - 1) * g.dx;
  return [[g.x0, y1], [x1, y1], [x1, g.y0], [g.x0, g.y0]].map(([x, y]) => { const p = fromLocal(o, { x, y }); return [p.lon, p.lat]; });
}
