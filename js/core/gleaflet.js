// 🗺️ 진짜 구글 지도(Google Maps JavaScript API) 위에서 앱의 지도 코드(Leaflet 방식 L.*)를 그대로 쓰게 하는 층
//  · 화면 코드는 L.map / L.marker / L.polyline / L.circle … 그대로 → 구글 키가 있으면 구글 지도에, 없으면 원래 Leaflet(Esri)에
//  · 선·원·다각형: 지도마다 SVG 판 하나에 모아 그림 (점이 수백 개여도 가벼움) · 마커·글자: 각각 HTML (끌어 옮기기·툴팁·클릭)
//  · 구글 지도 로고·저작권·이용약관 표시는 구글이 직접 그림 (지우지 않음)
const EARTH = 6378137, D2R = Math.PI / 180;

// ── 기본 자료형 ─────────────────────────────────────────────
export class LatLng {
  constructor(lat, lng) { this.lat = +lat; this.lng = +lng; }
  distanceTo(o) { o = toLL(o); const dLat = (o.lat - this.lat) * D2R, dLng = (o.lng - this.lng) * D2R, a = Math.sin(dLat / 2) ** 2 + Math.cos(this.lat * D2R) * Math.cos(o.lat * D2R) * Math.sin(dLng / 2) ** 2; return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(a))); }
  equals(o) { o = toLL(o); return Math.abs(o.lat - this.lat) < 1e-9 && Math.abs(o.lng - this.lng) < 1e-9; }
}
export class Point {
  constructor(x, y) { this.x = +x; this.y = +y; }
  distanceTo(p) { p = toPt(p); return Math.hypot(p.x - this.x, p.y - this.y); }
  add(p) { p = toPt(p); return new Point(this.x + p.x, this.y + p.y); }
  subtract(p) { p = toPt(p); return new Point(this.x - p.x, this.y - p.y); }
}
export const toLL = a => (a instanceof LatLng ? a : Array.isArray(a) ? new LatLng(a[0], a[1]) : a && typeof a.lat === 'function' ? new LatLng(a.lat(), a.lng()) : a ? new LatLng(a.lat, a.lng ?? a.lon) : null);
const toPt = p => (p instanceof Point ? p : Array.isArray(p) ? new Point(p[0], p[1]) : p ? new Point(p.x, p.y) : new Point(0, 0));
export class LatLngBounds {
  constructor(a, b) { this._sw = null; this._ne = null; if (a) (Array.isArray(a) && !(typeof a[0] === 'number') ? a : [a, b]).forEach(p => p && this.extend(p)); }
  extend(p) {
    if (p instanceof LatLngBounds) { if (p.isValid()) { this.extend(p._sw); this.extend(p._ne); } return this; }
    p = toLL(p); if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return this;
    if (!this._sw) { this._sw = new LatLng(p.lat, p.lng); this._ne = new LatLng(p.lat, p.lng); }
    else { this._sw.lat = Math.min(this._sw.lat, p.lat); this._sw.lng = Math.min(this._sw.lng, p.lng); this._ne.lat = Math.max(this._ne.lat, p.lat); this._ne.lng = Math.max(this._ne.lng, p.lng); }
    return this;
  }
  isValid() { return !!this._sw; }
  getSouthWest() { return this._sw; } getNorthEast() { return this._ne; }
  getNorth() { return this._ne.lat; } getSouth() { return this._sw.lat; } getEast() { return this._ne.lng; } getWest() { return this._sw.lng; }
  getCenter() { return new LatLng((this._sw.lat + this._ne.lat) / 2, (this._sw.lng + this._ne.lng) / 2); }
  contains(p) { if (p instanceof LatLngBounds) return this.contains(p._sw) && this.contains(p._ne); p = toLL(p); return p.lat >= this._sw.lat && p.lat <= this._ne.lat && p.lng >= this._sw.lng && p.lng <= this._ne.lng; }
  pad(r) { const dy = (this._ne.lat - this._sw.lat) * r, dx = (this._ne.lng - this._sw.lng) * r; return new LatLngBounds([[this._sw.lat - dy, this._sw.lng - dx], [this._ne.lat + dy, this._ne.lng + dx]]); }
}
const toBounds = b => (b instanceof LatLngBounds ? b : new LatLngBounds(b));

// 웹 메르카토르 (구글 래스터 지도와 같은 식): 확대 z에서 세계 픽셀 좌표
export function worldPx(ll, z) {
  const s = 256 * 2 ** z, sin = Math.min(Math.max(Math.sin(ll.lat * D2R), -0.9999), 0.9999);
  return new Point((ll.lng + 180) / 360 * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s);
}
export function worldLL(p, z) {
  const s = 256 * 2 ** z, lng = p.x / s * 360 - 180, n = Math.PI - 2 * Math.PI * p.y / s;
  return new LatLng(Math.atan(Math.sinh(n)) / D2R, lng);
}

// ── 이벤트 ─────────────────────────────────────────────────
class Evented {
  on(t, fn) { for (const k of String(t).split(/\s+/)) ((this._ev ||= {})[k] ||= []).push(fn); return this; }
  off(t, fn) { if (!this._ev) return this; if (!t) { this._ev = {}; return this; } for (const k of String(t).split(/\s+/)) this._ev[k] = fn ? (this._ev[k] || []).filter(f => f !== fn && f._of !== fn) : []; return this; }
  once(t, fn) { const w = e => { this.off(t, w); fn.call(this, e); }; w._of = fn; return this.on(t, w); }
  fire(t, d = {}) { for (const f of [...(this._ev?.[t] || [])]) f.call(this, { type: t, target: this, ...d }); return this; }
  listens(t) { return !!this._ev?.[t]?.length; }
}

export function makeGoogleL(google) {
  const g = google.maps;

  // 한 지도의 겹쳐 그리기 판들 (OverlayView): 선·원 SVG 판 + 마커/툴팁 HTML
  class OV extends g.OverlayView {
    constructor(owner) { super(); this.owner = owner; }
    onAdd() { this.owner._onAdd(this.getPanes(), this); }
    draw() { this.owner._draw(this.getProjection(), this); }
    onRemove() { this.owner._onRemove(this); }
  }

  // ── 지도 ───────────────────────────────────────────────
  class GMap extends Evented {
    constructor(el, o = {}) {
      super();
      this._container = el; this._layers = new Set(); this.options = o; this._gl = [];
      el.classList.add('gmap-on');
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      // 구글 지도는 안쪽 칸에: 아래를 덮는 판(--gm-cover)만큼 짧게 → 구글 로고·저작권이 판에 가려지지 않음
      //  화면 코드의 좌표(가운데·여백)는 Leaflet처럼 바깥 칸 전체 기준으로 맞춰 줌
      this._host = document.createElement('div'); this._host.className = 'gm-host'; el.appendChild(this._host);
      // 단추 자리: 골퍼 앱은 위쪽에 앱 판(홀 정보·거리)이 있어서 [위성/지도]는 왼쪽 아래 · 골프 치기 지도는 1× 단추와 안 겹치게 +/−를 오른쪽 가운데로
      const admin = !!el.closest('#aview'), imm = !!el.closest('.imm');
      this.gm = new g.Map(this._host, {
        center: { lat: 37.5, lng: 127 }, zoom: 17, mapTypeId: o.mapType || 'satellite', tilt: 0, heading: 0,
        gestureHandling: 'greedy', clickableIcons: false, keyboardShortcuts: false, maxZoom: o.maxZoom || 21, minZoom: 3,
        disableDefaultUI: true, zoomControl: o.zoomControl !== false, zoomControlOptions: { position: imm ? g.ControlPosition.RIGHT_CENTER : g.ControlPosition.RIGHT_BOTTOM },
        mapTypeControl: o.mapTypeControl !== false, mapTypeControlOptions: { style: g.MapTypeControlStyle.HORIZONTAL_BAR, position: admin ? g.ControlPosition.TOP_LEFT : g.ControlPosition.LEFT_BOTTOM, mapTypeIds: ['satellite', 'hybrid', 'roadmap'] },
        scaleControl: true, isFractionalZoomEnabled: false, backgroundColor: '#1d2a22',
      });
      this.vec = new VectorPane(this);
      let small = null; this._ro = new ResizeObserver(() => { const s = this._container && this._container.clientWidth < 260; if (s !== small) { small = s; this.gm.setOptions({ zoomControl: !s && o.zoomControl !== false, mapTypeControl: !s && o.mapTypeControl !== false, scaleControl: !s }); } this.vec.redraw(); });
      this._ro.observe(el);
      this.attributionControl = { addAttribution() {}, removeAttribution() {} }; // 저작권 표시는 구글이 직접
      const ev = (name, fn) => this._gl.push(g.event.addListener(this.gm, name, fn));
      const me = e => ({ latlng: toLL(e.latLng), containerPoint: e.pixel ? new Point(e.pixel.x, e.pixel.y) : null, originalEvent: e.domEvent });
      ev('click', e => this.fire('click', me(e)));
      ev('dblclick', e => this.fire('dblclick', me(e)));
      ev('zoom_changed', () => this.fire('zoom').fire('zoomend'));
      ev('idle', () => { this.vec.redraw(); this.fire('moveend'); if (!this._loaded) { this._loaded = true; this.fire('load'); } });
      ev('dragstart', () => this.fire('movestart').fire('dragstart'));
      ev('drag', () => this.fire('move'));
    }
    // 보기 (가운데 = 바깥 칸 가운데 · 구글 카메라 가운데는 가려진 높이의 절반만큼 위)
    _hb() { return Math.max(0, (this._container?.clientHeight || 0) - (this._host?.clientHeight || 0)); }
    _camera(c, z) { c = toLL(c); const p = worldPx(c, z), q = worldLL(new Point(p.x, p.y - this._hb() / 2), z); this.gm.moveCamera({ center: { lat: q.lat, lng: q.lng }, zoom: z }); return this; }
    setView(c, z, o) { return this._camera(c, Math.round(z ?? this.getZoom())); }
    setZoom(z) { this.gm.setZoom(Math.round(z)); return this; }
    zoomIn(d = 1) { return this.setZoom(this.getZoom() + d); }
    zoomOut(d = 1) { return this.setZoom(this.getZoom() - d); }
    getZoom() { return this.gm.getZoom() ?? 17; }
    getMaxZoom() { return this.options.maxZoom || 21; }
    getCenter() { const z = this.getZoom(), c = this.gm.getCenter(); if (!c) return new LatLng(37.5, 127); const p = worldPx(toLL(c), z); return worldLL(new Point(p.x, p.y + this._hb() / 2), z); }
    getSize() { return new Point(this._container.clientWidth, this._container.clientHeight); }
    getContainer() { return this._container; }
    getBounds() {
      const s = this.getSize(), tl = this.containerPointToLatLng(new Point(0, 0)), br = this.containerPointToLatLng(s);
      return new LatLngBounds([[br.lat, tl.lng], [tl.lat, br.lng]]);
    }
    panTo(c) { c = toLL(c); const z = this.getZoom(), p = worldPx(c, z), q = worldLL(new Point(p.x, p.y - this._hb() / 2), z); this.gm.panTo({ lat: q.lat, lng: q.lng }); return this; }
    panBy(p, o) {
      p = toPt(p);
      if (o?.animate === false) { const z = this.getZoom(), c = worldPx(this.getCenter(), z); this._camera(worldLL(new Point(c.x + p.x, c.y + p.y), z), z); }
      else this.gm.panBy(p.x, p.y);
      return this;
    }
    // 이 범위가 들어가는 가장 큰 확대 (padding: 남길 여백 합)
    getBoundsZoom(b, inside = false, pad = new Point(0, 0)) {
      b = toBounds(b); if (!b.isValid()) return this.getZoom();
      const s = this.getSize(), pd = toPt(pad), W = Math.max(1, s.x - pd.x), H = Math.max(1, s.y - pd.y);
      let z = this.getMaxZoom();
      for (; z > 2; z--) { const a = worldPx(b._ne, z), c = worldPx(b._sw, z); if (Math.abs(c.x - a.x) <= W && Math.abs(c.y - a.y) <= H) break; }
      return inside ? Math.min(this.getMaxZoom(), z + 1) : z;
    }
    fitBounds(b, o = {}) {
      b = toBounds(b); if (!b.isValid()) return this;
      const tl = toPt(o.paddingTopLeft || o.padding || [0, 0]), br = toPt(o.paddingBottomRight || o.padding || [0, 0]);
      let z = this.getBoundsZoom(b, false, new Point(tl.x + br.x, tl.y + br.y));
      if (o.maxZoom != null) z = Math.min(z, Math.floor(o.maxZoom));
      const a = worldPx(b._ne, z), c = worldPx(b._sw, z), mid = new Point((a.x + c.x) / 2, (a.y + c.y) / 2);
      // 여백이 한쪽만 크면 그만큼 가운데를 옮김
      return this._camera(worldLL(new Point(mid.x - (tl.x - br.x) / 2, mid.y - (tl.y - br.y) / 2), z), z);
    }
    invalidateSize() { this.vec.redraw(); return this; } // 구글 지도는 칸 크기 변화를 스스로 따라감
    // 좌표 변환 (지도 칸 왼쪽 위 = 0,0)
    latLngToContainerPoint(ll) { const z = this.getZoom(), c = worldPx(this.getCenter(), z), p = worldPx(toLL(ll), z), s = this.getSize(); return new Point(p.x - c.x + s.x / 2, p.y - c.y + s.y / 2); }
    containerPointToLatLng(pt) { pt = toPt(pt); const z = this.getZoom(), c = worldPx(this.getCenter(), z), s = this.getSize(); return worldLL(new Point(c.x + pt.x - s.x / 2, c.y + pt.y - s.y / 2), z); }
    project(ll, z = this.getZoom()) { return worldPx(toLL(ll), z); }
    unproject(p, z = this.getZoom()) { return worldLL(toPt(p), z); }
    distance(a, b) { return toLL(a).distanceTo(b); }
    // 레이어
    addLayer(l) { l.addTo(this); return this; }
    removeLayer(l) { if (l?._map === this) l.remove(); return this; }
    hasLayer(l) { return this._layers.has(l); }
    eachLayer(fn) { [...this._layers].forEach(fn); return this; }
    whenReady(fn) { this._loaded ? fn.call(this) : this.once('load', fn); return this; }
    stop() { return this; }
    remove() {
      [...this._layers].forEach(l => l.remove()); this.vec.destroy(); this._ro?.disconnect();
      this._gl.forEach(h => h.remove()); this._gl = []; g.event.clearInstanceListeners(this.gm);
      this._container?.classList.remove('gmap-on'); if (this._container) this._container.innerHTML = '';
      this._container = null; this.off(); this.fire('unload'); return this;
    }
  }

  // ── 선·원 SVG 판 (지도당 하나) ─────────────────────────────
  const SVGNS = 'http://www.w3.org/2000/svg';
  class VectorPane {
    constructor(map) { this.map = map; this.paths = new Set(); this.ov = new OV(this); this.ov.setMap(map.gm); this.svg = null; }
    _onAdd(panes) { this.svg = document.createElementNS(SVGNS, 'svg'); this.svg.setAttribute('class', 'gl-vec'); this.svg.style.cssText = 'position:absolute;overflow:visible;pointer-events:none;z-index:100'; panes.overlayMouseTarget.appendChild(this.svg); for (const p of this.paths) this.svg.appendChild(p._el); this.redraw(); }
    _draw() { this.redraw(); }
    _onRemove() { this.svg?.remove(); this.svg = null; }
    add(p) { this.paths.add(p); if (this.svg) { this.svg.appendChild(p._el); this.drawOne(p); } }
    del(p) { this.paths.delete(p); p._el.remove(); }
    redraw() {
      const pr = this.ov.getProjection(); if (!pr || !this.svg || !this.map._container) return;
      const h = this.map._host, s = { x: h.clientWidth || 1, y: h.clientHeight || 1 };
      // 보이는 칸 + 사방으로 한 칸씩 (끌어서 옮기는 동안에도 선이 보이게) · 멈추면(idle) 다시 맞춤
      const tl = pr.fromLatLngToDivPixel(pr.fromContainerPixelToLatLng(new g.Point(-s.x, -s.y)));
      this.o = { x: tl.x, y: tl.y }; this.pr = pr; this.z = this.map.getZoom();
      Object.assign(this.svg.style, { left: tl.x + 'px', top: tl.y + 'px', width: 3 * s.x + 'px', height: 3 * s.y + 'px' });
      for (const p of this.paths) this.drawOne(p);
    }
    px(ll) { const q = this.pr.fromLatLngToDivPixel(new g.LatLng(ll.lat, ll.lng)); return { x: q.x - this.o.x, y: q.y - this.o.y }; }
    drawOne(p) { if (this.pr) p._render(this); }
    destroy() { this.ov.setMap(null); this.paths.clear(); }
  }

  // ── 레이어 공통 ────────────────────────────────────────────
  class Layer extends Evented {
    constructor(o = {}) { super(); this.options = o; this._map = null; this._group = null; }
    addTo(t) {
      if (t instanceof LayerGroup) { t.addLayer(this); return this; }
      if (this._map === t) return this;
      if (this._map) this._removeFromMap();
      this._map = t; t._layers.add(this); this._addToMap(t); this.fire('add'); return this;
    }
    remove() {
      if (this._group) { const gr = this._group; this._group = null; gr._layers.delete(this); }
      if (this._map) { const m = this._map; this._removeFromMap(); m._layers.delete(this); this._map = null; this.fire('remove'); }
      return this;
    }
    bindTooltip(c, o = {}) { this._tip = { c, o }; if (this._map) this._tipSync(); return this; }
    unbindTooltip() { this._tipEl?.remove(); this._tip = null; this._tipEl = null; return this; }
    setTooltipContent(c) { if (this._tip) { this._tip.c = c; if (this._tipEl) this._tipEl.innerHTML = c; } return this; }
    openTooltip() { if (this._tipEl) this._tipEl.hidden = false; return this; }
    closeTooltip() { if (this._tipEl && !this._tip?.o.permanent) this._tipEl.hidden = true; return this; }
    bindPopup(c) { return this.bindTooltip(c); }
    // 툴팁: 늘 보이는 것(permanent)은 항상, 아니면 손가락을 대거나(누름) 마우스를 올렸을 때
    _tipSync() {
      if (!this._tip || !this._map) return;
      if (!this._tipOv) { this._tipOv = new OV({ _onAdd: panes => { this._tipEl = document.createElement('div'); this._tipEl.className = `leaflet-tooltip gl-tip leaflet-tooltip-${this._tip.o.direction || 'top'} ${this._tip.o.className || ''}`; this._tipEl.innerHTML = this._tip.c; this._tipEl.hidden = !this._tip.o.permanent; panes.floatPane.appendChild(this._tipEl); }, _draw: pr => this._tipPlace(pr), _onRemove: () => { this._tipEl?.remove(); this._tipEl = null; } }); this._tipOv.setMap(this._map.gm); }
    }
    _tipPlace(pr) {
      const a = this._anchor?.(); if (!a || !this._tipEl || !pr) return;
      const q = pr.fromLatLngToDivPixel(new g.LatLng(a.lat, a.lng)), off = toPt(this._tip.o.offset || [0, 0]);
      Object.assign(this._tipEl.style, { position: 'absolute', left: q.x + off.x + 'px', top: q.y + off.y - (this._tipLift || 6) + 'px', transform: 'translate(-50%,-100%)' });
    }
    _tipShow(on) { if (this._tipEl && !this._tip.o.permanent) { this._tipEl.hidden = !on; if (on) this._tipOv?.draw(); } }
    _tipDrop() { this._tipOv?.setMap(null); this._tipOv = null; this._tipEl = null; }
  }

  // ── 선·다각형·원 ───────────────────────────────────────────
  class Path extends Layer {
    constructor(o) { super({ stroke: true, color: '#3388ff', weight: 3, opacity: 1, fillOpacity: 0.2, interactive: true, lineCap: 'round', lineJoin: 'round', ...o }); this._el = document.createElementNS(SVGNS, this._tag || 'path'); this._bindDom(); }
    _bindDom() {
      const el = this._el;
      el.addEventListener('click', e => { if (!this.options.interactive) return; this._tipShow(true); clearTimeout(this._tt); this._tt = setTimeout(() => this._tipShow(false), 2500); this.fire('click', { latlng: this._evLL(e), originalEvent: e }); });
      el.addEventListener('mouseenter', () => this._tipShow(true)); el.addEventListener('mouseleave', () => this._tipShow(false));
    }
    _evLL(e) { const m = this._map; if (!m) return null; const r = m._container.getBoundingClientRect(); return m.containerPointToLatLng(new Point(e.clientX - r.left, e.clientY - r.top)); }
    _addToMap(m) { m.vec.add(this); this._tipSync(); }
    _removeFromMap() { this._map.vec.del(this); this._tipDrop(); }
    setStyle(o) { Object.assign(this.options, o); this._redraw(); return this; }
    _redraw() { if (this._map) { this._map.vec.drawOne(this); this._tipOv?.draw(); } }
    getElement() { return this._el; }
    bringToFront() { this._el.parentNode?.appendChild(this._el); return this; }
    bringToBack() { const p = this._el.parentNode; p?.insertBefore(this._el, p.firstChild); return this; }
    _style() {
      const o = this.options, el = this._el, fill = o.fill ?? this._fillDefault;
      el.setAttribute('stroke', o.stroke === false || !o.weight ? 'none' : o.color);
      el.setAttribute('stroke-width', o.weight || 0); el.setAttribute('stroke-opacity', o.opacity ?? 1);
      el.setAttribute('stroke-linecap', o.lineCap || 'round'); el.setAttribute('stroke-linejoin', o.lineJoin || 'round');
      if (o.dashArray) el.setAttribute('stroke-dasharray', String(o.dashArray).replace(/,/g, ' ')); else el.removeAttribute('stroke-dasharray');
      el.setAttribute('fill', fill ? o.fillColor || o.color : 'none'); el.setAttribute('fill-opacity', o.fillOpacity ?? 0.2);
      el.setAttribute('fill-rule', 'evenodd');
      el.style.pointerEvents = o.interactive === false ? 'none' : 'visiblePainted';
      el.style.cursor = o.interactive === false ? '' : 'pointer';
      if (o.className) el.setAttribute('class', o.className);
    }
  }
  const flatLL = a => (Array.isArray(a) ? (a.length && (Array.isArray(a[0]) && Array.isArray(a[0][0]) || (Array.isArray(a[0]) && typeof a[0][0] === 'object')) ? a.map(flatLL) : a.map(toLL)) : []);
  class Polyline extends Path {
    constructor(lls, o) { super(o); this._fillDefault = false; this._ll = flatLL(lls); }
    _closed = false;
    setLatLngs(lls) { this._ll = flatLL(lls); this._redraw(); return this; }
    getLatLngs() { return this._ll; }
    _rings() { return Array.isArray(this._ll[0]) ? this._ll : [this._ll]; }
    getBounds() { const b = new LatLngBounds(); this._rings().forEach(r => r.forEach(p => b.extend(p))); return b; }
    getCenter() { return this.getBounds().getCenter(); }
    _anchor() { const r = this._rings()[0] || []; return this._closed || r.length < 2 ? this.getCenter() : r[Math.floor((r.length - 1) / 2)]; }
    _render(v) {
      this._style();
      const d = this._rings().map(r => r.map((p, i) => { const q = v.px(p); return `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`; }).join('') + (this._closed && r.length ? 'Z' : '')).join('');
      this._el.setAttribute('d', d || 'M0 0');
    }
  }
  class Polygon extends Polyline { constructor(lls, o) { super(lls, o); this._fillDefault = true; this._closed = true; } }
  // 원 (반지름 m) · 원 표시 (반지름 화면 px)
  class CircleMarker extends Path {
    constructor(c, o = {}) { super({ radius: 10, ...o }); this._fillDefault = true; this._c = toLL(c); this._tag = 'circle'; const el = document.createElementNS(SVGNS, 'circle'); this._el = el; this._bindDom(); }
    setLatLng(c) { this._c = toLL(c); this._redraw(); this.fire('move', { latlng: this._c }); return this; }
    getLatLng() { return this._c; }
    setRadius(r) { this.options.radius = r; this._redraw(); return this; }
    getRadius() { return this.options.radius; }
    _anchor() { return this._c; }
    _rpx() { return this.options.radius; }
    get _tipLift() { return this._rpx?.() + 4; }
    getBounds() { return new LatLngBounds([this._c, this._c]); }
    _render(v) { this._style(); const q = v.px(this._c); this._el.setAttribute('cx', q.x.toFixed(1)); this._el.setAttribute('cy', q.y.toFixed(1)); this._el.setAttribute('r', Math.max(0, this._rpx(v)).toFixed(2)); }
  }
  class Circle extends CircleMarker {
    _rpx() { const z = this._map?.getZoom() ?? 17, mpp = 156543.03392 * Math.cos(this._c.lat * D2R) / 2 ** z; return this.options.radius / mpp; }
    getBounds() { const r = this.options.radius, dLat = r / 111320, dLng = r / (111320 * Math.cos(this._c.lat * D2R)); return new LatLngBounds([[this._c.lat - dLat, this._c.lng - dLng], [this._c.lat + dLat, this._c.lng + dLng]]); }
  }

  // ── 마커 (HTML) ───────────────────────────────────────────
  const DEFAULT_ICON = { className: 'gl-pin', html: '<svg width="26" height="38" viewBox="0 0 26 38"><path d="M13 37C13 37 1 22 1 13a12 12 0 0 1 24 0c0 9-12 24-12 24z" fill="#ea4335" stroke="#a52714" stroke-width="1.5"/><circle cx="13" cy="13" r="4.5" fill="#fff"/></svg>', iconSize: [26, 38], iconAnchor: [13, 37] };
  class Marker extends Layer {
    constructor(c, o = {}) { super({ interactive: true, draggable: false, zIndexOffset: 0, ...o }); this._c = toLL(c); this._ov = null; this._div = null; this._tipLift = 10; }
    _addToMap(m) { this._ov = new OV(this); this._ov.setMap(m.gm); this._tipSync(); }
    _removeFromMap() { this._ov?.setMap(null); this._ov = null; this._tipDrop(); }
    _onAdd(panes) {
      const d = this._div = document.createElement('div'), ic = this.options.icon || DEFAULT_ICON, o = this.options;
      d.className = `leaflet-marker-icon gl-mk ${ic.className ?? 'leaflet-div-icon'}${o.interactive ? ' leaflet-interactive' : ''}`;
      d.innerHTML = ic.html || '';
      const sz = ic.iconSize ? toPt(ic.iconSize) : null, an = ic.iconAnchor ? toPt(ic.iconAnchor) : sz ? new Point(sz.x / 2, sz.y / 2) : null;
      this._an = an || new Point(0, 0);
      Object.assign(d.style, { position: 'absolute', zIndex: String(200 + (o.zIndexOffset || 0)), pointerEvents: o.interactive || o.draggable ? 'auto' : 'none', ...(sz ? { width: sz.x + 'px', height: sz.y + 'px' } : {}) });
      if (o.title) d.title = o.title;
      (o.interactive || o.draggable ? panes.overlayMouseTarget : panes.overlayLayer).appendChild(d);
      if (o.interactive || o.draggable) {
        g.OverlayView.preventMapHitsAndGesturesFrom(d); // 마커를 누르면 지도 클릭으로 넘어가지 않음 (Leaflet 마커와 같음)
        d.addEventListener('click', e => { if (this._dragged) return; this._tipShow(true); clearTimeout(this._tt); this._tt = setTimeout(() => this._tipShow(false), 2500); this.fire('click', { latlng: this._c, originalEvent: e }); });
        d.addEventListener('dblclick', e => this.fire('dblclick', { latlng: this._c, originalEvent: e }));
        d.addEventListener('mouseenter', () => this._tipShow(true)); d.addEventListener('mouseleave', () => this._tipShow(false));
      }
      if (o.draggable) this._dragBind(d);
    }
    _dragBind(d) {
      d.style.touchAction = 'none'; d.style.cursor = 'grab';
      d.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation(); d.setPointerCapture(e.pointerId);
        const pr = this._ov.getProjection(), st = pr.fromLatLngToDivPixel(new g.LatLng(this._c.lat, this._c.lng)), x0 = e.clientX, y0 = e.clientY;
        this._dragged = false; this.fire('dragstart');
        const mv = ev => { const dx = ev.clientX - x0, dy = ev.clientY - y0; if (Math.hypot(dx, dy) > 3) this._dragged = true; if (!this._dragged) return; this._c = toLL(pr.fromDivPixelToLatLng(new g.Point(st.x + dx, st.y + dy))); this._place(pr); this._tipOv?.draw(); this.fire('drag', { latlng: this._c }).fire('move', { latlng: this._c }); };
        const up = () => { d.removeEventListener('pointermove', mv); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up); if (this._dragged) this.fire('dragend', { latlng: this._c }); setTimeout(() => (this._dragged = false), 0); };
        d.addEventListener('pointermove', mv); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
      });
    }
    _draw(pr) { this._place(pr); }
    _place(pr) { if (!this._div || !pr) return; const q = pr.fromLatLngToDivPixel(new g.LatLng(this._c.lat, this._c.lng)); this._div.style.left = q.x - this._an.x + 'px'; this._div.style.top = q.y - this._an.y + 'px'; }
    _onRemove() { this._div?.remove(); this._div = null; }
    _anchor() { return this._c; }
    setLatLng(c) { this._c = toLL(c); if (this._ov) this._place(this._ov.getProjection()); this._tipOv?.draw(); this.fire('move', { latlng: this._c }); return this; }
    getLatLng() { return this._c; }
    setIcon(ic) { this.options.icon = ic; if (this._map) { const m = this._map; this._removeFromMap(); this._addToMap(m); } return this; }
    setOpacity(a) { this.options.opacity = a; if (this._div) this._div.style.opacity = a; return this; }
    setZIndexOffset(z) { this.options.zIndexOffset = z; if (this._div) this._div.style.zIndex = String(200 + z); return this; }
    getElement() { return this._div; }
    getBounds() { return new LatLngBounds([this._c, this._c]); }
  }

  // ── 묶음 ─────────────────────────────────────────────────
  class LayerGroup extends Layer {
    constructor(ls = []) { super(); this._layers = new Set(); ls.forEach(l => this.addLayer(l)); }
    addLayer(l) { if (l._group && l._group !== this) l.remove(); l._group = this; this._layers.add(l); if (this._map) l.addTo(this._map); return this; }
    removeLayer(l) { if (this._layers.has(l)) l.remove(); return this; }
    hasLayer(l) { return this._layers.has(l); }
    clearLayers() { [...this._layers].forEach(l => l.remove()); this._layers.clear(); return this; }
    eachLayer(fn) { [...this._layers].forEach(fn); return this; }
    getLayers() { return [...this._layers]; }
    getBounds() { const b = new LatLngBounds(); this._layers.forEach(l => l.getBounds && b.extend(l.getBounds())); return b; }
    _addToMap(m) { this._layers.forEach(l => l.addTo(m)); }
    _removeFromMap() { this._layers.forEach(l => { const gr = l._group; l._group = null; l.remove(); l._group = gr; }); }
    addTo(t) { if (t instanceof LayerGroup) { t.addLayer(this); return this; } this._map = t; t._layers.add(this); this._addToMap(t); this.fire('add'); return this; }
    remove() {
      if (this._group) { const gr = this._group; this._group = null; gr._layers.delete(this); }
      if (this._map) { const m = this._map; this._map = null; this._layers.forEach(l => { const gr = l._group; l._group = null; l.remove(); l._group = gr; }); m._layers.delete(this); this.fire('remove'); }
      return this;
    }
  }

  // ── 지도 위 단추 (오른쪽 위 전체 화면 등) ─────────────────────
  const POS = { topright: g.ControlPosition.RIGHT_TOP, topleft: g.ControlPosition.LEFT_TOP, bottomright: g.ControlPosition.RIGHT_BOTTOM, bottomleft: g.ControlPosition.LEFT_BOTTOM };
  class Control {
    constructor(o = {}) { this.options = { position: 'topright', ...o }; }
    addTo(m) { this._map = m; const el = this.onAdd?.(m); if (!el) return this; this._el = el; el.classList.add('gl-ctrl'); const arr = m.gm.controls[POS[this.options.position] ?? POS.topright]; arr.push(el); this._arr = arr; return this; }
    remove() { if (this._arr && this._el) { const i = this._arr.getArray().indexOf(this._el); if (i >= 0) this._arr.removeAt(i); } this.onRemove?.(this._map); return this; }
    static extend(proto) { const C = class extends Control {}; Object.assign(C.prototype, proto); return C; }
  }
  const DomUtil = { create(tag, cls, parent) { const e = document.createElement(tag); if (cls) e.className = cls; parent?.appendChild(e); return e; } };
  const DomEvent = { disableClickPropagation(el) { ['click', 'dblclick', 'pointerdown', 'mousedown', 'touchstart'].forEach(t => el.addEventListener(t, e => e.stopPropagation())); return DomEvent; }, stopPropagation(e) { e.stopPropagation(); return DomEvent; }, on(el, t, fn) { el.addEventListener(t, fn); return DomEvent; }, off(el, t, fn) { el.removeEventListener(t, fn); return DomEvent; } };
  // 바탕 그림 층은 구글 지도가 직접 그리므로 빈 층 (Leaflet 코드가 불러도 문제없게)
  class TileLayer extends Layer { constructor(u, o) { super(o); } _addToMap() {} _removeFromMap() {} static extend(p) { const C = class extends TileLayer {}; Object.assign(C.prototype, p); return C; } }

  return {
    __google: true, version: 'google-' + (g.version || ''),
    map: (el, o) => new GMap(typeof el === 'string' ? document.getElementById(el) : el, o),
    marker: (c, o) => new Marker(c, o), circleMarker: (c, o) => new CircleMarker(c, o), circle: (c, o) => new Circle(c, typeof o === 'number' ? { radius: o } : o),
    polyline: (l, o) => new Polyline(l, o), polygon: (l, o) => new Polygon(l, o), layerGroup: l => new LayerGroup(l), featureGroup: l => new LayerGroup(l),
    divIcon: o => ({ className: 'leaflet-div-icon', ...o }), icon: o => ({ className: '', html: o?.iconUrl ? `<img src="${o.iconUrl}" alt="">` : '', ...o }),
    latLng: (a, b) => (b != null ? new LatLng(a, b) : toLL(a)), latLngBounds: (a, b) => new LatLngBounds(a, b), point: (x, y) => (y != null ? new Point(x, y) : toPt(x)),
    tileLayer: (u, o) => new TileLayer(u, o), TileLayer, Control, control: { zoom: () => ({ addTo() { return this; }, remove() { return this; } }) },
    DomUtil, DomEvent, LatLng, LatLngBounds, Point, Map: GMap, Marker, Polyline, Polygon, Circle, CircleMarker, LayerGroup,
  };
}

// 구글 지도 스크립트 불러오기 (한 번만) · 늦거나 실패하면 null
let loading = null;
export function loadGoogleMaps(key, { timeout = 7000 } = {}) {
  if (window.google?.maps?.Map) return Promise.resolve(window.google);
  if (loading) return loading;
  loading = new Promise(res => {
    const cb = '__pinpointGM' + Date.now();
    const done = v => { clearTimeout(t); delete window[cb]; res(v); };
    const t = setTimeout(() => done(null), timeout);
    window[cb] = () => done(window.google?.maps?.Map ? window.google : null);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=ko&callback=${cb}&loading=async`;
    s.async = true; s.onerror = () => done(null);
    document.head.appendChild(s);
  });
  return loading;
}

// 설정·관리자의 '연결 시험': 구글 지도 스크립트를 불러오고 보이지 않는 작은 지도를 만들어 키가 받아들여지는지 (4초)
export async function testMapsJs(key) {
  const google = await loadGoogleMaps(key, { timeout: 8000 });
  if (!google) return { ok: false, why: '구글 지도 스크립트를 불러오지 못했어요 (인터넷 확인)' };
  return new Promise(res => {
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:200px'; document.body.appendChild(box);
    let done = false; const fin = r => { if (done) return; done = true; window.gm_authFailure = prev; box.remove(); res(r); };
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => { prev?.(); fin({ ok: false, why: '키가 거부됐어요 (Maps JavaScript API가 꺼져 있거나 키 제한에 이 주소가 없음)' }); };
    const m = new google.maps.Map(box, { center: { lat: 37.5, lng: 127 }, zoom: 15, mapTypeId: 'satellite', disableDefaultUI: true });
    google.maps.event.addListenerOnce(m, 'tilesloaded', () => setTimeout(() => fin({ ok: true }), 1200));
    setTimeout(() => fin({ ok: !box.querySelector('.gm-err-container') && !!box.querySelector('.gm-style'), why: '응답이 늦어요' }), 5000);
  });
}
