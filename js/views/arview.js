// 카메라 증강현실(AR): 실제 풍경 위에 깃발 · 추천 길(지면 선) · 떨어질 곳 · 내 공 · 해저드 표시
//  정밀도: 회전행렬(α·β·γ) 투영 + 표시 영상의 실제 초점거리(object-fit 보정) + 방위 1탭 보정 + 흔들림 완화
import { openCamera, coverTransform } from '../core/camera.js';
import { Sensors, startOrientation, requestMotionPermission, onOrientation } from '../core/sensors.js';
import { rotationMatrix, project, enuOf, focalPx, cameraAxis, yawCorrection, smoothAngle, unproject, groundHit } from '../core/arproj.js';
import { distance, bearing, destination, normAngle } from '../core/geo.js';
import { S } from '../core/state.js';

const YAW_KEY = 'pinpoint.arYaw';
export async function startAR(box, getScene, { onLock = null } = {}) {
  box.innerHTML = `<div class="ar"><video playsinline muted></video><canvas></canvas>
    <div class="ar-msg" id="arMsg"></div><div class="ar-diag" id="arDiag"></div>
    <div class="ar-read" id="arRead"></div>
    <div class="ar-tools"><button id="arLock">📌 고정</button><button id="arHt">🌳 높이</button><button id="arRings" class="on">◎ 거리선</button></div>
    <div class="ar-bar"><button class="btn small" id="arCal">🎯 깃발 맞추기</button><button class="btn small" id="arReset" title="방위 보정 지우기">↺</button><button class="btn small" id="arChk">🩺 점검</button><span id="arAcc"></span></div></div>`;
  const video = box.querySelector('video'), cv = box.querySelector('canvas'), msg = box.querySelector('#arMsg'), acc = box.querySelector('#arAcc');
  let stopCam = null, raf = 0, alive = true, calib = false;
  let yaw = 0; try { yaw = +localStorage.getItem(YAW_KEY) || 0; } catch {}
  let a = null, b = null, g = null;
  // 실기기 점검용: 방향 센서 이벤트 빈도
  let evN = 0, evRate = 0, evT = performance.now();
  const unOri = onOrientation(() => { evN++; const now = performance.now(); if (now - evT >= 1000) { evRate = evN * 1000 / (now - evT); evN = 0; evT = now; } });
  let diagOn = false, lockPt = null, ringsOn = true, ht = null, readT = 0, aim = null;
  try { await requestMotionPermission(); } catch {}
  startOrientation();
  let camState = 'prompt';
  try { camState = (await navigator.permissions.query({ name: 'camera' })).state; } catch {}
  if (camState === 'prompt') {
    msg.innerHTML = `📷 <b>카메라를 쓸게요</b><br><small>앞을 비추면 그 자리까지 거리·방향을 보여 줘요. 사진은 저장하지 않고 이 휴대폰 밖으로 보내지 않아요.</small><br><button class="btn small" id="camOk" style="margin-top:8px">확인</button>`;
    msg.classList.add('show');
    await new Promise(r => { box.querySelector('#camOk').onclick = r; });
    msg.classList.remove('show');
  }
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
    if (sc.landing && sc.apex) { // 빛나는 궤적
      const d = distance(from, sc.landing), br = bearing(from, sc.landing), arc = [];
      for (let i = 1; i <= 40; i++) { const t = i / 40, q = project(R, enuOf(sc.me, destination(from, br, d * t), { eye, dz: 4 * sc.apex * t * (1 - t) }), opt); if (q.visible && q.depth > 2) arc.push(q); }
      if (arc.length > 1) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(94,230,168,.35)'; ctx.lineWidth = 14; ctx.beginPath(); arc.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
      }
    }
    if (sc.landing) { path(from, sc.landing, 'rgba(255,226,122,.55)', 5, []); if (sc.pin && distance(sc.landing, sc.pin) > 3) path(sc.landing, sc.pin, 'rgba(255,255,255,.85)', 3, [8, 8], sc.dzPin || 0); }
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
    rangefinder(sc, R, ax, opt, eye, f);
    if (diagOn) diag(sc, ax);
    acc.textContent = `GPS ±${Math.round(sc.me.acc || 0)}m · 방위 ${Math.round(ax.bearing)}°${Sensors.compassAcc != null ? ` (±${Math.round(Sensors.compassAcc)}°)` : ''}${yaw ? ` · 보정 ${yaw > 0 ? '+' : ''}${yaw.toFixed(1)}°` : ''}`;
  }
  // ---------- 📐 레인지파인더 ----------
  const CLUBN = c => c.id;
  const clubFor = d => { if (!getScene()?.clubOk) return null; return clubFor0(d); };
  const clubFor0 = d => { const cs = (S.bag || []).filter(c => c.enabled !== false && c.carry > 0).sort((p, q) => p.carry - q.carry); return cs.find(c => c.carry >= d * 0.97) || cs.at(-1); };
  const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const compass = b => DIRS[Math.round(b / 45) % 8];
  function rangefinder(sc, R, ax, opt, eye, f) {
    const W = box.clientWidth, H = box.clientHeight, rx = W / 2, ry = Math.round(H * 0.44);
    const D = sc.pin ? distance(sc.me, sc.pin) : null, slope = D && sc.dzPin ? sc.dzPin / D : 0;
    // 지면 거리 링: 내 앞 ±35° 호, 핀 방향 경사 반영
    if (ringsOn) {
      // 화면에서 22px 이상 떨어진 링만 (가까운 곳은 촘촘히, 먼 곳은 듬성듬성)
      const cand = [5, 10, 15, 20, 30, 40, 50, 75, 100, 125, 150, 200, 250, 300].filter(r => !D || r <= D + 60);
      let lastY = Infinity;
      for (const r of cand) {
        const mid = project(R, enuOf(sc.me, destination(sc.me, ax.bearing, r), { eye, dz: slope * r }), opt);
        if (!mid.visible || mid.depth < 2 || mid.y > H - 140 || lastY - mid.y < 22) continue;
        lastY = mid.y;
        const pts = [];
        for (let a = -35; a <= 35; a += 2.5) { const q = project(R, enuOf(sc.me, destination(sc.me, ax.bearing + a, r), { eye, dz: slope * r }), opt); if (q.visible && q.depth > 2) pts.push(q); }
        if (pts.length < 3) continue;
        const major = r % 50 === 0;
        ctx.strokeStyle = major ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.45)'; ctx.lineWidth = major ? 2 : 1.2; ctx.setLineDash(major ? [] : [5, 6]);
        ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); ctx.setLineDash([]);
        const lp = pts.reduce((m, q) => (Math.abs(q.x - W * 0.7) < Math.abs(m.x - W * 0.7) ? q : m)), c = clubFor(r);
        if (lp.y > 110 && (lp.y < ry - 14 || lp.y > ry + 150)) tag(Math.min(W - 128, lp.x), lp.y - 10, `${r}m${c ? ' · ' + CLUBN(c) : ''}`);
      }
    }
    // 나침반 띠 (위쪽): 10° 눈금 · 깃발/해저드 표시
    compassTape(sc, ax, W);
    // 조준 광선
    const v = unproject(R, rx, ry, opt), gh = groundHit(v, { eye, slope });
    // 대상 스냅: 조준선 근처(36px)에 깃발·그린 앞뒤·해저드·떨어질 곳·내 공이 있으면 GPS 거리 사용 (지면 추정보다 훨씬 정확)
    const cands = [];
    if (sc.pin) cands.push({ p: sc.pin, name: '⛳ 깃발', dz: sc.dzPin || 0 });
    if (sc.hole?.front) cands.push({ p: sc.hole.front, name: '그린 앞', dz: sc.dzPin || 0 });
    if (sc.hole?.back) cands.push({ p: sc.hole.back, name: '그린 뒤', dz: sc.dzPin || 0 });
    for (const z of sc.hazards || []) cands.push({ p: z, name: { ob: 'OB', water: '💧 물', bunker: '🏖 벙커', trees: '🌳 숲' }[z.type] || '해저드', dz: 0, r: z.r });
    if (sc.landing) cands.push({ p: sc.landing, name: '🎯 추천 지점', dz: 0 });
    if (sc.ball) cands.push({ p: sc.ball, name: '⚪ 내 공', dz: 0 });
    if (lockPt) cands.push({ p: lockPt, name: '📌 고정점', dz: 0 });
    let snap = null, best = 36;
    for (const c of cands) { const q = project(R, enuOf(sc.me, c.p, { eye, dz: c.dz }), opt); if (!q.visible) continue; const d = Math.hypot(q.x - rx, q.y - ry); if (d < best) { best = d; snap = { ...c, q }; } }
    const brg = gh.bearing, rel = sc.pin ? normAngle(brg - bearing(sc.me, sc.pin)) : null;
    let dist, err, pt;
    if (snap) { dist = distance(sc.me, snap.p); err = sc.me.acc || 5; pt = snap.p; }
    else if (isFinite(gh.h) && gh.h < 400) { dist = gh.h; err = gh.err; pt = destination(sc.me, brg, gh.h); }
    aim = pt ? { p: pt, dist, name: snap?.name || null } : null;
    // 조준선
    const col = snap ? '#5ee6a8' : '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 4; reticle(rx, ry); ctx.strokeStyle = col; ctx.lineWidth = 2; reticle(rx, ry);
    if (snap) { ctx.strokeStyle = '#5ee6a8'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(snap.q.x, snap.q.y, 14, 0, 7); ctx.stroke(); }
    // 고정점 표시
    if (lockPt) { const q = project(R, enuOf(sc.me, lockPt, { eye, dz: slope * distance(sc.me, lockPt) }), opt); if (q.visible) { ctx.fillStyle = '#ffc83d'; ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, 7); ctx.fill(); tag(q.x + 10, q.y - 8, `📌 ${Math.round(distance(sc.me, lockPt))}m`); } }
    // 숫자 판 (초당 8번 갱신)
    const now = performance.now(); if (now - readT < 120) return; readT = now;
    const read = box.querySelector('#arRead');
    const too = !snap && (!isFinite(gh.h) || gh.h >= 400 || err > Math.max(8, dist * 0.35));
    const club = !too && dist ? clubFor(dist) : null;
    const toPin = pt && sc.pin && !(snap && snap.p === sc.pin) ? distance(pt, sc.pin) : null;
    let htLine = '';
    if (ht?.base) {
      const th = Math.atan2(v.z, Math.hypot(v.x, v.y));
      const hgt = ht.base.d * (Math.tan(th) - Math.tan(ht.base.th));
      htLine = `<div class="ar-ht">🌳 높이 <b>${Math.max(0, hgt).toFixed(1)}m</b> <small>(${Math.round(ht.base.d)}m 앞 · 꼭대기를 조준하고 [높이]를 다시 누르면 확정)</small></div>`;
    } else if (ht?.done) htLine = `<div class="ar-ht">🌳 높이 <b>${ht.done.h.toFixed(1)}m</b> <small>${Math.round(ht.done.d)}m 앞 · ${esc(ht.done.note)}</small></div>`;
    else if (ht) htLine = '<div class="ar-ht">🌳 나무·벽의 <b>밑동</b>을 조준하고 [높이]를 누르세요</div>';
    read.innerHTML = `<div class="ar-big">${too ? `<span class="far">${!isFinite(gh.h) || gh.h >= 400 ? '하늘·먼 곳' : '너무 멀어요'}</span>` : `${snap ? `<em>${esc(snap.name)}</em>` : '<em>조준한 곳</em>'}<b>${Math.round(dist)}</b><small>m</small>${snap ? '' : `<i>±${Math.round(err)}</i>`}${club ? `<u>${esc(CLUBN(club))}</u>` : ''}`}</div>
      <div class="ar-sub"><span>🧭 ${compass(brg)} ${Math.round(brg)}°</span>${rel != null ? `<span>${Math.abs(rel) < 1 ? '깃발 방향 ✓' : `깃발보다 ${rel > 0 ? '오른쪽' : '왼쪽'} ${Math.abs(rel).toFixed(1)}°`}</span>` : ''}<span>${gh.elev >= 0 ? '⬆' : '⬇'} ${Math.abs(gh.elev).toFixed(1)}°</span>${toPin != null ? `<span>⛳까지 ${Math.round(toPin)}m</span>` : ''}${snap && snap.p === sc.pin && sc.dzPin ? `<span>고저 ${sc.dzPin > 0 ? '+' : ''}${sc.dzPin.toFixed(1)}m</span>` : ''}</div>
      ${too ? '<div class="ar-hint">멀리는 깃발·벙커·물 표시에 조준선을 맞추면 GPS 거리가 나와요</div>' : ''}${htLine}`;
  }
  function reticle(x, y) { ctx.beginPath(); ctx.arc(x, y, 18, 0, 7); ctx.moveTo(x - 34, y); ctx.lineTo(x - 22, y); ctx.moveTo(x + 22, y); ctx.lineTo(x + 34, y); ctx.moveTo(x, y - 34); ctx.lineTo(x, y - 22); ctx.moveTo(x, y + 22); ctx.lineTo(x, y + 34); ctx.stroke(); ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); }
  function tag(x, y, t) { ctx.font = '800 12px system-ui, sans-serif'; const w = ctx.measureText(t).width + 10; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x, y - 9, w, 18); ctx.fillStyle = '#fff'; ctx.fillText(t, x + 5, y + 4); }
  function compassTape(sc, ax, W) {
    const y = 84, span = 60, px = W / span; // 화면 너비 = 60°
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, y - 14, W, 30);
    ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (let d = Math.ceil((ax.bearing - span / 2) / 5) * 5; d <= ax.bearing + span / 2; d += 5) {
      const x = W / 2 + normAngle(d - ax.bearing) * px, dd = (d + 360) % 360, major = dd % 10 === 0;
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + 16); ctx.lineTo(x, y + (major ? 6 : 10)); ctx.stroke();
      if (dd % 45 === 0) { ctx.fillStyle = '#ffc83d'; ctx.fillText(DIRS[dd / 45], x, y + 2); } else if (dd % 30 === 0) { ctx.fillStyle = '#fff'; ctx.fillText(String(dd), x, y + 2); }
    }
    const mk = (p, icon, color) => { const r = normAngle(bearing(sc.me, p) - ax.bearing); const x = W / 2 + Math.max(-span / 2, Math.min(span / 2, r)) * px; ctx.fillStyle = color; ctx.fillText(icon + (Math.abs(r) > span / 2 ? (r > 0 ? '▶' : '◀') : ''), x, y - 18); };
    if (sc.pin) mk(sc.pin, '⛳', '#fff');
    ctx.fillStyle = '#5ee6a8'; ctx.beginPath(); ctx.moveTo(W / 2, y + 16); ctx.lineTo(W / 2 - 6, y + 24); ctx.lineTo(W / 2 + 6, y + 24); ctx.fill();
    ctx.textAlign = 'left';
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  box.querySelector('#arLock').onclick = e => {
    if (lockPt) { lockPt = null; e.target.classList.remove('on'); e.target.textContent = '📌 고정'; return; }
    if (!aim) return;
    lockPt = { lat: aim.p.lat, lon: aim.p.lon }; e.target.classList.add('on'); e.target.textContent = '📌 풀기';
    onLock && onLock(lockPt);
  };
  box.querySelector('#arHt').onclick = e => {
    if (!ht) { ht = {}; e.target.classList.add('on'); return; }
    if (ht.done) { ht = null; e.target.classList.remove('on'); return; }
    if (!last.R) return;
    const W = box.clientWidth, H = box.clientHeight, v = unproject(last.R, W / 2, Math.round(H * 0.44), last.opt), th = Math.atan2(v.z, Math.hypot(v.x, v.y));
    if (!ht.base) { if (!aim) return; ht.base = { d: aim.dist, th }; return; }
    const h = Math.max(0, ht.base.d * (Math.tan(th) - Math.tan(ht.base.th)));
    // 넘길 수 있는지: 그 거리에서 웨지·아이언 공 높이 대략 (탄도 약 1/4~1/3)
    ht.done = { h, d: ht.base.d, note: h > ht.base.d * 0.35 ? '넘기기 어려워요 · 옆으로 돌아가세요' : h > ht.base.d * 0.18 ? '높은 탄도(웨지·9번)면 넘어가요' : '대부분 클럽으로 넘어가요' };
  };
  box.querySelector('#arRings').onclick = e => { ringsOn = !ringsOn; e.target.classList.toggle('on', ringsOn); };

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
