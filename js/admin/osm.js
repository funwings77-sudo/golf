// OpenStreetMap 골프 태그 → 홀 구조 (기획서 2+-6: 홀 구조 보조 소스, ODbL · © OpenStreetMap contributors)
//  golf=hole(티→핀 선, ref=홀 번호, par), golf=green / tee / bunker / water_hazard / lateral_water_hazard, golf=pin
//  높이(등고) 정보는 없으므로 그린맵은 별도 측량 데이터로 채웁니다.
import { distance, bearing, toLocal, fromLocal, destination } from '../core/geo.js';

export const OVERPASS = 'https://overpass-api.de/api/interpreter';
export const OSM_ATTRIB = '© OpenStreetMap contributors (ODbL)';

export async function fetchOSMGolf([s, w, n, e], { signal } = {}) {
  if ((n - s) * (e - w) > 0.0009) throw new Error('지도 범위가 너무 넓습니다. 골프장이 화면에 꽉 차도록 확대하세요');
  const q = `[out:json][timeout:25];(way["golf"](${s},${w},${n},${e});relation["golf"](${s},${w},${n},${e});node["golf"="pin"](${s},${w},${n},${e}););out geom;`;
  const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: q }), signal });
  if (!res.ok) throw new Error(`Overpass API ${res.status} — 잠시 후 다시 시도하세요`);
  return (await res.json()).elements || [];
}

const pts = el => (el.geometry || []).map(g => ({ lat: g.lat, lon: g.lon }));
function centroid(poly) {
  const o = poly[0]; let a = 0, cx = 0, cy = 0;
  const q = poly.map(p => toLocal(o, p));
  for (let i = 0; i < q.length; i++) { const p = q[i], r = q[(i + 1) % q.length], f = p.x * r.y - r.x * p.y; a += f; cx += (p.x + r.x) * f; cy += (p.y + r.y) * f; }
  if (Math.abs(a) < 1e-6) { const m = q.reduce((s, p) => ({ x: s.x + p.x / q.length, y: s.y + p.y / q.length }), { x: 0, y: 0 }); return { ...fromLocal(o, m), area: 0 }; }
  a /= 2; return { ...fromLocal(o, { x: cx / (6 * a), y: cy / (6 * a) }), area: Math.abs(a) };
}

export function parseOSM(elements) {
  const out = { holes: [], greens: [], tees: [], hazards: [], pins: [] };
  for (const el of elements) {
    const g = el.tags?.golf; if (!g) continue;
    if (el.type === 'node' && g === 'pin') { out.pins.push({ lat: el.lat, lon: el.lon, ref: el.tags.ref }); continue; }
    const p = pts(el); if (p.length < 2) continue;
    if (g === 'hole') out.holes.push({ ref: parseInt(el.tags.ref, 10) || null, par: parseInt(el.tags.par, 10) || null, hdcp: parseInt(el.tags.handicap, 10) || null, name: el.tags.name || '', line: p, id: el.id });
    else if (g === 'green') out.greens.push({ poly: p, c: centroid(p), id: el.id });
    else if (g === 'tee') out.tees.push({ poly: p, c: centroid(p), id: el.id });
    else if (g === 'bunker') out.hazards.push({ type: 'bunker', ...circleOf(p) });
    else if (g === 'water_hazard' || g === 'lateral_water_hazard') out.hazards.push({ type: 'water', ...circleOf(p) });
  }
  out.holes.sort((a, b) => (a.ref ?? 999) - (b.ref ?? 999));
  return out;
}
function circleOf(poly) { const c = centroid(poly); const r = c.area > 0 ? Math.sqrt(c.area / Math.PI) : Math.max(...poly.map(p => distance(c, p))); return { lat: +c.lat.toFixed(7), lon: +c.lon.toFixed(7), r: Math.max(3, Math.round(r)) }; }

// 선분까지 거리 (m)
function segDist(p, a, b) {
  const o = a, P = toLocal(o, p), B = toLocal(o, b), L2 = B.x * B.x + B.y * B.y;
  const t = L2 ? Math.max(0, Math.min(1, (P.x * B.x + P.y * B.y) / L2)) : 0;
  return Math.hypot(P.x - t * B.x, P.y - t * B.y);
}
const lineDist = (p, line) => Math.min(...line.slice(1).map((b, i) => segDist(p, line[i], b)));

// OSM 홀 1개 → 우리 홀 지오메트리
export function holeFromOSM(oh, osm) {
  const L = oh.line, tee0 = L[0], end = L[L.length - 1];
  const green = osm.greens.map(g => ({ g, d: distance(g.c, end) })).filter(x => x.d < 40).sort((a, b) => a.d - b.d)[0]?.g;
  const center = green ? { lat: +green.c.lat.toFixed(7), lon: +green.c.lon.toFixed(7) } : { lat: end.lat, lon: end.lon };
  const ax = bearing(L[L.length - 2], end);
  let front = null, back = null;
  if (green) {
    const along = green.poly.map(p => { const q = toLocal(center, p), a = ax * Math.PI / 180; return q.x * Math.sin(a) + q.y * Math.cos(a); });
    const mn = Math.min(...along), mx = Math.max(...along);
    front = destination(center, ax, mn); back = destination(center, ax, mx);
    front = { lat: +front.lat.toFixed(7), lon: +front.lon.toFixed(7) }; back = { lat: +back.lat.toFixed(7), lon: +back.lon.toFixed(7) };
  }
  const teeBox = osm.tees.map(t => ({ t, d: distance(t.c, tee0) })).filter(x => x.d < 35).sort((a, b) => a.d - b.d)[0]?.t;
  const tee = teeBox ? { lat: +teeBox.c.lat.toFixed(7), lon: +teeBox.c.lon.toFixed(7) } : { lat: tee0.lat, lon: tee0.lon };
  const ip = L.length >= 3 ? { lat: L[1].lat, lon: L[1].lon } : null;
  const hazards = osm.hazards.filter(z => lineDist(z, L) < 70 && distance(z, center) > 3).map((z, i) => ({ id: `osm${oh.id}-${i}`, ...z }));
  return { tee, green: center, front, back, ip, hazards, par: oh.par, hdcp: oh.hdcp };
}

// 코스에 적용: ref(홀 번호)로 맞춤 · 비어 있는 칸만 채우거나(기본) 덮어쓰기
export function applyOSM(course, osm, { overwrite = false } = {}) {
  const report = { matched: [], skipped: [] };
  for (const h of course.holes) {
    const oh = osm.holes.find(x => x.ref === h.n);
    if (!oh) { report.skipped.push(h.n); continue; }
    const g = holeFromOSM(oh, osm);
    for (const k of ['tee', 'green', 'front', 'back', 'ip']) if (g[k] && (overwrite || !h[k])) h[k] = g[k];
    if (overwrite || !h.hazards?.length) h.hazards = g.hazards;
    if (g.par && !h.scorecard && (overwrite || !h.par)) h.par = g.par;
    report.matched.push(h.n);
  }
  course.dataSources = [...(course.dataSources || []).filter(s => s.type !== 'geometry-osm'), { type: 'geometry-osm', provider: 'OpenStreetMap', license: OSM_ATTRIB, date: new Date().toISOString().slice(0, 10), note: `${report.matched.length}개 홀 매칭` }];
  return report;
}
