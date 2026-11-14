// 쉬운 플레이 (초등학생도 쓰는 기본 흐름)
//  ① 골프장 고르기 → ② 코스 고르기 → ③ 홀 화면: 그린까지 거리 · 추천 클럽 · 힘(%) · 방향(각도) · 추천 길
//  → ④ "쳤어요!" → 내 공 위치(거리·방향) 안내 → "찾았어요"
//  보기: 2D 지도 · 3D 지형 · 4D(3D + 공 비행·홀 플라이오버 시간 재생) · AR 카메라
import { S, save, activeCourse, activeHole, allowed, currentMode, MODES } from '../core/state.js';
import { newRound } from '../core/score.js';
import { demoCourse } from '../core/course.js';
import { getCatalog, installCourse, findInstalled, getClubs } from '../core/remote.js';
import { Sensors, onPos, onOrientation, sampleFix, keepAwake, vibrate, speak, startOrientation } from '../core/sensors.js';
import { distance, bearing, destination, normAngle } from '../core/geo.js';
import { adviseShot, predictBall, toBall, dirWords, compassName, greenR } from '../physics/advice.js';
import { conditionsEffect } from '../physics/flight.js';
import { learnClub } from '../core/score.js';
import { createMap, destroyMap, drawHole, ll, flagIcon, labelIcon } from '../map.js';
import { $, $$, esc, toast, sheet, confirmSheet } from '../ui.js';

const KEY = 'pinpoint.play';
const P = (() => { try { return { view: '2d', ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { return { view: '2d' }; } })();
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

function teardown() { destroyMap(map); map = lay = null; v3?.destroy(); v3 = null; arStop?.(); arStop = null; }
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
  const sc = h.scorecard, hd = h.hdcp ?? h.hdcpCard;
  el_.innerHTML = `<div class="phole">
    <div class="ph-top"><button class="pnav" id="hPrev" aria-label="이전 홀">◀</button>
      <div class="ph-title"><b>${esc(holeName(h))}</b><span>파 ${h.par}${hd ? ` · 어려운 순서 ${hd}` : ''}${sc?.white ? ` · 화이트 ${sc.white}${sc.unit}` : ''} · ${idx + 1}/${order.length}</span></div>
      <button class="pnav" id="hNext" aria-label="다음 홀">▶</button></div>
    <div class="vseg" role="tablist">${[['2d', '🗺️ 2D'], ['3d', '⛰️ 3D'], ['4d', '🎬 4D'], ['ar', '📷 AR']].map(([k, t]) => `<button role="tab" class="${P.view === k ? 'on' : ''}" data-v="${k}">${t}</button>`).join('')}</div>
    <div class="stage" id="stage"></div>
    <div class="pcards" id="cards"></div>
    <div class="pact" id="act"></div>
    <div class="pmore"><a href="#/green">🟢 그린 읽기</a><a href="#/score">📝 점수</a><a href="#/lost">📡 공 찾기</a><a href="#/rules">📖 규칙</a></div>
  </div>`;
  $('#hPrev').onclick = () => App_.stepHole(-1);
  $('#hNext').onclick = () => App_.stepHole(1);
  $$('[data-v]').forEach(b => b.onclick = () => { P.view = b.dataset.v; persist(); render(); });
  mountView();
  unPos = onPos(() => update());
  startOrientation();
  unOri = onOrientation(() => { if (S.shot && P.view !== 'ar') arrowOnly(); });
  timer = setInterval(update, 4000);
  update(true);
}

// 상태: 친 공 (라운드 중 하나)
const shotOf = () => (S.round?.liveShot && S.round.liveShot.hole === activeHole()?.n ? S.round.liveShot : null);

function compute(force) {
  const h = activeHole(), me = ballPos();
  if (!h || !me) { adv = null; return; }
  const key = `${h.n}|${me.lat.toFixed(5)},${me.lon.toFixed(5)}|${h.pin?.lat}|${currentMode()}`;
  if (!force && key === advKey && Date.now() - advT < 30000) return;
  advKey = key; advT = Date.now();
  const w = App_.weather;
  adv = adviseShot({ me, hole: h, bag: S.bag, hcp: S.settings.hcp, weather: allowed('windAdjust') && w ? { windSpeed: w.windSpeed, windFrom: w.windFrom, rho: w.rho } : {} });
}

function update(force = false) {
  if (P.step !== 'hole') return;
  compute(force);
  cards(); actions(); scene();
}

function cards() {
  const box = $('#cards'); if (!box) return;
  const h = activeHole(), me = ballPos(), shot = shotOf();
  const pin = h.pin || h.green;
  const card = scoreCard(h);
  if (!pin) {
    box.innerHTML = `<div class="pcard"><div class="bigq">🟢 이 홀의 그린 위치를 알려 주세요</div>
      <p class="sub center" style="margin:6px 0 0">이 골프장은 스코어카드만 있고 지도 위치가 아직 없어요. 위 지도에서 <b>그린 가운데</b>를 한 번 누르면 그때부터 거리와 추천이 나와요. (이 휴대폰에만 저장)</p>
      <button class="pbtn primary" id="markGreen">🗺️ 지도에서 그린 찍기</button></div>${card}`;
    $('#markGreen').onclick = () => { if (P.view !== '2d') { P.view = '2d'; persist(); render(); } P.marking = 'green'; toast('🗺️ 위성지도에서 그린 가운데를 눌러 주세요 (확대하면 더 정확해요)', 4000); };
    return;
  }
  if (!me) { box.innerHTML = `<div class="pcard"><div class="bigq">📍 위치를 찾는 중이에요…</div><p class="sub center">밖에서 잠깐 기다려 주세요. 실내라면 ☰ → 설정 → <b>GPS 시뮬레이션</b>을 켜거나, 아래 [📍 내 공 여기!]로 지도에 공 위치를 찍어요.</p></div>`; return; }
  if (shot) {
    const t = toBall(Sensors.pos || me, shot.pred, Sensors.heading);
    box.innerHTML = `<div class="pcard ball"><div class="sub">내 공은 여기쯤 있어요</div>
      <div class="bigd"><b>${Math.round(t.d)}</b><small>m</small></div>
      <div class="arrow-row"><div class="arrow" id="ballArrow" style="transform:rotate(${t.rel ?? 0}deg)">⬆</div><div><b>${t.rel == null ? `${t.compass}쪽 (${Math.round(t.bearing)}°)` : Math.abs(t.rel) < 12 ? '앞으로 쭉 걸어가요' : `${t.rel > 0 ? '오른쪽' : '왼쪽'}으로 ${Math.round(Math.abs(t.rel))}° 돌아서 걸어가요`}</b><br><span class="sub">${esc(shot.clubName)}로 ${Math.round(shot.carry)}m 쳤다고 보면 · 찾을 범위 약 ${Math.round(shot.r80)}m</span></div></div></div>`;
    return;
  }
  const dF = h.front ? distance(me, h.front) : null, dB = h.back ? distance(me, h.back) : null, D = distance(me, pin);
  const isBall = P.ballPos && P.ballHole === h.n;
  let advHtml = '';
  if (!allowed('clubRec')) advHtml = `<div class="pcard"><b>🏆 대회 모드</b><p class="sub" style="margin:4px 0 0">대회 규칙(4.3a) 때문에 클럽·방향 추천은 숨겼어요. 거리만 보여요.</p></div>`;
  else if (adv?.kind === 'holed') advHtml = `<div class="pcard"><div class="bigq">🎉 홀 바로 옆이에요!</div></div>`;
  else if (adv?.kind === 'putt') advHtml = `<div class="pcard adv"><div class="ar1"><i>🏌️</i><b>퍼터</b></div><div class="ar1"><i>🧭</i><span>${esc(adv.text)}</span></div><a class="pbtn small" href="#/green">🟢 굴릴 방향·세기 계산하기</a></div>`;
  else if (adv?.club) {
    const rel = adv.rel || 0, side = Math.abs(adv.lateral || 0);
    advHtml = `<div class="pcard adv">
      <div class="ar1"><i>🏌️</i><b>${esc(adv.clubName)}</b>${adv.alternatives?.length ? `<small>다른 선택: ${adv.alternatives.map(a => esc(a.clubName)).join(', ')}</small>` : ''}</div>
      ${(() => { const cb = S.bag.find(c => c.id === adv.club); return cb ? `<div class="learn">📏 내 ${esc(cb.name)} 비거리 ${Math.round(cb.carry)}m · ${cb.learned ? `실제 ${cb.n}번 친 기록으로 학습됨 ✓` : `아직 기본값이에요 (${cb.n || 0}/3샷) — 칠수록 정확해져요`}</div>` : ''; })()}
      <div class="ar1"><i>💪</i><b>힘 ${adv.power}%</b><span>${esc(adv.swing.short)} (${adv.swing.clock})</span></div>
      <div class="pow"><span style="width:${adv.power}%"></span></div>
      <div class="ar1"><i>🧭</i><b>${dirWords(rel)}</b>${side >= 2 ? `<span>깃발 줄에서 ${rel > 0 ? '오른쪽' : '왼쪽'} ${Math.round(side)}m 지점을 보고</span>` : ''}</div>
      <div class="dirpad"><div class="dp-arrow" style="transform:rotate(${Math.max(-60, Math.min(60, rel * 3))}deg)">⬆</div><div class="dp-flag">⛳</div><small>방위 ${Math.round(adv.aimBearing)}° (${compassName(adv.aimBearing)}) · 깃발 ${Math.round(adv.pinBrg)}°</small></div>
      <div class="ar1"><i>🎯</i><span>공이 떨어질 곳 <b>${Math.round(adv.carry)}m</b> · 그다음 깃발까지 <b>${Math.round(distance(adv.landing, pin))}m</b></span></div>
      ${adv.pBad > 0.12 ? `<p class="sub warnline">⚠ 이 홀은 위험 구역이 있어요. 안전하게 쳐도 괜찮아요 (위험 ${Math.round(adv.pBad * 100)}%)</p>` : ''}
    </div>`;
  } else if (adv?.kind === 'noclub') advHtml = `<div class="pcard"><a href="#/bag">내 백에서 클럽을 켜 주세요</a></div>`;
  box.innerHTML = `<div class="pcard dist"><div class="sub">${isBall ? '⚪ 공에서' : '📍 지금 위치에서'} 깃발까지</div>
      <div class="bigd"><b>${Math.round(D)}</b><small>m</small></div>
      <div class="fb">${dF ? `그린 앞 <b>${Math.round(dF)}</b>` : ''}${dB ? ` · 뒤 <b>${Math.round(dB)}</b>` : ''}${h.pin?.src === 'official' ? ' · 오늘 핀 ✓' : ''} · GPS ±${Math.round(me.acc || 0)}m</div></div>${advHtml}${card}`;
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
function arrowOnly() {
  const shot = shotOf(), a = $('#ballArrow'); if (!shot || !a || !Sensors.pos) return;
  const t = toBall(Sensors.pos, shot.pred, Sensors.heading); if (t.rel != null) a.style.transform = `rotate(${t.rel}deg)`;
}

function actions() {
  const box = $('#act'); if (!box) return;
  const shot = shotOf(), h = activeHole();
  if (shot) {
    box.innerHTML = `<button class="pbtn primary" id="found">✅ 공 찾았어요!</button><button class="pbtn" id="lostb">📡 공이 안 보여요</button><button class="pbtn ghost" id="cancel">↩ 다시 칠래요 (취소)</button>`;
    $('#found').onclick = found;
    $('#lostb').onclick = () => { App_.go('lost'); };
    $('#cancel').onclick = () => { delete S.round.liveShot; save('round'); update(true); };
    return;
  }
  box.innerHTML = `<button class="pbtn primary" id="hit">🏌️ 쳤어요!</button>
    <div class="row2"><button class="pbtn" id="mark">${P.ballPos && P.ballHole === h.n ? '📍 내 공 위치 다시 찍기' : '📍 내 공 여기!'}</button>${P.ballPos && P.ballHole === h.n ? '<button class="pbtn ghost" id="useMe">🧍 내 위치로</button>' : '<button class="pbtn" id="nextH">다음 홀 ▶</button>'}</div>`;
  $('#hit').onclick = hit;
  $('#mark').onclick = markBall;
  $('#useMe')?.addEventListener('click', () => { P.ballPos = null; persist(); update(true); });
  $('#nextH')?.addEventListener('click', () => App_.stepHole(1));
}

// 지도에서 공 위치 찍기 (공이 내 위치와 다를 때 · 실내 연습)
function markBall() {
  if (P.view !== '2d') { P.view = '2d'; persist(); render(); }
  toast('🗺️ 지도에서 내 공이 있는 곳을 눌러요', 3500);
  P.marking = true;
}

async function hit() {
  const h = activeHole(), start = ballPos();
  if (!start) return toast('위치를 찾는 중이에요');
  if (!S.round) return toast('라운드를 먼저 시작해요');
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
    toast(`잘했어요! ${Math.round(total)}m 날아갔어요`, 3000);
    P.ballPos = { lat: f.lat, lon: f.lon }; P.ballHole = shot.hole;
  } else toast('잘했어요!');
  delete S.round.liveShot; save('round'); persist(); vibrate([60, 40, 60]); update(true);
}

// ---------------- 보기 (2D · 3D · 4D · AR) ----------------
function sceneData() {
  const h = activeHole(), me = ballPos(), shot = shotOf();
  return {
    me: Sensors.pos || me, ball: shot ? shot.pred : (P.ballPos && P.ballHole === h?.n ? P.ballPos : null), from: me, pin: h ? (h.pin || h.green) : null,
    landing: !shot && adv?.landing && allowed('clubRec') ? adv.landing : null, ellipse: !shot && allowed('clubRec') ? adv?.ellipse : null,
    hazards: h?.hazards || [], hole: h,
  };
}

async function mountView() {
  const stage = $('#stage'), h = activeHole();
  stage.className = 'stage ' + P.view;
  if (P.view === '2d') {
    stage.innerHTML = '<div class="map" id="pmap"></div><div class="zoomb"><button id="zi">＋</button><button id="zo">－</button></div>';
    const c = activeCourse(), near = c.holes.find(x => x.green) || null;
    const c0 = ballPos() || h.green || h.tee || near?.green || c.center || Sensors.pos || { lat: 36.5, lon: 127.8 };
    map = createMap($('#pmap'), { center: ll(c0), zoom: h.green || ballPos() || near ? 17 : c.center ? (c.center.precision === "sigungu" ? 12 : 15) : 7 });
    if (!map) return;
    drawHole(map, h); lay = L.layerGroup().addTo(map);
    $('#zi').onclick = () => map.zoomIn(); $('#zo').onclick = () => map.zoomOut();
    map.on('click', e => {
      if (!P.marking) return;
      if (P.marking === 'green') {
        P.marking = false; h.green = { lat: +e.latlng.lat.toFixed(7), lon: +e.latlng.lng.toFixed(7) }; h.greenBy = 'user'; save('courses');
        vibrate(40); toast('🟢 그린 위치를 저장했어요'); adv = null; advKey = ''; drawHole(map, h); update(true); fit2d(); return;
      }
      P.marking = false; P.ballPos = { lat: e.latlng.lat, lon: e.latlng.lng }; P.ballHole = h.n; persist(); vibrate(40); update(true); fit2d();
    });
    fit2d();
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
      scene(); v3.fitScene();
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
  const sd = sceneData(), pts = [sd.me, sd.from, sd.pin, sd.landing, sd.ball].filter(Boolean).map(ll);
  if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 19 });
}

function scene() {
  const sd = sceneData();
  if (v3) { v3.setScene({ me: sd.from, pin: sd.pin, landing: sd.landing, ball: sd.ball, ellipse: sd.ellipse }); return; }
  if (!map || !lay) return;
  lay.clearLayers();
  const { from, pin, landing, ball } = sd;
  if (from && pin) L.polyline([ll(from), ll(pin)], { color: '#ffffff', weight: 2, opacity: 0.75, dashArray: '4 6', interactive: false }).addTo(lay);
  if (sd.ellipse?.length > 2) L.polygon(sd.ellipse.map(ll), { color: '#ffe27a', weight: 1, fillOpacity: 0.18, interactive: false }).addTo(lay);
  if (from && landing) {
    L.polyline([ll(from), ll(landing)], { color: '#ffe27a', weight: 7, opacity: 0.95, lineCap: 'round', interactive: false }).addTo(lay);
    if (distance(landing, pin) > 3) L.polyline([ll(landing), ll(pin)], { color: '#ffffff', weight: 3, dashArray: '2 7', interactive: false }).addTo(lay);
    L.marker(ll(landing), { icon: labelIcon(`🎯 ${Math.round(distance(from, landing))}m`, 'tgt'), interactive: false }).addTo(lay);
    const rel = adv?.rel || 0;
    if (Math.abs(rel) >= 0.75) L.marker(ll(destination(from, adv.aimBearing, Math.min(40, distance(from, landing) / 3))), { icon: labelIcon(`${rel > 0 ? '오른쪽' : '왼쪽'} ${Math.abs(rel).toFixed(1)}°`, 'ang'), interactive: false }).addTo(lay);
  }
  if (from) L.circleMarker(ll(from), { radius: 9, color: '#fff', weight: 3, fillColor: P.ballPos ? '#ffffff' : '#2b7bff', fillOpacity: 1 }).bindTooltip(P.ballPos ? '내 공' : '나').addTo(lay);
  if (ball) { L.circle(ll(ball), { radius: shotOf()?.r80 || 10, color: '#ff6b5a', weight: 2, fillOpacity: 0.15, interactive: false }).addTo(lay); L.marker(ll(ball), { icon: labelIcon(`⚪ 내 공 ${Math.round(distance(Sensors.pos || from, ball))}m`, 'ball'), interactive: false }).addTo(lay); }
  if (pin && from) L.marker(ll(pin), { icon: labelIcon(`⛳ ${Math.round(distance(from, pin))}m`, 'pin'), interactive: false }).addTo(lay);
}
