// 지도 (Leaflet + 위성 타일, 오프라인 캐시는 서비스 워커가 담당)
import { toLocal, fromLocal, distance } from './core/geo.js';
import { Sensors, onPos } from './core/sensors.js';

export const HZ_STYLE = {
  ob: { color: '#ffffff', fill: '#ffffff', label: 'OB' },
  water: { color: '#3aa0ff', fill: '#3aa0ff', label: '물(페널티 구역)' },
  bunker: { color: '#f1d79b', fill: '#f1d79b', label: '벙커' },
  trees: { color: '#2f7d3a', fill: '#1d4d24', label: '숲' },
};
export const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export function createMap(el, { center = [37.5, 127], zoom = 17, me = true } = {}) {
  if (!window.L) { el.innerHTML = '<div class="map-off">지도 라이브러리를 불러오지 못했습니다 (오프라인). 거리 계산은 계속 동작합니다.</div>'; return null; }
  const map = L.map(el, { zoomControl: false, attributionControl: true, maxZoom: 21, tap: true }).setView(center, zoom);
  L.tileLayer(SAT_URL, { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri' }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  if (me) {
    const dot = L.circleMarker(center, { radius: 7, color: '#fff', weight: 2, fillColor: '#2b7bff', fillOpacity: 1, interactive: false });
    const accC = L.circle(center, { radius: 5, color: '#2b7bff', weight: 1, fillOpacity: 0.12, interactive: false });
    let added = false;
    map._unMe = onPos(p => {
      if (!p) return;
      dot.setLatLng([p.lat, p.lon]); accC.setLatLng([p.lat, p.lon]).setRadius(p.acc || 3);
      if (!added) { dot.addTo(map); accC.addTo(map); added = true; }
    });
  }
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}
export function destroyMap(map) { if (!map) return; map._unMe && map._unMe(); map.remove(); }

export const ll = p => [p.lat, p.lon];

export function flagIcon(text = '') {
  return L.divIcon({ className: 'flag-ic', html: `<div class="flag"><span></span></div>${text ? `<em>${text}</em>` : ''}`, iconSize: [24, 34], iconAnchor: [3, 32] });
}
export function labelIcon(text, cls = '') { return L.divIcon({ className: 'lbl-ic ' + cls, html: `<span>${text}</span>`, iconSize: null }); }

// 홀 요소 그리기
export function drawHole(map, hole, layer) {
  layer = layer || L.layerGroup().addTo(map);
  layer.clearLayers();
  if (!hole) return layer;
  const pts = [];
  if (hole.tee) { L.circleMarker(ll(hole.tee), { radius: 6, color: '#fff', fillColor: '#111', fillOpacity: 1, weight: 2 }).bindTooltip('티').addTo(layer); pts.push(ll(hole.tee)); }
  if (hole.ip) { L.circleMarker(ll(hole.ip), { radius: 4, color: '#ffe27a', fillOpacity: 0.8, weight: 1 }).bindTooltip('IP').addTo(layer); }
  if (hole.green) {
    const r = greenRadius(hole);
    L.circle(ll(hole.green), { radius: r, color: '#b8f5c8', weight: 1, fillOpacity: 0.08, dashArray: '3 4', interactive: false }).addTo(layer);
    pts.push(ll(hole.green));
  }
  for (const k of ['front', 'back']) if (hole[k]) L.circleMarker(ll(hole[k]), { radius: 3, color: '#b8f5c8', weight: 1, fillOpacity: 1 }).addTo(layer);
  for (const hz of hole.hazards || []) {
    const st = HZ_STYLE[hz.type] || HZ_STYLE.bunker;
    L.circle(ll(hz), { radius: hz.r, color: st.color, weight: 2, fillColor: st.fill, fillOpacity: hz.type === 'ob' ? 0.05 : 0.3, dashArray: hz.type === 'ob' ? '6 5' : null }).bindTooltip(st.label).addTo(layer);
  }
  const pin = hole.pin || hole.green;
  if (pin) L.marker(ll(pin), { icon: flagIcon(), interactive: false }).addTo(layer);
  if (pts.length) layer._bounds = L.latLngBounds(pts);
  return layer;
}
export function fitHole(map, hole, me = null) {
  const pts = [hole.tee, hole.green, hole.pin, hole.ip, me].filter(Boolean).map(ll);
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 19 });
}
export function greenRadius(hole) {
  if (hole.front && hole.back) return Math.max(8, distance(hole.front, hole.back) / 2 + 2);
  return 14;
}

// 전략·추정용 로컬 홀 (출발점 원점)
export function localHole(hole, startLL) {
  const o = startLL || hole.tee;
  const L_ = p => (p ? toLocal(o, p) : null);
  const pin = L_(hole.pin || hole.green), green = L_(hole.green || hole.pin);
  const center = [{ x: 0, y: 0 }];
  if (hole.ip && (!startLL || distance(startLL, hole.green) > distance(hole.ip, hole.green) + 20)) center.push(L_(hole.ip));
  center.push(green);
  return {
    origin: o, tee: { x: 0, y: 0 }, pin, green: { ...green, r: greenRadius(hole) }, center, halfWidth: hole.halfWidth || 16,
    hazards: (hole.hazards || []).map(hz => ({ ...L_(hz), r: hz.r, type: hz.type })),
  };
}
export const toLL = (origin, q) => fromLocal(origin, q);
