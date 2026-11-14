// 카메라 증강현실(AR): 실제 풍경 위에 깃발 · 추천 길(지면 선) · 떨어질 곳 · 내 공 · 해저드 표시
//  정밀도: 회전행렬(α·β·γ) 투영 + 표시 영상의 실제 초점거리(object-fit 보정) + 방위 1탭 보정 + 흔들림 완화
import { openCamera, coverTransform } from '../core/camera.js';
import { Sensors, startOrientation, requestMotionPermission, onOrientation } from '../core/sensors.js';
import { rotationMatrix, project, enuOf, focalPx, cameraAxis, yawCorrection, smoothAngle } from '../core/arproj.js';
import { distance, bearing, destination, normAngle } from '../core/geo.js';
import { S } from '../core/state.js';

const YAW_KEY = 'pinpoint.arYaw';
export async function startAR(box, getScene) {
  box.innerHTML = `<div class="ar"><video playsinline muted></video><canvas></canvas>
    <div class="ar-msg" id="arMsg"></div><div class="ar-diag" id="arDiag"></div>
    <div class="ar-bar"><button class="btn small" id="arCal">🎯 깃발 맞추기</button><button class="btn small" id="arReset" title="방위 보정 지우기">↺</button><button class="btn small" id="arChk">🩺 점검</button><span id="arAcc"></span></div></div>`;
  const video = box.querySelector('video'), cv = box.querySelector('canvas'), msg = box.querySelector('#arMsg'), acc = box.querySelector('#arAcc');
  let stopCam = null, raf = 0, alive = true, calib = false;
  let yaw = 0; try { yaw = +localStorage.getItem(YAW_KEY) || 0; } catch {}
  let a = null, b = null, g = null;
  // 실기기 점검용: 방향 센서 이벤트 빈도
  let evN = 0, evRate = 0, evT = performance.now();
  const unOri = onOrientation(() => { evN++; const now = performance.now(); if (now - evT >= 1000) { evRate = evN * 1000 / (now - evT); evN = 0; evT = now; } });
  let diagOn = false;
  try { await requestMotionPermission(); } catch {}
  startOrientation();
  try { stopCam = await openCamera(video); }
  catch (e) { msg.innerHTML = `📷 카메라를 켤 수 없어요<br><small>${e.name === 'NotAllowedError' ? '카메라 권한을 허용해 주세요' : e.message}</small>`; msg.classList.add('show'); }

  const ctx = cv.getContext('2d');
  let last = { R: null, f: 0, cx: 0, cy: 0 };
  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = box.clientWidth, H = box.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const sc = getScene();
    if (!sc?.me) { say('📍 위치를 찾는 중이에요…'); return; }
    if (Sensors.alphaAbs == null || Sensors.beta == null) { say('🧭 방향 센서를 기다려요…<br><small>휴대폰을 8자 모양으로 한두 번 돌려 주세요 · 🩺 점검을 눌러 원인을 볼 수 있어요</small>'); if (diagOn) diag(sc, { bearing: 0, pitch: 0 }); return; }
    a = smoothAngle(a, (Sensors.alphaAbs + yaw + 360) % 360, 0.2);
    b = b == null ? Sensors.beta : b + (Sensors.beta - b) * 0.25;
    g = g == null ? Sensors.gamma : g + (Sensors.gamma - g) * 0.25;
    const R = rotationMatrix(a, b, g), ax = cameraAxis(R);
    // 표시 영상의 초점거리·중심 (object-fit: cover 확대 반영)
    const t = video.videoWidth ? coverTransform(video, box) : { s: 1, ox: 0, oy: 0, vw: W, vh: H };
    const f = focalPx(S.settings.cameraVFov || 63, t.vh) * t.s, cx = t.ox + t.vw * t.s / 2, cy = t.oy + t.vh * t.s / 2;
    const so = (screen.orientation && screen.orientation.angle) || 0;
    const opt = { f, cx, cy, screenAngle: so };
    last = { R, f, cx, cy, opt };
    const eye = S.settings.phoneHeight || 1.45, P = (p, dz = 0) => project(R, enuOf(sc.me, p, { eye, dz }), opt);
    if (ax.pitch < -40) say('📱 휴대폰을 조금 더 세워 주세요'); else if (calib) say('👆 화면에서 <b>진짜 깃발</b>을 눌러 주세요'); else hide();
    // 지평선
    const h1 = project(R, { x: Math.sin((ax.bearing - 40) * Math.PI / 180) * 3000, y: Math.cos((ax.bearing - 40) * Math.PI / 180) * 3000, z: 0 }, opt);
    const h2 = project(R, { x: Math.sin((ax.bearing + 40) * Math.PI / 180) * 3000, y: Math.cos((ax.bearing + 40) * Math.PI / 180) * 3000, z: 0 }, opt);
    if (h1.visible && h2.visible) { ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([6, 8]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(h1.x, h1.y); ctx.lineTo(h2.x, h2.y); ctx.stroke(); ctx.setLineDash([]); }
    // 추천 길: 공 → 떨어질 곳 (지면 위 노란 띠) → 깃발 (흰 점선)
    const path = (from, to, color, w, dash, dzTo = 0) => {
      const d = distance(from, to), br = bearing(from, to), pts = [];
      for (let s = Math.min(3, d); s <= d; s += Math.max(1.5, d / 60)) { const q = project(R, enuOf(sc.me, destination(from, br, s), { eye, dz: dzTo * s / d }), opt); if (q.visible && q.depth > 1.5) pts.push(q); }
      if (pts.length < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.setLineDash(dash); ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); ctx.setLineDash([]);
    };
    const from = sc.ball || sc.me;
    if (sc.landing) { path(from, sc.landing, 'rgba(255,226,122,.95)', 8, []); if (sc.pin && distance(sc.landing, sc.pin) > 3) path(sc.landing, sc.pin, 'rgba(255,255,255,.85)', 3, [8, 8], sc.dzPin || 0); }
    else if (sc.pin) path(from, sc.pin, 'rgba(255,226,122,.95)', 6, [], sc.dzPin || 0);
    // 해저드
    for (const z of sc.hazards || []) { const q = P(z); if (q.visible && q.depth < 400) label(q.x, q.y, `${{ ob: 'OB', water: '💧물', bunker: '🏖벙커', trees: '🌳숲' }[z.type] || ''} ${Math.round(distance(sc.me, z))}m`, 'rgba(0,0,0,.55)', 12); }
    // 떨어질 곳
    if (sc.landing) { const q = P(sc.landing); if (q.visible) { ring(q.x, q.y, Math.max(10, f * 6 / q.depth)); label(q.x, q.y - 24, `🎯 여기로! ${Math.round(distance(sc.me, sc.landing))}m`, 'rgba(160,120,0,.9)', 15); } }
    // 내 공 (친 뒤)
    if (sc.ball) { const q = P(sc.ball); if (q.visible) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d93b2b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(7, f * 0.6 / q.depth), 0, 7); ctx.fill(); ctx.stroke(); label(q.x, q.y - 22, `⚪ 내 공 ${Math.round(distance(sc.me, sc.ball))}m`, 'rgba(217,59,43,.92)', 15); } else edge(sc.ball, '내 공', ax); }
    // 깃발
    if (sc.pin) {
      const top = P(sc.pin, (sc.dzPin || 0) + 2.1), base = P(sc.pin, sc.dzPin || 0);
      if (base.visible) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
        ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x + 18, top.y + 7); ctx.lineTo(top.x, top.y + 14); ctx.fill();
        label(top.x, top.y - 16, `⛳ 깃발 ${Math.round(distance(sc.me, sc.pin))}m`, 'rgba(31,95,63,.95)', 17);
      } else edge(sc.pin, '깃발', ax);
    }
    if (diagOn) diag(sc, ax);
    acc.textContent = `GPS ±${Math.round(sc.me.acc || 0)}m · 방위 ${Math.round(ax.bearing)}°${Sensors.compassAcc != null ? ` (±${Math.round(Sensors.compassAcc)}°)` : ''}${yaw ? ` · 보정 ${yaw > 0 ? '+' : ''}${yaw.toFixed(1)}°` : ''}`;
  }
  function label(x, y, text, bg, size) {
    ctx.font = `800 ${size}px system-ui, sans-serif`; const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - size - 6, w, size + 12, 9) : ctx.rect(x - w / 2, y - size - 6, w, size + 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(text, x, y); ctx.textAlign = 'left';
  }
  function ring(x, y, r) { ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.6, 0, 0, 7); ctx.stroke(); }
  // 화면 밖 대상: 가장자리 화살표
  function edge(p, name, ax) {
    const rel = normAngle(bearing(getScene().me, p) - ax.bearing), W = box.clientWidth, H = box.clientHeight;
    const left = rel < 0, x = left ? 34 : W - 34, y = H * 0.42;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.arc(x, y, 28, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffe27a'; ctx.font = '900 26px system-ui'; ctx.textAlign = 'center'; ctx.fillText(left ? '◀' : '▶', x, y + 9);
    label(x + (left ? 60 : -60), y + 52, `${name}은 ${left ? '왼쪽' : '오른쪽'} ${Math.abs(rel).toFixed(0)}°`, 'rgba(0,0,0,.65)', 13); ctx.textAlign = 'left';
  }
  // 🩺 실기기 점검: 각 센서 상태 · 예상 오차 · 고치는 방법
  function diag(sc, ax) {
    const D = sc.pin ? distance(sc.me, sc.pin) : 150, cAcc = Sensors.compassAcc, gAcc = sc.me.acc || 0, age = (Date.now() - (sc.me.ts || Date.now())) / 1000;
    const row = (ok, name, val, fix) => `<div>${ok === 2 ? '<b class="ok">✓</b>' : ok === 1 ? '<b class="mid">△</b>' : '<b class="bad">✕</b>'} ${name}: <b>${val}</b>${ok < 2 && fix ? ` <br><small>→ ${fix}</small>` : ''}</div>`;
    const compErr = cAcc != null && cAcc >= 0 ? cAcc : 10, lat = D * Math.tan(compErr * Math.PI / 180);
    box.querySelector('#arDiag').innerHTML = `<b>AR 점검</b> <small>(이 화면을 캡처해서 보내 주시면 원인을 찾을 수 있어요)</small>
      ${row(isSecureContext ? 2 : 0, 'HTTPS', isSecureContext ? '예' : '아니요', 'https 주소로 열어야 센서·카메라가 켜져요')}
      ${row(video.videoWidth ? 2 : 0, '카메라', video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '꺼짐', '카메라 권한을 허용해 주세요')}
      ${row(evRate >= 20 ? 2 : evRate >= 5 ? 1 : 0, '방향 센서', `${evRate.toFixed(0)}회/초`, '배터리 절약 모드를 끄고, iPhone은 동작·방향 권한을 허용해 주세요')}
      ${row(Sensors.alphaAbs != null ? 2 : 0, '나침반(북쪽 기준)', Sensors.alphaAbs != null ? `${Math.round(ax.bearing)}°` : '없음', '기기가 나침반을 지원하지 않으면 [깃발 맞추기]로 방향을 맞춰 주세요')}
      ${row(cAcc == null ? 1 : cAcc <= 15 ? 2 : cAcc <= 30 ? 1 : 0, '나침반 정확도', cAcc == null ? '기기가 알려주지 않음' : `±${Math.round(cAcc)}°`, '휴대폰을 8자로 돌리고, 카트·철제 구조물에서 2m 떨어지세요')}
      ${row(gAcc <= 5 ? 2 : gAcc <= 10 ? 1 : 0, 'GPS 정확도', `±${Math.round(gAcc)}m · ${age.toFixed(0)}초 전`, '하늘이 트인 곳에서 10초 기다려 주세요')}
      ${row(Math.abs(ax.pitch) < 35 ? 2 : 1, '휴대폰 자세', `위아래 ${ax.pitch.toFixed(0)}° · 기울기 ${(g ?? 0).toFixed(0)}°`, '휴대폰을 세워서 앞을 비춰 주세요')}
      ${row(2, '방위 보정', `${yaw ? (yaw > 0 ? '+' : '') + yaw.toFixed(1) + '°' : '없음'} · 화각 ${S.settings.cameraVFov || 63}°`, '')}
      <div style="margin-top:6px">예상 오차: 깃발(${Math.round(D)}m)이 화면에서 좌우 약 <b>${lat.toFixed(1)}m</b> 어긋날 수 있어요${compErr > 8 ? ' → [🎯 깃발 맞추기]를 쓰면 줄어들어요' : ''}. 거리 숫자는 GPS로 계산해서 ±${Math.round(gAcc)}m 정도예요.</div>`;
  }
  function say(h) { msg.innerHTML = h; msg.classList.add('show'); }
  function hide() { msg.classList.remove('show'); }
  box.querySelector('#arCal').onclick = () => { calib = !calib; };
  box.querySelector('#arChk').onclick = () => { diagOn = !diagOn; box.querySelector('#arDiag').classList.toggle('show', diagOn); };
  box.querySelector('#arReset').onclick = () => { yaw = 0; a = null; try { localStorage.removeItem(YAW_KEY); } catch {} };
  cv.addEventListener('click', e => {
    if (!calib || !last.R) return;
    const sc = getScene(); if (!sc?.pin) { calib = false; return; }
    const r = cv.getBoundingClientRect();
    const corr = yawCorrection(last.R, enuOf(sc.me, sc.pin, { eye: 0 }), e.clientX - r.left, last.opt);
    if (corr != null && Math.abs(corr) < 45) { yaw = ((yaw - corr + 540) % 360) - 180; try { localStorage.setItem(YAW_KEY, String(yaw)); } catch {} a = null; }
    calib = false;
  });
  raf = requestAnimationFrame(frame);
  return () => { alive = false; cancelAnimationFrame(raf); unOri(); stopCam && stopCam(); };
}
