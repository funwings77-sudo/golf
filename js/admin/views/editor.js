// 코스 편집기: 위성지도에서 티(세트별)·그린 앞/중앙/뒤·IP·해저드·대피소를 지정·드래그,
// 좌표 직접 입력, 홀 정보(파·핸디캡·반폭·공략 메모), 실시간 검증, 변경 요약 → 발행
import { $, $$, esc, toast, sheet } from '../../ui.js';
import { createMap, destroyMap, HZ_STYLE, ll } from '../../map.js';
import { distance } from '../../core/geo.js';
import { uid } from '../../core/state.js';
import { Store } from '../store.js';
import * as M from '../model.js';
import { go } from '../main.js';
import { fetchOSMGolf, parseOSM, applyOSM, OSM_ATTRIB } from '../osm.js';
import { detectGreens } from '../greendetect.js';
import { destination, bearing } from '../../core/geo.js';
import { ago, confirmPublish, runPublish, readonlyNote } from '../common.js';

const POINTS = [['tee', '기본 티', 'tee', 'T'], ['green', '그린 중앙', 'green', 'G'], ['front', '그린 앞', 'front', 'F'], ['back', '그린 뒤', 'back', 'B'], ['ip', 'IP 공략점', 'ip', 'IP']];
let st = null, el_ = null;

export default {
  dirty: () => false, // 임시저장이 즉시 되므로 이탈해도 잃지 않음
  async mount(el, [id]) {
    el_ = el;
    if (!id) return go('courses');
    const w = await Store.working(id);
    if (!w.course) { el.innerHTML = `<div class="card empty-card">코스 <b class="mono">${esc(id)}</b>를 찾을 수 없습니다.<br><a class="btn" href="#/courses" style="margin-top:10px">코스 목록</a></div>`; return; }
    st = { id, course: w.course, remote: w.remote, dirty: w.dirty, savedAt: w.savedAt, holeN: 1, tool: null, hzType: 'bunker', hzR: 12, teeSet: 'white', map: null, layer: null, fitted: false, showInfo: !w.remote };
    render();
  },
  unmount() { destroyMap(st?.map); st = null; },
};

const hole = () => st.course.holes.find(h => h.n === st.holeN) || st.course.holes[0];
function persist(redrawMap = true) {
  st.dirty = true; st.savedAt = Date.now();
  try { Store.saveDraft(st.id, st.course, st.remote?.rev || 0); } catch (e) { toast(e.message, 5000); }
  if (redrawMap) drawMap();
  renderPanel(); renderHeader(); renderChips();
}

function render() {
  el_.innerHTML = `<div id="hdr"></div>${readonlyNote()}
    <div id="info"></div>
    <div class="card tight" style="margin:10px 0"><div class="holechips" id="chips"></div></div>
    <div class="split">
      <div><div class="toolbar no-print" id="tools" style="margin-bottom:8px"></div>
        <div class="a-map"><div class="map" id="emap"></div></div>
        <div class="row" style="margin-top:8px"><input type="text" id="goto" placeholder="위도, 경도 (예: 37.4419, 127.0094)" style="flex:1;min-width:200px"><button class="btn small" id="gotoBtn">지도 이동</button><button class="btn small" id="findBtn" title="OpenStreetMap 검색(Nominatim)으로 골프장 이름 찾기">🔎 이름으로 찾기</button><button class="btn small" id="fit">홀 전체 보기</button></div>
        <p class="sub" id="toolHelp" style="margin:6px 0 0"></p></div>
      <div class="sticky" id="panel"></div>
    </div>`;
  renderHeader(); renderInfo(); renderChips(); renderTools(); renderPanel();
  const anyPt = hole().green || hole().tee || st.course.holes.find(h => h.green || h.tee)?.green || st.course.holes.find(h => h.tee)?.tee;
  st.map = createMap($('#emap'), { center: ll(anyPt || st.course.center || { lat: 36.5, lon: 127.8 }), zoom: anyPt ? 17 : st.course.center ? (st.course.center.precision === 'sigungu' ? 12 : 16) : 7, me: false });
  if (st.map) { st.layer = L.layerGroup().addTo(st.map); st.qaLayer = L.layerGroup().addTo(st.map); st.map.on('click', e => { const p = { lat: +e.latlng.lat.toFixed(7), lon: +e.latlng.lng.toFixed(7) }; if (st.qa?.on) qaClick(p); else apply(p); }); drawMap(); }
  $('#gotoBtn').onclick = () => {
    const m = $('#goto').value.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (!m || !st.map) return toast('위도, 경도를 입력하세요');
    st.map.setView([+m[1], +m[2]], 17);
  };
  $('#fit').onclick = () => fit(true);
  // 골프장 이름 → 위치 (OSM Nominatim, 골프장 이름만 전송)
  $('#findBtn').onclick = async () => {
    const q = ($('#goto').value.trim() && !/\d+\.\d+/.test($('#goto').value) ? $('#goto').value.trim() : st.course.name).replace(/\(.*?\)/g, '').trim();
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(q)}`);
      const list = (await r.json()).filter(x => x.lat && x.lon);
      if (!list.length) return toast(`'${q}'을(를) 찾지 못했어요. 이름을 바꿔 입력칸에 넣고 다시 눌러 보세요`, 4000);
      const best = list.find(x => /golf/.test(x.type || '') || /골프|CC|컨트리/.test(x.display_name)) || list[0];
      st.map?.setView([+best.lat, +best.lon], 16); toast(best.display_name.split(',').slice(0, 3).join(','), 4000);
    } catch (e) { toast('검색 실패: ' + e.message); }
  };
}

function renderHeader() {
  const c = st.course, v = M.validateCourse(c);
  $('#hdr').innerHTML = `<div class="a-head"><div class="grow"><h1>✏️ ${esc(c.name)}</h1>
      <div class="statusline"><span class="mono">${esc(c.id)}</span>
        ${st.remote ? `<span class="badge mute">발행본 rev ${st.remote.rev} · ${ago(st.remote.updatedAt)}</span>` : '<span class="badge warn">아직 발행 안 됨</span>'}
        ${st.dirty ? `<span class="badge warn">● 발행 안 된 변경 (${ago(st.savedAt)} 임시저장)</span>` : '<span class="badge">발행본과 같음</span>'}
        ${v.errors.length ? `<span class="badge err">오류 ${v.errors.length}</span>` : '<span class="badge">오류 없음</span>'}${v.warnings.length ? `<span class="badge warn">확인 ${v.warnings.length}</span>` : ''}</div></div>
    <div class="a-actions"><button class="btn" id="qaBtn" title="위성사진에서 그린 후보를 찾고, 홀 순서대로 그린→티를 눌러 빠르게 지정">⚡ 빠른 지정</button><button class="btn" id="osm" title="현재 지도 화면 안의 OpenStreetMap 골프 데이터로 티·그린·벙커·물 위치 채우기">🌍 OSM 가져오기</button><a class="btn" href="#/greens/${encodeURIComponent(c.id)}">🟢 그린맵</a>${st.dirty && st.remote ? '<button class="btn" id="revert">↺ 발행본으로 되돌리기</button>' : ''}<button class="btn" id="check">🔎 전체 검증</button><button class="btn primary" id="pub" ${v.errors.length ? 'disabled title="오류를 먼저 고치세요"' : ''}>🚀 발행</button></div></div>`;
  $('#check').onclick = () => showIssues(v);
  $('#osm').onclick = importOSM;
  $('#qaBtn').onclick = () => (st.qa?.on ? qaStop() : qaStart());
  $('#pub').onclick = publish;
  $('#revert')?.addEventListener('click', () => sheet({
    title: '발행본으로 되돌리기', body: '<p>이 기기에 임시저장된 변경을 모두 버리고 발행본으로 되돌릴까요?</p>',
    actions: [{ label: '취소' }, { label: '되돌리기', kind: 'danger', onClick: () => { Store.dropDraft(st.id); st.course = M.clone(st.remote); st.dirty = false; drawMap(); renderAll(); toast('되돌렸습니다'); } }],
  }));
}
// OpenStreetMap에서 홀 구조 가져오기 (기획서 2+-6 · 무료, ODbL)
async function importOSM() {
  if (!st.map) return toast('지도를 불러오지 못했습니다');
  const b = st.map.getBounds();
  const btn = $('#osm'); btn.disabled = true; btn.textContent = '🌍 조회 중…';
  try {
    const osm = parseOSM(await fetchOSMGolf([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]));
    btn.disabled = false; btn.textContent = '🌍 OSM 가져오기';
    if (!osm.holes.length) return sheet({ title: 'OSM 홀 데이터 없음', body: `<p>지금 지도 화면 안에서 <code>golf=hole</code>(티→핀 선)을 찾지 못했습니다.</p><p class="sub">찾은 것: 그린 ${osm.greens.length} · 티 ${osm.tees.length} · 벙커·물 ${osm.hazards.length}. 골프장 전체가 화면에 들어오게 옮긴 뒤 다시 시도하거나, 위성지도에서 직접 찍으세요. OSM에는 국내 골프장이 일부만 그려져 있습니다.</p>`, actions: [{ label: '닫기' }] });
    const refs = osm.holes.map(h => h.ref).filter(Boolean);
    sheet({
      title: `OSM에서 ${osm.holes.length}개 홀 발견`,
      body: `<p>홀 번호: ${refs.join(', ') || '번호 없음'} · 그린 ${osm.greens.length} · 벙커·물 ${osm.hazards.length}</p>
        <p class="sub">홀 번호(ref)가 같은 홀에 티·그린 앞/중앙/뒤·IP·해저드를 넣습니다. OSM 데이터는 누구나 편집한 것이라 오차가 있을 수 있으니, 넣은 뒤 위성지도와 스코어카드 거리 검증으로 꼭 확인하세요. 출처 표기: ${OSM_ATTRIB}</p>`,
      actions: [{ label: '취소' }, { label: '빈 칸만 채우기', onClick: () => doApply(osm, false) }, { label: '모두 덮어쓰기', kind: 'primary', onClick: () => doApply(osm, true) }],
    });
  } catch (e) { btn.disabled = false; btn.textContent = '🌍 OSM 가져오기'; toast(e.message, 5000); }
}
function doApply(osm, overwrite) {
  const r = applyOSM(st.course, osm, { overwrite });
  st.fitted = false; persist(); renderAll(); fit(true);
  toast(`${r.matched.length}개 홀 채움${r.skipped.length ? ` · 못 찾은 홀 ${r.skipped.join(', ')}` : ''} — 검증 결과를 확인하세요`, 5000);
}

// ---------- ⚡ 빠른 지정: 그린 후보(위성사진 자동 감지) → 홀마다 그린 클릭 → 티 클릭(스코어카드 거리 안내 원) → 다음 홀 ----------
async function qaStart() {
  if (!st.map) return toast('지도를 불러오지 못했습니다');
  st.qa = { on: true, step: hole().green ? 'tee' : 'green', cands: [], undo: [] };
  $('#qaBtn').classList.add('on'); $('#qaBtn').textContent = '⚡ 빠른 지정 끝내기';
  qaBanner('🔍 위성사진에서 그린 후보를 찾는 중…');
  const b = st.map.getBounds();
  try {
    const r = await detectGreens({ s: b.getSouth(), n: b.getNorth(), w: b.getWest(), e: b.getEast() });
    st.qa.cands = r.candidates; qaDraw();
    toast(`그린 후보 ${r.candidates.length}개 (빨강 = 확실, 노랑 = 애매). 후보 근처를 누르면 그 중심에 맞춰집니다`, 5000);
  } catch (e) { toast('후보 찾기 실패: ' + e.message + ' — 후보 없이 직접 눌러도 됩니다', 6000); }
  qaPrompt();
}
function qaStop() { st.qa = null; st.qaLayer?.clearLayers(); $('#qaBanner')?.remove(); $('#qaBtn').classList.remove('on'); $('#qaBtn').textContent = '⚡ 빠른 지정'; }
function qaBanner(html) {
  let el = $('#qaBanner');
  if (!el) { el = document.createElement('div'); el.id = 'qaBanner'; el.className = 'note'; el.style.cssText = 'margin:0 0 8px;font-size:14.5px'; $('#tools').after(el); }
  el.innerHTML = html;
}
function cardM(h) { const s = h.scorecard; if (!s) return null; const v = s.white ?? s.blue ?? s.back ?? s.red; return v == null ? null : s.unit === 'yd' ? v * 0.9144 : v; }
function qaPrompt() {
  const h = hole(), name = h.nine ? `${h.nine} ${h.nineHole}번` : `${h.n}번`, Lm = cardM(h);
  qaBanner(`<b>⚡ ${name} 홀 (파 ${h.par}${Lm ? ` · 스코어카드 ${Math.round(Lm)}m` : ''})</b> — ${st.qa.step === 'green' ? '① <b>그린</b>을 누르세요 (빨간 후보 근처를 누르면 중심에 맞춰짐)' : '② <b>티</b>를 누르세요' + (Lm ? ' (노란 점선 원 = 그린에서 스코어카드 거리. 도그레그면 원보다 안쪽)' : '')}
    <span class="row" style="margin-top:6px;gap:6px"><button class="btn small" id="qaSkip">이 단계 건너뛰기</button><button class="btn small" id="qaUndo" ${st.qa.undo.length ? '' : 'disabled'}>↩ 되돌리기</button><button class="btn small" id="qaNext">다음 홀 ›</button></span>`);
  $('#qaSkip').onclick = () => qaAdvance();
  $('#qaUndo').onclick = qaUndo;
  $('#qaNext').onclick = () => { st.qa.step = 'green'; qaNextHole(); };
  qaDraw();
}
function qaDraw() {
  const lay = st.qaLayer; if (!lay) return; lay.clearLayers();
  for (const c of st.qa?.cands || []) {
    const used = st.course.holes.some(h => h.green && distance(h.green, c) < c.r + 3);
    L.circle([c.lat, c.lon], { radius: c.r, color: used ? '#7f8c8d' : c.score >= 0.6 ? '#ff2d55' : '#ffd400', weight: 2, fillOpacity: used ? 0.05 : 0.15, dashArray: used ? '3 4' : null, interactive: false }).addTo(lay);
  }
  const h = hole(), Lm = cardM(h);
  if (st.qa?.step === 'tee' && h.green && Lm) L.circle(ll(h.green), { radius: Lm, color: '#ffe27a', weight: 2, dashArray: '8 8', fill: false, interactive: false }).addTo(lay);
}
function qaClick(p) {
  const h = hole();
  st.qa.undo.push({ n: h.n, prev: JSON.parse(JSON.stringify(h)), step: st.qa.step });
  if (st.qa.step === 'green') {
    const c = (st.qa.cands || []).map(c => ({ c, d: distance(c, p) })).filter(x => x.d <= x.c.r + 10).sort((a, b) => a.d - b.d)[0]?.c;
    h.green = c ? { lat: c.lat, lon: c.lon } : p; h.greenR = c ? c.r : null;
    st.qa.step = 'tee';
    if (h.tee) setFrontBack(h);
  } else {
    h.tee = p; setFrontBack(h);
    st.qa.step = 'green'; persist(); return qaNextHole();
  }
  persist(); qaPrompt();
}
// 그린 반경(후보 크기 또는 14m)을 티→그린 축에 놓아 앞·뒤 지정
function setFrontBack(h) {
  if (!h.tee || !h.green) return;
  const ax = bearing(h.ip || h.tee, h.green), r = Math.max(7, Math.min(22, (h.greenR || 14) * 0.95));
  const f = destination(h.green, ax + 180, r), b = destination(h.green, ax, r);
  h.front = { lat: +f.lat.toFixed(7), lon: +f.lon.toFixed(7) }; h.back = { lat: +b.lat.toFixed(7), lon: +b.lon.toFixed(7) };
}
function qaAdvance() { if (st.qa.step === 'green') { st.qa.step = 'tee'; qaPrompt(); } else { st.qa.step = 'green'; qaNextHole(); } }
function qaNextHole() {
  const prev = hole(), i = st.course.holes.indexOf(prev);
  if (i >= st.course.holes.length - 1) { toast('마지막 홀까지 지정했습니다. 검증 결과를 확인하고 발행하세요', 5000); qaStop(); renderAll(); drawMap(); return; }
  st.holeN = st.course.holes[i + 1].n; st.fitted = true;
  renderChips(); renderPanel(); drawMap();
  if (prev.green) st.map.panTo(ll(prev.green));
  st.qa.step = hole().green ? 'tee' : 'green'; qaPrompt();
}
function qaUndo() {
  const u = st.qa.undo.pop(); if (!u) return;
  const i = st.course.holes.findIndex(h => h.n === u.n); st.course.holes[i] = u.prev;
  st.holeN = u.n; st.qa.step = u.step; persist(); renderChips(); renderPanel(); qaPrompt();
}

function renderAll() { renderHeader(); renderInfo(); renderChips(); renderTools(); renderPanel(); }

function showIssues(v) {
  sheet({
    title: `검증 결과 · 오류 ${v.errors.length} · 확인 ${v.warnings.length}`,
    body: !v.errors.length && !v.warnings.length ? '<p>문제가 없습니다. 발행할 수 있습니다.</p>'
      : `<ul class="issues">${[...v.errors.map(x => ({ ...x, k: 'e' })), ...v.warnings.map(x => ({ ...x, k: 'w' }))].map(x => `<li><span class="${x.k}">${x.k === 'e' ? '오류' : '확인'}</span><span>${x.hole ? `<a href="#" data-goh="${x.hole}">${x.hole}번 홀</a> · ` : ''}${esc(x.msg)}</span></li>`).join('')}</ul>`,
    actions: [{ label: '닫기' }],
    onMount(card, close) { $$('[data-goh]', card).forEach(a => a.onclick = e => { e.preventDefault(); st.holeN = +a.dataset.goh; close(); st.fitted = false; drawMap(); renderChips(); renderPanel(); }); },
  });
}

async function publish() {
  const v = M.validateCourse(st.course);
  if (!v.ok) return showIssues(v);
  const lines = M.diffCourse(st.remote, st.course);
  if (st.remote && !lines.length) return toast('발행본과 달라진 내용이 없습니다');
  if (!(await confirmPublish({ title: `코스 발행 · rev ${(st.remote?.rev || 0) + 1}`, lines, warnings: v.warnings }))) return;
  const res = await runPublish('코스', () => Store.publishCourse(st.course), {
    onConflict: async () => { const r = await Store.loadCourse(st.id, true); await Store.loadCatalog(true); st.remote = r.data; renderAll(); toast('원격 최신본 기준으로 다시 비교합니다. 변경 내용을 확인하고 다시 발행하세요', 4000); },
  });
  if (res) { st.remote = M.clone(Store.courses.get(st.id).data); st.course = M.clone(st.remote); st.dirty = false; renderAll(); drawMap(); }
}

function renderInfo() {
  const c = st.course;
  $('#info').innerHTML = `<details class="card" ${st.showInfo ? 'open' : ''} id="infoBox"><summary style="cursor:pointer;font-weight:700">코스 정보 · 로컬 룰 · 대피소 (${c.holes.length}홀, 파 ${c.holes.reduce((a, h) => a + h.par, 0)})</summary>
    <div class="formgrid" style="margin-top:8px">
      <label class="f"><span>코스 이름</span><input type="text" data-c="name" value="${esc(c.name)}"></label>
      <label class="f"><span>지역</span><input type="text" data-c="region" value="${esc(c.region || '')}" placeholder="예: 제주"></label>
      <label class="f"><span>주소</span><input type="text" data-c="address" value="${esc(c.address || '')}"></label>
      <label class="f"><span>대표 전화</span><input type="text" data-c="phone" value="${esc(c.phone || '')}"></label>
      <label class="f"><span>기본 그린 스피드 (스팀프)</span><input type="number" data-c="defaultStimp" step="0.5" min="6" max="15" value="${c.defaultStimp ?? 10}"></label>
    </div>
    <label class="f"><span>로컬 룰 (한 줄에 하나, 앱 룰 화면에 표시)</span><textarea data-c="localRules" rows="4" placeholder="예: 7번 홀 왼쪽 OB 말뚝 대신 특설 티(OB 티) 사용">${esc((c.localRules || []).join('\n'))}</textarea></label>
    <div class="row"><b class="grow">낙뢰 대피소 ${c.shelters?.length || 0}곳</b><span class="sub">지도 도구 '대피소'로 추가 · 마커를 끌어 이동</span></div>
    ${(c.shelters || []).map(s => `<div class="kv"><input type="text" data-shname="${esc(s.id)}" value="${esc(s.name)}" style="max-width:260px;min-height:36px"><span class="row" style="gap:6px"><span class="sub mono">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}</span><button class="btn small" data-shdel="${esc(s.id)}">삭제</button></span></div>`).join('')}
    <div class="row" style="margin-top:10px"><button class="btn small" id="addHole">＋ 홀 추가</button><button class="btn small" id="delHole" ${c.holes.length <= 1 ? 'disabled' : ''}>마지막 홀 삭제</button><span class="sub">홀 번호는 1부터 순서대로 유지됩니다</span></div>
  </details>`;
  $('#infoBox').ontoggle = e => { st.showInfo = e.target.open; };
  $$('[data-c]').forEach(i => i.onchange = () => {
    const k = i.dataset.c;
    c[k] = k === 'defaultStimp' ? +i.value : k === 'localRules' ? i.value.split('\n').map(s => s.trim()).filter(Boolean) : i.value.trim();
    persist(false);
  });
  $$('[data-shname]').forEach(i => i.onchange = () => { const s = c.shelters.find(x => x.id === i.dataset.shname); if (s) { s.name = i.value.trim() || s.name; persist(); } });
  $$('[data-shdel]').forEach(b => b.onclick = () => { c.shelters = c.shelters.filter(x => x.id !== b.dataset.shdel); persist(); renderInfo(); });
  $('#addHole').onclick = () => { c.holes.push({ n: c.holes.length + 1, par: 4, hdcp: null, hazards: [], halfWidth: 16, note: '' }); st.holeN = c.holes.length; persist(); renderInfo(); };
  $('#delHole').onclick = () => sheet({ title: '마지막 홀 삭제', body: `<p>${c.holes.length}번 홀과 그 위치·해저드·그린맵을 삭제할까요?</p>`, actions: [{ label: '취소' }, { label: '삭제', kind: 'danger', onClick: () => { c.holes.pop(); st.holeN = Math.min(st.holeN, c.holes.length); persist(); renderInfo(); } }] });
}

function holeState(v, n) {
  if (v.errors.some(e => e.hole === n)) return 'err';
  if (v.warnings.some(e => e.hole === n && !/그린맵이 없습니다/.test(e.msg))) return 'warn';
  return 'ok';
}
function renderChips() {
  const v = M.validateCourse(st.course);
  $('#chips').innerHTML = st.course.holes.map(h => `<button class="${h.n === st.holeN ? 'on' : ''}" data-h="${h.n}" title="${h.n}번 홀${h.nine ? ` (${h.nine} ${h.nineHole})` : ''} Par ${h.par}">${h.nine ? `<small style="font-weight:600">${esc(h.nine.slice(0, 2))}</small>${h.nineHole}` : h.n}<i class="${holeState(v, h.n)}"></i></button>`).join('');
  $$('#chips button').forEach(b => b.onclick = () => { st.holeN = +b.dataset.h; st.fitted = false; drawMap(); renderChips(); renderPanel(); renderTools(); });
}

const TOOL_LIST = () => [...POINTS.map(([k, n]) => [k, n]), ['teeset', `티 세트: ${M.TEE_SETS.find(t => t[0] === st.teeSet)[1]}`], ['hazard', '해저드'], ['shelter', '대피소'], ['erase', '지우기']];
function renderTools() {
  $('#tools').innerHTML = TOOL_LIST().map(([k, n]) => `<button class="btn ${st.tool === k ? 'on' : ''}" data-tool="${k}">${n}</button>`).join('')
    + (st.tool === 'teeset' ? `<span class="seg" style="display:inline-flex">${M.TEE_SETS.map(([k, n]) => `<button data-ts="${k}" class="${st.teeSet === k ? 'on' : ''}" style="min-height:34px;padding:0 10px">${n}</button>`).join('')}</span>` : '')
    + (st.tool === 'hazard' ? `<span class="seg" style="display:inline-flex">${Object.entries(HZ_STYLE).map(([k, v]) => `<button data-hz="${k}" class="${st.hzType === k ? 'on' : ''}" style="min-height:34px;padding:0 10px">${v.label.replace('(페널티 구역)', '')}</button>`).join('')}</span>
       <label class="row" style="gap:6px;font-size:13px">반경 <input type="range" id="hzR" min="3" max="80" value="${st.hzR}" style="width:120px"><b id="hzRv">${st.hzR}m</b></label>` : '');
  const help = { tee: '기본 티(앱 거리 기준)를 지도에서 탭', green: '그린 중앙을 탭 — 핀 시트·그린맵의 기준점', front: '그린 맨 앞 가장자리(티에서 보이는 쪽)를 탭', back: '그린 맨 뒤 가장자리를 탭', ip: '티샷 공략점(IP)을 탭 — 앱 티샷 전략에 사용', teeset: '선택한 색의 티 위치를 탭 (전장 계산·스코어카드용)', hazard: '해저드 중심을 탭 → 원 반경으로 표시. 기존 해저드는 가운데 점을 끌어 이동', shelter: '낙뢰 대피소 위치를 탭', erase: '지울 해저드·대피소·티 세트를 탭' };
  $('#toolHelp').textContent = st.tool ? help[st.tool] : '도구를 고른 뒤 지도를 탭하세요. 모든 마커는 끌어서 미세 조정할 수 있습니다.';
  $$('[data-tool]').forEach(b => b.onclick = () => { st.tool = st.tool === b.dataset.tool ? null : b.dataset.tool; renderTools(); });
  $$('[data-ts]').forEach(b => b.onclick = () => { st.teeSet = b.dataset.ts; renderTools(); });
  $$('[data-hz]').forEach(b => b.onclick = () => { st.hzType = b.dataset.hz; renderTools(); });
  $('#hzR')?.addEventListener('input', e => { st.hzR = +e.target.value; $('#hzRv').textContent = st.hzR + 'm'; });
}

function apply(p) {
  const h = hole(), c = st.course;
  if (!st.tool) return toast('먼저 위쪽 도구를 고르세요');
  if (POINTS.some(([k]) => k === st.tool)) h[st.tool] = p;
  else if (st.tool === 'teeset') { h.tees = { ...(h.tees || {}), [st.teeSet]: p }; if (!h.tee && st.teeSet === 'white') h.tee = p; }
  else if (st.tool === 'hazard') h.hazards.push({ id: uid(), type: st.hzType, lat: p.lat, lon: p.lon, r: st.hzR });
  else if (st.tool === 'shelter') { c.shelters = c.shelters || []; c.shelters.push({ id: uid(), name: `대피소 ${c.shelters.length + 1}`, ...p }); renderInfo(); }
  else if (st.tool === 'erase') {
    const hz = h.hazards.map(z => [z, distance(z, p)]).filter(([z, d]) => d <= Math.max(z.r, 6)).sort((a, b) => a[1] - b[1])[0];
    if (hz) h.hazards = h.hazards.filter(z => z !== hz[0]);
    else {
      const sh = (c.shelters || []).find(s => distance(s, p) < 12);
      const ts = Object.entries(h.tees || {}).find(([, q]) => distance(q, p) < 8);
      if (sh) { c.shelters = c.shelters.filter(s => s !== sh); renderInfo(); }
      else if (ts) { delete h.tees[ts[0]]; }
      else return toast('가까운 해저드·대피소·티 세트가 없습니다');
    }
  }
  persist();
}

const icon = (cls, text) => L.divIcon({ className: '', html: `<div class="a-mk ${cls}">${text}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
function drawMap() {
  if (!st?.map) return;
  const h = hole(), lay = st.layer; lay.clearLayers();
  // 다른 홀은 흐리게
  for (const o of st.course.holes) if (o !== h && o.tee && o.green) L.polyline([ll(o.tee), ll(o.green)], { color: '#fff', weight: 1, opacity: 0.35, dashArray: '4 6', interactive: false }).bindTooltip(String(o.n), { permanent: false }).addTo(lay);
  if (h.tee && h.green) L.polyline([ll(h.tee), ...(h.ip ? [ll(h.ip)] : []), ll(h.green)], { color: '#ffe27a', weight: 2, dashArray: '6 6', interactive: false }).addTo(lay);
  if (h.green) L.circle(ll(h.green), { radius: M.greenRadius(h), color: '#b8f5c8', weight: 1.5, fillOpacity: 0.1, interactive: false }).addTo(lay);
  if (h.green && h.tee && h.halfWidth && h.ip) L.circle(ll(h.ip), { radius: h.halfWidth, color: '#ffe27a', weight: 1, fillOpacity: 0.05, dashArray: '2 5', interactive: false }).addTo(lay);
  for (const z of h.hazards) {
    const s = HZ_STYLE[z.type] || HZ_STYLE.bunker;
    const circ = L.circle(ll(z), { radius: z.r, color: s.color, weight: 2, fillColor: s.fill, fillOpacity: z.type === 'ob' ? 0.06 : 0.3, dashArray: z.type === 'ob' ? '6 5' : null, interactive: false }).addTo(lay);
    const m = L.marker(ll(z), { icon: icon('hz', ''), draggable: true, title: `${s.label} 반경 ${z.r}m` }).addTo(lay);
    m.on('drag', e => circ.setLatLng(e.latlng));
    m.on('dragend', e => { const q = e.target.getLatLng(); z.lat = +q.lat.toFixed(7); z.lon = +q.lng.toFixed(7); persist(); });
  }
  for (const k of Object.keys(h.tees || {})) addPoint(h.tees, k, `t-${k}`, ({ black: 'BK', blue: 'BL', white: 'W', red: 'R' })[k] || 'T');
  for (const [k, , cls, t] of POINTS) if (h[k]) addPoint(h, k, cls, t);
  for (const s of st.course.shelters || []) addPoint(s, null, 'shelter', '⚡');
  fit(false);
  function addPoint(obj, key, cls, text) {
    const p = key ? obj[key] : obj;
    const m = L.marker(ll(p), { icon: icon(cls, text), draggable: true, title: key || obj.name, zIndexOffset: cls === 'green' ? 500 : 0 }).addTo(lay);
    m.on('dragend', e => { const q = e.target.getLatLng(), v = { lat: +q.lat.toFixed(7), lon: +q.lng.toFixed(7) }; if (key) obj[key] = v; else { obj.lat = v.lat; obj.lon = v.lon; } persist(); if (!key) renderInfo(); });
  }
}
function fit(force) {
  const h = hole();
  if (!st.map || (st.fitted && !force)) return;
  const pts = [h.tee, h.green, h.front, h.back, h.ip, ...Object.values(h.tees || {})].filter(Boolean).map(ll);
  if (pts.length >= 2) st.map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 19 });
  else if (pts.length === 1) st.map.setView(pts[0], 18);
  else return;
  st.fitted = true;
}

function renderPanel() {
  const h = hole(), c = st.course, v = M.validateCourse(c);
  const iss = [...v.errors.filter(x => x.hole === h.n).map(x => ({ ...x, k: 'e' })), ...v.warnings.filter(x => x.hole === h.n).map(x => ({ ...x, k: 'w' }))];
  const L_ = M.holeLength(h);
  const teeLens = Object.entries(h.tees || {}).filter(([, p]) => h.green).map(([k, p]) => `${M.TEE_SETS.find(t => t[0] === k)?.[1] || k} ${Math.round(distance(p, h.green))}m`);
  const coordRow = (label, key, obj = h) => `<tr><td>${label}</td><td><input class="sm mono" style="width:112px" data-lat="${key}" value="${obj[key] ? obj[key].lat : ''}" placeholder="위도"></td><td><input class="sm mono" style="width:112px" data-lon="${key}" value="${obj[key] ? obj[key].lon : ''}" placeholder="경도"></td><td>${obj[key] ? `<button class="btn small" data-clr="${key}">✕</button>` : ''}</td></tr>`;
  $('#panel').innerHTML = `<div class="card">
    <div class="row"><h3 class="grow" style="margin:0">${h.n}번 홀</h3><span class="sub">${L_ ? `기본 티 ${Math.round(L_)}m` : '티·그린 미지정'}</span></div>
    ${teeLens.length ? `<p class="sub" style="margin:4px 0 0">${teeLens.join(' · ')}</p>` : ''}
    ${h.nine ? `<p class="sub" style="margin:4px 0 0">${esc(h.nine)} 코스 ${h.nineHole}번 홀</p>` : ''}
    ${h.scorecard ? `<div class="note" style="margin:8px 0 0"><b>스코어카드</b> (${h.scorecard.unit}) · 백 ${h.scorecard.back ?? '—'} · 블루 ${h.scorecard.blue ?? '—'} · 화이트 ${h.scorecard.white ?? '—'} · 레드 ${h.scorecard.red ?? '—'}${h.hdcpCard != null ? ` · 카드 핸디캡 ${h.hdcpCard}` : ''}${L_ ? `<br>지도 경로(티→${h.ip ? 'IP→' : ''}그린) ${Math.round(h.ip ? distance(h.tee, h.ip) + distance(h.ip, h.green) : L_)}m` : ''}</div>` : ''}
    <div class="formgrid" style="margin-top:6px">
      <label class="f"><span>Par</span><select id="par">${[3, 4, 5, 6].map(p => `<option ${p === h.par ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label class="f"><span>핸디캡 순위</span><input type="number" id="hdcp" min="1" max="${c.holes.length}" value="${h.hdcp ?? ''}" placeholder="1=가장 어려움"></label>
      <label class="f"><span>페어웨이 반폭 (m)</span><input type="number" id="hw" min="5" max="60" value="${h.halfWidth ?? 16}"></label>
    </div>
    <label class="f"><span>공략 메모 (앱 티샷 화면에 표시)</span><textarea id="note" rows="2" placeholder="예: 왼쪽 벙커 넘기기 캐리 210m, 오른쪽이 안전">${esc(h.note || '')}</textarea></label>
    <h3>좌표 <span class="sub" style="font-weight:400">· 측량값이 있으면 직접 입력</span></h3>
    <div class="tblbox"><table class="a-tbl"><thead><tr><th>지점</th><th>위도</th><th>경도</th><th></th></tr></thead><tbody>
      ${POINTS.map(([k, n]) => coordRow(n, k)).join('')}
    </tbody></table></div>
    <h3>해저드 ${h.hazards.length}개</h3>
    ${h.hazards.length ? `<div class="tblbox"><table class="a-tbl"><thead><tr><th>종류</th><th>반경</th><th>티에서</th><th></th></tr></thead><tbody>${h.hazards.map(z => `<tr><td><select class="sm" style="width:auto" data-hzt="${z.id}">${Object.entries(HZ_STYLE).map(([k, s]) => `<option value="${k}" ${k === z.type ? 'selected' : ''}>${s.label}</option>`).join('')}</select></td>
      <td><input type="number" class="sm" data-hzr="${z.id}" value="${z.r}" min="2" max="200">m</td><td class="num">${h.tee ? Math.round(distance(h.tee, z)) + 'm' : '—'}</td><td><button class="btn small" data-hzd="${z.id}">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">지도 도구 [해저드]로 추가하세요.</p>'}
    <h3>검증 ${iss.length ? '' : '<span class="badge">문제 없음</span>'}</h3>
    ${iss.length ? `<ul class="issues">${iss.map(x => `<li><span class="${x.k}">${x.k === 'e' ? '오류' : '확인'}</span><span>${esc(x.msg)}</span></li>`).join('')}</ul>` : ''}
    <div class="row" style="margin-top:12px"><button class="btn" id="prevH">‹ ${h.n > 1 ? h.n - 1 + '번' : ''}</button><span class="grow"></span><button class="btn primary" id="nextH">${h.n < c.holes.length ? h.n + 1 + '번 홀 ›' : '완료'}</button></div>
  </div>`;
  $('#par').onchange = e => { h.par = +e.target.value; persist(false); };
  $('#hdcp').onchange = e => { h.hdcp = e.target.value === '' ? null : +e.target.value; persist(false); };
  $('#hw').onchange = e => { h.halfWidth = Math.max(5, Math.min(60, +e.target.value || 16)); persist(); };
  $('#note').onchange = e => { h.note = e.target.value.trim(); persist(false); };
  $$('[data-lat],[data-lon]').forEach(i => i.onchange = () => {
    const k = i.dataset.lat || i.dataset.lon, lat = +$(`[data-lat="${k}"]`).value, lon = +$(`[data-lon="${k}"]`).value;
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && lat && lon)) return toast('위도·경도를 모두 숫자로 입력하세요');
    h[k] = { lat, lon }; st.fitted = false; persist();
  });
  $$('[data-clr]').forEach(b => b.onclick = () => { delete h[b.dataset.clr]; persist(); });
  $$('[data-hzt]').forEach(s => s.onchange = () => { h.hazards.find(z => z.id === s.dataset.hzt).type = s.value; persist(); });
  $$('[data-hzr]').forEach(s => s.onchange = () => { h.hazards.find(z => z.id === s.dataset.hzr).r = Math.max(2, Math.min(200, +s.value || 10)); persist(); });
  $$('[data-hzd]').forEach(b => b.onclick = () => { h.hazards = h.hazards.filter(z => z.id !== b.dataset.hzd); persist(); });
  $('#prevH').onclick = () => { if (h.n > 1) { st.holeN = h.n - 1; st.fitted = false; drawMap(); renderChips(); renderPanel(); } };
  $('#nextH').onclick = () => { if (h.n < c.holes.length) { st.holeN = h.n + 1; st.fitted = false; drawMap(); renderChips(); renderPanel(); } else showIssues(M.validateCourse(c)); };
}
