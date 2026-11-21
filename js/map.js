// 지도 (Leaflet + 위성 타일, 오프라인 캐시는 서비스 워커가 담당)
import { toLocal, fromLocal, distance } from './core/geo.js';
import { Sensors, onPos } from './core/sensors.js';
import { iconHTML } from './iconize.js';
import { icon } from './icons.js';
import { immersive } from './core/screen.js';
import { hasMapsKey, cachedSession, getSession, tileUrl, viewportCopyright, forgetSession } from './core/gmaps.js';

export const HZ_STYLE = {
  ob: { color: '#ffffff', fill: '#ffffff', label: 'OB' },
  water: { color: '#3aa0ff', fill: '#3aa0ff', label: '물(페널티 구역)' },
  bunker: { color: '#f1d79b', fill: '#f1d79b', label: '벙커' },
  trees: { color: '#2f7d3a', fill: '#1d4d24', label: '숲' },
};
export const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// 위성 사진 한 장 주소 (썸네일·카드 배경): 구글 세션이 있으면 구글, 없으면 Esri
export function satTileUrl(z, x, y) {
  const s = hasMapsKey() && cachedSession();
  return (s ? tileUrl(s) : SAT_URL).replace('{z}', z).replace('{x}', x).replace('{y}', y);
}
// 3D 지도(MapLibre)용 바탕: { tiles, maxzoom, attribution } — 구글이면 보이는 곳 저작권 문구까지
export async function satSource(center) {
  if (hasMapsKey()) {
    try {
      const s = await Promise.race([getSession(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
      const d = 0.01, b = { getNorth: () => center.lat + d, getSouth: () => center.lat - d, getEast: () => center.lon + d, getWest: () => center.lon - d };
      const copy = await viewportCopyright(s, b, 17).catch(() => '');
      return { tiles: [tileUrl(s)], maxzoom: 19, attribution: ['Google Maps', copy].filter(Boolean).join(', '), google: true };
    } catch {}
  }
  return { tiles: [SAT_URL], maxzoom: 19, attribution: 'Imagery © Esri' };
}

let CachedTiles = null;
function cachedTileLayer() {
  return CachedTiles ||= L.TileLayer.extend({
    createTile(coords, done) {
      const img = document.createElement('img'), url = this.getTileUrl(coords);
      img.alt = ''; img.setAttribute('role', 'presentation');
      img.onload = () => done(null, img); img.onerror = e => done(e, img);
      const net = () => { img.src = url; };
      caches.open('pinpoint-tiles').then(c => c.match(url)).then(r => {
        if (!r || r.type === 'opaque') return net();
        return r.blob().then(b => { const u = URL.createObjectURL(b); img.onload = () => { URL.revokeObjectURL(u); done(null, img); }; img.src = u; });
      }).catch(net);
      return img;
    },
  });
}

// 바탕 위성지도: 구글 지도 키가 있으면 구글(Map Tiles API), 없거나 안 되면 Esri
//  · 보관된 구글 세션이 있으면 처음부터 구글 · 없으면 Esri로 먼저 보여 주고 세션이 생기면 구글로 바꿈
//  · 구글 타일이 잇달아 실패하면(키 막힘·한도 초과) 저절로 Esri로 돌아감
function esriLayer() {
  const native = !!window.Capacitor?.isNativePlatform?.() && 'caches' in window;
  const o = { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri' };
  return native ? new (cachedTileLayer())(SAT_URL, o) : L.tileLayer(SAT_URL, o);
}
export const GM_LOGO = '<img src="icons/google-maps-logo.svg" alt="Google Maps" width="86" height="18" draggable="false">';
function googleLayer(map, s) {
  const lay = L.tileLayer(tileUrl(s), { maxZoom: 21, maxNativeZoom: 19, attribution: 'Google Maps' }); // 구글 위성은 확대 19까지
  let fails = 0, oks = 0, last = '';
  lay.on('tileload', () => { oks++; });
  lay.on('tileerror', e => {
    // 구글이 안 주는 칸(보안 지역 등)은 그 칸만 Esri 사진으로 채움
    const t = e.tile, c = e.coords;
    if (t && c && !t.dataset.fb) { t.dataset.fb = '1'; t.src = SAT_URL.replace('{z}', c.z).replace('{y}', c.y).replace('{x}', c.x); }
    // 하나도 안 되면(키 막힘·한도 초과) 지도 전체를 Esri로
    if (++fails >= 6 && oks === 0 && map._base === lay) { forgetSession(); swapBase(map, esriLayer()); }
  });
  const copy = () => {
    if (map._base !== lay) return;
    viewportCopyright(s, map.getBounds(), map.getZoom()).then(t => {
      if (!t || t === last || map._base !== lay) return;
      if (last) map.attributionControl?.removeAttribution(last);
      map.attributionControl?.addAttribution(last = t);
    }).catch(() => {});
  };
  let tm = null; map.on('moveend', () => { clearTimeout(tm); tm = setTimeout(copy, 700); });
  lay.once('add', () => setTimeout(copy, 300));
  // 구글 지도 로고 (공식 파일 · 테두리 있는 것 = 위성처럼 복잡한 배경용 · 높이 18px · 왼쪽 아래, 다른 표시와 안 겹치게)
  const logo = new (L.Control.extend({ onAdd() { const d = L.DomUtil.create('div', 'gm-logo'); d.innerHTML = GM_LOGO; return d; } }))({ position: 'bottomleft' });
  lay.on('add', () => { logo.addTo(map); map.getContainer().classList.add('gm-on'); });
  lay.on('remove', () => { logo.remove(); map.getContainer().classList.remove('gm-on'); if (last) map.attributionControl?.removeAttribution(last); last = ''; });
  return lay;
}
function swapBase(map, lay) {
  if (!map._container) return; // 이미 닫힌 지도
  if (map._base) map.removeLayer(map._base);
  map._base = lay.addTo(map); lay.bringToBack?.();
}
function baseLayer(map) {
  if (!hasMapsKey()) return swapBase(map, esriLayer());
  const s = cachedSession();
  if (s) return swapBase(map, googleLayer(map, s));
  swapBase(map, esriLayer());
  getSession().then(ss => swapBase(map, googleLayer(map, ss))).catch(() => {});
}

export function createMap(el, { center = [37.5, 127], zoom = 17, me = true, full = true } = {}) {
  if (!window.L) { el.innerHTML = '<div class="map-off">지도 라이브러리를 불러오지 못했습니다 (오프라인). 거리 계산은 계속 동작합니다.</div>'; return null; }
  const map = L.map(el, { zoomControl: false, attributionControl: true, maxZoom: 21, tap: true }).setView(center, zoom);
  // 앱(APK)에는 서비스 워커가 없어서, 미리 받은 타일(Cache Storage)을 지도 칸이 직접 꺼내 씀 → 신호 없는 코스에서도 위성 지도
  baseLayer(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  if (full) fullControl(map, el);
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
// 📱 지도 전체 화면: 오른쪽 위 버튼 → 지도 칸이 화면을 꽉 채움 (상태바·아래 메뉴까지 숨김) · 다시 누르거나 뒤로 가기로 원래대로
function fullControl(map, el) {
  const box = el.closest('.mapwrap') || el;
  const C = L.Control.extend({
    onAdd() {
      const b = L.DomUtil.create('button', 'map-full-btn'); b.type = 'button';
      const paint = () => { const on = box.classList.contains('map-full'); b.innerHTML = icon(on ? 'shrink' : 'expand'); b.setAttribute('aria-label', on ? '지도 작게' : '지도 전체 화면'); on ? b.setAttribute('data-back', '') : b.removeAttribute('data-back'); };
      L.DomEvent.disableClickPropagation(b);
      b.onclick = () => { setMapFull(map, box, !box.classList.contains('map-full')); paint(); };
      map._fullPaint = paint; paint();
      return b;
    },
  });
  new C({ position: 'topright' }).addTo(map);
  map._fullBox = box;
}
export function setMapFull(map, box, on) {
  box.classList.toggle('map-full', on);
  document.documentElement.classList.toggle('map-on', on);
  immersive(on);
  map._fullPaint?.();
  setTimeout(() => map.invalidateSize(), 60);
}
export function destroyMap(map) { if (!map) return; if (map._fullBox?.classList.contains('map-full')) setMapFull(map, map._fullBox, false); map._unMe && map._unMe(); map.remove(); }

export const ll = p => [p.lat, p.lon];

export function flagIcon(text = '') {
  return L.divIcon({ className: 'flag-ic', html: `<div class="flag"><span></span></div>${text ? `<em>${text}</em>` : ''}`, iconSize: [24, 34], iconAnchor: [3, 32] });
}
// 지도 위 글자 표시: 이모지는 앱 아이콘으로 (📍 → 핀, 🎯 → 조준, ⚪ → 공, ⛳ → 깃발)
export function labelIcon(text, cls = '') { return L.divIcon({ className: 'lbl-ic ' + cls, html: `<span>${iconHTML(text)}</span>`, iconSize: null }); }

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
