// 쉬운 플레이 (초등학생도 쓰는 기본 흐름)
//  ① 골프장 고르기 → ② 코스 고르기 → ③ 홀 화면: 그린까지 거리 · 추천 클럽 · 힘(%) · 방향(각도) · 추천 길
//  → ④ "쳤어요!" → 내 공 위치(거리·방향) 안내 → "찾았어요"
//  보기: 2D 지도 · 3D 지형 · 4D(3D + 공 비행·홀 플라이오버 시간 재생) · AR 카메라
import { S, save, activeCourse, activeHole, allowed, currentMode, MODES } from '../core/state.js';
import { newRound, totals } from '../core/score.js';
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
import { prefetchCourse, offlineInfo, courseTiles } from '../core/offline.js';
import { openAICaddie } from './aisheet.js';
import { matches } from '../core/search.js';
import { analyzeShot, shotSummary, windAlongCross, kmh } from '../physics/shotfit.js';
import { shotSheet } from './lmform.js';

const KEY = 'pinpoint.play';
const P = (() => { try { return { view: '3d', ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { return { view: '3d' }; } })();
const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ viewSet: P.viewSet, view: P.view, step: P.step, q: P.q, ballPos: P.ballPos, ballHole: P.ballHole, ballSrc: P.ballSrc, ballAcc: P.ballAcc, target: P.target, plOff: P.plOff })); } catch {} };

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

function teardown() { document.documentElement.classList.remove('in-hole'); $('#stage')?.querySelector('.rg-hud')?.remove(); ringLay = null; destroyMap(map); map = lay = null; v3?.destroy(); v3 = null; arStop?.(); arStop = null; }
function render() {
  teardown(); unPos?.(); unOri?.(); clearInterval(timer); unPos = unOri = null;
  el_.className = 'play';
  if (P.step === 'club') return stepClub();
  if (P.step === 'course') return stepCourse();
  return stepHole();
}

// ---------------- ① 골프장 고르기 ----------------
// 📍 지금 있는 골프장 자동 제안: 내 위치에서 2.5km 안의 받은 코스 · 전국 골프장
function nearSuggest(clubs) {
  const box = $('#near'), me = Sensors.pos; if (!box || !me || P.q) return;
  const ctr = c => c.center || c.holes?.find(h => h.green)?.green || c.holes?.find(h => h.tee)?.tee;
  const mine = S.courses.filter(c => !c.demo && ctr(c)).map(c => ({ c, d: distance(me, ctr(c)) })).sort((a, b) => a.d - b.d)[0];
  const club = clubs.filter(c => c.lat && c.loc !== 'sigungu').map(c => ({ c, d: distance(me, c) })).sort((a, b) => a.d - b.d)[0];
  const pick = mine && mine.d < 2500 ? { name: mine.c.name, d: mine.d, go: () => choose(mine.c.id) } : club && club.d < 2500 ? { name: club.c.name, d: club.d, go: b => (club.c.official ? playClub(club.c, b) : clubInfo(club.c)) } : null;
  if (!pick) { box.innerHTML = ''; return; }
  box.innerHTML = `<button class="near-card" id="nearGo"><span class="pi">📍</span><span class="pt"><small>지금 여기 있어요!</small><b>${esc(pick.name)}</b><small>내 위치에서 약 ${pick.d < 1000 ? Math.round(pick.d) + 'm' : (pick.d / 1000).toFixed(1) + 'km'} · 누르면 시작해요</small></span><span class="pa">▶</span></button>`;
  $('#nearGo').onclick = e => pick.go(e.currentTarget);
}

function stepClub() {
  const q = (P.q || '').trim();
  const mine = S.courses.filter(c => !q || matches(q, c.name, c.official?.region));
  el_.innerHTML = `<div class="pwrap">
    <div class="pstep"><span class="on">1 골프장</span><span>2 코스</span><span>3 치기</span></div>
    <h1 class="pq">⛳ 어느 골프장에서 쳐요?</h1>
    <div id="near"></div>
    <input type="search" id="pq" class="pin-search" placeholder="🔍 골프장 이름으로 찾기" value="${esc(P.q || '')}">
    ${mine.length ? `<h2 class="ph2">⭐ 내 골프장</h2><div class="picks">${mine.map(c => `<button class="pick" data-c="${esc(c.id)}"><span class="pi">${c.official ? '🏌️' : c.demo ? '🧪' : '🗺️'}</span><span class="pt"><b>${esc(c.name)}</b><small>${c.holes.length}홀${c.official?.region ? ' · ' + esc(c.official.region) : ''}${c.todayPins ? ' · 오늘 핀 ✓' : ''}</small></span><span class="pa">›</span></button>`).join('')}</div>` : ''}
    <h2 class="ph2">${q ? '🔍 찾은 골프장' : Sensors.pos ? '📍 가까운 골프장' : '🏌️ 골프장'}</h2><div class="picks" id="dir"><p class="sub center">불러오는 중…</p></div>
    <button class="pbtn ghost" id="demo">🧪 연습용 가상 골프장으로 해 보기</button>
  </div>`;
  $('#pq').oninput = e => { P.q = e.target.value; persist(); clearTimeout(stepClub._t); stepClub._t = setTimeout(() => { const pos = e.target.selectionStart; stepClub(); const i = $('#pq'); i.focus(); i.setSelectionRange(pos, pos); }, 250); };
  $$('[data-c]').forEach(b => b.onclick = () => choose(b.dataset.c));
  $('#demo').onclick = demoPick;
  // 골프장 목록 하나로: 전국 골프장(KGBA) + 관리자가 올렸지만 목록에 없는 코스. 코스 정보가 있으면 누르자마자 받고 시작
  Promise.all([getClubs().catch(() => []), getCatalog().catch(() => [])]).then(([clubs, cat]) => {
    const box = $('#dir'); if (!box) return;
    if (!clubs.length && !cat.length) { box.innerHTML = '<p class="sub center">인터넷이 연결되면 골프장 목록이 보여요 · 아래 연습용 골프장은 바로 쓸 수 있어요</p>'; return; }
    const me = Sensors.pos, linked = new Set(clubs.map(c => c.official).filter(Boolean));
    const extra = cat.filter(e => !linked.has(e.id)).map(e => ({ id: 'cat:' + e.id, name: e.name, sido: e.region || '', sigungu: '', holes: e.holes, official: e.id }));
    let list = [...extra, ...clubs].filter(c => !findInstalled(c.official) || q).filter(c => !q || matches(q, c.name, c.sigungu, c.sido, (c.courses || []).map(x => x.name || x).join(' ')));
    nearSuggest(clubs);
    if (me) list = list.map(c => ({ ...c, d: c.lat ? distance(me, c) : Infinity })).sort((a, b) => a.d - b.d);
    else list = list.sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || a.name.localeCompare(b.name, 'ko'));
    const shown = list.slice(0, q ? 40 : (P.dirAll ? 60 : 8));
    box.innerHTML = shown.map(c => `<button class="pick ${c.official ? '' : 'dim'}" data-club="${esc(String(c.id))}"><span class="pi">${c.official ? '🏌️' : 'ℹ️'}</span><span class="pt"><b>${esc(c.name)}</b><small>${esc([c.sido, c.sigungu].filter(Boolean).join(' '))}${c.holes ? ` · ${c.holes}홀` : ''}${Number.isFinite(c.d) ? ` · ${(c.d / 1000).toFixed(c.d < 10000 ? 1 : 0)}km` : ''}</small></span><span class="pa">${c.official ? '<em class="go">바로 치기</em>' : '›'}</span></button>`).join('')
      + (q && !list.length ? '<p class="sub center">찾는 골프장이 없어요 · 이름을 짧게 써 보세요 (예: 남서울)</p>' : '')
      + (!q && !P.dirAll && list.length > shown.length ? '<button class="pbtn ghost" id="dirAll">골프장 더 보기</button>' : '');
    $$('[data-club]', box).forEach(b => b.onclick = () => { const c = list.find(x => String(x.id) === b.dataset.club); c.official ? playClub(c, b) : clubInfo(c); });
    $('#dirAll')?.addEventListener('click', () => { P.dirAll = true; stepClub(); });
  });
}

// 코스 정보가 있는 골프장: 누르면 받아서 바로 코스 고르기로
async function playClub(c, btn) {
  const got = findInstalled(c.official); if (got) return choose(got.id);
  const sm = btn?.querySelector('small'); if (btn) { btn.disabled = true; if (sm) sm.textContent = '⏳ 골프장 정보를 받는 중…'; }
  try {
    const cat = await getCatalog(), e = cat.find(x => x.id === c.official);
    if (!e) throw new Error('코스 정보를 찾지 못했어요');
    const { course } = await installCourse(e); choose(course.id);
  } catch (err) { toast('받지 못했어요: ' + err.message + ' · 인터넷을 확인해 주세요', 4000); if (btn) { btn.disabled = false; stepClub(); } }
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
      <h2 class="ph2">👫 누구랑 쳐요? <small>(혼자면 그대로 두세요)</small></h2>
      <div class="chips big" id="pl">${players.map((p, i) => `<button class="on" data-pl="${i}">${esc(p)}${i ? ' ✕' : ''}</button>`).join('')}<button id="addP">＋ 친구</button></div>
      <button class="pbtn primary" id="go">시작! 🏌️</button>
      <details class="p-opt" ${mode === 'tournament' ? 'open' : ''}><summary>그 밖의 설정</summary>
        <label class="tgl"><input type="checkbox" id="tour" ${mode === 'tournament' ? 'checked' : ''}> 🏆 대회예요 <small>(대회 규칙상 거리만 보여요)</small></label></details>
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
  if (!S.settings.detail && !P.viewSet) P.view = '2d'; // 쉬운 화면 기본: 위성 지도 (18Birdies · Hole19 방식)
  const hd = h.hdcpNine ?? h.hdcp ?? h.hdcpCard;
  el_.innerHTML = `<div class="imm ${S.settings.detail ? '' : 'easy'}">
    <div class="stage imm-stage" id="stage"></div>
    <div class="imm-top">
      <button class="e-hole" id="eHp" aria-label="이전 홀">◀</button><button class="imm-pill" id="hInfo" aria-label="홀 정보"><i class="imm-tgt"></i><span><b class="e-hide">거리 측정</b><b class="e-only">${esc(holeName(h))} · 파 ${h.par}</b><small>${esc(holeName(h))} · 파 ${h.par}${(h.hdcpNine ?? h.hdcp ?? h.hdcpCard) ? ` · 핸디 ${h.hdcpNine ?? h.hdcp ?? h.hdcpCard}` : ''} · ${idx + 1}/${order.length}</small></span></button>
<button class="e-hole" id="eHn" aria-label="다음 홀">▶</button>
      <span class="imm-gps" id="gps"><i></i>GPS</span>
    </div>
    <div class="bd-top"><button class="bd-nav" id="bdP" aria-label="이전 홀">‹</button>
      <button class="bd-bar" id="bdInfo" aria-label="홀 정보"><span class="bd-n"><small>${esc(h.nine ? String(h.nine).slice(0, 4) : '홀')}</small>${h.nineHole ?? h.n}</span><span class="bd-d"><small>깃발까지</small><b id="bdDist">—</b></span><span class="bd-m"><small>파</small><b>${h.par}</b></span>${hd ? `<span class="bd-m bd-hd"><small>핸디</small><b>${hd}</b></span>` : ''}</button>
      <button class="bd-nav" id="bdN" aria-label="다음 홀">›</button></div>
    <div class="bd-fab"><button id="fabAI" aria-label="AI 캐디에게 묻기">🤖</button><button id="fabGreen" aria-label="그린 보기">⛳</button><button id="fabMe" aria-label="내 위치로">◎<small class="e-only">내 위치</small></button></div>
    <button class="imm-mini" id="mini" aria-label="코스 지도 (2D로 보기)"></button>
    <div class="imm-side">
      ${[['big', '큰'], ['2d', '2D'], ['3d', '3D'], ['4d', '4D'], ['ar', 'AR']].map(([k, t]) => `<button class="${P.view === k ? 'on' : ''}" data-v="${k}" aria-label="${t} 보기">${t}</button>`).join('')}
      <span class="sep"></span><button id="hPrev" aria-label="이전 홀">◀</button><button id="hNext" aria-label="다음 홀">▶</button>
    </div>
    <div class="imm-sheet"><div class="e-now" id="eNow" role="status" aria-live="polite"></div><div class="imm-card" id="cards"></div><div class="imm-act" id="act"></div></div>
  </div>`;
  document.documentElement.classList.add('in-hole'); // 쉬운 화면: 홀 화면에서는 앱 머리줄·하단 탭을 숨겨 버튼 층을 하나로
  $('#hPrev').onclick = () => App_.stepHole(-1);
  $('#eHp').onclick = () => App_.stepHole(-1); $('#eHn').onclick = () => App_.stepHole(1);
  $('#hNext').onclick = () => App_.stepHole(1);
  $('#mini').onclick = () => { if (P.view !== '2d') { P.view = '2d'; persist(); render(); } };
  $('#hInfo').onclick = () => holeInfo(h);
  $('#gps').onclick = precise;
  $('#bdP').onclick = () => App_.stepHole(-1); $('#bdN').onclick = () => App_.stepHole(1); $('#bdInfo').onclick = () => holeInfo(h);
  $('#fabAI').onclick = () => openAICaddie({ getFacts: aiFacts });
  $('#fabGreen').onclick = () => App_.go('green');
  $('#fabMe').onclick = () => { P.ballPos = null; P.target = null; persist(); update(true); if (map) fit2d(); toast('내 위치로 돌아왔어요'); };
  $$('[data-v]').forEach(b => b.onclick = () => { P.view = b.dataset.v; P.viewSet = true; persist(); render(); });
  mountView();
  unPos = onPos(() => update());
  startOrientation();
  unOri = onOrientation(() => { if (shotOf() && P.view !== 'ar') arrowOnly(); });
  timer = setInterval(update, 4000);
  update(true);
}

const cardLen = h => { const s = h.scorecard; if (!s) return null; const v = s.white ?? s.blue ?? s.red ?? s.back; return v == null ? null : Math.round(s.unit === 'yd' ? v * 0.9144 : v); };
const onGreen = () => adv?.kind === 'putt' || adv?.kind === 'holed';

// 👉 지금 할 일: 화면 맨 위 한 줄 (공부 없이 따라 하기)
function nowLine() {
  const el = $('#eNow'); if (!el) return;
  if (S.settings.detail) { el.hidden = true; return; }
  const h = activeHole(), pin = h?.pin || h?.green, me = ballPos() || shotOf()?.start;
  const t = !pin ? '그린까지 걸어가서 <b>[⛳ 여기가 그린이에요]</b>를 눌러요'
    : !me ? '위치를 찾고 있어요 · 하늘이 보이는 곳에서 잠깐만 기다려요'
    : shotOf() ? '공이 있는 쪽으로 걸어가요 → 도착하면 <b>[✅ 찾았어요]</b>'
    : !allowed('clubRec') ? '거리를 보고 치고 → <b>[🏌️ 쳤어요]</b>'
    : onGreen() ? '퍼터로 굴려 넣고 → 들어가면 <b>[⛳ 홀에 넣었어요]</b>'
    : '이 클럽으로 치고 → <b>[🏌️ 쳤어요]</b>';
  el.hidden = false; el.innerHTML = `<span class="e-now-i">👉</span><span>${t}</span>`;
}

function holeInfo(h) {
  const c = activeCourse(), off = offlineInfo(c), nT = courseTiles(c).length;
  const lock = !!S.settings.autoHoleOff;
  sheet({ title: `${holeName(h)} · 파 ${h.par}`, body: `${scoreCard(h) || '<p class="sub">이 홀은 스코어카드 정보가 없어요.</p>'}
    <div class="hi-box"><b>📝 이 홀 메모</b><textarea id="memo" rows="2" maxlength="140" placeholder="예) 왼쪽 OB 조심 · 그린 뒤가 높음">${esc(h.memo || '')}</textarea></div>
    <div class="hi-row"><span><b>🔒 자동 홀 넘김</b><br><small>다음 홀 티에 가면 저절로 넘어가요. GPS가 튀면 꺼 두세요.</small></span><button class="btn small ${lock ? '' : 'primary'}" id="lockB">${lock ? '꺼짐' : '켜짐'}</button></div>
    <div class="hi-row"><span><b>📥 지도 미리 받기</b><br><small>${off ? `받아 둠 · ${new Date(off.ts).toLocaleDateString()}` : `신호가 약한 곳에서도 지도가 보여요 · 약 ${Math.max(1, Math.round(nT * 22 / 1024))}MB`}</small></span><button class="btn small" id="offB" ${nT ? '' : 'disabled'}>${off ? '다시 받기' : '받기'}</button></div>
    <div class="hi-row"><span><b>🔋 배터리</b><br><small id="batT">확인 중…</small></span></div>`,
    actions: [{ label: '저장', kind: 'primary', onClick: () => { h.memo = $('#memo')?.value.trim() || ''; if (!h.memo) delete h.memo; save('courses'); update(true); } }] });
  $('#lockB').onclick = () => { S.settings.autoHoleOff = !lock; save('settings'); toast(lock ? '자동 홀 넘김을 켰어요' : '자동 홀 넘김을 껐어요 · ◀ ▶로 넘겨요'); holeInfo(h); };
  $('#offB').onclick = async e => {
    const b = e.target; b.disabled = true;
    const r = await prefetchCourse(c, (d, t) => { b.textContent = `${Math.round(d / t * 100)}%`; });
    toast(r.total ? `📥 지도 ${r.ok}/${r.total}장 저장 (약 ${r.mb}MB) · 이제 신호 없이도 보여요` : r.note, 4000);
    b.textContent = '완료';
  };
  batteryNote().then(t => { const el = $('#batT'); if (el) el.textContent = t; });
}

// ---------- 거리 신뢰도: 핀 기준 · 위치 정확도 · 오차 범위를 화면에 먼저 밝힘 ----------
const hhmm = t => `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
function pinInfo(h) {
  const today = new Date().toDateString();
  if (h.pin) {
    const t = h.pin.ts ? new Date(h.pin.ts) : null, fresh = t && t.toDateString() === today;
    if (h.pin.src === 'demo') return { txt: '데모 핀 (가상)', err: 1, lvl: 0 };
    if (h.pin.src === 'flag') { const t = new Date(h.pin.ts), fresh = t.toDateString() === new Date().toDateString(); return { txt: `카메라로 잰 핀${fresh ? ' · ' + hhmm(t) : ' (지난 날)'}`, err: fresh ? Math.max(2, h.pin.err || 4) : greenR(h) * 0.6, lvl: fresh ? 0 : 1 }; }
    if (h.pin.src === 'official') return fresh ? { txt: `오늘 핀 · 골프장 발표 ${hhmm(t)}`, err: 1.5, lvl: 0 } : { txt: '지난 핀 (오늘 발표 전)', err: greenR(h) * 0.6, lvl: 1 };
    return { txt: `내가 찍은 핀${fresh ? ' · ' + hhmm(t) : ' (지난 날)'}`, err: fresh ? 2 : greenR(h) * 0.6, lvl: fresh ? 0 : 1 };
  }
  if (h.green) return { txt: '그린 중앙 기준 (오늘 핀 정보 없음)', err: Math.round(greenR(h) * 0.6), lvl: 1 };
  return null;
}
function posInfo(h) {
  if (P.ballPos && P.ballHole === h.n) {
    if (P.ballSrc === 'avg') return { txt: `정밀 측정 ±${(P.ballAcc || 2).toFixed(1)}m`, err: P.ballAcc || 2, lvl: 0 };
    if (P.ballSrc === 'fix') return { txt: `공 찾은 곳 ±${Math.round(P.ballAcc || 5)}m`, err: P.ballAcc || 5, lvl: (P.ballAcc || 5) <= 6 ? 0 : 1 };
    if (P.ballSrc === 'est') return { txt: '예상 공 위치', err: 12, lvl: 2 };
    return { txt: '지도에서 찍은 위치', err: 4, lvl: 1 };
  }
  const p = Sensors.pos; if (!p) return { txt: '위치 없음', err: 30, lvl: 2 };
  if (p.sim) return { txt: 'GPS 시뮬레이션', err: 1, lvl: 0 };
  return { txt: `GPS ±${Math.round(p.acc)}m`, err: p.acc, lvl: p.acc <= 6 ? 0 : p.acc <= 15 ? 1 : 2 };
}
function trustLine(h, me, D) {
  const pi = pinInfo(h), po = posInfo(h); if (!pi || D == null) return '';
  const e = Math.hypot(pi.err, po.err), lvl = ['ok', 'mid', 'bad'][Math.max(pi.lvl, po.lvl)];
  return `<button class="m-trust ${lvl}" data-trust="1"><i></i><span>${esc(pi.txt)} · ${esc(po.txt)}</span><b>${Math.max(0, Math.round(D - e))}~${Math.round(D + e)}m</b></button>`;
}
// 쉬운 화면: 거리가 많이 틀릴 수 있을 때만 경고 한 줄 (평소에는 숨김)
function easyTrust(h, D) {
  const pi = pinInfo(h), po = posInfo(h); if (!pi || D == null || Math.max(pi.lvl, po.lvl) < 2) return '';
  const e = Math.round(Math.hypot(pi.err, po.err));
  return `<button class="m-trust bad" data-trust="1"><i></i><span>⚠ 위치가 정확하지 않아요 · ±${e}m 틀릴 수 있어요</span><b>›</b></button>`;
}
document.addEventListener('click', e => { if (e.target.closest?.('[data-trust]')) trustSheet(); });
function trustSheet() {
  const h = activeHole(), pi = pinInfo(h), po = posInfo(h), me = ballPos() || shotOf()?.start;
  const D = me && (h.pin || h.green) ? distance(me, h.pin || h.green) : null, e = pi ? Math.hypot(pi.err, po.err) : 0;
  sheet({ title: '이 거리는 얼마나 정확한가요?', body: `
    <div class="kv"><span>깃발 기준</span><b>${esc(pi?.txt || '—')}</b></div>
    <div class="kv"><span>내 위치</span><b>${esc(po.txt)}</b></div>
    ${D != null ? `<div class="kv"><span>실제 거리 범위</span><b>${Math.max(0, Math.round(D - e))} ~ ${Math.round(D + e)}m</b></div>` : ''}
    <p class="sub">휴대폰 GPS는 보통 3~10m 틀릴 수 있어요. 오늘 핀 위치를 모르면 그린 가운데로 재기 때문에 그린 크기만큼 차이가 나요. 그래서 PinPoint는 거리와 함께 <b>어디를 기준으로 쟀는지</b>와 <b>틀릴 수 있는 범위</b>를 항상 보여 드려요.</p>
    <p class="sub">더 정확하게: ① 공 옆에서 <b>정밀 측정</b>(5초 동안 여러 번 재서 평균) ② 깃발이 보이면 지도에서 <b>오늘 핀</b>을 찍으세요.</p>`,
    actions: [{ label: '⛳ 핀 찍기', onClick: () => { if (P.view !== '2d') { P.view = '2d'; persist(); render(); } P.marking = 'pin'; toast('🗺️ 지도에서 오늘 깃발이 꽂힌 곳을 눌러 주세요', 4000); } }, { label: '📡 정밀 측정', kind: 'primary', onClick: () => { precise(); } }] });
}
async function precise() {
  if (!Sensors.pos) return toast('GPS 신호를 찾는 중이에요');
  toast('📡 5초 동안 가만히 서 있어 주세요… (여러 번 재서 평균)', 5000);
  const f = await sampleFix(5000);
  if (!f) return toast('측정에 실패했어요. 하늘이 트인 곳에서 다시 해 주세요');
  const h = activeHole();
  P.ballPos = { lat: f.lat, lon: f.lon }; P.ballHole = h.n; P.ballSrc = 'avg'; P.ballAcc = f.acc; persist();
  vibrate([40, 30, 40]); toast(`정밀 측정 완료 · ±${f.acc.toFixed(1)}m (${f.n}번 평균) · 공 위치로 고정했어요`, 3500);
  adv = null; advKey = ''; update(true);
}

// ---------- 배터리: 18홀을 버틸지 미리 알려 주고, 부족하면 절전 ----------
let batt = null, batt0 = null, battWarned = false;
async function battery() {
  if (!batt && navigator.getBattery) { try { batt = await navigator.getBattery(); } catch {} }
  if (!batt) return null;
  if (!batt0 && S.round) batt0 = { l: batt.level, t: Date.now() };
  return batt;
}
async function batteryNote() {
  const b = await battery(); if (!b) return '이 기기에서는 배터리 정보를 볼 수 없어요';
  const pct = Math.round(b.level * 100);
  if (b.charging) return `${pct}% · 충전 중`;
  const order = App_.holeOrder(), left = Math.max(0, order.length - order.indexOf(activeHole()?.n));
  let rate = null; if (batt0 && Date.now() - batt0.t > 10 * 60000 && batt0.l > b.level) rate = (batt0.l - b.level) / ((Date.now() - batt0.t) / 60000);
  const need = left * 15; // 홀당 약 15분
  if (rate) { const mins = b.level / rate; return `${pct}% · 지금 속도면 약 ${(mins / 60).toFixed(1)}시간 · 남은 ${left}홀(약 ${(need / 60).toFixed(1)}시간) ${mins > need ? '충분해요 ✓' : '부족할 수 있어요 ⚠ 큰 글씨 보기를 쓰세요'}`; }
  return `${pct}% · ${pct >= 50 ? '18홀 충분해요 ✓' : pct >= 25 ? '아껴 쓰면 충분해요 (큰 글씨 보기 추천)' : '부족할 수 있어요 ⚠'}`;
}
async function batteryGuard() {
  const b = await battery(); if (!b || b.charging || battWarned) return;
  if (b.level <= 0.2 && ['3d', '4d', 'ar'].includes(P.view)) {
    battWarned = true; P.view = 'big'; persist(); render();
    toast(`🔋 배터리 ${Math.round(b.level * 100)}% · 절전을 위해 큰 글씨 보기로 바꿨어요`, 4500);
  }
}

// ---------- 큰 글씨 보기: 한눈에 뒤·깃발·앞 거리와 클럽 ----------
function renderBig() {
  const box = $('#bigv'); if (!box) return;
  const h = activeHole(), shot = shotOf(), me = ballPos() || shot?.start, pin = h?.pin || h?.green;
  if (!pin) { box.innerHTML = '<div class="bg-msg">그린 위치가 필요해요<br><small>2D 지도에서 그린을 찍어 주세요</small></div>'; return; }
  if (!me) { box.innerHTML = '<div class="bg-msg">위치를 찾는 중이에요…<br><small>[📍 공 위치]로 지도에 찍어도 돼요</small></div>'; return; }
  if (shot) {
    const t = toBall(Sensors.pos || me, shot.pred, Sensors.heading);
    box.innerHTML = `<div class="bg-hole">${esc(holeName(h))} · 공 찾으러 가요</div><div class="bg-l">내 공까지</div><div class="bg-main">${Math.round(t.d)}<small>m</small></div><div class="bg-arrow" style="transform:rotate(${t.rel ?? 0}deg)">⬆</div><div class="bg-sub">${t.rel == null ? `${t.compass}쪽으로` : Math.abs(t.rel) < 12 ? '앞으로 쭉' : `${t.rel > 0 ? '오른쪽' : '왼쪽'}으로 ${Math.round(Math.abs(t.rel))}°`}</div>`;
    return;
  }
  const D = distance(me, pin), dF = h.front ? distance(me, h.front) : null, dB = h.back ? distance(me, h.back) : null;
  const pl = plays(sceneData(), D, bearing(me, pin), pinDrop(me, pin, h)?.v || 0);
  const club = allowed('clubRec') && adv?.clubName ? adv : null, w = App_.weather;
  box.innerHTML = `<div class="bg-hole">${esc(holeName(h))} · 파 ${h.par}</div>
    <div class="bg-fb">${dB ? `<span>뒤</span><b>${Math.round(dB)}</b>` : ''}</div>
    <div class="bg-main">${Math.round(D)}<small>m</small></div>
    <div class="bg-fb">${dF ? `<span>앞</span><b>${Math.round(dF)}</b>` : ''}</div>
    <div class="bg-info">${pl ? `<div><span>체감</span><b>${Math.round(pl.total)}m</b></div>` : ''}${club ? `<div><span>클럽</span><b>${esc(club.clubName)}</b>${club.power && club.power < 98 ? `<small>힘 ${club.power}%</small>` : ''}</div>` : ''}${allowed('windAdjust') && w?.windSpeed != null ? `<div><span>바람</span><b><i style="display:inline-block;transform:rotate(${(w.windFrom + 180) % 360}deg)">↑</i> ${(+w.windSpeed).toFixed(1)}</b><small>m/s</small></div>` : ''}</div>
    ${trustLine(h, me, D)}`;
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
  gpsChip(); nowLine(); cards(); actions(); scene(); mini(); batteryGuard(); topBar();
}

function topBar() {
  const el = $('#bdDist'); if (!el) return;
  const h = activeHole(), shot = shotOf(), me = ballPos() || shot?.start, pin = h?.pin || h?.green;
  const len = cardLen(h);
  const lab = el.previousElementSibling; if (lab) lab.textContent = pin ? '깃발까지' : '이 홀 길이';
  el.innerHTML = me && pin ? `${Math.round(distance(me, pin))}<small>m</small>` : pin ? '—' : len ? `${len}<small>m</small>` : '—';
}
function gpsChip() {
  const g = $('#gps'); if (!g) return;
  const p = Sensors.pos, acc = p?.acc;
  g.className = 'imm-gps ' + (!p ? 'off' : acc <= 6 ? 'ok' : acc <= 15 ? 'mid' : 'bad');
  const word = !p ? '찾는 중' : acc <= 6 ? '좋음' : acc <= 15 ? '보통' : '약함';
  g.innerHTML = S.settings.detail ? `<i></i>GPS${p ? ` <small>±${Math.round(acc || 0)}m</small>` : ''}` : `<i></i>GPS ${word}`;
  g.title = p ? `GPS 정확도 ${word} (±${Math.round(acc || 0)}m)` : 'GPS 신호를 찾는 중';
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
    const len = cardLen(h);
    box.innerHTML = `<div class="m-label">이 홀은 깃발 위치를 아직 몰라요${len ? ` <span>홀 길이 ${len}m (스코어카드)</span>` : ''}</div>
      <p class="m-text">그린 위에서 <b>[⛳ 여기가 그린이에요]</b>를 한 번 누르면, 다음부터 깃발까지 거리가 나와요.</p>`;
    return;
  }
  if (!me) { box.innerHTML = `<div class="m-label">위치를 찾는 중이에요…</div><p class="m-text">하늘이 트인 곳에서 잠깐 기다려 주세요. 실내라면 ☰ → 설정 → GPS 시뮬레이션을 켜거나 [📍 공 위치]로 지도에 공을 찍어요.</p>`; return; }
  const D = distance(me, pin), last = S.round?.lastShot?.hole === h.n ? S.round.lastShot : null;
  // ① 친 공을 찾으러 가는 중
  if (shot) {
    const t = toBall(Sensors.pos || me, shot.pred, Sensors.heading), drop = pinDrop(shot.pred, pin, h);
    box.innerHTML = `<div class="m-label">내 공까지 <span>${esc(shot.clubName)} · 찾을 범위 약 ${Math.round(shot.r80)}m</span></div>
      <div class="m-big ${S.settings.detail ? '' : 'e-big'}"><b>${S.settings.detail ? f1(t.d) : Math.round(t.d)}</b><small>m</small><i class="m-arrow" id="ballArrow" style="transform:rotate(${t.rel ?? 0}deg)">⬆</i></div>
      ${shot.pf ? `<div class="m-pf">예상 · 공 속도 <b>${Math.round(kmh(shot.pf.est.ballSpeed))}km/h</b> · 각도 <b>${Math.round(shot.pf.est.launchDeg)}°</b> · 높이 <b>${Math.round(shot.pf.est.apex)}m</b> · <b>${shot.pf.est.time.toFixed(1)}초</b></div>` : ''}
      <p class="m-text">${t.rel == null ? `${t.compass}쪽${S.settings.detail ? ` (${Math.round(t.bearing)}°)` : ''}으로 걸어가요` : Math.abs(t.rel) < 12 ? '앞으로 쭉 걸어가요' : `${t.rel > 0 ? '오른쪽' : '왼쪽'}으로 ${Math.round(Math.abs(t.rel))}° 돌아서 걸어가요`}</p>
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
      ${S.settings.detail ? '<a class="m-btn primary" href="#/green?ar">📷 AR로 그린 보기</a><a class="m-btn" href="#/green">🟢 굴릴 방향 · 세기 계산하기</a>' : drop ? `<p class="m-text">${drop.v > 0.05 ? '⬆ 오르막이에요 · 조금 세게' : drop.v < -0.05 ? '⬇ 내리막이에요 · 살살' : '평평해요'}</p>` : ''}`;
    return;
  }
  // ④ 다음 샷 추천: 비거리 · 남은 거리 · 핀 고저차
  const carry = adv?.carry ?? D, landing = adv?.landing || pin, rest = distance(landing, pin), drop = pinDrop(landing, pin, h);
  const cb = adv?.club ? S.bag.find(c => c.id === adv.club) : null, rel = adv?.rel || 0;
  if (!S.settings.detail) { // 쉬운 화면: 거리는 위쪽 홀 바에, 여기는 '이렇게 쳐요' 한 줄 (18Birdies 클럽 추천 칩 방식)
    const side = Math.abs(rel) < 0.75 ? '깃발 보고 똑바로' : `깃발보다 ${rel > 0 ? '오른쪽' : '왼쪽'}으로 ${Math.abs(rel) < 3 ? '조금' : '많이'}`;
    box.innerHTML = adv?.club ? `<div class="bd-rec"><span class="bd-club">${esc(adv.clubName)}</span>
        <span class="bd-how"><span class="bd-pow"><i style="width:${adv.power}%"></i><em>힘 ${adv.power}% · ${esc(adv.swing.short)}</em></span>
        <span class="bd-dir"><i style="transform:rotate(${Math.max(-60, Math.min(60, rel * 3))}deg)">⬆</i>${side} · ${Math.round(carry)}m 보내기</span></span></div>
        ${easyTrust(h, D)}${h.memo ? `<div class="m-memo">📝 ${esc(h.memo)}</div>` : ''}`
      : `<div class="bd-rec"><span class="sub">클럽을 고르는 중…</span></div>`;
    return;
  }
  box.innerHTML = `<div class="m-label">비거리 <span>${adv?.club ? `${esc(adv.clubName)} · 힘 ${adv.power}% (${esc(adv.swing.short)})` : '추천 계산 중…'}</span></div>
    <div class="m-big"><b>${f1(carry)}</b><small>m</small><i class="m-ico"></i></div>
    <div class="m-row"><div><span>남은 거리</span><b>${f1(rest)}<small>m</small></b></div><div><span>핀 고저차</span><b>${drop ? sgn(drop.v, drop.src === 'grid' ? 2 : 1) + '<small>m</small>' : '—'}</b></div><div><span>${isBall ? '공→깃발' : '깃발까지'}</span><b>${f1(D)}<small>m</small></b>${h.front && h.back ? `<em class="m-fb">앞 ${Math.round(distance(me, h.front))} · 뒤 ${Math.round(distance(me, h.back))}</em>` : ''}</div></div>
    ${adv?.club ? `<div class="m-dir"><i style="transform:rotate(${Math.max(-60, Math.min(60, rel * 3))}deg)">⬆</i><span><b>${dirWords(rel)}</b> · 방위 ${Math.round(adv.aimBearing)}° ${compassName(adv.aimBearing)}${Math.abs(adv.lateral || 0) >= 2 ? ` · 깃발 줄에서 ${rel > 0 ? '오른쪽' : '왼쪽'} ${Math.round(Math.abs(adv.lateral))}m` : ''}</span></div>` : ''}
    ${trustLine(h, me, D)}${h.memo ? `<div class="m-memo">📝 ${esc(h.memo)}</div>` : ''}
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
  if (!S.settings.detail) { // 쉬운 화면: 지금 할 일 큰 버튼 1개 + 보조 버튼 2개 (상황에 따라 바뀜)
    const pin = h.pin || h.green, putt = pin && onGreen();
    const hint = (() => { try { return !localStorage.getItem('pinpoint.hint.main'); } catch { return false; } })();
    const main = (id, label) => `<button class="a-main${hint ? ' pulse' : ''}" id="${id}">${label}</button>`;
    const two = (a, b) => `<div class="bd-bot two">${a}${b}</div>`, btn = (id, i, t) => `<button id="${id}"><i>${i}</i>${t}</button>`;
    box.innerHTML = shot ? main('found', '✅ 공 찾았어요!') + two(btn('lostb', '🔍', '공이 안 보여요'), btn('cancel', '↩', '잘못 눌렀어요'))
      : !pin ? main('greenHere', '⛳ 여기가 그린이에요') + two(btn('scoreB', '📝', '홀 끝 · 점수'), btn('more', '🧰', '더보기'))
      : putt ? main('holed', '⛳ 홀에 넣었어요!') + two(allowed('puttLine') ? btn('arB', '📷', '그린 읽기 (카메라)') : btn('cardB', '📋', '점수표'), btn('more', '🧰', '더보기'))
      : main('hit', '🏌️ 쳤어요!') + two(btn('scoreB', '📝', '홀 끝 · 점수'), btn('more', '🧰', '더보기'));
    const seen = () => { try { localStorage.setItem('pinpoint.hint.main', '1'); } catch {} };
    $('.a-main', box).addEventListener('click', seen);
    $('#found')?.addEventListener('click', found); $('#lostb')?.addEventListener('click', () => App_.go('lost'));
    $('#cancel')?.addEventListener('click', () => { const sc = S.round?.holes.find(x => x.n === shot.hole)?.scores[0]; if (sc?.strokes) sc.strokes--; delete S.round.liveShot; save('round'); toast('취소했어요'); update(true); });
    $('#greenHere')?.addEventListener('click', greenHere);
    $('#holed')?.addEventListener('click', quickScore); $('#scoreB')?.addEventListener('click', quickScore);
    $('#hit')?.addEventListener('click', hit); $('#arB')?.addEventListener('click', () => App_.go('green?ar'));
    $('#more')?.addEventListener('click', moreSheet); $('#cardB')?.addEventListener('click', () => App_.go('score'));
    return;
  }
  if (shot) {
    box.innerHTML = `<button class="a-main" id="found">✅ 공 찾았어요!</button>
      <div class="a-row"><button id="aiB" class="ai-b">🤖 AI 캐디</button><button id="lostb">📡 공이 안 보여요</button><button id="cancel">↩ 취소</button></div>`;
    $('#found').onclick = found; $('#aiB').onclick = () => openAICaddie({ getFacts: aiFacts });
    $('#lostb').onclick = () => { App_.go('lost'); };
    $('#cancel').onclick = () => { delete S.round.liveShot; save('round'); update(true); };
    return;
  }
  box.innerHTML = `<button class="a-main" id="hit">🏌️ 쳤어요!</button>
    <div class="a-row"><button id="aiB" class="ai-b">🤖 AI 캐디</button><button id="mark">📍 ${isBall ? '공 다시 찍기' : '공 위치'}</button>${isBall ? '<button id="useMe">🧍 내 위치</button>' : ''}<button id="nextH">다음 홀 ▶</button><button id="yd">📋 거리표</button><a href="#/green">🟢 그린</a><a href="#/score">📝 점수</a></div>`;
  $('#hit').onclick = hit;
  $('#mark').onclick = () => markBall();
  $('#useMe')?.addEventListener('click', () => { P.ballPos = null; persist(); update(true); });
  $('#nextH').onclick = quickScore;
  $('#aiB').onclick = () => openAICaddie({ getFacts: aiFacts });
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
  // 저장 전 sc.strokes = [쳤어요] 누른 횟수(퍼트 제외) → 기본값은 + 퍼트 2번. 저장한 뒤 다시 열면 그 점수 그대로
  let putts = sc.saved ? sc.putts : (sc.putts || 2), strokes = sc.saved ? sc.strokes : sc.strokes ? sc.strokes + putts : par, fw = sc.fw || null;
  const sym = d => (d <= -2 ? 'eg' : d === -1 ? 'bd' : d === 1 ? 'bg' : d >= 2 ? 'db' : '');
  const body = () => `<div class="qs">
      <div class="qs-l">모두 합쳐 몇 번 쳤어요? ${sc.strokes ? `<span>${sc.saved ? '(저장한 점수)' : `(쳤어요 ${sc.strokes}번 + 퍼트)`}</span>` : ''}</div>
      <div class="qs-n">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-s="${n}" class="${strokes === n ? 'on' : ''}"><b class="sym ${sym(n - par)}">${n}</b><small>${n === par ? 'Par' : TERMS[n - par] || ''}</small></button>`).join('')}</div>
      ${strokes > 9 ? `<div class="qs-step"><button data-sd="-1">−</button><b>${strokes}타</b><button data-sd="1">+</button></div>` : '<button class="qs-more" data-sd="9">10타 이상</button>'}
      <div class="qs-l">그린에서 굴린 횟수 <span>(퍼트)</span></div>
      <div class="qs-p">${[0, 1, 2, 3, 4].map(n => `<button data-p="${n}" class="${putts === n ? 'on' : ''}">${n === 4 ? '4+' : n}</button>`).join('')}</div>
      ${par >= 4 ? `<div class="qs-l">첫 샷이 간 쪽 <span>(안 적어도 돼요)</span></div><div class="qs-f">${[['L', '↖', '왼쪽'], ['C', '✓', '페어웨이'], ['R', '↗', '오른쪽']].map(([k, i, n]) => `<button data-f="${k}" class="${fw === k ? 'on' : ''}"><b>${i}</b><small>${n}</small></button>`).join('')}</div>` : ''}
    </div>`;
  const order = App_.holeOrder(), last = order[order.length - 1] === h.n;
  const next = () => (last ? finishSheet() : App_.stepHole(1));
  const s_ = sheet({ title: `${h.nineHole ?? h.n}번 홀 · 파 ${par} · 몇 번 쳤어요?`, body: body(), actions: [{ label: '건너뛰기', onClick: next }, { label: last ? '저장 · 라운드 끝 🏁' : '저장 · 다음 홀 ▶', kind: 'primary', onClick: () => {
    sc.strokes = strokes; sc.putts = Math.min(putts, strokes); sc.saved = true; if (fw) sc.fw = fw; else delete sc.fw;
    save('round'); toast(`${holeName(h)} ${strokes}타 (${TERMS[strokes - par] || (strokes - par > 0 ? '+' + (strokes - par) : strokes - par)}) 저장`); next();
  } }] });
  const root = s_?.el || document.querySelector('#sheet');
  const wire = () => {
    const box = root.querySelector('.qs'); if (!box) return;
    box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { strokes = +b.dataset.s; if (putts > strokes) putts = strokes; redraw(); });
    box.querySelectorAll('[data-sd]').forEach(b => b.onclick = () => { const v = +b.dataset.sd; strokes = v === 9 ? 10 : Math.max(1, strokes + v); if (putts > strokes) putts = strokes; redraw(); });
    box.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { putts = +b.dataset.p; if (putts > strokes) strokes = putts; redraw(); });
    box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { fw = fw === b.dataset.f ? null : b.dataset.f; redraw(); });
  };
  const redraw = () => { const box = root.querySelector('.qs'); if (box) { box.outerHTML = body(); wire(); } };
  wire();
}

// 🏁 마지막 홀 뒤: 오늘 결과 한눈에 → 라운드 저장 (점수표에서 고칠 수도 있음)
function finishSheet() {
  const r = S.round; if (!r) return;
  const t = totals(r)[0], played = r.holes.filter(x => x.scores[0]?.strokes).length;
  sheet({ title: '🏁 라운드 끝!', body: `<div class="fin"><div class="fin-n">${t.strokes || 0}<small>타</small></div>
      <div class="fin-s">${played ? `${played}홀 · 파보다 <b>${t.toPar > 0 ? t.toPar + '타 많이' : t.toPar < 0 ? -t.toPar + '타 적게' : '똑같이'}</b>` : '아직 적은 점수가 없어요'}</div>
      <p class="sub">수고했어요! [저장하고 끝내기]를 누르면 기록에 남아요.</p></div>`,
    actions: [{ label: '점수표 보기', onClick: () => App_.go('score') }, { label: '저장하고 끝내기', kind: 'primary', onClick: () => {
      r.endedAt = new Date().toISOString(); r.totals = totals(r);
      S.rounds.unshift(r); S.round = null; save('rounds', 'round'); keepAwake(false);
      P.step = 'club'; persist(); toast('🎉 라운드를 저장했어요'); App_.go('history');
    } }] });
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

// 🧭 ⑦ 날아간 쪽 가리키기: 공이 사라진 쪽으로 휴대폰을 2초 가리키면 그 방위로 낙하 예상 위치를 다시 계산 (기획서 ⑦ 2-A)
async function pointShot() {
  const shot = shotOf(); if (!shot) return;
  startOrientation();
  if (Sensors.heading == null) { toast('나침반을 쓸 수 없어요 · 지도에서 공이 떨어진 곳을 눌러 주세요', 3500); return markBall(); }
  toast('🧭 공이 사라진 쪽으로 휴대폰 위쪽을 2초 가리켜 주세요', 2200);
  const hs = []; const un = onOrientation(o => o.heading != null && hs.push(o.heading));
  await new Promise(r => setTimeout(r, 2000)); un();
  if (!hs.length) return toast('방향을 읽지 못했어요. 다시 해 주세요');
  const ref = hs[0], brg = (ref + hs.reduce((a, x) => a + normAngle(x - ref), 0) / hs.length + 360) % 360;
  const d = distance(shot.start, shot.pred);
  shot.pred = destination(shot.start, brg, d); shot.pointed = Math.round(brg);
  shot.r80 = Math.max(8, Math.round(shot.r80 * 0.6)); // 방향을 알면 찾을 범위가 좁아짐
  save('round'); vibrate([40, 30, 40]);
  toast(`방향 ${Math.round(brg)}° 저장 · 찾을 범위 약 ${shot.r80}m로 좁혔어요`, 3000);
  update(true);
}

// 🧰 도구: 18Birdies 'Tools' 목록처럼 아이콘 · 이름 · 한 줄 설명
function moreSheet() {
  const h = activeHole(), V = [['2d', '🗺️', '지도'], ['3d', '🏔️', '입체 지도'], ['4d', '🎬', '공 비행'], ['ar', '📷', '카메라'], ['big', '🔠', '큰 숫자']];
  const T = [
    ['ai', '🤖', 'AI 캐디에게 묻기', '이 샷 어떻게 칠지 물어보기 (숫자는 엔진이 계산)', () => openAICaddie({ getFacts: aiFacts })],
    ['yd', '📋', '거리표', '그린 앞·뒤 · 벙커·물 넘기기 거리와 클럽', yardBook],
    ...(!(h.pin || h.green) ? [['gmap', '🗺️', '지도에서 그린 찍기', '그린까지 가지 않고 위성지도에서 그린 가운데를 눌러요', markGreenOnMap]] : []),
    ['mark', '📍', '내 공 위치 찍기', 'GPS가 약할 때 지도에서 공 자리를 눌러요', () => markBall()],
    ['prec', '📡', '정밀하게 재기', '5초 동안 여러 번 재서 평균 (±1~3m)', precise],
    ['green', '🟢', '퍼팅 계산', '경사 지도 · 굴릴 방향 · 세기 · 백스윙 크기', () => App_.go('green')],
    ['greenar', '📷', '그린 읽기 (카메라)', '카메라에 경사 흐름 · 퍼팅 라인 · 홀까지 거리', () => App_.go('green?ar')],
    ['lie', '📐', '공 놓인 경사', '휴대폰을 땅에 2초 → 오르막·내리막과 셋업 팁', () => App_.go('lie')],
    ['tee', '🎯', '티샷 작전', '내 샷 퍼짐(타원)으로 가장 안전한 방향', () => App_.go('tee')],
    ['dist', '🌬️', '거리 · 바람 자세히', '체감 거리 · 고저차 · 바람 · 기온', () => App_.go('distance')],
    ['lost', '🔍', '공 찾기', '떨어진 구역 · 남은 거리 · 3분 타이머', () => App_.go('lost')],
    ...(shotOf() ? [['point', '🧭', '날아간 쪽 가리키기', '공이 사라진 쪽으로 휴대폰을 2초 가리키면 찾을 곳을 좁혀요', pointShot]] : []),
    ['info', 'ℹ️', '홀 정보 · 메모', '스코어카드 · 메모 · 지도 미리 받기 · 배터리', () => holeInfo(h)],
    ['rule', '⚖️', '규칙 도움', 'OB · 물 · 언플레이어블 구제 방법', () => App_.go('rules')],
    ['shots', '📈', '내 샷 기록', '클럽별 공 속도 · 각도 · 높이 · 거리 · 방향', () => App_.go('shots')],
    ['bag', '🎒', '내 클럽 비거리', '실제로 친 거리로 저절로 맞춰져요', () => App_.go('bag')],
  ];
  // 자주 쓰는 4개는 큰 타일, 나머지는 접어 두기 (처음 보는 사람이 고를 것을 줄임)
  const FAV = [allowed('puttLine') ? 'greenar' : 'green', 'lost', 'shots', 'yd'], fav = FAV.map(k => T.find(t => t[0] === k)).filter(Boolean);
  const rest = T.filter(t => !FAV.includes(t[0]));
  sheet({ title: '🧰 더보기', body: `<div class="tl-fav">${fav.map(([k, i, n]) => `<button data-mt="${k}"><i>${i}</i><b>${n}</b></button>`).join('')}</div>
    <div class="tl-h">화면 바꾸기</div>
    <div class="tl-views">${V.map(([k, i, n]) => `<button data-mv="${k}" class="${P.view === k ? 'on' : ''}"><i>${i}</i>${n}</button>`).join('')}</div>
    <details class="tl-more"><summary>🔧 다른 도구 ${rest.length}개</summary><div class="tl-list">${rest.map(([k, i, n, d]) => `<button data-mt="${k}"><i>${i}</i><span><b>${n}</b><small>${d}</small></span><em>›</em></button>`).join('')}</div></details>
    <div class="tl-links"><button id="moCard">📋 점수표</button><button id="moEnd">🏁 라운드 끝내기</button><button id="moMenu">☰ 전체 메뉴</button></div>
    <button class="mo-detail" id="moDet">${S.settings.detail ? '🙂 쉬운 화면으로 바꾸기' : '🔧 자세히 화면으로 바꾸기 <small>(숫자·지도 표시가 많은 전문가 화면)</small>'}</button>`, actions: [{ label: '닫기' }] });
  const close = () => $('#sheet').classList.remove('open');
  $$('[data-mv]').forEach(b => b.onclick = () => { close(); P.view = b.dataset.mv; P.viewSet = true; persist(); render(); });
  $$('[data-mt]').forEach(b => b.onclick = () => { close(); T.find(t => t[0] === b.dataset.mt)[4](); });
  $('#moCard').onclick = () => { close(); App_.go('score'); };
  $('#moEnd').onclick = () => { close(); finishSheet(); };
  $('#moMenu').onclick = () => { close(); $('#drawer').classList.add('open'); };
  $('#moDet').onclick = () => { close(); S.settings.detail = !S.settings.detail; save('settings'); render(); toast(S.settings.detail ? '자세히 화면이에요 · ☰ → 설정에서 쉬운 화면으로 돌아갈 수 있어요' : '쉬운 화면이에요', 3500); };
}

// 🤖 AI에 보낼 사실(FACTS): 엔진이 계산한 숫자만 · 위치 좌표·이름 없음
function aiFacts() {
  const h = activeHole(), shot = shotOf(), me = ballPos() || shot?.start, pin = h?.pin || h?.green;
  const r1 = x => (x == null || !isFinite(x) ? null : Math.round(x)), w = App_.weather;
  const f = { mode: MODES[currentMode()]?.label, hole: { number: h.n, name: holeName(h), par: h.par, handicap: h.hdcpNine ?? h.hdcp ?? h.hdcpCard ?? null, course_note: h.note || null, my_memo: h.memo || null } };
  if (me && pin) {
    const D = distance(me, pin), drop = pinDrop(me, pin, h), pl = plays(sceneData(), D, bearing(me, pin), drop?.v || 0);
    f.distances = { to_pin_m: r1(D), to_green_front_m: h.front ? r1(distance(me, h.front)) : null, to_green_back_m: h.back ? r1(distance(me, h.back)) : null, plays_like_m: pl ? r1(pl.total) : null, pin_elevation_m: drop ? Math.round(drop.v * 10) / 10 : null };
    const pi = pinInfo(h), po = posInfo(h), e = pi ? Math.hypot(pi.err, po.err) : null;
    f.accuracy = { pin_basis: pi?.txt || null, my_position: po.txt, error_m: r1(e), range_m: e != null ? [r1(Math.max(0, D - e)), r1(D + e)] : null, level: pi ? ['high', 'mid', 'low'][Math.max(pi.lvl, po.lvl)] : 'low' };
    const brg = bearing(me, pin);
    f.hazards = (h.hazards || []).map(z => { const d = distance(me, z), off = normAngle(bearing(me, z) - brg); return d < 10 || Math.abs(off) > 60 || d - z.r > D + 30 ? null : { type: { bunker: '벙커', water: '물(페널티 구역)', ob: 'OB', trees: '숲' }[z.type] || z.type, side: Math.abs(off) < 8 ? '가운데' : off > 0 ? '오른쪽' : '왼쪽', front_m: r1(Math.max(0, d - z.r)), carry_m: r1(d + z.r) }; }).filter(Boolean);
    if (w && allowed('windAdjust')) { const rel = (w.windFrom - brg) * Math.PI / 180; const hw = w.windSpeed * Math.cos(rel), cw = w.windSpeed * Math.sin(rel), r10 = x => Math.round(Math.abs(x) * 10) / 10; f.weather = { wind_ms: r10(w.windSpeed), along: Math.abs(hw) < 0.5 ? '앞뒤 바람 거의 없음' : hw > 0 ? '맞바람' : '뒷바람', along_ms: r10(hw), cross: Math.abs(cw) < 0.5 ? '옆바람 거의 없음' : cw > 0 ? '오른쪽에서 왼쪽으로 부는 옆바람' : '왼쪽에서 오른쪽으로 부는 옆바람', cross_ms: r10(cw), temp_c: r1(w.temp) }; }
  }
  if (w) f.safety = { lightning: ['없음', '조금', '높음', '지금 낙뢰'][w.lightningRisk || 0], heat: w.heat?.label || null };
  if (adv && allowed('clubRec') && adv.club) {
    f.engine = { club: adv.club, club_name: adv.clubName, power: adv.power ?? 100, swing: adv.swing || null, aim_deg: Math.round((adv.rel || 0) * 10) / 10, aim_words: Math.abs(adv.rel || 0) < 0.75 ? '깃발 쪽으로 똑바로' : `깃발보다 ${adv.rel > 0 ? '오른쪽' : '왼쪽'}으로 ${Math.abs(Math.round(adv.rel * 10) / 10)}°`, aim_reason: '위험 지역을 피하는 최적 방향 (몬테카를로 계산)', carry_m: r1(adv.carry), remaining_m: adv.landing && pin ? r1(distance(adv.landing, pin)) : null, risk_pct: adv.pBad != null ? Math.round(adv.pBad * 100) : null, expected_strokes: adv.es ? Math.round(adv.es * 10) / 10 : null, kind: adv.kind, alternatives: (adv.alternatives || []).map(a => ({ club: a.club, club_name: a.clubName, expected_strokes: a.es ? Math.round(a.es * 10) / 10 : null })) };
  }
  f.my_bag = S.bag.filter(c => c.enabled !== false && c.carry > 0).map(c => ({ id: c.id, name: c.name, carry_m: Math.round(c.carry), learned_from_shots: c.n || 0 }));
  f.state = shot ? '공을 친 뒤 찾으러 가는 중' : '샷 준비';
  const sc = S.round?.holes.find(x => x.n === h.n)?.scores[0];
  if (sc) f.this_hole = { strokes_so_far: sc.strokes || 0 };
  return f;
}

// 테스트 코스 만들기: 걸어서(내 위치에서 시작, 1/4 크기) 또는 실제 크기(가상 장소)
function demoPick() {
  const make = (walk, base) => {
    S.courses = S.courses.filter(c => !(c.demo && !!c.walk === walk)); // 같은 종류의 예전 테스트 코스는 교체
    const c = demoCourse(base, { walk }); S.courses.push(c); save('courses'); choose(c.id);
    toast(walk ? '🚶 1번 티가 지금 내 위치예요 · 걸어가며 거리가 바뀌는지 보세요' : '🏌️ 9홀 테스트 골프장을 만들었어요', 4000);
  };
  sheet({ title: '🧪 테스트 코스 만들기', body: `
    <button class="pick" id="dWalk"><span class="pi">🚶</span><span class="pt"><b>걸어서 테스트 (내 위치에서 시작)</b><small>9홀 · 실제의 1/4 크기 (홀당 40~125m) · 공원·운동장에서 GPS·자동 홀 넘김·공 찾기를 직접 확인</small></span><span class="pa">›</span></button>
    <button class="pick" id="dFull"><span class="pi">🏌️</span><span class="pt"><b>실제 크기 가상 골프장</b><small>9홀 · 파 36 · 3,080m · 집에서 화면·추천·그린맵 확인 (☰ → 설정 → GPS 시뮬레이션과 함께)</small></span><span class="pa">›</span></button>
    <p class="sub">모두 가상 코스예요. 스코어카드·핸디캡·벙커·물·OB·그린 경사(측량 그린)·오늘 핀이 다 들어 있어요.</p>`, actions: [{ label: '닫기' }] });
  $('#dWalk').onclick = async () => {
    toast('📡 지금 위치를 재는 중…', 3000);
    const f = Sensors.pos ? await sampleFix(2500) : null;
    if (!f) return toast('위치를 못 찾았어요. 위치 권한을 켜고 바깥에서 다시 해 주세요', 4000);
    $('#sheet').classList.remove('open'); make(true, { lat: f.lat, lon: f.lon });
  };
  $('#dFull').onclick = () => { $('#sheet').classList.remove('open'); make(false, Sensors.pos && !Sensors.pos.sim ? { lat: Sensors.pos.lat + 0.0006, lon: Sensors.pos.lon } : undefined); };
}

// ⛳ 여기가 그린이에요: 그린 위에서 누르면 지금 위치(3초 평균)를 이 홀 그린으로 저장 · GPS가 없으면 지도에서 찍기
async function greenHere() {
  const h = activeHole();
  if (!Sensors.pos) { markGreenOnMap(); return; }
  toast('📡 위치를 재는 중… 3초만 가만히 있어요', 3000);
  const f = await sampleFix(3000);
  if (!f) { toast('위치를 못 찾았어요 · 지도에서 그린을 눌러 주세요', 3500); markGreenOnMap(); return; }
  h.green = { lat: +f.lat.toFixed(7), lon: +f.lon.toFixed(7) }; h.greenBy = 'gps'; save('courses');
  vibrate([40, 30, 40]); toast('🟢 이 홀 그린을 저장했어요 · 다음부터 거리가 나와요', 3500);
  adv = null; advKey = ''; if (map) drawHole(map, h); update(true);
}
function markGreenOnMap() {
  if (P.view !== '2d') { P.view = '2d'; persist(); render(); }
  P.marking = 'green'; toast('🗺️ 지도에서 그린 가운데를 눌러 주세요 (두 손가락으로 크게 볼 수 있어요)', 4500);
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
  const w = App_.weather, wind = w ? windAlongCross(w.windSpeed, w.windFrom, aim) : null, predTotal = distance(start, pred.center);
  let pf = null; try { pf = shotSummary(analyzeShot({ clubId: pick.id, total: predTotal, err: 0, wind, rho: w?.rho })); } catch {}
  S.round.liveShot = { hole: h.n, start: { lat: start.lat, lon: start.lon }, startAcc: P.ballPos && P.ballHole === h.n ? (P.ballAcc || 4) : (Sensors.pos?.acc || 5), aimBearing: aim, club: pick.id, clubName: pick.name, power, carry: pick.carry * power / 100, pred: pred.center, predTotal, pf, wind, rho: w?.rho, r80: pred.r80, ts: Date.now() };
  const sc = S.round.holes.find(x => x.n === h.n)?.scores[0];
  if (sc) { sc.strokes = (sc.strokes || 0) + 1; }
  save('round'); vibrate(80); speak(`공은 약 ${Math.round(distance(start, pred.center))}미터 앞에 있어요`);
  toast(`${h.n}번 홀 ${sc?.strokes || 1}타째 기록 · 이제 공을 찾으러 가요`, 3000);
  P.ballPos = null; persist(); update(true);
}

async function found() {
  const shot = shotOf(); if (!shot) return;
  const f = Sensors.pos ? await sampleFix(1500) : null;
  let rec = null;
  if (f) {
    const total = distance(shot.start, f), w = App_.weather;
    const latDeg = normAngle(bearing(shot.start, f) - shot.aimBearing), err = Math.round(Math.hypot(shot.startAcc || 5, f.acc || 5));
    const wind = w ? windAlongCross(w.windSpeed, w.windFrom, bearing(shot.start, f)) : shot.wind || null, rho = w?.rho ?? shot.rho;
    if (total > 5) {
      let fit = null; try { fit = shotSummary(analyzeShot({ clubId: shot.club, total, err, latDeg, wind, rho })); } catch {}
      rec = { id: Date.now(), club: shot.club, total: Math.round(total * 10) / 10, carry: fit?.est.carry ?? total / 1.05, latDeg: Math.round(latDeg * 10) / 10, err, wind, rho, power: shot.power, partial: shot.power < 95 || total <= 20, start: shot.start, end: { lat: f.lat, lon: f.lon }, hole: shot.hole, course: S.round.courseName, ts: Date.now(), fromPlay: true, fit };
      S.shots.push(rec);
      const i = S.bag.findIndex(c => c.id === shot.club); if (i >= 0 && !rec.partial) S.bag[i] = learnClub(S.bag[i], S.shots);
      save('shots', 'bag');
    }
    S.round.lastShot = { hole: shot.hole, dist: total, club: shot.clubName, ts: Date.now() };
    P.ballPos = { lat: f.lat, lon: f.lon }; P.ballHole = shot.hole; P.ballSrc = 'fix'; P.ballAcc = f.acc;
    const pin0 = activeHole()?.pin || activeHole()?.green;
    (S.round.track ||= []).push({ hole: shot.hole, start: shot.start, end: { lat: f.lat, lon: f.lon }, club: shot.club, dist: total, pin: pin0 ? { lat: pin0.lat, lon: pin0.lon } : null });
  } else { // GPS가 없으면 예상 위치에 공을 놓음 (다르면 다시 찍기)
    P.ballPos = { lat: shot.pred.lat, lon: shot.pred.lon }; P.ballHole = shot.hole; P.ballSrc = 'est';
    (S.round.track ||= []).push({ hole: shot.hole, start: shot.start, end: { lat: shot.pred.lat, lon: shot.pred.lon }, club: shot.club, dist: distance(shot.start, shot.pred), est: true });
    toast('잘했어요! 예상 위치에 공을 놓았어요 · 다르면 [📍 공 다시 찍기]', 3500);
  }
  delete S.round.liveShot; save('round'); persist(); vibrate([60, 40, 60]); update(true);
  // 결과 화면: 측정(거리·방향) + 계산(공 속도·높이·시간…)
  const card = rec || { club: shot.club, total: shot.predTotal || distance(shot.start, shot.pred), wind: shot.wind, rho: shot.rho, estPos: true };
  speak(`${Math.round(card.total)}미터 ${rec ? '날아갔어요' : '쯤 갔을 거예요'}`);
  shotSheet(card, { title: `🏌️ ${shot.clubName} · ${rec ? '내 공 결과' : '예상 결과 (위치를 못 재서)'}`, kind: rec ? 'result' : 'predict', extra: [{ label: '📈 클럽별', onClick: () => App_.go('shots') }] });
}

// ---------------- 보기 (2D · 3D · 4D · AR) ----------------
function sceneData() {
  const h = activeHole(), shot = shotOf(), me = ballPos() || shot?.start || null;
  return {
    me: Sensors.pos || me, ball: shot ? shot.pred : (P.ballPos && P.ballHole === h?.n ? P.ballPos : null), from: me, pin: h ? (h.pin || h.green) : null,
    landing: !shot && adv?.landing && allowed('clubRec') ? adv.landing : null, ellipse: !shot && allowed('clubRec') ? adv?.ellipse : null,
    hazards: h?.hazards || [], hole: h, clubOk: allowed('clubRec'),
    dzPin: (() => { const pn = h ? (h.pin || h.green) : null; const f = me; return pn && f ? pinDrop(f, pn, h)?.v ?? null : null; })(),
    apex: !shot && adv?.landing && allowed('clubRec') ? (conditionsEffect(adv.club && adv.club !== 'PT' ? adv.club : '7i', Math.max(10, adv.carry || 0)).apex || 20) : null,
  };
}

async function mountView() {
  const stage = $('#stage'), h = activeHole();
  stage.className = 'stage imm-stage ' + P.view;
  if (P.view === 'big') { stage.innerHTML = '<div class="bigv" id="bigv"></div>'; renderBig(); return; }
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
      if (P.marking === 'pin') {
        P.marking = false; h.pin = { lat: +e.latlng.lat.toFixed(7), lon: +e.latlng.lng.toFixed(7), ts: Date.now(), src: 'user' }; save('courses');
        vibrate(40); toast('⛳ 오늘 핀 위치를 저장했어요'); adv = null; advKey = ''; drawHole(map, h); update(true); return;
      }
      if (P.marking === 'green') {
        P.marking = false; h.green = { lat: +e.latlng.lat.toFixed(7), lon: +e.latlng.lng.toFixed(7) }; h.greenBy = 'user'; save('courses');
        vibrate(40); toast('🟢 그린 위치를 저장했어요'); adv = null; advKey = ''; drawHole(map, h); update(true); fit2d(); return;
      }
      P.marking = false; P.ballPos = { lat: e.latlng.lat, lon: e.latlng.lng }; P.ballHole = h.n; P.ballSrc = 'map'; persist(); vibrate(40);
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
    arStop = await startAR($('#arb'), () => { const sd = sceneData(); return { ...sd, me: Sensors.pos || sd.from }; }, { onLock: p => { const h = activeHole(); P.target = { hole: h.n, lat: p.lat, lon: p.lon }; persist(); toast('📌 고정한 곳을 목표로 정했어요 (2D 지도에서 확인)'); }, onPin: p => { const h = activeHole(); h.pin = { lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7), ts: Date.now(), src: 'flag', err: p.err }; save('courses'); adv = null; advKey = ''; update(true); toast(`⛳ 카메라로 잰 핀을 저장했어요 (${p.d}m ±${p.err}m)`, 3500); } });
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
  if (P.view === 'big') return renderBig();
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
  const step = [2, 3, 5, 10, 20, 25, 50].find(v => v * ppm >= 24) || 50, dense = step * ppm < 30, easy = !S.settings.detail;
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
  if (!easy) for (const k of [-2, -1, 1, 2]) { const r = rT + k * step; if (r > 15) ring(r, false); }
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
  if (easy) { drawPlansOff(); return; }
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

function drawPlansOff() {}
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
