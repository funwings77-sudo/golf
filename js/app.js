// PinPoint AI 캐디 — 앱 셸 (라우터 · 상단바 · 모드 · 안전 감시 · 스윙 감지)
import { S, save, MODES, activeCourse, currentMode, subscribe } from './core/state.js';
import { startGPS, onPos, setSim, setVoice, startOrientation, startSwingDetect, vibrate, speak, Sensors, sampleFix } from './core/sensors.js';
import { fetchWeather } from './core/weather.js';
import { detectHoleByTee } from './core/course.js';
import { syncPins, getNotices, getCatalog, pendingUpdates } from './core/remote.js';
import { $, $$, sheet, toast, esc } from './ui.js';

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
  stepHole(d) { const o = App.holeOrder(); if (!o.length) return; const i = Math.max(0, o.indexOf(S.ui.hole)); App.setHole(o[(i + d + o.length) % o.length]); },
  setHole(n) {
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
  $$('#drawer a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + name));
  try {
    const mod = (await loader()).default;
    current = mod; currentName = name;
    view.innerHTML = '';
    if (mod.full) view.classList.add('full');
    await mod.mount(view, App);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card"><b>화면을 여는 중 오류가 발생했습니다</b><p class="sub">${esc(e.message)}</p></div>`;
  }
  refreshHeader();
}

function refreshHeader() {
  const c = activeCourse(), mode = currentMode();
  const chip = $('#modeChip');
  chip.textContent = MODES[mode].short; chip.className = 'mode-chip ' + mode;
  const nav = $('#holeNav');
  if (c) {
    const h = c.holes.find(x => x.n === S.ui.hole) || c.holes[0];
    nav.hidden = false;
    $('#holeLbl').textContent = h.nine ? `${h.nine.slice(0, 2)}${h.nineHole}` : 'H' + h.n;
    $('#ttlMain').textContent = c.name;
    $('#ttlSub').textContent = `Par ${h.par}` + (S.round ? ` · 라운드 진행 중` : '');
  } else {
    nav.hidden = true; $('#ttlMain').textContent = 'PinPoint AI 캐디'; $('#ttlSub').textContent = '셀프 라운드의 디지털 캐디';
  }
}

function applySettings() {
  const st = S.settings, root = document.documentElement;
  root.classList.toggle('outdoor', !!st.outdoor);
  root.classList.toggle('bigtext', !!st.bigText);
  setVoice(!!st.voice);
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
      speak(`${n}번 홀, 파 ${par}${hd ? `, 핸디캡 ${hd}` : ''}${d && d < 700 ? `. 깃발까지 ${Math.round(d)}미터` : ''}`);
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
  const c = activeCourse(); if (!c) return;
  const n = detectHoleByTee(c, p, S.ui.hole);
  const o = App.holeOrder(), next = o[o.indexOf(S.ui.hole) + 1];
  if (n && n === next) { App.setHole(n); toast(`${n}번 홀 티잉 구역 도착`); speak(`${n}번 홀`); }
}

// ---------- 스윙 감지 → 샷 시작점 기록 ----------
let unSwing = null;
function setupSwing() {
  unSwing && unSwing(); unSwing = null;
  if (!S.settings.swingDetect) return;
  unSwing = startSwingDetect(async ev => {
    if (!S.round || !Sensors.pos) return;
    App.pendingShot = { lat: Sensors.pos.lat, lon: Sensors.pos.lon, ts: ev.ts, auto: true, hole: S.ui.hole };
    vibrate(60);
    toast('스윙 감지 · 샷 위치 저장 (공이 안 보이면 공찾기)');
  });
}

function init() {
  applySettings();
  startGPS();
  startOrientation();
  setupSwing();
  onPos(autoHole);
  subscribe(keys => { if (keys.includes('settings')) { applySettings(); setupSwing(); refreshHeader(); } });
  $('#menuBtn').onclick = () => $('#drawer').classList.add('open');
  $('#drawer .bg').onclick = () => $('#drawer').classList.remove('open');
  $('#modeChip').onclick = modeSheet;
  $('#holePrev').onclick = () => App.stepHole(-1);
  $('#holeNext').onclick = () => App.stepHole(1);
  window.addEventListener('hashchange', route);
  setInterval(() => { safetyTick(); hydrateTick(); }, 30000);
  setTimeout(safetyTick, 4000);
  setInterval(remoteTick, 5 * 60 * 1000);
  setTimeout(remoteTick, 1500);
  window.addEventListener('online', () => remoteTick());
  subscribe(keys => { if (keys.includes('ui') && activeCourse()?.official && remoteTick._course !== activeCourse().id) { remoteTick._course = activeCourse().id; remoteTick(); } });
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.Capacitor?.isNativePlatform?.()) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
}
init();
export { sampleFix };
