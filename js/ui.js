// 공통 UI 헬퍼
import { S } from './core/state.js';
import { fmtNum } from './core/geo.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function D(m, digits = 0) { return fmtNum(m, S.settings.unit, digits); }
export function U() { return S.settings.unit === 'yd' ? 'yd' : 'm'; }
export function DU(m, digits = 0) { return D(m, digits) + U(); }

let toastT = null;
export function toast(msg, ms = 2600) {
  const el = $('#toast'); if (!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms);
}

// 바텀시트 모달 (네이티브 alert/confirm 사용 안 함)
export function sheet({ title = '', body = '', actions = [], onMount = null, dismissable = true }) {
  const root = $('#sheet');
  root.innerHTML = `<div class="sheet-bg"></div><div class="sheet-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-grip"></div>${title ? `<h3>${esc(title)}</h3>` : ''}<div class="sheet-body">${body}</div>
    <div class="sheet-actions">${actions.map((a, i) => `<button class="btn ${a.kind || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
  root.classList.add('open');
  const close = () => { root.classList.remove('open'); root.innerHTML = ''; };
  if (dismissable) $('.sheet-bg', root).onclick = close;
  $$('.sheet-actions .btn', root).forEach(b => b.onclick = async () => {
    const a = actions[+b.dataset.i];
    const r = a.onClick ? await a.onClick(root) : undefined;
    if (r !== false) close();
  });
  onMount && onMount($('.sheet-card', root), close);
  return close;
}
export function confirmSheet(title, text, okLabel = '확인', kind = 'primary') {
  return new Promise(res => sheet({ title, body: `<p>${esc(text)}</p>`, actions: [{ label: '취소', onClick: () => res(false) }, { label: okLabel, kind, onClick: () => res(true) }], dismissable: false }));
}

export function lockedCard(featureName) {
  return `<div class="card locked"><div class="lock-ic">⛔</div><div><b>대회 모드에서는 쓸 수 없어요</b><p class="sub">${esc(featureName)}은(는) 골프 규칙(4.3a)상 대회 중에 쓰면 안 돼요. 깃발까지 거리, 점수, 공 찾기는 계속 쓸 수 있어요.</p></div></div>`;
}

export function confBadge(p) {
  const pct = Math.round(p * 100);
  const cls = pct >= 75 ? 'ok' : pct >= 50 ? 'mid' : 'low';
  return `<span class="conf ${cls}">신뢰도 ${pct}%</span>`;
}

export function clubOptions(sel) {
  return S.bag.filter(c => c.enabled).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)} · ${DU(c.carry)}</option>`).join('');
}

export function signed(v, d = 1) { return (v > 0 ? '+' : '') + v.toFixed(d); }
export function mmss(ms) { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// 메트로놈 (퍼팅 템포): 시작 · 정점 · 임팩트 (백스윙:다운스윙 = 2:1)
let actx = null, metroT = null;
export function metronome(on, bpm = 76) {
  clearInterval(metroT); metroT = null;
  if (!on) return;
  actx = actx || new (window.AudioContext || window.webkitAudioContext)();
  const T = 60 / bpm;
  const click = (t, f) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; o.connect(g); g.connect(actx.destination); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08); o.start(t); o.stop(t + 0.1); };
  const cycle = () => { const t = actx.currentTime + 0.05; click(t, 880); click(t + T, 660); click(t + T * 1.5, 1200); };
  cycle(); metroT = setInterval(cycle, T * 3 * 1000);
}
