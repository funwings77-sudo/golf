// 공지 · 안전: 낙뢰 중단 · 폭염 · 코스 상태 공지 작성/게시 기간/대상 코스 → 앱 상단 경보 바
import { $, $$, esc, toast, sheet } from '../../ui.js';
import { uid } from '../../core/state.js';
import { Store } from '../store.js';
import * as M from '../model.js';
import { fmtDT, confirmPublish, runPublish, readonlyNote } from '../common.js';

const TEMPLATES = [
  { level: 'danger', title: '⚡ 낙뢰 경보 — 플레이 즉시 중단', body: '낙뢰가 관측되었습니다. 즉시 플레이를 멈추고 가까운 그늘집·클럽하우스로 대피하세요. 재개는 별도 안내합니다.', hours: 2 },
  { level: 'info', title: '플레이 재개', body: '낙뢰 위험이 해소되어 플레이를 재개합니다. 중단 당시 위치에서 이어서 치세요.', hours: 1 },
  { level: 'warn', title: '🌡️ 폭염 주의', body: '체감 더위가 높습니다. 그늘집에서 물과 얼음을 무료로 제공합니다. 15분마다 수분을 섭취하세요.', hours: 8 },
  { level: 'warn', title: '카트 도로만 이용', body: '우천으로 페어웨이 카트 진입을 금지합니다 (카트 도로 전용).', hours: 10 },
  { level: 'info', title: '그린 에어레이션 작업', body: '그린 에어레이션 작업 중으로 퍼팅 시 공이 튈 수 있습니다. 그린 스피드가 평소보다 느립니다.', hours: 24 * 7 },
  { level: 'info', title: '프리퍼드 라이 적용', body: '페어웨이에서 공을 집어 닦은 뒤 한 클럽 이내에 놓을 수 있습니다 (로컬 룰 E-3).', hours: 10 },
];
const localDT = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

let st = null, el_ = null;
export default {
  dirty: () => !!st?.dirty,
  async mount(el) {
    el_ = el;
    const [cat, n] = await Promise.all([Store.loadCatalog(), Store.loadNotices(true)]);
    st = { cat, items: M.clone(n.items), remote: n, dirty: false };
    render();
  },
  unmount() { st = null; },
};

function render() {
  const now = Date.now();
  const groups = { 게시중: st.items.filter(n => M.noticeActive(n, now)), 예약: st.items.filter(n => !n.disabled && n.start && Date.parse(n.start) > now), '종료·숨김': st.items.filter(n => n.disabled || (n.end && Date.parse(n.end) < now)) };
  el_.innerHTML = `<div class="a-head"><div class="grow"><h1>📢 공지 · 안전</h1><p class="sub">앱 상단 경보 바와 홈 화면에 표시됩니다. 긴급 공지는 진동·음성으로 알립니다. 앱은 약 5분마다 새 공지를 확인합니다.</p></div>
    <div class="a-actions"><button class="btn" id="tpl">📋 템플릿</button><button class="btn" id="add">＋ 새 공지</button><button class="btn primary" id="pub" ${st.dirty ? '' : 'disabled'}>🚀 발행${st.dirty ? ' (변경 있음)' : ''}</button></div></div>
    ${readonlyNote()}
    ${Object.entries(groups).map(([g, list]) => `<h2>${g} ${list.length}건</h2>${list.length ? list.map(card).join('') : '<p class="sub">없음</p>'}`).join('')}
    <div class="card" style="margin-top:16px"><b>앱 표시 미리보기</b><div id="pv" style="margin-top:8px"></div></div>`;
  const top = groups['게시중'].sort((a, b) => ['danger', 'warn', 'info'].indexOf(a.level) - ['danger', 'warn', 'info'].indexOf(b.level))[0];
  $('#pv').innerHTML = top ? `<div class="alert-bar show ${top.level === 'info' ? '' : top.level}" style="${top.level === 'info' ? 'background:var(--blue);color:#fff;' : ''}border-radius:10px">${top.level === 'danger' ? '🚨' : top.level === 'warn' ? '⚠️' : '📢'} ${esc(top.title)}</div>` : '<p class="sub">게시 중인 공지가 없습니다.</p>';
  $('#add').onclick = () => edit(null);
  $('#tpl').onclick = () => sheet({
    title: '템플릿으로 작성', body: TEMPLATES.map((t, i) => `<button class="list-btn" data-t="${i}"><span class="ico">${t.level === 'danger' ? '🚨' : t.level === 'warn' ? '⚠️' : '📢'}</span><span class="grow"><b>${esc(t.title)}</b><br><span class="sub">${esc(t.body.slice(0, 60))}…</span></span></button>`).join(''),
    actions: [{ label: '닫기' }], onMount(card, close) { $$('[data-t]', card).forEach(b => b.onclick = () => { close(); const t = TEMPLATES[+b.dataset.t]; edit({ ...t, start: localDT(new Date()), end: localDT(new Date(Date.now() + t.hours * 3600e3)) }, true); }); },
  });
  $('#pub').onclick = publish;
  $$('[data-edit]').forEach(b => b.onclick = () => edit(st.items.find(n => n.id === b.dataset.edit)));
  $$('[data-toggle]').forEach(b => b.onclick = () => { const n = st.items.find(x => x.id === b.dataset.toggle); n.disabled = !n.disabled; st.dirty = true; render(); });
  $$('[data-endnow]').forEach(b => b.onclick = () => { const n = st.items.find(x => x.id === b.dataset.endnow); n.end = new Date().toISOString(); st.dirty = true; render(); toast('지금 종료로 설정했습니다 — 발행하세요'); });
  $$('[data-del]').forEach(b => b.onclick = () => { st.items = st.items.filter(x => x.id !== b.dataset.del); st.dirty = true; render(); });
}

function card(n) {
  const course = n.courseId ? st.cat.courses.find(c => c.id === n.courseId)?.name || n.courseId : '전체 코스';
  return `<div class="card tight"><div class="row"><div class="grow"><span class="badge ${n.level === 'danger' ? 'err' : n.level === 'warn' ? 'warn' : ''}">${M.NOTICE_LEVELS[n.level]}</span> <b>${esc(n.title)}</b>${n.disabled ? ' <span class="badge mute">숨김</span>' : ''}
      <br><span class="sub">${esc(course)} · ${n.start ? fmtDT(n.start) : '즉시'} ~ ${n.end ? fmtDT(n.end) : '종료 없음'}</span>${n.body ? `<p style="margin:6px 0 0;font-size:14px">${esc(n.body)}</p>` : ''}</div>
    <div class="a-actions"><button class="btn small" data-edit="${n.id}">수정</button>${M.noticeActive(n) ? `<button class="btn small" data-endnow="${n.id}">지금 종료</button>` : ''}<button class="btn small" data-toggle="${n.id}">${n.disabled ? '보이기' : '숨기기'}</button><button class="btn small danger" data-del="${n.id}">삭제</button></div></div></div>`;
}

function edit(n, isNew = !n) {
  const v = n || { level: 'info', title: '', body: '', start: localDT(new Date()), end: '' };
  const toLocal = s => (s ? (s.length > 16 ? localDT(new Date(s)) : s) : '');
  sheet({
    title: isNew ? '새 공지' : '공지 수정',
    body: `<label class="f"><span>등급</span><div class="seg" id="lv">${Object.entries(M.NOTICE_LEVELS).map(([k, t]) => `<button data-v="${k}" class="${v.level === k ? 'on' : ''}">${t}</button>`).join('')}</div></label>
      <label class="f"><span>대상</span><select id="cid"><option value="">전체 코스</option>${st.cat.courses.map(c => `<option value="${esc(c.id)}" ${c.id === v.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="f"><span>제목 (60자)</span><input type="text" id="tt" maxlength="60" value="${esc(v.title)}"></label>
      <label class="f"><span>내용 (400자)</span><textarea id="bd" maxlength="400" rows="4">${esc(v.body || '')}</textarea></label>
      <div class="grid2"><label class="f"><span>시작</span><input type="datetime-local" id="s" value="${esc(toLocal(v.start))}"></label><label class="f"><span>종료 (비우면 계속)</span><input type="datetime-local" id="e" value="${esc(toLocal(v.end))}"></label></div>`,
    onMount(card) { $$('#lv button', card).forEach(b => b.onclick = () => { $$('#lv button', card).forEach(x => x.classList.toggle('on', x === b)); }); },
    actions: [{ label: '취소' }, {
      label: '저장', kind: 'primary', onClick: card => {
        const item = {
          id: n?.id || uid(), level: $('#lv button.on', card).dataset.v, courseId: $('#cid', card).value || null,
          title: $('#tt', card).value.trim(), body: $('#bd', card).value.trim(),
          start: $('#s', card).value ? new Date($('#s', card).value).toISOString() : null, end: $('#e', card).value ? new Date($('#e', card).value).toISOString() : null,
          disabled: n?.disabled || false, createdAt: n?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        const err = M.validateNotice(item); if (err) { toast(err); return false; }
        const i = st.items.findIndex(x => x.id === item.id);
        if (i >= 0) st.items[i] = item; else st.items.unshift(item);
        st.dirty = true; render(); toast('저장했습니다 — [발행]해야 앱에 표시됩니다');
      },
    }],
  });
}

async function publish() {
  const before = st.remote.items, lines = [];
  for (const n of st.items) { const o = before.find(x => x.id === n.id); if (!o) lines.push(`추가: [${M.NOTICE_LEVELS[n.level]}] ${n.title}`); else if (JSON.stringify(o) !== JSON.stringify(n)) lines.push(`수정: ${n.title}${o.disabled !== n.disabled ? (n.disabled ? ' (숨김)' : ' (보이기)') : ''}`); }
  for (const o of before) if (!st.items.some(n => n.id === o.id)) lines.push(`삭제: ${o.title}`);
  // 종료 후 30일 지난 공지는 자동 정리
  const cutoff = Date.now() - 30 * 86400e3, items = st.items.filter(n => !(n.end && Date.parse(n.end) < cutoff));
  if (items.length < st.items.length) lines.push(`종료 30일 지난 공지 ${st.items.length - items.length}건 정리`);
  if (!(await confirmPublish({ title: '공지 발행', lines }))) return;
  const res = await runPublish('공지', () => Store.publishNotices(items), { onConflict: async () => { const n = await Store.loadNotices(true); st.remote = n; render(); } });
  if (res) { st.items = M.clone(items); st.remote = Store.notices; st.dirty = false; render(); }
}
