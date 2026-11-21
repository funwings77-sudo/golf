// 🎨 본문 버튼 이모지 → 앱 아이콘 세트 (js/icons.js) 자동 바꾸기
//  · 버튼(<button>, a.btn, [role=button])의 글자 속 이모지만 바꿈 — 안내 문장·숫자 표시는 그대로
//  · 화면이 다시 그려져도 MutationObserver가 새로 생긴 버튼을 바로 바꿈
//  · 표에 없는 이모지·기호(✕ ‹ › ◎ 등)는 그대로 둠 · 바꾸기 싫은 곳은 data-noic
import { icon } from './icons.js';

export const EMOJI_ICON = {
  '🏌': 'golfer', '📍': 'pin', '📌': 'pin', '⛳': 'green', '🟢': 'green', '🚩': 'flag', '🏁': 'finish',
  '📤': 'share', '⬇': 'download', '📥': 'download', '📷': 'camera', '🎥': 'video', '🎬': 'film',
  '⛰': 'mountain', '🏔': 'mountain', '🎯': 'target', '🤖': 'ai', '🗺': 'map', '🧪': 'flask', '🔍': 'lost',
  '📝': 'edit', '✏': 'edit', '📟': 'edit', '✅': 'check', '✔': 'check', '🙅': 'xcircle', '😢': 'xcircle',
  '📡': 'signal', '🛰': 'signal', '📂': 'folder', '📏': 'ruler', '📐': 'lie', '🎵': 'metronome', '🧭': 'compass',
  '📞': 'phone', '📋': 'yard', '↩': 'undo', '💾': 'save', '🗑': 'trash', '🧹': 'trash', '📈': 'shots', '📊': 'bars',
  '⚖': 'scale', '📖': 'book', '🎤': 'mic', '🔊': 'speaker', '🎧': 'headphones', '🛠': 'tools', '🔧': 'tools', '🧰': 'tools',
  '🌳': 'tree', '🩺': 'pulse', '⏹': 'stop', '▶': 'playtri', '👣': 'walk', '⏱': 'timer', '👥': 'users', '🌐': 'globe',
  '🌡': 'thermo', '🌬': 'wind', '🧍': 'user', '🔌': 'plug', '🏠': 'home', '⚡': 'bolt', '🎚': 'sliders', '⚙': 'gear',
  'ℹ': 'info', '🔄': 'refresh', '🔁': 'swap', '☰': 'menu', '⚪': 'ball', '🎒': 'bag', '🔠': 'big',
};
// 이모지 한 글자 (+ 피부색·변형 선택자·ZWJ 조합까지 한 덩어리로)
export const RE = new RegExp(`(${Object.keys(EMOJI_ICON).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\uFE0F|\\u200D[\\u2640\\u2642]\\uFE0F?|[\\u{1F3FB}-\\u{1F3FF}])*`, 'gu');
const SEL = 'button, a.btn, [role="button"]';

function convertText(t) {
  const s = t.nodeValue; RE.lastIndex = 0;
  if (!RE.test(s)) return;
  RE.lastIndex = 0;
  const frag = document.createDocumentFragment(); let last = 0, m;
  while ((m = RE.exec(s))) {
    if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
    const box = document.createElement('span'); box.className = 'ic-e'; box.innerHTML = icon(EMOJI_ICON[m[1]]);
    frag.appendChild(box.firstChild);
    last = m.index + m[0].length;
  }
  if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
  t.parentNode.replaceChild(frag, t);
}
function convertButton(b) {
  if (b.closest('[data-noic]')) return;
  if (/^[▶◀]$/.test(b.textContent.trim())) return; // ◀ ▶ 짝 버튼(홀 넘기기)은 글자 그대로
  const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT), list = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) if (!n.parentElement?.closest('svg')) list.push(n);
  list.forEach(convertText);
}
export function iconizeIn(root) {
  if (root.nodeType === 3) { const b = root.parentElement?.closest(SEL); if (b) convertButton(b); return; }
  if (root.nodeType !== 1) return;
  if (root.matches(SEL)) convertButton(root);
  else { const up = root.closest(SEL); if (up) convertButton(up); }
  root.querySelectorAll(SEL).forEach(convertButton);
}
export function startIconize(root = document.body) {
  iconizeIn(root);
  new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(iconizeIn); })
    .observe(root, { childList: true, subtree: true });
}
