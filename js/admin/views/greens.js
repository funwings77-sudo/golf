// 그린맵: 사전 측량 높이 격자 업로드(JSON · CSV 행렬 · XYZ 측량점) → 미리보기(경사 히트맵 · 등고선 · 흐름) → 홀에 적용 → 발행
import { $, $$, esc, toast, sheet } from '../../ui.js';
import { toLocal } from '../../core/geo.js';
import { demoGreen } from '../../physics/putt.js';
import { slopeColor } from '../../views/greencanvas.js';
import { Store } from '../store.js';
import * as M from '../model.js';
import { go } from '../main.js';
import { gridFromGeoTIFF } from '../geotiff.js';
import { fmtDT, download, readFiles, confirmPublish, runPublish, readonlyNote, courseSelect, remember, n1, bindTip } from '../common.js';

let st = null, el_ = null;
export default {
  async mount(el, [id]) {
    el_ = el;
    const cat = await Store.loadCatalog();
    const ids = [...new Set([...cat.courses.map(c => c.id), ...Store.draftIds()])];
    if (!ids.length) { el.innerHTML = `<h1>🟢 그린맵</h1><div class="card empty-card">코스가 없습니다. <a href="#/courses">코스를 먼저 만드세요.</a></div>`; return; }
    id = id || remember('greensCourse') || ids[0]; if (!ids.includes(id)) id = ids[0];
    remember('greensCourse', id);
    const w = await Store.working(id);
    const pins = await Store.loadPins(id).catch(() => ({ data: null }));
    const list = ids.map(x => { const c = cat.courses.find(y => y.id === x); if (c) return c; const d = Store.draft(x)?.course; return { id: x, name: (d?.name || x) + ' (미발행)', holes: d?.holes.length || 0 }; });
    st = { id, list, course: w.course, remote: w.remote, dirty: w.dirty, hole: 1, preview: null, contour: 0.02, pins: pins.data?.date === M.todayKey() ? pins.data : null };
    render();
  },
  unmount() { st = null; },
};
const hole = () => st.course.holes.find(h => h.n === st.hole) || st.course.holes[0];

function render() {
  const c = st.course, withGrid = c.holes.filter(h => h.greenGrid).length;
  el_.innerHTML = `<div class="a-head"><div class="grow"><h1>🟢 그린맵 · 사전 측량 높이 격자</h1>
      <div class="statusline">${courseSelect(st.list, st.id)}<span class="badge ${withGrid === c.holes.length ? '' : 'warn'}">그린맵 ${withGrid}/${c.holes.length}홀</span>${st.dirty ? '<span class="badge warn">● 발행 안 된 변경</span>' : ''}</div></div>
    <div class="a-actions"><a class="btn" href="#/course/${encodeURIComponent(st.id)}">✏️ 코스 편집</a><button class="btn primary" id="pub" ${st.dirty ? '' : 'disabled'}>🚀 발행</button></div></div>
    ${readonlyNote()}
    <div class="card tight"><div class="holechips" id="chips">${c.holes.map(h => `<button class="${h.n === st.hole ? 'on' : ''}" data-h="${h.n}">${h.n}<i class="${h.greenGrid ? 'ok' : h.green ? 'warn' : 'err'}"></i></button>`).join('')}</div></div>
    <div class="split" style="margin-top:12px"><div id="viewer"></div><div class="sticky" id="upload"></div></div>`;
  $('#courseSel').onchange = e => go('greens/' + encodeURIComponent(e.target.value));
  $$('#chips button').forEach(b => b.onclick = () => { st.hole = +b.dataset.h; st.preview = null; render(); });
  $('#pub').onclick = publish;
  renderViewer(); renderUpload();
}

function renderViewer() {
  const h = hole(), gg = st.preview ? { grid: st.preview.grid, origin: h.green, source: '미리보기 (아직 적용 안 됨)' } : h.greenGrid;
  const box = $('#viewer');
  if (!gg) { box.innerHTML = `<div class="card empty-card"><b>${h.n}번 홀에 그린맵이 없습니다</b><br>${h.green ? '오른쪽에서 측량 데이터를 올리세요. 앱은 그린맵이 없으면 현장 기울기 측정으로만 퍼팅을 계산합니다.' : '먼저 코스 편집에서 그린 중앙을 지정하세요 (격자 원점).'}</div>`; return; }
  const s = M.gridStats(gg.grid), R = M.greenDepth(h) / 2, g = gg.grid;
  const covers = g.x0 <= -R + 1 && g.y0 <= -R + 1 && g.x0 + (g.nx - 1) * g.dx >= R - 1 && g.y0 + (g.ny - 1) * g.dx >= R - 1;
  box.innerHTML = `<div class="card">
    <div class="row"><b class="grow">${h.n}번 홀 그린 ${st.preview ? '<span class="badge warn">미리보기</span>' : ''}</b>
      <label class="row" style="gap:6px;font-size:13px">등고선 <select id="ct" class="sm" style="width:auto">${[[0.01, '1cm'], [0.02, '2cm'], [0.05, '5cm'], [0, '끄기']].map(([v, t]) => `<option value="${v}" ${v === st.contour ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <div class="greenbox" style="margin-top:8px"><canvas id="gcv" width="720" height="560" aria-label="그린 경사 히트맵"></canvas></div>
    <div class="slopelegend"><span>0%</span><span class="ramp"></span><span>4%+ 경사</span><span class="grow"></span><span>흰 선: 등고선 · 화살표: 공이 흐르는 방향 · 원: 그린 범위(앞·뒤 기준)</span></div>
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><div class="v">${(s.relief * 100).toFixed(0)}<small>cm</small></div><div class="l">최고−최저 고저차</div></div>
      <div class="kpi"><div class="v">${n1(s.meanSlope)}<small>%</small></div><div class="l">평균 경사</div></div>
      <div class="kpi"><div class="v">${n1(s.maxSlope)}<small>%</small></div><div class="l">최대 경사</div></div>
      <div class="kpi"><div class="v">${n1(s.over3Pct, 0)}<small>%</small></div><div class="l">3% 넘는 면적 (핀 자리 부적합)</div></div>
    </div>
    <p class="sub" style="margin:10px 0 0">격자 ${g.nx}×${g.ny} · 셀 ${g.dx}m · ${s.width.toFixed(1)}×${s.depth.toFixed(1)}m · 출처: ${esc(gg.source || '—')}${gg.measuredAt ? ' · 측량 ' + esc(gg.measuredAt) : ''}</p>
    ${!covers ? '<div class="note">격자가 그린 범위(앞·뒤로 정한 원)를 다 덮지 못합니다. 가장자리 핀에서는 경사 정보가 끝값으로 대체됩니다.</div>' : ''}
    ${s.maxSlope > 8 ? '<div class="note err">최대 경사가 8%를 넘습니다. 그린 밖(벙커 턱 등)이 포함됐거나 측량 오류일 수 있습니다.</div>' : ''}
    ${!st.preview ? `<div class="row" style="margin-top:10px"><button class="btn small" id="dl">⬇ 격자 JSON</button><button class="btn small danger" id="rm">이 홀 그린맵 삭제</button></div>` : ''}
  </div>
  ${!st.preview ? verifyCard(h) : ''}`;
  drawGrid($('#gcv'), g, R, st.pins?.holes?.[h.n] ? toLocal(gg.origin || h.green, st.pins.holes[h.n]) : null);
  $('#ct').onchange = e => { st.contour = +e.target.value; renderViewer(); };
  $$('[data-chkdel]').forEach(b => b.onclick = () => { h.greenGrid.checks.splice(+b.dataset.chkdel, 1); save(); });
  // 캔버스를 눌러 현장 검증점 추가 (디지털 수평계로 잰 경사·흐름 방향 입력)
  if (!st.preview && h.greenGrid) $('#gcv').onclick = e => {
    const t = st.tf, r = e.target.getBoundingClientRect(), px = (e.clientX - r.left) * t.W / r.width, py = (e.clientY - r.top) * t.H / r.height;
    const x = +((px - t.ox) / t.s + t.x0).toFixed(2), y = +((t.oy - py) / t.s + t.y0).toFixed(2);
    sheet({
      title: `검증점 추가 (x ${x}m, y ${y}m)`,
      body: `<p class="sub">이 지점에 디지털 수평계를 놓고 잰 값을 넣으세요. 흐름 방향은 공이 굴러 내려가는 쪽의 방위입니다 (북 0°, 동 90°, 남 180°, 서 270°).</p>
        <div class="grid2"><label class="f"><span>측정 경사 (%)</span><input type="number" id="vp" step="0.05" min="0" max="10"></label><label class="f"><span>흐름 방향 (°)</span><input type="number" id="vd" step="1" min="0" max="359"></label></div>`,
      actions: [{ label: '취소' }, { label: '추가', kind: 'primary', onClick: card => {
        const pct = +$('#vp', card).value, dir = +$('#vd', card).value;
        if (!(pct >= 0 && pct <= 10) || !(dir >= 0 && dir < 360) || $('#vp', card).value === '' || $('#vd', card).value === '') { toast('경사와 방향을 숫자로 넣으세요'); return false; }
        h.greenGrid.checks = [...(h.greenGrid.checks || []), { x, y, pct, dir, at: new Date().toISOString() }]; save();
      } }],
    });
  };
  $('#dl')?.addEventListener('click', () => download(`${st.id}-h${h.n}-green.json`, JSON.stringify(h.greenGrid)));
  $('#rm')?.addEventListener('click', () => sheet({ title: '그린맵 삭제', body: `<p>${h.n}번 홀 그린맵을 삭제할까요? (발행해야 앱에 반영)</p>`, actions: [{ label: '취소' }, { label: '삭제', kind: 'danger', onClick: () => { delete h.greenGrid; save(); } }] }));
}

function renderUpload() {
  const h = hole();
  $('#upload').innerHTML = `<div class="card">
    <h3 style="margin-top:0">측량 데이터 올리기 · ${h.n}번 홀</h3>
    ${!h.green ? '<div class="note err">이 홀은 그린 중앙이 지정되지 않았습니다. 격자 원점이 필요합니다.</div>' : `<p class="sub" style="margin:0">원점 = 그린 중앙 <span class="mono">${h.green.lat.toFixed(6)}, ${h.green.lon.toFixed(6)}</span> · x=동쪽, y=북쪽(m)</p>`}
    <div class="formgrid" style="margin-top:6px">
      <label class="f"><span>형식</span><select id="mode"><option value="auto">자동 감지</option><option value="matrix">높이 행렬 CSV</option><option value="xyz">XYZ 점 (x,y,z 또는 위도,경도,높이)</option></select></label>
      <label class="f"><span>높이 단위</span><select id="unit"><option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option></select></label>
      <label class="f"><span>행렬 셀 크기 (m)</span><input type="number" id="dx" value="0.5" step="0.05" min="0.1" max="5"></label>
      <label class="f"><span>행렬 첫 줄</span><select id="rowOrder"><option value="north-first">북쪽 (GeoTIFF·이미지 순서)</option><option value="south-first">남쪽</option></select></label>
      <label class="f"><span>XYZ·GeoTIFF 셀 (m)</span><input type="number" id="cell" value="0.5" step="0.05" min="0.1" max="5"></label>
      <label class="f"><span>GeoTIFF 반경 (m, 그린 중앙 기준)</span><input type="number" id="rad" value="${Math.ceil(M.greenDepth(h) / 2 + 6)}" min="8" max="60"></label>
    </div>
    <label class="f"><span>파일 (.tif GeoTIFF DEM · .csv · .txt · .xyz · .json)</span><input type="file" id="file" accept=".tif,.tiff,.csv,.txt,.xyz,.json,image/tiff,text/plain,application/json"></label>
    <label class="f"><span>또는 붙여넣기</span><textarea id="txt" class="mono" rows="6" placeholder="# 행렬 예시 (m)\n0.12,0.11,0.10\n0.10,0.09,0.08\n…\n# 또는 XYZ 예시\n33.36211,126.53012,231.442"></textarea></label>
    <div class="formgrid">
      <label class="f"><span>측량 출처</span><input type="text" id="src" placeholder="예: 골프맵코리아 드론 LiDAR" value="${esc(h.greenGrid?.source || '')}"></label>
      <label class="f"><span>측량일</span><input type="date" id="mdate" value="${esc(h.greenGrid?.measuredAt || '')}"></label>
    </div>
    <div class="row"><button class="btn" id="pv">미리보기</button><button class="btn primary" id="apply" ${st.preview && h.green ? '' : 'disabled'}>이 홀에 적용</button><span class="grow"></span><button class="btn small" id="demo" title="테스트용 가상 그린">가상 데모 격자</button></div>
    <p class="sub" id="pvInfo" style="margin:8px 0 0">${st.preview ? esc(st.preview.info) : '골프맵코리아(GeoTIFF → CSV 행렬)·야디지코리아 측량점 등 일반 형식을 받습니다. 셀 수는 최대 ' + M.GRID_MAX_CELLS.toLocaleString() + '개.'}</p>
  </div>`;
  $('#file').onchange = async e => {
    const raw = e.target.files[0];
    if (raw && /\.tiff?$/i.test(raw.name)) {
      if (!h.green) { toast('그린 중앙을 먼저 지정하세요'); return; }
      $('#pvInfo').textContent = 'GeoTIFF 읽는 중… (라이브러리 처음 1회 내려받음)';
      try {
        st.preview = await gridFromGeoTIFF(await raw.arrayBuffer(), h.green, { radius: +$('#rad').value || 22, cell: +$('#cell').value || 0.5 });
        const src = $('#src').value || 'GeoTIFF DEM (' + raw.name + ')', md = $('#mdate').value;
        renderViewer(); renderUpload(); $('#src').value = src; $('#mdate').value = md;
      } catch (err) { st.preview = null; $('#pvInfo').innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`; }
      e.target.value = ''; return;
    }
    const [f] = await readFiles(e.target); if (f) { $('#txt').value = f.text.length > 2e6 ? '' : f.text; st.fileText = f.text; if (/\.json$/i.test(f.name)) $('#mode').value = 'auto'; toast(`${f.name} 불러옴 (${(f.text.length / 1024).toFixed(0)}KB)`); } };
  $('#pv').onclick = () => {
    const text = $('#txt').value.trim() || st.fileText || '';
    try {
      st.preview = M.parseGridInput(text, { mode: $('#mode').value, unit: $('#unit').value, dx: +$('#dx').value, rowOrder: $('#rowOrder').value, cellSize: +$('#cell').value, origin: h.green });
      st.previewMeta = { source: $('#src').value.trim(), measuredAt: $('#mdate').value };
      renderViewer(); renderUpload(); $('#src').value = st.previewMeta.source; $('#mdate').value = st.previewMeta.measuredAt;
    } catch (err) { st.preview = null; $('#pvInfo').innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`; }
  };
  $('#apply').onclick = () => {
    if (!st.preview || !h.green) return;
    h.greenGrid = { origin: { lat: h.green.lat, lon: h.green.lon }, grid: M.roundGrid(st.preview.grid), source: $('#src').value.trim() || '사전 측량', measuredAt: $('#mdate').value || null, importedAt: new Date().toISOString() };
    st.preview = null; st.fileText = null; save(); toast(`${h.n}번 홀 그린맵 적용 — 발행하면 앱에 반영됩니다`);
  };
  $('#demo').onclick = () => sheet({
    title: '가상 데모 격자', body: '<p class="sub">실제 그린이 아닌 테스트용 가상 지형입니다. 출처에 "가상"으로 표시됩니다.</p>',
    actions: [{ label: '취소' }, ...[['tier', '2단 그린'], ['saddle', '말안장'], ['mound', '마운드']].map(([k, n]) => ({ label: n, onClick: () => { const g = demoGreen(k); g.y0 -= 12.5; st.preview = { grid: { x0: g.x0, y0: g.y0, dx: g.dx, nx: g.nx, ny: g.ny, h: g.h }, info: `가상 ${n} ${g.nx}×${g.ny}` }; renderViewer(); renderUpload(); $('#src').value = `가상 데모 (${n})`; } }))],
  });
}

function save() {
  st.dirty = true;
  try { Store.saveDraft(st.id, st.course, st.remote?.rev || 0); } catch (e) { toast(e.message, 5000); }
  render();
}
async function publish() {
  const v = M.validateCourse(st.course);
  if (!v.ok) { toast(`코스 검증 오류 ${v.errors.length}건 — 코스 편집에서 고치세요`, 4000); return go('course/' + encodeURIComponent(st.id)); }
  if (!(await confirmPublish({ title: '그린맵 포함 코스 발행', lines: M.diffCourse(st.remote, st.course), warnings: v.warnings.filter(w => !/그린맵이 없습니다/.test(w.msg)) }))) return;
  const res = await runPublish('코스', () => Store.publishCourse(st.course), { onConflict: async () => { st.remote = (await Store.loadCourse(st.id, true)).data; await Store.loadCatalog(true); render(); } });
  if (res) { st.remote = M.clone(Store.courses.get(st.id).data); st.course = M.clone(st.remote); st.dirty = false; render(); }
}

function verifyCard(h) {
  const v = M.verifyGrid(h.greenGrid.grid, h.greenGrid.checks || []);
  return `<div class="card"><div class="row"><b class="grow">현장 검증 (디지털 수평계 대조)</b>${v.n ? `<span class="badge ${v.pass ? '' : 'err'}">${v.pass ? '✓ 통과' : '✕ 초과'} · RMS ${v.rms.toFixed(2)}%p</span>` : '<span class="badge mute">측정 없음</span>'}</div>
    <p class="sub" style="margin:6px 0">위 그린 그림을 눌러 측정 지점을 추가하세요. 격자 경사와 실측의 벡터 오차가 <b>±${M.GREEN_TOL_PCT}%p</b> 안이면 통과입니다 (기획서 PoC 기준). 그린 전체에 고르게 5곳 이상 권장${v.n && !v.enough ? ` · 현재 ${v.n}곳` : ''}.</p>
    ${v.n ? `<div class="tblbox"><table class="a-tbl"><thead><tr><th>#</th><th class="num">x, y (m)</th><th class="num">실측</th><th class="num">격자</th><th class="num">오차</th><th></th></tr></thead><tbody>${v.rows.map((r, i) => `<tr><td>${i + 1}</td><td class="num">${r.x}, ${r.y}</td><td class="num">${r.pct.toFixed(2)}% · ${r.dir}°</td><td class="num">${r.gridPct.toFixed(2)}% · ${r.gridDir.toFixed(0)}°</td><td class="num"><span class="badge ${r.pass ? '' : 'err'}">${r.err.toFixed(2)}%p</span></td><td><button class="btn small" data-chkdel="${i}">✕</button></td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
}

// ---------- 그리기: 경사 히트맵 + 등고선(마칭 스퀘어) + 흐름 화살표 + 그린 범위 + 핀 ----------
function drawGrid(cv, g, R, pin, hl = hole()) {
  const W = cv.width, Hh = cv.height, ctx = cv.getContext('2d');
  const { nx, ny, dx, x0, y0, h } = g, w = (nx - 1) * dx, d = (ny - 1) * dx;
  const pad = 28, s = Math.min((W - pad * 2) / w, (Hh - pad * 2) / d);
  const ox = (W - w * s) / 2, oy = (Hh + d * s) / 2;
  const X = x => ox + (x - x0) * s, Y = y => oy - (y - y0) * s;
  const at = (i, j) => h[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  const grad = (i, j) => [(at(i + 1, j) - at(i - 1, j)) / ((i > 0 && i < nx - 1 ? 2 : 1) * dx), (at(i, j + 1) - at(i, j - 1)) / ((j > 0 && j < ny - 1 ? 2 : 1) * dx)];
  ctx.fillStyle = '#16301f'; ctx.fillRect(0, 0, W, Hh);
  // 히트맵
  const cs = Math.max(1, s * dx);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const [gx, gy] = grad(i, j), pct = Math.hypot(gx, gy) * 100, x = x0 + i * dx, y = y0 + j * dx;
    ctx.globalAlpha = Math.hypot(x, y) <= R ? 1 : 0.35;
    ctx.fillStyle = slopeColor(pct); ctx.fillRect(X(x) - cs / 2, Y(y) - cs / 2, cs + 0.6, cs + 0.6);
  }
  ctx.globalAlpha = 1;
  // 등고선
  if (st.contour > 0) {
    const lo = Math.min(...h), hi = Math.max(...h), step = st.contour;
    for (let lv = Math.ceil(lo / step) * step, k = 0; lv <= hi && k < 200; lv += step, k++) {
      const major = Math.abs(Math.round(lv / (step * 5)) * step * 5 - lv) < step / 10;
      ctx.strokeStyle = major ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.45)'; ctx.lineWidth = major ? 1.6 : 1; ctx.beginPath();
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], p = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        const cross = [];
        for (let e = 0; e < 4; e++) { const a = v[e], b = v[(e + 1) % 4]; if ((a - lv) * (b - lv) < 0) { const t = (lv - a) / (b - a), [ai, aj] = p[e], [bi, bj] = p[(e + 1) % 4]; cross.push([x0 + (ai + (bi - ai) * t) * dx, y0 + (aj + (bj - aj) * t) * dx]); } }
        for (let q = 0; q + 1 < cross.length; q += 2) { ctx.moveTo(X(cross[q][0]), Y(cross[q][1])); ctx.lineTo(X(cross[q + 1][0]), Y(cross[q + 1][1])); }
      }
      ctx.stroke();
    }
  }
  // 흐름 화살표 (약 2m 간격)
  const stepI = Math.max(1, Math.round(2 / dx));
  ctx.strokeStyle = 'rgba(15,25,20,.85)'; ctx.fillStyle = 'rgba(15,25,20,.85)'; ctx.lineWidth = 1.4;
  for (let j = stepI >> 1; j < ny; j += stepI) for (let i = stepI >> 1; i < nx; i += stepI) {
    const x = x0 + i * dx, y = y0 + j * dx; if (Math.hypot(x, y) > R) continue;
    const [gx, gy] = grad(i, j), m = Math.hypot(gx, gy); if (m * 100 < 0.5) continue;
    const L = Math.min(1, m * 100 / 4) * stepI * dx * s * 0.42, ux = -gx / m, uy = -gy / m;
    const ax = X(x) - ux * L, ay = Y(y) + uy * L, bx = X(x) + ux * L, by = Y(y) - uy * L;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    const an = Math.atan2(by - ay, bx - ax); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 5 * Math.cos(an - 0.5), by - 5 * Math.sin(an - 0.5)); ctx.lineTo(bx - 5 * Math.cos(an + 0.5), by - 5 * Math.sin(an + 0.5)); ctx.fill();
  }
  // 그린 범위 · 중앙 · 핀
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.arc(X(0), Y(0), R * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(0), Y(0), 3, 0, Math.PI * 2); ctx.fill();
  if (pin) { ctx.fillStyle = '#d93b2b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(pin.x), Y(pin.y), 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui'; ctx.fillText('오늘 핀', X(pin.x) + 10, Y(pin.y) + 4); }
  // 방위 · 축척
  ctx.fillStyle = '#fff'; ctx.font = '800 13px system-ui'; ctx.textAlign = 'center'; ctx.fillText('N ▲', W - 30, 22);
  const bar = 5 * s; ctx.fillRect(16, Hh - 18, bar, 3); ctx.textAlign = 'left'; ctx.font = '600 11px system-ui'; ctx.fillText('5m', 16 + bar + 6, Hh - 13);
  st.tf = { ox, oy, s, x0, y0, W, H: Hh };
  if (hl.greenGrid?.checks && !st.preview) for (const [k, c] of hl.greenGrid.checks.entries()) {
    const ok = M.verifyGrid(g, [c]).rows[0]?.pass;
    ctx.fillStyle = ok ? '#2f8a5b' : '#d93b2b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(X(c.x) - 6, Y(c.y) - 6, 12, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '700 11px system-ui'; ctx.fillText(String(k + 1), X(c.x) + 9, Y(c.y) - 6);
  }
  // 마우스 위치 값
  cv.onmousemove = e => {
    const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width, py = (e.clientY - r.top) * Hh / r.height;
    const x = (px - ox) / s + x0, y = (oy - py) / s + y0, i = Math.round((x - x0) / dx), j = Math.round((y - y0) / dx);
    if (i < 0 || j < 0 || i >= nx || j >= ny) { $('#tip').classList.remove('show'); return; }
    const [gx, gy] = grad(i, j), dir = (Math.atan2(-gx, -gy) * 180 / Math.PI + 360) % 360;
    const tip = $('#tip');
    tip.innerHTML = `x ${x.toFixed(1)}m · y ${y.toFixed(1)}m<br>높이 ${(at(i, j) * 100).toFixed(1)}cm · 경사 <b>${(Math.hypot(gx, gy) * 100).toFixed(2)}%</b><br>흐름 방향 ${['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round(dir / 45) % 8]} (${dir.toFixed(0)}°)`;
    tip.classList.add('show'); tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY - 60 + 'px';
  };
  cv.onmouseleave = () => $('#tip').classList.remove('show');
}
