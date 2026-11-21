// 📡 장비 연동: 홀마다 풍속계 · 낙구 지점 고정 카메라 등록 → 실시간 데이터 주소(live.url) → 앱이 라운드 중 30초마다 읽음
//  데이터 모양은 js/core/live.js 맨 위 설명 (format: 'pinpoint-live')
import { $, $$, esc, toast } from '../../ui.js';
import { uid } from '../../core/state.js';
import { normalizeLive, sampleLive, LIVE_FORMAT } from '../../core/live.js';
import { Store } from '../store.js';
import { go } from '../main.js';
import { download, runPublish, confirmPublish, courseSelect, remember, readonlyNote } from '../common.js';

const TYPES = { wind: ['🌬️', '풍속계', '이 홀 바람 세기·방향 (m/s · 불어오는 방위)'], camera: ['📷', '낙구 카메라', '공이 멈춘 곳 (위도·경도)'] };
let st = null, el_ = null;

export default {
  dirty: () => !!st?.dirty,
  async mount(el, [id]) {
    el_ = el;
    const cat = await Store.loadCatalog();
    if (!cat.courses.length) { el.innerHTML = `<h1>📡 장비 연동</h1><div class="card empty-card">발행된 코스가 없습니다. 먼저 <a href="#/courses">코스를 발행</a>하세요.</div>`; return; }
    id = id || remember('devCourse') || cat.courses[0].id;
    if (!cat.courses.some(c => c.id === id)) id = cat.courses[0].id;
    remember('devCourse', id);
    const w = await Store.working(id);
    if (!w.course) { el.innerHTML = '<div class="card">코스 파일을 불러오지 못했습니다.</div>'; return; }
    st = { id, cat, course: w.course, remote: w.remote, dirty: false, test: null };
    st.course.live = { url: '', devices: [], ...(st.course.live || {}) };
    render();
  },
  unmount() { st = null; },
};

function render() {
  const L = st.course.live, holes = st.course.holes.map(h => h.n);
  el_.innerHTML = `<h1>📡 장비 연동 <small>풍속계 · 낙구 카메라</small></h1>${readonlyNote()}
    <div class="card">${courseSelect(st.cat.courses, st.id)}
      <p class="sub">홀에 설치한 장비를 적고, 장비 업체(또는 우리 서버)가 내보내는 <b>실시간 데이터 주소</b>를 넣으세요. 앱은 라운드 중 30초마다 이 주소를 읽어
      <b>그 홀 바람으로 클럽 추천</b>을 하고, <b>카메라가 본 공 위치로 공 찾기 화살표</b>를 바꿉니다. 주소가 비어 있으면 예보 바람만 씁니다.</p>
      <label class="f"><span>실시간 데이터 주소 (https, CORS 허용 필요)</span><input type="url" id="url" value="${esc(L.url || '')}" placeholder="https://example.com/live/course.json"></label>
      <div class="row"><button class="btn" id="test">🔌 연결 시험</button><button class="btn" id="sample">⬇ 시험용 JSON 만들기</button><button class="btn" id="spec">📄 데이터 모양 보기</button></div>
      <div id="testOut">${st.test ? testHtml(st.test) : ''}</div></div>
    <h2>장비 ${L.devices.length}대</h2>
    <div class="card">${L.devices.length ? `<div class="tblbox"><table class="a-tbl"><tr><th>종류</th><th>홀</th><th>이름·번호</th><th>위치 (카메라)</th><th></th></tr>
      ${L.devices.map((d, i) => `<tr><td>${TYPES[d.type][0]} ${TYPES[d.type][1]}</td>
        <td><select data-k="hole" data-i="${i}">${holes.map(n => `<option ${n === d.hole ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
        <td><input data-k="name" data-i="${i}" value="${esc(d.name || '')}" placeholder="예: 3번 티 풍속계"></td>
        <td>${d.type === 'camera' ? `<input data-k="lat" data-i="${i}" value="${d.lat ?? ''}" placeholder="위도" style="width:90px"> <input data-k="lon" data-i="${i}" value="${d.lon ?? ''}" placeholder="경도" style="width:90px">` : '<span class="sub">—</span>'}</td>
        <td><button class="btn small danger" data-del="${i}">삭제</button></td></tr>`).join('')}</table></div>` : '<p class="sub">아직 등록한 장비가 없어요.</p>'}
      <div class="row" style="margin-top:8px">${Object.entries(TYPES).map(([k, [i, n]]) => `<button class="btn" data-add="${k}">${i} ${n} 추가</button>`).join('')}</div>
      <p class="sub">장비 번호(id)는 데이터의 <code>device</code> 값과 같게 맞추면 어느 장비 값인지 앱 기록에 남아요. 카메라 위치는 '시험용 JSON'에서 공 위치 예시로 써요.</p></div>
    <div class="row"><button class="btn primary" id="pub" ${st.dirty ? '' : 'disabled'}>📤 발행</button>${st.dirty ? '<span class="sub">발행해야 앱에 반영돼요</span>' : ''}</div>`;
  $('#courseSel').onchange = e => go('devices/' + e.target.value);
  $('#url').onchange = e => { L.url = e.target.value.trim(); touch(); };
  $$('[data-add]').forEach(b => b.onclick = () => { L.devices.push({ id: uid().slice(0, 6), type: b.dataset.add, hole: holes[0] }); touch(); render(); });
  $$('[data-del]').forEach(b => b.onclick = () => { L.devices.splice(+b.dataset.del, 1); touch(); render(); });
  $$('[data-k]').forEach(x => x.onchange = () => { const d = L.devices[+x.dataset.i], k = x.dataset.k; d[k] = k === 'name' ? x.value.trim() : k === 'hole' ? +x.value : x.value === '' ? null : +x.value; touch(); });
  $('#test').onclick = test;
  $('#sample').onclick = () => download(`${st.id}-live-sample.json`, JSON.stringify(sampleLive(L.devices), null, 2));
  $('#spec').onclick = () => download('pinpoint-live-format.json', JSON.stringify({
    format: LIVE_FORMAT, updatedAt: '2026-11-21T09:00:00+09:00',
    wind: [{ hole: 3, device: 'w3', speed: 4.2, from: 270, gust: 7.1, ts: '2026-11-21T08:59:30+09:00', '//': 'speed·gust m/s, from = 바람이 불어오는 방위(북 0°, 동 90°)' }],
    balls: [{ hole: 3, device: 'c3', lat: 37.1234567, lon: 127.1234567, ts: '2026-11-21T08:59:45+09:00', conf: 0.9, '//': '카메라가 본 공이 멈춘 곳 · 친 뒤 90초 안의 값만 씀' }],
  }, null, 2));
  $('#pub').onclick = publish;
}
function touch() { st.dirty = true; try { Store.saveDraft(st.id, st.course, st.remote?.rev || 0); } catch (e) { toast(e.message, 5000); } const p = $('#pub'); if (p) p.disabled = false; }

function testHtml(t) {
  if (t.err) return `<p style="color:var(--danger)">⚠ ${esc(t.err)}</p>`;
  const age = s => `${Math.round((Date.now() - s) / 60000)}분 전`;
  return `<p style="color:var(--green)">✅ 연결됨 · 바람 ${t.live.wind.length}개 · 공 위치 ${t.live.balls.length}개 · ${age(t.live.updatedAt)}</p>
    ${t.live.wind.slice(0, 6).map(w => `<div class="sub">🌬️ ${w.hole}번 홀 ${w.speed}m/s · ${w.from}°${w.gust ? ` · 돌풍 ${w.gust}` : ''} · ${age(w.ts)}</div>`).join('')}`;
}
async function test() {
  const url = st.course.live.url;
  if (!/^https:\/\//.test(url)) { st.test = { err: 'https:// 로 시작하는 주소를 넣어 주세요 (앱은 https만 읽어요)' }; return render(); }
  try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); st.test = { live: normalizeLive(await r.json()) }; }
  catch (e) { st.test = { err: `읽지 못했어요: ${e.message} · 주소, CORS(Access-Control-Allow-Origin: *), JSON 모양을 확인하세요` }; }
  render();
}
async function publish() {
  const L = st.course.live, lines = [`데이터 주소: ${L.url || '(없음 — 예보 바람만)'}`, ...L.devices.map(d => `${TYPES[d.type][1]} · ${d.hole}번 홀 ${d.name || ''}`)];
  const warnings = [];
  if (L.url && !/^https:\/\//.test(L.url)) warnings.push({ msg: '주소가 https가 아니에요 (앱에서 못 읽어요)' });
  L.devices.filter(d => d.type === 'camera' && !(Number.isFinite(d.lat) && Number.isFinite(d.lon))).forEach(d => warnings.push({ hole: d.hole, msg: '카메라 위치(위도·경도)가 비어 있어요 (앱 동작에는 상관없음)' }));
  if (!(await confirmPublish({ title: '장비 연동 발행', lines, warnings }))) return;
  if (!L.url && !L.devices.length) delete st.course.live;
  const res = await runPublish('장비 연동', () => Store.publishCourse(st.course, `[admin] 장비 연동: ${st.course.name}`), { onConflict: async () => { location.reload(); } });
  if (res) { st.dirty = false; st.course.live ||= { url: '', devices: [] }; render(); }
}
