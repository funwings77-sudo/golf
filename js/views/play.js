// 쉬운 플레이 (초등학생도 쓰는 기본 흐름)
//  ① 골프장 고르기 → ② 코스 고르기 → ③ 홀 화면: 그린까지 거리 · 추천 클럽 · 힘(%) · 방향(각도) · 추천 길
//  → ④ "쳤어요!" → 내 공 위치(거리·방향) 안내 → "찾았어요"
//  보기: 2D 지도 · 3D 지형 · 4D(3D + 공 비행·홀 플라이오버 시간 재생) · AR 카메라
import { S, save, activeCourse, activeHole, allowed, currentMode, MODES } from '../core/state.js';
import { newRound } from '../core/score.js';
import { demoCourse } from '../core/course.js';
import { getCatalog, installCourse, findInstalled, getClubs } from '../core/remote.js';
import { Sensors, onPos, onOrientation, sampleFix, keepAwake, vibrate, speak, startOrientation } from '../core/sensors.js';
import { distance, bearing, destination, normAngle, toLocal } from '../core/geo.js';
import { gridSurface } from '../physics/putt.js';
import { fetchElevations, playsLike } from '../core/weather.js';
import { adviseShot, predictBall, toBall, dirWords, compassName, greenR } from '../physics/advice.js';
import { conditionsEffect } from '../physics/flight.js';
import { learnClub } from '../core/score.js';
import { createMap, destroyMap, drawHole, ll, flagIcon, labelIcon } from '../map.js';
import { $, $$, esc, toast, sheet, confirmSheet } from '../ui.js';

const KEY = 'pinpoint.play';
const P = (() => { try { return { view: '3d', ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { return { view: '3d' }; } })();
const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ view: P.view, step: P.step, q: P.q, ballPos: P.ballPos, ballHole: P.ballHole })); } catch {} };

let el_, App_, map = null, lay = null, v3 = null, arStop = null, unPos = null, unOri = null, adv = null, advKey = '', advT = 0, timer = null;

export default {
  full: true,
  mount(el, App) {
    el_ = el; App_ = App;
    if (S.round) P.step = 'hole';
    else if (!P.step || (P.step !== 'club' && !activeCourse())) P.step = 'club';
    if (P.step === 'hole' && !S.round) P.step = activeCourse() ? 'course' : 'club';
    render();
  },
  unmount() { teardown(); unPos?.(); unOri?.(); clearInterval(timer); unPos = unOri = null; },
  onHole() { if (P.step === 'hole') { adv = null; advKey = ''; P.ballPos = null; persist(); render(); } },
};

function teardown() { $('#stage')?.querySelector('.rg-hud')?.remove(); ringLay = null; destroyMap(map); map = lay = null; v3?.destroy(); v3 = null; arStop?.(); arStop = null; }
function render() {
  teardown(); unPos?.(); unOri?.(); clearInterval(timer); unPos = unOri = null;
  el_.className = 'play';
  if (P.step === 'club') return stepClub();
  if (P.step === 'course') return stepCourse();
  return stepHole();
}

// ---------------- ① 골프장 고르기 ----------------
function stepClub() {
  const q = (P.q || '').trim();
  const mine = S.courses.filter(c => !q || c.name.includes(q));
  el_.innerHTML = `<div class="pwrap">
    <div class="pstep"><span class="on">1 골프장</span><span>2 코스</span><span>3 치기</span></div>
    <h1 class="pq">⛳ 어느 골프장에서 쳐요?</h1>
    <input type="search" id="pq" class="pin-search" placeholder="🔍 골프장 이름으로 찾기" value="${esc(P.q || '')}">
    ${mine.length ? `<div class="picks">${mine.map(c => `<button class="pick" data-c="${esc(c.id)}"><span class="pi">${c.official ? '🏌️' : c.demo ? '🧪' : '🗺️'}</span><span class="pt"><b>${esc(c.name)}</b><small>${c.holes.length}홀${c.official?.region ? ' · ' + esc(c.official.region) : ''}${c.todayPins ? ' · 오늘 핀 ✓' : ''}</small></span><span class="pa">›</span></button>`).join('')}</div>` : '<p class="sub center">아직 받은 골프장이 없어요. 아래에서 골라 받아요.</p>'}
    <h2 class="ph2">📡 골프장 받기</h2><div class="picks" id="cat"><p class="sub center">불러오는 중…</p></div>
    <h2 class="ph2">🇰🇷 전국 골프장 찾기</h2><div class="picks" id="dir"><p class="sub center">불러오는 중…</p></div>
    <button class="pbtn ghost" id="demo">🧪 연습용 가상 골프장으로 해 보기</button>
  </div>`;
  $('#pq').oninput = e => { P.q = e.target.value; persist(); clearTimeout(stepClub._t); stepClub._t = setTimeout(() => { const pos = e.target.selectionStart; stepClub(); const i = $('#pq'); i.focus(); i.setSelectionRange(pos, pos); }, 250); };
  $$('[data-c]').forEach(b => b.onclick = () => choose(b.dataset.c));
  $('#demo').onclick = () => {
    const base = Sensors.pos ? { lat: Sensors.pos.lat + 0.0006, lon: Sensors.pos.lon } : undefined;
    const c = demoCourse(base); S.courses.push(c); save('courses'); choose(c.id);
  };
  getCatalog().then(cat => {
    const box = $('#cat'); if (!box) return;
    const list = cat.filter(e => !findInstalled(e.id) && (!q || e.name.includes(q)));
    box.innerHTML = list.length ? list.map(e => `<button class="pick" data-get="${esc(e.id)}"><span class="pi">📥</span><span class="pt"><b>${esc(e.name)}</b><small>${e.holes}홀${e.region ? ' · ' + esc(e.region) : ''} · 눌러서 받기</small></span><span class="pa">＋</span></button>`).join('') : `<p class="sub center">${cat.length ? '받을 수 있는 골프장을 모두 받았어요' : '아직 골프장이 올린 코스가 없어요. 연습용 가상 골프장으로 해 볼 수 있어요'}</p>`;
    $$('[data-get]', box).forEach(b => b.onclick = async () => {
      b.disabled = true; b.querySelector('small').textContent = '받는 중…';
      try { const { course } = await installCourse(cat.find(x => x.id === b.dataset.get)); toast(`'${course.name}' 받았어요`); choose(course.id); }
      catch (err) { toast('받지 못했어요: ' + err.message); b.disabled = false; }
    });
  }).catch(() => { const box = $('#cat'); if (box) box.innerHTML = '<p class="sub center">인터넷이 연결되면 골프장 목록이 보여요</p>'; });
  // 전국 골프장 목록 (KGBA 회원사): 이름·지역 검색, 위치를 알면 가까운 순
  getClubs().then(clubs => {
    const box = $('#dir'); if (!box) return;
    if (!clubs.length) { box.innerHTML = '<p class="sub center">목록을 불러오지 못했어요</p>'; return; }
    const me = Sensors.pos;
    let list = clubs.filter(c => !q || c.name.includes(q) || c.sigungu.includes(q) || c.sido.includes(q));
    if (me) list = list.map(c => ({ ...c, d: c.lat ? distance(me, c) : Infinity })).sort((a, b) => a.d - b.d);
    else list = list.sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || a.name.localeCompare(b.name, 'ko'));
    const shown = list.slice(0, q ? 30 : 6);
    box.innerHTML = (q ? '' : `<p class="sub center" style="margin:0">전국 ${clubs.length}곳 중 ${me ? '가까운 곳' : '코스 정보가 있는 곳'}이에요. 이름을 검색하면 다 찾을 수 있어요.</p>`)
      + shown.map(c => `<button class="pick" data-club="${c.id}"><span class="pi">${c.official ? '🏌️' : 'ℹ️'}</span><span class="pt"><b>${esc(c.name)}</b><small>${esc(c.sido)} ${esc(c.sigungu)} · ${c.holes || '?'}홀${Number.isFinite(c.d) ? ` · ${c.loc === "sigungu" ? "약 " : ""}${(c.d / 1000).toFixed(c.d < 10000 ? 1 : 0)}km` : ''} · ${c.official ? (findInstalled(c.official) ? '받음' : '스코어카드 있음') : '정보만'}</small></span><span class="pa">›</span></button>`).join('')
      + (q && !list.length ? '<p class="sub center">찾는 골프장이 없어요</p>' : '');
    $$('[data-club]', box).forEach(b => b.onclick = () => clubInfo(clubs.find(c => c.id === +b.dataset.club)));
  }).catch(() => { const box = $('#dir'); if (box) box.innerHTML = '<p class="sub center">인터넷이 연결되면 전국 골프장 목록이 보여요</p>'; });
}

// 골프장 정보 (전국 목록): 코스 데이터가 있으면 받아서 바로 시작
function clubInfo(c) {
  const mine = c.official && findInstalled(c.official);
  const rows = [['지역', `${c.sido} ${c.sigungu}`], ['홀', c.holes ? `${c.holes}홀${c.courses?.length ? ` (${c.courses.join(' · ')})` : ''}` : ''], ['운영', c.type], ['파 · 전장', [c.par && `파 ${c.par}`, c.yards && `${c.yards}야드`].filter(Boolean).join(' · ')],
    ['그린피 (주중/주말)', [c.fee?.weekday, c.fee?.weekend].filter(Boolean).join(' / ')], ['카트 · 캐디', [c.fee?.cart, c.fee?.caddie].filter(Boolean).join(' · ')], ['잔디', c.grass], ['개장', c.opened], ['전화', c.phone], ['주소', c.address], ['예약', c.reservation]].filter(([, v]) => v);
  const home = c.homepage ? (/^https?:/.test(c.homepage) ? c.homepage : 'https://' + c.homepage) : '';
  sheet({
    title: c.name,
    body: `${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b style="text-align:right">${esc(String(v))}</b></div>`).join('')}
      <p>${home ? `<a href="${esc(home)}" target="_blank" rel="noopener">🌐 홈페이지</a>` : ''}${c.phone ? ` · <a href="tel:${esc(c.phone.replace(/[^0-9+]/g, ''))}">📞 전화</a>` : ''}</p>
      <p class="sub">${c.official ? '홀별 스코어카드(파·거리·공략)가 있어요. 그린 위치는 처음 한 번 지도에서 눌러 정해요.' : '아직 홀별 코스 정보가 없어요. 관리자가 코스를 올리면 받을 수 있어요.'} 정보 확인일 ${esc(c.checked || '—')} · 출처 KGBA 회원사 코스 DB</p>`,
    actions: [{ label: '닫기' }, ...(c.official ? [{
      label: mine ? '이 골프장으로 시작' : '받고 시작하기', kind: 'primary', onClick: async () => {
        if (mine) return choose(mine.id);
        try { toast('받는 중…'); const cat = await getCatalog(); const e = cat.find(x => x.id === c.official); if (!e) throw new Error('목록에 없어요'); const { course } = await installCourse(e); choose(course.id); }
        catch (err) { toast('받지 못했어요: ' + err.message); }
      },
    }] : [])],
  });
}
function choose(id) { S.ui.courseId = id; S.ui.hole = 1; save('ui'); App_.refreshHeader(); P.step = 'course'; persist(); render(); }

// ---------------- ② 코스 고르기 ----------------
function stepCourse() {
  const c = activeCourse(); if (!c) { P.step = 'club'; return render(); }
  const nines = c.nines?.length > 1 ? c.nines : null, N = c.holes.length;
  const opts = nines ? null : [
    { k: 'all', t: `1번 홀부터 ${N}홀 모두`, ns: c.holes.map(h => h.n) },
    ...(N === 18 ? [{ k: 'back', t: '10번 홀부터 18홀', ns: [...c.holes.slice(9), ...c.holes.slice(0, 9)].map(h => h.n) }, { k: 'f9', t: '앞 9홀만 (1~9번)', ns: c.holes.slice(0, 9).map(h => h.n) }, { k: 'b9', t: '뒤 9홀만 (10~18번)', ns: c.holes.slice(9).map(h => h.n) }] : []),
  ];
  // 9홀 묶음이면 처음+다음 코스, 18홀 이상 묶음(예: 서코스·동코스)이면 한 코스만 기본
  const sz = n => n.holes.length;
  let first = nines ? nines[0].name : null, second = nines ? (sz(nines[0]) >= 18 ? '' : nines[1].name) : null, pick = 'all';
  const players = (localStorage.getItem('pinpoint.lastPlayers') || '나').split(',').map(s => s.trim()).filter(Boolean);
  let mode = S.settings.mode === 'tournament' ? 'tournament' : 'casual';
  const draw = () => {
    el_.innerHTML = `<div class="pwrap">
      <div class="pstep"><span class="done">1 골프장</span><span class="on">2 코스</span><span>3 치기</span></div>
      <button class="plink" id="back">‹ ${esc(c.name)} · 골프장 다시 고르기</button>
      <h1 class="pq">🚩 어느 코스로 쳐요?</h1>
      ${nines ? `<p class="sub center">이 골프장은 코스가 ${nines.length}개예요. ${sz(nines[0]) >= 18 ? '칠 코스를 골라요.' : '처음 코스와 다음 코스를 골라요.'}</p>
        <h2 class="ph2">${sz(nines[0]) >= 18 ? '칠 코스' : '처음 코스'}</h2><div class="chips big">${nines.map(n => `<button class="${n.name === first ? 'on' : ''}" data-f="${esc(n.name)}">${esc(n.name)} <small>${sz(n)}홀</small></button>`).join('')}</div>
        <h2 class="ph2">다음 코스</h2><div class="chips big">${nines.map(n => `<button class="${n.name === second ? 'on' : ''}" data-s="${esc(n.name)}" ${n.name === first ? 'disabled' : ''}>${esc(n.name)} <small>${sz(n)}홀</small></button>`).join('')}<button class="${second === '' ? 'on' : ''}" data-s="">이 코스만 (${sz(nines.find(n => n.name === first))}홀)</button></div>`
        : `<div class="picks">${opts.map(o => `<button class="pick ${pick === o.k ? 'sel' : ''}" data-o="${o.k}"><span class="pi">${pick === o.k ? '✅' : '⚪'}</span><span class="pt"><b>${o.t}</b></span></button>`).join('')}</div>`}
      <h2 class="ph2">👫 누구랑 쳐요?</h2>
      <div class="chips big" id="pl">${players.map((p, i) => `<button class="on" data-pl="${i}">${esc(p)}${i ? ' ✕' : ''}</button>`).join('')}<button id="addP">＋ 친구</button></div>
      <label class="tgl"><input type="checkbox" id="tour" ${mode === 'tournament' ? 'checked' : ''}> 🏆 대회예요 <small>(대회 규칙상 거리만 보여요)</small></label>
      <button class="pbtn primary" id="go">시작! 🏌️</button>
    </div>`;
    $('#back').onclick = () => { P.step = 'club'; persist(); render(); };
    $$('[data-f]').forEach(b => b.onclick = () => { first = b.dataset.f; if (second === first) second = sz(nines.find(n => n.name === first)) >= 18 ? '' : (nines.find(n => n.name !== first)?.name ?? ''); draw(); });
    $$('[data-s]').forEach(b => b.onclick = () => { second = b.dataset.s; draw(); });
    $$('[data-o]').forEach(b => b.onclick = () => { pick = b.dataset.o; draw(); });
    $$('[data-pl]').forEach(b => b.onclick = () => { const i = +b.dataset.pl; if (i) { players.splice(i, 1); draw(); } });
    $('#addP').onclick = () => sheet({ title: '친구 이름', body: '<input type="text" id="pn" maxlength="10" placeholder="예: 민수">', actions: [{ label: '취소' }, { label: '추가', kind: 'primary', onClick: card => { const v = $('#pn', card).value.trim(); if (v && players.length < 8) players.push(v); draw(); } }] });
    $('#tour').onchange = e => { mode = e.target.checked ? 'tournament' : 'casual'; };
    $('#go').onclick = () => {
      const holeNs = nines ? [...nines.find(n => n.name === first).holes, ...(second ? nines.find(n => n.name === second).holes : [])] : opts.find(o => o.k === pick).ns;
      localStorage.setItem('pinpoint.lastPlayers', players.join(', '));
      S.settings.mode = mode; save('settings');
      S.round = newRound({ course: c, players, mode, games: { stroke: 0, skins: 0 }, holeNs });
      S.ui.hole = holeNs[0]; save('round', 'ui'); keepAwake(true);
      App_.refreshHeader(); P.step = 'hole'; P.ballPos = null; persist(); vibrate(60); render();
    };
  };
  draw();
}

// ---------------- ③ 홀 화면 ----------------
const holeName = h => (h.nine ? `${h.nine} ${h.nineHole}번 홀` : `${h.n}번 홀`);
function ballPos() { const h = activeHole(); return P.ballPos && P.ballHole === h?.n ? P.ballPos : Sensors.pos; }

function stepHole() {
  const c = activeCourse(), h = activeHole();
  if (!c || !h) { P.step = 'club'; return render(); }
  const order = App_.holeOrder(), idx = order.indexOf(h.n);
  el_.innerHTML = `<div class="imm">
    <div class="stage imm-stage" id="stage"></div>
    <div class="imm-top">
      <button class="imm-pill" id="hInfo" aria-label="홀 정보"><i class="imm-tgt"></i><span><b>거리 측정</b><small>${esc(holeName(h))} · 파 ${h.par}${(h.hdcpNine ?? h.hdcp ?? h.hdcpCard) ? ` · 핸디 ${h.hdcpNine ?? h.hdcp ?? h.hdcpCard}` : ''} · ${idx + 1}/${order.length}</small></span></button>
      <span class="imm-gps" id="gps"><i></i>GPS</span>
    </div>
    <button class="imm-mini" id="mini" aria-label="코스 지도 (2D로 보기)"></button>
    <div class="imm-side">
      ${[['2d', '2D'], ['3d', '3D'], ['4d', '4D'], ['ar', 'AR']].map(([k, t]) => `<button class="${P.view === k ? 'on' : ''}" data-v="${k}" aria-label="${t} 보기">${t}</button>`).join('')}
      <span class="sep"></span><button id="hPrev" aria-label="이전 홀">◀</button><button id="hNext" aria-label="다음 홀">▶</button>
    </div>
    <div class="imm-sheet"><div class="imm-card" id="cards"></div><div class="imm-act" id="act"></div></div>
  </div>`;
  $('#hPrev').onclick = () => App_.stepHole(-1);
  $('#hNext').onclick = () => App_.stepHole(1);
  $('#mini').onclick = () => { if (P.view !== '2d') { P.view = '2d'; persist(); render(); } };
  $('#hInfo').onclick = () => holeInfo(h);
  $$('[data-v]').forEach(b => b.onclick = () => { P.view = b.dataset.v; persist(); render(); });
  mountView();
  unPos = onPos(() => update());
  startOrientation();
  unOri = onOrientation(() => { if (shotOf() && P.view !== 'ar') arrowOnly(); });
  timer = setInterval(update, 4000);
  update(true);
}

function holeInfo(h) {
  sheet({ title: `${holeName(h)} · 파 ${h.par}`, body: scoreCard(h) || '<p class="sub">이 홀은 스코어카드 정보가 없어요.</p>', actions: [{ label: '닫기' }] });
}

// 상태: 친 공 (라운드 중 하나)
const shotOf = () => (S.round?.liveShot && S.round.liveShot.hole === activeHole()?.n ? S.round.liveShot : null);

function compute(force) {
  const h = activeHole(), me = ballPos();
  if (!h || !me) { adv = null; return; }
  const key = `${h.n}|${me.lat.toFixed(5)},${me.lon.toFixed(5)}|${h.pin?.lat}|${h.green?.lat}|${currentMode()}`;
  if (!force && key === advKey && Date.now() - advT < 30000) return;
  advKey = key; advT = Date.now();
  const w = App_.weather;
  adv = adviseShot({ me, hole: h, bag: S.bag, hcp: S.settings.hcp, weather: allowed('windAdjust') && w ? { windSpeed: w.windSpeed, windFrom: w.windFrom, rho: w.rho } : {} });
}

function update(force = false) {
  if (P.step !== 'hole') return;
  compute(force);
  gpsChip(); cards(); actions(); scene(); mini();
}

function gpsChip() {
  const g = $('#gps'); if (!g) return;
  const p = Sensors.pos, acc = p?.acc;
  g.className = 'imm-gps ' + (!p ? 'off' : acc <= 6 ? 'ok' : acc <= 15 ? 'mid' : 'bad');
  g.innerHTML = `<i></i>GPS${p ? ` <small>±${Math.round(acc || 0)}m</small>` : ''}`;
}

// 핀 고저차: 두 점이 측량 그린맵 안이면 격자 높이(cm 정밀도), 아니면 공개 고도 자료(대략)
const elevCache = new Map();
function pinDrop(from, pin, h) {
  if (!allowed('playsLike') || !from || !pin) return null; // 대회 모드에서는 고저차 측정 금지(규칙 4.3a)
  const gg = h.greenGrid;
  if (gg) {
    const loc = p => toLocal(gg.origin, p), g = gg.grid, inside = q => q.x >= g.x0 && q.y >= g.y0 && q.x <= g.x0 + (g.nx - 1) * g.dx && q.y <= g.y0 + (g.ny - 1) * g.dx;
    const a = loc(from), b = loc(pin);
    if (inside(a) && inside(b)) { const s = gridSurface(g); return { v: s.height(b.x, b.y) - s.height(a.x, a.y), src: 'grid' }; }
  }
  if (!S.settings.weather) return null;
  const key = `${from.lat.toFixed(4)},${from.lon.toFixed(4)}|${pin.lat.toFixed(4)},${pin.lon.toFixed(4)}`;
  if (elevCache.has(key)) return elevCache.get(key);
  elevCache.set(key, null);
  fetchElevations([from, pin]).then(([a, b]) => { if (a != null && b != null) { elevCache.set(key, { v: b - a, src: 'dem' }); cards(); } }).catch(() => {});
  return null;
}
const f1 = v => (v == null || !Number.isFinite(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const sgn = (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);

function cards() {
  const box = $('#cards'); if (!box) return;
  const h = activeHole(), shot = shotOf(), me = ballPos() || shot?.start || null; // GPS가 없어도 친 곳에서 이어서 안내
  const pin = h.pin || h.green;
  if (!pin) {
    box.innerHTML = `<div class="m-label">그린 위치가 필요해요</div>
      <p class="m-text">이 골프장은 스코어카드만 있어요. 지도에서 <b>그린 가운데</b>를 한 번 누르면 그때부터 거리가 나와요. (이 휴대폰에 저장)</p>
      <button class="m-btn primary" id="markGreen">🗺️ 지도에서 그린 찍기</button>`;
    $('#markGreen').onclick = () => { if (P.view !== '2d') { P.view = '2d'; persist(); render(); } P.marking = 'green'; toast('🗺️ 위성지도에서 그린 가운데를 눌러 주세요 (확대하면 더 정확해요)', 4000); };
    return;
  }
  if (!me) { box.innerHTML = `<div class="m-label">위치를 찾는 중이에요…</div><p class="m-text">하늘이 트인 곳에서 잠깐 기다려 주세요. 실내라면 ☰ → 설정 → GPS 시뮬레이션을 켜거나 [📍 공 위치]로 지도에 공을 찍어요.</p>`; return; }
  const D = distance(me, pin), last = S.round?.lastShot?.hole === h.n ? S.round.lastShot : null;
  // ① 친 공을 찾으러 가는 중
  if (shot) {
    const t = toBall(Sensors.pos || me, shot.pred, Sensors.heading), drop = pinDrop(shot.pred, pin, h);
    box.innerHTML = `<div class="m-label">내 공까지 <span>${esc(shot.clubName)} · 찾을 범위 약 ${Math.round(shot.r80)}m</span></div>
      <div class="m-big"><b>${f1(t.d)}</b><small>m</small><i class="m-arrow" id="ballArrow" style="transform:rotate(${t.rel ?? 0}deg)">⬆</i></div>
      <p class="m-text">${t.rel == null ? `${t.compass}쪽 (${Math.round(t.bearing)}°)으로 걸어가요` : Math.abs(t.rel) < 12 ? '앞으로 쭉 걸어가요' : `${t.rel > 0 ? '오른쪽' : '왼쪽'}으로 ${Math.round(Math.abs(t.rel))}° 돌아서 걸어가요`}</p>
      <div class="m-row"><div><span>예상 비거리</span><b>${f1(distance(shot.start, shot.pred))}<small>m</small></b></div><div><span>남은 거리</span><b>${f1(distance(shot.pred, pin))}<small>m</small></b></div><div><span>핀 고저차</span><b>${drop ? sgn(drop.v, drop.src === 'grid' ? 2 : 1) + '<small>m</small>' : '—'}</b></div></div>`;
    return;
  }
  const isBall = P.ballPos && P.ballHole === h.n;
  // ② 대회 모드: 직선 거리만 (규칙 4.3a)
  if (!allowed('clubRec')) {
    const dF = h.front ? distance(me, h.front) : null, dB = h.back ? distance(me, h.back) : null;
    box.innerHTML = `<div class="m-label">깃발까지 <span>🏆 대회 모드 · 거리만 표시</span></div>
      <div class="m-big"><b>${f1(D)}</b><small>m</small><i class="m-ico"></i></div>
      <div class="m-row"><div><span>그린 앞</span><b>${dF ? f1(dF) + '<small>m</small>' : '—'}</b></div><div><span>그린 뒤</span><b>${dB ? f1(dB) + '<small>m</small>' : '—'}</b></div><div><span>${last ? '방금 샷' : 'GPS'}</span><b>${last ? f1(last.dist) + '<small>m</small>' : '±' + Math.round(me.acc || 0) + '<small>m</small>'}</b></div></div>`;
    return;
  }
  // ③ 퍼팅 거리
  if (adv?.kind === 'putt' || adv?.kind === 'holed') {
    const drop = pinDrop(me, pin, h);
    box.innerHTML = `<div class="m-label">퍼팅 거리 <span>${adv.kind === 'holed' ? '🎉 홀 바로 옆!' : '퍼터로 굴려요'}</span></div>
      <div class="m-big"><b>${f1(D)}</b><small>m</small><i class="m-ico"></i></div>
      <div class="m-row"><div><span>핀 고저차</span><b>${drop ? sgn(drop.v, 2) + '<small>m</small>' : '—'}</b></div><div><span>${drop ? (drop.v > 0.05 ? '오르막' : drop.v < -0.05 ? '내리막' : '거의 평지') : '경사'}</span><b>${drop ? (drop.src === 'grid' ? '그린맵' : '지형') : '—'}</b></div><div><span>${last ? '방금 샷' : 'GPS'}</span><b>${last ? f1(last.dist) + '<small>m</small>' : '±' + Math.round(me.acc || 0) + '<small>m</small>'}</b></div></div>
      <a class="m-btn" href="#/green">🟢 굴릴 방향 · 세기 계산하기</a>`;
    return;
  }
  // ④ 다음 샷 추천: 비거리 · 남은 거리 · 핀 고저차
  const carry = adv?.carry ?? D, landing = adv?.landing || pin, rest = distance(landing, pin), drop = pinDrop(landing, pin, h);
  const cb = adv?.club ? S.bag.find(c => c.id === adv.club) : null, rel = adv?.rel || 0;
  box.innerHTML = `<div class="m-label">비거리 <span>${adv?.club ? `${esc(adv.clubName)} · 힘 ${adv.power}% (${esc(adv.swing.short)})` : '추천 계산 중…'}</span></div>
    <div class="m-big"><b>${f1(carry)}</b><small>m</small><i class="m-ico"></i></div>
    <div class="m-row"><div><span>남은 거리</span><b>${f1(rest)}<small>m</small></b></div><div><span>핀 고저차</span><b>${drop ? sgn(drop.v, drop.src === 'grid' ? 2 : 1) + '<small>m</small>' : '—'}</b></div><div><span>${isBall ? '공→깃발' : '깃발까지'}</span><b>${f1(D)}<small>m</small></b>${h.front && h.back ? `<em class="m-fb">앞 ${Math.round(distance(me, h.front))} · 뒤 ${Math.round(distance(me, h.back))}</em>` : ''}</div></div>
    ${adv?.club ? `<div class="m-dir"><i style="transform:rotate(${Math.max(-60, Math.min(60, rel * 3))}deg)">⬆</i><span><b>${dirWords(rel)}</b> · 방위 ${Math.round(adv.aimBearing)}° ${compassName(adv.aimBearing)}${Math.abs(adv.lateral || 0) >= 2 ? ` · 깃발 줄에서 ${rel > 0 ? '오른쪽' : '왼쪽'} ${Math.round(Math.abs(adv.lateral))}m` : ''}</span></div>` : ''}
    ${last ? `<div class="m-foot">방금 샷 <b>${f1(last.dist)}m</b>${last.club ? ` · ${esc(last.club)}` : ''}</div>` : cb ? `<div class="m-foot">내 ${esc(cb.name)} 비거리 ${Math.round(cb.carry)}m · ${cb.learned ? `실제 ${cb.n}샷 학습 ✓` : `기본값 (${cb.n || 0}/3샷)`}${adv.pBad > 0.12 ? ` · ⚠ 위험 ${Math.round(adv.pBad * 100)}%` : ''}</div>` : ''}`;
}

// 코스 지도 (작은 창): 북쪽 위 · 공 → 떨어질 곳 → 깃발
function mini() {
  const box = $('#mini'); if (!box) return;
  const sd = sceneData(), pts = [sd.from, sd.landing, sd.pin, sd.ball].filter(Boolean);
  if (pts.length < 2) { box.innerHTML = '<span class="mini-t">코스 지도</span><span class="mini-n">N</span>'; return; }
  const o = pts[0], q = p => (p ? toLocal(o, p) : null), L = pts.map(q);
  const xs = L.map(p => p.x), ys = L.map(p => p.y), span = Math.max(30, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2, S_ = 76 / span;
  const X = p => (60 + (p.x - cx) * S_).toFixed(1), Y = p => (64 - (p.y - cy) * S_).toFixed(1);
  const a = q(sd.from), l = q(sd.landing), pn = q(sd.pin), b = q(sd.ball);
  const line = (u, v, c) => (u && v ? `<line x1="${X(u)}" y1="${Y(u)}" x2="${X(v)}" y2="${Y(v)}" class="${c}"/>` : '');
  const dot = (u, r, c) => (u ? `<circle cx="${X(u)}" cy="${Y(u)}" r="${r}" class="${c}"/>` : '');
  box.innerHTML = `<span class="mini-t">코스 지도</span><span class="mini-n">N</span><svg viewBox="0 0 120 120" aria-hidden="true">
    ${l ? line(a, l, 'mn-rec') + line(l, pn, 'mn-rest') : line(a, pn, 'mn-rec')}
    ${dot(b, 4, 'mn-ball')}${dot(a, 4, 'mn-me')}${dot(l, 3, 'mn-land')}${dot(pn, 4.5, 'mn-pin')}</svg>`;
}

function arrowOnly() {
  const shot = shotOf(), a = $('#ballArrow'); if (!shot || !a || !Sensors.pos) return;
  const t = toBall(Sensors.pos, shot.pred, Sensors.heading); if (t.rel != null) a.style.transform = `rotate(${t.rel}deg)`;
}

function actions() {
  const box = $('#act'); if (!box) return;
  const shot = shotOf(), h = activeHole(), isBall = P.ballPos && P.ballHole === h.n;
  if (shot) {
    box.innerHTML = `<button class="a-main" id="found">✅ 공 찾았어요!</button>
      <div class="a-row"><button id="lostb">📡 공이 안 보여요</button><button id="cancel">↩ 취소</button></div>`;
    $('#found').onclick = found;
    $('#lostb').onclick = () => { App_.go('lost'); };
    $('#cancel').onclick = () => { delete S.round.liveShot; save('round'); update(true); };
    return;
  }
  box.innerHTML = `<button class="a-main" id="hit">🏌️ 쳤어요!</button>
    <div class="a-row"><button id="mark">📍 ${isBall ? '공 다시 찍기' : '공 위치'}</button>${isBall ? '<button id="useMe">🧍 내 위치</button>' : ''}<button id="nextH">다음 홀 ▶</button><button id="yd">📋 거리표</button><a href="#/green">🟢 그린</a><a href="#/score">📝 점수</a></div>`;
  $('#hit').onclick = hit;
  $('#mark').onclick = () => markBall();
  $('#useMe')?.addEventListener('click', () => { P.ballPos = null; persist(); update(true); });
  $('#nextH').onclick = quickScore;
  $('#yd').onclick = yardBook;
}

// 📋 거리표: 그린 앞·중앙·뒤 + 해저드 앞/넘기기 (먼 순서)
function yardBook() {
  const h = activeHole(), me = ballPos() || shotOf()?.start;
  if (!me) return toast('위치를 찾는 중이에요 · [📍 공 위치]로 찍어 주세요');
  const pin = h.pin || h.green, rows = [];
  if (h.back) rows.push(['그린 뒤', distance(me, h.back)]);
  if (pin) rows.push([h.pin ? '깃발' : '그린 중앙', distance(me, pin), true]);
  if (h.front) rows.push(['그린 앞', distance(me, h.front)]);
  const brgP = pin ? bearing(me, pin) : 0;
  for (const z of h.hazards || []) {
    if (!HZ_NAME[z.type]) continue;
    const d = distance(me, z); if (d < 10) continue;
    const off = normAngle(bearing(me, z) - brgP), side = Math.abs(off) < 8 ? '가운데' : off > 0 ? '오른쪽' : '왼쪽';
    if (pin && d - z.r > distance(me, pin) + 30) continue;
    rows.push([`${side} ${HZ_NAME[z.type]} 넘기기`, d + z.r], [`${side} ${HZ_NAME[z.type]} 앞`, Math.max(0, d - z.r)]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  const clubOk = allowed('clubRec');
  sheet({ title: `📋 ${holeName(h)} 거리표`, body: `<div class="yd">${rows.map(([n, d, main]) => { const c = clubOk ? clubFor(d) : null; return `<div class="yd-r ${main ? 'main' : ''}"><span>${esc(n)}</span><b>${Math.round(d)}<small>m</small></b><i>${c ? esc(c.id) : ''}</i></div>`; }).join('')}</div><p class="sub">지금 공 위치에서 잰 직선거리예요. 오른쪽은 내 클럽 비거리로 고른 클럽이에요.</p>`, actions: [{ label: '닫기' }] });
}

// 다음 홀로 가기 전 점수 한 번에: 큰 버튼(버디·파·보기…) + 퍼트 + 티샷 방향
const TERMS = { '-3': '앨버트로스', '-2': '이글', '-1': '버디', 0: '파', 1: '보기', 2: '더블', 3: '트리플' };
function quickScore() {
  const r = S.round, h = activeHole();
  const rh = r?.holes.find(x => x.n === h?.n), sc = rh?.scores[0];
  if (!sc) return App_.stepHole(1);
  const par = rh.par || h.par || 4;
  let strokes = sc.strokes || par, putts = sc.putts || (strokes > 1 ? 2 : 0), fw = sc.fw || null;
  const body = () => `<div class="qs">
      <div class="qs-l">몇 타 쳤어요? ${sc.strokes ? `<span>(기록된 샷 ${sc.strokes}타)</span>` : ''}</div>
      <div class="qs-g">${[-2, -1, 0, 1, 2, 3].map(d => `<button data-s="${par + d}" class="${strokes === par + d ? 'on' : ''} t${d}"><b>${par + d}</b><small>${TERMS[d]}</small></button>`).join('')}</div>
      <div class="qs-step"><button data-sd="-1">−</button><b>${strokes}타 · ${strokes - par > 0 ? '+' : ''}${strokes - par === 0 ? 'E' : strokes - par}</b><button data-sd="1">+</button></div>
      <div class="qs-l">퍼트는 몇 번?</div>
      <div class="qs-g p">${[0, 1, 2, 3, 4].map(n => `<button data-p="${n}" class="${putts === n ? 'on' : ''}"><b>${n}</b></button>`).join('')}</div>
      ${par >= 4 ? `<div class="qs-l">티샷은 어디로? <span>(선택)</span></div><div class="qs-g f">${[['L', '⬅ 왼쪽'], ['C', '⬆ 페어웨이'], ['R', '오른쪽 ➡']].map(([k, n]) => `<button data-f="${k}" class="${fw === k ? 'on' : ''}">${n}</button>`).join('')}</div>` : ''}
    </div>`;
  const s = sheet({ title: `${holeName(h)} · 파 ${par} 점수`, body: body(), actions: [{ label: '나중에' , onClick: () => App_.stepHole(1) }, { label: '저장하고 다음 홀 ▶', kind: 'primary', onClick: () => {
    sc.strokes = strokes; sc.putts = Math.min(putts, strokes); if (fw) sc.fw = fw; else delete sc.fw;
    save('round'); toast(`${holeName(h)} ${strokes}타 (${TERMS[strokes - par] || (strokes - par > 0 ? '+' + (strokes - par) : strokes - par)}) 저장`); App_.stepHole(1);
  } }] });
  const root = s?.el || document.querySelector('#sheet');
  const wire = () => {
    const box = root.querySelector('.qs'); if (!box) return;
    box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { strokes = +b.dataset.s; if (putts > strokes) putts = strokes; redraw(); });
    box.querySelectorAll('[data-sd]').forEach(b => b.onclick = () => { strokes = Math.max(1, strokes + +b.dataset.sd); if (putts > strokes) putts = strokes; redraw(); });
    box.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { putts = +b.dataset.p; if (putts > strokes) strokes = putts; redraw(); });
    box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { fw = fw === b.dataset.f ? null : b.dataset.f; redraw(); });
  };
  const redraw = () => { const box = root.querySelector('.qs'); if (box) { box.outerHTML = body(); wire(); } };
  wire();
}

// 스코어카드(코스 DB): 파 · 핸디캡 · 티별 거리 · 공략 메모
function scoreCard(h) {
  const s = h.scorecard; if (!s) return '';
  const tees = [['백', s.back, '#222'], ['블루', s.blue, '#1f5fbf'], ['화이트', s.white, '#999'], ['레드', s.red, '#c0392b']].filter(t => t[1] != null);
  const hd = h.hdcpNine ?? h.hdcp ?? h.hdcpCard;
  return `<div class="pcard scard"><div class="row" style="justify-content:space-between"><b>📋 스코어카드</b><span class="sub">파 ${h.par}${hd ? ` · 핸디캡 ${hd}` : ''}</span></div>
    <div class="tees">${tees.map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} <b>${v}</b>${s.unit}</span>`).join('')}</div>
    ${h.note ? `<p class="sub" style="margin:6px 0 0">💡 ${esc(h.note)}</p>` : ''}</div>`;
}

// 지도에서 공 위치 찍기 (공이 내 위치와 다를 때 · 실내 연습)
function markBall(then) {
  if (P.view !== '2d') { P.view = '2d'; persist(); render(); }
  toast(then === 'hit' ? '📍 위치를 못 찾았어요 · 지도에서 공을 친 곳을 눌러 주세요' : '🗺️ 지도에서 내 공이 있는 곳을 눌러요', 4000);
  P.marking = true; P.afterMark = then === 'hit' ? 'hit' : null;
}

async function hit() {
  const h = activeHole(), start = ballPos();
  if (!S.round) return toast('라운드를 먼저 시작해요');
  if (!start) { markBall('hit'); return; } // GPS가 없으면 지도에서 공 위치를 찍은 뒤 이어서 기록
  const club = adv?.club && adv.club !== 'PT' ? S.bag.find(c => c.id === adv.club) : null;
  const pick = club || S.bag.filter(c => c.enabled).sort((a, b) => Math.abs(a.carry - distance(start, h.pin || h.green)) - Math.abs(b.carry - distance(start, h.pin || h.green)))[0];
  const aim = adv?.aimBearing ?? bearing(start, h.pin || h.green), power = adv?.power ?? 100;
  const pred = predictBall({ start, aimBearing: aim, club: pick, hole: h, power });
  S.round.liveShot = { hole: h.n, start: { lat: start.lat, lon: start.lon }, aimBearing: aim, club: pick.id, clubName: pick.name, power, carry: pick.carry * power / 100, pred: pred.center, r80: pred.r80, ts: Date.now() };
  const sc = S.round.holes.find(x => x.n === h.n)?.scores[0];
  if (sc) { sc.strokes = (sc.strokes || 0) + 1; }
  save('round'); vibrate(80); speak(`공은 약 ${Math.round(distance(start, pred.center))}미터 앞에 있어요`);
  toast(`${h.n}번 홀 ${sc?.strokes || 1}타째 기록 · 이제 공을 찾으러 가요`, 3000);
  P.ballPos = null; persist(); update(true);
}

async function found() {
  const shot = shotOf(); if (!shot) return;
  const f = Sensors.pos ? await sampleFix(1500) : null;
  if (f) {
    const total = distance(shot.start, f);
    if (shot.power >= 95 && total > 20) {
      S.shots.push({ id: Date.now(), club: shot.club, total, carry: total / 1.05, latDeg: normAngle(bearing(shot.start, f) - shot.aimBearing), start: shot.start, end: { lat: f.lat, lon: f.lon }, ts: Date.now(), fromPlay: true });
      const i = S.bag.findIndex(c => c.id === shot.club); if (i >= 0) S.bag[i] = learnClub(S.bag[i], S.shots);
      save('shots', 'bag');
    }
    S.round.lastShot = { hole: shot.hole, dist: total, club: shot.clubName, ts: Date.now() };
    toast(`잘했어요! ${Math.round(total)}m 날아갔어요`, 3000);
    P.ballPos = { lat: f.lat, lon: f.lon }; P.ballHole = shot.hole;
    (S.round.track ||= []).push({ hole: shot.hole, start: shot.start, end: { lat: f.lat, lon: f.lon }, club: shot.club, dist: total });
  } else { // GPS가 없으면 예상 위치에 공을 놓음 (다르면 다시 찍기)
    P.ballPos = { lat: shot.pred.lat, lon: shot.pred.lon }; P.ballHole = shot.hole;
    (S.round.track ||= []).push({ hole: shot.hole, start: shot.start, end: { lat: shot.pred.lat, lon: shot.pred.lon }, club: shot.club, dist: distance(shot.start, shot.pred), est: true });
    toast('잘했어요! 예상 위치에 공을 놓았어요 · 다르면 [📍 공 다시 찍기]', 3500);
  }
  delete S.round.liveShot; save('round'); persist(); vibrate([60, 40, 60]); update(true);
}

// ---------------- 보기 (2D · 3D · 4D · AR) ----------------
function sceneData() {
  const h = activeHole(), shot = shotOf(), me = ballPos() || shot?.start || null;
  return {
    me: Sensors.pos || me, ball: shot ? shot.pred : (P.ballPos && P.ballHole === h?.n ? P.ballPos : null), from: me, pin: h ? (h.pin || h.green) : null,
    landing: !shot && adv?.landing && allowed('clubRec') ? adv.landing : null, ellipse: !shot && allowed('clubRec') ? adv?.ellipse : null,
    hazards: h?.hazards || [], hole: h,
    apex: !shot && adv?.landing && allowed('clubRec') ? (conditionsEffect(adv.club && adv.club !== 'PT' ? adv.club : '7i', Math.max(10, adv.carry || 0)).apex || 20) : null,
  };
}

async function mountView() {
  const stage = $('#stage'), h = activeHole();
  stage.className = 'stage imm-stage ' + P.view;
  if (P.view === '2d') {
    stage.innerHTML = '<div class="map" id="pmap"></div><div class="zoomb"><button id="zi">＋</button><button id="zo">－</button></div>';
    const c = activeCourse(), near = c.holes.find(x => x.green) || null;
    const c0 = ballPos() || h.green || h.tee || near?.green || c.center || Sensors.pos || { lat: 36.5, lon: 127.8 };
    map = createMap($('#pmap'), { center: ll(c0), zoom: h.green || ballPos() || near ? 17 : c.center ? (c.center.precision === "sigungu" ? 12 : 15) : 7 });
    if (!map) return;
    drawHole(map, h); lay = L.layerGroup().addTo(map); map.on('zoomend', () => drawRings(sceneData()));
    $('#zi').onclick = () => map.zoomIn(); $('#zo').onclick = () => map.zoomOut();
    map.on('click', e => {
      if (!P.marking) { // 아무 곳이나 누르면 그곳까지 거리 (목표점 이동)
        if (!shotOf() && sceneData().from) { P.target = { hole: h.n, lat: e.latlng.lat, lon: e.latlng.lng }; persist(); drawRings(sceneData()); vibrate(20); }
        return;
      }
      if (P.marking === 'green') {
        P.marking = false; h.green = { lat: +e.latlng.lat.toFixed(7), lon: +e.latlng.lng.toFixed(7) }; h.greenBy = 'user'; save('courses');
        vibrate(40); toast('🟢 그린 위치를 저장했어요'); adv = null; advKey = ''; drawHole(map, h); update(true); fit2d(); return;
      }
      P.marking = false; P.ballPos = { lat: e.latlng.lat, lon: e.latlng.lng }; P.ballHole = h.n; persist(); vibrate(40);
      if (P.afterMark === 'hit') { P.afterMark = null; hit(); fit2d(); return; }
      update(true); fit2d();
    });
    fit2d(); setTimeout(() => { map?.invalidateSize(); fit2d(); }, 150);
  } else if (P.view === '3d' || P.view === '4d') {
    stage.innerHTML = `<div class="map3" id="p3"></div><div class="zoomb"><button id="zi">＋</button><button id="zo">－</button><button id="tilt" title="기울기">⛰️</button></div>
      ${P.view === '4d' ? `<div class="tbar"><button class="btn small" id="fly">▶ 공 날려 보기</button><button class="btn small" id="over">🎬 홀 미리 날아보기</button><input type="range" id="tt" min="0" max="100" value="0" aria-label="시간"><span id="tinfo"></span></div>` : ''}<div class="loading3">⛰️ 3D 지형을 불러오는 중…</div>`;
    try {
      const sd = sceneData(), center = sd.me || h.green || h.tee || activeCourse().center || { lat: 36.5, lon: 127.8 };
      v3 = await import('./view3d.js').then(m => m.create3D($('#p3'), { center, bearingDeg: sd.me && sd.pin ? bearing(sd.me, sd.pin) : 0 }));
      if (!$('#p3')) { v3.destroy(); v3 = null; return; }
      stage.querySelector('.loading3')?.remove();
      $('#zi').onclick = () => v3.zoomBy(0.7); $('#zo').onclick = () => v3.zoomBy(-0.7);
      let tilted = true; $('#tilt').onclick = () => { tilted = !tilted; v3.setPitch(tilted ? 62 : 0); };
      scene(); v3.fitScene({ top: 150, bottom: ($('.imm-sheet')?.offsetHeight || 320) + 20, left: 60, right: 70 });
      if (h.greenGrid) { v3.setGreen(h.greenGrid); toast('🟢 이 홀은 정밀 측량 그린맵이 있어요 — 그린을 확대해 보세요 (색 = 경사, 흰 선 = 높이 2cm)', 3500); }
      if (P.view === '4d') {
        const go = async (from, to, club) => {
          const apex = conditionsEffect(club?.id || '7i', distance(from, to)).apex || 25;
          v3.clearFlight();
          await v3.playFlight(from, to, apex, { onFrame: (t, i) => { $('#tt').value = Math.round(t * 100); $('#tinfo').textContent = `${Math.round(i.dist)}m · 높이 ${Math.round(i.height)}m`; } });
        };
        $('#fly').onclick = () => { const sd2 = sceneData(); if (!sd2.from || !(sd2.landing || sd2.pin)) return toast('위치를 찾는 중이에요'); go(sd2.from, sd2.landing || sd2.pin, S.bag.find(c => c.id === adv?.club)); };
        $('#over').onclick = () => v3.flyover(h);
        $('#tt').oninput = e => { const sd2 = sceneData(); if (!sd2.from) return; const to = sd2.landing || sd2.pin, apex = conditionsEffect(adv?.club || '7i', distance(sd2.from, to)).apex || 25; const i = v3.flightAt(sd2.from, to, apex, e.target.value / 100); $('#tinfo').textContent = `${Math.round(i.dist)}m · 높이 ${Math.round(i.height)}m`; };
      }
    } catch (e) { stage.innerHTML = `<div class="stage-err">⛰️ 3D 지도를 열 수 없어요<br><small>${esc(e.message)}</small><br><button class="btn small" id="to2d">2D로 보기</button></div>`; $('#to2d').onclick = () => { P.view = '2d'; persist(); render(); }; }
  } else if (P.view === 'ar') {
    stage.innerHTML = '<div class="arbox" id="arb"></div>';
    const { startAR } = await import('./arview.js');
    if (!$('#arb')) return;
    arStop = await startAR($('#arb'), () => { const sd = sceneData(); return { ...sd, me: Sensors.pos || sd.from }; });
  }
}

function fit2d() {
  if (!map) return;
  const sd = sceneData();
  // 거리 링이 보일 때: 목표 주변(앞뒤 ±35m)을 크게 — 내 위치는 작은 코스 지도에서 확인
  if (sd.from && sd.pin && !shotOf() && distance(sd.from, sd.pin) >= 60) {
    const t = targetOf(sd), br = bearing(sd.from, t), r = Math.min(55, distance(sd.from, t) * 0.35);
    const box = [destination(t, br, r), destination(t, br + 180, r), destination(t, br + 90, r * 0.8), destination(t, br - 90, r * 0.8)].map(ll);
    map.fitBounds(L.latLngBounds(box), { paddingTopLeft: [140, 150], paddingBottomRight: [120, ($('.imm-sheet')?.offsetHeight || 320) + 20], maxZoom: 19.5, animate: false });
    return;
  }
  const pts = [sd.me, sd.from, sd.pin, sd.landing, sd.ball].filter(Boolean).map(ll);
  if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [70, 150], paddingBottomRight: [70, 340], maxZoom: 19, animate: false });
}

function scene() {
  const sd = sceneData();
  if (v3) { v3.setScene({ me: sd.from, pin: sd.pin, landing: sd.landing, ball: sd.ball, ellipse: sd.ellipse }); v3.setArc(sd.from, sd.landing, sd.apex); return; }
  if (!map || !lay) return;
  lay.clearLayers();
  const { from, pin, landing, ball } = sd;
  if (from && pin) L.polyline([ll(from), ll(pin)], { color: '#ffffff', weight: 2, opacity: 0.75, dashArray: '4 6', interactive: false }).addTo(lay);
  if (sd.ellipse?.length > 2) L.polygon(sd.ellipse.map(ll), { color: '#ffe27a', weight: 1, fillOpacity: 0.18, interactive: false }).addTo(lay);
  if (from && landing) {
    L.polyline([ll(from), ll(landing)], { color: '#5ee6a8', weight: 14, opacity: 0.35, lineCap: 'round', interactive: false }).addTo(lay);
    L.polyline([ll(from), ll(landing)], { color: '#ffffff', weight: 4, opacity: 0.98, lineCap: 'round', interactive: false }).addTo(lay);
    if (distance(landing, pin) > 3) L.polyline([ll(landing), ll(pin)], { color: '#ffffff', weight: 3, dashArray: '2 7', interactive: false }).addTo(lay);
    if (shotOf() || distance(from, pin) < 25) L.marker(ll(landing), { icon: labelIcon(`🎯 ${Math.round(distance(from, landing))}m`, 'tgt'), interactive: false }).addTo(lay);
    const rel = adv?.rel || 0;
    if (Math.abs(rel) >= 0.75) L.marker(ll(destination(from, adv.aimBearing, Math.min(40, distance(from, landing) / 3))), { icon: labelIcon(`${rel > 0 ? '오른쪽' : '왼쪽'} ${Math.abs(rel).toFixed(1)}°`, 'ang'), interactive: false }).addTo(lay);
  }
  if (from) L.circleMarker(ll(from), { radius: 9, color: '#fff', weight: 3, fillColor: P.ballPos ? '#ffffff' : '#2b7bff', fillOpacity: 1 }).bindTooltip(P.ballPos ? '내 공' : '나').addTo(lay);
  if (ball) { L.circle(ll(ball), { radius: shotOf()?.r80 || 10, color: '#ff6b5a', weight: 2, fillOpacity: 0.15, interactive: false }).addTo(lay); L.marker(ll(ball), { icon: labelIcon(`⚪ 내 공 ${Math.round(distance(Sensors.pos || from, ball))}m`, 'ball'), interactive: false }).addTo(lay); }
  if (pin && from && (shotOf() || distance(from, pin) < 25)) L.marker(ll(pin), { icon: labelIcon(`⛳ ${Math.round(distance(from, pin))}m`, 'pin'), interactive: false }).addTo(lay);
  drawRings(sd);
}

// ---------- 거리 링 · 목표점(레이업) · 해저드 캐리 · 체감 거리(경사·바람·기온) ----------
const HZ_NAME = { bunker: '벙커', water: '물', ob: 'OB', trees: '나무' };
const divI = (html, cls) => L.divIcon({ className: 'rg-ic ' + cls, html, iconSize: [0, 0] });
function targetOf(sd) {
  const h = activeHole();
  if (P.target && P.target.hole === h?.n) return P.target;
  return sd.landing || sd.pin;
}
function clubFor(d) {
  const cs = S.bag.filter(c => c.enabled !== false && c.carry > 0).sort((a, b) => a.carry - b.carry);
  if (!cs.length) return null;
  return cs.find(c => c.carry >= d * 0.97) || cs.at(-1);
}
function plays(sd, d, brg, dh = 0) {
  if (!allowed('playsLike') || P.plOff) return null;
  const w = App_.weather, wind = allowed('windAdjust') && w;
  return playsLike({ dist: d, dh, windSpeed: wind ? w.windSpeed || 0 : 0, windFrom: wind ? w.windFrom || 0 : 0, shotBearing: brg, tempC: w?.temp ?? 20 });
}
let ringLay = null;
function drawRings(sd) {
  const box = $('#stage'); box?.querySelector('.rg-hud')?.remove();
  if (ringLay) { ringLay.remove(); ringLay = null; }
  const { from, pin } = sd;
  if (!map) return;
  ringLay = L.layerGroup().addTo(map);
  drawTrack();
  if (!from || !pin || shotOf() || distance(from, pin) < 25) return;
  const h = activeHole(), tgt = targetOf(sd), rT = distance(from, tgt), brg = bearing(from, tgt);
  const nearPin = distance(tgt, pin) < 15, drop = nearPin ? pinDrop(from, pin, h) : null;
  const clubsOk = allowed('clubRec');
  // 화면에서 링 사이가 28px 이상 벌어지도록 간격 선택 (확대하면 촘촘하게)
  const ppm = map.latLngToContainerPoint(ll(tgt)).distanceTo(map.latLngToContainerPoint(ll(destination(tgt, brg, 10)))) / 10;
  const step = [2, 3, 5, 10, 20, 25, 50].find(v => v * ppm >= 24) || 50, dense = step * ppm < 30;
  const ring = (r, main) => {
    const span = Math.min(30, Math.atan2(main ? 30 : 24, r) * 180 / Math.PI);
    const pts = []; for (let a = -span; a <= span + 0.01; a += span / 16) pts.push(ll(destination(from, brg + a, r)));
    L.polyline(pts, main ? { color: '#ffc83d', weight: 4, opacity: 1, interactive: false } : { color: '#ffffff', weight: 1.6, opacity: 0.85, interactive: false }).addTo(ringLay);
    const pl = plays(sd, r, brg, main && drop ? drop.v : 0), eff = pl ? pl.total : r, c = clubsOk ? clubFor(eff) : null;
    const left = `${Math.round(eff)}m${c ? ` <b>${esc(c.id)}</b>` : ''}`;
    if (main) {
      const dz = main && drop ? `<em>${drop.v >= 0 ? '↑' : '↓'} ${Math.abs(drop.v).toFixed(1)}m</em>` : '';
      L.marker(pts[0], { icon: divI(`<div><small>${pl ? '체감 거리' : '목표까지'}</small>${left}${dz}</div>`, 'rg-pl'), interactive: false }).addTo(ringLay);
      L.marker(pts.at(-1), { icon: divI(`<div>${Math.round(r)}m</div>`, 'rg-tag'), interactive: false }).addTo(ringLay);
      return pl;
    }
    if (!dense) L.marker(pts[0], { icon: divI(`<div>${left}</div>`, 'rg-l'), interactive: false }).addTo(ringLay);
    L.marker(pts.at(-1), { icon: divI(`<div>${Math.round(r)}m</div>`, 'rg-r'), interactive: false }).addTo(ringLay);
  };
  for (const k of [-2, -1, 1, 2]) { const r = rT + k * step; if (r > 15) ring(r, false); }
  const pl = ring(rT, true);
  if (distance(tgt, pin) > 12) { // 목표에서 깃발까지 남는 거리
    L.polyline([ll(tgt), ll(pin)], { color: '#ffc83d', weight: 2, dashArray: '3 6', interactive: false }).addTo(ringLay);
    L.marker(ll(destination(tgt, bearing(tgt, pin), distance(tgt, pin) / 2)), { icon: divI(`<div>남은 ${Math.round(distance(tgt, pin))}m</div>`, 'rg-rest'), interactive: false }).addTo(ringLay);
  }
  // 해저드: 앞까지 · 넘기기(캐리) 거리
  for (const z of h.hazards || []) {
    const dz = distance(from, z), off = Math.abs(normAngle(bearing(from, z) - brg));
    if (dz < 20 || dz > rT + 60 || off > 40 || !HZ_NAME[z.type]) continue;
    const front = Math.max(0, dz - z.r), carry = dz + z.r;
    L.marker(ll(z), { icon: divI(`<div>${HZ_NAME[z.type]} <span>앞 ${Math.round(front)}</span> · <b>넘기기 ${Math.round(carry)}m</b></div>`, 'rg-hz ' + z.type), interactive: false }).addTo(ringLay);
  }
  // 목표점: 끌어서 레이업 지점 바꾸기 · 두 번 누르면 원래대로
  const ret = L.marker(ll(tgt), { icon: divI('<div><i></i></div>', 'rg-ret'), draggable: true, zIndexOffset: 900 }).addTo(ringLay);
  ret.on('dragend', e => { const q = e.target.getLatLng(); P.target = { hole: h.n, lat: q.lat, lon: q.lng }; persist(); drawRings(sceneData()); });
  ret.on('dblclick', () => { P.target = null; persist(); drawRings(sceneData()); toast('목표를 추천 지점으로 되돌렸어요'); });
  // 보정 설명 + 바람 표시
  if (box && allowed('playsLike') && P.plOff) { const hud = document.createElement('div'); hud.className = 'rg-hud'; hud.innerHTML = '<button class="rg-tog">체감 거리 <b>끔</b></button>'; box.appendChild(hud); hud.querySelector('button').onclick = () => { P.plOff = false; persist(); drawRings(sceneData()); }; }
  if (box && pl) {
    const pt = pl.parts, bits = [];
    if (Math.abs(pt.wind) >= 0.5) bits.push(`바람 ${pt.wind > 0 ? '+' : '−'}${Math.abs(pt.wind).toFixed(0)}`);
    if (Math.abs(pt.elev) >= 0.5) bits.push(`${pt.elev > 0 ? '오르막' : '내리막'} ${pt.elev > 0 ? '+' : '−'}${Math.abs(pt.elev).toFixed(0)}`);
    if (Math.abs(pt.temp) >= 0.5) bits.push(`기온 ${pt.temp > 0 ? '+' : '−'}${Math.abs(pt.temp).toFixed(0)}`);
    const diff = pl.total - rT, w = App_.weather;
    const msg = bits.length ? `${Math.abs(diff) < 0.5 ? '거의 그대로' : `${Math.abs(diff).toFixed(0)}m 더 ${diff > 0 ? '길게' : '짧게'}`} 쳐요 · ${bits.join(' · ')}m` : '바람·경사 영향 거의 없음';
    const windOk = allowed('windAdjust') && w && w.windSpeed != null;
    const hud = document.createElement('div'); hud.className = 'rg-hud';
    hud.innerHTML = `<button class="rg-tog on">체감 거리 <b>켬</b></button><div class="rg-msg">${msg}</div>${windOk ? `<div class="rg-wind"><span>바람</span><i style="transform:rotate(${(w.windFrom + 180) % 360}deg)">↑</i><b>${(+w.windSpeed).toFixed(1)}<small>m/s</small></b></div>` : ''}`;
    box.appendChild(hud); hud.querySelector('.rg-tog').onclick = () => { P.plOff = true; persist(); drawRings(sceneData()); };
  }
  drawPlans(sd);
}

// 휘어진 공 궤적(위에서 본 모습): 두 점 사이를 살짝 휜 곡선으로
function curve(a, b, bend = 0.12, n = 24) {
  const d = distance(a, b), br = bearing(a, b), out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, p = destination(a, br, d * t); out.push(ll(destination(p, br + 90, d * bend * 4 * t * (1 - t)))); }
  return out;
}
// 공략 계획: 추천(초록) + 다른 방법(파랑) · 예상 타수
function drawPlans(sd) {
  const { from, pin, landing } = sd;
  if (!adv || adv.kind !== 'full' || !landing || !allowed('clubRec')) return;
  const tag = (p, html, cls) => L.marker(p, { icon: divI(`<div>${html}</div>`, 'rg-plan ' + cls), interactive: false }).addTo(ringLay);
  if (distance(landing, pin) > 8) L.polyline(curve(landing, pin, 0.1), { color: '#5ee6a8', weight: 3, opacity: 0.9, dashArray: '1 7', lineCap: 'round', interactive: false }).addTo(ringLay);
  if (adv.es) tag(ll(landing), `추천 · 예상 <b>${adv.es.toFixed(1)}</b>타`, 'best');
  const alt = adv.alternatives?.[0], ac = alt && S.bag.find(c => c.id === alt.club);
  if (!ac) return;
  const D = distance(from, pin), c2 = Math.min(ac.carry, D), l2 = destination(from, bearing(from, pin), c2);
  L.polyline(curve(from, l2, -0.1), { color: '#4a9dff', weight: 3, opacity: 0.9, interactive: false }).addTo(ringLay);
  if (distance(l2, pin) > 8) L.polyline(curve(l2, pin, -0.1), { color: '#4a9dff', weight: 2.5, opacity: 0.85, dashArray: '1 7', lineCap: 'round', interactive: false }).addTo(ringLay);
  L.circleMarker(ll(l2), { radius: 5, color: '#fff', weight: 2, fillColor: '#4a9dff', fillOpacity: 1, interactive: false }).addTo(ringLay);
  tag(ll(l2), `다른 방법 ${esc(ac.id)}${alt.es ? ` · <b>${alt.es.toFixed(1)}</b>타` : ''}`, 'alt');
}
// 이번 홀에서 친 샷 기록 (휘어진 선 + 클럽 · 거리)
function drawTrack() {
  const h = activeHole(), tr = (S.round?.track || []).filter(t => t.hole === h?.n);
  tr.forEach((t, k) => {
    L.polyline(curve(t.start, t.end, 0.08), { color: '#7dff9e', weight: 3, opacity: 0.95, interactive: false }).addTo(ringLay);
    L.circleMarker(ll(t.end), { radius: 5, color: '#fff', weight: 2, fillColor: '#2f9e5a', fillOpacity: 1, interactive: false }).addTo(ringLay);
    L.marker(ll(t.start), { icon: divI(`<div><u>${k + 1}</u><i>${esc(t.club || '')}</i>${Math.round(t.dist)}m</div>`, 'rg-shot'), interactive: false }).addTo(ringLay);
  });
}
