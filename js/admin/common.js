// 관리자 공통 UI 헬퍼
import { $, esc, toast, sheet } from '../ui.js';
import { Store, ConflictError } from './store.js';

export function fmtDT(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return '—';
  return d.toLocaleString('ko-KR', withTime ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: '2-digit', day: '2-digit' });
}
export function ago(iso) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso); if (!t) return '—';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '방금'; if (s < 3600) return `${Math.floor(s / 60)}분 전`; if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}일 전`; return fmtDT(new Date(t).toISOString(), false);
}
export const n1 = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
export const pct = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : (v * 100).toFixed(d) + '%');
export const signed = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
export function readFiles(input) { return Promise.all([...input.files].map(f => f.text().then(text => ({ name: f.name, text })))); }

// 발행 버튼 공통 처리: 연결 확인 → 확인 시트 → 실행 → 결과/충돌 안내
export async function runPublish(label, fn, { onConflict } = {}) {
  if (!Store.connected) {
    sheet({ title: 'GitHub 연결 필요', body: '<p>발행하려면 저장소 쓰기 권한이 있는 토큰으로 연결해야 합니다.</p>', actions: [{ label: '닫기' }, { label: '연결 설정으로', kind: 'primary', onClick: () => { location.hash = '#/connect'; } }] });
    return null;
  }
  try {
    toast(`${label} 발행 중…`, 10000);
    const res = await fn();
    if (res?.unchanged) toast('원격과 내용이 같아 커밋하지 않았습니다');
    else toast(`${label} 발행 완료 · 1~2분 뒤 앱에 반영됩니다`, 4000);
    return res;
  } catch (e) {
    console.error(e);
    if (e instanceof ConflictError) {
      sheet({
        title: '발행 충돌', body: `<p>${esc(e.message)}</p><p class="sub">다른 관리자(또는 다른 탭)가 먼저 발행했습니다. 원격 최신본을 다시 불러온 뒤 변경 내용을 확인하고 다시 발행하세요. 이 기기의 임시저장은 유지됩니다.</p>`,
        actions: [{ label: '닫기' }, ...(onConflict ? [{ label: '원격 최신본 다시 불러오기', kind: 'primary', onClick: onConflict }] : [])],
      });
    } else sheet({ title: '발행 실패', body: `<p>${esc(e.message)}</p>`, actions: [{ label: '닫기' }] });
    return null;
  }
}

export function confirmPublish({ title, lines = [], warnings = [], okLabel = '발행' }) {
  return new Promise(res => sheet({
    title,
    body: `${lines.length ? `<b>변경 내용</b><ul class="diff">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="sub">변경 사항이 없습니다.</p>'}
      ${warnings.length ? `<p style="margin:12px 0 4px"><b>확인 필요 ${warnings.length}건</b></p><ul class="diff">${warnings.slice(0, 30).map(w => `<li>${w.hole ? w.hole + '번 홀: ' : ''}${esc(w.msg)}</li>`).join('')}</ul>` : ''}
      <p class="sub" style="margin-top:12px">발행하면 저장소 <b>${esc(Store.conf.owner)}/${esc(Store.conf.repo)}</b>의 <code>data/</code>에 커밋되고, 1~2분 뒤 모든 앱 사용자에게 반영됩니다. 이력은 GitHub 커밋으로 남습니다.</p>`,
    actions: [{ label: '취소', onClick: () => res(false) }, { label: okLabel, kind: 'primary', onClick: () => res(true) }], dismissable: false,
  }));
}

// 키보드 없이 쓸 수 있는 간단한 프롬프트 (window.prompt 사용 안 함)
export function promptSheet(title, fields, okLabel = '확인') {
  return new Promise(res => sheet({
    title,
    body: fields.map(f => `<label class="f"><span>${esc(f.label)}</span>${f.type === 'select'
      ? `<select data-k="${f.key}">${f.options.map(([v, t]) => `<option value="${esc(v)}" ${v == f.value ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`
      : f.type === 'textarea' ? `<textarea data-k="${f.key}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea>`
        : `<input data-k="${f.key}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.attrs || ''}>`}${f.help ? `<small class="sub">${esc(f.help)}</small>` : ''}</label>`).join(''),
    actions: [{ label: '취소', onClick: () => res(null) }, {
      label: okLabel, kind: 'primary', onClick: card => {
        const out = {}; card.querySelectorAll('[data-k]').forEach(i => { out[i.dataset.k] = i.value; });
        res(out);
      },
    }], dismissable: false,
  }));
}

// 마우스·터치 툴팁 (차트 막대 등)
export function bindTip(root) {
  const tip = $('#tip');
  root.querySelectorAll('[data-tip]').forEach(el => {
    const show = e => { tip.innerHTML = el.dataset.tip; tip.classList.add('show'); move(e); };
    const move = e => { const p = e.touches?.[0] || e; tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, p.clientX + 12) + 'px'; tip.style.top = Math.max(8, p.clientY - tip.offsetHeight - 10) + 'px'; };
    el.addEventListener('mouseenter', show); el.addEventListener('mousemove', move); el.addEventListener('mouseleave', () => tip.classList.remove('show'));
    el.addEventListener('touchstart', show, { passive: true }); el.addEventListener('touchend', () => setTimeout(() => tip.classList.remove('show'), 1600));
  });
}

export function courseSelect(courses, sel, id = 'courseSel') {
  return `<select id="${id}" class="sm" style="width:auto;min-width:200px">${courses.map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)} (${c.holes}홀)</option>`).join('')}</select>`;
}
export function remember(key, val) { try { if (val === undefined) return localStorage.getItem('pinpoint.admin.ui.' + key); localStorage.setItem('pinpoint.admin.ui.' + key, val); } catch {} return null; }
export function readonlyNote() {
  return Store.connected ? '' : `<div class="note">읽기 전용 미리보기입니다 (공개된 데이터 표시). 편집 내용은 이 기기에 임시저장되며, <a href="#/connect">GitHub에 연결</a>해야 발행할 수 있습니다.</div>`;
}
