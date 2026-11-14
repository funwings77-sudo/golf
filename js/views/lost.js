// ⑦ 분실구 위치 안내: 샷 위치 → 날아간 방향 가리키기 → 낙하 확률 구역 → 레이더 길안내(핫/콜드·3분) → 근접 카메라 탐지
import { S, save, activeHole } from '../core/state.js';
import { toLocal, fromLocal, distance, bearing, normAngle, toRad } from '../core/geo.js';
import { Sensors, onPos, onOrientation, sampleFix, vibrate, speak } from '../core/sensors.js';
import { estimateLanding, addMark, markSearched, guidance, hapticInterval, relativeArrow } from '../physics/lostball.js';
import { conditionsEffect, clubType } from '../physics/flight.js';
import { openCamera, BallDetector, GroundProjector, cameraPitchDeg, coverTransform } from '../core/camera.js';
import { RULES } from '../core/rules.js';
import { createMap, destroyMap, drawHole, ll, toLL } from '../map.js';
import { $, $$, esc, toast, sheet, DU, clubOptions, confBadge, mmss } from '../ui.js';
import { learnClub } from '../core/score.js';

const SEARCH_MS = 3 * 60 * 1000;
let el_, App_, unPos, unOri, map, layer, est = null, prevDist = null, buzzT = null, tickT = null, view = 'radar', markMode = false;
let cam = null; // { stop, raf }
let lostLog = (() => { try { return JSON.parse(localStorage.getItem('pinpoint.lostLog') || '[]'); } catch { return []; } })();

export default {
  mount(el, App) { el_ = el; App_ = App; S.lost ? searchUI() : setupUI(); },
  unmount() { cleanup(); },
};
function cleanup() {
  unPos && unPos(); unOri && unOri(); unPos = unOri = null;
  clearTimeout(buzzT); clearInterval(tickT); stopCam(); destroyMap(map); map = null;
}

// 학습된 방위 오차 배율 (발견 기록이 쌓일수록 실제 오차에 맞춰짐)
function sigmaScale() {
  const L = lostLog.slice(-20); if (L.length < 3) return 1;
  const m = L.reduce((a, x) => a + x.z2, 0) / L.length; // 정규화 오차² 평균 (2D 기대값 2)
  return Math.max(0.7, Math.min(2, Math.sqrt(m / 2)));
}

// ---------- 1단계: 샷 정보 ----------
function setupUI() {
  cleanup();
  const ps = App_.pendingShot && Date.now() - App_.pendingShot.ts < 10 * 60 * 1000 ? App_.pendingShot : null;
  const hole = activeHole();
  const draft = { start: ps ? { lat: ps.lat, lon: ps.lon } : null, startSrc: ps ? (ps.auto ? '스윙 감지 위치' : '샷 기록 위치') : null, club: ps?.club || (hole && hole.tee && Sensors.pos && distance(hole.tee, Sensors.pos) < 30 ? 'D' : '7i'), bearing: null, bSrc: null, feel: 'normal', curve: 'straight' };
  el_.innerHTML = `<h2>📡 분실구 안내</h2>
    <div class="card"><b>정직한 전제</b><p class="sub">공 자체가 신호를 내지 않는 한 GPS만으로 정확한 위치는 알 수 없습니다. 낙하 지점을 확률로 추정해 탐색 범위를 반경 10~15m로 좁히고, 가까이 가면 카메라가 마지막 몇 미터를 찾아줍니다.</p></div>
    <div class="card"><div class="row"><b class="grow">1. 샷 위치</b><span id="startLbl" class="sub"></span></div>
      <div class="grid2" style="margin-top:8px"><button class="btn" id="stHere">📍 지금 위치</button>${hole?.tee ? '<button class="btn" id="stTee">⛳ 이 홀 티</button>' : '<span></span>'}</div>
      <label class="f"><span>클럽</span><select id="club">${clubOptions(draft.club)}</select></label></div>
    <div class="card"><div class="row"><b class="grow">2. 공이 사라진 방향</b><span id="brgLbl" class="sub"></span></div>
      <p class="sub">휴대폰 윗부분을 공이 사라진(떨어진) 쪽으로 향하게 들고 버튼을 누르세요. 나침반이 없으면 지도에서 그 방향을 탭하세요.</p>
      <div class="row"><span class="arrow-big" id="liveArrow">⬆</span><div class="grow"><div class="mid" id="liveHead">—</div><div class="sub">현재 휴대폰 방위</div></div></div>
      <button class="btn primary block" id="capDir" style="margin-top:8px">🧭 이 방향으로 날아갔어요</button>
      <div class="mapwrap half" style="margin-top:10px;border-radius:12px;overflow:hidden;height:34vh;min-height:220px"><div class="map" id="map"></div></div>
      <label class="f"><span>거리감</span><div class="seg" id="feelSeg"><button data-v="short">짧게 맞음</button><button data-v="normal" class="on">보통</button><button data-v="long">잘 맞음</button></div></label>
      <label class="f"><span>휨 (가리킨 방향 기준 마지막 휨)</span><div class="seg" id="curveSeg"><button data-v="left">왼쪽</button><button data-v="straight" class="on">직선</button><button data-v="right">오른쪽</button></div></label>
      <label class="f"><span>방향 확신도</span><div class="seg" id="sureSeg"><button data-v="5">확실</button><button data-v="8" class="on">대략</button><button data-v="14">잘 못 봄</button></div></label>
    </div>
    <button class="btn primary block" id="go" disabled>낙하 예상 구역 계산</button>`;
  let sigma = 8;
  const upd = () => {
    $('#startLbl').textContent = draft.start ? `${draft.startSrc}` : '미지정';
    $('#brgLbl').textContent = draft.bearing != null ? `${Math.round(draft.bearing)}° (${draft.bSrc})` : '미지정';
    $('#go').disabled = !(draft.start && draft.bearing != null);
    drawSetupMap();
  };
  map = createMap($('#map'), { center: ll(draft.start || Sensors.pos || hole?.tee || { lat: 37.5, lon: 127 }), zoom: 17 });
  if (map) { drawHole(map, hole); layer = L.layerGroup().addTo(map); map.on('click', e => { if (!draft.start) return toast('먼저 샷 위치를 지정하세요'); draft.bearing = bearing(draft.start, { lat: e.latlng.lat, lon: e.latlng.lng }); draft.bSrc = '지도'; upd(); }); }
  function drawSetupMap() {
    if (!map || !layer) return; layer.clearLayers();
    if (draft.start) { L.circleMarker(ll(draft.start), { radius: 6, color: '#fff', fillColor: '#ffe27a', fillOpacity: 1 }).addTo(layer); }
    if (draft.start && draft.bearing != null) {
      const ct = S.bag.find(c => c.id === draft.club);
      const end = fromLocal(draft.start, { x: Math.sin(toRad(draft.bearing)) * (ct?.carry || 150) * 1.2, y: Math.cos(toRad(draft.bearing)) * (ct?.carry || 150) * 1.2 });
      L.polyline([ll(draft.start), ll(end)], { color: '#ffe27a', weight: 3, dashArray: '6 6' }).addTo(layer);
      map.fitBounds(L.latLngBounds([ll(draft.start), ll(end)]), { padding: [30, 30] });
    }
  }
  $('#stHere').onclick = async () => { toast('위치 측정 중…'); const f = await sampleFix(2000); if (!f) return toast('위치를 얻지 못했습니다'); draft.start = { lat: f.lat, lon: f.lon }; draft.startSrc = `현재 위치 ±${Math.round(f.acc)}m`; upd(); };
  $('#stTee') && ($('#stTee').onclick = () => { draft.start = { ...hole.tee }; draft.startSrc = `${hole.n}번 홀 티`; upd(); });
  $('#club').onchange = e => { draft.club = e.target.value; upd(); };
  $('#capDir').onclick = async () => {
    if (Sensors.heading == null) return toast('나침반을 사용할 수 없습니다 — 지도에서 방향을 탭하세요');
    if (!draft.start) return toast('먼저 샷 위치를 지정하세요');
    const hs = []; const un = onOrientation(s => s.heading != null && hs.push(s.heading));
    await new Promise(r => setTimeout(r, 900)); un();
    const ref = hs[0] ?? Sensors.heading; const mean = ref + hs.reduce((a, h) => a + normAngle(h - ref), 0) / Math.max(1, hs.length);
    draft.bearing = (mean + 360) % 360; draft.bSrc = '나침반'; vibrate(50); upd();
  };
  const seg = (id, fn) => $$(`#${id} button`).forEach(b => b.onclick = () => { $$(`#${id} button`).forEach(x => x.classList.toggle('on', x === b)); fn(b.dataset.v); });
  seg('feelSeg', v => draft.feel = v); seg('curveSeg', v => draft.curve = v); seg('sureSeg', v => sigma = +v);
  unOri = onOrientation(s => { if (s.heading == null) return; const a = $('#liveArrow'), h = $('#liveHead'); if (!a) return; h.textContent = Math.round(s.heading) + '°'; });
  $('#go').onclick = () => {
    S.lost = { ...draft, sigma, marks: [], searched: [], createdAt: Date.now(), searchStartAt: null, hole: hole?.n || null };
    save('lost'); App_.pendingShot = null;
    searchUI();
  };
  upd();
}

function computeEst() {
  const L0 = S.lost, o = L0.start;
  const ct = S.bag.find(c => c.id === L0.club) || { carry: 150, sdDist: 0.08 };
  const type = clubType(L0.club) || { roll: 0.04 };
  const hole = activeHole();
  let drift = 0;
  const w = App_.weather;
  if (w && w.windSpeed) { try { drift = conditionsEffect(L0.club, ct.carry, { windSpeed: w.windSpeed, windFromDeg: w.windFrom, shotBearing: L0.bearing, rho: w.rho }).lateral; } catch {} }
  const hazards = (hole?.hazards || []).map(z => ({ ...toLocal(o, z), r: z.r, type: z.type }));
  let e = estimateLanding({
    start: { x: 0, y: 0 }, bearing: L0.bearing, sigmaBearing: L0.sigma * sigmaScale(),
    club: { carry: ct.carry, sdDist: ct.sdDist ?? 0.08, roll: type.roll }, distFeel: L0.feel, curve: L0.curve, drift, hazards,
  });
  for (const m of L0.marks) e = addMark(e, { ...toLocal(o, m), sigma: m.sigma });
  for (const s of L0.searched) e = markSearched(e, toLocal(o, s), s.r);
  return e;
}

// ---------- 2단계: 레이더 길안내 ----------
function searchUI() {
  cleanup();
  est = computeEst(); prevDist = null;
  const L0 = S.lost;
  el_.innerHTML = `<div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">📡 공 찾는 중</h2>${confBadge(est.confidence)}</div>
    <div class="seg" id="viewSeg"><button data-v="radar" class="${view === 'radar' ? 'on' : ''}">레이더</button><button data-v="map" class="${view === 'map' ? 'on' : ''}">지도</button></div>
    <div id="radarBox" style="margin-top:10px;${view === 'radar' ? '' : 'display:none'}"><div class="radar"><canvas id="radar" width="600" height="600"></canvas></div></div>
    <div id="mapBox" class="mapwrap half" style="margin-top:10px;border-radius:14px;overflow:hidden;${view === 'map' ? '' : 'display:none'}"><div class="map" id="map"></div></div>
    <div class="card" id="guide"></div>
    <div class="card tight"><div class="row"><span class="sub grow">탐색 시간 (규칙 18.2: 3분)</span><b id="tLeft">3:00</b></div><div class="timebar" id="tbar"><i style="width:0%"></i></div>
      <div class="row" style="margin-top:8px"><button class="btn small" id="tStart">⏱ 탐색 시작</button><span class="sub grow">구역 안에 들어서면 자동 시작</span></div></div>
    <div class="grid2"><button class="btn" id="bCam">📷 카메라 탐지</button><button class="btn" id="bSearched">🔍 여기 없음</button>
      <button class="btn" id="bMark">👥 동반자 마킹</button><button class="btn" id="bRedo">↺ 다시 입력</button></div>
    <div class="grid2" style="margin-top:8px"><button class="btn primary" id="bFound">✅ 찾았다!</button><button class="btn danger" id="bLost">✖ 못 찾음</button></div>
    <p class="sub">반경 80% 탐색원 ${DU(est.r80)} · 파티클 ${est.parts.length}개 · 방위 오차 σ ${(L0.sigma * sigmaScale()).toFixed(1)}° ${lostLog.length >= 3 ? `(발견 기록 ${lostLog.length}건으로 보정)` : ''}</p>`;
  $$('#viewSeg button').forEach(b => b.onclick = () => { view = b.dataset.v; $$('#viewSeg button').forEach(x => x.classList.toggle('on', x === b)); $('#radarBox').style.display = view === 'radar' ? '' : 'none'; $('#mapBox').style.display = view === 'map' ? '' : 'none'; if (view === 'map') { setTimeout(() => map?.invalidateSize(), 30); drawSearchMap(true); } });
  map = createMap($('#map'), { center: ll(L0.start), zoom: 18 });
  if (map) {
    drawHole(map, activeHole()); layer = L.layerGroup().addTo(map);
    map.on('click', e => {
      if (!markMode) return;
      S.lost.marks.push({ lat: e.latlng.lat, lon: e.latlng.lng, sigma: 8 }); save('lost'); markMode = false;
      $('#bMark').classList.remove('on'); toast('동반자 마킹 반영 — 구역을 좁혔습니다'); est = computeEst(); update(true);
    });
  }
  $('#tStart').onclick = startTimer;
  $('#bCam').onclick = cameraUI;
  $('#bSearched').onclick = () => {
    if (!Sensors.pos) return toast('위치를 확인 중입니다');
    S.lost.searched.push({ lat: Sensors.pos.lat, lon: Sensors.pos.lon, r: 6 }); save('lost');
    est = computeEst(); toast('수색 완료 표시 — 다음 유력 지점으로 안내합니다'); update(true);
  };
  $('#bMark').onclick = e => {
    sheet({
      title: '동반자 마킹', body: '<p class="sub">동반자가 공을 본 위치를 알려주면 확률 구역이 좁아집니다.</p>',
      actions: [
        { label: '지도에서 탭', onClick: () => { markMode = true; view = 'map'; $('#viewSeg button[data-v=map]').click(); $('#bMark').classList.add('on'); toast('동반자가 본 위치를 지도에서 탭하세요'); } },
        { label: '지금 내 위치 근처', kind: 'primary', onClick: () => { if (!Sensors.pos) return; S.lost.marks.push({ lat: Sensors.pos.lat, lon: Sensors.pos.lon, sigma: 10 }); save('lost'); est = computeEst(); update(true); toast('반영했습니다'); } },
      ],
    });
  };
  $('#bRedo').onclick = () => { S.lost = null; save('lost'); setupUI(); };
  $('#bFound').onclick = found;
  $('#bLost').onclick = notFound;
  unPos = onPos(() => update());
  unOri = onOrientation(() => drawRadar());
  tickT = setInterval(tick, 500);
  update(true); buzzLoop();
}

function meLocal() { return Sensors.pos ? toLocal(S.lost.start, Sensors.pos) : null; }

function update(redrawMap = false) {
  const me = meLocal(), g = $('#guide'); if (!g) return;
  if (!me) { g.innerHTML = '<b>위치 확인 중…</b>'; drawRadar(); return; }
  const gd = guidance(est, me, prevDist);
  if (prevDist == null || Math.abs(gd.dist - prevDist) > 0.7) prevDist = gd.dist;
  const rel = relativeArrow(gd.bearing, Sensors.heading);
  const trendTxt = { closer: '🔥 가까워짐', farther: '🧊 멀어짐', same: '' }[gd.trend];
  g.innerHTML = `<div class="row"><div class="arrow-big" style="transform:rotate(${rel}deg)">⬆</div>
    <div class="grow"><div class="sub">유력 지점까지 ${Sensors.heading == null ? '(북쪽 기준 방위 ' + Math.round(gd.bearing) + '°)' : ''}</div><div class="big">${DU(gd.dist).replace(/(m|yd)$/, '<small>$1</small>')}</div><div><b>${trendTxt}</b></div></div></div>
    ${gd.nearDetect ? '<p style="margin:8px 0 0"><b>15m 이내 진입</b> — 카메라 탐지로 풀 속 공을 찾으세요.</p>' : ''}`;
  if (gd.inZone && !S.lost.searchStartAt) startTimer(true);
  if (gd.nearDetect && !update._prompted) { update._prompted = true; vibrate([100, 60, 100]); speak('15미터 이내입니다. 카메라 탐지를 켜세요'); }
  drawRadar();
  if (redrawMap || view === 'map') drawSearchMap(redrawMap);
}

function startTimer(auto) {
  if (S.lost.searchStartAt) return;
  S.lost.searchStartAt = Date.now(); save('lost');
  toast(auto === true ? '탐색 구역 진입 — 3분 타이머 시작' : '3분 타이머 시작');
}
function tick() {
  const t = S.lost?.searchStartAt; const bar = $('#tbar'); if (!bar) return;
  if (!t) return;
  const el = Date.now() - t, left = SEARCH_MS - el;
  $('#tLeft').textContent = left > 0 ? mmss(left) : '시간 초과';
  bar.firstElementChild.style.width = Math.min(100, el / SEARCH_MS * 100) + '%';
  bar.classList.toggle('late', left < 30000);
  if (left <= 0 && !tick._done) { tick._done = true; vibrate([300, 150, 300]); speak('탐색 시간 3분이 지났습니다'); toast('3분 경과 — 분실구 처리(못 찾음)를 진행하세요'); }
}
function buzzLoop() {
  clearTimeout(buzzT);
  const me = meLocal();
  if (me && est) { const d = Math.hypot(est.center.x - me.x, est.center.y - me.y); if (d < 60) vibrate(35); buzzT = setTimeout(buzzLoop, hapticInterval(d)); }
  else buzzT = setTimeout(buzzLoop, 1500);
}

function drawRadar() {
  const cv = $('#radar'); if (!cv || !est) return;
  const ctx = cv.getContext('2d'), W = cv.width, C = W / 2;
  const me = meLocal() || { x: 0, y: 0 };
  const dc = Math.hypot(est.center.x - me.x, est.center.y - me.y);
  const range = Math.max(30, dc + est.r80 * 1.6); const sc = (C - 20) / range;
  const rot = Sensors.heading != null ? -toRad(Sensors.heading) : 0; // 헤드업
  const P = (x, y) => { const dx = (x - me.x) * sc, dy = (y - me.y) * sc; return [C + dx * Math.cos(rot) - dy * Math.sin(rot), C - (dx * Math.sin(rot) + dy * Math.cos(rot))]; };
  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = '#13261b'; ctx.beginPath(); ctx.arc(C, C, C, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(120,220,160,.25)'; ctx.lineWidth = 2; ctx.fillStyle = 'rgba(160,230,190,.7)'; ctx.font = '22px sans-serif';
  for (const k of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(C, C, (C - 20) * k, 0, 7); ctx.stroke(); ctx.fillText(Math.round(range * k) + 'm', C + 6, C - (C - 20) * k + 22); }
  // 확률 입자
  ctx.fillStyle = 'rgba(255,200,80,.35)';
  const maxW = est.parts.reduce((a, p) => Math.max(a, p.w), 0) || 1;
  for (let i = 0; i < est.parts.length; i += 3) { const p = est.parts[i]; const [x, y] = P(p.x, p.y); ctx.globalAlpha = Math.min(1, 0.25 + p.w / maxW); ctx.fillRect(x - 2, y - 2, 4, 4); }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#ffc850'; ctx.setLineDash([8, 8]); ctx.lineWidth = 3; ctx.beginPath();
  est.ellipse.forEach((p, i) => { const [x, y] = P(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]);
  for (const s of S.lost.searched) { const q = toLocal(S.lost.start, s); const [x, y] = P(q.x, q.y); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(x, y, s.r * sc, 0, 7); ctx.stroke(); }
  const [tx, ty] = P(est.center.x, est.center.y);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(tx - 12, ty - 12); ctx.lineTo(tx + 12, ty + 12); ctx.moveTo(tx + 12, ty - 12); ctx.lineTo(tx - 12, ty + 12); ctx.stroke();
  const [sx, sy] = P(0, 0); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 7); ctx.fill();
  // 나
  ctx.fillStyle = '#4ad08a'; ctx.beginPath(); ctx.moveTo(C, C - 18); ctx.lineTo(C - 12, C + 12); ctx.lineTo(C + 12, C + 12); ctx.closePath(); ctx.fill();
  // 북쪽 표시
  ctx.fillStyle = '#e84c3d'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', C - (C - 34) * Math.sin(rot), C - (C - 34) * Math.cos(rot) + 9); ctx.textAlign = 'left';
}

function drawSearchMap(fit) {
  if (!map || !layer) return; layer.clearLayers();
  const o = S.lost.start;
  L.circleMarker(ll(o), { radius: 6, color: '#fff', fillColor: '#ffe27a', fillOpacity: 1 }).addTo(layer);
  for (let i = 0; i < est.parts.length; i += 6) { const p = est.parts[i]; L.circleMarker(ll(toLL(o, p)), { radius: 2, weight: 0, fillColor: '#ffc850', fillOpacity: 0.55, interactive: false }).addTo(layer); }
  L.polygon(est.ellipse.map(p => ll(toLL(o, p))), { color: '#ffc850', weight: 2, dashArray: '6 6', fillOpacity: 0.08 }).addTo(layer);
  L.circleMarker(ll(toLL(o, est.center)), { radius: 8, color: '#fff', weight: 3, fillOpacity: 0 }).addTo(layer);
  for (const s of S.lost.searched) L.circle(ll(s), { radius: s.r, color: '#fff', weight: 1, fillOpacity: 0.15 }).addTo(layer);
  for (const m of S.lost.marks) L.circleMarker(ll(m), { radius: 5, color: '#2b7bff', fillOpacity: 1 }).bindTooltip('동반자 마킹').addTo(layer);
  if (fit) map.fitBounds(L.latLngBounds([ll(o), ...est.ellipse.map(p => ll(toLL(o, p)))]), { padding: [30, 30] });
}

// ---------- 3단계: 근접 카메라 탐지 ----------
async function cameraUI() {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:55;background:#000';
  box.innerHTML = `<div class="cam" style="height:100%;border-radius:0"><video autoplay playsinline muted></video><canvas></canvas>
    <div class="hud top"><b>카메라 탐지</b> <span class="sub">휴대폰을 가슴 높이로 들고 천천히 좌우로 훑으세요. 흰 공 후보를 원으로 표시합니다.</span><div id="camStat" class="mid" style="margin-top:4px">탐색 중…</div></div>
    <div class="hud bottom"><div class="grid2"><button class="btn" id="camClose">닫기</button><button class="btn primary" id="camFound">✅ 찾았다</button></div></div></div>`;
  document.body.appendChild(box);
  const video = $('video', box), cv = $('canvas', box), ctx = cv.getContext('2d');
  const close = () => { stopCam(); box.remove(); };
  $('#camClose', box).onclick = close;
  $('#camFound', box).onclick = () => { close(); found(); };
  try {
    const stop = await openCamera(video);
    const det = new BallDetector({ width: 320 });
    const proj = new GroundProjector({ height: S.settings.phoneHeight, vfovDeg: S.settings.cameraVFov });
    let lastHit = 0;
    cam = { stop, t: null };
    const loop = () => {
      if (!cam) return;
      const pitch = cameraPitchDeg(); proj.pitchDeg = pitch != null && pitch > 3 ? pitch : 30;
      const hits = det.detect(video, proj);
      cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio;
      const T = coverTransform(video, cv); const k = devicePixelRatio;
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const h of hits) {
        const x = (T.ox + h.x * T.s) * k, y = (T.oy + h.y * T.s) * k, r = Math.max(18, h.r * T.s * k);
        ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, r + 10, 0, 7); ctx.stroke();
        ctx.fillStyle = '#ffe27a'; ctx.font = `bold ${16 * k}px sans-serif`; ctx.fillText(h.dist ? `공? ${h.dist.toFixed(1)}m` : '공?', x + r + 14, y);
      }
      const st = $('#camStat', box);
      if (hits.length) { st.textContent = `공 후보 ${hits.length}개${hits[0].dist ? ` · 가장 유력 ${hits[0].dist.toFixed(1)}m` : ''}`; if (Date.now() - lastHit > 1500) { vibrate(120); lastHit = Date.now(); } }
      else st.textContent = '탐색 중…';
      cam.t = setTimeout(loop, 110);
    };
    loop();
  } catch (e) {
    $('#camStat', box).textContent = '카메라를 열 수 없습니다: ' + e.message + ' (HTTPS 또는 권한 확인)';
  }
}
function stopCam() { if (cam) { clearTimeout(cam.t); cam.stop && cam.stop(); cam = null; } }

// ---------- 결과 처리 ----------
async function found() {
  const L0 = S.lost;
  const f = Sensors.pos ? await sampleFix(1500) : null;
  if (f) {
    const q = toLocal(L0.start, f);
    // 추정 정확도 학습: 실제 위치의 정규화 오차
    const st = est.stats, dx = q.x - st.mean.x, dy = q.y - st.mean.y;
    const c = Math.cos(st.angle), s = Math.sin(st.angle);
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    const z2 = (u / Math.max(2, st.sd1)) ** 2 + (v / Math.max(2, st.sd2)) ** 2;
    lostLog.push({ ts: Date.now(), z2, err: Math.hypot(dx, dy), club: L0.club });
    try { localStorage.setItem('pinpoint.lostLog', JSON.stringify(lostLog.slice(-50))); } catch {}
    // 비거리 학습 (풀샷이었다고 가정)
    const total = distance(L0.start, f), rollF = clubType(L0.club)?.roll || 0.03;
    S.shots.push({ id: Date.now(), club: L0.club, total, carry: total / (1 + rollF), latDeg: null, start: L0.start, end: { lat: f.lat, lon: f.lon }, ts: Date.now(), fromLost: true });
    const i = S.bag.findIndex(x => x.id === L0.club); if (i >= 0) S.bag[i] = learnClub(S.bag[i], S.shots);
    recordLostEvent(L0, { lat: f.lat, lon: f.lon }, true, 0);
    toast(`찾았습니다! 예측 중심에서 ${Math.hypot(dx, dy).toFixed(0)}m · ${L0.searchStartAt ? mmss(Date.now() - L0.searchStartAt) + ' 만에' : ''}`);
    save('shots', 'bag');
  } else toast('찾았습니다!');
  vibrate([80, 60, 80]);
  S.lost = null; save('lost'); setupUI();
}

function notFound() {
  const rule = RULES.find(r => r.id === 'lost');
  sheet({
    title: '분실구 처리', body: `<p class="sub">규칙 ${rule.rule}</p><ul class="tips">${rule.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      ${S.round ? '<p class="sub">선택하면 현재 홀 스코어에 벌타와 분실구 1개가 기록됩니다 (공 소모 추적).</p>' : ''}`,
    actions: [
      { label: '취소' },
      { label: 'E-5 (2벌타)', onClick: () => finishLost(2) },
      { label: '스트로크와 거리 (1벌타)', kind: 'primary', onClick: () => finishLost(1) },
    ],
  });
}
// 골프장 제출용 리포트용 분실구 기록 (내 라운드에만, 좌표는 리포트에서 반올림)
function recordLostEvent(L0, at, found, penalty) {
  if (!S.round || !at) return;
  S.round.lostEvents = S.round.lostEvents || [];
  S.round.lostEvents.push({ hole: L0.hole || S.ui.hole, lat: at.lat, lon: at.lon, found, penalty, searchSec: L0.searchStartAt ? Math.round((Date.now() - L0.searchStartAt) / 1000) : null, ts: Date.now() });
  save('round');
}
function finishLost(pen) {
  if (S.lost && est?.stats) recordLostEvent(S.lost, fromLocal(S.lost.start, est.stats.mean), false, pen);
  if (S.round) {
    const h = S.round.holes.find(x => x.n === (S.lost.hole || S.ui.hole));
    if (h) { const sc = h.scores[0]; sc.penalties += pen; sc.lost += 1; sc.strokes += pen; save('round'); }
  }
  toast(`${pen}벌타 · 분실구 1개 기록` + (pen === 1 ? ' — 직전 샷 위치에서 다시 치세요' : ' — 분실 지점 근처 페어웨이 쪽에 드롭'));
  S.lost = null; save('lost'); setupUI();
}
