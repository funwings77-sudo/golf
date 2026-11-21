// 쉬운 플레이 (초등학생도 쓰는 기본 흐름)
//  ① 골프장 고르기 → ② 코스 고르기 → ③ 홀 화면: 그린까지 거리 · 추천 클럽 · 힘(%) · 방향(각도) · 추천 길
//  → ④ "쳤어요!" → 내 공 위치(거리·방향) 안내 → "찾았어요"
//  보기: 2D 지도 · 3D 지형 · 4D(3D + 공 비행·홀 플라이오버 시간 재생) · AR 카메라
import { S, save, activeCourse, activeHole, allowed, currentMode, MODES } from '../core/state.js';
import { newRound, totals } from '../core/score.js';
import { demoCourse } from '../core/course.js';
import { getCatalog, installCourse, findInstalled, getClubs } from '../core/remote.js';
import { Sensors, onPos, onOrientation, sampleFix, keepAwake, vibrate, speak, startOrientation, restartGPS } from '../core/sensors.js';
import { distance, bearing, destination, normAngle, toLocal, geodesic } from '../core/geo.js';
import { gridSurface } from '../physics/putt.js';
import { fetchElevations, playsLike } from '../core/weather.js';
import { adviseShot, predictBall, toBall, dirWords, compassName, greenR, keepClub } from '../physics/advice.js';
import { conditionsEffect } from '../physics/flight.js';
import { learnClub } from '../core/score.js';
import { createMap, destroyMap, drawHole, ll, flagIcon, labelIcon, satTileUrl } from '../map.js';
import { $, $$, esc, toast, sheet, confirmSheet, bottomMenuHTML } from '../ui.js';
import { prefetchCourse, offlineInfo, courseTiles } from '../core/offline.js';
import { openAICaddie } from './aisheet.js';
import { matches } from '../core/search.js';
import { analyzeShot, shotSummary, windAlongCross, kmh } from '../physics/shotfit.js';
import { shotSheet } from './lmform.js';
import { spin } from '../core/heading.js';
import { withHoleWind, matchBall } from '../core/live.js';
import { blendWeight } from '../core/fusion.js';
import { swingAction, watchSend } from '../core/watch.js';
import { say, shotCue, walkCue, resultCue, clock, ro, m as mWords } from '../core/voice.js';
import { stdCarry, playsWhy, holeHistory, roundBriefing, conditionBrief, provisionalRisk, roundDiagnosis, lessonVideos, clubRange, dots, greenToday } from '../core/insights.js';
import { immersive } from '../core/screen.js';
import { icon } from '../icons.js';

const KEY = 'pinpoint.play';
const P = (() => { try { return { view: 'ar', ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { return { view: 'ar' }; } })();
const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ viewSet: P.viewSet, view: P.view, step: P.step, q: P.q, ballPos: P.ballPos, ballHole: P.ballHole, ballSrc: P.ballSrc, ballAcc: P.ballAcc, target: P.target, plOff: P.plOff })); } catch {} };

let el_, App_, map = null, lay = null, v3 = null, arStop = null, arCtl = null, headMk = null, unPos = null, unOri = null, adv = null, advKey = '', advT = 0, timer = null, advAt = null, advChg = null; // advAt: 지금 추천을 정한 때의 위치·바람·핀 · advChg: 클럽이 바뀐 이유(잠깐 표시)

export default {
  full: true,
  mount(el, App) {
    el_ = el; App_ = App;
    if (S.round) P.step = 'hole';
    else if (!P.step || (P.step !== 'club' && !activeCourse())) P.step = 'club';
    if (P.step === 'hole' && !S.round) P.step = activeCourse() ? 'course' : 'club';
    render();
    // 공 찾기 화면에서 [찾았어요] → 여기서 거리 재기·결과 카드 (#/play?found)
    if (/\?found\b/.test(location.hash)) {
      history.replaceState(null, '', '#/play');
      const ls = S.round?.liveShot;
      if (ls && ls.hole !== S.ui.hole) App_.setHole(ls.hole); // 찾는 동안 홀이 바뀌었어도 그 샷의 홀로
      if (ls) setTimeout(found, 300);
    }
    if (App_.pendingFinish) { App_.pendingFinish = false; if (S.round) setTimeout(finishSheet, 200); }
    // 다른 화면의 아래 메뉴에서 누른 것 (공 찾기 · 거리표 · 도구)
    if (App_.pendingCmd) { const c = App_.pendingCmd; App_.pendingCmd = null; setTimeout(() => this.cmd(c), 250); }
  },
  cmd(c) {
    if (c === 'lost') return toLost();
    if (!S.round || P.step !== 'hole') return toast('골프장을 고르고 홀을 시작하면 쓸 수 있어요');
    if (c === 'yard') yardBook(); else if (c === 'tools') moreSheet();
  },
  finishRound() { finishSheet(); }, // 마지막 홀에서 ▶ (app.js stepHole)
  // ⌚ 워치가 스윙(임팩트)을 알아챔 → [쳤어요] · 공을 찾으러 가던 중이면 [공 찾았어요] 다음 [쳤어요]
  async onWatchSwing(ev) {
    if (P.step !== 'hole') return;
    const shot = shotOf();
    const act = swingAction({ impact: !!ev.impact, inRound: !!S.round, onGreen: onGreen(), liveShot: !!shot, sinceShotMs: shot ? Date.now() - shot.ts : 0 });
    if (!act) return;
    if (act === 'found-hit') { await found(); await new Promise(r => setTimeout(r, 400)); $('#sheet')?.classList.remove('open'); }
    toast('⌚ 워치가 스윙을 알아챘어요', 1500);
    await hit();
  },
  unmount() { teardown(); unPos?.(); unOri?.(); clearInterval(timer); unPos = unOri = null; },
  onHole() { if (P.step === 'hole') { adv = null; advKey = ''; P.ballPos = null; P.voiceDue = true; persist(); render(); } },
  // 🎧 이어폰 버튼: 1번 = 지금 안내 다시 · 2번 = 쳤어요 / 공 찾았어요 · 3번 = 방금 것 취소
  voiceRepeat() { voiceNow(true); },
  async voiceMain() {
    if (P.step !== 'hole') return say('골프 치기 화면에서 쓸 수 있어요.', { force: true });
    if (shotOf()) { say('공 찾았어요. 거리를 재요.', { force: true }); return found(); }
    if (onGreen()) return say('그린 위예요. 홀에 넣으면 화면에서 홀에 넣었어요를 눌러 주세요.', { force: true });
    await hit(); say('쳤어요. 기록했어요. 잘못이면 버튼을 세 번 누르세요.', { force: true, flush: false });
  },
  voiceUndo() { if (shotOf()) { cancelShot(); say('방금 친 기록을 취소했어요.', { force: true }); } else say('취소할 샷이 없어요.', { force: true }); },
};

function teardown() { document.documentElement.classList.remove('in-hole'); immersive(false); $('#stage')?.querySelector('.rg-hud')?.remove(); ringLay = null; destroyMap(map); map = lay = null; v3?.destroy(); v3 = null; arStop?.(); arStop = null; arCtl = null; headMk = null; measLay = null; P.mapFull = false; }
function render() {
  teardown(); unPos?.(); unOri?.(); clearInterval(timer); unPos = unOri = null;
  el_.className = 'play';
  if (P.step === 'club') return stepClub();
  if (P.step === 'course') return stepCourse();
  return stepHole();
}

// 위성 사진 한 장(256px 타일): 코스 썸네일·큰 카드 배경 (인터넷이 없으면 색 배경)
function tileOf(p, z = 15) {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  const n = 2 ** z, r = p.lat * Math.PI / 180;
  const x = Math.floor((p.lon + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return satTileUrl(z, x, y); // 구글 지도 키가 있으면 구글 위성 사진
}
const courseCenter = c => c.center || c.holes?.find(h => h.green)?.green || c.holes?.find(h => h.tee)?.tee || null;
const thumb = (p, name, z) => { const u = tileOf(p, z); return u ? `<span class="pi th" style="background-image:url('${u}')" aria-hidden="true"></span>` : `<span class="pi mono" aria-hidden="true">${esc([...String(name || '⛳')][0])}</span>`; };

// ---------------- ① 골프장 고르기 ----------------
// 📍 지금 있는 골프장 자동 제안: 내 위치에서 2.5km 안의 받은 코스 · 전국 골프장
function nearSuggest(clubs) {
  const box = $('#near'), me = Sensors.pos; if (!box || !me || P.q) return;
  const ctr = c => c.center || c.holes?.find(h => h.green)?.green || c.holes?.find(h => h.tee)?.tee;
  const mine = S.courses.filter(c => !c.demo && ctr(c)).map(c => ({ c, d: distance(me, ctr(c)) })).sort((a, b) => a.d - b.d)[0];
  const club = clubs.filter(c => c.lat && c.loc !== 'sigungu').map(c => ({ c, d: distance(me, c) })).sort((a, b) => a.d - b.d)[0];
  const pick = mine && mine.d < 2500 ? { name: mine.c.name, d: mine.d, at: ctr(mine.c), sub: `${mine.c.holes.length}홀`, go: () => choose(mine.c.id) } : club && club.d < 2500 ? { name: club.c.name, d: club.d, at: club.c, sub: [club.c.sigungu, club.c.holes && `${club.c.holes}홀`].filter(Boolean).join(' · '), go: b => (club.c.official ? playClub(club.c, b) : clubInfo(club.c)) } : null;
  if (!pick) { box.innerHTML = ''; return; }
  const img = tileOf(pick.at, 16);
  box.innerHTML = `<button class="near-card" id="nearGo" ${img ? `style="--img:url('${img}')"` : ''}><span class="nc-k">📍 지금 여기 · ${pick.d < 1000 ? Math.round(pick.d) + 'm' : (pick.d / 1000).toFixed(1) + 'km'}</span><b>${esc(pick.name)}</b>${pick.sub ? `<small class="nc-s">${esc(pick.sub)}</small>` : ''}<span class="nc-go">여기서 시작 <i>→</i></span></button>`;
  $('#nearGo').onclick = e => pick.go(e.currentTarget);
}

function stepClub() {
  const q = (P.q || '').trim();
  const mine = S.courses.filter(c => !q || matches(q, c.name, c.official?.region));
  el_.innerHTML = `<div class="pwrap">
    <div class="p-hero"><p class="p-kicker">골프 치기</p><h1 class="pq">어디서 쳐요? ⛳</h1><p class="p-sub">골프장을 누르면 바로 1번 홀이 시작돼요</p></div>
    <div id="near"></div>
    <label class="pin-search-w">${icon('lost')}<input type="search" id="pq" class="pin-search" placeholder="골프장 이름으로 찾기" aria-label="골프장 이름으로 찾기" value="${esc(P.q || '')}"></label>
    ${mine.length ? `<h2 class="ph2">⭐ 내 골프장</h2><div class="picks">${mine.map(c => `<button class="pick" data-c="${esc(c.id)}">${c.demo ? '<span class="pi">🧪</span>' : thumb(courseCenter(c), c.name)}<span class="pt"><b>${esc(c.name)}</b><small>${c.holes.length}홀${c.official?.region ? ' · ' + esc(c.official.region) : ''}${c.todayPins ? ' · 오늘 핀 ✓' : ''}</small></span><span class="pa">›</span></button>`).join('')}</div>` : ''}
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
    if (!unPos) unPos = onPos(() => { if (P.step === 'club' && !$('#nearGo')) nearSuggest(clubs); }); // GPS가 늦게 잡혀도 '지금 여기' 카드
    if (me) list = list.map(c => ({ ...c, d: c.lat ? distance(me, c) : Infinity })).sort((a, b) => a.d - b.d);
    else list = list.sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || a.name.localeCompare(b.name, 'ko'));
    const shown = list.slice(0, q ? 40 : (P.dirAll ? 60 : 8));
    box.innerHTML = shown.map(c => `<button class="pick ${c.official ? '' : 'dim'}" data-club="${esc(String(c.id))}">${thumb(c.lat && c.loc !== 'sigungu' ? c : null, c.name)}<span class="pt"><b>${esc(c.name)}</b><small>${esc([c.sido, c.sigungu].filter(Boolean).join(' '))}${c.holes ? ` · ${c.holes}홀` : ''}${Number.isFinite(c.d) ? ` · ${(c.d / 1000).toFixed(c.d < 10000 ? 1 : 0)}km` : ''}</small></span><span class="pa">${c.official ? '<em class="go">바로 치기</em>' : '›'}</span></button>`).join('')
      + (q && !list.length ? '<p class="sub center">찾는 골프장이 없어요 · 이름을 짧게 써 보세요 (예: 남서울)</p>' : '')
      + (!q && !P.dirAll && list.length > shown.length ? '<button class="pbtn ghost" id="dirAll">골프장 더 보기</button>' : '')
      + (shown.some(c => c.lat && c.loc !== 'sigungu') ? '<p class="tile-note">위성 사진 © Esri</p>' : '');
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
// 골프장을 고르면 바로 1번 홀 (코스·동반자는 기본값, 바꾸고 싶으면 [더보기 → 코스·친구 바꾸기])
function choose(id) {
  S.ui.courseId = id; S.ui.hole = 1; save('ui');
  const c = activeCourse(); if (!c) return;
  const nines = c.nines?.length > 1 ? c.nines : null;
  const holeNs = nines ? [...nines[0].holes, ...(nines[0].holes.length >= 18 ? [] : nines[1].holes)] : c.holes.map(h => h.n);
  const players = (localStorage.getItem('pinpoint.lastPlayers') || '나').split(',').map(x => x.trim()).filter(Boolean);
  startRound(c, holeNs, players, S.settings.mode === 'tournament' ? 'tournament' : 'casual');
  toast(`⛳ ${c.name} · ${holeNs.length}홀 시작! 코스를 바꾸려면 [더보기]`, 3500);
}
function startRound(c, holeNs, players, mode) {
  localStorage.setItem('pinpoint.lastPlayers', players.join(', '));
  S.settings.mode = mode; save('settings');
  S.round = newRound({ course: c, players, mode, games: { stroke: 0, skins: 0 }, holeNs });
  S.ui.hole = holeNs[0]; save('round', 'ui'); keepAwake(true);
  App_.refreshHeader(); P.step = 'hole'; P.ballPos = null; persist(); vibrate(60); render();
}

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
      <div class="p-hero"><button class="plink" id="back">‹ 골프장 다시 고르기</button>
      <p class="p-kicker">${esc(c.name)}</p><h1 class="pq">어느 코스로<br>쳐요? 🚩</h1></div>
      ${nines ? `<p class="sub center">이 골프장은 코스가 ${nines.length}개예요. ${sz(nines[0]) >= 18 ? '칠 코스를 골라요.' : '처음 코스와 다음 코스를 골라요.'}</p>
        <h2 class="ph2">${sz(nines[0]) >= 18 ? '칠 코스' : '처음 코스'}</h2><div class="chips big">${nines.map(n => `<button class="${n.name === first ? 'on' : ''}" data-f="${esc(n.name)}">${esc(n.name)} <small>${sz(n)}홀</small></button>`).join('')}</div>
        <h2 class="ph2">다음 코스</h2><div class="chips big">${nines.map(n => `<button class="${n.name === second ? 'on' : ''}" data-s="${esc(n.name)}" ${n.name === first ? 'disabled' : ''}>${esc(n.name)} <small>${sz(n)}홀</small></button>`).join('')}<button class="${second === '' ? 'on' : ''}" data-s="">이 코스만 (${sz(nines.find(n => n.name === first))}홀)</button></div>`
        : `<div class="picks">${opts.map(o => `<button class="pick ${pick === o.k ? 'sel' : ''}" data-o="${o.k}"><span class="pi">${pick === o.k ? '✅' : '⚪'}</span><span class="pt"><b>${o.t}</b></span></button>`).join('')}</div>`}
      <h2 class="ph2">👫 누구랑 쳐요? <small>(혼자면 그대로 두세요)</small></h2>
      <div class="chips big" id="pl">${players.map((p, i) => `<button class="on" data-pl="${i}">${esc(p)}${i ? ' ✕' : ''}</button>`).join('')}<button id="addP">＋ 친구</button></div>
      ${condCard(c)}
      <button class="pbtn primary" id="go">시작하기 🏌️</button>
      <button class="plink p-brief" id="brief">📋 홀마다 어떻게 칠지 미리 보기</button>
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
    $('#brief').onclick = () => briefingSheet(c, nines ? [...nines.find(n => n.name === first).holes, ...(second ? nines.find(n => n.name === second).holes : [])] : opts.find(o => o.k === pick).ns);
    $('#go').onclick = () => {
      const holeNs = nines ? [...nines.find(n => n.name === first).holes, ...(second ? nines.find(n => n.name === second).holes : [])] : opts.find(o => o.k === pick).ns;
      startRound(c, holeNs, players, mode);
    };
  };
  draw();
}

// 🌡️ 오늘 컨디션 카드: 추위·바람·그린 빠르기 → 클럽을 어떻게 (날씨를 아직 모르면 안 보임)
function condCard(c) {
  const cond = conditionBrief(allowed('windAdjust') ? App_.weather : null, S.bag, allowed('greenSlope') ? greenToday(c) : null);
  if (!cond.length) return '';
  return `<div class="cond"><div class="cond-h">오늘 컨디션</div>${cond.map(x => `<div><i>${x.i}</i><span><b>${esc(x.t)}</b>${x.s ? `<small>${esc(x.s)}</small>` : ''}</span></div>`).join('')}</div>`;
}

// ---------------- ③ 홀 화면 ----------------
const holeName = h => (h.nine ? `${h.nine} ${h.nineHole}번 홀` : `${h.n}번 홀`);
function ballPos() { const h = activeHole(); return P.ballPos && P.ballHole === h?.n ? P.ballPos : Sensors.pos; }

function stepHole() {
  const c = activeCourse(), h = activeHole();
  if (!c || !h) { P.step = 'club'; return render(); }
  const order = App_.holeOrder(), idx = order.indexOf(h.n);
  if (!P.viewSet) P.view = 'ar'; // 기본: 카메라 화면 (입체 지도 · 공 비행 · 지도가 한 화면, 휴대폰을 내리면 지도)
  const hd = h.hdcpNine ?? h.hdcp ?? h.hdcpCard;
  el_.innerHTML = `<div class="imm ${S.settings.detail ? '' : 'easy'} ${P.view === 'ar' ? 'arv' : ''}">
    <div class="stage imm-stage" id="stage"></div>
    <div class="imm-top">
      <button class="e-hole" id="eHp" aria-label="이전 홀">◀</button><button class="imm-pill" id="hInfo" aria-label="홀 정보"><i class="imm-tgt"></i><span><b class="e-hide">거리 측정</b><b class="e-only">${esc(holeName(h))} · 파 ${h.par}</b><small>${esc(holeName(h))} · 파 ${h.par}${(h.hdcpNine ?? h.hdcp ?? h.hdcpCard) ? ` · 핸디 ${h.hdcpNine ?? h.hdcp ?? h.hdcpCard}` : ''} · ${idx + 1}/${order.length}</small></span></button>
<button class="e-hole" id="eHn" aria-label="다음 홀">▶</button>
      <span class="imm-gps" id="gps"><i></i>GPS</span>
    </div>
    <div class="bd-top"><button class="bd-nav" id="bdP" aria-label="이전 홀">‹</button>
      <button class="bd-bar" id="bdInfo" aria-label="홀 정보"><span class="bd-n"><small>${esc(h.nine ? String(h.nine).slice(0, 4) : '홀')}</small>${h.nineHole ?? h.n}</span><span class="bd-d"><small>깃발까지</small><b id="bdDist">—</b></span><span class="bd-m"><small>파</small><b>${h.par}</b></span>${hd ? `<span class="bd-m bd-hd"><small>핸디</small><b>${hd}</b></span>` : ''}</button>
      <button class="bd-nav" id="bdN" aria-label="다음 홀">›</button></div>
    <div class="bd-fab"><button id="fabAI" aria-label="AI 캐디에게 묻기">${icon('ai')}</button><button id="fabGreen" aria-label="그린 보기">${icon('green')}</button><button id="fabMe" aria-label="내 위치로">${icon('target')}<small class="e-only">내 위치</small></button></div>
    <button class="imm-mini" id="mini" aria-label="코스 지도 (2D로 보기)"></button>
    <div class="imm-side">
      ${[['big', '큰'], ['2d', '2D'], ['3d', '3D'], ['4d', '4D'], ['ar', 'AR']].map(([k, t]) => `<button class="${P.view === k ? 'on' : ''}" data-v="${k}" aria-label="${t} 보기">${t}</button>`).join('')}
      <span class="sep"></span><button id="hPrev" aria-label="이전 홀">◀</button><button id="hNext" aria-label="다음 홀">▶</button>
    </div>
    <div class="imm-sheet"><div class="e-now" id="eNow" role="status" aria-live="polite"></div><div class="imm-card" id="cards"></div><div class="imm-act" id="act"></div></div>
  </div>`;
  document.documentElement.classList.add('in-hole'); // 쉬운 화면: 홀 화면에서는 앱 머리줄·하단 탭을 숨겨 버튼 층을 하나로
  if (!S.settings.detail) immersive(true); // 📱 쉬운 화면: 상태바·내비게이션 바까지 숨겨 완전 전체 화면
  $('#hPrev').onclick = () => App_.stepHole(-1);
  $('#eHp').onclick = () => App_.stepHole(-1); $('#eHn').onclick = () => App_.stepHole(1);
  $('#hNext').onclick = () => App_.stepHole(1);
  $('#mini').onclick = () => { if (P.view !== '2d') { P.view = '2d'; persist(); render(); } };
  $('#hInfo').onclick = () => holeInfo(h);
  $('#gps').onclick = precise;
  $('#bdP').onclick = () => App_.stepHole(-1); $('#bdN').onclick = () => App_.stepHole(1); $('#bdInfo').onclick = () => holeInfo(h);
  $('#fabAI').onclick = () => openAICaddie({ getFacts: aiFacts });
  $('#fabGreen').onclick = () => App_.go('green');
  // 📷 카메라 화면: 안내 카드는 한 줄로 접혀 있고, 누르면 펼침 (안의 버튼은 그대로 눌림)
  $('#cards').addEventListener('click', e => { if (P.view !== 'ar' || e.target.closest('button, a, input')) return; e.currentTarget.classList.toggle('open'); });
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
// 위치 문제: 'denied'(허락 안 됨) · 'weak'(30초 넘게 못 찾음/오차 큼) · null
const gpsTrouble = () => (Sensors.pos ? null : Sensors.gpsState === 'denied' ? 'denied' : Sensors.gpsState === 'weak' || Sensors.gpsState === 'unsupported' || (Sensors.gpsSince && Date.now() - Sensors.gpsSince > 30000) ? 'weak' : null);
// 그린 위치를 모를 때 어림: 홀 길이(스코어카드) − 티에서 지금까지 온 거리 (곧은 홀 가정)
const estLeft = (h, me) => { const L = cardLen(h); return L && h.tee && me ? Math.max(0, Math.round(L - distance(h.tee, me))) : null; };

// 👉 지금 할 일: 화면 맨 위 한 줄 (공부 없이 따라 하기)
function nowLine() {
  const el = $('#eNow'); if (!el) return;
  if (S.settings.detail) { el.hidden = true; return; }
  const h = activeHole(), pin = h?.pin || h?.green, me = ballPos() || shotOf()?.start;
  const t = !pin ? (shotOf() ? '공이 있는 곳으로 가서 → <b>[✅ 공 찾았어요]</b>' : '치고 → <b>[🏌️ 쳤어요]</b> · 홀이 끝나면 <b>[📝 홀 끝]</b>')
    : !me ? (gpsTrouble() === 'denied' ? '📍 위치가 꺼져 있어요 · 아래 안내대로 켜 주세요' : gpsTrouble() ? '신호가 약해요 · 아래 [지도에서 내 위치 누르기]' : '위치를 찾고 있어요 · 하늘이 보이는 곳에서 잠깐만 기다려요')
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
    actions: [{ label: '⛳ 핀 찍기', onClick: () => { toMap(); P.marking = 'pin'; toast('🗺️ 지도에서 오늘 깃발이 꽂힌 곳을 눌러 주세요', 4000); } }, { label: '📡 정밀 측정', kind: 'primary', onClick: () => { precise(); } }] });
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
  if (b.level <= 0.2 && ['3d', '@mountain', 'ar'].includes(P.view)) {
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
    const t = toBall(Sensors.pos || me, shot.pred, Sensors.point ?? Sensors.heading);
    box.innerHTML = `<div class="bg-hole">${esc(holeName(h))} · 공 찾으러 가요</div><div class="bg-l">내 공까지</div><div class="bg-main">${Math.round(t.d)}<small>m</small></div><div class="bg-arrow" style="transform:rotate(${t.rel ?? 0}deg)">⬆</div><div class="bg-sub">${t.rel == null ? `${t.compass}쪽으로` : Math.abs(t.rel) < 12 ? '앞으로 쭉' : `${t.rel > 0 ? '오른쪽' : '왼쪽'}으로 ${Math.round(Math.abs(t.rel))}°`}</div>`;
    return;
  }
  const D = distance(me, pin), dF = h.front ? distance(me, h.front) : null, dB = h.back ? distance(me, h.back) : null;
  const pl = plays(sceneData(), D, bearing(me, pin), pinDrop(me, pin, h)?.v || 0);
  const club = allowed('clubRec') && adv?.clubName ? adv : null, w = wx();
  box.innerHTML = `<div class="bg-hole">${esc(holeName(h))} · 파 ${h.par}</div>
    <div class="bg-fb">${dB ? `<span>뒤</span><b>${Math.round(dB)}</b>` : ''}</div>
    <div class="bg-main">${Math.round(D)}<small>m</small></div>
    <div class="bg-fb">${dF ? `<span>앞</span><b>${Math.round(dF)}</b>` : ''}</div>
    <div class="bg-info">${pl ? `<div><span>체감</span><b>${Math.round(pl.total)}m</b></div>` : ''}${club ? `<div><span>클럽</span><b>${esc(club.clubName)}</b>${club.power && club.power < 98 ? `<small>힘 ${club.power}%</small>` : ''}</div>` : ''}${allowed('windAdjust') && w?.windSpeed != null ? `<div><span>바람</span><b><i style="display:inline-block;transform:rotate(${(w.windFrom + 180) % 360}deg)">↑</i> ${(+w.windSpeed).toFixed(1)}</b><small>m/s</small></div>` : ''}</div>
    ${trustLine(h, me, D)}`;
}

// 이 홀 날씨: 예보(기온·공기 밀도) + 골프장 풍속계가 있으면 그 홀 바람 (📡 core/live.js)
const wx = () => withHoleWind(App_.weather, App_.live, activeHole()?.n);

// 🎧 지금 상황을 정밀하게 말하기 (자세히: 거리·앞뒤·고저차·바람·체감·클럽·힘·조준 각도·위험 / 간단히: 거리·클럽·방향)
function cueNow() {
  const h = activeHole(), shot = shotOf(), me = ballPos() || shot?.start, pin = h?.pin || h?.green, lvl = S.settings.voiceLevel || 'detail';
  if (!h || !me) return null;
  if (shot) { const t = toBall(Sensors.pos || me, shot.pred, Sensors.point ?? Sensors.heading); return `공까지 ${mWords(t.d)}${t.rel != null ? `, ${clock(t.rel)}` : ''}.`; }
  if (!pin) return null;
  const D = distance(me, pin);
  if (!allowed('clubRec') || !adv?.club) return `깃발까지 ${mWords(D)}${h.front && h.back ? `, 그린 앞 ${mWords(distance(me, h.front))}, 뒤 ${mWords(distance(me, h.back))}` : ''}.`;
  const brg = bearing(me, pin), elev = pinDrop(me, pin, h)?.v ?? null, w = wx(), pl = plays(sceneData(), D, brg, elev || 0);
  const wnd = allowed('windAdjust') && w?.windSpeed ? windAlongCross(w.windSpeed, w.windFrom, adv.aimBearing ?? brg) : { along: 0, cross: 0 };
  return shotCue({ kind: adv.kind, D, front: h.front ? distance(me, h.front) : null, back: h.back ? distance(me, h.back) : null, elev, along: wnd.along, cross: wnd.cross,
    plays: pl?.total ?? null, temp: pl?.parts?.temp ?? null, club: adv.clubName, swing: adv.swing?.short || '', power: adv.power, rel: adv.rel, lateral: adv.lateral,
    carry: adv.carry, rest: adv.landing ? distance(adv.landing, pin) : null, hazards: hazardsAhead(me, h, adv.aimBearing ?? brg, adv.carry || D), pBad: adv.pBad }, lvl);
}
// 조준 줄 위·옆의 해저드: 앞까지 · 넘기려면 / 옆 OB
function hazardsAhead(me, h, brg, carry) {
  const u = [Math.sin(brg * Math.PI / 180), Math.cos(brg * Math.PI / 180)], out = [];
  for (const z of h.hazards || []) {
    const q = toLocal(me, z), along = q.x * u[0] + q.y * u[1], off = q.x * u[1] - q.y * u[0], name = HZ_NAME[z.type] || '해저드';
    if (along <= 0 || along > carry + 40) continue;
    if (Math.abs(off) <= (z.r || 10) + 6) out.push({ name, front: Math.max(0, along - (z.r || 10)), carry: along + (z.r || 10), at: along });
    else if (z.type === 'ob' && Math.abs(off) < 45 && Math.abs(along - carry) < 60) out.push({ name, side: off > 0 ? '오른쪽' : '왼쪽', at: along });
  }
  return out.sort((a, b) => a.at - b.at);
}
function voiceNow(force) { const t = cueNow(); if (t) say(t, { force }); else if (force) say('위치를 찾는 중이에요. 잠깐만 기다려 주세요.', { force: true }); }
// 저절로 말할 때: 홀에 왔을 때·공을 찾은 뒤 한 번 + 공 찾으러 갈 때 남은 거리 (150·100·…·5m)
let walkPrev = null;
function voiceAuto() {
  if (!S.settings.voice || !S.round) return;
  const shot = shotOf();
  if (shot) {
    const t = toBall(Sensors.pos || shot.start, shot.pred, Sensors.point ?? Sensors.heading);
    const cue = walkCue(walkPrev, t.d, t.rel); walkPrev = t.d;
    if (cue) say(cue, { key: 'walk' + Math.round(t.d), gapMs: 20000 });
    return;
  }
  walkPrev = null;
  if (P.voiceDue && adv && (adv.club || adv.kind === 'putt')) { P.voiceDue = false; setTimeout(() => voiceNow(false), 2500); } // 홀 소개 말이 끝난 뒤
}

// ⌚ 워치 화면 한 줄: 깃발까지 · 추천 클럽 (바뀔 때만 보냄)
function toWatch() {
  const h = activeHole(), shot = shotOf(), me = ballPos(), pin = h?.pin || h?.green; if (!h || !S.round) return;
  const head = `${holeName(h)} · 파 ${h.par}`;
  const line = shot ? `공 찾으러 가요 · ${shot.clubName}` : !me || !pin ? '치고 나면 저절로 적어요' : `깃발까지 ${Math.round(distance(me, pin))}m${allowed('clubRec') && adv?.clubName && adv.kind !== 'putt' ? `\n${adv.clubName} · ${adv.swing?.short || ''}` : ''}`;
  watchSend(`${head}\n${line}`);
}

// 📷 골프장 카메라가 친 공을 봤으면 예상 위치 대신 그 자리로 (한 번만)
function cameraBall() {
  const shot = shotOf(); if (!shot || shot.cam || !App_.live) return;
  const m = matchBall(App_.live, shot); if (!m) return;
  shot.cam = m; shot.pred = { lat: m.lat, lon: m.lon }; shot.r80 = 6; save('round');
  vibrate([80, 40, 80]); speak('골프장 카메라가 공을 찾았어요'); toast('📷 골프장 카메라가 공 멈춘 곳을 찾았어요 · 화살표대로 가요', 4000);
}

// 상태: 친 공 (라운드 중 하나)
const shotOf = () => (S.round?.liveShot && S.round.liveShot.hole === activeHole()?.n ? S.round.liveShot : null);

function compute(force) {
  const h = activeHole(), me = ballPos();
  if (!h || !me) { adv = null; return; }
  const key = `${h.n}|${me.lat.toFixed(5)},${me.lon.toFixed(5)}|${h.pin?.lat}|${h.green?.lat}|${currentMode()}`;
  if (!force && key === advKey && Date.now() - advT < 30000) return;
  advKey = key; advT = Date.now();
  const w = wx(), pin = h.pin || h.green;
  const next = adviseShot({ me, hole: h, bag: S.bag, hcp: S.settings.hcp, weather: allowed('windAdjust') && w ? { windSpeed: w.windSpeed, windFrom: w.windFrom, rho: w.rho } : {} });
  const here = { me, wind: w?.windSpeed || 0, pin: pin && `${pin.lat},${pin.lon}`, hole: h.n };
  // 🔁 같은 홀에서 조금 움직였을 뿐이면 추천을 흔들지 않음 · 바뀌면 이유 한 줄 (홀 바뀜·핀 다시 찍음 같은 force는 새로)
  if (!force && adv && advAt && advAt.hole === h.n) {
    const r = keepClub(adv, next, { moved: distance(advAt.me, me), windDelta: Math.abs(here.wind - advAt.wind), pinMoved: here.pin !== advAt.pin });
    if (r.kept) return; // 이전 추천과 기준점 그대로
    adv = r.adv; advAt = here;
    if (r.reason) { advChg = { ...r.reason, t: Date.now() }; toast(`🔁 추천 클럽 ${r.reason.from} → ${r.reason.to} · ${r.reason.why}`, 3500); } // 카메라 화면처럼 안내 카드가 없는 보기에서도 보이게
    return;
  }
  adv = next; advAt = here; advChg = null;
}

function update(force = false) {
  if (P.step !== 'hole') return;
  compute(force); cameraBall(); toWatch(); voiceAuto();
  if (force && P.view === 'ar' && !P.mapFull) miniFit();
  gpsChip(); nowLine(); cards(); actions(); scene(); mini(); batteryGuard(); topBar();
}

function topBar() {
  const el = $('#bdDist'); if (!el) return;
  const h = activeHole(), shot = shotOf(), me = ballPos() || shot?.start, pin = h?.pin || h?.green;
  const len = cardLen(h);
  const est = pin ? null : estLeft(h, me);
  const lab = el.previousElementSibling; if (lab) lab.textContent = pin ? '깃발까지' : est != null ? '깃발까지 (어림)' : '이 홀 길이';
  if (me && pin) {
    // 한눈에 읽히게(내비 '시선 2초' 원칙): 서 있을 때 GPS가 1~2m씩 흔들려도 숫자가 깜빡이지 않게 3m 이상 바뀌거나 4초가 지나야 새로 표시 (걸으면 2초 안에 바뀜)
    const d = distance(me, pin), now = Date.now(), k = `${h.n}|${pin.lat},${pin.lon}`;
    if (shownD.k !== k || Math.abs(d - shownD.v) >= 3 || now - shownD.t > 4000) shownD = { k, v: d, t: now };
    // 위치 오차가 크면 숫자 하나 대신 범위를 솔직하게 (손으로 찍은 공 위치는 GPS 오차 없음)
    const acc = me === Sensors.pos ? Sensors.pos?.acc : null;
    el.innerHTML = `${Math.round(shownD.v)}<small>m</small>${acc > 12 ? `<small class="bd-pm">±${Math.round(acc)}</small>` : ''}`;
    return;
  }
  el.innerHTML = pin ? '—' : est != null ? `약 ${est}<small>m</small>` : len ? `${len}<small>m</small>` : '—';
}
let shownD = { k: '', v: 0, t: 0 };
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
  if (P.view === 'ar') { box.innerHTML = ''; box.hidden = true; return; } // 카메라 화면: 안내 카드 없음 (거리·클럽은 화면 위 숫자 판과 음성으로)
  box.hidden = false;
  const h = activeHole(), shot = shotOf(), me = ballPos() || shot?.start || null; // GPS가 없어도 친 곳에서 이어서 안내
  const pin = h.pin || h.green;
  if (!pin) {
    const len = cardLen(h);
    const est = estLeft(h, ballPos() || shot?.start);
    if (shot) { // 그린을 몰라도 친 공은 기록: 공 있는 곳에서 [찾았어요] → 날아간 거리
      box.innerHTML = `<div class="m-label">내 공이 있는 곳으로 가요 <span>${esc(shot.clubName)}</span></div><p class="m-text">도착하면 <b>[✅ 공 찾았어요]</b>를 눌러요. 날아간 거리를 재 드려요.</p>`;
      return;
    }
    if (P.view === 'ar') { box.innerHTML = ''; box.hidden = true; return; } // 카메라 화면: 안내창 없음 (거리는 위 막대에 '약'으로)
    box.innerHTML = `<div class="m-label">${est != null ? '위 거리는 어림이에요' : len ? `이 홀은 ${len}m예요` : '이 홀은 처음이에요'}</div>
      <p class="m-text">한 번 치고 나면 이 홀 그린 위치를 저절로 배워서, 다음부터는 정확한 거리가 나와요.</p>`;
    return;
  }
  if (!me) {
    const t = gpsTrouble();
    box.innerHTML = t === 'denied'
      ? `<div class="m-label">📍 위치가 꺼져 있어요</div><p class="m-text">휴대폰 <b>설정 → 애플리케이션 → PinPoint 캐디 → 권한 → 위치 → "앱 사용 중에만 허용"</b>으로 바꾼 뒤 이 화면으로 돌아오세요. 지금은 지도에서 내 위치를 눌러도 돼요.</p>`
      : `<div class="m-label">${t ? '📡 위치 신호가 약해요' : '위치를 찾는 중이에요…'}</div><p class="m-text">${t ? `하늘이 트인 곳으로 조금 움직여 보세요${Sensors.gpsWeakAcc ? ` (지금 오차 약 ${Sensors.gpsWeakAcc}m)` : ''}. 아니면 지도에서 내 위치를 눌러요.` : '하늘이 트인 곳에서 잠깐 기다려 주세요.'}</p>`;
    if (t) {
      box.innerHTML += `<div class="grid2"><button class="m-btn" id="gpsMap">🗺️ 지도에서 내 위치 누르기</button><button class="m-btn" id="gpsRetry">↻ 다시 찾기</button></div>`;
      $('#gpsMap').onclick = () => markBall(); $('#gpsRetry').onclick = () => { restartGPS(); toast('위치를 다시 찾고 있어요'); update(true); };
    }
    return;
  }
  const D = distance(me, pin), last = S.round?.lastShot?.hole === h.n ? S.round.lastShot : null;
  // ① 친 공을 찾으러 가는 중
  if (shot) {
    const t = toBall(Sensors.pos || me, shot.pred, Sensors.point ?? Sensors.heading), drop = pinDrop(shot.pred, pin, h);
    box.innerHTML = `<div class="m-label">내 공까지 <span>${esc(shot.clubName)} · ${shot.cam ? '📷 골프장 카메라가 찾음' : `찾을 범위 약 ${Math.round(shot.r80)}m`}</span></div>
      <div class="m-big ${S.settings.detail ? '' : 'e-big'}"><b>${S.settings.detail ? f1(t.d) : Math.round(t.d)}</b><small>m</small><i class="m-arrow" id="ballArrow" style="transform:rotate(${t.rel ?? 0}deg)">⬆</i></div>
      ${shot.pf ? `<div class="m-pf">예상 · 공 속도 <b>${Math.round(kmh(shot.pf.est.ballSpeed))}km/h</b> · 각도 <b>${Math.round(shot.pf.est.launchDeg)}°</b> · 높이 <b>${Math.round(shot.pf.est.apex)}m</b> · <b>${shot.pf.est.time.toFixed(1)}초</b></div>` : ''}
      ${shot.provisional ? `<div class="m-memo m-warn">⚠ ${shot.provisional.kind === 'ob' ? 'OB' : '숲'} 쪽일 수 있어요 · 잠정구를 쳐 뒀다면 원래 공을 3분만 찾아보고, 없으면 잠정구로 이어서 쳐요</div>` : ''}
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
    const w = wx(), windy = w && w.windSpeed >= 4 && allowed('windAdjust');
    const why = adv?.club && adv.carry >= D * 0.8 ? playsWhy(D, plays(sceneData(), D, bearing(me, pin), pinDrop(me, pin, h)?.v || 0)) : null;
    box.innerHTML = adv?.club ? `<div class="e-rec"><i class="e-rec-a" style="transform:rotate(${Math.max(-60, Math.min(60, rel * 3))}deg)" aria-hidden="true">⬆</i>
        <span><b>${esc(adv.clubName)}</b>${ro(adv.clubName)} · ${esc(adv.swing.short)}<small>${side}</small></span><button class="e-say" id="sayB" aria-label="소리로 듣기">🔊</button></div>
        ${advChg && Date.now() - advChg.t < 12000 ? `<div class="e-chg" role="status">🔁 ${esc(advChg.from)} → <b>${esc(advChg.to)}</b> · ${esc(advChg.why)}</div>` : ''}
        ${why ? `<button class="e-wind e-why" id="whyB">${w?.windSrc === 'course' ? '📡' : '🌡️'} ${esc(why.text)} <em>왜?</em></button>` : windy ? `<div class="e-wind">💨 바람이 세요${w.windSrc === 'course' ? ' (이 홀 풍속계)' : ''} · 바람까지 생각해서 클럽을 골랐어요</div>` : ''}
        ${easyTrust(h, D)}${histLine(h)}${h.memo ? `<div class="m-memo">📝 ${esc(h.memo)}</div>` : ''}`
      : `<div class="bd-rec"><span class="sub">클럽을 고르는 중…</span></div>`;
    $('#whyB')?.addEventListener('click', () => whySheet(D, why, cb));
    $('#sayB')?.addEventListener('click', () => voiceNow(true));
    return;
  }
  box.innerHTML = `<div class="m-label">비거리 <span>${adv?.club ? `${esc(adv.clubName)} · 힘 ${adv.power}% (${esc(adv.swing.short)})` : '추천 계산 중…'}</span></div>
    <div class="m-big"><b>${f1(carry)}</b><small>m</small><i class="m-ico"></i></div>
    <div class="m-row"><div><span>남은 거리</span><b>${f1(rest)}<small>m</small></b></div><div><span>핀 고저차</span><b>${drop ? sgn(drop.v, drop.src === 'grid' ? 2 : 1) + '<small>m</small>' : '—'}</b></div><div><span>${isBall ? '공→깃발' : '깃발까지'}</span><b>${f1(D)}<small>m</small></b>${h.front && h.back ? `<em class="m-fb">앞 ${Math.round(distance(me, h.front))} · 뒤 ${Math.round(distance(me, h.back))}</em>` : ''}</div></div>
    ${adv?.club ? `<div class="m-dir"><i style="transform:rotate(${Math.max(-60, Math.min(60, rel * 3))}deg)">⬆</i><span><b>${dirWords(rel)}</b> · 방위 ${Math.round(adv.aimBearing)}° ${compassName(adv.aimBearing)}${Math.abs(adv.lateral || 0) >= 2 ? ` · 깃발 줄에서 ${rel > 0 ? '오른쪽' : '왼쪽'} ${Math.round(Math.abs(adv.lateral))}m` : ''}</span></div>` : ''}
    ${trustLine(h, me, D)}${(() => { const why = adv?.carry >= D * 0.8 && playsWhy(D, plays(sceneData(), D, bearing(me, pin), pinDrop(me, pin, h)?.v || 0)); return why ? `<div class="e-wind">🌡️ ${esc(why.text)}</div>` : ''; })()}${histLine(h)}${h.memo ? `<div class="m-memo">📝 ${esc(h.memo)}</div>` : ''}
    ${last ? `<div class="m-foot">방금 샷 <b>${f1(last.dist)}m</b>${last.club ? ` · ${esc(last.club)}` : ''}</div>` : cb ? `<div class="m-foot">내 ${esc(cb.name)} 비거리 ${Math.round(cb.carry)}m · ${cb.learned ? `실제 ${cb.n}샷 학습 ✓` : `기본값 (${cb.n || 0}/3샷)`}${adv.pBad > 0.12 ? ` · ⚠ 위험 ${Math.round(adv.pBad * 100)}%` : ''}</div>` : ''}`;
}

// 📒 이 홀 지난 기록 한 줄 (같은 골프장에서 친 라운드)
function histLine(h) {
  const hh = holeHistory(S.rounds, activeCourse()?.id, h.n);
  if (!hh) return '';
  return `<div class="m-memo m-hist">📒 ${esc(hh.text)}${hh.tip ? `<br><b>${esc(hh.tip)}</b>` : ''}</div>`;
}
// 왜 이 클럽?: 체감 거리 이유 + 내 클럽 거리 범위 (믿음 정도)
function whySheet(D, why, cb) {
  if (!why) return;
  const rg = cb ? clubRange(cb, S.shots) : null, reasons = why.text.split(' · ').slice(1);
  sheet({ title: '왜 이 클럽이에요?', body: `<div class="why-n"><span>깃발까지<b>${Math.round(D)}m</b></span><i>→</i><span>오늘 느낌<b>${why.total}m</b></span></div>
    ${reasons.length ? `<div class="why-r">${reasons.map(x => `<span>${esc(x)}m</span>`).join('')}</div>` : ''}
    ${rg ? `<div class="why-c"><b>내 ${esc(cb.name)}</b><span>10번 중 8번은 <b>${rg.lo}~${rg.hi}m</b> 날아가요</span><small>${dots(rg.trust.dots)} ${esc(rg.trust.word)}${rg.src === 'guess' ? ' · 실제로 칠수록 정확해져요' : ` · 샷 ${rg.n}개`}</small></div>` : ''}
    <p class="sub">추운 날·맞바람에는 공이 덜 날아가고, 오르막이면 더 쳐야 해요. 이걸 다 넣어서 클럽을 골랐어요.</p>`, actions: [{ label: '알겠어요', kind: 'primary' }] });
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
  const shot = shotOf(), a = $("#ballArrow"); if (!shot?.pred || !a || !Sensors.pos) return;
  const t = toBall(Sensors.pos, shot.pred, Sensors.point ?? Sensors.heading); if (t.rel != null) spin(a, t.rel); // 휴대폰을 돌리면 부드럽게 따라 돎
}

function actions() {
  const box = $('#act'); if (!box) return;
  const shot = shotOf(), h = activeHole(), isBall = P.ballPos && P.ballHole === h.n;
  if (!S.settings.detail) { // 쉬운 화면: 위 = 지금 할 일 큰 버튼 + 보조 버튼 · 아래 메뉴 7칸 (가운데 = ⛳ 골프 치기)
    const pin = h.pin || h.green, putt = pin && onGreen();
    const hint = (() => { try { return !localStorage.getItem('pinpoint.hint.main'); } catch { return false; } })();
    // 지금 할 일: 쳤어요 → 공 찾았어요 → (그린 위) 홀에 넣었어요
    const act = shot ? ['found', '✅ 공 찾았어요'] : putt ? ['holed', '⛳ 홀에 넣었어요'] : ['hit', '🏌️ 쳤어요'];
    // 보조: 친 뒤 = 잘못 눌렀어요 · 그린 위 = 그린 밖에서 쳤어요 · 그 밖 = 홀 끝·점수
    const sub = shot ? `<button id="cancel">↩ 잘못 눌렀어요</button>` : putt ? `<button id="hitOut">🏌️ 그린 밖에서 쳤어요</button>` : `<button id="scoreB">📝 홀 끝 · 점수</button>`;
    box.innerHTML = `<div class="bd-ctx"><button class="a-main act${hint ? ' pulse' : ''}" id="${act[0]}">${act[1]}</button>${sub}</div>
      <nav class="bd-menu" aria-label="아래 메뉴">${bottomMenuHTML({ lost: shot ? '안 보여요' : '공 찾기' })}</nav>`;
    const seen = () => { try { localStorage.setItem('pinpoint.hint.main', '1'); } catch {} };
    $('.a-main', box).addEventListener('click', seen);
    $('#found')?.addEventListener('click', found);
    $('#cancel')?.addEventListener('click', cancelShot);
    $('#holed')?.addEventListener('click', quickScore); $('#scoreB')?.addEventListener('click', quickScore);
    $('#hit')?.addEventListener('click', hit); $('#hitOut')?.addEventListener('click', hit);
    $('#more')?.addEventListener('click', moreSheet);
    $('#mPlay').onclick = goPlay;
    $('#mGreen').onclick = () => { if (allowed('puttLine')) App_.greenAR = true; App_.go(allowed('puttLine') ? 'green?ar' : 'green'); };
    $('#mLost').onclick = toLost;
    $('#mShots').onclick = () => App_.go('shots');
    $('#mYard').onclick = yardBook;
    $('#mMenu').onclick = () => $('#drawer').classList.add('open'); // ☰ 전체 메뉴
    return;
  }
  if (shot) {
    box.innerHTML = `<button class="a-main" id="found">✅ 공 찾았어요!</button>
      <div class="a-row"><button id="aiB" class="ai-b">🤖 AI 캐디</button><button id="lostb">📡 공이 안 보여요</button><button id="cancel">↩ 취소</button></div>`;
    $('#found').onclick = found; $('#aiB').onclick = () => openAICaddie({ getFacts: aiFacts });
    $('#lostb').onclick = toLost;
    $('#cancel').onclick = cancelShot;
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

// ⛳ 골프 치기 (아래 메뉴 가운데): 언제나 카메라 홀 화면으로 — 지도·큰 숫자 화면이면 카메라로, 큰 지도·도구 판은 닫고, 라운드 전이면 골프장 고르기
function goPlay() {
  if (!S.round) { P.step = activeCourse() ? 'course' : 'club'; persist(); return render(); }
  P.step = 'hole';
  if (P.view !== 'ar') { P.view = 'ar'; P.viewSet = false; persist(); return render(); }
  arCtl?.setMap(false, true);
  const tray = $('#arTray'); if (tray && !tray.hidden) $('#arTools')?.click();
  $('#sheet')?.classList.remove('open');
  vibrate(20); update(true);
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
      <div class="qs-n">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-s="${n}" class="${strokes === n ? 'on' : ''}"><b class="sym ${sym(n - par)}">${n}</b><small>${n === par ? '기준타' : TERMS[n - par] || ''}</small></button>`).join('')}</div>
      ${strokes > 9 ? `<div class="qs-step"><button data-sd="-1">−</button><b>${strokes}타</b><button data-sd="1">+</button></div>` : '<button class="qs-more" data-sd="9">10타 이상</button>'}
      <div class="qs-l">그린에서 굴린 횟수 <span>(퍼트)</span></div>
      <div class="qs-p">${[0, 1, 2, 3, 4].map(n => `<button data-p="${n}" class="${putts === n ? 'on' : ''}">${n === 4 ? '4+' : n}</button>`).join('')}</div>
      ${others.length ? `<div class="qs-l">친구 점수 <span>(기본은 기준타)</span></div><div class="qs-fr">${others.map((o, k) => `<div><b>${esc(o.name)}</b><span class="stepper"><button data-ot="${k}" data-od="-1" aria-label="${esc(o.name)} 줄이기">−</button><b>${oth[k]}</b><button data-ot="${k}" data-od="1" aria-label="${esc(o.name)} 늘리기">+</button></span></div>`).join('')}</div>` : ''}
      ${par >= 4 ? `<div class="qs-l">첫 샷이 간 쪽 <span>(안 적어도 돼요)</span></div><div class="qs-f">${[['L', '↖', '왼쪽'], ['C', '✓', '페어웨이'], ['R', '↗', '오른쪽']].map(([k, i, n]) => `<button data-f="${k}" class="${fw === k ? 'on' : ''}"><b>${i}</b><small>${n}</small></button>`).join('')}</div>` : ''}
    </div>`;
  const order = App_.holeOrder(), last = order[order.length - 1] === h.n, nextN = order[order.indexOf(h.n) + 1];
  // 시트가 닫힌 뒤에 다음 화면 (같은 #sheet를 쓰는 라운드 끝 시트가 닫히며 지워지지 않게)
  const next = () => setTimeout(() => (last ? finishSheet() : nextN != null ? App_.setHole(nextN) : App_.stepHole(1)), 0);
  // 친구 점수: 기본 = 기준타(파), +/− 로 (저장 안 한 친구만)
  const others = rh.scores.map((x, i) => ({ i, x, name: r.players[i]?.name || `${i + 1}` })).slice(1);
  const oth = others.map(o => (o.x.saved ? o.x.strokes : par));
  const s_ = sheet({ title: `${h.nineHole ?? h.n}번 홀 · 파 ${par} · 몇 번 쳤어요?`, body: body(), actions: [{ label: '건너뛰기', onClick: next }, { label: last ? '저장 · 라운드 끝 🏁' : '저장 · 다음 홀 ▶', kind: 'primary', onClick: () => {
    sc.strokes = strokes; sc.putts = Math.min(putts, strokes); sc.saved = true; if (fw) sc.fw = fw; else delete sc.fw;
    others.forEach((o, k) => { o.x.strokes = oth[k]; o.x.saved = true; });
    learnGreen(h);
    save('round'); toast(`${holeName(h)} ${strokes}타 (${TERMS[strokes - par] || (strokes - par > 0 ? '+' + (strokes - par) : strokes - par)}) 저장`); next();
  } }] });
  const root = s_?.el || document.querySelector('#sheet');
  const wire = () => {
    const box = root.querySelector('.qs'); if (!box) return;
    box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { strokes = +b.dataset.s; if (putts > strokes) putts = strokes; redraw(); });
    box.querySelectorAll('[data-sd]').forEach(b => b.onclick = () => { const v = +b.dataset.sd; strokes = v === 9 ? 10 : Math.max(1, strokes + v); if (putts > strokes) putts = strokes; redraw(); });
    box.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { putts = +b.dataset.p; if (putts > strokes) strokes = putts; redraw(); });
    box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { fw = fw === b.dataset.f ? null : b.dataset.f; redraw(); });
    box.querySelectorAll('[data-ot]').forEach(b => b.onclick = () => { const k = +b.dataset.ot; oth[k] = Math.max(1, oth[k] + +b.dataset.od); redraw(); });
  };
  const redraw = () => { const box = root.querySelector('.qs'); if (box) { box.outerHTML = body(); wire(); } };
  wire();
}

// ⛳ 그린 위치 저절로 배우기: 그린을 모르는 홀에서 점수를 저장할 때 서 있는 곳(= 홀 아웃한 그린)
//  티에서 충분히 멀 때만 (티에서 바로 점수를 적는 경우를 막음). 다음 라운드부터 정확한 거리
function learnGreen(h) {
  if (h.pin || h.green) return;
  const p = Sensors.pos; if (!p || (p.acc || 99) > 25 || (!p.sim && Date.now() - (p.ts || 0) > 20000)) return;
  if (!h.tee) return;
  const o = App_.holeOrder(), nx = o[o.indexOf(h.n) + 1];
  if (nx != null && S.round?.holeTimes?.[nx]) return; // 다음 홀에 가 본 뒤 돌아와 적는 점수면 지금 자리가 그 홀 그린이 아님
  const L = cardLen(h), d = distance(h.tee, p);
  if (d < 40 || (L && d < L * 0.45)) return;
  h.green = { lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7) }; h.greenBy = 'auto'; save('courses');
  setTimeout(() => toast('⛳ 이 홀 그린 위치를 배웠어요 · 다음부터 정확한 거리가 나와요', 3500), 1800);
}

// 🏁 마지막 홀 뒤: 오늘 결과 한눈에 → 라운드 저장 (점수표에서 고칠 수도 있음)
function finishSheet() {
  const r = S.round; if (!r) return;
  const t = totals(r)[0], played = r.holes.filter(x => x.scores[0]?.strokes).length;
  sheet({ title: '🏁 라운드 끝!', body: `<div class="fin"><div class="fin-n">${t.strokes || 0}<small>타</small></div>
      <div class="fin-s">${played ? `${played}홀 · 파보다 <b>${t.toPar > 0 ? t.toPar + '타 많이' : t.toPar < 0 ? -t.toPar + '타 적게' : '똑같이'}</b>` : '아직 적은 점수가 없어요'}</div>
      ${finDiag(r)}
      <p class="sub">수고했어요! [저장하고 끝내기]를 누르면 기록에 남아요.</p></div>`,
    actions: [{ label: '점수표 보기', onClick: () => App_.go('score') }, { label: '저장하고 끝내기', kind: 'primary', onClick: () => {
      r.endedAt = new Date().toISOString(); r.totals = totals(r);
      S.rounds.unshift(r);
      if (!save('rounds')) { S.rounds.shift(); toast('⚠ 저장 공간이 부족해서 라운드를 저장하지 못했어요 · 설정 → 백업 후 정리해 주세요', 5000); return false; }
      S.round = null; S.lost = null; save('round', 'lost'); App_.pendingShot = null; keepAwake(false);
      P.step = 'club'; persist(); toast('🎉 라운드를 저장했어요'); App_.go('history');
    } }] });
}

// 🔎 이번 라운드 가장 아쉬운 곳 → 레슨 영상 2개
function finDiag(r) {
  const d = roundDiagnosis(r, S.settings.hcp);
  if (!d) return '';
  if (d.ok) return `<div class="fin-dg ok">${esc(d.text)}</div>`;
  const f = { L: 0, R: 0 }; for (const h of r.holes) { const x = h.scores[0]?.fw; if (x === 'L' || x === 'R') f[x]++; }
  return `<div class="fin-dg"><b>🔎 ${esc(d.text)}</b>${d.fact ? `<small>${esc(d.fact)}</small>` : ''}
    <div class="fin-v">${lessonVideos(d.k, f.L > f.R ? 'L' : 'R').map(v => `<a href="${esc(v.url)}" target="_blank" rel="noopener">▶ ${esc(v.title)}</a>`).join('')}</div></div>`;
}

// 📋 오늘 공략 미리 보기: 홀마다 한 줄 (지키는 홀 · 노려 볼 홀) + 오늘 컨디션
function briefingSheet(c, holeNs) {
  if (!c) return;
  const rows = roundBriefing(c, holeNs, S.rounds);
  const TAG = { safe: ['🛡️', '지키는 홀'], attack: ['🎯', '노려 볼 홀'], normal: ['', ''] };
  sheet({ title: '📋 오늘 공략 미리 보기', body: `${condCard(c)}
    <p class="sub">🛡️ 지키는 홀은 보기도 괜찮아요 · 🎯 노려 볼 홀에서 파를 노려요${S.rounds.some(r => r.courseId === c.id) ? ' · 📒는 내가 여기서 친 기록이에요' : ''}</p>
    <div class="brief">${rows.map(x => `<div class="br ${x.tag}"><span class="br-n">${esc(x.label)}<small>파 ${x.par}</small></span><span class="br-t">${TAG[x.tag][1] ? `<em>${TAG[x.tag][0]} ${TAG[x.tag][1]}</em>` : ''}${esc(x.line)}${x.hist ? `<small>📒 ${esc(x.hist.text)}</small>` : ''}</span></div>`).join('')}</div>`,
    actions: [{ label: '닫기', kind: 'primary' }] });
}

// 스코어카드(코스 DB): 파 · 핸디캡 · 티별 거리 · 공략 메모
function scoreCard(h) {
  const s = h.scorecard; if (!s) return '';
  const tees = [['백', s.back, '#222'], ['블루', s.blue, '#1f5fbf'], ['화이트', s.white, '#999'], ['레드', s.red, '#c0392b']].filter(t => t[1] != null);
  const hd = h.hdcpNine ?? h.hdcp ?? h.hdcpCard;
  return `<div class="pcard scard"><div class="row" style="justify-content:space-between"><b>📋 스코어카드</b><span class="sub">파 ${+h.par || ''}${hd ? ` · 핸디캡 ${esc(String(hd))}` : ''}</span></div>
    <div class="tees">${tees.map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} <b>${+v}</b>${esc(s.unit || '')}</span>`).join('')}</div>
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
  const d = shot.pred ? distance(shot.start, shot.pred) : (S.bag.find(c => c.id === shot.club)?.carry || 150); // 그린 모르는 홀: 클럽 비거리
  shot.pred = destination(shot.start, brg, d); shot.pointed = Math.round(brg);
  shot.r80 = Math.max(8, Math.round((shot.r80 || 40) * 0.6)); // 방향을 알면 찾을 범위가 좁아짐
  save('round'); vibrate([40, 30, 40]);
  toast(`방향 ${Math.round(brg)}° 저장 · 찾을 범위 약 ${shot.r80}m로 좁혔어요`, 3000);
  update(true);
}

// 🧰 도구: 18Birdies 'Tools' 목록처럼 아이콘 · 이름 · 한 줄 설명
function moreSheet() {
  const ic = i => (i.startsWith('@') ? icon(i.slice(1)) : i);
  const h = activeHole(), V = [['ar', '@camera', '카메라 · 지도'], ['big', '@big', '큰 숫자'], ...(S.settings.detail ? [['2d', '@map', '지도만'], ['3d', '🏔️', '입체 지도만'], ['4d', '@film', '공 비행만']] : [])];
  const T = [
    ['ai', '@ai', 'AI 캐디에게 묻기', '이 샷 어떻게 칠지 물어보기 (숫자는 엔진이 계산)', () => openAICaddie({ getFacts: aiFacts })],
    ['yd', '@yard', '거리표', '그린 앞·뒤 · 벙커·물 넘기기 거리와 클럽', yardBook],
    ...(!(h.pin || h.green) ? [['ghere', '@green', '여기가 그린이에요', '지금 그린 위라면 눌러서 그린 위치를 바로 저장', greenHere], ['gmap', '@map', '지도에서 그린 찍기', '그린까지 가지 않고 위성지도에서 그린 가운데를 눌러요', markGreenOnMap]] : []),
    ['mark', '@pin', '내 공 위치 찍기', 'GPS가 약할 때 지도에서 공 자리를 눌러요', () => markBall()],
    ['prec', '@target', '정밀하게 재기', '5초 동안 여러 번 재서 평균 (±1~3m)', precise],
    ['green', '@green', '퍼팅 계산', '경사 지도 · 굴릴 방향 · 세기 · 백스윙 크기', () => App_.go('green')],
    ['greenar', '@camera', '그린 읽기 (카메라)', '카메라에 경사 흐름 · 퍼팅 라인 · 홀까지 거리', () => App_.go('green?ar')],
    ['lie', '@lie', '공 놓인 경사', '휴대폰을 땅에 2초 → 오르막·내리막과 셋업 팁', () => App_.go('lie')],
    ['tee', '@tee', '티샷 작전', '내 샷 퍼짐(타원)으로 가장 안전한 방향', () => App_.go('tee')],
    ['dist', '@wind', '거리 · 바람 자세히', '체감 거리 · 고저차 · 바람 · 기온', () => App_.go('distance')],
    ['lost', '@lost', '공 찾기', '떨어진 구역 · 남은 거리 · 3분 타이머', () => App_.go('lost')],
    ...(shotOf() ? [['point', '@compass', '날아간 쪽 가리키기', '공이 사라진 쪽으로 휴대폰을 2초 가리키면 찾을 곳을 좁혀요', pointShot]] : []),
    ['brief', '@card', '오늘 공략 미리 보기', '홀마다 한 줄 · 지키는 홀/노려 볼 홀 · 오늘 날씨', () => briefingSheet(activeCourse(), App_.holeOrder())],
    ['info', '@info', '홀 정보 · 메모', '스코어카드 · 메모 · 지도 미리 받기 · 배터리', () => holeInfo(h)],
    ['rule', '@scale', '규칙 도움', 'OB · 물 · 언플레이어블 구제 방법', () => App_.go('rules')],
    ['shots', '@shots', '내 샷 기록', '클럽별 공 속도 · 각도 · 높이 · 거리 · 방향', () => App_.go('shots')],
    ['bag', '@bag', '내 클럽 비거리', '실제로 친 거리로 저절로 맞춰져요', () => App_.go('bag')],
  ];
  // 자주 쓰는 4개는 큰 타일, 나머지는 접어 두기 (처음 보는 사람이 고를 것을 줄임)
  const FAV = [allowed('puttLine') ? 'greenar' : 'green', 'lost', 'shots', 'yd'], fav = FAV.map(k => T.find(t => t[0] === k)).filter(Boolean);
  const rest = T.filter(t => !FAV.includes(t[0]));
  sheet({ title: '더보기', body: `<div class="tl-fav">${fav.map(([k, i, n]) => `<button data-mt="${k}"><i>${ic(i)}</i><b>${n}</b></button>`).join('')}</div>
    <div class="tl-h">화면 바꾸기</div>
    <div class="tl-views">${V.map(([k, i, n]) => `<button data-mv="${k}" class="${P.view === k ? 'on' : ''}"><i>${ic(i)}</i>${n}</button>`).join('')}</div>
    <details class="tl-more"><summary>🔧 다른 도구 ${rest.length}개</summary><div class="tl-list">${rest.map(([k, i, n, d]) => `<button data-mt="${k}"><i>${ic(i)}</i><span><b>${n}</b><small>${d}</small></span><em>›</em></button>`).join('')}</div></details>
    <div class="tl-links"><button id="moCard">${icon('card')} 점수표</button><button id="moCourse">${icon('swap')} 코스·친구 바꾸기</button><button id="moEnd">${icon('finish')} 라운드 끝내기</button></div>
    <button class="mo-detail" id="moMenu">${icon('menu')} 전체 메뉴 · 설정</button>
    <button class="mo-detail" id="moDet">${S.settings.detail ? '🙂 쉬운 화면으로 바꾸기' : '🔧 자세히 화면으로 바꾸기 <small>(숫자·지도 표시가 많은 전문가 화면)</small>'}</button>`, actions: [{ label: '닫기' }] });
  const close = () => $('#sheet').classList.remove('open');
  $$('[data-mv]').forEach(b => b.onclick = () => { close(); P.view = b.dataset.mv; P.viewSet = true; persist(); render(); });
  $$('[data-mt]').forEach(b => b.onclick = () => { close(); T.find(t => t[0] === b.dataset.mt)[4](); });
  $('#moCard').onclick = () => { close(); App_.go('score'); };
  $('#moEnd').onclick = () => { close(); finishSheet(); };
  $('#moCourse').onclick = async () => {
    close();
    const played = S.round?.holes.some(x => x.scores.some(sc => sc.strokes));
    if (played && !(await confirmSheet('코스·친구 바꾸기', '지금까지 적은 점수는 지워져요. 바꿀까요?', '바꾸기', 'danger'))) return;
    S.round = null; S.lost = null; save('round', 'lost'); App_.pendingShot = null; App_.refreshHeader(); P.step = 'course'; persist(); render();
  };
  $('#moMenu').onclick = () => { close(); $('#drawer').classList.add('open'); };
  $('#moDet').onclick = () => { close(); S.settings.detail = !S.settings.detail; save('settings'); render(); toast(S.settings.detail ? '자세히 화면이에요 · ☰ → 설정에서 쉬운 화면으로 돌아갈 수 있어요' : '쉬운 화면이에요', 3500); };
}

// 🤖 AI에 보낼 사실(FACTS): 엔진이 계산한 숫자만 · 위치 좌표·이름 없음
function aiFacts() {
  const h = activeHole(), shot = shotOf(), me = ballPos() || shot?.start, pin = h?.pin || h?.green;
  const r1 = x => (x == null || !isFinite(x) ? null : Math.round(x)), w = wx();
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
  toMap();
  P.marking = 'green'; toast('🗺️ 지도에서 그린 가운데를 눌러 주세요 (두 손가락으로 크게 볼 수 있어요)', 4500);
}

// 지도에서 공 위치 찍기 (공이 내 위치와 다를 때 · 실내 연습)
function markBall(then) {
  toMap();
  toast(then === 'hit' ? '📍 위치를 못 찾았어요 · 지도에서 공을 친 곳을 눌러 주세요' : '🗺️ 지도에서 내 공이 있는 곳을 눌러요', 4000);
  P.marking = true; P.afterMark = then === 'hit' ? 'hit' : null;
}

async function hit() {
  const h = activeHole(), start = ballPos();
  if (!S.round) return toast('라운드를 먼저 시작해요');
  if (!start) { markBall('hit'); return; } // GPS가 없으면 지도에서 공 위치를 찍은 뒤 이어서 기록
  const sc0 = S.round.holes.find(x => x.n === h.n)?.scores[0];
  let learnedTee = false;
  if (!h.tee && !sc0?.strokes) { h.tee = { lat: +start.lat.toFixed(7), lon: +start.lon.toFixed(7) }; h.teeBy = 'auto'; save('courses'); learnedTee = true; } // 첫 샷 자리 = 티 (잘못 눌렀어요면 되돌림)
  if (!(h.pin || h.green)) { hitNoGreen(h, start, sc0); if (learnedTee && S.round.liveShot) { S.round.liveShot.learnedTee = true; save('round'); } return; }
  // 🏷️ 그립 센서가 30초 안에 알려 준 클럽이 있으면 그 클럽 (추천 클럽보다 우선)
  const grip = App_.gripClub && Date.now() - App_.gripClub.ts < 30000 ? S.bag.find(c => c.id === App_.gripClub.club) : null;
  App_.gripClub = null;
  const club = grip || (adv?.club && adv.club !== 'PT' ? S.bag.find(c => c.id === adv.club) : null);
  const pick = club || S.bag.filter(c => c.enabled).sort((a, b) => Math.abs(a.carry - distance(start, h.pin || h.green)) - Math.abs(b.carry - distance(start, h.pin || h.green)))[0];
  const aim = adv?.aimBearing ?? bearing(start, h.pin || h.green), power = grip && grip.id !== adv?.club ? 100 : adv?.power ?? 100;
  const pred = predictBall({ start, aimBearing: aim, club: pick, hole: h, power });
  const w = wx(), wind = w ? windAlongCross(w.windSpeed, w.windFrom, aim) : null, predTotal = distance(start, pred.center);
  let pf = null; try { pf = shotSummary(analyzeShot({ clubId: pick.id, total: predTotal, err: 0, wind, rho: w?.rho })); } catch {}
  S.round.liveShot = { hole: h.n, start: { lat: start.lat, lon: start.lon }, startAcc: P.ballPos && P.ballHole === h.n ? (P.ballAcc || 4) : (Sensors.pos?.acc || 5), aimBearing: aim, club: pick.id, clubName: pick.name, power, carry: pick.carry * power / 100, pred: pred.center, predTotal, pf, wind, rho: w?.rho, r80: pred.r80, ts: Date.now() };
  const sc = S.round.holes.find(x => x.n === h.n)?.scores[0];
  if (sc) { sc.strokes = (sc.strokes || 0) + 1; }
  if (learnedTee) S.round.liveShot.learnedTee = true;
  // OB·숲으로 갔을 수 있으면 잠정구 안내 (공 찾느라 다시 돌아오지 않게) — 물(페널티 구역)은 잠정구 대상이 아님
  const risk = provisionalRisk(pred.est, (h.hazards || []).map(z => ({ ...toLocal(start, z), r: z.r, type: z.type })));
  if (risk.kind) S.round.liveShot.provisional = { kind: risk.kind, p: Math.round(risk.p * 100) };
  save('round');
  if (risk.kind) {
    const where = risk.kind === 'ob' ? 'OB' : '숲';
    vibrate([120, 60, 120]); speak(`${where} 쪽으로 갔을 수 있어요. 잠정구를 한 번 더 쳐 두세요`);
    toast(`⚠ ${where} 쪽으로 갔을 수 있어요 (약 ${Math.round(risk.p * 100)}%) · "잠정구"라고 말하고 같은 자리에서 한 번 더 쳐 두면 돌아오지 않아도 돼요`, 6500);
  } else {
    vibrate(80); speak(`공은 약 ${Math.round(distance(start, pred.center))}미터 앞에 있어요`);
    toast(`${h.nineHole ?? h.n}번 홀 ${sc?.strokes || 1}타째 기록 · 이제 공을 찾으러 가요`, 3000);
  }
  P.ballPos = null; persist(); update(true);
}

// 잘못 눌렀어요: 타수 1 빼고, 이 샷 때문에 저절로 배운 티가 있으면 지움 (엉뚱한 자리가 티로 굳지 않게)
function cancelShot() {
  const shot = S.round?.liveShot; if (!shot) return;
  const sc = S.round.holes.find(x => x.n === shot.hole)?.scores[0]; if (sc?.strokes) sc.strokes--;
  if (shot.learnedTee) { const h = activeCourse()?.holes.find(x => x.n === shot.hole); if (h?.teeBy === 'auto') { delete h.tee; delete h.teeBy; save('courses'); } }
  delete S.round.liveShot; save('round'); toast('취소했어요'); update(true);
}

// 공이 안 보여요 → 공 찾기 화면에 친 자리·클럽·방향(가리킨 방향 > 조준 방향)을 넘겨 다시 입력하지 않게
function toLost() {
  const shot = shotOf();
  if (shot) App_.pendingShot = { lat: shot.start.lat, lon: shot.start.lon, club: shot.club, clubName: shot.clubName, hole: shot.hole, ts: Date.now(), fromPlay: true,
    bearing: shot.pointed ?? shot.aimBearing ?? (shot.pred ? bearing(shot.start, shot.pred) : null), pointed: shot.pointed != null };
  App_.go('lost');
}

// 그린 위치를 모르는 홀: 예측 없이 친 자리·클럽만 기록 → [찾았어요]에서 실제 거리
function hitNoGreen(h, start, sc) {
  const left = estLeft(h, start) ?? cardLen(h);
  const bag = S.bag.filter(c => c.enabled && c.id !== 'PT');
  const pick = (!sc?.strokes && h.par >= 4 ? bag.find(c => c.id === 'D') : null) || (left ? bag.sort((a, b) => Math.abs(a.carry - left) - Math.abs(b.carry - left))[0] : bag.find(c => c.id === '7i')) || bag[0];
  S.round.liveShot = { hole: h.n, start: { lat: start.lat, lon: start.lon }, startAcc: Sensors.pos?.acc || 5, aimBearing: null, club: pick.id, clubName: pick.name, power: 100, pred: null, ts: Date.now() };
  if (sc) sc.strokes = (sc.strokes || 0) + 1;
  save('round'); vibrate(80); toast(`${h.nineHole ?? h.n}번 홀 ${sc?.strokes || 1}타째 · 공 있는 곳으로 가요`, 3000);
  P.ballPos = null; persist(); update(true);
}

async function found() {
  const shot = S.round?.liveShot; if (!shot || found._busy) return;
  found._busy = true;
  const b = $('#found'); if (b) { b.disabled = true; b.textContent = '📡 거리 재는 중…'; }
  try { await foundRun(shot); } finally { found._busy = false; }
}
async function foundRun(shot) {
  const f = Sensors.pos ? await sampleFix(1500) : null;
  let rec = null;
  if (f) {
    const total = distance(shot.start, f), w = wx();
    const latDeg = shot.aimBearing == null ? null : normAngle(bearing(shot.start, f) - shot.aimBearing), err = Math.round(Math.hypot(shot.startAcc || 5, f.acc || 5));
    const wind = w ? windAlongCross(w.windSpeed, w.windFrom, bearing(shot.start, f)) : shot.wind || null, rho = w?.rho ?? shot.rho;
    if (total > 5) {
      let fit = null; try { fit = shotSummary(analyzeShot({ clubId: shot.club, total, err, latDeg, wind, rho })); } catch {}
      rec = { id: Date.now(), club: shot.club, total: Math.round(total * 10) / 10, carry: fit?.est.carry ?? total / 1.05, latDeg: latDeg == null ? null : Math.round(latDeg * 10) / 10, err, wind, rho, power: shot.power, partial: shot.power < 95 || total <= 20, start: shot.start, end: { lat: f.lat, lon: f.lon }, hole: shot.hole, course: S.round.courseName, ts: Date.now(), fromPlay: true, fit };
      { const sc = stdCarry(rec); if (sc && Math.abs(sc - rec.carry) >= 0.5) rec.stdCarry = sc; } // 날씨를 뺀 표준 캐리
      if (shot.track) { rec.track = shot.track; toast(`🎥 추적 ${shot.track.total}m · 🛰️ GPS ${rec.total}m (차이 ${(rec.total - shot.track.total).toFixed(1)}m)`, 4000); }
      S.shots.push(rec);
      const i = S.bag.findIndex(c => c.id === shot.club); if (i >= 0 && !rec.partial) S.bag[i] = learnClub(S.bag[i], S.shots);
      save('shots', 'bag');
    }
    S.round.lastShot = { hole: shot.hole, dist: total, club: shot.clubName, ts: Date.now() };
    P.ballPos = { lat: f.lat, lon: f.lon }; P.ballHole = shot.hole; P.ballSrc = 'fix'; P.ballAcc = f.acc;
    const pin0 = activeHole()?.pin || activeHole()?.green;
    (S.round.track ||= []).push({ hole: shot.hole, start: shot.start, end: { lat: f.lat, lon: f.lon }, club: shot.club, dist: total, pin: pin0 ? { lat: pin0.lat, lon: pin0.lon } : null });
  } else if (!shot.pred) { // 위치도 예측도 없음 (그린 모르는 홀 + GPS 없음)
    toast('위치를 못 찾아서 거리는 못 쟀어요 · 타수는 기록했어요', 3500);
  } else { // GPS가 없으면 예상 위치에 공을 놓음 (다르면 다시 찍기)
    P.ballPos = { lat: shot.pred.lat, lon: shot.pred.lon }; P.ballHole = shot.hole; P.ballSrc = 'est';
    (S.round.track ||= []).push({ hole: shot.hole, start: shot.start, end: { lat: shot.pred.lat, lon: shot.pred.lon }, club: shot.club, dist: distance(shot.start, shot.pred), est: true });
    toast('잘했어요! 예상 위치에 공을 놓았어요 · 다르면 [📍 공 다시 찍기]', 3500);
  }
  delete S.round.liveShot; save('round'); persist(); vibrate([60, 40, 60]); update(true);
  // 결과 화면: 측정(거리·방향) + 계산(공 속도·높이·시간…)
  if (!rec && !shot.pred) return;
  const card = rec || { club: shot.club, total: shot.predTotal || distance(shot.start, shot.pred), wind: shot.wind, rho: shot.rho, estPos: true };
  { const cb = S.bag.find(c => c.id === shot.club); say(resultCue({ club: shot.clubName, total: card.total, lateral: rec?.fit?.measured?.lateralM ?? null, usual: cb ? cb.carry * 1.04 : null, estimated: !rec }), { force: false }); }
  P.voiceDue = true;
  shotSheet(card, { title: `🏌️ ${shot.clubName} · ${rec ? '내 공 결과' : '예상 결과 (위치를 못 재서)'}`, kind: rec ? 'result' : 'predict', extra: [{ label: '📈 클럽별', onClick: () => App_.go('shots') }] });
}

// ---------------- 보기 (2D · 3D · 4D · AR) ----------------
function sceneData() {
  const h = activeHole(), shot = shotOf(), me = ballPos() || shot?.start || null;
  return {
    me: Sensors.pos || me, ball: shot ? shot.pred : (P.ballPos && P.ballHole === h?.n ? P.ballPos : null), from: me, pin: h ? (h.pin || h.green) : null,
    landing: !shot && adv?.landing && allowed('clubRec') ? adv.landing : null, ellipse: !shot && allowed('clubRec') ? adv?.ellipse : null,
    hazards: h?.hazards || [], hole: h, clubOk: allowed('clubRec'), wx: allowed('playsLike') ? wx() : null,
    ballSrc: shot ? (shot.track ? 'track' : shot.seen ? 'camera' : shot.cam ? 'course' : 'pred') : null, ballErr: shot ? (shot.r80 || 15) / 1.5 : null, swingTs: App_.lastSwingTs || null,
    marks: (activeCourse()?.holes || []).filter(x => x !== h && (x.pin || x.green)).map(x => ({ p: x.pin || x.green, name: `⛳ ${x.nine ? x.nine + ' ' : ''}${x.nineHole ?? x.n}번 홀 그린` })),
    dzPin: (() => { const pn = h ? (h.pin || h.green) : null; const f = me; return pn && f ? pinDrop(f, pn, h)?.v ?? null : null; })(),
    plan: (() => { if (shot || !allowed('clubRec') || !me || !adv?.club || adv.club === 'PT' || !(adv.kind === 'full' || adv.kind === 'partial')) return null; const cb = S.bag.find(c => c.id === adv.club), w = allowed('windAdjust') ? wx() : null; return cb ? { from: me, aim: adv.aimBearing, club: adv.club, stdCarry: cb.carry * (adv.power || 100) / 100, wind: w?.windSpeed != null ? { windSpeed: w.windSpeed, windFrom: w.windFrom } : null, rho: w?.rho } : null; })(),
    live: (() => { if (!shot || shot.aimBearing == null || !shot.club) return null; const cb = S.bag.find(c => c.id === shot.club), w = allowed('windAdjust') ? wx() : null; return cb ? { ts: shot.ts, from: shot.start, aim: shot.aimBearing, club: shot.club, stdCarry: cb.carry * (shot.power || 100) / 100, wind: w?.windSpeed != null ? { windSpeed: w.windSpeed, windFrom: w.windFrom } : null, rho: shot.rho ?? w?.rho } : null; })(),
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
    map = createMap($('#pmap'), { full: false, center: ll(c0), zoom: h.green || ballPos() || near ? 17 : c.center ? (c.center.precision === "sigungu" ? 12 : 15) : 7 });
    if (!map) return;
    drawHole(map, h); lay = L.layerGroup().addTo(map); map.on('zoomend', () => drawRings(sceneData()));
    $('#zi').onclick = () => map.zoomIn(); $('#zo').onclick = () => map.zoomOut();
    map.on('click', mapClick);
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
    arCtl = await startAR($('#arb'), () => { const sd = sceneData(); return { ...sd, me: Sensors.pos || sd.from }; }, {
      onMapEl: el => {
        const c = activeCourse(), c0 = ballPos() || h.green || h.tee || c?.center || Sensors.pos || { lat: 36.5, lon: 127.8 };
        map = createMap(el, { center: ll(c0), zoom: 17, full: false }); if (!map) return; // 골프 치기 화면은 자체 '지도 크게' 버튼이 있음
        drawHole(map, h); lay = L.layerGroup().addTo(map); map.on('click', mapClick); map.on('zoomend', () => P.mapFull && drawRings(sceneData()));
        headMk = L.marker(ll(c0), { icon: L.divIcon({ className: 'hd-cone', html: '<i></i>', iconSize: [0, 0] }), interactive: false, zIndexOffset: -10 }).addTo(map);
        setTimeout(() => { map?.invalidateSize(); miniFit(); scene(); }, 120);
      },
      onMapMode: full => { P.mapFull = full; setTimeout(() => { if (!map) return; map.invalidateSize(); full ? fit2d() : miniFit(); scene(); }, 80); if (full) toast(P.marking ? '🗺️ 지도에서 눌러 주세요' : '🗺️ 지도예요 · 휴대폰을 세우면 다시 카메라', 2200); },
      onHeading: b => { const me = Sensors.pos || ballPos(); if (!headMk || !me) return; headMk.setLatLng(ll(me)); const i = headMk.getElement()?.firstChild; if (i) i.style.transform = `rotate(${b}deg)`; },
      onFail: () => { if (P.view !== 'ar') return; P.view = '2d'; P.viewSet = true; persist(); render(); toast('📷 카메라를 쓸 수 없어서 지도로 보여 드려요', 3500); },
      views: [['big', '🔠 큰 숫자'], ['2d', '🗺️ 지도만'], ...(S.settings.detail ? [['3d', '🏔️ 입체 지도만'], ['4d', '🎬 공 비행만']] : [])],
      onView: k => { P.view = k; P.viewSet = true; persist(); render(); },
      // 🎥 친 공 따라가기 결과: 공이 멈출 곳을 착지+굴러감으로 · 아직 [쳤어요]를 안 눌렀으면 같이 기록
      onTrack: async fit => {
        if (!shotOf()) await hit();
        const shot = shotOf(); if (!shot || !fit.rest) return;
        shot.pred = { lat: fit.rest.lat, lon: fit.rest.lon }; shot.r80 = Math.max(3, fit.sd * 1.5);
        shot.track = { kmh: +fit.kmh.toFixed(1), launch: +fit.launch.toFixed(1), side: +fit.sideDeg.toFixed(1), apex: +fit.apex.toFixed(1), time: +fit.time.toFixed(2), carry: +fit.carry.toFixed(1), total: +fit.total.toFixed(1), sd: +fit.sd.toFixed(1), timedBy: fit.timedBy, n: fit.n, rms: +fit.rms.toFixed(2), rejected: fit.rejected };
        save('round'); vibrate([60, 40, 60]); update(true);
        say(`착지 거리 ${fit.carry.toFixed(1)}미터, 공 속도 시속 ${Math.round(fit.kmh)}킬로미터`, { force: true });
        toast(`🎥 착지 ${fit.carry.toFixed(1)}m ±${fit.sd.toFixed(1)} · 공 속도 ${fit.kmh.toFixed(1)}km/h · 발사 ${fit.launch.toFixed(1)}°`, 4500);
      },
      // 📷 가까이서 본 공: 지금 공 위치(예측·추적)와 정확도만큼 합침
      onBallSeen: (pos, sd) => {
        const shot = shotOf(); if (!shot?.pred) return;
        const sdPrev = (shot.r80 || 15) / 1.5, w = blendWeight(sdPrev, sd);
        shot.pred = { lat: shot.pred.lat + (pos.lat - shot.pred.lat) * w, lon: shot.pred.lon + (pos.lon - shot.pred.lon) * w };
        shot.r80 = Math.max(0.8, 1.5 / Math.sqrt(1 / sdPrev ** 2 + 1 / sd ** 2));
        if (!shot.seen) { shot.seen = true; vibrate(40); toast('📷 공을 찾았어요 · 위치를 맞췄어요', 2500); say('공을 찾았어요', { force: false }); }
        save('round');
      },
      onLock: p => { const h = activeHole(); P.target = { hole: h.n, lat: p.lat, lon: p.lon }; persist(); toast('📌 고정한 곳을 목표로 정했어요 (2D 지도에서 확인)'); }, onPin: p => {
        // 🔀 깃대 카메라 + 골프장이 발행한 오늘 핀(또는 전에 잰 핀)을 정확도만큼 합침
        const h = activeHole(), prev = h.pin, today = prev && new Date(prev.ts || 0).toDateString() === new Date().toDateString();
        let lat = p.lat, lon = p.lon, err = p.err, how = '깃대 카메라';
        if (prev && (prev.src === 'official' || today)) {
          const sdPrev = prev.src === 'official' ? 1.5 : prev.err || 3, w = blendWeight(sdPrev, p.err || 3);
          lat = prev.lat + (p.lat - prev.lat) * w; lon = prev.lon + (p.lon - prev.lon) * w; err = Math.round(1 / Math.sqrt(1 / sdPrev ** 2 + 1 / (p.err || 3) ** 2) * 10) / 10;
          how = `깃대 카메라 + ${prev.src === 'official' ? '골프장 핀' : '전에 잰 핀'}`;
        }
        h.pin = { lat: +lat.toFixed(7), lon: +lon.toFixed(7), ts: Date.now(), src: 'flag', err };
        save('courses'); adv = null; advKey = ''; update(true); toast(`⛳ 핀 위치를 저장했어요 (${how} · ±${err}m)`, 3500);
      } });
    arStop = arCtl?.stop || null;
  }
}

// 지도 누르기: 목표점 · 핀 · 그린 · 내 공 찍기 (지도 화면과 카메라 화면 속 지도가 같이 씀)
function mapClick(e) {
  const h = activeHole();
  if (!P.marking) mapMeasure({ lat: e.latlng.lat, lon: e.latlng.lng });
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
    }

// 📍 지도 재기: 누른 곳까지 정밀 거리(WGS84 타원체) · 선과 숫자 (다시 누르면 바뀜)
let measLay = null;
function mapMeasure(p) {
  const me = Sensors.pos || ballPos(); if (!me || !map) return;
  const d = geodesic(me, p), fm = x => (Math.round(x * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (measLay) { measLay.remove(); measLay = null; }
  measLay = L.layerGroup([
    L.polyline([ll(me), ll(p)], { color: '#000', weight: 6, opacity: 0.35, interactive: false }),
    L.polyline([ll(me), ll(p)], { color: '#ffc83d', weight: 3, dashArray: '8 6', interactive: false }),
    L.circleMarker(ll(p), { radius: 6, color: '#0e1410', weight: 2, fillColor: '#ffc83d', fillOpacity: 1, interactive: false }),
    L.marker(ll(p), { icon: labelIcon(`📍 ${fm(d)}m · ${Math.round(bearing(me, p))}°`, 'meas'), interactive: false }),
  ]).addTo(map);
  vibrate(15); toast(`📍 여기까지 ${fm(d)}m (±${Math.round(me.acc || 3)}m)`, 2500);
}

// 지도로 찍어야 할 때: 카메라 화면이면 그 안의 지도를 크게, 아니면 지도 화면으로
function toMap() {
  if (P.view === 'ar' && arCtl) { arCtl.setMap(true, true); return; }
  if (P.view !== '2d') { P.view = '2d'; persist(); render(); }
}

function miniFit() {
  if (!map) return;
  const sd = sceneData(), pts = [sd.me, sd.from, sd.pin, sd.landing, sd.ball].filter(Boolean).map(ll);
  if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts), { padding: [10, 10], maxZoom: 18, animate: false });
  else if (pts.length) map.setView(pts[0], 17, { animate: false });
}
function fit2d() {
  if (!map) return;
  if (P.view === 'ar' && !P.mapFull) return miniFit();
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
  const easy = !S.settings.detail;
  if (!easy && sd.ellipse?.length > 2) L.polygon(sd.ellipse.map(ll), { color: '#ffe27a', weight: 1, fillOpacity: 0.18, interactive: false }).addTo(lay);
  if (from && landing) {
    L.polyline([ll(from), ll(landing)], { color: '#5ee6a8', weight: 14, opacity: 0.35, lineCap: 'round', interactive: false }).addTo(lay);
    L.polyline([ll(from), ll(landing)], { color: '#ffffff', weight: 4, opacity: 0.98, lineCap: 'round', interactive: false }).addTo(lay);
    if (distance(landing, pin) > 3) L.polyline([ll(landing), ll(pin)], { color: '#ffffff', weight: 3, dashArray: '2 7', interactive: false }).addTo(lay);
    if (easy) L.circleMarker(ll(landing), { radius: 8, color: '#0e1410', weight: 2, fillColor: '#c8f169', fillOpacity: 1, interactive: false }).addTo(lay); // 공이 떨어질 곳
    if (!easy && (shotOf() || distance(from, pin) < 25)) L.marker(ll(landing), { icon: labelIcon(`🎯 ${Math.round(distance(from, landing))}m`, 'tgt'), interactive: false }).addTo(lay);
    const rel = adv?.rel || 0;
    if (!easy && Math.abs(rel) >= 0.75) L.marker(ll(destination(from, adv.aimBearing, Math.min(40, distance(from, landing) / 3))), { icon: labelIcon(`${rel > 0 ? '오른쪽' : '왼쪽'} ${Math.abs(rel).toFixed(1)}°`, 'ang'), interactive: false }).addTo(lay);
  }
  if (from) L.circleMarker(ll(from), { radius: 9, color: '#fff', weight: 3, fillColor: P.ballPos ? '#ffffff' : '#2b7bff', fillOpacity: 1 }).bindTooltip(P.ballPos ? '내 공' : '나').addTo(lay);
  if (ball) { L.circle(ll(ball), { radius: shotOf()?.r80 || 10, color: '#ff6b5a', weight: 2, fillOpacity: 0.15, interactive: false }).addTo(lay); L.marker(ll(ball), { icon: labelIcon(`⚪ 내 공 ${Math.round(distance(Sensors.pos || from, ball))}m`, 'ball'), interactive: false }).addTo(lay); }
  if (!easy && pin && from && (shotOf() || distance(from, pin) < 25)) L.marker(ll(pin), { icon: labelIcon(`⛳ ${Math.round(distance(from, pin))}m`, 'pin'), interactive: false }).addTo(lay);
  if (P.view !== 'ar' || P.mapFull) drawRings(sd); else if (ringLay) { ringLay.remove(); ringLay = null; }
  if (P.view === 'ar' && !P.mapFull && !scene._fitAt) { scene._fitAt = 1; miniFit(); }
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
  const w = wx(), wind = allowed('windAdjust') && w;
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
  if (!S.settings.detail) return; // 쉬운 화면: 거리 링·해저드 숫자·목표 조준판 없음 (거리는 위 막대 하나)
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
    const diff = pl.total - rT, w = wx();
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
