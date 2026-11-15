// 🚩 카메라 깃대 인식 거리 측정 (광학 레인지파인더 원리)
//  거리 = 초점거리(px) × 깃대 높이(2.13m) ÷ 화면 속 깃대 높이(px)
//  깃대 찾기: ① Gemini 비전(사진 → 깃대 상자)  ② 손가락으로 깃대 위·아래 두 번 누르기
import { focalPx, flagDistance, flagError } from '../core/arproj.js';
import { generateJSON, hasKey } from '../core/gemini.js';
import { distance, destination, normAngle } from '../core/geo.js';
import { S } from '../core/state.js';
import { vibrate } from '../core/sensors.js';

const POLE = 2.13; // 표준 깃대 높이 (7피트) — 골프장마다 다를 수 있어 설정에서 바꿀 수 있음
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// video: 카메라 영상, heading: 찍을 때 카메라가 향한 방위(°), sc: { me, pin }, onPin(latlon)
export function openFlagCam(host, video, { heading = null, sc = {}, onPin = null } = {}) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return false;
  const snap = document.createElement('canvas'); snap.width = vw; snap.height = vh; snap.getContext('2d').drawImage(video, 0, 0, vw, vh);
  const poleH = +S.settings.poleHeight || POLE, f = focalPx(S.settings.cameraVFov || 63, vh);
  const ov = document.createElement('div'); ov.className = 'flagcam';
  ov.innerHTML = `<div class="fc-img"><img alt="찍은 사진"><canvas class="fc-mark"></canvas></div>
    <div class="fc-panel"><div class="fc-msg" id="fcMsg">🚩 <b>깃대 맨 위</b>(깃발 꼭대기)를 눌러 주세요</div>
      <div class="fc-row">${hasKey() ? '<button id="fcAI">🤖 AI로 깃대 찾기</button>' : ''}<button id="fcZ">🔍 1배</button><button id="fcRe">↺ 다시</button><button id="fcX">닫기</button></div></div>`;
  host.appendChild(ov);
  const img = ov.querySelector('img'), mk = ov.querySelector('.fc-mark'), msg = ov.querySelector('#fcMsg');
  img.src = snap.toDataURL('image/jpeg', 0.9);
  let pts = [];
  let z = 3; // 조준선(화면 가운데)에 깃대를 맞추고 찍으므로 가운데를 3배 확대해서 보여 줌
  const fit = () => { const r = ov.querySelector('.fc-img').getBoundingClientRect(), s = Math.min(r.width / vw, r.height / vh) * z; return { r, s, ox: (r.width - vw * s) / 2, oy: (r.height - vh * s) / 2 }; };
  const place = () => { const { r, s, ox, oy } = fit(); img.style.cssText = `position:absolute;left:${ox}px;top:${oy}px;width:${vw * s}px;height:${vh * s}px;max-width:none;object-fit:fill`; void r; };
  const draw = (box = null) => {
    place(); const { r, s, ox, oy } = fit(); mk.width = r.width; mk.height = r.height; const c = mk.getContext('2d'); c.clearRect(0, 0, r.width, r.height);
    const P = q => [ox + q.x * s, oy + q.y * s];
    if (box) { const [a, b] = [P({ x: box.x0, y: box.y0 }), P({ x: box.x1, y: box.y1 })]; c.strokeStyle = '#5ee6a8'; c.lineWidth = 2; c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
    pts.forEach((q, i) => { const [x, y] = P(q); c.strokeStyle = '#ffc83d'; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 18, y); c.lineTo(x + 18, y); c.stroke(); c.fillStyle = '#ffc83d'; c.font = '800 13px system-ui'; c.fillText(i ? '아래' : '위', x + 22, y + 5); });
    if (pts.length === 2) { const [a, b] = pts.map(P); c.strokeStyle = 'rgba(255,200,61,.8)'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.setLineDash([]); }
  };
  const result = (top, bot, how) => {
    const hPx = Math.abs(bot.y - top.y), xMid = (top.x + bot.x) / 2;
    if (hPx < 6) { msg.innerHTML = '⚠ 깃대가 너무 작게 찍혔어요. 확대(줌) 없이 더 가까이에서 다시 찍어 주세요'; return; }
    const d = flagDistance(hPx, f, poleH), err = flagError(d, hPx);
    const off = Math.atan((xMid - vw / 2) / f) * 180 / Math.PI;
    const brg = heading != null ? (heading + off + 360) % 360 : null;
    const gps = sc.me && sc.pin ? distance(sc.me, sc.pin) : null;
    vibrate(40);
    msg.innerHTML = `<div class="fc-res"><small>${esc(how)} · 깃대 높이 ${poleH}m 기준</small><b>${Math.round(d)}<small>m</small></b><i>±${Math.max(1, Math.round(err))}m</i></div>
      ${gps != null ? `<div class="fc-cmp">GPS로 잰 깃발까지 <b>${Math.round(gps)}m</b> · 차이 ${Math.abs(Math.round(d - gps))}m ${Math.abs(d - gps) <= Math.max(5, err) ? '✓ 비슷해요' : '— 오늘 핀이 다른 자리일 수 있어요'}</div>` : ''}
      ${hPx < 25 ? '<div class="fc-cmp">⚠ 깃대가 작게 찍혀 오차가 커요. 가까울수록(100m 안) 정확해요</div>' : ''}
      ${onPin && brg != null && sc.me ? '<button id="fcPin" class="fc-pin">⛳ 이 자리를 오늘 핀으로 정하기</button>' : ''}`;
    ov.querySelector('#fcPin')?.addEventListener('click', () => { const p = destination(sc.me, brg, d); onPin({ lat: p.lat, lon: p.lon, d: Math.round(d), err: Math.round(err) }); ov.remove(); });
  };
  ov.querySelector('.fc-img').addEventListener('click', e => {
    if (pts.length >= 2) return;
    const { r, s, ox, oy } = fit(), x = (e.clientX - r.left - ox) / s, y = (e.clientY - r.top - oy) / s; // 확대 상태 반영
    if (x < 0 || y < 0 || x > vw || y > vh) return;
    pts.push({ x, y }); draw();
    if (pts.length === 1) msg.innerHTML = '🚩 이제 <b>깃대 맨 아래</b>(홀컵·땅에 닿은 곳)를 눌러 주세요';
    else { const [a, b] = pts; result(a.y < b.y ? a : b, a.y < b.y ? b : a, '손가락으로 표시'); }
  });
  ov.querySelector('#fcRe').onclick = () => { pts = []; draw(); msg.innerHTML = '🚩 <b>깃대 맨 위</b>(깃발 꼭대기)를 눌러 주세요'; };
  ov.querySelector('#fcX').onclick = () => ov.remove();
  ov.querySelector('#fcZ').onclick = e => { z = z === 3 ? 1 : 3; e.target.textContent = z === 3 ? '🔍 1배' : '🔍 3배'; draw(); };
  ov.querySelector('#fcAI')?.addEventListener('click', async () => {
    msg.innerHTML = '🤖 사진에서 깃대를 찾는 중…';
    try {
      const data = snap.toDataURL('image/jpeg', 0.85).split(',')[1];
      const { data: j } = await generateJSON({
        system: '너는 골프장 사진에서 깃대(핀)를 찾는 도우미야. 깃대가 확실히 보일 때만 found=true. box_2d는 깃대 전체(깃발 꼭대기부터 땅/홀컵에 닿은 아랫끝까지)를 감싸는 상자로 [ymin, xmin, ymax, xmax], 0~1000 정규화 좌표. 깃대 아랫끝이 가려져 안 보이면 bottom_visible=false.',
        parts: [{ text: '이 사진에서 골프 깃대를 찾아줘.' }, { inline_data: { mime_type: 'image/jpeg', data } }],
        schema: { type: 'OBJECT', properties: { found: { type: 'BOOLEAN' }, box_2d: { type: 'ARRAY', items: { type: 'NUMBER' } }, bottom_visible: { type: 'BOOLEAN' }, confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] } }, required: ['found'] },
        temperature: 0, maxTokens: 256,
      });
      const b = j.box_2d;
      if (!j.found || !Array.isArray(b) || b.length !== 4) { msg.innerHTML = '🤖 깃대를 확실히 찾지 못했어요. <b>깃대 맨 위</b>를 직접 눌러 주세요'; return; }
      const box = { y0: b[0] / 1000 * vh, x0: b[1] / 1000 * vw, y1: b[2] / 1000 * vh, x1: b[3] / 1000 * vw };
      const bh = box.y1 - box.y0, bw = box.x1 - box.x0;
      // 검증: 깃대는 세로로 길쭉해야 함 (깃발 포함 폭 ≤ 높이의 0.8)
      if (bh <= 0 || bw > bh * 0.8 || j.bottom_visible === false || j.confidence === 'low') {
        draw(box); msg.innerHTML = `🤖 ${j.bottom_visible === false ? '깃대 아래쪽이 가려져 있어요' : '찾은 모양이 깃대 같지 않아요'}. 초록 상자를 참고해 <b>깃대 맨 위</b>를 직접 눌러 주세요`; return;
      }
      pts = [{ x: (box.x0 + box.x1) / 2, y: box.y0 }, { x: (box.x0 + box.x1) / 2, y: box.y1 }]; draw(box);
      result(pts[0], pts[1], `AI가 찾음 (확신 ${({ high: '높음', medium: '보통' })[j.confidence] || '—'})`);
    } catch (e) { msg.innerHTML = `⚠ ${esc(e.message)} — <b>깃대 맨 위</b>를 직접 눌러 주세요`; }
  });
  requestAnimationFrame(() => draw());
  return true;
}
void normAngle;
