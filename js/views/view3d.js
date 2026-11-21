// 3D · 4D 코스 보기 (MapLibre GL + 위성 사진 + AWS 지형 고도 타일)
//  3D: 지형을 기울여 홀을 내려다봄 (확대·회전·기울기)
//  4D: 3D + 시간 — 공이 날아가는 모습(탄도) 재생, 홀 플라이오버, 시간 막대로 되감기
import { satSource } from '../map.js';
import { distance, bearing, destination } from '../core/geo.js';
import { greenGeoJSON, gridCorners, slopeAt } from '../physics/greenmesh.js';
import { slopeColor } from './greencanvas.js';

const ML = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/';
let libP = null;
export function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  return libP || (libP = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = ML + 'maplibre-gl.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = ML + 'maplibre-gl.js'; s.crossOrigin = 'anonymous';
    s.onload = () => res(window.maplibregl); s.onerror = () => { libP = null; rej(new Error('3D 지도를 불러오지 못했습니다 (인터넷 확인)')); };
    document.head.appendChild(s);
  }));
}

const ll = p => [p.lon, p.lat];
function el(cls, html) { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; }

export async function create3D(container, { center, bearingDeg = 0, pitch = 62, zoom = 17 }) {
  const [maplibregl, sat] = await Promise.all([loadMapLibre(), satSource(center)]); // 바탕: 구글 지도 키가 있으면 구글 위성
  const map = new maplibregl.Map({
    container, center: ll(center), zoom, pitch, bearing: bearingDeg, maxPitch: 80, attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        sat: { type: 'raster', tiles: sat.tiles, tileSize: 256, maxzoom: sat.maxzoom, attribution: sat.attribution },
        dem2: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 15 },
        dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain © Mapzen, AWS' },
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'hill', type: 'hillshade', source: 'dem2', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#0b1a10' } },
      ],
      terrain: { source: 'dem', exaggeration: 1.8 },
    },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: false }), 'top-right');
  await new Promise(r => map.once('load', r));
  map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'pin-line', type: 'line', source: 'lines', filter: ['==', ['get', 'k'], 'pin'], paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } });
  map.addLayer({ id: 'rest-line', type: 'line', source: 'lines', filter: ['==', ['get', 'k'], 'rest'], paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-dasharray': [1, 1.5] } });
  map.addLayer({ id: 'rec-line', type: 'line', source: 'lines', filter: ['==', ['get', 'k'], 'rec'], paint: { 'line-color': '#5ee6a8', 'line-width': 3, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round' } });
  map.addLayer({ id: 'trail', type: 'line', source: 'lines', filter: ['==', ['get', 'k'], 'trail'], paint: { 'line-color': '#ff6b5a', 'line-width': 4 } });
  map.addSource('zone', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'zone', type: 'fill', source: 'zone', paint: { 'fill-color': '#ffe27a', 'fill-opacity': 0.25 } });
  const mk = {};
  const marker = (k, cls, html, anchor = 'center') => (mk[k] = mk[k] || new maplibregl.Marker({ element: el(cls, html), anchor }));
  const api = {
    map,
    // 장면: 내 위치 · 깃발 · 추천 착지점 · 예측 공 위치 · 추천 선
    setScene({ me, pin, landing, ball, ellipse }) {
      const f = [];
      if (me && pin) f.push({ type: 'Feature', properties: { k: 'pin' }, geometry: { type: 'LineString', coordinates: [ll(me), ll(pin)] } });
      if (me && landing) f.push({ type: 'Feature', properties: { k: 'rec' }, geometry: { type: 'LineString', coordinates: [ll(me), ll(landing)] } });
      if (landing && pin && distance(landing, pin) > 2) f.push({ type: 'Feature', properties: { k: 'rest' }, geometry: { type: 'LineString', coordinates: [ll(landing), ll(pin)] } });
      api._base = f;
      map.getSource('lines').setData({ type: 'FeatureCollection', features: [...f, ...(api._trail ? [api._trail] : [])] });
      map.getSource('zone').setData({ type: 'FeatureCollection', features: ellipse?.length > 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...ellipse.map(ll), ll(ellipse[0])]] } }] : [] });
      const put = (k, p, cls, html, anchor) => { if (p) marker(k, cls, html, anchor).setLngLat(ll(p)).addTo(map); else mk[k]?.remove(); };
      put('pin', pin, 'mk3 flag', '⛳', 'bottom');
      put('me', me, 'mk3 me', '');
      put('land', landing && distance(landing, pin || landing) > 2 ? landing : null, 'mk3 land', '🎯');
      put('ball', ball, 'mk3 ball', '⚪');
      api.scene = { me, pin, landing, ball };
    },
    // 보이는 영역(위 제목·아래 카드를 뺀 곳)에 공 → 깃발이 들어오게: 비스듬한 각도 + 거리로 확대 수준 계산
    fitScene(pad = { top: 150, bottom: 340, left: 60, right: 70 }) {
      const sc = api.scene || {}, a = sc.me || sc.landing, z = sc.pin || sc.landing;
      if (!a || !z) return;
      const d = Math.max(30, distance(a, z)), brg = bearing(a, z) - 32; // 비스듬히 봐야 공 궤적(아치)이 보임
      const H = Math.max(160, container.clientHeight - pad.top - pad.bottom), W = Math.max(160, container.clientWidth - pad.left - pad.right);
      const mid = destination(a, bearing(a, z), d * 0.5), lat = mid.lat * Math.PI / 180;
      const mpp = d / Math.min(H * 1.15, W * 1.05); // 기울인 화면에서 가까운 쪽이 커 보이므로 여유 있게
      const zoom = Math.max(14, Math.min(18.6, Math.log2(156543.03 * Math.cos(lat) / mpp)));
      map.easeTo({ center: ll(mid), zoom, bearing: brg, pitch: map.getPitch() || 62, padding: pad, duration: 800 });
    },
    zoomBy(d) { map.easeTo({ zoom: map.getZoom() + d, duration: 300 }); },
    setPitch(p) { map.easeTo({ pitch: p, duration: 500 }); },
    // 4D: 공 비행 재생. t(0~1) 위치를 그리고 그림자 궤적을 남김
    flightAt(from, to, apex, t) {
      const d = distance(from, to), b = bearing(from, to), p = destination(from, b, d * t);
      const hgt = 4 * apex * t * (1 - t);
      const z = map.getZoom(), mpp = 156543.03 * Math.cos(p.lat * Math.PI / 180) / 2 ** z;
      const lift = hgt / mpp * Math.sin(map.getPitch() * Math.PI / 180) * 1.8; // 화면에서 위로 띄움(지형 과장과 맞춤)
      const m = marker('fly', 'mk3 fly', '<i></i>'); m.setLngLat(ll(p)).setOffset([0, -lift]).addTo(map);
      api._trail = { type: 'Feature', properties: { k: 'trail' }, geometry: { type: 'LineString', coordinates: [ll(from), ll(p)] } };
      map.getSource('lines').setData({ type: 'FeatureCollection', features: [...(api._base || []), api._trail] });
      return { height: hgt, dist: d * t };
    },
    clearFlight() { mk.fly?.remove(); api._trail = null; if (api.scene) api.setScene(api.scene); },
    async playFlight(from, to, apex, { duration = 2600, onFrame } = {}) {
      const t0 = performance.now();
      return new Promise(res => {
        const step = now => {
          if (api._stopped) return res();
          const t = Math.min(1, (now - t0) / duration), info = api.flightAt(from, to, apex, t);
          onFrame?.(t, info);
          if (t < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
    },
    // 홀 플라이오버: 티 → IP → 그린을 따라 카메라 이동
    async flyover(hole) {
      const path = [hole.tee, hole.ip, hole.green].filter(Boolean);
      if (path.length < 2) return;
      for (let i = 0; i < path.length; i++) {
        const next = path[Math.min(i + 1, path.length - 1)], brg = bearing(path[i], i < path.length - 1 ? next : path[i - 1] && destination(path[i], bearing(path[i - 1], path[i]), 10));
        map.easeTo({ center: ll(path[i]), bearing: brg, pitch: 70, zoom: i === path.length - 1 ? 18.6 : 17.4, duration: i ? 2600 : 1200, essential: true });
        await new Promise(r => map.once('moveend', r));
        if (api._stopped) return;
      }
    },
    // 사전 측량 그린맵을 지형 위에 겹침: 경사 색(%) + 등고선(2cm) + 흐름 화살표 → 공개 지형 타일보다 훨씬 촘촘한 그린 굴곡
    setGreen(gg) {
      for (const id of ['g-img', 'g-minor', 'g-major', 'g-flow']) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of ['g-img', 'g-lines']) if (map.getSource(id)) map.removeSource(id);
      if (!gg?.grid) return;
      const g = gg.grid, cv = document.createElement('canvas'); cv.width = g.nx; cv.height = g.ny;
      const c = cv.getContext('2d');
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { c.fillStyle = slopeColor(slopeAt(g, i, j).pct); c.fillRect(i, g.ny - 1 - j, 1, 1); }
      map.addSource('g-img', { type: 'image', url: cv.toDataURL(), coordinates: gridCorners(gg) });
      map.addLayer({ id: 'g-img', type: 'raster', source: 'g-img', paint: { 'raster-opacity': 0.72, 'raster-resampling': 'linear' } }, 'pin-line');
      map.addSource('g-lines', { type: 'geojson', data: greenGeoJSON(gg) });
      map.addLayer({ id: 'g-minor', type: 'line', source: 'g-lines', filter: ['==', ['get', 'k'], 'minor'], paint: { 'line-color': '#ffffff', 'line-width': 0.8, 'line-opacity': 0.55 } }, 'pin-line');
      map.addLayer({ id: 'g-major', type: 'line', source: 'g-lines', filter: ['==', ['get', 'k'], 'major'], paint: { 'line-color': '#ffffff', 'line-width': 1.8 } }, 'pin-line');
      map.addLayer({ id: 'g-flow', type: 'line', source: 'g-lines', filter: ['==', ['get', 'k'], 'flow'], paint: { 'line-color': '#0f1914', 'line-width': 2 } }, 'pin-line');
    },
    setArc(from, to, apex) { api._arc = from && to && apex ? { from, to, apex } : null; drawArc(); },
    destroy() { api._stopped = true; try { map.remove(); } catch {} },
  };
  // 공 궤적: 지면 점을 화면으로 투영한 뒤 높이만큼 위로 (궤적 · 출발 원 · 착지 원)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'arc3'); container.appendChild(svg);
  function drawArc() {
    const a = api._arc; if (!a) { svg.innerHTML = ''; return; }
    const d = distance(a.from, a.to), b = bearing(a.from, a.to), pts = [];
    const pitch = map.getPitch() * Math.PI / 180;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, p = destination(a.from, b, d * t), sp = map.project(ll(p));
      const mpp = 156543.03 * Math.cos(p.lat * Math.PI / 180) / 2 ** map.getZoom();
      pts.push([sp.x, sp.y - 4 * a.apex * t * (1 - t) / mpp * Math.sin(pitch) * 1.8]);
    }
    const path = 'M' + pts.map(q => q.map(v => v.toFixed(1)).join(',')).join(' L');
    const s0 = map.project(ll(a.from)), s1 = map.project(ll(a.to));
    svg.innerHTML = `<defs><filter id="glw" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>
      <ellipse cx="${s0.x}" cy="${s0.y}" rx="22" ry="8" class="arc-ring"/><ellipse cx="${s1.x}" cy="${s1.y}" rx="16" ry="6" class="arc-ring end"/>
      <path d="${path}" class="arc-glow" filter="url(#glw)"/><path d="${path}" class="arc-line"/><circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="6" class="arc-ball"/>`;
  }
  map.on('render', drawArc);
  return api;
}
