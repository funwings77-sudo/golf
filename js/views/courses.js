// 코스 관리 · 편집 (위성지도에 티/그린/핀/IP/해저드/대피소 지정) · 가져오기/내보내기 · 오프라인 지도 저장
import { S, save, uid } from '../core/state.js';
import { blankCourse, demoCourse, exportCourse, importCourse, holeLength } from '../core/course.js';
import { Sensors, sampleFix } from '../core/sensors.js';
import { createMap, destroyMap, drawHole, fitHole, ll, HZ_STYLE, SAT_URL } from '../map.js';
import { $, $$, esc, toast, sheet, confirmSheet, DU } from '../ui.js';

let el_, App_, map, layer, editId = null, holeN = 1, tool = null, hzType = 'bunker', hzR = 12;
const TOOLS = [['tee', '티'], ['green', '그린 중앙'], ['front', '그린 앞'], ['back', '그린 뒤'], ['pin', '핀'], ['ip', 'IP(공략점)'], ['hazard', '해저드'], ['shelter', '대피소'], ['erase', '지우기']];

export default {
  mount(el, App) { el_ = el; App_ = App; editId ? editor() : list(); },
  unmount() { destroyMap(map); map = null; },
};

function list() {
  destroyMap(map); map = null;
  el_.innerHTML = `<h2>🗺️ 코스 관리</h2>
    ${S.courses.map(c => `<div class="card tight"><div class="row"><div class="grow"><b>${esc(c.name)}</b>${c.id === S.ui.courseId ? ' <span class="pill">선택됨</span>' : ''}<br><span class="sub">${c.holes.length}홀 · 지정 완료 ${c.holes.filter(h => h.tee && h.green).length}홀${c.demo ? ' · 가상 데모' : ''}</span></div>
      <button class="btn small" data-sel="${c.id}">선택</button><button class="btn small" data-edit="${c.id}">편집</button><button class="btn small" data-more="${c.id}">⋯</button></div></div>`).join('') || '<div class="empty">코스가 없습니다</div>'}
    <div class="grid2"><button class="btn primary" id="new">＋ 새 코스</button><button class="btn" id="demo">🧪 데모 코스</button></div>
    <button class="btn block" id="imp" style="margin-top:8px">📥 코스 파일 가져오기 (JSON)</button><input type="file" id="impFile" accept=".json,application/json" hidden>
    <div class="card"><b>코스 데이터 안내</b><p class="sub">실제 골프장 데이터(홀 지오메트리·cm급 그린맵·실시간 핀)는 골프장 제휴로 공급되는 구조입니다. 지금은 위성지도에서 직접 지정하거나, 동반자가 만든 코스 파일을 가져올 수 있습니다. 핀 위치를 기록해 내보내면 다음 팀과 공유됩니다.</p></div>`;
  $$('[data-sel]').forEach(b => b.onclick = () => { S.ui.courseId = b.dataset.sel; S.ui.hole = 1; save('ui'); App_.refreshHeader(); list(); toast('코스를 선택했습니다'); });
  $$('[data-edit]').forEach(b => b.onclick = () => { editId = b.dataset.edit; holeN = 1; editor(); });
  $$('[data-more]').forEach(b => b.onclick = () => more(S.courses.find(c => c.id === b.dataset.more)));
  $('#new').onclick = () => sheet({
    title: '새 코스', body: `<label class="f"><span>이름</span><input type="text" id="cn" value="새 코스"></label><label class="f"><span>홀 수</span><select id="ch"><option>18</option><option>9</option></select></label>`,
    actions: [{ label: '취소' }, { label: '만들기', kind: 'primary', onClick: card => { const c = blankCourse($('#cn', card).value.trim() || '새 코스', +$('#ch', card).value); S.courses.push(c); S.ui.courseId = c.id; save('courses', 'ui'); editId = c.id; holeN = 1; App_.refreshHeader(); editor(); } }],
  });
  $('#demo').onclick = () => { const base = Sensors.pos ? { lat: Sensors.pos.lat + 0.0006, lon: Sensors.pos.lon } : undefined; const c = demoCourse(base); S.courses.push(c); S.ui.courseId = c.id; S.ui.hole = 1; save('courses', 'ui'); App_.refreshHeader(); list(); toast('데모 코스 생성'); };
  $('#imp').onclick = () => $('#impFile').click();
  $('#impFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const c = importCourse(await f.text()); S.courses.push(c); save('courses'); toast(`'${c.name}' 가져오기 완료`); list(); } catch (err) { toast('가져오기 실패: ' + err.message); }
  };
}

function more(c) {
  sheet({
    title: c.name, body: '<p class="sub">코스 파일에는 홀 위치·해저드·핀 기록이 포함됩니다. 개인 위치 기록은 포함되지 않습니다.</p>',
    actions: [
      { label: '📤 내보내기', onClick: async () => { const txt = exportCourse(c), name = c.name.replace(/[^\w가-힣-]+/g, '_') + '.json'; try { const file = new File([txt], name, { type: 'application/json' }); if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: c.name }); return; } } catch {} const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); } },
      { label: '🗺️ 지도 오프라인 저장', onClick: () => { prefetchTiles(c); } },
      { label: '삭제', kind: 'danger', onClick: async () => { if (S.round?.courseId === c.id) { toast('진행 중 라운드의 코스는 삭제할 수 없습니다'); return; } if (!(await confirmSheet('코스 삭제', `'${c.name}'을(를) 삭제할까요? 되돌릴 수 없습니다.`, '삭제', 'danger'))) return; S.courses = S.courses.filter(x => x.id !== c.id); if (S.ui.courseId === c.id) S.ui.courseId = null; save('courses', 'ui'); App_.refreshHeader(); list(); } },
    ],
  });
}

// 산간 골프장 통신 음영 대비: 코스 범위 z15~18 위성 타일을 미리 받아 서비스 워커 캐시에 저장
async function prefetchTiles(c) {
  const pts = c.holes.flatMap(h => [h.tee, h.green, h.front, h.back].filter(Boolean));
  if (!pts.length) return toast('지정된 홀이 없습니다');
  const lat0 = Math.min(...pts.map(p => p.lat)) - 0.002, lat1 = Math.max(...pts.map(p => p.lat)) + 0.002;
  const lon0 = Math.min(...pts.map(p => p.lon)) - 0.002, lon1 = Math.max(...pts.map(p => p.lon)) + 0.002;
  const t = (lat, lon, z) => { const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); return [x, y]; };
  const urls = [];
  for (let z = 15; z <= 18; z++) { const [x0, y1] = t(lat0, lon0, z), [x1, y0] = t(lat1, lon1, z); for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) urls.push(SAT_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y)); }
  if (urls.length > 1500) return toast(`타일이 너무 많습니다 (${urls.length})`);
  if (!(await confirmSheet('오프라인 지도', `위성 타일 ${urls.length}개(약 ${Math.round(urls.length * 0.025)}MB)를 저장할까요?`, '저장'))) return;
  let done = 0;
  for (let i = 0; i < urls.length; i += 6) { await Promise.all(urls.slice(i, i + 6).map(u => fetch(u, { mode: 'no-cors' }).then(() => done++).catch(() => {}))); if (i % 60 === 0) toast(`저장 중 ${done}/${urls.length}`); }
  toast(`오프라인 지도 저장 완료 (${done}개)`);
}

function editor() {
  const c = S.courses.find(x => x.id === editId); if (!c) { editId = null; return list(); }
  const h = c.holes.find(x => x.n === holeN) || c.holes[0];
  el_.innerHTML = `<div class="row" style="margin-bottom:6px"><button class="btn small" id="back">‹ 목록</button><b class="grow" style="text-align:center">${esc(c.name)}</b><button class="btn small" id="rename">이름</button></div>
    <div class="row"><button class="btn small" id="hp">‹</button><b class="grow" style="text-align:center">${h.n}번 홀 · Par <select id="par" style="width:70px;min-height:36px;display:inline-block">${[3, 4, 5, 6].map(p => `<option ${p === h.par ? 'selected' : ''}>${p}</option>`).join('')}</select> ${holeLength(h) ? '· ' + DU(holeLength(h)) : ''}</b><button class="btn small" id="hn">›</button></div>
    <div class="mapwrap half" style="margin-top:8px;border-radius:14px;overflow:hidden;height:50vh"><div class="map" id="map"></div></div>
    <div class="row" style="margin-top:8px;gap:6px">${TOOLS.map(([k, n]) => `<button class="btn small ${tool === k ? 'on' : ''}" data-tool="${k}">${n}</button>`).join('')}</div>
    ${tool === 'hazard' ? `<div class="card tight"><div class="seg" id="hzSeg">${Object.entries(HZ_STYLE).map(([k, v]) => `<button data-v="${k}" class="${hzType === k ? 'on' : ''}">${v.label.replace('(페널티 구역)', '')}</button>`).join('')}</div>
      <label class="f"><span>반경 ${hzR}m</span><input type="range" id="hzR" min="4" max="60" value="${hzR}"></label></div>` : ''}
    <p class="sub">${tool ? (tool === 'erase' ? '지울 해저드·대피소를 탭하세요.' : '지도를 탭해 위치를 지정하거나 [내 위치로]를 누르세요.') : '도구를 고른 뒤 지도를 탭하세요.'}</p>
    ${tool && tool !== 'erase' ? '<button class="btn block" id="here">📍 내 위치로 지정 (3초 평균)</button>' : ''}
    <div class="card tight"><b>해저드 ${h.hazards.length}개</b>${h.hazards.map(z => `<div class="kv"><span>${HZ_STYLE[z.type]?.label} · 반경 ${z.r}m</span><button class="btn small" data-delhz="${z.id}">삭제</button></div>`).join('')}
      <label class="f"><span>페어웨이 반폭 ${h.halfWidth || 16}m (전략 계산용)</span><input type="range" id="hw" min="8" max="35" value="${h.halfWidth || 16}"></label></div>`;
  destroyMap(map);
  map = createMap($('#map'), { center: ll(h.green || h.tee || Sensors.pos || { lat: 37.5, lon: 127 }), zoom: h.tee ? 17 : 16 });
  if (map) {
    layer = drawHole(map, h);
    for (const s of c.shelters) L.marker(ll(s), { title: s.name }).bindTooltip('대피소: ' + s.name).addTo(layer);
    if (h.tee && h.green) fitHole(map, h);
    map.on('click', e => apply({ lat: e.latlng.lat, lon: e.latlng.lng }));
  }
  const persist = () => { save('courses'); editor(); };
  function apply(p) {
    if (!tool) return toast('먼저 도구를 고르세요');
    if (tool === 'hazard') h.hazards.push({ id: uid(), type: hzType, lat: p.lat, lon: p.lon, r: hzR });
    else if (tool === 'shelter') c.shelters.push({ id: uid(), name: `대피소 ${c.shelters.length + 1}`, ...p });
    else if (tool === 'erase') {
      const near = (a) => Math.hypot((a.lat - p.lat) * 111000, (a.lon - p.lon) * 111000 * Math.cos(p.lat * Math.PI / 180));
      const hz = h.hazards.find(z => near(z) <= Math.max(z.r, 8)); if (hz) h.hazards = h.hazards.filter(z => z !== hz);
      else { const s = c.shelters.find(z => near(z) < 15); if (s) c.shelters = c.shelters.filter(z => z !== s); else return toast('가까운 항목이 없습니다'); }
    } else if (tool === 'pin') h.pin = { ...p, ts: Date.now() };
    else h[tool] = p;
    persist();
  }
  $('#back').onclick = () => { editId = null; tool = null; list(); };
  $('#rename').onclick = () => sheet({ title: '코스 이름', body: `<input type="text" id="nm" value="${esc(c.name)}">`, actions: [{ label: '취소' }, { label: '저장', kind: 'primary', onClick: card => { c.name = $('#nm', card).value.trim() || c.name; persist(); App_.refreshHeader(); } }] });
  $('#hp').onclick = () => { holeN = h.n > 1 ? h.n - 1 : c.holes.length; editor(); };
  $('#hn').onclick = () => { holeN = h.n < c.holes.length ? h.n + 1 : 1; editor(); };
  $('#par').onchange = e => { h.par = +e.target.value; if (S.round?.courseId === c.id) { const rh = S.round.holes.find(x => x.n === h.n); if (rh) rh.par = h.par; save('round'); } persist(); };
  $$('[data-tool]').forEach(b => b.onclick = () => { tool = tool === b.dataset.tool ? null : b.dataset.tool; editor(); });
  $$('#hzSeg button').forEach(b => b.onclick = () => { hzType = b.dataset.v; editor(); });
  $('#hzR')?.addEventListener('input', e => { hzR = +e.target.value; e.target.previousElementSibling.textContent = `반경 ${hzR}m`; });
  $('#here')?.addEventListener('click', async () => { toast('위치 측정 중…'); const f = await sampleFix(3000); if (!f) return toast('위치를 얻지 못했습니다'); apply({ lat: f.lat, lon: f.lon }); });
  $$('[data-delhz]').forEach(b => b.onclick = () => { h.hazards = h.hazards.filter(z => z.id !== b.dataset.delhz); persist(); });
  $('#hw').onchange = e => { h.halfWidth = +e.target.value; persist(); };
}
