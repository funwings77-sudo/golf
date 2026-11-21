// 🎨 캔버스(카메라 화면 위 그림)에 '아이콘 + 글자' 그리기
//  화면 글자(iconize.js)와 같은 이모지→아이콘 표를 써서, 카메라 화면 표시도 앱 아이콘 세트와 똑같이 보이게
//  · 아이콘 SVG를 그림(Image)으로 한 번 만들어 색깔별로 보관 · 그림이 아직 준비 전이면 그 자리만 비우고 글자는 그대로
import { icon } from './icons.js';
import { RE, EMOJI_ICON } from './iconize.js';

const cache = new Map();
export function iconImage(name, color = '#fff') {
  const key = name + color; let im = cache.get(key); if (im) return im;
  const svg = icon(name)
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" ')
    .replace('stroke="currentColor"', `stroke="${color}"`)
    .replaceAll('class="a"', 'fill="#c8f169" stroke="none"') // 포인트 면 (CSS가 없는 그림이라 직접 칠함)
    .replaceAll('class="k"', 'stroke="#14241c"')
    .replace(/ class="[^"]*"/, '');
  im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  cache.set(key, im); return im;
}

// '⛳ 깃발 120m' → [{ ic: 'green' }, { t: ' 깃발 120m' }]
export function splitRich(text) {
  const s = String(text ?? ''), out = []; let last = 0, m;
  RE.lastIndex = 0;
  while ((m = RE.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) });
    out.push({ ic: EMOJI_ICON[m[1]] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: s.slice(last) });
  return out;
}
const fontPx = ctx => +(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] || 14);
const icW = size => size * 1.2, gap = size => size * 0.22;
// 글자 사이 아이콘 뒤에 공백이 없으면 조금 띄움 ('⛳까지' → [깃발] 까지)
export function richWidth(ctx, text, size = fontPx(ctx)) {
  const parts = Array.isArray(text) ? text : splitRich(text);
  return parts.reduce((w, p, i) => w + (p.ic ? icW(size) + (parts[i + 1]?.t && !/^\s/.test(parts[i + 1].t) ? gap(size) : 0) : ctx.measureText(p.t).width), 0);
}
// y = 글자 기준선 · align: 'left' | 'center' · color = 아이콘 선 색 (글자색은 ctx.fillStyle 그대로)
export function drawRich(ctx, text, x, y, { size = fontPx(ctx), align = 'left', color = '#fff' } = {}) {
  const parts = splitRich(text), w = richWidth(ctx, parts, size), keep = ctx.textAlign;
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.textAlign = 'left';
  parts.forEach((p, i) => {
    if (p.ic) {
      const im = iconImage(p.ic, color), s = icW(size);
      if (im.complete && im.naturalWidth) ctx.drawImage(im, cx, y - size * 0.98, s, s);
      cx += s + (parts[i + 1]?.t && !/^\s/.test(parts[i + 1].t) ? gap(size) : 0);
    } else { ctx.fillText(p.t, cx, y); cx += ctx.measureText(p.t).width; }
  });
  ctx.textAlign = keep;
  return w;
}
