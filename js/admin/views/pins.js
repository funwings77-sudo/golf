// 오늘의 핀: 핀 시트 방식(앞에서 m · 중앙선 좌우 m) 입력 / 지도 드래그 / 자동 로테이션 / 인쇄 / 발행
import { $, $$, esc, toast, confirmSheet } from '../../ui.js';
import { createMap, destroyMap, ll } from '../../map.js';
import { rng } from '../../core/geo.js';
import { Store } from '../store.js';
import * as M from '../model.js';
import { go } from '../main.js';
import { ago, confirmPublish, runPublish, readonlyNote, courseSelect, remember } from '../common.js';

let st = null, el_ = null;
export default {
  dirty: () => !!st?.dirty,
  async mount(el, [id]) {
    el_ = el;
    const cat = await Store.loadCatalog();
    if (!cat.courses.length) { el.innerHTML = `<h1>📍 오늘의 핀</h1><div class="card empty-card">발행된 코스가 없습니다. 먼저 <a href="#/courses">코스를 발행</a>하세요.</div>`; return; }
    id = id || remember('pinsCourse') || cat.courses[0].id;
    if (!cat.courses.some(c => c.id === id)) id = cat.courses[0].id;
    remember('pinsCourse', id);
    const [{ data: course }, pins] = await Promise.all([Store.loadCourse(id), Store.loadPins(id, true)]);
    if (!course) { el.innerHTML = '<div class="card">코스 파일을 불러오지 못했습니다.</div>'; return; }
    // 그린 위치가 없는 홀(스코어카드만 있는 DB 코스)은 핀을 놓을 수 없음 → 목록에서 빼고 알려 줌 (예전엔 화면이 오류로 멈춤)
    const hasG = h => Number.isFinite(h.green?.lat) && Number.isFinite(h.green?.lon);
    const noGreen = course.holes.filter(h => !hasG(h)), usable = { ...course, holes: course.holes.filter(hasG) };
    if (!usable.holes.length) {
      el.innerHTML = `<div class="a-head"><div class="grow"><h1>📍 오늘의 핀</h1><div class="statusline">${courseSelect(cat.courses, id)}</div></div></div>
        <div class="card empty-card"><b>${esc(course.name)}에는 그린 위치가 없어 핀을 넣을 수 없습니다.</b><br><span class="sub">핀은 '그린 앞에서 m · 좌우 m'로 그린 위치를 기준으로 계산합니다. 코스 편집에서 그린 중앙(가능하면 앞·뒤도)을 지정해 발행한 뒤 다시 오세요. 그 전까지 골퍼 앱은 사용자가 직접 그린을 눌러 거리를 잽니다.</span><br>
        <a class="btn primary" href="#/course/${encodeURIComponent(id)}" style="margin-top:10px">🗺️ 코스 편집에서 그린 지정</a> <a class="btn" href="#/ready/${encodeURIComponent(id)}" style="margin-top:10px">📱 앱 준비도 보기</a></div>`;
      $('#courseSel').onchange = e => go('pins/' + encodeURIComponent(e.target.value));
      return;
    }
    st = { id, cat, course: usable, noGreen, remote: pins.data, date: M.todayKey(), stimp: course.defaultStimp ?? 10, note: '', holes: {}, sel: usable.holes[0].n, dirty: false, map: null, layer: null };
    loadFrom(pins.data, pins.data?.date === st.date);
    render();
  },
  unmount() { destroyMap(st?.map); st = null; },
};

function loadFrom(p, sameDay) {
  st.holes = {};
  for (const h of st.course.holes) {
    const src = p?.holes?.[h.n];
    if (src && Number.isFinite(src.lat)) { const o = M.offsetsFromPin(h, src); st.holes[h.n] = { depth: +o.depth.toFixed(1), side: +o.side.toFixed(1) }; }
    else st.holes[h.n] = { depth: +(M.greenDepth(h) / 2).toFixed(1), side: 0 };
  }
  if (sameDay) { st.stimp = p.stimp ?? st.stimp; st.note = p.note || ''; }
  st.dirty = !sameDay;
}
const H = n => st.course.holes.find(h => h.n === n);
const pinOf = n => M.pinFromOffsets(H(n), st.holes[n]);

function render() {
  const r = st.remote, today = M.todayKey();
  el_.innerHTML = `<div class="a-head no-print"><div class="grow"><h1>📍 오늘의 핀</h1>
      <div class="statusline">${courseSelect(st.cat.courses, st.id)}
        ${r ? `<span class="badge ${r.date === today ? '' : 'warn'}">마지막 발행 ${esc(r.date)} · ${ago(r.updatedAt)}</span>` : '<span class="badge mute">발행 기록 없음</span>'}
        ${st.dirty ? '<span class="badge warn" data-dirty>● 발행 안 된 변경</span>' : ''}</div></div>
    <div class="a-actions"><button class="btn" id="center">모두 중앙</button><button class="btn" id="rotate">🎲 자동 로테이션</button>${r && r.date !== st.date ? '<button class="btn" id="prev">이전 핀 불러오기</button>' : ''}<button class="btn" id="print">🖨️ 핀 시트 인쇄</button><button class="btn primary" id="pub">🚀 발행</button></div></div>
    <div class="no-print">${readonlyNote()}</div>
    ${st.noGreen.length ? `<div class="note no-print">그린 위치가 없는 ${st.noGreen.length}개 홀(${st.noGreen.slice(0, 8).map(h => h.n + '번').join(', ')}${st.noGreen.length > 8 ? ' …' : ''})은 핀을 넣을 수 없어 빼고 보여 줍니다. <a href="#/course/${encodeURIComponent(st.id)}">코스 편집에서 그린 지정 →</a></div>` : ''}
    <div class="card tight no-print"><div class="formgrid">
      <label class="f"><span>적용 날짜</span><input type="date" id="date" value="${st.date}"></label>
      <label class="f"><span>오늘 그린 스피드 (스팀프)</span><input type="number" id="stimp" min="6" max="15" step="0.5" value="${st.stimp}"></label>
      <label class="f" style="grid-column:span 2"><span>메모 (앱에 표시, 선택)</span><input type="text" id="note" maxlength="80" value="${esc(st.note)}" placeholder="예: 오전 9시 컷 · 에어레이션 후 2주차"></label>
    </div><p class="sub" style="margin:0">앱은 '적용 날짜'가 오늘인 핀만 사용합니다(지난 핀은 무시). 표기: <b>앞에서</b> = 그린 앞 가장자리에서 깃대까지 m, <b>좌우</b> = 그린 중심선 기준 오른쪽 +, 왼쪽 − (티에서 그린을 바라볼 때).</p></div>
    <div class="split no-print" style="margin-top:12px">
      <div class="tblbox tall"><table class="a-tbl" id="ptbl"><thead><tr><th>홀</th><th class="num">Par</th><th class="num">그린 깊이</th><th>앞에서 (m)</th><th>좌− / 우+ (m)</th><th>상태</th></tr></thead><tbody></tbody></table></div>
      <div class="sticky"><div class="card tight"><div class="row"><b class="grow" id="mapTitle"></b><span class="sub">핀을 끌어 이동</span></div>
        <div class="a-map short" style="margin-top:8px"><div class="map" id="pmap"></div></div>
        <div class="row" style="margin-top:8px"><button class="btn small" id="mPrev">‹ 이전 홀</button><span class="grow"></span><button class="btn small" id="mNext">다음 홀 ›</button></div></div></div>
    </div>
    <div class="print-only" id="printArea"></div>`;
  renderTable();
  st.map = createMap($('#pmap'), { center: ll(H(st.sel).green), zoom: 19, me: false });
  if (st.map) { st.layer = L.layerGroup().addTo(st.map); drawMap(); }
  $('#courseSel').onchange = async e => {
    const to = e.target.value;
    if (st.dirty && !(await confirmSheet('발행 안 된 변경', '이 코스의 핀 변경을 발행하지 않고 다른 코스로 이동할까요?', '이동', 'danger'))) { e.target.value = st.id; return; }
    st.dirty = false; go('pins/' + encodeURIComponent(to));
  };
  $('#date').onchange = e => { st.date = e.target.value || M.todayKey(); st.dirty = true; render(); };
  $('#stimp').onchange = e => { st.stimp = Math.max(6, Math.min(15, +e.target.value || 10)); st.dirty = true; renderHead(); };
  $('#note').onchange = e => { st.note = e.target.value.trim(); st.dirty = true; renderHead(); };
  $('#center').onclick = () => { for (const h of st.course.holes) st.holes[h.n] = { depth: +(M.greenDepth(h) / 2).toFixed(1), side: 0 }; st.dirty = true; renderTable(); drawMap(); renderHead(); };
  $('#rotate').onclick = () => { rotate(); st.dirty = true; renderTable(); drawMap(); renderHead(); toast('앞·중간·뒤와 좌·우를 고르게 섞었습니다. 홀별로 확인 후 조정하세요'); };
  $('#prev')?.addEventListener('click', () => { loadFrom(st.remote, false); renderTable(); drawMap(); renderHead(); toast(`${st.remote.date} 핀을 불러왔습니다`); });
  $('#print').onclick = printSheet;
  $('#pub').onclick = publish;
  const stepH = d => { const hs = st.course.holes, i = hs.findIndex(h => h.n === st.sel); select(hs[(i + d + hs.length) % hs.length].n); }; // 홀 번호가 띄엄띄엄이어도 순서대로
  $('#mPrev').onclick = () => stepH(-1);
  $('#mNext').onclick = () => stepH(1);
}
function renderHead() {
  const b = $('.statusline'); if (!b) return;
  b.querySelector('[data-dirty]')?.remove();
  if (st.dirty) b.insertAdjacentHTML('beforeend', '<span class="badge warn" data-dirty>● 발행 안 된 변경</span>');
}

function statusCell(n) {
  const c = M.checkPin(H(n), pinOf(n));
  return `<span class="badge ${!c.ok ? 'err' : c.warn ? 'warn' : ''}">${!c.ok ? '✕ ' : c.warn ? '⚠ ' : '✓ '}${esc(c.msg)}</span>`;
}
function renderTable() {
  $('#ptbl tbody').innerHTML = st.course.holes.map(h => {
    const p = st.holes[h.n], D = M.greenDepth(h);
    return `<tr class="${h.n === st.sel ? 'sel' : ''}" data-row="${h.n}"><td><b>${h.n}</b></td><td class="num">${h.par}</td><td class="num">${D.toFixed(0)}m</td>
      <td><input type="number" class="sm" step="0.5" min="0" max="${Math.ceil(D)}" data-depth="${h.n}" value="${p.depth}"></td>
      <td><input type="number" class="sm" step="0.5" min="-25" max="25" data-side="${h.n}" value="${p.side}"></td>
      <td data-status="${h.n}">${statusCell(h.n)}</td></tr>`;
  }).join('');
  $$('#ptbl input').forEach(i => {
    i.onfocus = () => select(+(i.dataset.depth || i.dataset.side), false);
    i.onchange = () => {
      const n = +(i.dataset.depth || i.dataset.side), k = i.dataset.depth ? 'depth' : 'side';
      st.holes[n][k] = Math.round((+i.value || 0) * 10) / 10; st.dirty = true;
      $(`[data-status="${n}"]`).innerHTML = statusCell(n); drawMap(); renderHead();
    };
  });
  $$('#ptbl tr[data-row]').forEach(tr => tr.onclick = e => { if (e.target.tagName !== 'INPUT') select(+tr.dataset.row); });
}
function select(n, scroll = true) {
  st.sel = n;
  $$('#ptbl tr[data-row]').forEach(tr => tr.classList.toggle('sel', +tr.dataset.row === n));
  if (scroll) $(`#ptbl tr[data-row="${n}"]`)?.scrollIntoView({ block: 'nearest' });
  drawMap(true);
}
function drawMap(recenter = true) {
  if (!st?.map) return;
  const h = H(st.sel), lay = st.layer; lay.clearLayers();
  $('#mapTitle').textContent = `${h.n}번 홀 · Par ${h.par} · 앞에서 ${st.holes[h.n].depth}m · ${st.holes[h.n].side > 0 ? '오른쪽 ' + st.holes[h.n].side : st.holes[h.n].side < 0 ? '왼쪽 ' + -st.holes[h.n].side : '중앙'}${st.holes[h.n].side ? 'm' : ''}`;
  L.circle(ll(h.green), { radius: M.greenDepth(h) / 2, color: '#b8f5c8', weight: 2, fillOpacity: 0.08, interactive: false }).addTo(lay);
  const f = M.greenFront(h), b = h.back || M.pinFromOffsets(h, { depth: M.greenDepth(h), side: 0 });
  L.polyline([ll(f), ll(b)], { color: '#fff', weight: 1, dashArray: '3 5', interactive: false }).addTo(lay);
  L.marker(ll(f), { icon: L.divIcon({ className: '', html: '<div class="a-mk front">F</div>', iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false }).addTo(lay);
  if (h.tee) L.polyline([ll(h.tee), ll(h.green)], { color: '#ffe27a', weight: 1.5, opacity: 0.6, dashArray: '6 6', interactive: false }).addTo(lay);
  const pin = pinOf(h.n);
  const m = L.marker(ll(pin), { icon: L.divIcon({ className: '', html: '<div class="a-mk pin">⛳</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), draggable: true, zIndexOffset: 1000 }).addTo(lay);
  m.on('dragend', e => {
    const q = e.target.getLatLng(), o = M.offsetsFromPin(h, { lat: q.lat, lon: q.lng });
    st.holes[h.n] = { depth: Math.round(o.depth * 2) / 2, side: Math.round(o.side * 2) / 2 }; st.dirty = true;
    $(`[data-depth="${h.n}"]`).value = st.holes[h.n].depth; $(`[data-side="${h.n}"]`).value = st.holes[h.n].side;
    $(`[data-status="${h.n}"]`).innerHTML = statusCell(h.n); drawMap(false); renderHead();
  });
  if (recenter) st.map.setView(ll(h.green), 19);
}

// 핀 로테이션: 앞·중·뒤 균형, 좌·중·우 균형, 연속 홀 같은 구역 회피, 가장자리 4m 이상
function rotate() {
  const holes = st.course.holes, n = holes.length, R = rng(Date.parse(st.date) / 86400000 | 0);
  const zones = Array.from({ length: n }, (_, i) => i % 3), sides = Array.from({ length: n }, (_, i) => (i % 3) - 1);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  shuffle(zones); shuffle(sides);
  for (let i = 1; i < n; i++) if (zones[i] === zones[i - 1]) { const j = zones.findIndex((z, k) => k > i && z !== zones[i - 1]); if (j > 0) [zones[i], zones[j]] = [zones[j], zones[i]]; }
  holes.forEach((h, i) => {
    const D = M.greenDepth(h), depth = D * [0.3, 0.5, 0.7][zones[i]];
    let side = sides[i] * Math.min(5, D * 0.18);
    for (let k = 0; k < 6; k++) { const c = M.checkPin(h, M.pinFromOffsets(h, { depth, side })); if (c.ok && c.edge >= 4) break; side *= 0.6; }
    st.holes[h.n] = { depth: Math.round(depth * 2) / 2, side: Math.round(side * 2) / 2 };
  });
}

async function publish() {
  const bad = st.course.holes.filter(h => !M.checkPin(h, pinOf(h.n)).ok);
  if (bad.length) return toast(`그린 밖 핀: ${bad.map(h => h.n + '번').join(', ')} — 위치를 고치세요`, 4000);
  const warn = st.course.holes.map(h => ({ hole: h.n, c: M.checkPin(h, pinOf(h.n)) })).filter(x => x.c.warn).map(x => ({ hole: x.hole, msg: x.c.msg }));
  const lines = [`${st.course.name} · 적용 날짜 ${st.date}${st.date !== M.todayKey() ? ' (오늘 아님)' : ''}`, `그린 스피드 스팀프 ${st.stimp}`, ...(st.note ? [`메모: ${st.note}`] : []), ...st.course.holes.map(h => `${h.n}번: 앞에서 ${st.holes[h.n].depth}m, ${st.holes[h.n].side > 0 ? '오른쪽 ' + st.holes[h.n].side + 'm' : st.holes[h.n].side < 0 ? '왼쪽 ' + -st.holes[h.n].side + 'm' : '중앙'}`)];
  if (!(await confirmPublish({ title: '오늘의 핀 발행', lines, warnings: warn }))) return;
  const holes = {};
  for (const h of st.course.holes) holes[h.n] = { ...pinOf(h.n), depth: st.holes[h.n].depth, side: st.holes[h.n].side };
  const data = M.pinsFile({ courseId: st.id, date: st.date, stimp: st.stimp, note: st.note, holes });
  const res = await runPublish('오늘의 핀', () => Store.publishPins(st.id, data), { onConflict: async () => { st.remote = (await Store.loadPins(st.id, true)).data; render(); } });
  if (res) { st.remote = data; st.dirty = false; render(); }
}

function printSheet() {
  const svg = h => {
    const D = M.greenDepth(h), R = D / 2, p = st.holes[h.n], cx = 50 + p.side / R * 40, cy = 90 - p.depth / D * 80;
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40" fill="#e4f0e8" stroke="#2f8a5b" stroke-width="1.5"/><line x1="50" y1="10" x2="50" y2="90" stroke="#999" stroke-dasharray="2 3"/><text x="50" y="99" text-anchor="middle" font-size="8" fill="#666">앞</text><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" fill="#d93b2b" stroke="#fff"/></svg>`;
  };
  $('#printArea').innerHTML = `<h1>${esc(st.course.name)} 핀 시트</h1><p>${esc(st.date)} · 그린 스피드 스팀프 ${st.stimp}${st.note ? ' · ' + esc(st.note) : ''}</p>
    <div class="pinsheet">${st.course.holes.map(h => `<div class="ps"><b>${h.n}번</b> · Par ${h.par}${svg(h)}<div>앞에서 <b>${st.holes[h.n].depth}</b>m</div><div>${st.holes[h.n].side > 0 ? '오른쪽 ' + st.holes[h.n].side + 'm' : st.holes[h.n].side < 0 ? '왼쪽 ' + -st.holes[h.n].side + 'm' : '중앙'}</div></div>`).join('')}</div>`;
  window.print();
}
