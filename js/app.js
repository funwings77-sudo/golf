// PinPoint AI 캐디 — 앱 셸 (라우터 · 상단바 · 모드 · 안전 감시 · 스윙 감지)
import { S, save, MODES, activeCourse, currentMode, subscribe, onSaveFail, allowed } from './core/state.js';
import { startGPS, restartGPS, onPos, setSim, setVoice, startOrientation, startSwingDetect, vibrate, speak, Sensors, sampleFix, keepAwake } from './core/sensors.js';
import { fetchWeather } from './core/weather.js';
import { detectHoleByTee, dwell } from './core/course.js';
import { syncPins, getNotices, getCatalog, pendingUpdates } from './core/remote.js';
import { fetchLive } from './core/live.js';
import { gripSupported, startGripScan, stopGripScan, clubForEvent } from './core/grip.js';
import { onWatchSwing } from './core/watch.js';
import { configureVoice, onAudio, audioRoute, earButtons, say, holeIntro, ROUTE_WORD } from './core/voice.js';
import { holeHistory } from './core/insights.js';
import { $, $$, sheet, toast, esc, bottomMenuHTML } from './ui.js';
import { icon } from './icons.js';
import { startIconize } from './iconize.js';
import { checkAppUpdate, openDownload, isNative, isPlayBuild } from './core/appupdate.js';
import { APP_VERSION } from './core/appver.js';

const ROUTES = {
  home: () => import('./views/home.js'),
  play: () => import('./views/play.js'),
  distance: () => import('./views/distance.js'),
  tee: () => import('./views/tee.js'),
  lost: () => import('./views/lost.js'),
  green: () => import('./views/green.js'),
  lie: () => import('./views/lie.js'),
  score: () => import('./views/score.js'),
  courses: () => import('./views/courses.js'),
  bag: () => import('./views/bag.js'),
  shots: () => import('./views/shots.js'),
  rules: () => import('./views/rules.js'),
  safety: () => import('./views/safety.js'),
  history: () => import('./views/history.js'),
  calib: () => import('./views/calib.js'),
  settings: () => import('./views/settings.js'),
  about: () => import('./views/about.js'),
};

let current = null, currentName = null;
export const App = {
  weather: null,
  notices: [],       // 관리자 공지 (게시 중 · 현재 코스 대상)
  updates: [],       // 새 버전이 있는 공식 코스
  pendingShot: null, // 스윙 감지/샷 기록 시작점
  go(r) { location.hash = '#/' + r; },
  refreshHeader,
  // 칠 홀 순서 (라운드 중이면 라운드 순서, 아니면 코스 순서)
  holeOrder() { const c = activeCourse(); return S.round?.courseId === c?.id ? S.round.holes.map(h => h.n) : (c?.holes || []).map(h => h.n); },
  stepHole(d) {
    const o = App.holeOrder(); if (!o.length) return;
    const i = Math.max(0, o.indexOf(S.ui.hole)), j = i + d;
    if (S.round && j >= o.length) { // 마지막 홀에서 ▶ → 라운드 끝 화면 (1번 홀로 몰래 돌아가지 않게)
      if (current?.finishRound) current.finishRound(); else { App.pendingFinish = true; App.go('play'); }
      return;
    }
    if (S.round && j < 0) return toast('첫 홀이에요');
    App.setHole(o[(j + o.length) % o.length]);
  },
  manualAt: 0,
  setHole(n, { auto = false } = {}) {
    if (!auto) App.manualAt = Date.now();
    const c = activeCourse(); if (!c) return;
    if (!c.holes.some(h => h.n === n)) { const max = c.holes.length; n = ((n - 1 + max) % max) + 1; }
    S.ui.hole = n; save('ui');
    markHoleArrival(S.ui.hole);
    refreshHeader(); current?.onHole?.(S.ui.hole);
  },
};
window.App = App;

async function route() {
  const name = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'play';
  const loader = ROUTES[name] || ROUTES.home;
  try { current?.unmount?.(); } catch (e) { console.error(e); }
  const view = $('#view');
  view.className = ''; view.innerHTML = '<div class="empty">불러오는 중…</div>';
  $('#drawer').classList.remove('open');
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.r === name));
  bottomMenu(name);
  $$('#drawer a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + name));
  try {
    const mod = (await loader()).default;
    current = mod; currentName = name;
    view.innerHTML = '';
    if (mod.full) view.classList.add('full');
    await mod.mount(view, App);
  } catch (e) {
    console.error(e);
    logError(e);
    view.innerHTML = `<div class="card"><b>이 화면을 여는 중에 문제가 생겼어요</b><p class="sub">기록은 그대로 있어요. 다시 해 보거나 골프 치기로 돌아가 주세요.</p>
      <div class="grid2"><button class="btn" onclick="location.reload()">↻ 다시 시도</button><a class="btn primary" href="#/play">🏌️ 골프 치기</a></div>${S.settings.detail ? `<p class="sub">${esc(e.message)}</p>` : ''}</div>`;
  }
  refreshHeader();
}

function refreshHeader() {
  const c = activeCourse(), mode = currentMode();
  const chip = $('#modeChip');
  chip.textContent = S.settings.detail ? MODES[mode].short : ({ tournament: '🏆 대회', casual: '😊 친선', practice: '📚 연습' })[mode]; chip.className = 'mode-chip ' + mode;
  const nav = $('#holeNav');
  if (c) {
    const h = c.holes.find(x => x.n === S.ui.hole) || c.holes[0];
    nav.hidden = false;
    $('#holeLbl').textContent = h.nine ? `${h.nine.slice(0, 2)}${h.nineHole}` : 'H' + h.n;
    $('#ttlMain').textContent = c.name;
    $('#ttlSub').textContent = `${h.nineHole ?? h.n}번 홀 · 파 ${h.par}` + (S.round ? ' · 치는 중' : '');
  } else {
    nav.hidden = true; $('#ttlMain').textContent = 'PinPoint AI 캐디'; $('#ttlSub').textContent = '내 손안의 골프 캐디';
  }
}

function applySettings() {
  const st = S.settings, root = document.documentElement;
  root.classList.toggle('outdoor', !!st.outdoor);
  root.classList.toggle('bigtext', !!st.bigText);
  root.classList.toggle('easy', !st.detail);
  setVoice(!!st.voice);
  configureVoice({ rate: () => S.settings.voiceRate || 1 });
  earButtons(!!st.voice && st.voiceButtons !== false);
  if (st.simGPS !== Sensors.sim) setSim(!!st.simGPS);
}

function modeSheet() {
  const locked = !!S.round;
  sheet({
    title: '플레이 모드',
    body: Object.entries(MODES).map(([k, m]) => `<button class="list-btn" data-m="${k}" ${locked && k !== S.round.mode ? 'disabled style="opacity:.5"' : ''}>
      <span class="ico">${k === 'tournament' ? '🏆' : k === 'practice' ? '🧪' : '☀️'}</span><span class="grow"><b>${m.label}</b>${currentMode() === k ? ' <span class="pill">현재</span>' : ''}<br><span class="sub">${m.desc}</span></span></button>`).join('')
      + (locked ? '<p class="sub">진행 중 라운드의 모드는 바꿀 수 없습니다 (기록 무결성). 라운드를 끝낸 뒤 변경하세요.</p>' : ''),
    actions: [{ label: '닫기' }],
    onMount(card, close) {
      $$('[data-m]', card).forEach(b => b.onclick = () => {
        if (locked) return;
        S.settings.mode = b.dataset.m; save('settings'); close(); refreshHeader(); route();
        toast(MODES[b.dataset.m].label + ' 모드');
      });
    },
  });
}

// ---------- 안전 감시: 10분마다 날씨 → 낙뢰·폭염 경보, 수분 알림 ----------
let lastWeatherAt = 0, hydrateAt = 0;
async function safetyTick() {
  if (!S.settings.weather || !Sensors.pos) return;
  if (Date.now() - lastWeatherAt < 10 * 60 * 1000) return;
  lastWeatherAt = Date.now();
  try {
    App.weather = await fetchWeather(Sensors.pos.lat, Sensors.pos.lon);
    showAlerts();
  } catch (e) { console.warn('weather', e.message); }
}
export function showAlerts() {
  const w = App.weather, bar = $('#alertBar');
  bar.className = 'alert-bar';
  const nt = App.notices[0];
  // 우선순위: 낙뢰(기상) > 관리자 긴급 공지 > 폭염 > 관리자 주의·안내
  if (w && w.lightningRisk >= 2) {
    bar.className = 'alert-bar show danger';
    bar.innerHTML = `⚡ 낙뢰 위험 ${w.thunderNow ? '(현재 뇌우)' : '(3시간 내 뇌우 예보)'} — 즉시 대피하세요 · <a href="#/safety" style="color:#fff">대피소 안내</a>`;
    if (!showAlerts._buzzed) { vibrate([400, 200, 400, 200, 800]); speak('낙뢰 위험. 즉시 대피하세요.', true); showAlerts._buzzed = true; }
  } else if (nt?.level === 'danger') {
    noticeBar(bar, nt);
    if (showAlerts._dangerId !== nt.id) { showAlerts._dangerId = nt.id; vibrate([400, 200, 400, 200, 800]); speak(nt.title, true); }
  } else if (w && w.heat.level >= 2) {
    bar.className = 'alert-bar show warn';
    bar.innerHTML = `🌡️ 폭염 ${w.heat.label} (WBGT ${w.wbgt.toFixed(1)}) — ${w.heat.hydrateMin}분마다 수분 섭취`;
  } else if (nt) noticeBar(bar, nt);
}
function noticeBar(bar, n) {
  bar.className = 'alert-bar show ' + (n.level === 'info' ? 'info' : n.level);
  bar.innerHTML = `${n.level === 'danger' ? '🚨' : n.level === 'warn' ? '⚠️' : '📢'} <b>${esc(n.title)}</b>${n.body ? ' — ' + esc(n.body.length > 80 ? n.body.slice(0, 80) + '…' : n.body) : ''}${App.notices.length > 1 ? ` <a href="#/home" style="color:inherit">외 ${App.notices.length - 1}건</a>` : ''}`;
}

// ---------- 관리자 발행 데이터: 공지 · 오늘의 핀 · 코스 업데이트 (5분마다) ----------
let lastCatalogAt = 0;
async function remoteTick() {
  if (!navigator.onLine) return;
  const c = activeCourse();
  try { App.notices = await getNotices(c); showAlerts(); } catch (e) { console.warn('notices', e.message); }
  if (c?.official) {
    try {
      const r = await syncPins(c);
      if (r?.changed) { toast(`오늘의 핀 ${r.changed}개 홀 갱신 (골프장 제공 · 스팀프 ${r.stimp})`); current?.onHole?.(S.ui.hole); }
    } catch (e) { console.warn('pins', e.message); }
  }
  if (Date.now() - lastCatalogAt > 30 * 60 * 1000 && S.courses.some(x => x.official)) {
    lastCatalogAt = Date.now();
    try { App.updates = pendingUpdates(await getCatalog()); } catch {}
  }
}
App.remoteTick = remoteTick;

// ---------- 🏷️ 그립 센서: 라운드 중에만 블루투스 신호를 들음 → 친 클럽을 App.gripClub에 ----------
let gripOn = false;
async function setupGrip() {
  const grips = S.settings.grips || [], want = !!S.round && grips.length > 0 && gripSupported();
  try {
    if (!want) { if (gripOn) { gripOn = false; await stopGripScan(); } return; }
    await startGripScan(ev => {
      const g = clubForEvent(S.settings.grips || [], ev); if (!g) return;
      const club = S.bag.find(c => c.id === g.club);
      App.gripClub = { club: g.club, name: club?.name || g.club, ts: ev.at };
      if (ev.battery != null && g.battery !== ev.battery) { g.battery = ev.battery; save('settings'); }
      vibrate(40); toast(`🏷️ ${App.gripClub.name} 센서 · [쳤어요] 때 이 클럽으로 적어요`, 2500);
      current?.onGrip?.(App.gripClub);
    });
    gripOn = true;
  } catch (e) { console.warn('grip', e.message); }
}
App.setupGrip = setupGrip;

// ---------- 🎧 이어폰: 연결되면 알려 주고(설정에 따라 음성 안내 켜기), 이어폰 버튼 1·2·3번 ----------
App.audioRoute = null;
function setupAudio() {
  audioRoute().then(r => { App.audioRoute = r; });
  onAudio({
    route: r => {
      const was = App.audioRoute?.kind; App.audioRoute = r;
      const ear = r.kind !== 'speaker', wasEar = was && was !== 'speaker';
      if (ear && !wasEar) {
        if (!S.settings.voice && S.settings.voiceAuto !== false) { S.settings.voice = true; S.settings.voiceByEar = true; save('settings'); }
        toast(`🎧 ${r.name || ROUTE_WORD[r.kind]} 연결됨${S.settings.voice ? ' · 이어폰으로 안내해요' : ''}`, 3000);
        if (S.settings.voice) say('이어폰이 연결됐어요. 음성 안내를 시작해요. 이어폰 버튼을 한 번 누르면 다시 들을 수 있어요.', { force: true });
      } else if (!ear && wasEar) {
        if (S.settings.voiceByEar) { S.settings.voice = false; delete S.settings.voiceByEar; save('settings'); }
        toast('🎧 이어폰 연결이 끊겼어요' + (S.settings.voice ? ' · 휴대폰 스피커로 말해요' : ' · 음성 안내를 껐어요'), 3000);
      }
    },
    button: ({ count }) => {
      if (S.settings.voiceButtons === false) return;
      if (count === 1) return current?.voiceRepeat ? current.voiceRepeat() : say('지금은 다시 들을 안내가 없어요.', { force: true });
      if (count === 2) return current?.voiceMain ? current.voiceMain() : say('골프 치기 화면에서 두 번 누르면 쳤어요로 적어요.', { force: true });
      if (count >= 3) return current?.voiceUndo ? current.voiceUndo() : null;
    },
  }).catch(e => console.warn('audio', e.message));
}

// ---------- ⌚ 워치 스윙: 골프 치기 화면이면 그 화면이 처리 (쳤어요 · 공 찾았어요), 아니면 친 자리만 기억 ----------
function setupWatch() {
  onWatchSwing(ev => {
    if (ev.impact) App.lastSwingTs = ev.ts || Date.now(); // 🎥 공 추적의 '친 시각'으로도 씀
    if (!S.round || S.settings.watchAuto === false) return;
    if (current?.onWatchSwing) return current.onWatchSwing(ev);
    if (!ev.impact || !Sensors.pos) return;
    App.pendingShot = { lat: Sensors.pos.lat, lon: Sensors.pos.lon, ts: ev.ts || Date.now(), auto: true, hole: S.ui.hole };
    vibrate(60); toast('⌚ 워치가 스윙을 알아챘어요 · 골프 치기 화면으로 가면 이어서 적어요', 3500);
  }).catch(e => console.warn('watch', e.message));
}

// ---------- 📡 골프장 장비 (홀 풍속계 · 낙구 카메라): 라운드 중 30초마다 ----------
App.live = null;
async function liveTick() {
  const c = activeCourse(), url = c?.live?.url;
  if (!S.round || !url || !navigator.onLine) { if (!url) App.live = null; return; }
  try { App.live = await fetchLive(url); App.liveErr = null; }
  catch (e) { App.liveErr = e.message; console.warn('live', e.message); }
}

// ---------- 설치형 앱 새 버전 알림 (시작할 때 · 6시간마다) ----------
async function appUpdateTick(manual = false) {
  const u = await checkAppUpdate();
  if (!u) { if (manual) toast(isPlayBuild() ? `Play 스토어가 자동으로 업데이트해요 (${APP_VERSION.name})` : isNative() ? `최신 버전이에요 (${APP_VERSION.name})` : '웹 버전은 항상 최신이에요'); return; }
  const key = 'pinpoint.updSeen.' + u.code;
  let seen = 0; try { seen = +localStorage.getItem(key) || 0; } catch {}
  App.appUpdate = u; markVer(u);
  if (!manual && (S.round || Date.now() - seen < 24 * 3600 * 1000)) return; // 라운드 중·하루 안에 다시는 묻지 않음 (메뉴에 표시)
  try { localStorage.setItem(key, String(Date.now())) } catch {}
  App.appUpdate = u;
  sheet({ title: '🎉 새 버전이 나왔어요', body: `<p>지금 <b>${esc(u.current)}</b> → 새 버전 <b>${esc(u.name)}</b> (${u.mb}MB)</p><p class="sub">[업데이트]를 누르면 다운로드 페이지가 열려요. 받은 파일을 눌러 설치하면 <b>기록·코스·설정은 그대로</b> 남아요.</p>`,
    actions: [{ label: '나중에' }, { label: '⬇ 업데이트', kind: 'primary', onClick: () => openDownload() }] });
}
App.checkUpdate = () => appUpdateTick(true);
function markVer(u) { const vb = $('#verBtn'); if (vb) vb.innerHTML = `${icon('refresh')}<span>새 버전 ${esc(u.name)} 받기 <small style="color:var(--danger)">●</small></span>`; }

// 홀 도착 시각 (골프장 제출용 리포트의 진행 속도 계산에 사용)
function markHoleArrival(n) {
  const r = S.round; if (!r) return;
  r.holeTimes = r.holeTimes || {};
  if (!r.holeTimes[n]) {
    r.holeTimes[n] = Date.now(); save('round');
    // 티에서 음성 안내: 홀 · 파 · 핸디캡 · 깃발까지 (음성 안내를 켠 경우)
    const h = activeCourse()?.holes?.find(x => x.n === n), rh = r.holes?.find(x => x.n === n);
    if (h || rh) {
      const par = rh?.par || h?.par, hd = h?.hdcpNine ?? h?.hdcp ?? h?.hdcpCard, pin = h?.pin || h?.green;
      const R = 6371000, rad = Math.PI / 180, me = Sensors.pos;
      const d = me && pin ? 2 * R * Math.asin(Math.sqrt(Math.sin((pin.lat - me.lat) * rad / 2) ** 2 + Math.cos(me.lat * rad) * Math.cos(pin.lat * rad) * Math.sin((pin.lon - me.lon) * rad / 2) ** 2)) : null;
      const c = activeCourse(), hh = c ? holeHistory(S.rounds, c.id, n) : null, sc = h?.scorecard, len = sc ? (sc.white ?? sc.blue ?? sc.red ?? sc.back) * (sc.unit === 'yd' ? 0.9144 : 1) : null;
      speak(holeIntro({ name: `${h?.nineHole ?? n}번 홀`, par, len: Number.isFinite(len) ? len : null, hd, toPin: d, hist: hh ? `${hh.text}${hh.tip ? '. ' + hh.tip : ''}` : null, memo: h?.memo, level: S.settings.voiceLevel }));
    }
  }
}
function hydrateTick() {
  const w = App.weather; if (!S.round || !w || !w.heat.hydrateMin) return;
  if (!hydrateAt) hydrateAt = Date.now();
  if (Date.now() - hydrateAt > w.heat.hydrateMin * 60000) { hydrateAt = Date.now(); vibrate([200, 100, 200]); toast('💧 물 마실 시간입니다'); speak('물 마실 시간입니다'); }
}

// ---------- 자동 홀 전환 ----------
function autoHole(p) {
  if (!S.round || !p || S.settings.autoHoleOff) return; // 사용자가 홀을 고정하면 자동 전환 안 함
  if (S.round.liveShot || document.querySelector('#sheet.open')) return; // 공을 찾으러 가는 중·점수 입력 중
  const c = activeCourse(); if (!c) return;
  const o = App.holeOrder(), next = o[o.indexOf(S.ui.hole) + 1], nh = c.holes.find(h => h.n === next);
  if (!nh?.tee) return;
  const done = S.round.holes.find(x => x.n === S.ui.hole)?.scores?.[0]?.saved;
  if (!done && Date.now() - App.manualAt < 3 * 60 * 1000) return;
  const R = 6371000, rad = Math.PI / 180, dLat = (nh.tee.lat - p.lat) * rad, dLon = (nh.tee.lon - p.lon) * rad;
  const d = 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * rad) * Math.cos(nh.tee.lat * rad) * Math.sin(dLon / 2) ** 2));
  // 위치가 한 번 튄 것으로 홀이 넘어가지 않게: 다음 홀 티 22m 안에 3번 이상 · 5초 넘게 머물러야 넘김 (오차가 큰 신호는 세지 않음)
  const r = dwell(holeCand, next, d < 22 && !(p.acc > 25), Date.now());
  holeCand = r.cand;
  if (r.fire) { const nm = `${nh.nineHole ?? nh.n}번 홀`; App.setHole(next, { auto: true }); toast(`${nm} 티에 왔어요`); speak(nm); }
}
let holeCand = null;

// ---------- 스윙 감지 → 샷 시작점 기록 ----------
let unSwing = null;
function setupSwing() {
  unSwing && unSwing(); unSwing = null;
  if (!S.settings.swingDetect) return;
  unSwing = startSwingDetect(async ev => {
    if (!S.round || !Sensors.pos) return;
    App.pendingShot = { lat: Sensors.pos.lat, lon: Sensors.pos.lon, ts: ev.ts, auto: true, hole: S.ui.hole }; App.lastSwingTs = ev.ts;
    vibrate(60);
    toast('스윙 감지 · 샷 위치 저장 (공이 안 보이면 공찾기)');
  });
}

// 📍 위치 권한: 처음 한 번은 왜 필요한지 먼저 설명하고 묻기
async function askLocation() {
  let state = 'prompt';
  try { state = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch {}
  let asked = false; try { asked = !!localStorage.getItem('pinpoint.locWhy'); } catch {}
  if (state !== 'prompt' || asked || S.settings.simGPS) { startGPS(); return; }
  // 한 줄 설명 + 버튼 하나 (다음 화면의 휴대폰 질문에서 '앱 사용 중에만 허용')
  const done = () => { try { localStorage.setItem('pinpoint.locWhy', '1'); } catch {} };
  sheet({ title: '📍 위치를 켜 주세요', body: `<p class="why1">깃발까지 거리를 재려면 필요해요.<br><small>다음에 나오는 질문에서 <b>“앱 사용 중에만 허용”</b>을 눌러 주세요.</small></p>`,
    actions: [{ label: '나중에', onClick: done }, { label: '📍 켜기', kind: 'primary', onClick: () => { done(); startGPS(); } }] });
}

// ---------- 안전망: 오류 기록 · 저장 실패 알림 · 뒤로 가기 · 앱으로 돌아올 때 ----------
export function logError(e) {
  try {
    const L = JSON.parse(localStorage.getItem('pinpoint.errlog') || '[]');
    L.push({ t: new Date().toISOString(), m: String(e?.message || e).slice(0, 200), s: String(e?.stack || '').split('\n').slice(0, 3).join(' | ').slice(0, 300), r: location.hash });
    localStorage.setItem('pinpoint.errlog', JSON.stringify(L.slice(-20)));
  } catch {}
}
let errToastAt = 0;
function safetyNets() {
  const onErr = e => { logError(e); if (Date.now() - errToastAt > 15000) { errToastAt = Date.now(); toast('앗, 잠깐 문제가 생겼어요 · 다시 눌러 주세요 (기록은 그대로예요)', 3500); } };
  window.addEventListener('error', e => onErr(e.error || e.message));
  window.addEventListener('unhandledrejection', e => onErr(e.reason));
  let failShown = 0;
  onSaveFail(key => {
    if (Date.now() - failShown < 60000) return; failShown = Date.now();
    sheet({ title: '⚠ 저장 공간이 부족해요', body: `<p>휴대폰에 기록을 더 저장할 수 없어요. <b>지금 백업</b>해 두고, 오래된 기록이나 받아 둔 골프장 정보를 정리해 주세요.</p><p class="sub">저장하지 못한 것: ${esc(key)}</p>`,
      actions: [{ label: '나중에' }, { label: '💾 백업 · 정리하기', kind: 'primary', onClick: () => App.go('settings?storage') }] });
  });
  // 안드로이드 뒤로 가기: 열린 창 닫기 → 이전 화면 → 골프 치기 화면에서는 두 번 눌러야 나가기
  const back = window.Capacitor?.Plugins?.App;
  if (back?.addListener) {
    let lastBack = 0;
    back.addListener('backButton', () => {
      const sh = $('#sheet');
      if (sh?.classList.contains('open')) { sh.classList.remove('open'); sh.innerHTML = ''; return; }
      if ($('#drawer')?.classList.contains('open')) { $('#drawer').classList.remove('open'); return; }
      const full = document.querySelector('[data-back]'); if (full) { full.click(); return; } // 전체 화면(카메라 등) 닫기
      if (currentName && currentName !== 'play') { App.go('play'); return; }
      if (Date.now() - lastBack < 2000) { back.exitApp?.(); return; }
      lastBack = Date.now(); toast('한 번 더 누르면 앱을 닫아요', 2000);
    });
  }
  // 앱으로 돌아오면: 화면 켜짐 다시 · 위치를 못 받고 있었으면 다시 찾기 (설정에서 허락하고 돌아온 경우)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (S.round) keepAwake(true);
    if (!S.settings.simGPS && Sensors.gpsState !== 'ok') restartGPS();
  });
  if (S.round) keepAwake(true);
}

// 📱 아래 메뉴 (모든 화면 공통 · 쉬운 화면): 골프 치기 화면과 같은 7칸
//  공 찾기·거리표·도구는 지금 홀·친 샷이 필요해서 골프 치기 화면에서 열어 줌 (App.pendingCmd)
function bottomMenu(name) {
  const nav = $('#bdNav'); if (!nav) return;
  nav.innerHTML = bottomMenuHTML({ on: name });
  const playCmd = c => { if (currentName === 'play' && current?.cmd) current.cmd(c); else { App.pendingCmd = c; App.go('play'); } };
  $('#mMenu', nav).onclick = () => $('#drawer').classList.add('open');
  $('#mGreen', nav).onclick = () => App.go(allowed('puttLine') ? 'green?ar' : 'green');
  $('#mLost', nav).onclick = () => playCmd('lost');
  $('#mPlay', nav).onclick = () => App.go('play');
  $('#mShots', nav).onclick = () => App.go('shots');
  $('#mYard', nav).onclick = () => playCmd('yard');
  $('#more', nav).onclick = () => playCmd('tools');
}

// 🎨 전체 메뉴(☰)·탭 막대: 이모지 대신 앱 아이콘 세트 (js/icons.js)
const DRAWER_IC = { '#/play': 'play', '#/home': 'home', '#/lie': 'lie', '#/courses': 'map', '#/shots': 'shots', '#/bag': 'bag', '#/rules': 'book', '#/safety': 'bolt', '#/history': 'bars', '#/calib': 'sliders', '#/settings': 'gear', '#/about': 'info', verBtn: 'refresh' };
const TAB_IC = { play: 'play', distance: 'green', tee: 'tee', lost: 'lost', green: 'green', score: 'card' };
// 화면 제목(h2) 앞 이모지 → 아이콘 (화면이 다시 그려져도 바로 바꿈)
const TITLE_IC = { shots: 'shots', score: 'card', green: 'green', lost: 'lost', tee: 'tee', distance: 'wind', lie: 'lie', bag: 'bag', rules: 'book', safety: 'bolt', history: 'bars', calib: 'sliders', settings: 'gear', about: 'brand', courses: 'map' };
function titleIcon() {
  const n = TITLE_IC[currentName], h = n && $('#view h2'); if (!h || h.dataset.ic) return;
  const t = h.firstChild; if (!t || t.nodeType !== 3) return;
  const m = t.textContent.match(/^\s*([^\s0-9A-Za-z가-힣(]+)\s*/u); if (!m) return;
  t.textContent = t.textContent.slice(m[0].length); h.dataset.ic = '1'; h.insertAdjacentHTML('afterbegin', icon(n, 'ic-h'));
}
function applyIcons() {
  // 🏷️ 브랜드 마크 (위치 핀 + 골프 깃발): 앱 머리줄 제목 옆 · 전체 메뉴 맨 위
  const ttl = $('.topbar .ttl'); if (ttl && !$('.topbar .brand-mk')) ttl.insertAdjacentHTML('beforebegin', `<span class="brand-mk" aria-hidden="true">${icon('brand')}</span>`);
  const br = $('#drawer .brand'), t0 = br?.firstChild;
  if (t0?.nodeType === 3) { t0.textContent = t0.textContent.replace(/^[^0-9A-Za-z가-힣]+/u, ''); br.insertAdjacentHTML('afterbegin', icon('brand', 'brand-ic')); }
  new MutationObserver(titleIcon).observe($('#view'), { childList: true, subtree: true });
  $$('#drawer .panel a').forEach(a => {
    const n = DRAWER_IC[a.id] || DRAWER_IC[a.getAttribute('href')]; if (!n) return;
    const t = a.textContent.replace(/^[^0-9A-Za-z가-힣(]+/u, '').trim();
    a.innerHTML = `${icon(n)}<span>${esc(t)}</span>`;
  });
  $$('#tabs a').forEach(a => { const n = TAB_IC[a.dataset.r] || (a.id === 'tabMore' ? 'menu' : null), i = a.querySelector('.i'); if (n && i) i.innerHTML = icon(n); });
}

function init() {
  applyIcons();
  startIconize(); // 본문 버튼 이모지도 아이콘으로 (화면이 다시 그려져도)
  applySettings();
  safetyNets();
  askLocation();
  startOrientation();
  setupSwing();
  onPos(autoHole);
  subscribe(keys => { if (keys.includes('settings')) { applySettings(); setupSwing(); refreshHeader(); } if (keys.includes('round') || keys.includes('settings')) setupGrip(); });
  setTimeout(setupGrip, 2000); setupWatch(); setupAudio();
  $('#menuBtn').onclick = () => $('#drawer').classList.add('open');
  $('#tabMore')?.addEventListener('click', e => { e.preventDefault(); $('#drawer').classList.add('open'); });
  $('#drawer .bg').onclick = () => $('#drawer').classList.remove('open');
  $('#modeChip').onclick = modeSheet;
  $('#holePrev').onclick = () => App.stepHole(-1);
  $('#holeNext').onclick = () => App.stepHole(1);
  window.addEventListener('hashchange', route);
  setInterval(() => { safetyTick(); hydrateTick(); }, 30000);
  setTimeout(safetyTick, 4000);
  setInterval(remoteTick, 5 * 60 * 1000);
  setInterval(liveTick, 30000); setTimeout(liveTick, 2500);
  setTimeout(() => appUpdateTick(), 4000); setInterval(() => appUpdateTick(), 6 * 3600 * 1000);
  const vb = $('#verBtn'); if (vb) { vb.innerHTML = `${icon('refresh')}<span>업데이트 확인 · ${isNative() ? '앱 ' + esc(APP_VERSION.name) : '웹 (항상 최신)'}</span>`; vb.onclick = () => { $('#drawer').classList.remove('open'); appUpdateTick(true); }; }
  setTimeout(remoteTick, 1500);
  window.addEventListener('online', () => remoteTick());
  subscribe(keys => { if (keys.includes('ui') && activeCourse()?.official && remoteTick._course !== activeCourse().id) { remoteTick._course = activeCourse().id; remoteTick(); } });
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.Capacitor?.isNativePlatform?.()) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
}
init();
export { sampleFix };
