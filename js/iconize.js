// 🎨 화면 글자 속 이모지 → 앱 아이콘 세트 (js/icons.js) 자동 바꾸기
//  · 버튼·제목·설명 문장·알림까지 화면에 보이는 글자 전부 (화면이 다시 그려져도 MutationObserver가 바로 바꿈)
//  · 안 바꾸는 곳: 입력칸·선택 목록(option은 그림을 못 넣음)·지도 위 표시(지도 글꼴에 맞춰 그린 것)·data-noic
//  · 표에 없는 기호는 그대로: ✕ ‹ › ◎ · 방향 화살표 ⬆⬇↖↗↔ (높낮이·방향을 뜻하므로)
import { icon } from './icons.js';

export const EMOJI_ICON = {
  '🏌': 'golfer', '📍': 'pin', '📌': 'pin', '⛳': 'green', '🟢': 'green', '🚩': 'flag', '🏁': 'finish',
  '📤': 'share', '📥': 'download', '📷': 'camera', '🎥': 'video', '🎬': 'film',
  '⛰': 'mountain', '🏔': 'mountain', '🎯': 'target', '🤖': 'ai', '🗺': 'map', '🧪': 'flask', '🔍': 'lost',
  '📝': 'edit', '✏': 'edit', '📟': 'edit', '✅': 'check', '✔': 'check', '🙅': 'xcircle', '😢': 'xcircle',
  '📡': 'signal', '🛰': 'signal', '📂': 'folder', '📏': 'ruler', '📐': 'lie', '🎵': 'metronome', '🧭': 'compass',
  '📞': 'phone', '📋': 'yard', '↩': 'undo', '💾': 'save', '🗑': 'trash', '🧹': 'trash', '📈': 'shots', '📊': 'bars',
  '⚖': 'scale', '📖': 'book', '🎤': 'mic', '🔊': 'speaker', '🎧': 'headphones', '🛠': 'tools', '🔧': 'tools', '🧰': 'tools',
  '🌳': 'tree', '🩺': 'pulse', '⏹': 'stop', '▶': 'playtri', '👣': 'walk', '⏱': 'timer', '👥': 'users', '🌐': 'globe',
  '🌡': 'thermo', '🌬': 'wind', '🧍': 'user', '🔌': 'plug', '🏠': 'home', '⚡': 'bolt', '🎚': 'sliders', '⚙': 'gear',
  'ℹ': 'info', '🔄': 'refresh', '🔁': 'swap', '☰': 'menu', '⚪': 'ball', '🎒': 'bag', '🔠': 'big',
  '😊': 'smile', '🙂': 'smile', '🐢': 'slow', '🐇': 'fast', '🏆': 'trophy', '📚': 'book', '☀': 'sun',
  '⚠': 'warn', '🚨': 'warn', '⌚': 'watch', '📱': 'mobile', '🖥': 'monitor', '🧮': 'calc', '👍': 'check', '🎉': 'ai',
  '👉': 'tap', '👆': 'tap', '🔎': 'lost', '📒': 'book', '💧': 'drop', '🔴': 'rec', '🔑': 'key', '📢': 'megaphone',
  '💨': 'wind', '🏖': 'bunker', '🚫': 'xcircle', '❌': 'xcircle', '⛔': 'xcircle', '💡': 'bulb', '📺': 'video', '🔋': 'battery',
  '🛡': 'shield', '🚶': 'walk', '✍': 'edit', '🥶': 'ice', '🧊': 'ice', '🧥': 'thermo', '👂': 'mic', '🕳': 'green',
  '📄': 'doc', '🔗': 'link', '🧲': 'compass', '✋': 'hand', '🔥': 'fire', '⭐': 'star', '⏳': 'timer', '👫': 'users',
  '🔒': 'lock', '🆓': 'check', '⛅': 'cloud', '💰': 'coin', '🌱': 'sprout', '🔀': 'swap', '🏷': 'tag',
};
// 이모지 한 글자 (+ 피부색·변형 선택자·ZWJ 조합까지 한 덩어리로)
export const RE = new RegExp(`(${Object.keys(EMOJI_ICON).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\uFE0F|\\u200D[\\u2640\\u2642]\\uFE0F?|[\\u{1F3FB}-\\u{1F3FF}])*`, 'gu');
const SKIP = 'script, style, textarea, select, option, svg, canvas, [contenteditable], [data-noic], .leaflet-container';
const BTN = 'button, a.btn, [role="button"]';
const PAIR = /^[▶◀]$/; // ◀ ▶ 짝 버튼(홀 넘기기)은 글자 그대로

function convertText(t) {
  const s = t.nodeValue; if (!s || s.length > 4000) return;
  RE.lastIndex = 0; if (!RE.test(s)) return;
  const pe = t.parentElement; if (!pe || pe.closest(SKIP)) return;
  const btn = pe.closest(BTN); if (btn && PAIR.test(btn.textContent.trim())) return;
  RE.lastIndex = 0;
  const frag = document.createDocumentFragment(); let last = 0, m;
  while ((m = RE.exec(s))) {
    if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
    const box = document.createElement('span'); box.innerHTML = icon(EMOJI_ICON[m[1]]);
    frag.appendChild(box.firstChild);
    last = m.index + m[0].length;
  }
  if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
  t.parentNode.replaceChild(frag, t);
}
export function iconizeIn(root) {
  if (root.nodeType === 3) return convertText(root);
  if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) list.push(n);
  list.forEach(convertText);
}
export function startIconize(root = document.body) {
  iconizeIn(root);
  new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(iconizeIn); })
    .observe(root, { childList: true, subtree: true });
}
