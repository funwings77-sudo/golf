// ⑥ 티샷 각도·힘(클럽) 계산: 내 샷 분산 기반 기대 타수 최소화
import { S, allowed, activeHole, FEATURE_NAMES } from '../core/state.js';
import { distance, bearing, bearingVec } from '../core/geo.js';
import { Sensors } from '../core/sensors.js';
import { optimizeTeeShot, describeAim } from '../physics/strategy.js';
import { RHO_STD } from '../physics/flight.js';
import { createMap, destroyMap, drawHole, fitHole, ll, localHole, toLL, labelIcon } from '../map.js';
import { $, $$, esc, toast, lockedCard, DU, signed } from '../ui.js';

let map, holeLayer, ovl, fromMe = false, windMode = 'auto', windManual = { speed: 0, rel: 'head' }, App_;

export default {
  mount(el, App) {
    App_ = App;
    const hole = activeHole();
    if (!hole || !hole.tee || !hole.green) {
      el.innerHTML = `<div class="card"><b>티샷 공략에는 코스의 티·그린 위치가 필요합니다</b><p class="sub">코스 관리에서 홀의 티, 그린, 해저드(OB·물·벙커·숲)를 지도에 찍어 주세요.</p><a class="btn primary" href="#/courses">코스 관리</a></div>`;
      return;
    }
    el.innerHTML = `<div class="mapwrap half" style="border-radius:14px;overflow:hidden"><div class="map" id="map"></div></div>
      <div id="teeBody"></div>`;
    map = createMap($('#map', el), { center: ll(hole.tee), zoom: 16 });
    if (map) { holeLayer = drawHole(map, hole); ovl = L.layerGroup().addTo(map); fitHole(map, hole); }
    renderBody();
  },
  unmount() { destroyMap(map); map = null; },
  onHole() { const h = activeHole(); if (map && h) { drawHole(map, h, holeLayer); fitHole(map, h); } renderBody(); },
};

function weatherFor(brg) {
  const w = App_.weather;
  if (!allowed('windAdjust')) return { windSpeed: 0, windFrom: 0, rho: RHO_STD };
  if (windMode === 'auto') return { windSpeed: w?.windSpeed || 0, windFrom: w?.windFrom || 0, rho: w?.rho || RHO_STD, src: w ? '기상 API' : '바람 정보 없음' };
  const off = { head: 0, tail: 180, l2r: -90, r2l: 90 }[windManual.rel];
  return { windSpeed: windManual.speed, windFrom: (brg + off + 360) % 360, rho: w?.rho || RHO_STD, src: '수동 입력' };
}

function renderBody() {
  const body = $('#teeBody'); if (!body) return;
  const hole = activeHole(); if (!hole) return;
  const start = fromMe && Sensors.pos ? Sensors.pos : hole.tee;
  const pin = hole.pin || hole.green;
  const dPin = distance(start, pin);
  const controls = `<div class="card tight"><div class="row"><div class="seg grow" id="fromSeg"><button data-v="tee" class="${!fromMe ? 'on' : ''}">티에서</button><button data-v="me" class="${fromMe ? 'on' : ''}">현재 위치에서</button></div></div>
    <div class="row" style="margin-top:8px"><span class="sub">핀까지 직선</span> <b class="mid">${DU(dPin)}</b><span class="grow"></span><span class="sub">핸디캡 ${S.settings.hcp}</span></div>
    ${hole.note ? `<p class="sub" style="margin:6px 0 0">📝 골프장 공략 메모: ${esc(hole.note)}</p>` : ''}</div>`;
  if (!allowed('clubRec')) {
    body.innerHTML = controls + lockedCard(FEATURE_NAMES.clubRec);
    bindFrom(); ovl?.clearLayers(); return;
  }
  const brg0 = bearing(start, hole.ip && !fromMe ? hole.ip : hole.green);
  const wx = weatherFor(brg0);
  body.innerHTML = controls + `<div class="card tight"><div class="row"><span class="sub">바람</span>
      <div class="seg grow" id="windSeg"><button data-v="auto" class="${windMode === 'auto' ? 'on' : ''}">자동</button><button data-v="manual" class="${windMode === 'manual' ? 'on' : ''}">직접</button></div></div>
      ${windMode === 'manual' ? `<div class="row" style="margin-top:8px"><select id="wRel" class="grow">${[['head', '맞바람'], ['tail', '뒷바람'], ['l2r', '왼→오른'], ['r2l', '오른→왼']].map(([k, n]) => `<option value="${k}" ${windManual.rel === k ? 'selected' : ''}>${n}</option>`).join('')}</select><input type="number" id="wSpd" style="width:110px" min="0" max="20" step="0.5" value="${windManual.speed}"><span class="sub">m/s</span></div>`
      : `<p class="sub">${wx.src} · ${wx.windSpeed.toFixed(1)} m/s ${dirName(wx.windFrom)}에서</p>`}</div>
    <div id="rec"><div class="empty">몬테카를로 계산 중…</div></div>`;
  bindFrom();
  $$('#windSeg button').forEach(b => b.onclick = () => { windMode = b.dataset.v; renderBody(); });
  $('#wRel')?.addEventListener('change', e => { windManual.rel = e.target.value; renderBody(); });
  $('#wSpd')?.addEventListener('change', e => { windManual.speed = Math.max(0, +e.target.value || 0); renderBody(); });
  setTimeout(() => compute(hole, start, wx), 30);
}

function bindFrom() {
  $$('#fromSeg button').forEach(b => b.onclick = () => {
    if (b.dataset.v === 'me' && !Sensors.pos) return toast('현재 위치를 확인 중입니다');
    fromMe = b.dataset.v === 'me'; renderBody();
  });
}

function compute(hole, start, wx) {
  const lh = localHole(hole, start);
  const res = optimizeTeeShot({ hole: lh, bag: S.bag, hcp: S.settings.hcp, weather: wx });
  const rec = $('#rec'); if (!rec) return;
  if (!res) { rec.innerHTML = '<div class="card">사용 가능한 클럽이 없습니다. 내 백에서 클럽을 켜세요.</div>'; return; }
  const b = res.best, aim = describeAim(b, lh);
  const ct = S.bag.find(c => c.id === b.club);
  rec.innerHTML = `<div class="card">
      <div class="sub">추천 (기대 타수 최소)</div>
      <div class="row"><div class="mid grow">${esc(b.clubName)} · ${Math.round(b.swing * 100)}% 스윙</div><span class="pill">기대 ${b.es.toFixed(2)}타</span></div>
      <p style="margin:6px 0 2px"><b>조준:</b> ${aim.text}${aim.landmark ? ` · ${esc(aim.landmark)}` : ''}</p>
      <p class="sub" style="margin:0">예상 캐리 ${DU(b.carry)}${Math.abs(b.drift) > 1 ? ` · 바람 ${b.drift > 0 ? '오른쪽' : '왼쪽'} ${DU(Math.abs(b.drift))} 밀림` : ''} · 노란 타원 = 탄착 95% 범위</p>
      <div class="grid3" style="margin-top:10px">
        <div class="stat"><div class="v">${Math.round(b.pFw * 100)}%</div><div class="l">페어웨이/그린</div></div>
        <div class="stat"><div class="v" style="color:var(--warn)">${Math.round(b.pHaz * 100)}%</div><div class="l">해저드·숲</div></div>
        <div class="stat"><div class="v" style="color:var(--danger)">${Math.round(b.pOB * 100)}%</div><div class="l">OB</div></div>
      </div>
      <p class="sub" style="margin-top:8px">분산: 좌우 ±${(ct?.sdLat ?? 4.5).toFixed(1)}° · 거리 ±${Math.round((ct?.sdDist ?? 0.07) * 100)}% ${ct?.learned ? `(내 샷 ${ct.n}개 학습)` : '(핸디캡 기본값 — 샷 기록 시 개인화)'}</p>
    </div>
    <h3>클럽별 최선</h3>
    <div class="tblwrap"><table class="score"><tr><th>클럽</th><th>스윙</th><th>조준</th><th>기대타수</th><th>OB</th></tr>
    ${res.perClub.map(r => `<tr><td>${esc(r.clubName)}</td><td>${Math.round(r.swing * 100)}%</td><td>${r.aim === 0 ? '중앙' : (r.aim < 0 ? '좌 ' : '우 ') + Math.abs(r.aim) + '°'}</td><td><b>${r.es.toFixed(2)}</b> <span class="sub">${r === b ? '' : signed(r.es - b.es, 2)}</span></td><td>${Math.round(r.pOB * 100)}%</td></tr>`).join('')}
    </table></div>
    <p class="sub">모델: 3자유도 탄도(바람 로그 프로파일·공기밀도) + 클럽 분산 몬테카를로 ${220}회/후보 + 아마추어 기대 타수표. 카메라 AR 조준선 대신 지도 위 조준선으로 표시합니다.</p>`;
  if (map && ovl) {
    ovl.clearLayers();
    const o = lh.origin;
    const u = bearingVec(b.bearing), far = { x: u.x * (b.carry + 40), y: u.y * (b.carry + 40) };
    L.polyline([ll(start), ll(toLL(o, far))], { color: '#ffe27a', weight: 3 }).addTo(ovl);
    L.polygon(b.ellipse.map(p => ll(toLL(o, p))), { color: '#ffe27a', weight: 2, fillOpacity: 0.12 }).addTo(ovl);
    for (const p of b.pts.slice(0, 120)) L.circleMarker(ll(toLL(o, p)), { radius: 1.5, color: '#fff', weight: 0, fillOpacity: 0.7, interactive: false }).addTo(ovl);
    L.marker(ll(toLL(o, aim.aimPoint)), { icon: labelIcon('조준 ' + DU(b.carry), 'y'), interactive: false }).addTo(ovl);
  }
}
function dirName(d) { return ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round(((d % 360) + 360) % 360 / 45) % 8]; }
