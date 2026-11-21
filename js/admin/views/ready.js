// 📱 앱 준비도: 발행한 데이터가 골퍼 앱의 어느 화면에 쓰이고, 빠지면 골퍼에게 어떻게 보이는지
//   · 전체 코스 × 앱 기능 표 · 코스별 '먼저 할 일'(영향 큰 순) · 홀별 표 · 골퍼 화면 미리보기
import { $, $$, esc } from '../../ui.js';
import { Store } from '../store.js';
import * as M from '../model.js';
import { READY_FEATURES, courseReadiness, holePreview } from '../ready.js';
import { readonlyNote, remember } from '../common.js';

const FIX = { course: ['코스 편집', 'course'], pins: ['오늘의 핀', 'pins'], greens: ['그린맵', 'greens'], devices: ['장비 연동', 'devices'] };
const fixHref = (f, id) => `#/${FIX[f.fix][1]}/${encodeURIComponent(id)}`;
const LV = { ok: '', part: 'warn', none: 'err' };
const pctTxt = f => (f.scope === 'hole' ? `${f.have}/${f.total}` : f.have ? '있음' : '없음');

let st = null;
export default {
  async mount(el, [id]) {
    el.innerHTML = `<div class="a-head"><div class="grow"><h1>📱 앱 준비도</h1>
      <p class="sub">골퍼 앱의 화면(거리 · 골프 치기 카메라 · 그린 · 공 찾기 · 룰 · 안전)이 쓰는 데이터를 <b>발행된 코스 기준</b>으로 점검합니다. 빠진 데이터가 골퍼 화면에서 어떻게 보이는지와 고치는 곳을 알려 줍니다.</p></div></div>
      ${readonlyNote()}<div id="rbody"><div class="empty">코스를 불러오는 중…</div></div>`;
    const cat = await Store.loadCatalog();
    if (!cat.courses.length) { $('#rbody', el).innerHTML = '<div class="card empty-card">발행된 코스가 없습니다. 먼저 <a href="#/courses">코스를 발행</a>하세요.</div>'; return; }
    const today = M.todayKey();
    const rows = await Promise.all(cat.courses.map(async e => {
      const [{ data: c }, p] = await Promise.all([Store.loadCourse(e.id).catch(() => ({ data: null })), Store.loadPins(e.id).catch(() => ({ data: null }))]);
      return c ? { e, c, pins: p.data, r: courseReadiness(c, p.data, today) } : null;
    }));
    if (!$('#rbody', el)) return; // 불러오는 사이 다른 화면으로
    st = { el, rows: rows.filter(Boolean), today, id: null, hole: 1 };
    st.id = [id, remember('readyCourse')].find(x => st.rows.some(r => r.e.id === x)) || st.rows[0].e.id;
    render();
  },
  unmount() { st = null; },
};

function render() {
  const { rows } = st, N = rows.length;
  const avg = Math.round(rows.reduce((a, r) => a + r.r.score, 0) / N);
  const f = k => r => r.r.features.find(x => x.key === k);
  const distOk = rows.filter(r => f('green')(r).level === 'ok').length, pinOk = rows.filter(r => f('pin')(r).have > 0).length;
  const gridH = rows.reduce((a, r) => a + f('grid')(r).have, 0), holesN = rows.reduce((a, r) => a + r.c.holes.length, 0);
  const noGreen = rows.filter(r => f('green')(r).level === 'none').length;
  $('#rbody', st.el).innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="v">${avg}<small>점</small></div><div class="l">평균 앱 준비도</div><div class="d">${bar(avg)}</div></div>
      <div class="kpi"><div class="v">${distOk}<small>/ ${N}</small></div><div class="l">거리 안내가 바로 되는 코스</div><div class="d">${noGreen ? `<span class="badge err">${noGreen}곳 그린 위치 없음</span>` : '<span class="badge">모두 가능</span>'}</div></div>
      <div class="kpi"><div class="v">${pinOk}<small>/ ${N}</small></div><div class="l">오늘 핀이 앱에 나오는 코스</div><div class="d"><a href="#/pins">오늘의 핀 →</a></div></div>
      <div class="kpi"><div class="v">${gridH}<small>/ ${holesN}홀</small></div><div class="l">그린 경사 지도가 있는 홀</div><div class="d"><a href="#/greens">그린맵 →</a></div></div>
    </div>
    ${noGreen ? `<div class="note warn-note"><b>⚠ ${noGreen === N ? '모든' : noGreen + '개'} 코스에 그린·티 위치(GPS)가 없습니다.</b> 이 코스를 받은 골퍼는 홀마다 지도에서 그린을 직접 눌러야 거리 안내·카메라·공 찾기가 시작됩니다. 코스 편집 → <b>OSM 자동 가져오기</b> 또는 위성지도에서 찍어 발행하면 바로 해결됩니다.</div>` : ''}
    <h2>코스 × 앱 기능</h2>
    <p class="sub">칸을 누르면 그 코스의 상세 점검으로 갑니다. 초록 = 전 홀 · 노랑 = 일부 · 빨강 = 없음.</p>
    <div class="tblbox"><table class="a-tbl rd-tbl"><thead><tr><th>코스</th><th>준비도</th>${READY_FEATURES.map(x => `<th class="c" title="${esc(x.label)}: ${esc(x.uses)}">${x.icon}<br><small>${esc(x.label.replace(' (선택)', ''))}</small></th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.e.id === st.id ? 'sel' : ''}" data-cid="${esc(r.e.id)}"><td><b>${esc(r.c.name)}</b><br><span class="sub">${r.c.holes.length}홀 · ${esc(r.c.region || '')}</span></td><td>${bar(r.r.score)}</td>
        ${r.r.features.map(x => `<td class="c"><span class="rd-cell ${x.level}${x.w ? '' : ' opt'}" title="${esc(x.label)} ${pctTxt(x)}">${x.scope === 'hole' ? Math.round(x.pct * 100) + '%' : x.have ? '✓' : '✕'}</span></td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <div id="rdetail"></div>`;
  $$('tr[data-cid]', st.el).forEach(tr => (tr.onclick = () => { st.id = tr.dataset.cid; st.hole = 1; remember('readyCourse', st.id); history.replaceState(null, '', '#/ready/' + encodeURIComponent(st.id)); $$('tr[data-cid]', st.el).forEach(x => x.classList.toggle('sel', x === tr)); detail(); $('#rdetail', st.el).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  detail();
}

function bar(v) { const lv = v >= 85 ? 'ok' : v >= 50 ? 'part' : 'none'; return `<span class="rd-bar ${lv}" title="${v}점"><i style="width:${Math.max(3, v)}%"></i></span><b class="rd-v">${v}</b>`; }

function detail() {
  const R = st.rows.find(r => r.e.id === st.id); if (!R) return;
  const { c, r } = R, id = c.id, hf = r.features.filter(x => x.scope === 'hole');
  const draft = Store.draft(id);
  $('#rdetail', st.el).innerHTML = `<h2>${esc(c.name)} <span class="sub">· 앱 준비도 ${r.score}점</span></h2>
    ${draft ? `<div class="note">이 코스에는 <b>발행 안 된 임시저장</b>이 있습니다. 골퍼는 발행된 데이터만 받으므로 아래 점검은 발행본 기준입니다. <a href="#/course/${encodeURIComponent(id)}">편집으로 가서 발행 →</a></div>` : ''}
    <div class="split">
      <div>
        <div class="card"><b>먼저 할 일</b> <span class="sub">골퍼에게 미치는 영향이 큰 순서</span>
          ${r.todo.length ? `<ol class="rd-todo">${r.todo.map(x => `<li><div class="row"><span class="grow"><b>${x.icon} ${esc(x.label)}</b> <span class="badge ${LV[x.level]}">${pctTxt(x)}</span></span><a class="btn small" href="${fixHref(x, id)}">${FIX[x.fix][0]}에서 고치기 →</a></div>
            <div class="sub">지금 골퍼 화면: ${esc(x.miss)}</div><div class="sub rd-uses">쓰는 곳: ${esc(x.uses)}</div></li>`).join('')}</ol>` : '<p class="sub">빠진 데이터가 없습니다. 골퍼 앱의 모든 기능이 이 코스 데이터를 씁니다. 🎉</p>'}
          ${r.features.filter(x => x.level === 'ok').length ? `<p class="sub" style="margin-bottom:0">✓ 갖춘 것: ${r.features.filter(x => x.level === 'ok').map(x => esc(x.label)).join(' · ')}</p>` : ''}
        </div>
        <h3>홀별 점검 <span class="sub">행을 누르면 오른쪽에 골퍼 화면 미리보기</span></h3>
        <div class="tblbox tall"><table class="a-tbl rd-holes"><thead><tr><th>홀</th><th class="num">파</th>${hf.map(x => `<th class="c" title="${esc(x.label)}">${x.icon}<br><small>${esc(x.label)}</small></th>`).join('')}</tr></thead><tbody>
          ${r.holes.map(h => `<tr data-hn="${h.n}" class="${h.n === st.hole ? 'sel' : ''}"><td><b>${esc(h.label)}</b></td><td class="num">${h.par}</td>${hf.map(x => `<td class="c">${h.has[x.key] ? '<span class="rd-ok">✓</span>' : '<span class="rd-no">·</span>'}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="sticky"><div id="rprev"></div></div>
    </div>`;
  $$('tr[data-hn]', st.el).forEach(tr => (tr.onclick = () => { st.hole = +tr.dataset.hn; $$('tr[data-hn]', st.el).forEach(x => x.classList.toggle('sel', x === tr)); preview(); }));
  preview();
}

// 골퍼 화면 미리보기 (앱의 골프 치기 아래 카드 · 그린 화면 기준으로 요약)
function preview() {
  const R = st.rows.find(r => r.e.id === st.id), c = R.c, hs = c.holes;
  const h = hs.find(x => x.n === st.hole) || hs[0], p = holePreview(c, h, R.pins, st.today), i = hs.indexOf(h);
  $('#rprev', st.el).innerHTML = `<div class="card tight"><div class="row"><b class="grow">📱 골퍼 화면 미리보기</b><button class="btn small" id="pvP">‹</button><button class="btn small" id="pvN">›</button></div>
    <div class="rd-phone">
      <div class="rd-top"><b>${esc(p.title)}</b><span>파 ${p.par}${p.hdcp != null ? ` · 핸디캡 ${p.hdcp}` : ''}</span></div>
      ${p.len.length ? `<div class="rd-len">${p.len.map(esc).join(' · ')}</div>` : ''}
      <div class="rd-line ${/⚠/.test(p.distance) ? 'bad' : ''}"><i>⛳</i>${esc(p.distance)}</div>
      <div class="rd-line ${/없음/.test(p.tee) ? 'bad' : ''}"><i>🏌️</i>${esc(p.tee)}</div>
      <div class="rd-line ${p.hazards.length ? '' : 'mute'}"><i>⚠️</i>${p.hazards.length ? '카메라 경고: ' + esc(p.hazards.join(' · ')) : '해저드 정보 없음 (경고 안 나옴)'}</div>
      <div class="rd-line ${p.note ? '' : 'mute'}"><i>📝</i>${p.note ? esc(p.note) : '공략 메모 없음'}</div>
      <div class="rd-line"><i>🟢</i>${esc(p.green)} · 빠르기 ${p.stimp}</div>
    </div>
    <p class="sub" style="margin:8px 0 0">${i + 1} / ${hs.length}홀 · 실제 앱 문구와 같은 기준으로 요약했습니다.</p></div>`;
  const step = d => { st.hole = hs[(i + d + hs.length) % hs.length].n; $$('tr[data-hn]', st.el).forEach(x => x.classList.toggle('sel', +x.dataset.hn === st.hole)); preview(); };
  $('#pvP', st.el).onclick = () => step(-1); $('#pvN', st.el).onclick = () => step(1);
}
