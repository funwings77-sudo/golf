// 📷 카메라 화면 (기본 화면): 실제 풍경 위에 입체 지도 · 공 비행 · 지도를 한 화면에
//  · 입체 지도: 땅 높이(고도 타일 + 그린 측량 격자) 위에 지형 격자 · 페어웨이 양쪽 끝 · 그린 · 해저드를 덮어 그림
//    → 거리선·추천 길·깃발·공 표시가 모두 실제 땅 높이에 붙음
//  · 공 비행: 탄도 모델(공 속도·발사각·스핀·바람·공기 밀도)로 계산한 3D 궤적 · [▶ 공 날려 보기] 실제 시간 재생 · 친 직후 저절로 한 번
//  · 지도: 오른쪽 위 작은 위성 지도 → 휴대폰을 아래로 내리면(땅을 보면) 화면 전체가 지도, 세우면 다시 카메라
//  · 정밀도: 회전행렬(α·β·γ) 투영 + 표시 영상의 실제 초점거리(object-fit 보정) + 방위 1탭 보정 + 흔들림 완화
//           조준한 곳 거리 = 시선과 실제 지형이 만나는 곳 (평지 가정 대신 지형을 따라 광선 추적)
import { openCamera, coverTransform, zoomed, attachZoom } from '../core/camera.js';
import { Sensors, startOrientation, requestMotionPermission, onOrientation } from '../core/sensors.js';
import { rotationMatrix, project, enuOf, focalPx, cameraAxis, yawCorrection, smoothAngle, unproject, groundHit, rayHit } from '../core/arproj.js';
import { distance, bearing, destination, normAngle, geodesic } from '../core/geo.js';
import { S } from '../core/state.js';
import { loadTerrain } from '../core/terrain.js';
import { playsLike } from '../core/weather.js';
import { buildHorizon, visibleIn } from '../core/horizon.js';
import { FlightSpotter, AngleTrack, fitTrajectory, ImpactListener, fuseHitTime } from '../core/balltrack.js';
import { BallDetector } from '../core/camera.js';
import { curvDrop } from '../core/arproj.js';
import { flightPath, flightAt } from '../physics/flight3d.js';
import { openFlagCam } from './flagcam.js';
import { drawRich, richWidth } from '../canvasicon.js';

const YAW_KEY = 'pinpoint.arYaw';
const HZ = { ob: ['OB', 'rgba(255,255,255,.12)', '#ffffff'], water: ['💧물', 'rgba(64,160,255,.30)', '#58b4ff'], bunker: ['🏖벙커', 'rgba(240,214,150,.32)', '#f3dc9a'], trees: ['🌳숲', 'rgba(30,110,60,.30)', '#4fbf7a'] };

export async function startAR(box, getScene, { onLock = null, onPin = null, onMapEl = null, onMapMode = null, onHeading = null, onFail = null, views = [], onView = null, onTrack = null, onBallSeen = null } = {}) {
  box.innerHTML = `<div class="ar"><video playsinline muted></video><canvas></canvas>
    <div class="ar-map mini" id="arMap"><div class="ar-map-in"></div><button class="ar-map-catch" id="arMapCatch" aria-label="지도 크게 보기"></button><button class="ar-map-close" id="arMapClose">📷 카메라로</button></div>
    <div class="ar-msg" id="arMsg"></div><div class="ar-diag" id="arDiag"><div class="ar-diag-h"><b>🩺 AR 점검</b><button id="arDiagX" aria-label="점검 닫기">✕ 닫기</button></div><div class="ar-diag-b" id="arDiagB"></div></div>
    <button class="cam-zoom ar-zoom" id="arZoomB" aria-label="화면 확대">1×</button>    <div class="ar-nav" id="arNav" hidden></div><div class="ar-poi" id="arPoi" hidden></div><div class="ar-warn" id="arWarn" hidden role="status"></div>
    <div class="ar-read" id="arRead"></div><div class="ar-walk" id="arWalk" hidden></div><div class="ar-trk" id="arTrk" hidden></div><div class="ar-fly" id="arFlyInfo"></div><input type="range" class="ar-slide" id="arT" min="0" max="1000" value="0" aria-label="공 비행 시간" hidden>
    <button class="ar-tbtn" id="arTools" aria-label="카메라 도구" aria-expanded="false">🛠</button>
    <button class="ar-chip" id="arAim0" hidden>⊙ 가운데로</button>
    <div class="ar-tray" id="arTray" hidden>
      <div class="ar-tray-h">카메라 도구 <small>켜기/끄기는 그대로 두고, 나머지는 누르면 닫혀요</small></div>
      <div class="ar-tray-g">
        <button id="arTrack" class="track">🎥 친 공 따라가기</button><button id="arFly" class="fly">▶ 공 날려 보기</button><button id="arFlag" class="flag">🚩 깃대로 재기</button>
        <button id="arTer" class="on" data-keep>⛰️ 지형</button><button id="arRings" class="on" data-keep>◎ 거리선</button>
        <button id="arLock">📌 고정</button><button id="arHt">🌳 높이</button>
        <button id="arCal">🎯 깃발 맞추기</button><button id="arReset">↺ 보정 지우기</button>
        <button id="arChk">🩺 점검</button>
      </div>
      <div class="ar-tray-v" id="arViews"></div>
    </div>
    <div class="ar-bar"><span id="arAcc"></span></div></div>`;
  const root = box.querySelector('.ar'), video = box.querySelector('video'), cv = box.querySelector('canvas'), msg = box.querySelector('#arMsg'), acc = box.querySelector('#arAcc');
  const mapBox = box.querySelector('#arMap'), flyInfo = box.querySelector('#arFlyInfo'), slider = box.querySelector('#arT');
  let stopCam = null, raf = 0, alive = true, calib = false;
  let yaw = 0; try { yaw = +localStorage.getItem(YAW_KEY) || 0; } catch {}
  let a = null, b = null, g = null;
  let evN = 0, evRate = 0, evT = performance.now();
  const unOri = onOrientation(() => { evN++; const now = performance.now(); if (now - evT >= 1000) { evRate = evN * 1000 / (now - evT); evN = 0; evT = now; } });
  const AIM0 = { x: 0.5, y: 0.40 };
  let aimAt = { ...AIM0 }; // 🎯 조준점 (화면 비율): 손가락으로 끌거나 누른 곳으로 옮김
  const aimXY = () => { const W = box.clientWidth, H = box.clientHeight; return { rx: Math.round(Math.max(40, Math.min(W - 40, aimAt.x * W))), ry: Math.round(Math.max(130, Math.min(H - 240, aimAt.y * H))) }; };
  let diagOn = false, lockPt = null, ringsOn = true, terrOn = true, ht = null, readT = 0, aim = null, lastHit = null;

  // ---------- 🛠 카메라 도구: 버튼 하나 → 판 (화면을 가리지 않게) ----------
  const tray = box.querySelector('#arTray'), tBtn = box.querySelector('#arTools');
  const setTray = on => { tray.hidden = !on; tBtn.classList.toggle('on', on); tBtn.setAttribute('aria-expanded', String(on)); };
  tBtn.onclick = e => { e.stopPropagation(); setTray(tray.hidden); };
  // 한 번 쓰는 도구는 누르면 판을 닫음 (켜기/끄기 도구는 data-keep으로 열어 둠)
  tray.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.hasAttribute('data-keep')) setTimeout(() => setTray(false), 0); });
  box.addEventListener('pointerdown', e => { if (!tray.hidden && !tray.contains(e.target) && e.target !== tBtn) setTray(false); });
  const vBox = box.querySelector('#arViews');
  if (views.length && onView) {
    vBox.innerHTML = `<div class="ar-tray-h">화면 바꾸기</div><div class="ar-tray-g">${views.map(([k, t]) => `<button data-view="${k}">${t}</button>`).join('')}</div>`;
    vBox.querySelectorAll('[data-view]').forEach(b => b.onclick = () => onView(b.dataset.view));
  }

  // ---------- 🎥 친 공 따라가기 · 🎤 임팩트 소리 · 📷 가까이 공 찾기 ----------
  let trk = null, trkFit = null, trkFitAt = 0, trkBad = null, trkLiveTs = null, nearDet = null, nearN = 0, nearSeen = null;
  const impact = new ImpactListener();
  // ⏱️ 프레임 촬영 시각 (단속기의 GPS 시각 동기처럼): 화면 그리는 시각이 아니라 카메라가 찍은 시각을 씀
  //   · 같은 프레임을 두 번 보지 않음(화면 60Hz · 카메라 30fps) · 소리 시각과 같은 시계(performance.now)
  let vf = { t: 0, n: -1 };
  if (video.requestVideoFrameCallback) {
    const onVF = (now, md) => {
      const ct = md.captureTime, t = Number.isFinite(ct) && Math.abs(now - ct) < 1000 ? ct : (md.expectedDisplayTime || now);
      vf = { t, n: md.presentedFrames ?? vf.n + 1 };
      if (alive) video.requestVideoFrameCallback(onVF);
    };
    video.requestVideoFrameCallback(onVF);
  }
  function armTrack(sec = 60, why = 'button') {
    trk = { until: performance.now() + sec * 1000, spot: new FlightSpotter({ width: 240 }), at: new AngleTrack(), last: 0, why, frameN: -1 };
    impact.start().then(ok => { if (trk) trk.mic = ok; });
    box.querySelector('#arTrack').classList.add('on'); box.querySelector('#arTrack').textContent = '⏹ 따라가기 멈춤';
  }
  function disarm() { trk = null; impact.stop(); const b = box.querySelector('#arTrack'); b.classList.remove('on'); b.textContent = '🎥 친 공 따라가기'; box.querySelector('#arTrk').hidden = !trkFit; }
  box.querySelector('#arTrack').onclick = () => (trk ? disarm() : armTrack(60));

  // ---------- 🗺️ 지도 (작게 ↔ 전체) ----------
  let mapFull = false, mapManual = false, lowSince = 0, highSince = 0;
  onMapEl && onMapEl(mapBox.querySelector('.ar-map-in'));
  function setMap(full, manual = false) {
    mapManual = manual;
    if (full === mapFull) return;
    mapFull = full; mapBox.classList.toggle('full', full); mapBox.classList.toggle('mini', !full); root.classList.toggle('mapfull', full);
    onMapMode && onMapMode(full);
  }
  box.querySelector('#arMapCatch').onclick = () => setMap(true, true);
  box.querySelector('#arMapClose').onclick = () => setMap(false, true);

  try { await requestMotionPermission(); } catch {}
  startOrientation();
  let camState = 'prompt';
  try { camState = (await navigator.permissions.query({ name: 'camera' })).state; } catch {}
  if (camState === 'prompt') {
    msg.innerHTML = `📷 <b>카메라를 쓸게요</b><br><small>앞을 비추면 실제 땅 위에 거리·공이 날아갈 길·떨어질 곳을 보여 줘요. 휴대폰을 내리면 지도가 나와요. 사진은 저장하지 않고 휴대폰 밖으로 보내지 않아요.</small><br><button class="btn small" id="camOk" style="margin-top:8px">확인</button>`;
    msg.classList.add('show');
    await new Promise(r => { box.querySelector('#camOk').onclick = r; });
    msg.classList.remove('show');
  }
  try { stopCam = await openCamera(video); }
  catch (e) {
    msg.innerHTML = `📷 카메라를 켤 수 없어요<br><small>${e.name === 'NotAllowedError' ? '카메라 권한을 허용해 주세요' : esc(e.message)} · 지도로 보여 드릴게요</small>`; msg.classList.add('show');
    if (onFail) { setTimeout(() => alive && onFail(e), 1800); }
  }

  // ---------- ⛰️ 땅 높이 ----------
  let terr = null, terrKey = '', terrLoading = false, geoCache = null;
  function ensureTerrain(sc) {
    const h = sc.hole, key = `${h?.n}|${sc.me.lat.toFixed(3)},${sc.me.lon.toFixed(3)}|${h?.greenGrid ? 1 : 0}`, farKey = `${sc.me.lat.toFixed(2)},${sc.me.lon.toFixed(2)}`;
    if (key === terrKey || terrLoading) return;
    terrLoading = true;
    const pts = [sc.me, h?.tee, h?.ip, h?.green, h?.front, h?.back, sc.pin, ...(h?.hazards || [])].filter(Boolean);
    void farKey; loadTerrain(pts, { greenGrid: h?.greenGrid, far: sc.me }).then(t => { terr = t; terrKey = key; geoCache = null; }).catch(() => { terrKey = key; }).finally(() => { terrLoading = false; });
  }
  // 내 발밑 기준 높이(m): 지형이 있으면 지형, 없으면 깃발 쪽만 고저차(dzPin), 나머지는 평지
  let meZ = 0, meZFor = null;
  const hgt = (p, sc) => {
    if (terr) {
      if (meZFor !== sc.me) { meZ = terr(sc.me.lat, sc.me.lon); meZFor = sc.me; }
      const v = terr(p.lat, p.lon);
      if (Number.isFinite(v) && Number.isFinite(meZ)) return v - meZ;
    }
    return sc.pin && p === sc.pin ? sc.dzPin || 0 : 0;
  };

  // ⛰️ 능선·가려짐 (core/horizon.js): 지형이 있을 때 뒤에서 계산
  let hz = null, hzBusy = false, hzTerr = null;
  function ensureHorizon(sc, eye) {
    if (!terr || hzBusy || !alive) return;
    if (hz && hzTerr === terr && distance(hz.me, sc.me) < 30) return;
    hzBusy = true; const t0 = terr, me = { lat: sc.me.lat, lon: sc.me.lon };
    buildHorizon({ me, eye, hgt: p => hgt(p, { ...sc, me }) }).then(h => { if (alive && t0 === terr) { hz = h; hzTerr = t0; geoCache = null; } }).catch(() => {}).finally(() => { hzBusy = false; });
  }
  // 이 점이 내 눈에 보이나 (앞 언덕에 가려지면 false) · zRel = 발밑 기준 높이
  const seen = (sc, p, zRel, eye) => {
    if (!hz) return true;
    const s = distance(sc.me, p); if (s < 30) return true;
    return visibleIn(hz.at(bearing(sc.me, p)), s, (zRel - curvDrop(s) - eye) / s);
  };

  const ctx = cv.getContext('2d');
  let last = { R: null, f: 0, cx: 0, cy: 0 };
  let flight = null, flightKey = '', anim = null, autoTs = null;
  const camZoom = attachZoom(box.querySelector('.ar'), video, box.querySelector('#arZoomB'), 'pinpoint.arZoom'); // 🔍 두 손가락·버튼으로 확대
  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = box.clientWidth, H = box.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    labQ = [];
    const sc = getScene();
    if (!sc?.me) { say('📍 위치를 찾는 중이에요…'); return; }
    ensureTerrain(sc);
    if (Sensors.alphaAbs == null || Sensors.beta == null) { say('🧭 방향 센서를 기다려요…<br><small>휴대폰을 8자 모양으로 한두 번 돌려 주세요 · 🩺 점검을 눌러 원인을 볼 수 있어요</small>'); if (diagOn) diag(sc, { bearing: 0, pitch: 0 }); return; }
    a = smoothAngle(a, (Sensors.alphaAbs + yaw + 360) % 360, 0.2);
    b = b == null ? Sensors.beta : b + (Sensors.beta - b) * 0.25;
    g = g == null ? Sensors.gamma : g + (Sensors.gamma - g) * 0.25;
    const R = rotationMatrix(a, b, g), ax = cameraAxis(R), now = performance.now();
    if (onHeading && now - (frame._hT || 0) > 120) { frame._hT = now; onHeading(ax.bearing); }
    // 휴대폰을 내리면 지도, 세우면 카메라 (손으로 바꾼 뒤에는 그대로 두다가 다시 세우면 자동으로)
    if (ax.pitch < -55) { highSince = 0; lowSince ||= now; if (!mapManual && !mapFull && now - lowSince > 350) setMap(true); }
    else if (ax.pitch > -38) { lowSince = 0; highSince ||= now; if (now - highSince > 350) { if (mapManual && !mapFull) mapManual = false; if (!mapManual && mapFull) setMap(false); } }
    if (mapFull) { hide(); return; } // 지도만 보일 때는 카메라 위 그림을 쉼 (배터리)
    const t = zoomed(video.videoWidth ? coverTransform(video, box) : { s: 1, ox: 0, oy: 0, vw: W, vh: H }, camZoom?.z || 1); // 🔍 확대 배율만큼 선·위치도
    const f = focalPx(S.settings.cameraVFov || 63, t.vh) * t.s, cx = t.ox + t.vw * t.s / 2, cy = t.oy + t.vh * t.s / 2;
    const so = (screen.orientation && screen.orientation.angle) || 0;
    const opt = { f, cx, cy, screenAngle: so };
    last = { R, f, cx, cy, opt };
    const eye = S.settings.phoneHeight || 1.45;
    const E = (p, extra = 0) => enuOf(sc.me, p, { eye, dz: hgt(p, sc) + extra });
    const P = (p, extra = 0) => project(R, E(p, extra), opt);
    if (ax.pitch < -40) say('📱 더 내리면 지도 · 세우면 카메라'); else if (calib) say('👆 화면에서 <b>진짜 깃발</b>을 눌러 주세요'); else hide();
    // 지평선
    const h1 = project(R, { x: Math.sin((ax.bearing - 40) * Math.PI / 180) * 3000, y: Math.cos((ax.bearing - 40) * Math.PI / 180) * 3000, z: 0 }, opt);
    const h2 = project(R, { x: Math.sin((ax.bearing + 40) * Math.PI / 180) * 3000, y: Math.cos((ax.bearing + 40) * Math.PI / 180) * 3000, z: 0 }, opt);
    if (h1.visible && h2.visible) { ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([6, 8]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(h1.x, h1.y); ctx.lineTo(h2.x, h2.y); ctx.stroke(); ctx.setLineDash([]); }
    // ⛰️ 입체 지도 (지형 격자 · 페어웨이 · 그린 · 해저드)
    ensureHorizon(sc, eye);
    if (terrOn) drawTerrain(sc, R, opt, eye);
    if (hz) drawRidges(sc, R, opt, ax, eye);
    // 추천 길: 공 → 떨어질 곳 (땅 위 노란 띠) → 깃발 (흰 점선) — 지형을 따라
    const path = (from, to, color, w, dash) => {
      const d = distance(from, to), br = bearing(from, to), pts = [];
      for (let s = Math.min(3, d); s <= d; s += Math.max(1.5, d / 60)) { const q = P(destination(from, br, s)); if (q.visible && q.depth > 1.5) pts.push(q); }
      line(pts, color, w, dash);
    };
    const from = sc.ball || sc.from || sc.me;
    // 🎬 공 비행 (탄도 모델)
    const plan = sc.live && Date.now() - sc.live.ts < 60000 ? sc.live : sc.plan;
    const key = plan ? `${plan.from.lat.toFixed(6)},${plan.from.lon.toFixed(6)}|${plan.aim.toFixed(1)}|${plan.club}|${Math.round(plan.stdCarry)}|${plan.wind?.windSpeed ?? 0}|${plan.wind?.windFrom ?? 0}` : '';
    if (key !== flightKey) { flightKey = key; try { flight = plan ? flightPath(plan) : null; } catch { flight = null; } }
    if (sc.live && sc.live.ts !== autoTs && Date.now() - sc.live.ts < 8000 && flight) { autoTs = sc.live.ts; playFlight(); } // 친 직후 한 번 저절로
    const landing = flight?.landing || sc.landing;
    if (landing) { path(from, landing, 'rgba(255,226,122,.55)', 5, []); if (sc.pin && distance(landing, sc.pin) > 3) path(landing, sc.pin, 'rgba(255,255,255,.85)', 3, [8, 8]); }
    else if (sc.pin) path(from, sc.pin, 'rgba(255,226,122,.95)', 6, []);
    if (flight) drawFlight(sc, R, opt, eye, f);
    trackStep(sc, R, opt, eye, f, t);
    walkStep(sc, R, opt, eye, f, t, ax);
    // 해저드 이름
    for (const z of sc.hazards || []) { const q = P(z); if (q.visible && q.depth < 400) label(q.x, q.y, `${HZ[z.type]?.[0] || ''} ${Math.round(distance(sc.me, z))}m`, 'rgba(0,0,0,.55)', 12, 1); }
    // 떨어질 곳
    if (landing && !anim) { const q = P(landing); if (q.visible) { ring(q.x, q.y, Math.max(10, f * 6 / q.depth)); label(q.x, q.y - 24, `🎯 떨어질 곳 ${Math.round(distance(sc.me, landing))}m`, 'rgba(160,120,0,.9)', 15, 2); } }
    // 내 공 (친 뒤)
    if (sc.ball) { const q = P(sc.ball); if (q.visible) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d93b2b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(7, f * 0.6 / q.depth), 0, 7); ctx.fill(); ctx.stroke(); label(q.x, q.y - 22, `⚪ 내 공 ${Math.round(distance(sc.me, sc.ball))}m`, 'rgba(217,59,43,.92)', 15, 3); } else edge(sc.ball, '내 공', ax); }
    // 깃발 (실제 깃대 2.1m)
    if (sc.pin) {
      const top = P(sc.pin, 2.1), base = P(sc.pin);
      if (base.visible) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
        ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x + 18, top.y + 7); ctx.lineTo(top.x, top.y + 14); ctx.fill();
        const dz = hgt(sc.pin, sc);
        label(top.x, top.y - 16, `⛳ 깃발 ${Math.round(distance(sc.me, sc.pin))}m${Math.abs(dz) >= 1 ? ` · ${dz > 0 ? '↑' : '↓'}${Math.abs(dz).toFixed(1)}m` : ''}`, 'rgba(31,95,63,.95)', 17, 3);
      } else edge(sc.pin, '깃발', ax);
    }
    rangefinder(sc, R, ax, opt, eye, f);
    flushLabels();
    navCards(sc, now);
    if (diagOn) diag(sc, ax);
    acc.textContent = `GPS ±${Math.round(sc.me.acc || 0)}m · 방위 ${Math.round(ax.bearing)}°${Sensors.compassAcc != null ? ` (±${Math.round(Sensors.compassAcc)}°)` : ''}${yaw ? ` · 보정 ${yaw > 0 ? '+' : ''}${yaw.toFixed(1)}°` : ''}${terr ? ' · ⛰️ 지형' : terrLoading ? ' · 지형 받는 중' : ''}`;
  }

  // ---------- ⛰️ 입체 지도: 지형 격자 · 페어웨이 양쪽 끝 · 그린 · 해저드 (땅에 붙여 그림) ----------
  //  모양(ENU 점)은 홀·위치·지형이 바뀔 때만 다시 만들고, 매 화면에서는 투영만
  function buildGeo(sc, eye) {
    const h = sc.hole, A = h?.tee || sc.me, B = h?.green || sc.pin;
    const out = { grid: [], edges: [], green: null, haz: [] };
    const E = p => enuOf(sc.me, p, { eye, dz: hgt(p, sc) });
    if (A && B && distance(A, B) > 20) {
      // 홀 중심선 (티 → IP → 그린)
      const center = [A, ...(h?.ip && distance(A, B) > distance(h.ip, B) + 20 ? [h.ip] : []), B];
      const seg = []; // 중심선을 4m마다
      for (let i = 0; i < center.length - 1; i++) { const d = distance(center[i], center[i + 1]), br = bearing(center[i], center[i + 1]); for (let s = 0; s < d; s += 4) seg.push({ p: destination(center[i], br, s), br }); }
      seg.push({ p: B, br: seg.at(-1)?.br ?? bearing(A, B) });
      const hw = h?.halfWidth || 16, W = hw + 30;
      // 페어웨이 양쪽 끝
      for (const side of [-1, 1]) out.edges.push(seg.map(s => { const p = destination(s.p, s.br + 90 * side, hw); return { e: E(p), p, z: hgt(p, sc) }; }));
      // 지형 격자: 홀 방향 줄(옆으로 10m마다) + 가로줄(앞으로 10m마다)
      for (let o = -W; o <= W + 0.1; o += 10) out.grid.push(seg.filter((_, i) => i % 2 === 0).map(s => { const p = destination(s.p, s.br + 90, o); return { e: E(p), p, z: hgt(p, sc) }; }));
      for (let i = 0; i < seg.length; i += 3) { const s = seg[i], row = []; for (let o = -W; o <= W + 0.1; o += 4) { const p = destination(s.p, s.br + 90, o); row.push({ e: E(p), p, z: hgt(p, sc) }); } out.grid.push(row); }
    }
    // 그린 (앞·뒤 거리로 반지름)
    const gC = h?.green || sc.pin;
    if (gC) { const r = h?.front && h?.back ? Math.max(8, distance(h.front, h.back) / 2 + 1) : 14; out.green = Array.from({ length: 37 }, (_, i) => E(destination(gC, i * 10, r))); }
    // 해저드 (원)
    for (const z of sc.hazards || []) out.haz.push({ type: z.type, pts: Array.from({ length: 25 }, (_, i) => E(destination(z, i * 15, z.r || 10))) });
    return out;
  }
  function drawTerrain(sc, R, opt, eye) {
    const key = `${sc.hole?.n}|${sc.me.lat.toFixed(5)},${sc.me.lon.toFixed(5)}|${terr ? 1 : 0}|${sc.pin?.lat}`;
    if (!geoCache || geoCache.key !== key) geoCache = { key, ...buildGeo(sc, eye) };
    const G = geoCache, pr = e => project(R, e, opt), FAR = 330;
    if (hz && G.visFor !== hz) { for (const ln of [...G.grid, ...G.edges]) for (const v of ln) v.vis = seen(sc, v.p, v.z, eye); G.visFor = hz; } // 언덕 뒤는 숨김
    // 지형 격자: 높이에 따라 색 (낮은 곳 하늘색 → 높은 곳 주황), 멀수록 흐리게 · 색별로 묶어 한 번에 그림
    const buckets = new Map();
    for (const ln of G.grid) {
      let prev = null;
      for (const v of ln) {
        const q = pr(v.e);
        if (prev && q.visible && prev.q.visible && q.depth < FAR && q.depth > 8 && v.vis !== false && prev.vis !== false) {
          const z = (v.z + prev.z) / 2, c = z < -4 ? 0 : z < -1.5 ? 1 : z < 1.5 ? 2 : z < 4 ? 3 : 4, al = Math.round(Math.max(0.1, 0.42 * (1 - q.depth / FAR) * Math.min(1, (q.depth - 8) / 20)) * 10);
          const k = c * 100 + al; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(prev.q, q);
        }
        prev = { q, z: v.z, vis: v.vis };
      }
    }
    const COLS = ['120,200,255', '150,225,255', '255,255,255', '255,214,140', '255,170,90'];
    ctx.lineWidth = 1;
    for (const [k, segs] of buckets) {
      ctx.strokeStyle = `rgba(${COLS[Math.floor(k / 100)]},${(k % 100) / 10})`; ctx.beginPath();
      for (let i = 0; i < segs.length; i += 2) { ctx.moveTo(segs[i].x, segs[i].y); ctx.lineTo(segs[i + 1].x, segs[i + 1].y); }
      ctx.stroke();
    }
    // 해저드 (채운 원)
    for (const z of G.haz) { const pts = z.pts.map(pr).filter(q => q.visible && q.depth < FAR); if (pts.length > 4) poly(pts, HZ[z.type]?.[1] || 'rgba(255,255,255,.15)', HZ[z.type]?.[2] || '#fff', z.type === 'ob' ? [6, 6] : []); }
    // 페어웨이 양쪽 끝 (라임색)
    for (const e of G.edges) runs(e.map(v => ({ q: pr(v.e), ok: v.vis !== false })).map(o => ({ ...o, ok: o.ok && o.q.visible && o.q.depth < FAR && o.q.depth > 2 })), 'rgba(200,241,105,.75)', 2.5, []);
    // 그린
    if (G.green) { const pts = G.green.map(pr).filter(q => q.visible); if (pts.length > 8) poly(pts, 'rgba(94,230,168,.22)', 'rgba(94,230,168,.95)', []); }
  }

  // ---------- 🎬 공 비행 ----------
  //  궤적 높이 = 친 곳 땅 높이 + 탄도 높이 (+ 떨어질 곳 땅 높이까지 시간에 따라 이어 붙임)
  const flightENU = (sc, eye, p, t) => {
    const z0 = hgt(flight.pts[0], sc), z1 = hgt(flight.landing, sc), k = Math.min(1, t / Math.max(0.01, flight.time));
    return enuOf(sc.me, p, { eye, dz: (p.h || 0) + (t <= flight.time ? z0 + (z1 - z0) * k : hgt(p, sc)) });
  };
  // 🎥 매 화면: 움직이는 작은 점 → 각도(친 곳에서 본) → 이어 붙이기 → 끝나면 탄도 모델에 맞춤
  function trackStep(sc, R, opt, eye, f, t) {
    if (sc.live && sc.live.ts !== trkLiveTs && Date.now() - sc.live.ts < 4000) { trkLiveTs = sc.live.ts; if (!trk) armTrack(12, 'hit'); } // 친 직후 12초 저절로
    const el = box.querySelector('#arTrk'), now = performance.now();
    if (trk) {
      const aim = sc.live?.aim ?? sc.plan?.aim ?? cameraAxis(R).bearing;
      // 새 프레임일 때만 (같은 프레임 두 번 = 차이 0 · 시각 어긋남) · 시각은 카메라가 찍은 시각
      const hasVF = vf.n >= 0, fresh = !hasVF || vf.n !== trk.frameN;
      if (fresh && video.videoWidth) {
        trk.frameN = vf.n;
        const ft = hasVF && now - vf.t < 500 ? vf.t : now;
        const cands = trk.spot.detect(video).map(c => {
          const v = unproject(R, t.ox + c.x * t.s, t.oy + c.y * t.s, opt);
          return { ...c, az: normAngle(Math.atan2(v.x, v.y) * 180 / Math.PI - aim), el: Math.asin(Math.max(-1, Math.min(1, v.z))) * 180 / Math.PI, sx: t.ox + c.x * t.s, sy: t.oy + c.y * t.s };
        });
        const o = trk.at.add(cands, ft, c => c.el > -1.5 && Math.abs(c.az) < 28);
        if (o) trk.last = now;
      }
      const obs = trk.at.obs;
      for (const q of obs) { const p = project(R, angDir(q.az + aim, q.el), opt); if (p.visible) { ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 7); ctx.fill(); } }
      el.hidden = false;
      el.innerHTML = `🎥 <b>공을 따라가는 중</b>${trk.mic ? ' · 🎤 소리 듣는 중' : ''}<br><small>${obs.length ? `✅ 공 궤적 확정 · 본 점 ${obs.length}개 · ${(obs.at(-1).t).toFixed(1)}초` : trk.at.candidates ? `🔎 후보 ${trk.at.candidates}개 확인 중 (3번 이어져야 확정)` : '공이 날아가는 쪽 하늘을 비춰 주세요'}</small>`;
      const ended = obs.length >= 6 && now - trk.last > 700, timeout = now > trk.until;
      if (ended || (timeout && obs.length >= 6)) {
        // ⏱️ 친 시각: 🎤 소리 ↔ ⌚ 스윙 이중 판정 (둘이 어긋나면 어느 쪽도 안 믿음)
        const mic = impact.last(trk.at.t0)?.t ?? null, swing = sc.swingTs ? performance.now() - (Date.now() - sc.swingTs) : null;
        const ok = x => x != null && trk.at.t0 - x >= 0 && trk.at.t0 - x < 8000;
        const hit = fuseHitTime(ok(mic) ? mic : null, ok(swing) ? swing : null);
        const from = sc.live?.from || sc.from || sc.me;
        const base = { club: sc.live?.club || sc.plan?.club || '7i', wind: sc.live?.wind || sc.plan?.wind, rho: sc.live?.rho || sc.plan?.rho, aim, from, guessCarry: sc.live?.stdCarry || sc.plan?.stdCarry, timingConflict: hit.conflict };
        if (hit.t != null) { base.tau0 = (trk.at.t0 - hit.t) / 1000; base.tauSd = hit.sd; }
        // 📐 설치 기하: 찍는 사람(내 휴대폰) 위치 = 친 곳 기준 오른쪽·앞·눈높이 (단속기의 설치 각도·높이 측량)
        const dd = geodesic(from, sc.me), bb = (bearing(from, sc.me) - aim) * Math.PI / 180;
        base.obsAt = { x: dd > 0.3 ? dd * Math.sin(bb) : 0, y: dd > 0.3 ? dd * Math.cos(bb) : 0, z: eye - hgt(from, sc) };
        const fit = fitTrajectory(obs, base);
        if (fit && fit.valid) { fit.timedBy = { both: '🎤 소리+⌚ 스윙', mic: '🎤 소리', swing: '⌚ 스윙' }[hit.src] || null; trkFit = fit; trkFitAt = now; trkBad = null; onTrack && onTrack(fit); }
        else if (fit) { trkBad = { reason: fit.reason, n: fit.n0, at: now }; try { navigator.vibrate?.(120); } catch {} }
        disarm();
      } else if (timeout) disarm();
    }
    // 🚫 측정 무효 (단속기처럼 결과를 버림 · 기록하지 않음) — 6초 알림
    if (!trk && trkBad && now - trkBad.at < 6000) {
      el.hidden = false;
      el.innerHTML = `🚫 <b>이번 추적은 쓰지 않아요</b><br><small>${esc(trkBad.reason)} · 본 점 ${trkBad.n}개 · 다음엔 공이 날아갈 하늘을 휴대폰을 고정하고 비춰 주세요</small>`;
      return;
    }
    // 맞춘 비행: 밝은 선 + 착지 · 숫자 판 (30초)
    if (trkFit && now - trkFitAt < 30000) {
      const F = trkFit, z0 = hgt(F.path[0], sc), z1 = hgt(F.landing, sc);
      const pts = F.path.map(q => project(R, enuOf(sc.me, q, { eye, dz: q.h + z0 + (z1 - z0) * Math.min(1, q.t / F.time) }), opt)).filter(q => q.visible && q.depth > 1);
      line(pts, 'rgba(255,90,60,.35)', 12, []); line(pts, '#ff5a3c', 3.5, []);
      const lq = project(R, enuOf(sc.me, F.landing, { eye, dz: z1 }), opt);
      if (lq.visible) { ring(lq.x, lq.y, Math.max(10, f * 5 / lq.depth)); label(lq.x, lq.y - 24, `🎯 착지 ${(Math.round(F.carry * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1 })}m ±${F.sd.toFixed(1)}`, 'rgba(200,60,40,.92)', 14, 2); }
      const f1 = x => x.toFixed(1);
      el.hidden = false;
      el.innerHTML = `<div class="trk-g"><span><small>공 속도</small><b>${f1(F.kmh)}km/h</b></span><span><small>발사 각</small><b>${f1(F.launch)}°</b></span><span><small>좌우</small><b>${Math.abs(F.sideDeg) < 0.05 ? '정면' : `${F.sideDeg > 0 ? '오른쪽' : '왼쪽'} ${f1(Math.abs(F.sideDeg))}°`}</b></span>
        <span><small>최고 높이</small><b>${f1(F.apex)}m</b></span><span><small>비행 시간</small><b>${F.time.toFixed(2)}초</b></span><span><small>착지 각</small><b>${f1(F.landAngle)}°</b></span>
        <span><small>공중 거리</small><b>${f1(F.carry)}m</b></span><span><small>멈출 거리</small><b>${f1(F.total)}m</b></span><span><small>오차</small><b>±${f1(F.sd)}m</b></span></div>
        <small>🔀 ${F.timedBy ? `${F.timedBy}(친 시각) + ` : ''}📷 카메라 각도 ${F.n}점 + 🧮 탄도 모델${F.timedBy ? '' : ` · ${F.timingConflict ? '🎤 소리와 ⌚ 스윙 시각이 안 맞아 친 시각을 빼고' : '친 시각을 몰라서'} ${f1(F.lo)}~${f1(F.hi)}m 범위`}</small>
        <small>✅ 검증 통과 · 각도 잔차 ${F.rms.toFixed(2)}°${F.rejected ? ` · 엉뚱한 점 ${F.rejected}개 버림` : ''}</small>`;
    } else if (!trk) el.hidden = true;
  }
  // 방위·올려다보는 각 → 먼 방향 점 (화면에 찍기용)
  const angDir = (az, elv) => { const a = az * Math.PI / 180, e = elv * Math.PI / 180; return { x: Math.sin(a) * Math.cos(e) * 1000, y: Math.cos(a) * Math.cos(e) * 1000, z: Math.sin(e) * 1000 }; };

  // ⚪ 공까지 걸어갈 때: 거리(0.1m)·방향·앞/옆·위치 계속 · 45m 안이면 📷 땅 위 흰 공 찾기
  function walkStep(sc, R, opt, eye, f, t, ax) {
    const el = box.querySelector('#arWalk');
    if (!sc.ball || !sc.live) { el.hidden = true; nearDet = null; return; }
    const d = geodesic(sc.me, sc.ball), rel = normAngle(bearing(sc.me, sc.ball) - ax.bearing), fwd = d * Math.cos(rel * Math.PI / 180), side = d * Math.sin(rel * Math.PI / 180);
    const clk = ((Math.round(((rel % 360) + 360) % 360 / 30) % 12) || 12);
    const f1 = x => (Math.round(x * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const SRC = { track: '🎥 공 추적', camera: '📷 카메라로 봄', course: '📷 골프장 카메라', pred: '🧮 예측' };
    el.hidden = false;
    el.innerHTML = `⚪ 내 공까지 <b>${f1(d)}m</b> · ${clk}시 방향<br><small>앞 ${f1(fwd)}m · ${side >= 0 ? '오른쪽' : '왼쪽'} ${f1(Math.abs(side))}m · ±${f1(sc.ballErr || 5)}m · ${(sc.ball.lat).toFixed(6)}°, ${(sc.ball.lon).toFixed(6)}° · ${SRC[sc.ballSrc] || '🧮 예측'}</small>`;
    // 📷 가까이(45m 안): 땅 위 흰 공 찾기 → 위치 합치기
    if (d > 45 || !video.videoWidth) { nearDet = null; return; }
    nearDet ||= new BallDetector({ width: 320 });
    if (nearN++ % 3) { if (nearSeen) { ctx.strokeStyle = '#5ee6a8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(nearSeen.x, nearSeen.y, 18, 0, 7); ctx.stroke(); } return; }
    const tr = nearDet.detect(video)[0];
    nearSeen = null; if (!tr) return;
    const sx = t.ox + tr.x * t.s, sy = t.oy + tr.y * t.s, v = unproject(R, sx, sy, opt);
    const gh = (terr && terrainHit(v, sc, eye)) || groundHit(v, { eye });
    if (!isFinite(gh.h) || gh.h > 60) return;
    const pos = destination(sc.me, gh.bearing, gh.h);
    if (geodesic(pos, sc.ball) > 2.5 * (sc.ballErr || 8) + 10) return; // 엉뚱한 흰 점 (예측과 너무 멀면 버림)
    nearSeen = { x: sx, y: sy };
    onBallSeen && onBallSeen(pos, Math.max(0.5, gh.err));
  }

  function drawFlight(sc, R, opt, eye, f) {
    const pr = (p) => project(R, flightENU(sc, eye, p, p.t), opt);
    const arc = flight.pts.map(pr).filter(q => q.visible && q.depth > 2);
    const tNow = anim ? anim.t : null;
    if (arc.length > 1) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = anim ? 'rgba(94,230,168,.18)' : 'rgba(94,230,168,.35)'; ctx.lineWidth = 14; ctx.beginPath(); arc.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke();
      ctx.strokeStyle = anim ? 'rgba(255,255,255,.35)' : '#ffffff'; ctx.lineWidth = anim ? 2 : 4; ctx.stroke();
    }
    // 굴러감 (점선)
    line([flight.landing, ...flight.roll].map(p => project(R, enuOf(sc.me, p, { eye, dz: hgt(p, sc) }), opt)).filter(q => q.visible), 'rgba(255,226,122,.9)', 2.5, [4, 5]);
    // 가장 높은 곳
    if (!anim) {
      const top = flight.pts.reduce((m, p) => (p.h > m.h ? p : m), flight.pts[0]), q = pr(top);
      if (q.visible && flight.apex > 3) tag(q.x + 8, q.y - 6, `최고 ${Math.round(flight.apex)}m`);
      const r = project(R, enuOf(sc.me, flight.rest, { eye, dz: hgt(flight.rest, sc) }), opt);
      if (r.visible) tag(r.x + 8, r.y + 4, `멈춤 ${Math.round(flight.total)}m`);
    }
    // 재생 중: 지나온 길(밝게) · 공 · 땅 그림자
    if (anim) {
      const pos = flightAt(flight, tNow), all = [...flight.pts, ...flight.roll];
      const trail = [...all.slice(0, pos.i), pos].map(p => project(R, flightENU(sc, eye, p, p.t ?? tNow), opt)).filter(q => q.visible && q.depth > 1);
      if (trail.length > 1) { ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); trail.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); }
      const q = project(R, flightENU(sc, eye, pos, tNow), opt), sh = project(R, enuOf(sc.me, pos, { eye, dz: hgt(pos, sc) }), opt);
      if (sh.visible) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(sh.x, sh.y, Math.max(4, f * 0.35 / sh.depth), Math.max(2, f * 0.12 / sh.depth), 0, 0, 7); ctx.fill(); }
      if (q.visible) { const rr = Math.max(5, Math.min(18, f * 0.3 / q.depth)); ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q.x, q.y, rr, 0, 7); ctx.fill(); ctx.stroke(); }
      const d = distance(flight.pts[0], pos);
      flyInfo.innerHTML = `<b>${Math.min(tNow, flight.totalTime).toFixed(1)}초</b> · 앞으로 <b>${Math.round(d)}m</b> · 높이 <b>${Math.max(0, pos.h || 0).toFixed(1)}m</b>${tNow >= flight.time ? ` · 공중 ${Math.round(flight.carry)}m${tNow >= flight.totalTime ? ` → 멈춤 ${Math.round(flight.total)}m` : ''}` : ''}`;
      flyInfo.classList.add('show');
      if (!anim.scrub) { anim.t = (performance.now() - anim.t0) / 1000; slider.value = Math.round(Math.min(1, anim.t / flight.totalTime) * 1000); }
      if (!anim.scrub && anim.t > flight.totalTime + 2.5) stopFlight();
    }
  }
  function playFlight() {
    if (!flight) return say('추천 클럽이 나오면 공 비행을 보여 드려요');
    anim = { t0: performance.now(), t: 0, scrub: false }; slider.hidden = false; root.classList.add('flying'); box.querySelector('#arFly').textContent = '⏹ 멈추기';
  }
  function stopFlight() { anim = null; root.classList.remove('flying'); flyInfo.classList.remove('show'); slider.hidden = true; box.querySelector('#arFly').textContent = '▶ 공 날려 보기'; }
  box.querySelector('#arFly').onclick = () => (anim ? stopFlight() : playFlight());
  slider.oninput = () => { if (!flight) return; if (!anim) playFlight(); anim.scrub = true; anim.t = slider.value / 1000 * flight.totalTime; };
  slider.onchange = () => { if (anim) { anim.scrub = false; anim.t0 = performance.now() - anim.t * 1000; } };
  box.querySelector('#arTer').onclick = e => { terrOn = !terrOn; e.target.classList.toggle('on', terrOn); };

  // ---------- 📐 레인지파인더 ----------
  const CLUBN = c => c.id;
  const clubFor = d => { if (!getScene()?.clubOk) return null; const cs = (S.bag || []).filter(c => c.enabled !== false && c.carry > 0).sort((p, q) => p.carry - q.carry); return cs.find(c => c.carry >= d * 0.97) || cs.at(-1); };
  const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const compass = bb => DIRS[Math.round(bb / 45) % 8];
  // 🔭 시선이 실제 지형과 만나는 곳 (최대 10km · 지구 곡률·대기 굴절 포함)
  //  오차 범위: 휴대폰 기울기 ±0.25° · 땅 높이 ±2m(1km 안, 측량 그린은 더 정밀) / ±8m(먼 곳) 로 다시 재서 가장 가까운~가장 먼 값
  function terrainHit(v, sc, eye) {
    const vh = Math.hypot(v.x, v.y); if (vh < 1e-3) return null;
    const brg = (Math.atan2(v.x, v.y) * 180 / Math.PI + 360) % 360, tanEl = v.z / vh;
    const ground = s => hgt(destination(sc.me, brg, s), sc);
    const d = rayHit({ eye, tanEl, ground });
    const elev = Math.atan(tanEl) * 180 / Math.PI;
    if (d == null) return { h: Infinity, bearing: brg, elev, err: Infinity };
    const dl = Math.tan(0.25 * Math.PI / 180), sz = d < 900 ? 2 : 8;
    // 조금 위로 본 광선이 하늘로 빠지면(null) = 능선 마루를 조준한 것 → 그 값은 오차에서 빼고 '능선 근처'로 표시
    const raw = [rayHit({ eye, tanEl: tanEl + dl, ground }), rayHit({ eye, tanEl: tanEl - dl, ground }), rayHit({ eye, tanEl, ground: s => ground(s) + sz }), rayHit({ eye, tanEl, ground: s => ground(s) - sz })];
    const alt = raw.filter(x => x != null), crest = raw[0] == null || raw[3] == null;
    const lo = Math.min(d, ...alt), hi = Math.max(d, ...alt);
    return { h: d, bearing: brg, elev, lo, hi, crest, err: Math.hypot(Math.max(d - lo, hi - d), sc.me.acc || 3) };
  }
  function rangefinder(sc, R, ax, opt, eye, f) {
    const W = box.clientWidth, H = box.clientHeight, { rx, ry } = aimXY();
    const D = sc.pin ? distance(sc.me, sc.pin) : null;
    // 지면 거리 링: 내 앞 ±35° 호, 점마다 실제 땅 높이
    if (ringsOn) {
      const cand = [5, 10, 15, 20, 30, 40, 50, 75, 100, 125, 150, 200, 250, 300].filter(r => !D || r <= D + 60);
      let lastY = Infinity;
      for (const r of cand) {
        const mp = destination(sc.me, ax.bearing, r), mid = project(R, enuOf(sc.me, mp, { eye, dz: hgt(mp, sc) }), opt);
        if (!mid.visible || mid.depth < 2 || mid.y > H - 140 || lastY - mid.y < 22) continue;
        lastY = mid.y;
        const seq = [];
        for (let k = -35; k <= 35; k += 1.25) { const p = destination(sc.me, ax.bearing + k, r), z = hgt(p, sc), q = project(R, enuOf(sc.me, p, { eye, dz: z }), opt); seq.push({ q, ok: q.visible && q.depth > 2 && seen(sc, p, z, eye) }); }
        const pts = seq.filter(o => o.ok).map(o => o.q);
        if (pts.length < 3) continue;
        const major = r % 50 === 0;
        runs(seq, major ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.45)', major ? 2 : 1.2, major ? [] : [5, 6]);
        const lp = pts.reduce((m, q) => (Math.abs(q.x - W * 0.6) < Math.abs(m.x - W * 0.6) ? q : m)), c = clubFor(r);
        if (lp.y > 110 && (lp.y < ry - 14 || lp.y > ry + 150)) tag(Math.min(W - 190, lp.x), lp.y - 10, `${r}m${c ? ' · ' + CLUBN(c) : ''}`);
      }
    }
    compassTape(sc, ax, W);
    // 조준 광선 → 지형과 만나는 곳 (지형이 없으면 깃발 쪽 경사로 평면 근사)
    const v = unproject(R, rx, ry, opt);
    const now = performance.now();
    if (now - readT >= 120 || !lastHit) lastHit = (terr && terrainHit(v, sc, eye)) || groundHit(v, { eye, slope: D && sc.dzPin ? sc.dzPin / D : 0 });
    const gh = lastHit;
    const cands = [];
    if (sc.pin) cands.push({ p: sc.pin, name: '⛳ 깃발' });
    if (sc.hole?.front) cands.push({ p: sc.hole.front, name: '그린 앞' });
    if (sc.hole?.back) cands.push({ p: sc.hole.back, name: '그린 뒤' });
    for (const z of sc.hazards || []) cands.push({ p: z, name: { ob: 'OB', water: '💧 물', bunker: '🏖 벙커', trees: '🌳 숲' }[z.type] || '해저드', r: z.r });
    const land = flight?.landing || sc.landing;
    if (land) cands.push({ p: land, name: '🎯 떨어질 곳' });
    if (sc.ball) cands.push({ p: sc.ball, name: '⚪ 내 공' });
    for (const m of sc.marks || []) cands.push(m);
    if (lockPt) cands.push({ p: lockPt, name: '📌 고정점' });
    let snap = null, best = 36;
    for (const c of cands) { const q = project(R, enuOf(sc.me, c.p, { eye, dz: hgt(c.p, sc) }), opt); if (!q.visible) continue; const d = Math.hypot(q.x - rx, q.y - ry); if (d < best) { best = d; snap = { ...c, q }; } }
    const brg = gh.bearing, rel = sc.pin ? normAngle(brg - bearing(sc.me, sc.pin)) : null;
    let dist, err, pt;
    if (snap) { dist = geodesic(sc.me, snap.p); err = sc.me.acc || 5; pt = snap.p; }
    else if (isFinite(gh.h) && gh.h <= 10000) { dist = gh.h; err = gh.err; pt = destination(sc.me, brg, gh.h); }
    aim = pt ? { p: pt, dist, name: snap?.name || null } : null;
    if (pt && dist >= 2) {
      const br = bearing(sc.me, pt), gp = [];
      for (let s = 1.5; s <= dist; s += Math.max(0.5, dist / 90)) { const p = destination(sc.me, br, s), q = project(R, enuOf(sc.me, p, { eye, dz: hgt(p, sc) }), opt); if (q.visible && q.depth > 0.8) gp.push(q); }
      line(gp, 'rgba(0,0,0,.45)', 6, []); line(gp, 'rgba(255,200,61,.95)', 3, []);
      const step = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500].find(k => dist / k <= 40) || 2500;
      let lastLy = Infinity; // 눈금 글씨는 화면에서 18px 넘게 떨어질 때만 (멀리서 겹치지 않게)
      for (let s = step; s < dist - step * 0.4; s += step) {
        const p = destination(sc.me, br, s), q = project(R, enuOf(sc.me, p, { eye, dz: hgt(p, sc) }), opt);
        if (!q.visible || q.depth < 0.8) continue;
        ctx.fillStyle = '#ffc83d'; ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, 7); ctx.fill();
        if ((dist <= 60 || !ringsOn) && Math.abs(q.y - ry) > 26 && Math.abs(lastLy - q.y) > 18) { tag(q.x + 6, q.y, `${s}m`); lastLy = q.y; } // 멀리는 거리선 글씨가 있으니 점만
      }
      if (sc.pin && !(snap && snap.p === sc.pin) && distance(pt, sc.pin) > 1) {
        const bp = bearing(pt, sc.pin), dp = distance(pt, sc.pin), pp = [];
        for (let s = 0; s <= dp; s += Math.max(0.5, dp / 60)) { const p = destination(pt, bp, s), q = project(R, enuOf(sc.me, p, { eye, dz: hgt(p, sc) }), opt); if (q.visible && q.depth > 1) pp.push(q); }
        line(pp, 'rgba(255,255,255,.85)', 2, [6, 6]);
        const mp = destination(pt, bp, dp / 2), mq = project(R, enuOf(sc.me, mp, { eye, dz: hgt(mp, sc) }), opt);
        if (mq.visible) tag(mq.x + 6, mq.y - 6, `⛳까지 ${dp.toFixed(1)}m`);
      }
    }
    const col = snap ? '#5ee6a8' : '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 4; reticle(rx, ry); ctx.strokeStyle = col; ctx.lineWidth = 2; reticle(rx, ry);
    if (snap) { ctx.strokeStyle = '#5ee6a8'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(snap.q.x, snap.q.y, 14, 0, 7); ctx.stroke(); }
    if (lockPt) { const q = project(R, enuOf(sc.me, lockPt, { eye, dz: hgt(lockPt, sc) }), opt); if (q.visible) { ctx.fillStyle = '#ffc83d'; ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, 7); ctx.fill(); tag(q.x + 10, q.y - 8, `📌 ${Math.round(distance(sc.me, lockPt))}m`); } }
    if (now - readT < 120) return; readT = now;
    const read = box.querySelector('#arRead');
    // 숫자 판: 조준점 아래 · 아래 메뉴에 닿으면 조준점 위로
    // 📱 가운데(조준점 둘레)는 비워 둠: 숫자 판은 화면 아래 '쳤어요' 버튼 위에 고정 (CSS .ar-read)
    const too = !snap && (!isFinite(gh.h) || gh.h > 10000 || err > Math.max(15, dist * 0.5));
    const f1 = x => (Math.round(x * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); // 1,234.5
    const toPin = pt && sc.pin && !(snap && snap.p === sc.pin) ? geodesic(pt, sc.pin) : null;
    const dzPt = pt ? hgt(pt, sc) : 0;
    // 체감 거리: 오늘 바람·기온 + 고저차 (대회 모드면 sc.wx 없음 → 안 보임)
    const pl = !too && dist && dist <= 400 && sc.wx ? playsLike({ dist, dh: dzPt, windSpeed: sc.wx.windSpeed || 0, windFrom: sc.wx.windFrom || 0, shotBearing: brg, tempC: sc.wx.temp ?? 20 }) : null;
    const club = !too && dist && dist <= 400 ? clubFor(pl ? pl.total : dist) : null;
    const latM = rel != null && dist ? dist * Math.sin(rel * Math.PI / 180) : null;
    let htLine = '';
    if (ht?.base) {
      const th = Math.atan2(v.z, Math.hypot(v.x, v.y)), hg = ht.base.d * (Math.tan(th) - Math.tan(ht.base.th));
      htLine = `<div class="ar-ht">🌳 높이 <b>${Math.max(0, hg).toFixed(1)}m</b> <small>(${Math.round(ht.base.d)}m 앞 · 꼭대기를 조준하고 [높이]를 다시 누르면 확정)</small></div>`;
    } else if (ht?.done) htLine = `<div class="ar-ht">🌳 높이 <b>${ht.done.h.toFixed(1)}m</b> <small>${Math.round(ht.done.d)}m 앞 · ${esc(ht.done.note)}</small></div>`;
    else if (ht) htLine = '<div class="ar-ht">🌳 나무·벽의 <b>밑동</b>을 조준하고 [높이]를 누르세요</div>';
    const cell = (k, v2) => `<span><small>${k}</small>${v2}</span>`;
    read.innerHTML = `<div class="ar-big">${too ? `<span class="far">${!isFinite(gh.h) ? (gh.elev > 0 ? '하늘이에요' : '10km보다 멀어요') : '오차가 너무 커요 · 땅이나 산을 조준해 주세요'}</span>` : `<em>${snap ? esc(snap.name) : gh.crest ? '⛰️ 능선 근처' : '조준한 곳까지'}</em><b>${f1(dist)}</b><small>m</small><i>±${f1(err)}</i>${club ? `<u>${esc(CLUBN(club))}</u>` : ''}${too ? '' : `<button class="ar-more" data-rd="${readMore ? 0 : 1}" aria-label="${readMore ? '숫자 접기' : '숫자 더 보기'}">${readMore ? '▴' : '▾'}</button>`}`}</div>
      ${!too && !readMore ? '' : too ? `<div class="ar-sub"><span>🧭 ${compass(brg)} ${f1(brg)}°</span><span>${gh.elev >= 0 ? '⬆' : '⬇'} ${f1(Math.abs(gh.elev))}°</span></div>` : `<div class="ar-grid">
        ${cell('직선 거리', `${f1(Math.hypot(dist, dzPt))}m`)}
        ${cell('높이 차이', Math.abs(dzPt) < 0.05 ? '평평 0.0m' : `${dzPt > 0 ? '⬆' : '⬇'} ${f1(Math.abs(dzPt))}m · ${f1(Math.abs(dzPt / dist * 100))}%`)}
        ${cell('방향', `${compass(brg)} ${f1(brg)}°`)}
        ${rel != null ? cell('깃발 기준', Math.abs(rel) < 0.05 ? '정면 ✓' : `${rel > 0 ? '오른쪽' : '왼쪽'} ${f1(Math.abs(rel))}° · ${f1(Math.abs(latM))}m`) : cell('내려다봄', `${f1(Math.abs(gh.elev))}°`)}
        ${toPin != null ? cell('⛳까지', `${f1(toPin)}m`) : sc.pin ? cell('⛳까지', '여기예요') : ''}
        ${pl ? cell('체감 거리', `${f1(pl.total)}m`) : !snap && gh.lo != null ? cell('범위', `${f1(gh.lo)}~${f1(gh.hi)}m`) : cell('내 위치 오차', `±${f1(sc.me.acc || 0)}m`)}
      </div>`}
      ${htLine}`;
  }
  function reticle(x, y) { ctx.beginPath(); ctx.arc(x, y, 18, 0, 7); ctx.moveTo(x - 34, y); ctx.lineTo(x - 22, y); ctx.moveTo(x + 22, y); ctx.lineTo(x + 34, y); ctx.moveTo(x, y - 34); ctx.lineTo(x, y - 22); ctx.moveTo(x, y + 22); ctx.lineTo(x, y + 34); ctx.stroke(); ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); }
  function tag(x, y, t) { if (labQ) { labQ.push({ x, y, text: t, tag: true, pr: 0.5, size: 12 }); return; } drawTag(x, y, t); }
  function drawTag(x, y, t) { ctx.font = '800 12px system-ui, sans-serif'; const w = richWidth(ctx, t) + 10; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x, y - 9, w, 18); ctx.fillStyle = '#fff'; drawRich(ctx, t, x + 5, y + 4); }
  function line(pts, color, w, dash) {
    if (pts.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.setLineDash(dash); ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); ctx.setLineDash([]);
  }
  // 보이는 점끼리만 이어서 (가려진 곳에서 끊김)
  function runs(seq, color, w, dash) {
    let cur = [];
    for (const o of seq) { if (o.ok) cur.push(o.q); else { line(cur, color, w, dash); cur = []; } }
    line(cur, color, w, dash);
  }
  // ⛰️ 능선(하늘과 맞닿는 선) + 앞 능선 마루 선 · 화면 안 가장 높은 곳에 거리·높이
  function drawRidges(sc, R, opt, ax, eye) {
    const P3 = (az, s, t) => project(R, { x: Math.sin(az * Math.PI / 180) * s, y: Math.cos(az * Math.PI / 180) * s, z: t * s }, opt);
    const from = Math.floor(ax.bearing - 48), to = Math.ceil(ax.bearing + 48);
    const sky = []; let top = null;
    for (let az = from; az <= to; az++) {
      const pf = hz.at(az), k = pf?.sky;
      if (!k) { sky.push({ ok: false }); continue; }
      const q = P3(az, k.s, k.t); sky.push({ q, ok: q.visible });
      if (q.visible && (!top || q.y < top.q.y)) top = { q, s: k.s, h: k.t * k.s + curvDrop(k.s) + eye };
    }
    for (const ln of hz.ridges) {
      const seq = ln.filter(c => Math.abs(normAngle(c.az - ax.bearing)) <= 48).map(c => { const q = P3(c.az, c.s, c.t); return { q, ok: q.visible && c.s > 60 }; });
      runs(seq, 'rgba(0,0,0,.35)', 3.5, []); runs(seq, 'rgba(255,226,122,.7)', 1.6, []);
    }
    runs(sky, 'rgba(0,0,0,.45)', 5, []); runs(sky, 'rgba(255,255,255,.95)', 2.2, []);
    if (top && top.q.y > 100) { const fmK = v => (v >= 1000 ? `${(v / 1000).toFixed(2)}km` : `${Math.round(v)}m`); tag(top.q.x + 6, top.q.y - 12, `⛰️ 능선 ${fmK(top.s)} · ${top.h >= 0 ? '+' : ''}${Math.round(top.h)}m`); }
  }
  function poly(pts, fill, stroke, dash) {
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
  }
  function compassTape(sc, ax, W) {
    const y = 84, span = 60, px = W / span;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, y - 14, W, 30);
    ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (let d = Math.ceil((ax.bearing - span / 2) / 5) * 5; d <= ax.bearing + span / 2; d += 5) {
      const x = W / 2 + normAngle(d - ax.bearing) * px, dd = (d + 360) % 360, major = dd % 10 === 0;
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + 16); ctx.lineTo(x, y + (major ? 6 : 10)); ctx.stroke();
      if (dd % 45 === 0) { ctx.fillStyle = '#ffc83d'; ctx.fillText(DIRS[dd / 45], x, y + 2); } else if (dd % 30 === 0) { ctx.fillStyle = '#fff'; ctx.fillText(String(dd), x, y + 2); }
    }
    const mk = (p, icon, color) => { const r = normAngle(bearing(sc.me, p) - ax.bearing); const x = W / 2 + Math.max(-span / 2, Math.min(span / 2, r)) * px; ctx.fillStyle = color; const arr = Math.abs(r) > span / 2 ? (r > 0 ? '▶' : '◀') : ''; const w = drawRich(ctx, icon, x - (arr ? 8 : 0), y - 18, { align: 'center', color }); if (arr) { const ta = ctx.textAlign; ctx.textAlign = 'left'; ctx.fillText(arr, x - 8 + w / 2 + 2, y - 18); ctx.textAlign = ta; } }; // 방향 화살표는 글자(◀▶ 짝)
    if (sc.pin) mk(sc.pin, '⛳', '#fff');
    ctx.fillStyle = '#5ee6a8'; ctx.beginPath(); ctx.moveTo(W / 2, y + 16); ctx.lineTo(W / 2 - 6, y + 24); ctx.lineTo(W / 2 + 6, y + 24); ctx.fill();
    ctx.textAlign = 'left';
  }
  box.querySelector('#arFlag').onclick = () => {
    const sc = getScene();
    const ok = openFlagCam(box, video, { heading: last.R ? cameraAxis(last.R).bearing : null, sc: { me: sc?.me, pin: sc?.pin }, onPin });
    if (!ok) say('📷 카메라 영상이 아직 없어요');
  };
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
    const { rx, ry } = aimXY(), v = unproject(last.R, rx, ry, last.opt), th = Math.atan2(v.z, Math.hypot(v.x, v.y));
    if (!ht.base) { if (!aim) return; ht.base = { d: aim.dist, th }; return; }
    const h = Math.max(0, ht.base.d * (Math.tan(th) - Math.tan(ht.base.th)));
    ht.done = { h, d: ht.base.d, note: h > ht.base.d * 0.35 ? '넘기기 어려워요 · 옆으로 돌아가세요' : h > ht.base.d * 0.18 ? '높은 탄도(웨지·9번)면 넘어가요' : '대부분 클럽으로 넘어가요' };
  };
  box.querySelector('#arRings').onclick = e => { ringsOn = !ringsOn; e.target.classList.toggle('on', ringsOn); };

  // 🏷️ 글자 겹침 없애기 (내비처럼 표시끼리 겹치지 않게): 프레임 동안 모았다가 중요한 것부터 빈자리에 놓음
  //   pr: 3 = 깃발·내 공·화면 밖 안내 · 2 = 떨어질 곳·착지 · 1 = 해저드 이름 (자리가 없으면 1부터 뺌)
  let labQ = null;
  function label(x, y, text, bg, size, pr = 1) { if (labQ) labQ.push({ x, y, text, bg, size, pr }); else drawLabel(x, y, text, bg, size); }
  function flushLabels() {
    const q = labQ || []; labQ = null; const put = [];
    // 가운데 조준 원 둘레는 비워 둠 · 화면 카드 아래로 글자가 숨지 않게
    try { const { rx, ry } = aimXY(); put.push({ x0: rx - 40, y0: ry - 40, x1: rx + 40, y1: ry + 40 }); } catch {}
    const bb = box.getBoundingClientRect();
    for (const sel of ['#arNav', '#arPoi', '#arWarn', '#arRead', '#arMap']) {
      const e = box.querySelector(sel); if (!e || e.hidden || !e.offsetWidth) continue;
      const r = e.getBoundingClientRect(); put.push({ x0: r.left - bb.left - 4, y0: r.top - bb.top - 4, x1: r.right - bb.left + 4, y1: r.bottom - bb.top + 4 });
    }
    q.sort((a, b) => b.pr - a.pr);
    for (const L of q) {
      ctx.font = `800 ${L.size}px system-ui, sans-serif`;
      const w = richWidth(ctx, L.text, L.size) + (L.tag ? 10 : 16), h = L.tag ? 18 : L.size + 12, gap = h + 4;
      const x0 = L.tag ? L.x : L.x - w / 2, top = L.tag ? L.y - 9 : L.y - L.size - 6;
      let ok = null;
      // 위아래로 먼저, 안 되면 좌우로도 비켜 봄 (화면 밖으로는 안 나가게)
      const BW = box.clientWidth;
      outer: for (const dx of [0, -40, 40, -80, 80, -120]) for (const dy of [0, -gap, gap, -2 * gap, 2 * gap]) {
        const r = { x0: x0 + dx, y0: top + dy, x1: x0 + dx + w, y1: top + dy + h };
        if (r.x0 < 4 || r.x1 > BW - 4) continue;
        if (!put.some(p => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) { ok = { r, dy, dx }; break outer; }
      }
      if (!ok) { if (L.pr < 3) continue; ok = { r: { x0: L.x - w / 2, y0: L.y - L.size - 6, x1: L.x + w / 2, y1: L.y - L.size + 6 + L.size }, dy: 0 }; }
      put.push(ok.r); const lx = L.x + (ok.dx || 0); if (L.tag) drawTag(lx, L.y + ok.dy, L.text); else drawLabel(lx, L.y + ok.dy, L.text, L.bg, L.size);
    }
  }
  // 🧭 내비식 안내 (이미지 분석: 왼쪽 위 = 지금 할 일 · 오른쪽 = 앞으로 나올 곳 · 위험할 때만 노란 표지판)
  let readMore = false, navT = 0;
  box.addEventListener('click', e => { const b = e.target.closest('[data-rd]'); if (b) { readMore = b.dataset.rd === '1'; readT = 0; } });
  const NAV_HZ = { ob: ['⚠', 'OB'], water: ['💧', '물'], bunker: ['🏖', '벙커'], trees: ['🌳', '숲'] };
  function navCards(sc, now) {
    if (now - navT < 300) return; navT = now;
    const nav = box.querySelector('#arNav'), poi = box.querySelector('#arPoi'), warn = box.querySelector('#arWarn');
    const from = sc.ball || sc.from || sc.me, h = sc.hole, pin = sc.pin;
    // ① 지금 할 일: 큰 화살표 + 클럽 + 보낼 거리
    const r = sc.rec;
    if (r && !anim) {
      const side = r.putt ? '홀 보고 굴려요' : Math.abs(r.rel) < 0.75 ? '깃발 보고 똑바로' : `깃발보다 ${r.rel > 0 ? '오른쪽' : '왼쪽'}으로 ${Math.abs(r.rel) < 3 ? '조금' : '많이'}`;
      nav.innerHTML = `<i class="ar-nav-a" style="transform:rotate(${Math.max(-60, Math.min(60, r.rel * 3))}deg)" aria-hidden="true">⬆</i><span><b>${esc(r.club)}</b><small>${r.putt ? `홀까지 ${Math.round(r.carry)}m` : `${Math.round(r.carry)}m 보내기`}${r.swing ? ` · ${esc(r.swing)}` : ''}</small><em>${side}</em></span>`;
      nav.hidden = false;
    } else nav.hidden = true;
    // ② 앞으로 나올 곳: 해저드 앞·넘기기 · 그린 앞·깃발·뒤 (가까운 순 4개)
    const items = [];
    if (from && pin) {
      const dPin = distance(from, pin), bPin = bearing(from, pin);
      for (const z of sc.hazards || []) {
        const d = distance(from, z), off = normAngle(bearing(from, z) - bPin);
        if (Math.abs(off) > 50 || d > dPin + 15 || d - z.r < 15) continue;
        const [ic, nm] = NAV_HZ[z.type] || ['⚠', '해저드'], sd = Math.abs(off) < 8 ? '' : off > 0 ? '오른 ' : '왼 '; // 좁은 목록에 맞게 짧게
        items.push({ ic, t: `${sd}${nm} 앞`, d: d - z.r }, { ic, t: `${sd}${nm} 넘기기`, d: d + z.r });
      }
      if (h?.front) items.push({ ic: '⛳', t: '그린 앞', d: distance(from, h.front) });
      items.push({ ic: '⛳', t: '깃발', d: dPin, main: true });
      if (h?.back) items.push({ ic: '⛳', t: '그린 뒤', d: distance(from, h.back) });
    }
    const list = items.filter(x => x.d > 5).sort((a, b) => a.d - b.d).slice(0, 4);
    if (list.length >= 2 && !anim) { poi.innerHTML = list.map(x => `<div class="${x.main ? 'main' : ''}"><i>${x.ic}</i><span>${esc(x.t)}</span><b>${Math.round(x.d)}<small>m</small></b></div>`).join(''); poi.hidden = false; }
    else poi.hidden = true;
    // ③ 경고 표지판: 떨어질 곳 가까이에 해저드가 있을 때만
    let w = null;
    if (sc.landing && !anim) for (const z of sc.hazards || []) {
      const gap = distance(sc.landing, z) - z.r;
      if (gap < 10 && (!w || gap < w.gap)) w = { gap, nm: (NAV_HZ[z.type] || ['⚠', '해저드'])[1] };
    }
    if (w) { warn.innerHTML = `<i aria-hidden="true">⚠</i><span><b>${esc(w.nm)} 조심</b><small>${w.gap <= 0 ? '떨어질 곳이 걸쳐 있어요' : `떨어질 곳에서 ${Math.round(w.gap)}m`}</small></span>`; warn.hidden = false; }
    else warn.hidden = true;
  }
  function drawLabel(x, y, text, bg, size) {
    ctx.font = `800 ${size}px system-ui, sans-serif`; const w = richWidth(ctx, text, size) + 16;
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - size - 6, w, size + 12, 9) : ctx.rect(x - w / 2, y - size - 6, w, size + 12); ctx.fill();
    ctx.fillStyle = '#fff'; drawRich(ctx, text, x, y, { size, align: 'center' }); ctx.textAlign = 'left';
  }
  function ring(x, y, r) { ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.6, 0, 0, 7); ctx.stroke(); }
  function edge(p, name, ax) {
    const rel = normAngle(bearing(getScene().me, p) - ax.bearing), W = box.clientWidth, H = box.clientHeight;
    const left = rel < 0, x = left ? 34 : W - 34, y = H * 0.42;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.arc(x, y, 28, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffe27a'; ctx.font = '900 26px system-ui'; ctx.textAlign = 'center'; ctx.fillText(left ? '◀' : '▶', x, y + 9);
    label(x + (left ? 60 : -60), y + 52, `${name}은 ${left ? '왼쪽' : '오른쪽'} ${Math.abs(rel).toFixed(0)}°`, 'rgba(0,0,0,.65)', 13, 3); ctx.textAlign = 'left';
  }
  let diagT = 0;
  function diag(sc, ax) {
    const tn = performance.now(); if (tn - diagT < 500) return; diagT = tn; // 1초에 2번만 (스크롤이 튀지 않게)
    const D = sc.pin ? distance(sc.me, sc.pin) : 150, cAcc = Sensors.compassAcc, gAcc = sc.me.acc || 0, age = (Date.now() - (sc.me.ts || Date.now())) / 1000;
    const row = (ok, name, val, fix) => `<div>${ok === 2 ? '<b class="ok">✓</b>' : ok === 1 ? '<b class="mid">△</b>' : '<b class="bad">✕</b>'} ${name}: <b>${val}</b>${ok < 2 && fix ? ` <br><small>→ ${fix}</small>` : ''}</div>`;
    const compErr = cAcc != null && cAcc >= 0 ? cAcc : 10, lat = D * Math.tan(compErr * Math.PI / 180);
    box.querySelector('#arDiagB').innerHTML = `<small>이 화면을 캡처해서 보내 주시면 원인을 찾을 수 있어요 · 길면 위아래로 밀어 보세요</small>
      ${row(isSecureContext ? 2 : 0, 'HTTPS', isSecureContext ? '예' : '아니요', 'https 주소로 열어야 센서·카메라가 켜져요')}
      ${row(video.videoWidth ? 2 : 0, '카메라', video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '꺼짐', '카메라 권한을 허용해 주세요')}
      ${row(evRate >= 20 ? 2 : evRate >= 5 ? 1 : 0, '방향 센서', `${evRate.toFixed(0)}회/초`, '배터리 절약 모드를 끄고, iPhone은 동작·방향 권한을 허용해 주세요')}
      ${row(Sensors.alphaAbs != null ? 2 : 0, '나침반(북쪽 기준)', Sensors.alphaAbs != null ? `${Math.round(ax.bearing)}°` : '없음', '기기가 나침반을 지원하지 않으면 [깃발 맞추기]로 방향을 맞춰 주세요')}
      ${row(cAcc == null ? 1 : cAcc <= 15 ? 2 : cAcc <= 30 ? 1 : 0, '나침반 정확도', cAcc == null ? '기기가 알려주지 않음' : `±${Math.round(cAcc)}°`, '휴대폰을 8자로 돌리고, 카트·철제 구조물에서 2m 떨어지세요')}
      ${row(gAcc <= 5 ? 2 : gAcc <= 10 ? 1 : 0, 'GPS 정확도', `±${Math.round(gAcc)}m · ${age.toFixed(0)}초 전`, '하늘이 트인 곳에서 10초 기다려 주세요')}
      ${row(terr ? 2 : 1, '지형 높이', terr ? '받음 (고도 타일' + (sc.hole?.greenGrid ? ' + 그린 측량' : '') + ')' : terrLoading ? '받는 중' : '없음 (평지로 계산)', '인터넷이 되는 곳에서 한 번 열면 받아 둬요')}
      ${row(Math.abs(ax.pitch) < 35 ? 2 : 1, '휴대폰 자세', `위아래 ${ax.pitch.toFixed(0)}° · 기울기 ${(g ?? 0).toFixed(0)}°`, '휴대폰을 세워서 앞을 비춰 주세요')}
      ${row(2, '방위 보정', `${yaw ? (yaw > 0 ? '+' : '') + yaw.toFixed(1) + '°' : '없음'} · 화각 ${S.settings.cameraVFov || 63}°`, '')}
      <div style="margin-top:6px">예상 오차: 깃발(${Math.round(D)}m)이 화면에서 좌우 약 <b>${lat.toFixed(1)}m</b> 어긋날 수 있어요${compErr > 8 ? ' → [🎯 깃발 맞추기]를 쓰면 줄어들어요' : ''}. 거리 숫자는 GPS로 계산해서 ±${Math.round(gAcc)}m 정도예요.</div>`;
  }
  // 안내 글: say = 지금 상태(매 화면) · flash = 잠깐 보여 주는 결과 (그동안 say에 덮이지 않음)
  let flashUntil = 0;
  function say(h) { if (performance.now() < flashUntil) return; msg.innerHTML = h; msg.classList.add('show'); }
  function hide() { if (performance.now() < flashUntil) return; msg.classList.remove('show'); }
  function flash(h, ms = 2600) { flashUntil = performance.now() + ms; msg.innerHTML = h; msg.classList.add('show'); }
  const calBtn = box.querySelector('#arCal');
  const setCalib = on => { calib = on; calBtn.classList.toggle('on', on); calBtn.textContent = on ? '✕ 깃발 맞추기 취소' : '🎯 깃발 맞추기'; calChip(on); };
  // 깃발 맞추는 동안은 판이 닫혀 있으니, 화면에 작은 취소 칩
  const calChip = on => { let c = box.querySelector('#arCalChip'); if (on && !c) { c = document.createElement('button'); c.id = 'arCalChip'; c.className = 'ar-chip cal'; c.textContent = '✕ 깃발 맞추기 취소'; c.onclick = () => setCalib(false); root.appendChild(c); } else if (!on && c) c.remove(); };
  calBtn.onclick = () => {
    if (calib) return setCalib(false);
    const sc = getScene();
    if (!sc?.pin) return flash('⛳ 이 홀은 아직 깃발 위치를 몰라요<br><small>그린에 가서 [여기가 그린이에요]를 누르거나, 지도에서 그린을 찍으면 그다음부터 맞출 수 있어요</small>', 4500);
    if (!last.R) return flash('🧭 방향 센서를 기다리는 중이에요 · 잠시 뒤 다시 눌러 주세요');
    setCalib(true);
  };
  const setDiag = on => { diagOn = on; diagT = 0; box.querySelector('#arDiag').classList.toggle('show', on); };
  box.querySelector('#arChk').onclick = () => setDiag(!diagOn);
  box.querySelector('#arDiagX').onclick = () => setDiag(false);
  box.querySelector('#arReset').onclick = () => { yaw = 0; a = null; try { localStorage.removeItem(YAW_KEY); } catch {} flash('↺ 방향 보정을 지웠어요'); };
  // 🎯 조준점 옮기기: 끌기(어디서 시작해도) · 짧게 누르면 그곳으로 · 조준점을 두 번 누르면 가운데로
  const aim0Btn = box.querySelector('#arAim0');
  const moveAim = (cx, cy) => { const r = cv.getBoundingClientRect(); aimAt = { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height }; aim0Btn.hidden = Math.hypot(aimAt.x - AIM0.x, aimAt.y - AIM0.y) < 0.02; readT = 0; lastHit = null; };
  let drag = null, lastTap = 0;
  cv.addEventListener('pointerdown', e => { if (calib) return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }; try { cv.setPointerCapture(e.pointerId); } catch {} });
  cv.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return; drag.moved = true; moveAim(e.clientX, e.clientY); });
  cv.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (d.moved) return;
    const r = cv.getBoundingClientRect(), { rx, ry } = aimXY(), now = performance.now();
    if (Math.hypot(e.clientX - r.left - rx, e.clientY - r.top - ry) < 40 && now - lastTap < 350) { aimAt = { ...AIM0 }; aim0Btn.hidden = true; readT = 0; lastHit = null; lastTap = 0; return; }
    lastTap = now; moveAim(e.clientX, e.clientY);
  });
  cv.addEventListener('pointercancel', () => { drag = null; });
  aim0Btn.onclick = () => { aimAt = { ...AIM0 }; aim0Btn.hidden = true; readT = 0; lastHit = null; };
  cv.addEventListener('click', e => {
    if (!calib || !last.R) return;
    const sc = getScene(); if (!sc?.pin) { setCalib(false); return; }
    const r = cv.getBoundingClientRect();
    const corr = yawCorrection(last.R, enuOf(sc.me, sc.pin, { eye: 0 }), e.clientX - r.left, last.opt);
    if (corr != null && Math.abs(corr) < 45) { yaw = ((yaw - corr + 540) % 360) - 180; try { localStorage.setItem(YAW_KEY, String(yaw)); } catch {} a = null; flash(`✅ 방향을 맞췄어요 <small>(보정 ${yaw > 0 ? '+' : ''}${yaw.toFixed(1)}°)</small>`); }
    else flash('깃발이 화면에서 너무 멀리 있어요 · 진짜 깃발이 화면 가운데 근처에 오게 하고 다시 눌러 주세요', 3500);
    setCalib(false);
  });
  raf = requestAnimationFrame(frame);
  return { stop: () => { alive = false; cancelAnimationFrame(raf); unOri(); impact.stop(); stopCam && stopCam(); }, play: playFlight, setMap, armTrack };
}
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
