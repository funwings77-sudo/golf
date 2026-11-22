// ③ 그린 위 거리 · ④ 그린 경사 지도 · ⑤ 퍼팅 라인/조준점/세기/백스윙
import { mountGreen3D, ovalInside } from './green3d.js';
import { todayKey } from '../core/remote.js';
import { greenToday, recordPuttFeel } from '../core/insights.js';
import { depthInfo, measureWithDepth, surveyWithDepth, processSurvey, KIND_WORD, liveDepth, sendOverlay, greenOverlay } from '../core/depth.js';
import { saveFile } from '../core/files.js';
import { fuse, SIGMA, srcLine, blendWeight } from '../core/fusion.js';
import { S, save, allowed, activeHole, activeCourse, currentMode, FEATURE_NAMES } from '../core/state.js';
import { distance, toLocal, toRad } from '../core/geo.js';
import { Sensors, sampleTilt, startSteps, onOrientation, startOrientation, vibrate, speak } from '../core/sensors.js';
import { smoothAngle, rotationMatrix, project, focalPx, cameraAxis, unproject, groundHit } from '../core/arproj.js';
import { lineFrame, distanceRings, SlopeFlow, resamplePath, slopeVerdict, fallLine, contours, ridgeLines, lineProfile, slopeHue } from '../core/greenar.js';
import { muFromStimp, buildSurface, fitQuadFromGradients, optimizePutt, backswingCm, demoGreen, CUP_W } from '../physics/putt.js';
import { openCamera, GroundProjector, coverTransform, zoomed, attachZoom } from '../core/camera.js';
import { drawGreen, makeView } from './greencanvas.js';
import { $, $$, esc, toast, sheet, lockedCard, confBadge, metronome, signed, DU } from '../ui.js';
import { immersive } from '../core/screen.js';
import { mapSheetPage, sheetHTML } from '../map.js';
import { icon } from '../icons.js';

const STAND_BACK = 0.6; // 공 뒤에 서는 거리 (m)
const PREVIEW_D = 8; // 거리를 재기 전 카메라 화면에 그린 굴곡을 미리 그릴 임시 거리 (m)
let depth = null; // 깊이 카메라 (LiDAR · ARCore) 쓸 수 있나
let liveSend = null; // 🔴 실시간 AR 선이 열려 있으면: 퍼팅 계산이 끝날 때마다 선을 다시 보냄
let el_, App_, G, worker = null, reqId = 0, camStop = null, arT = null, unOri = null, metroOn = false;

function loadG() {
  try { const g = JSON.parse(sessionStorage.getItem('pinpoint.green') || 'null'); if (g) return g; } catch {}
  return { src: null, demoKind: 'tier', D: 0, distSrc: '', meas: {}, precise: false, gBall: null, gHole: null, stimp: S.settings.stimp, result: null, tab: 'measure', training: false, guess: null, revealed: false, holeN: null };
}
// 그린 굴곡(등고선·능선)을 바로 보여 줄 수 있는 출처 우선: 이 홀 카메라 스캔 > 골프장 그린맵 > 직접 재기
const bestSrc = (g, hole) => (g.scan && g.holeN === (hole?.n ?? null) ? 'scan' : hole?.greenGrid ? 'grid' : 'onsite');
function saveG() { try { const { result, ...rest } = G; sessionStorage.setItem('pinpoint.green', JSON.stringify({ ...rest, result: null })); } catch {} }

export default {
  mount(el, App) {
    el_ = el; App_ = App; G = loadG();
    // 📷 그린에 들어오면 늘 '직접 재기 + ③ 카메라로 보기'가 먼저 (대회 모드는 퍼팅 라인 금지라 ① 재기)
    //   예외: 계산 화면을 열려고 누른 곳은 #/green?measure(① 재기) · #/green?map(② 그린 지도)
    const want = (location.hash.match(/\?(?:.*&)?(ar|measure|map)\b/) || [])[1];
    if (want === 'measure' || want === 'map') G.tab = want;
    else { G.src = bestSrc(G, activeHole()); G.prevTab = 'measure'; G.tab = allowed('puttLine') ? 'ar' : 'measure'; G.arMode = null; G.arPanel = false; }
    App_.greenAR = false;
    if (/\?/.test(location.hash)) history.replaceState(null, '', '#/green');
    const hole = activeHole();
    // 골프장이 발행한 오늘 그린 스피드가 있으면 그 값으로 시작 (사용자가 바꾸면 그 값 유지)
    const tp = activeCourse()?.todayPins;
    if (tp?.stimp && tp.date === todayKey() && G.stimpSrc !== tp.date) { G.stimp = tp.stimp; G.stimpSrc = tp.date; G.result = null; }
    // 오늘 내 퍼트 결과로 맞춘 빠르기가 있으면 그것이 우선 (골프장 발표보다 오늘 내 느낌이 최신)
    const gt = greenToday(activeCourse());
    if (gt?.src === 'feel' && G.stimp !== gt.stimp) { G.stimp = gt.stimp; G.result = null; }
    if (G.holeN !== (hole?.n ?? null)) { G.gBall = G.gHole = null; G.result = null; G.meas = {}; G.D = 0; G.dm = []; G.scan = null; if (G.src === 'scan') G.src = null; G.holeN = hole?.n ?? null; }
    if (G.src === 'scan' && !G.scan) G.src = null;
    if (!G.src) G.src = hole?.greenGrid ? 'grid' : 'onsite';
    if (G.src === 'grid' && !hole?.greenGrid) G.src = 'demo';
    render();
    if (!depth) depthInfo().then(d => { depth = d; if (d.ok && G.tab === 'measure' && el_?.isConnected) render(); });
  },
  unmount() { stopAR(); mapSheetPage(false); metronome(false); metroOn = false; saveG(); },
  // 아래 메뉴 '그린': 이미 그린 화면이면 다시 불러오지 않고 바로 AR 그린 리딩
  openAR() { if (G.tab !== 'ar') G.prevTab = G.tab; G.src = bestSrc(G, activeHole()); G.tab = 'ar'; G.arMode = null; G.result = null; saveG(); render(); }, // 메뉴 '그린'도 직접 재기 + 카메라
  onHole() { G.holeN = null; this.mount(el_, App_); },
};

// 🔀 퍼팅 거리: 잰 기술마다 하나씩 기억(같은 기술은 새 값으로) → 정확도만큼 합침 · 직접 입력은 내 뜻이니 그 값으로
function addDist(v, src, { acc, sd } = {}) {
  if (!(v > 0)) return;
  if (src === 'typed') G.dm = [];
  G.dm = (G.dm || []).filter(m => m.src !== src && m.src !== 'typed');
  const sdv = sd ?? (src === 'gps' ? SIGMA.dist.gps(v, acc) : (SIGMA.dist[src] || SIGMA.dist.camera)(v));
  G.dm.push({ v, sd: sdv, src, ts: Date.now() });
  const f = fuse(G.dm);
  G.D = Math.round(f.v * 100) / 100; if (G.D >= 0.3 && G.D <= 25) G.lastD = G.D; G.dFuse = { sd: f.sd, srcs: f.srcs, dropped: f.dropped.map(d => d.src) };
  G.distSrc = `${srcLine(f.srcs)} ±${f.sd < 0.1 ? Math.round(f.sd * 100) + 'cm' : f.sd.toFixed(1) + 'm'}`;
  G.result = null;
}

function gridInfo() {
  const hole = activeHole();
  if (G.src === 'scan' && G.scan) return { grid: G.scan.grid, origin: null, name: `${KIND_WORD[G.scan.kind] || '카메라'} 스캔`, pin: null };
  if (G.src === 'grid' && hole?.greenGrid) return { grid: hole.greenGrid.grid, origin: hole.greenGrid.origin, name: hole.greenGrid.source || '사전 측량 그린', pin: hole.pin || hole.green };
  if (G.src === 'demo') { const g = demoGreen(G.demoKind); g.y0 -= 12.5; return { grid: g, origin: null, name: `데모(가상) · ${g.name}`, pin: null }; }
  return null;
}
function gridBounds(g) { return { x0: g.x0, y0: g.y0, x1: g.x0 + (g.nx - 1) * g.dx, y1: g.y0 + (g.ny - 1) * g.dx }; }

// 현재 설정에서 표면·공·홀 위치
function geometry() {
  const gi = gridInfo();
  if (gi) {
    const b = gridBounds(gi.grid);
    let hole = G.gHole, ball = G.gBall;
    if (!hole) hole = gi.origin && gi.pin ? toLocal(gi.origin, gi.pin) : { x: 2, y: 6 };
    if (!ball) {
      const me = gi.origin && Sensors.pos ? toLocal(gi.origin, Sensors.pos) : null;
      ball = me && me.x > b.x0 && me.x < b.x1 && me.y > b.y0 && me.y < b.y1 ? me : { x: hole.x - 3, y: hole.y - 8 };
    }
    const spec = { kind: 'grid', grid: gi.grid, bounds: b };
    const fix = fusionCorrection(buildSurface(spec), ball, hole);
    if (fix) spec.correction = fix;
    const inside = p => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
    return { spec, ball, hole, inside, D: Math.hypot(hole.x - ball.x, hole.y - ball.y), kind: 'grid', name: gi.name };
  }
  return onsiteGeo(G.D || 0);
}
function onsiteGeo(D) {
  const pts = measurePoints(D).filter(p => p.m);
  const surf = fitQuadFromGradients(pts.map(p => ({ x: 0, y: p.y, gx: p.m.gx, gy: p.m.gy })));
  const half = Math.max(2.5, D * 0.4);
  return { spec: { kind: 'quad', coeffs: surf.coeffs }, ball: { x: 0, y: 0 }, hole: { x: 0, y: D }, inside: p => Math.abs(p.x) <= half && p.y >= -1.5 && p.y <= D + 2, D, kind: 'onsite', name: '현장 측정', nMeas: pts.length };
}
function measurePoints(D) {
  return [{ key: 'ball', label: '공 있는 곳', y: 0 }, { key: 'mid', label: '가운데', y: D / 2 }, { key: 'hole', label: '홀 바로 앞', y: Math.max(0, D - 1) }].map(p => ({ ...p, m: G.meas[p.key] }));
}
// 사전 맵 + 현장 측정 융합: 측정(라인 좌표계)을 그리드 좌표계로 회전해 평균 차이를 보정 평면으로
function fusionCorrection(surf, ball, hole) {
  const ms = Object.entries(G.meas).filter(([, m]) => m); if (!ms.length) return null;
  const D = Math.hypot(hole.x - ball.x, hole.y - ball.y) || 1, ux = (hole.x - ball.x) / D, uy = (hole.y - ball.y) / D, rx = uy, ry = -ux;
  let a = 0, b = 0;
  for (const [k, m] of ms) {
    const f = k === 'ball' ? 0 : k === 'mid' ? 0.5 : Math.max(0, 1 - 1 / D);
    const p = { x: ball.x + ux * D * f, y: ball.y + uy * D * f };
    const gw = [m.gx * rx + m.gy * ux, m.gx * ry + m.gy * uy], gs = surf.grad(p.x, p.y);
    a += gw[0] - gs[0]; b += gw[1] - gs[1];
  }
  // 격자와 기울기 센서를 정확도만큼 섞음: 측량 그린은 조금만, 거친 스캔·가짜 그린은 많이 고침
  const sdGrid = G.src === 'scan' && G.scan ? SIGMA.slope[G.scan.kind] ?? 1 : G.src === 'grid' ? SIGMA.slope.survey : 2;
  const sdTilt = ms.some(([, m]) => m.precise) ? SIGMA.slope.tiltPrecise : SIGMA.slope.tilt, w = blendWeight(sdGrid, sdTilt / Math.sqrt(ms.length));
  return { a: a / ms.length * w, b: b / ms.length * w, w };
}
function confidence(geo) {
  if (G.src === 'scan' && G.scan) return G.scan.conf;
  if (geo.kind === 'grid') return Math.min(0.95, (G.src === 'demo' ? 0.8 : 0.85) + (Object.values(G.meas).filter(Boolean).length ? 0.05 : 0));
  const n = geo.nMeas || 0, precise = Object.values(G.meas).some(m => m?.precise);
  return n === 0 ? 0.2 : Math.min(0.8, 0.45 + n * 0.08 + (precise ? 0.08 : 0) - (G.D > 8 ? 0.1 : 0));
}

// ---------- 렌더 ----------
function render() {
  stopAR();
  const hole = activeHole(), mode = currentMode();
  const canSlope = allowed('greenSlope'), canLine = allowed('puttLine');
  const gridName = hole?.greenGrid ? (hole.greenGrid.source || '사전 측량 그린') : null;
  const E = easy();
  const mapMode = G.tab === 'map' && canSlope; // 📱 그린 지도: 그림은 판 위 보이는 칸 전체 · 제목·탭·버튼·결과는 지도 위 아래 판
  mapSheetPage(mapMode);
  const page = `<h2>🟢 ${E ? '그린 읽기' : '그린 리딩 · 퍼팅'}</h2>
    <div class="seg" id="srcSeg"><button data-v="onsite" class="${G.src === 'onsite' ? 'on' : ''}">${E ? '직접 재기' : '현장 측정'}</button>${G.scan ? `<button data-v="scan" class="${G.src === 'scan' ? 'on' : ''}">📏 ${E ? '카메라 스캔' : '깊이 스캔'}</button>` : ''}${gridName ? `<button data-v="grid" class="${G.src === 'grid' ? 'on' : ''}">${E ? '그린 지도' : '그린맵'}</button>` : ''}<button data-v="demo" class="${G.src === 'demo' ? 'on' : ''}">${E ? '연습 그린' : '데모 그린'}</button></div>
    ${G.src === 'demo' ? `<div class="seg" id="demoSeg" style="margin-top:6px">${[['tier', '2단'], ['saddle', '말안장'], ['mound', '마운드']].map(([k, n]) => `<button data-v="${k}" class="${G.demoKind === k ? 'on' : ''}">${n}</button>`).join('')}</div><p class="sub">${E ? '연습용 가짜 그린이에요. ② 그린 지도에서 공·홀 위치를 눌러 바꿔 보세요.' : '가상의 사전 측량 그린입니다 (실제 코스 아님). 그린맵 탭에서 공·홀 위치를 탭으로 바꿔 보세요.'}</p>` : ''}
    <div class="seg" id="tabSeg" style="margin-top:10px"><button data-v="measure" class="${G.tab === 'measure' ? 'on' : ''}">${E ? '① 재기' : '③ 측정'}</button><button data-v="map" class="${G.tab === 'map' ? 'on' : ''}">${E ? '② 그린 지도' : '④ 그린맵'}</button><button data-v="ar" class="${G.tab === 'ar' ? 'on' : ''}">${E ? '③ 카메라로 보기' : '⑤ AR 리딩'}</button></div>
    <div id="tabBody"></div><div id="result"></div>`;
  el_.innerHTML = mapMode ? `<div class="g-back" id="gBack"></div>` + sheetHTML(page, '그린 판 크게·작게') : page;
  if (mapMode) $('#mGrip').onclick = () => { $('#mSheet').classList.toggle('tall'); document.documentElement.classList.toggle('msheet-tall'); setTimeout(() => G.tab === 'map' && $('#tabBody') && mapTab($('#tabBody')), 280); }; // 판 크기가 바뀌면 그린을 다시 그림
  $$('#srcSeg button').forEach(b => b.onclick = () => { G.src = b.dataset.v; G.result = null; G.gBall = G.gHole = null; if (b.dataset.v === 'onsite' && allowed('puttLine')) { if (G.tab !== 'ar') G.prevTab = G.tab; G.tab = 'ar'; G.arMode = null; } saveG(); render(); }); // 직접 재기 = 카메라로 보기가 먼저
  $$('#demoSeg button').forEach(b => b.onclick = () => { G.demoKind = b.dataset.v; G.result = null; G.gBall = G.gHole = null; saveG(); render(); });
  $$('#tabSeg button').forEach(b => b.onclick = () => { if (b.dataset.v === 'ar' && G.tab !== 'ar') G.prevTab = G.tab; G.tab = b.dataset.v; saveG(); render(); });
  const body = $('#tabBody');
  if (G.tab === 'measure') measureTab(body, canSlope);
  else if (G.tab === 'map') { if (!canSlope) body.innerHTML = lockedCard(FEATURE_NAMES.greenSlope); else mapTab(body); }
  else arTab(body, canLine);
  renderResult(canLine);
  void mode;
}

function measureTab(body, canSlope) {
  const geo = geometry();
  const isGrid = geo.kind === 'grid';
  const E = easy();
  body.innerHTML = `${depthCard()}<div class="card"><div class="row"><b class="grow">${E ? '공에서 홀까지 거리' : '③ 공 ↔ 홀컵 거리'}</b>${isGrid ? `<span class="pill">${E ? '그린 지도' : '그린맵 좌표'}</span>` : G.distSrc ? `<span class="pill">${esc(G.distSrc)}</span>` : ''}</div>
      ${isGrid ? `<div class="big" style="margin-top:6px">${geo.D.toFixed(1)}<small>m</small></div><p class="sub">${E ? '② 그린 지도에서 공·홀 위치를 바꿀 수 있어요.' : '그린맵 탭에서 공·홀 위치를 바꿀 수 있습니다.'}</p>`
      : `<div class="row" style="margin-top:6px"><input type="number" id="dIn" inputmode="decimal" step="0.1" min="0.5" max="40" value="${G.D || ''}" placeholder="거리 (m)" style="max-width:140px;font-size:22px;font-weight:800"><span class="sub">m</span></div>
         <div class="grid3" style="margin-top:8px"><button class="btn small" id="dSteps">👣 걸어서</button><button class="btn small" id="dCam">📷 카메라로</button><button class="btn small" id="dGps">📍 위치로</button></div>
         <p class="sub">${E ? '먼 거리(10m 넘게)는 걸어서, 가까운 거리(5m 안)는 카메라로 재면 정확해요. 위치로 재기는 몇 m 틀릴 수 있어요.' : '10m 이상은 걸음 측정, 5m 이내는 카메라 탭이 정확합니다. GPS는 오차 3~5m라 참고용.'}</p>`}</div>
    ${E ? `<div class="card"><b>그린 빠르기</b> <span class="sub">공이 얼마나 잘 굴러가나요?</span>
      <div class="seg" id="spdSeg" style="margin-top:8px">${[[8, '🐢 느려요'], [10, '🙂 보통'], [12, '🐇 빨라요']].map(([v, n]) => `<button data-st="${v}" class="${speedWord(G.stimp) === speedWord(v) ? 'on' : ''}">${n}</button>`).join('')}</div>
      <details class="sub" style="margin-top:6px"><summary>숫자로 고르기 (스팀프 ${G.stimp})</summary><input type="range" id="stimp" min="6" max="14" step="0.5" value="${G.stimp}"></details></div>`
    : `<div class="card"><b>그린 스피드 (스팀프)</b> <span class="sub">${G.stimp} ft · μ=${muFromStimp(G.stimp).toFixed(3)}</span>
      <input type="range" id="stimp" min="6" max="14" step="0.5" value="${G.stimp}"><div class="row sub"><span>느림 6</span><span class="grow"></span><span>보통 10</span><span class="grow"></span><span>빠름 14</span></div></div>`}
    ${canSlope ? `<div class="card"><div class="row"><b class="grow">${E ? `기울기 재기 ${isGrid ? '(안 해도 돼요)' : ''}` : `경사 측정 ${isGrid ? '(선택: 현장 보정)' : ''}`}</b><label class="row sub"><input type="checkbox" id="precise" ${G.precise ? 'checked' : ''}> ${E ? '더 정확하게 (두 번)' : '정밀(180° 2회)'}</label></div>
      <p class="sub">휴대폰 화면을 위로, <b>윗부분이 홀 쪽</b>을 보게 그린에 눕혀 놓고 [재기]를 눌러요. 2초 동안 움직이지 마세요.</p>
      ${measurePoints(G.D || geo.D).map(p => `<div class="kv"><span>${p.label}${!isGrid && G.D ? ` <span class="sub">(${p.y.toFixed(1)}m)</span>` : ''}</span><span>${p.m ? (E ? slopeEasy(p.m) : slopeText(p.m)) : `<span class="sub">${E ? '아직' : '미측정'}</span>`} <button class="btn small" data-meas="${p.key}">${p.m ? '다시' : E ? '재기' : '측정'}</button></span></div>`).join('')}
      ${Object.values(G.meas).some(Boolean) ? `<button class="btn small ghost" id="clrMeas">${E ? '잰 기울기 지우기' : '측정값 지우기'}</button>` : ''}
    </div>` : lockedCard(FEATURE_NAMES.greenSlope)}
    <button class="btn primary block" id="calc" ${!isGrid && !(G.D > 0) ? 'disabled' : ''}>${E ? '🎯 어떻게 칠지 보기' : '퍼팅 계산'}</button>`;
  $('#dIn')?.addEventListener('change', e => { addDist(Math.max(0, +e.target.value || 0), 'typed'); saveG(); render(); });
  $('#stimp').oninput = e => { G.stimp = +e.target.value; const lab = e.target.previousElementSibling; if (lab?.tagName === 'SPAN') lab.textContent = `${G.stimp} ft · μ=${muFromStimp(G.stimp).toFixed(3)}`; };
  $('#stimp').onchange = () => { S.settings.stimp = G.stimp; save('settings'); G.result = null; saveG(); if (easy()) render(); };
  $$('[data-st]').forEach(b => b.onclick = () => { G.stimp = +b.dataset.st; S.settings.stimp = G.stimp; save('settings'); G.result = null; saveG(); render(); });
  $('#precise')?.addEventListener('change', e => { G.precise = e.target.checked; saveG(); });
  $$('[data-meas]').forEach(b => b.onclick = () => measureSlope(b.dataset.meas));
  $('#clrMeas')?.addEventListener('click', () => { G.meas = {}; G.result = null; saveG(); render(); });
  $('#dSteps')?.addEventListener('click', stepsSheet);
  $('#dCam')?.addEventListener('click', () => { G.tab = 'ar'; G.arMode = 'distance'; render(); });
  $('#dGps')?.addEventListener('click', () => {
    const h = activeHole(), pin = h?.pin; if (!pin || !Sensors.pos) return toast('깃발 위치와 내 위치를 알아야 잴 수 있어요 · 걸어서 재기를 써 보세요', 3500);
    addDist(distance(Sensors.pos, pin), 'gps', { acc: Sensors.pos.acc }); saveG(); render();
  });
  $('#calc').onclick = compute;
  $('#depthGo')?.addEventListener('click', () => runDepth(canSlope));
  $('#surveyGo')?.addEventListener('click', runSurvey);
}

// 📏 깊이 카메라 카드: 한 번에 거리 + 그린 높낮이 (LiDAR · ARCore 깊이를 쓸 수 있는 앱에서만)
function depthCard() {
  if (!depth?.ok) return '';
  const E = easy(), sc = G.scan;
  return `<div class="card dp-card"><button class="dp-go" id="depthGo"><i>📏</i><span><b>${sc ? '다시 재기' : E ? '카메라로 한 번에 재기' : '깊이 카메라로 측정'}</b><small>${E ? '공 → 홀을 찍고 그린을 한 번 비추면 거리와 높낮이를 재요' : `${KIND_WORD[depth.kind] || '카메라'} · 거리(cm) + 그린 높이 지도`}</small></span><em>›</em></button>
    ${sc ? `<div class="dp-res"><div><small>거리</small><b>${sc.D.toFixed(2)}m</b></div><div><small>${sc.dh >= 0 ? '오르막' : '내리막'}</small><b>${Math.abs(sc.dh * 100).toFixed(0)}cm</b></div><div><small>믿음</small><b>${confWord(sc.conf)}</b></div></div>
      <p class="sub">${esc(KIND_WORD[sc.kind] || '카메라')}${sc.planeOnly ? ' · 그린을 덜 비춰서 평균 기울기만 썼어요' : ` · 길의 ${Math.round(sc.coverage * 100)}%를 봤어요`}</p>` : ''}
    ${allowed('greenSlope') ? `<button class="dp-sv" id="surveyGo">🛰️ 이 그린 전체 측량하기 <small>(골프장 직원용 · 1분)</small></button>` : ''}</div>`;
}
// 🛰️ 그린 전체 측량 → 이 홀 그린맵(이 휴대폰) + 관리자에게 보낼 파일
async function runSurvey() {
  const h = activeHole();
  if (!h?.front || !h?.back || !h?.green) return sheet({ title: '그린 위치가 먼저 필요해요', body: '<p>측량한 높이를 지도에 맞추려면 이 홀의 <b>그린 앞 · 뒤 · 가운데</b> 위치가 있어야 해요.</p><p class="sub">관리자 페이지 → 코스 편집 → ⚡ 빠른 지정에서 그린 앞·뒤를 찍고 발행한 뒤, 앱에서 코스를 업데이트하세요.</p>', actions: [{ label: '알겠어요', kind: 'primary' }] });
  if (h.greenGrid && h.greenGrid.by !== 'user' && !(await new Promise(res => sheet({ title: '이미 그린맵이 있어요', body: `<p>이 홀에는 골프장이 발행한 그린맵(${esc(h.greenGrid.source || '')})이 있어요. 새로 측량해서 이 휴대폰에서만 바꿀까요?</p>`, actions: [{ label: '취소', onClick: () => res(false) }, { label: '측량하기', kind: 'primary', onClick: () => res(true) }] })))) return;
  try {
    const raw = await surveyWithDepth();
    if (raw.cancelled) { if (raw.error) toast(raw.error, 4000); return; }
    const r = processSurvey(raw, h);
    h.greenGrid = r.greenGrid; save('courses');
    G.src = 'grid'; G.gBall = G.gHole = null; G.result = null; G.tab = 'map'; saveG(); render();
    const g = r.greenGrid.grid, file = { format: 'pinpoint-green-survey', version: 1, course: activeCourse()?.official?.id || activeCourse()?.name, hole: h.n, ...r.greenGrid };
    sheet({ title: '🛰️ 그린 측량 완료', body: `<div class="dp-res light"><div><small>격자</small><b>${g.nx}×${g.ny}</b></div><div><small>본 곳</small><b>${Math.round(r.coverage * 100)}%</b></div><div><small>점</small><b>${Math.round(r.nPts / 1000)}천 개</b></div></div>
      ${r.warn ? `<p style="color:var(--danger)">⚠ ${esc(r.warn)}</p>` : ''}
      <p>이 휴대폰의 ${h.nineHole ?? h.n}번 홀 그린 지도에 바로 넣었어요. 모든 사람이 쓰게 하려면 파일을 골프장 관리자에게 보내 주세요 (관리자 페이지 → 그린맵 → JSON 올리기).</p>
      ${r.coverage < 0.5 ? '<p class="sub">비춘 곳이 절반이 안 돼요. 빈 곳은 주변 높이로 채웠어요. 다시 하면 더 정확해져요.</p>' : ''}`,
      actions: [{ label: '닫기' }, { label: '📤 관리자에게 보내기', kind: 'primary', onClick: async () => { try { await saveFile(`green-survey-h${h.n}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(file), 'application/json', 'PinPoint 그린 측량'); } catch (e) { toast('보내지 못했어요: ' + e.message, 4000); } return false; } }] });
  } catch (e) { toast('측량하지 못했어요: ' + (e?.message || e), 5000); }
}
async function runDepth(canSlope) {
  const take = r => {
    addDist(r.D, r.kind === 'lidar' ? 'lidar' : r.kind === 'depth' ? 'depth' : 'plane');
    if (canSlope) { G.scan = r; G.src = 'scan'; G.gBall = { x: 0, y: 0 }; G.gHole = { x: 0, y: r.D }; }
    saveG(); vibrate(60);
  };
  try {
    if (!canSlope) { // 대회 모드: 거리만 (선은 규칙상 안 그림)
      const r = await measureWithDepth({ scan: false }); if (r.cancelled) return;
      take(r); toast(`📏 ${r.D.toFixed(2)}m`, 3000); render(); return;
    }
    // 🔴 실시간: 잰 뒤에도 AR 화면이 열린 채로 → 측정한 그린 표면 위에 격자·경사 화살표·퍼팅 길을 고정해서 보여 줌
    let lastScan = null;
    const info = () => {
      const r = G.result, sc = lastScan; if (!sc) return '';
      const along = sc.slope.along * 100, cross = sc.slope.cross * 100;
      const parts = [`홀까지 ${sc.D.toFixed(2)}m`, `${sc.dh >= 0 ? '⬆' : '⬇'} ${Math.abs(sc.dh * 100).toFixed(1)}cm`, `${along >= 0 ? '오르막' : '내리막'} ${Math.abs(along).toFixed(1)}% · ${Math.abs(cross) < 0.1 ? '좌우 평평' : `${cross > 0 ? '오른쪽' : '왼쪽'}이 ${Math.abs(cross).toFixed(1)}% 높음`}`];
      if (r && allowed('puttLine')) parts.push(`${aimText(r)} · 퍼터를 뒤로 ${Math.round(backswingCm(r.flatEquiv, S.calib))}cm`); else parts.push('퍼팅 길 계산 중…');
      return parts.join(String.fromCharCode(10));
    };
    liveSend = () => { if (lastScan) sendOverlay(greenOverlay(lastScan, allowed('puttLine') ? G.result : null, { info: info() })); };
    await liveDepth({ mode: 'green', onScan: r => { lastScan = r; take(r); G.result = null; render(); compute(); return greenOverlay(r, null, { info: info() }); } });
    liveSend = null; render();
  } catch (e) { liveSend = null; toast('재지 못했어요: ' + (e?.message || e), 4000); }
}
function slopeText(m) {
  const along = m.gy * 100, cross = m.gx * 100;
  return `<b>${along >= 0 ? '오르막' : '내리막'} ${Math.abs(along).toFixed(1)}%</b> · ${Math.abs(cross) < 0.15 ? '좌우 평평' : (cross > 0 ? '오른쪽이 높음' : '왼쪽이 높음') + ' ' + Math.abs(cross).toFixed(1) + '%'}${m.precise ? ' <span class="pill">정밀</span>' : ''}`;
}

// 기울기 센서 측정 (gx: 오른쪽 방향 경사, gy: 홀 방향 경사). 정밀 모드는 180° 회전 2회로 센서 바이어스 상쇄
async function measureSlope(key) {
  if (Sensors.beta == null) return toast('기울기를 읽을 수 없어요 · 설정 → 📍 위치·🧭 나침반에서 다시 허락해 주세요', 3500);
  const bias = S.calib.tilt || { beta: 0, gamma: 0 };
  const run = async () => {
    const a = await sampleTilt(2000);
    if (!a) return null;
    if (a.sdBeta > 0.4 || a.sdGamma > 0.4) { toast('흔들림이 큽니다. 다시 측정하세요'); return null; }
    if (Math.abs(a.beta) > 15 || Math.abs(a.gamma) > 15) { toast('휴대폰을 그린 위에 평평하게 놓아 주세요'); return null; }
    return a;
  };
  toast('측정 중… 움직이지 마세요');
  const A = await run(); if (!A) return;
  let beta, gamma, precise = false;
  if (G.precise) {
    vibrate(60);
    const ok = await new Promise(res => sheet({ title: '180° 돌려 놓기', body: '<p>같은 자리에서 휴대폰을 <b>반대 방향(윗부분이 내 쪽)</b>으로 돌려 놓은 뒤 계속을 누르세요.</p>', actions: [{ label: '취소', onClick: () => res(false) }, { label: '계속', kind: 'primary', onClick: () => res(true) }], dismissable: false }));
    if (!ok) return;
    toast('두 번째 측정 중…');
    const B = await run(); if (!B) return;
    beta = (A.beta - B.beta) / 2; gamma = (A.gamma - B.gamma) / 2; precise = true;
    S.calib.tilt = { beta: (A.beta + B.beta) / 2, gamma: (A.gamma + B.gamma) / 2, ts: Date.now() }; save('calib');
  } else { beta = A.beta - bias.beta; gamma = A.gamma - bias.gamma; }
  G.meas[key] = { beta, gamma, gx: -Math.tan(toRad(gamma)), gy: Math.tan(toRad(beta)), precise, ts: Date.now() };
  G.result = null; saveG(); vibrate(40); render();
}

function stepsSheet() {
  let n = 0, stop = null;
  sheet({
    title: '걸음으로 거리 재기', body: `<p class="sub">공에서 출발해 평소 보폭으로 홀까지 걸으세요. 보폭 ${S.settings.stepLen}m (설정에서 변경).</p><div class="big" id="stepN">0<small>걸음</small></div><div class="row" style="margin-top:8px"><button class="btn small" id="stMinus">−1</button><button class="btn small" id="stPlus">+1</button></div>`,
    onMount(card) {
      const upd = () => $('#stepN', card).innerHTML = `${n}<small>걸음 · ${(n * S.settings.stepLen).toFixed(1)}m</small>`;
      stop = startSteps(c => { n = c; upd(); });
      $('#stMinus', card).onclick = () => { n = Math.max(0, n - 1); upd(); };
      $('#stPlus', card).onclick = () => { n++; upd(); };
    },
    actions: [{ label: '취소', onClick: () => stop && stop() }, { label: '도착', kind: 'primary', onClick: () => { stop && stop(); if (!n) return; addDist(n * S.settings.stepLen, 'steps'); saveG(); render(); } }],
  });
}

// ---------- 계산 ----------
function compute() {
  const geo = geometry();
  if (geo.D < 0.3) return toast('거리를 먼저 입력하세요');
  if (geo.kind === 'onsite' && !geo.nMeas && allowed('greenSlope')) toast('경사 측정이 없어 평지로 가정합니다');
  const res = $('#result'); res.innerHTML = '<div class="card"><div class="empty">물리 시뮬레이션 · 몬테카를로 계산 중…</div></div>';
  const msg = { id: ++reqId, spec: geo.spec, mu: muFromStimp(G.stimp), ball: geo.ball, hole: geo.hole, skill: { sigmaAimDeg: S.settings.aimSigma, sigmaSpeed: S.settings.speedSigma } };
  const done = r => { if (msg.id !== reqId) return; G.result = { ...r, conf: confidence(geo), D: geo.D, kind: geo.kind }; G.revealed = false; renderResult(allowed('puttLine')); liveSend?.(); if (G.tab === 'map') mapTab($('#tabBody')); announce(); };
  try {
    worker = worker || new Worker(new URL('../physics/putt.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { if (e.data.ok) done(e.data.r); else fallback(); };
    worker.onerror = () => { worker = null; fallback(); };
    worker.postMessage(msg);
  } catch { fallback(); }
  function fallback() { setTimeout(() => { const s = buildSurface(msg.spec); done(optimizePutt(s, msg.mu, msg.ball, msg.hole, msg.skill, { bounds: s.bounds })); }, 20); }
}

// ---------- 쉬운 말 (쉬운 화면) ----------
const easy = () => !S.settings.detail;
const speedWord = st => (st < 9 ? '느려요' : st <= 11 ? '보통' : '빨라요');
const confWord = c => (c >= 0.75 ? '믿을 만해요' : c >= 0.5 ? '대략이에요' : '참고만 하세요');
// 조준: 홀 왼쪽/오른쪽으로 몇 cm (컵 개수는 괄호)
function aimText(r) {
  const cm = Math.round(Math.abs(r.aimOffset) * 100), a = Math.abs(r.aimCups);
  if (cm < 5) return '홀 가운데를 보고';
  return `홀 ${r.aimCups > 0 ? '왼쪽' : '오른쪽'}으로 ${cm}cm${a >= 0.5 ? ` (컵 ${a.toFixed(1)}개)` : ''}`;
}
// 소리로 읽기: '홀 왼쪽 27센티 지점을 보고, 퍼터를 뒤로 30센티 빼서 치세요'
function sayPutt(r, bs) {
  const cm = Math.round(Math.abs(r.aimOffset) * 100);
  return `${cm < 5 ? '홀 가운데를 보고' : `홀 ${r.aimCups > 0 ? '왼쪽' : '오른쪽'} ${cm}센티 지점을 보고`}, 퍼터를 뒤로 ${Math.round(bs)}센티 빼서 치세요`;
}
// 경사 한 줄: 오르막/내리막 + 어느 쪽이 높은지 → 공이 휘는 쪽
function slopeEasy(m) {
  const along = m.gy * 100, cross = m.gx * 100;
  const a = Math.abs(along) < 0.5 ? '평평해요' : `${along > 0 ? '오르막' : '내리막'}${Math.abs(along) >= 2 ? '이 커요' : '이에요'}`;
  const c = Math.abs(cross) < 0.3 ? '' : ` · ${cross > 0 ? '오른쪽' : '왼쪽'}이 높아요 → 공이 ${cross > 0 ? '왼쪽' : '오른쪽'}으로 휘어요`;
  return `<b>${a}</b>${c}${m.precise ? ' <span class="pill">두 번 잼</span>' : ''}`;
}

function cupsText(r) {
  const c = r.aimCups, a = Math.abs(c);
  if (a < 0.25) return '홀 정중앙';
  if (a < 0.5) return `홀 ${c > 0 ? '왼쪽' : '오른쪽'} 안쪽 가장자리`;
  return `홀 ${c > 0 ? '왼쪽' : '오른쪽'} 컵 ${a.toFixed(1)}개`;
}
function announce() {
  const r = G.result; if (!r || !allowed('puttLine')) return;
  const bs = backswingCm(r.flatEquiv, S.calib);
  speak(easy() ? sayPutt(r, bs) : `${cupsText(r)}, 평지 ${r.flatEquiv.toFixed(1)}미터 세기, 백스윙 ${Math.round(bs)}센티`);
}

// 이 계산에 쓴 기술 (거리 · 경사)
function techLine() {
  const geo = geometry(), slope = [];
  if (geo.kind === 'grid') slope.push(G.src === 'scan' && G.scan ? (G.scan.kind === 'lidar' ? 'lidar' : G.scan.kind === 'depth' ? 'depth' : 'plane') : G.src === 'grid' ? 'survey' : null);
  if (Object.values(G.meas || {}).some(Boolean)) slope.push(Object.values(G.meas).some(m => m?.precise) ? 'tiltPrecise' : 'tilt');
  const d = G.dFuse ? srcLine(G.dFuse.srcs) : G.distSrc || '';
  const sl = slope.filter(Boolean);
  return `<p class="sub tech">🔀 거리: ${esc(d || (geo.kind === 'grid' ? '그린 지도 좌표' : '—'))}${G.dFuse?.dropped?.length ? ` <small>(튀는 값 뺌: ${esc(srcLine(G.dFuse.dropped))})</small>` : ''}<br>🔀 경사: ${esc(sl.length ? srcLine(sl) : '측정 없음 (평지로 가정)')}</p>`;
}

function renderResult(canLine) {
  const box = $('#result'); if (!box) return;
  const r = G.result; if (!r) { box.innerHTML = ''; return; }
  const E = easy();
  setTimeout(() => { const b2 = $('#result'); if (b2 && !b2.querySelector('.tech')) b2.insertAdjacentHTML('beforeend', techLine()); }, 0);
  const dhTxt = Math.abs(r.dh) < 0.01 ? (E ? '평평해요' : '평지') : `${r.dh > 0 ? '오르막' : '내리막'} ${Math.abs(r.dh * 100).toFixed(0)}cm`;
  const head = E ? `<div class="card"><div class="row"><b class="grow">${r.D.toFixed(1)}m · ${dhTxt}</b><span class="pill">${confWord(r.conf)}</span></div></div>`
    : `<div class="card"><div class="row"><b class="grow">실제 ${r.D.toFixed(1)}m · ${dhTxt}</b>${confBadge(r.conf)}</div>
      <p class="sub" style="margin:4px 0 0">공 위치 경사: ${r.slopeAtBall.along >= 0 ? '오르막' : '내리막'} ${Math.abs(r.slopeAtBall.along).toFixed(1)}% · 옆경사 ${Math.abs(r.slopeAtBall.cross).toFixed(1)}% (${r.slopeAtBall.cross > 0 ? '왼쪽 높음 → 오른쪽으로 휨' : r.slopeAtBall.cross < 0 ? '오른쪽 높음 → 왼쪽으로 휨' : '휨 없음'})</p></div>`;
  if (E && canLine && r.conf >= 0.4 && !(currentMode() === 'practice' && G.training && !G.revealed)) return renderEasyResult(box, r, head);
  if (!canLine) { box.innerHTML = head.replace(/<p class="sub"[\s\S]*?<\/p>/, '') + lockedCard(FEATURE_NAMES.puttLine); return; }
  if (r.conf < 0.4) {
    box.innerHTML = head + (E ? `<div class="card"><b>기울기를 더 재야 어떻게 칠지 알려 드릴 수 있어요</b><p class="sub">① 재기에서 기울기를 두 곳 이상 재 주세요.</p></div>`
      : `<div class="card"><b>신뢰도가 낮아 라인 대신 경사 정보만 표시합니다</b><p class="sub">경사를 2곳 이상 측정하거나 정밀(180°) 모드를 쓰면 라인을 보여드립니다.</p></div>`); return;
  }
  const training = currentMode() === 'practice' && G.training && !G.revealed;
  const bs = backswingCm(r.flatEquiv, S.calib);
  if (training) {
    box.innerHTML = head + `<div class="card"><b>그린 리딩 훈련</b><p class="sub">먼저 직접 읽어 보세요. 정답과 비교해 드립니다.</p>
      <label class="f"><span>조준 (컵 개수, 왼쪽 +)</span><input type="range" id="gCups" min="-8" max="8" step="0.5" value="0"><b id="gCupsV">0</b></label>
      <label class="f"><span>평지 환산 세기 (m)</span><input type="number" id="gFlat" step="0.1" value="${r.D.toFixed(1)}"></label>
      <button class="btn primary block" id="reveal">정답 보기</button></div>`;
    $('#gCups').oninput = e => $('#gCupsV').textContent = e.target.value;
    $('#reveal').onclick = () => { G.guess = { cups: +$('#gCups').value, flat: +$('#gFlat').value }; G.revealed = true; renderResult(true); if (G.tab === 'map') mapTab($('#tabBody')); };
    return;
  }
  const alt = r.alts?.length > 1 ? r.alts.map(a => `<tr${a.pastDist === r.pastDist ? ' style="font-weight:800"' : ''}><td>${Math.round(a.pastDist * 100)}cm</td><td>${(a.mc.pMake * 100).toFixed(0)}%</td><td>${(a.mc.pTwoPuttOrBetter * 100).toFixed(0)}%</td><td>${(a.aimOffset / CUP_W).toFixed(1)}</td></tr>`).join('') : '';
  box.innerHTML = head + `<div class="card" style="border-color:var(--green2)">
      <div class="sub">이렇게 치세요</div>
      <div class="mid">${cupsText(r)} 조준</div>
      <div class="mid">평지 ${r.flatEquiv.toFixed(1)}m 세기 · 백스윙 ${Math.round(bs)}cm</div>
      <p class="sub" style="margin-top:6px">홀을 약 ${Math.round(r.pastDist * 100)}cm 지나치는 속도 · 최대 휨 ${Math.abs(r.breakM * 100).toFixed(0)}cm ${r.breakM > 0 ? '(왼쪽으로 부풂)' : r.breakM < 0 ? '(오른쪽으로 부풂)' : ''} · 초기 속도 ${r.v0.toFixed(2)}m/s</p>
      ${G.guess && G.revealed ? `<p><b>내 예측</b>: 컵 ${signed(G.guess.cups)}개 / ${G.guess.flat}m → 조준 오차 ${(G.guess.cups - r.aimCups).toFixed(1)}컵, 세기 오차 ${signed(G.guess.flat - r.flatEquiv)}m</p>` : ''}
      <div class="grid3" style="margin-top:8px"><div class="stat"><div class="v">${(r.mc.pMake * 100).toFixed(0)}%</div><div class="l">성공 확률</div></div>
        <div class="stat"><div class="v">${(r.mc.pTwoPuttOrBetter * 100).toFixed(0)}%</div><div class="l">2퍼트 이내</div></div>
        <div class="stat"><div class="v">${r.mc.meanLeave.toFixed(1)}m</div><div class="l">빗나갈 때 남는 거리</div></div></div>
      <div class="row" style="margin-top:10px"><button class="btn grow ${metroOn ? 'on' : ''}" id="metro">🎵 템포 메트로놈 ${metroOn ? '끄기' : '켜기'}</button><button class="btn" id="spk">🔊</button></div>
      ${currentMode() === 'practice' ? `<label class="switch"><span>그린 리딩 훈련 모드 (먼저 예측)</span><input type="checkbox" id="train" ${G.training ? 'checked' : ''}></label>` : ''}
      ${feelRow()}
    </div>
    ${alt ? `<details class="card tight"><summary class="sub">지나치는 거리별 비교 (몬테카를로 ${160}회)</summary><div class="tblwrap" style="margin-top:8px"><table class="score"><tr><th>지나침</th><th>성공</th><th>2퍼트↓</th><th>조준(컵)</th></tr>${alt}</table></div></details>` : ''}
    <p class="sub">백스윙 크기는 ${S.calib.samples?.length ? '내 캘리브레이션' : '기본값'} 기준입니다. <a href="#/calib">연습 그린 캘리브레이션</a>(3m·6m·9m)을 하면 정확해집니다. 오차 가정: 조준 ±${S.settings.aimSigma}° · 세기 ±${Math.round(S.settings.speedSigma * 100)}%.</p>`;
  $('#metro').onclick = () => { metroOn = !metroOn; metronome(metroOn, S.settings.tempoBpm); renderResult(true); };
  $('#spk').onclick = () => { const was = S.settings.voice; speak(`${cupsText(r)}, 평지 ${r.flatEquiv.toFixed(1)}미터 세기, 백스윙 ${Math.round(bs)}센티`, true); void was; };
  $('#train')?.addEventListener('change', e => { G.training = e.target.checked; G.revealed = false; saveG(); renderResult(true); });
  bindFeel();
}

// 친 뒤 한 번: 공이 짧았어요 / 딱 맞았어요 / 길었어요 → 오늘 이 골프장 그린 빠르기를 맞춤 (다음 퍼트부터)
function feelRow() {
  const gt = greenToday(activeCourse());
  return `<div class="pt-feel"><div class="pt-feel-h">치고 나서 눌러 주세요 · 공이…${gt?.src === 'feel' ? ` <small>오늘 ${gt.n}번 맞춤</small>` : ''}</div>
    <div class="pt-feel-b"><button data-feel="short">짧았어요</button><button data-feel="good">딱 맞았어요</button><button data-feel="long">길었어요</button></div></div>`;
}
function bindFeel() {
  $$('[data-feel]').forEach(b => b.onclick = () => {
    const k = b.dataset.feel, f = recordPuttFeel(activeCourse(), G.stimp, k);
    const changed = f.stimp !== G.stimp;
    G.stimp = f.stimp; G.result = null; saveG();
    toast(k === 'good' ? '👍 좋아요! 오늘 그린 빠르기 그대로 갈게요' : changed ? `알겠어요 · 오늘 그린은 생각보다 ${k === 'short' ? '느려요 → 다음 퍼트는 조금 세게' : '빨라요 → 다음 퍼트는 조금 살살'} 계산할게요` : '더 바꿀 수 없을 만큼 맞췄어요', 4000);
    render();
  });
}

// 쉬운 화면 결과: 어디를 보고 · 얼마나 세게(퍼터를 뒤로 몇 cm) · 들어갈 확률
function renderEasyResult(box, r, head) {
  const bs = Math.round(backswingCm(r.flatEquiv, S.calib)), past = Math.round(r.pastDist * 100);
  const brk = Math.abs(r.breakM * 100);
  box.innerHTML = head + `<div class="card pt-card">
      <div class="pt-row"><i>🎯</i><span><small>어디를 보고</small><b>${aimText(r)}</b>${brk >= 5 ? `<em>공이 ${r.breakM > 0 ? '왼쪽' : '오른쪽'}으로 ${Math.round(brk)}cm 부풀었다가 홀로 휘어 들어가요</em>` : '<em>거의 똑바로 굴러가요</em>'}</span></div>
      <div class="pt-row"><i>🏌️</i><span><small>얼마나 세게</small><b>퍼터를 뒤로 ${bs}cm 빼서 쳐요</b><em>평평한 곳에서 ${r.flatEquiv.toFixed(1)}m 굴리는 힘이에요 · 안 들어가면 홀을 ${past}cm쯤 지나가게</em></span></div>
      <div class="pt-bs" aria-hidden="true"><i style="width:${Math.min(100, bs / 60 * 100)}%"></i><span>${bs}cm</span></div>
      <div class="grid2" style="margin-top:10px"><div class="stat"><div class="v">${(r.mc.pMake * 100).toFixed(0)}%</div><div class="l">한 번에 들어갈 확률</div></div>
        <div class="stat"><div class="v">${(r.mc.pTwoPuttOrBetter * 100).toFixed(0)}%</div><div class="l">두 번 안에 넣을 확률</div></div></div>
      <div class="row" style="margin-top:10px"><button class="btn grow ${metroOn ? 'on' : ''}" id="metro">🎵 ${metroOn ? '박자 소리 끄기' : '박자 소리 (똑-딱에 맞춰 치기)'}</button><button class="btn" id="spk" aria-label="소리로 듣기">🔊</button></div>
      ${currentMode() === 'practice' ? `<label class="switch"><span>먼저 맞혀 보기 (연습)</span><input type="checkbox" id="train" ${G.training ? 'checked' : ''}></label>` : ''}
      ${feelRow()}
    </div>
    <p class="sub">퍼터를 뒤로 빼는 길이는 보통 사람 기준이에요. <a href="#/calib">연습 그린에서 내 힘 맞추기</a>를 하면 더 정확해져요.</p>`;
  $('#metro').onclick = () => { metroOn = !metroOn; metronome(metroOn, S.settings.tempoBpm); renderResult(true); };
  $('#spk').onclick = () => speak(sayPutt(r, bs), true);
  $('#train')?.addEventListener('change', e => { G.training = e.target.checked; G.revealed = false; saveG(); renderResult(true); });
  bindFeel();
}

// ---------- ④ 그린맵 ----------
let tapMode = null;
function mapTab(body) {
  const geo = geometry();
  if (geo.D < 0.3 && geo.kind === 'onsite') { body.innerHTML = `<div class="card">${easy() ? '① 재기에서 공에서 홀까지 거리를 먼저 넣어 주세요.' : '측정 탭에서 거리를 먼저 입력하세요.'}</div>`; return; }
  if (G.g3 && geo.kind === 'grid') {
    const gi = gridInfo(), b = gridBounds(gi.grid), surf = buildSurface(geo.spec);
    const ins = gi.grid.mask ? geo.inside : ovalInside(b);
    const th = Math.atan2(geo.hole.y - geo.ball.y, geo.hole.x - geo.ball.x) * 180 / Math.PI;
    body.innerHTML = `<div class="seg" id="g3Seg" style="margin-bottom:8px"><button data-v="2d">${easy() ? '위에서 보기' : '평면 지도'}</button><button data-v="3d" class="on">⛰️ ${easy() ? '입체로 보기' : '3D 그린'}</button></div>`;
    const back3 = $('#gBack'); if (back3) back3.innerHTML = '<div id="g3wrap"></div>'; // 입체 그린은 판 위 보이는 칸에
    mountGreen3D($('#g3wrap'), () => ({ surf, bounds: b, inside: ins, ball: geo.ball, hole: geo.hole, yaw0: 90 - th }));
    $$('#g3Seg button').forEach(x => x.onclick = () => { G.g3 = x.dataset.v === '3d'; saveG(); mapTab(body); });
    return;
  }
  const E = easy();
  body.innerHTML = `${geo.kind === 'grid' ? `<div class="seg" id="g3Seg" style="margin-bottom:8px"><button data-v="2d" class="on">${E ? '위에서 보기' : '평면 지도'}</button><button data-v="3d">⛰️ ${E ? '입체로 보기' : '3D 그린'}</button></div>` : ''}
    ${geo.kind === 'grid' ? `<div class="grid2"><button class="btn ${tapMode === 'ball' ? 'on' : ''}" id="tBall">⚪ ${E ? '공 위치 바꾸기' : '공 위치 탭'}</button><button class="btn ${tapMode === 'hole' ? 'on' : ''}" id="tHole">⛳ ${E ? '홀 위치 바꾸기' : '홀 위치 탭'}</button></div>` : ''}
    <p class="sub">${E ? `색이 진할수록 많이 기울었어요 · 흰 선은 높이가 같은 곳 · 화살표는 공이 굴러 내려가는 쪽이에요.${geo.kind === 'onsite' ? ' 직접 잰 곳(공~홀 사이)만 보여요.' : ''}` : `${esc(geo.name)} · 색 = 경사 크기, 흰 선 = 등고선(${'1~5'}cm), 화살표 = 물이 흐르는(공이 휘는) 방향. ${geo.kind === 'onsite' ? '현장 측정 범위(라인 주변)만 표시합니다.' : ''}`}</p>
    ${!G.result ? `<button class="btn primary block" id="calc2">${E ? '🎯 어떻게 칠지 보기' : '퍼팅 계산'}</button>` : ''}`;
  // 평면 그린은 판 위 보이는 칸을 꽉 채운 그림 (칸 크기 × 화면 배율로 선명하게)
  const back = $('#gBack');
  if (back) { const k = devicePixelRatio || 1; back.innerHTML = `<canvas class="g-cv" id="gcv" width="${Math.round(back.clientWidth * k)}" height="${Math.round(back.clientHeight * k)}"></canvas>`; }
  else body.insertAdjacentHTML('afterbegin', '<div class="card tight" style="padding:6px"><canvas class="view" id="gcv" width="900" height="1100"></canvas></div>');
  const cv = $('#gcv');
  const surf = buildSurface(geo.spec);
  const showLine = !(currentMode() === 'practice' && G.training && !G.revealed) && allowed('puttLine') && G.result && G.result.conf >= 0.4;
  const V = drawGreen(cv, surf, { ball: geo.ball, hole: geo.hole, result: showLine ? G.result : null, inside: geo.inside, stimpNote: easy() ? `빠르기 ${speedWord(G.stimp)} · ${geo.D.toFixed(1)}m` : `스팀프 ${G.stimp}ft · ${geo.D.toFixed(1)}m` });
  $$('#g3Seg button').forEach(x => x.onclick = () => { G.g3 = x.dataset.v === '3d'; saveG(); mapTab(body); });
  $('#calc2')?.addEventListener('click', compute);
  $('#tBall')?.addEventListener('click', () => { tapMode = tapMode === 'ball' ? null : 'ball'; mapTab(body); });
  $('#tHole')?.addEventListener('click', () => { tapMode = tapMode === 'hole' ? null : 'hole'; mapTab(body); });
  cv.onclick = e => {
    if (geo.kind !== 'grid' || !tapMode) return;
    const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * cv.width / r.width, py = (e.clientY - r.top) * cv.height / r.height;
    const w = V.toW(px, py); if (!geo.inside(w)) return toast('그린 범위 밖입니다');
    if (tapMode === 'ball') G.gBall = w; else G.gHole = w;
    tapMode = null; G.result = null; saveG(); renderResult(true); mapTab(body);
  };
}

// ---------- ⑤ AR 그린 리딩 (스마트 글라스식 화면) ----------
//  거리 링 격자(지형 따라 휨) · 경사 흐름 입자 · 퍼팅 라인 점선(굴러가는 공 미리보기) · 홀 거리 태그 · 오르막/내리막 · 물 흐름 나침반
//  휴대폰 기울기로 바로 표시, 홀컵 1탭으로 피치·요 보정, 이후 나침반으로 좌우 회전을 따라감
function arTab(body, canLine) {
  const geo0 = geometry();
  const distMode = G.arMode === 'distance' && geo0.kind === 'onsite';
  const needD = !distMode && geo0.kind === 'onsite' && geo0.D < 0.3; // 직접 재기인데 거리가 아직 없음 → 홀컵을 누르면 바로 재기
  // 거리 전에도 그린 굴곡(등고선·능선·흐름)을 바로 보여 주려고 임시 거리(지난번 거리 또는 8m)로 장면을 만듦 · 홀 표시·조준·오르막 판정은 거리를 잰 뒤에
  const geo = needD ? onsiteGeo(G.lastD || PREVIEW_D) : geo0;
  const canSlope = allowed('greenSlope');
  // 📱 전체 화면: 앱 머리줄·아래 메뉴를 숨기고 카메라가 화면을 꽉 채움 (✕ 또는 뒤로 가기로 닫기)
  document.documentElement.classList.add('gar-on'); immersive(true);
  body.innerHTML = `<div class="cam gar-full" id="cam"><video autoplay playsinline muted></video><canvas id="arcv"></canvas>
      <div class="hud top" id="arHud"><button class="gar-x" id="arClose" data-back aria-label="닫기">✕</button><b>${distMode ? '카메라로 거리 재기' : 'AR 그린 리딩'}</b><div class="sub" id="arMsg"></div></div>
      <button class="cam-zoom" id="arZoom" aria-label="화면 확대">1×</button>
      <div class="hud bottom"><div class="row">${distMode ? '' : `<button class="gar-tool" id="arSet" aria-label="그린 설정 열기" aria-expanded="false">${icon('sliders')}<span>설정</span></button>`}<button class="btn small" id="arCal">${distMode ? '취소' : '🎯 홀컵 탭으로 보정'}</button><span class="sub grow" id="arInfo"></span></div></div>
      ${distMode ? '' : `<section class="gar-pan" id="arPan" hidden aria-label="그린 설정">${arPanelHTML(geo)}</section>`}</div>
    <p class="sub">${easy() ? `공 뒤에 서서 휴대폰을 눈높이로 들고 홀 쪽을 비춰요. 화면의 홀을 한 번 누르면 더 정확해져요.<br>흰 줄 = 1m마다 거리 · 흘러가는 줄 = 공이 굴러 내려가는 쪽 · 초록 점 = 공이 갈 길` : `공 뒤 ${STAND_BACK}m에 서서 휴대폰을 눈높이(${S.settings.eyeHeight}m, 설정에서 변경)로 들고 홀 쪽을 비추세요. 흰 링 = 내 위치에서 1m 간격 거리(지형 높이 따라 휨), 흐르는 흰 줄 = 물이 흘러가는(공이 휘는) 방향, 초록 점선 = 퍼팅 라인. LiDAR 없이 카메라 높이·기울기로 지면을 투영하는 근사 AR이며, 화면의 홀컵을 한 번 탭하면 각도가 보정됩니다.`}</p>`;
  const video = $('#cam video'), cv = $('#arcv'), msg = $('#arMsg'), info = $('#arInfo');
  const zoom = attachZoom($('#cam'), video, $('#arZoom')); // 🔍 두 손가락·버튼으로 확대 (선도 같은 배율로)
  const proj = new GroundProjector({ height: S.settings.eyeHeight, vfovDeg: S.settings.cameraVFov });
  let cal = null, head = null, head0 = null; // (옛 값: 안 씀)
  // 📐 정밀 자세: 회전행렬(나침반 α · 앞뒤 β · 좌우 γ) → 그린 좌표(x 오른쪽 · y 앞 · z 위)를 화면에 투영
  //  그린의 '앞' 방위 b0 = AR을 켰을 때 카메라가 비춘 방위 (그래서 비추는 곳에 그린이 놓임) · 홀을 누르면 정확히 맞춤
  let pa = null, pb = null, pg = null, b0 = null, calibrating = false, Rm = null, popt = null, tapPt = null, calGap = null;
  const eyeH = S.settings.eyeHeight || 1.55;
  const toWorld = q => { const r = b0 * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r), x = q.x, y = q.y; return { x: x * c + y * sn, y: -x * sn + y * c, z: (q.z || 0) - eyeH }; };
  const toLocalG = e => { const r = b0 * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r); return { x: e.x * c - e.y * sn, y: e.x * sn + e.y * c }; };
  const prec = document.createElement('div'); prec.className = 'gar-prec'; $('#cam').appendChild(prec);
  prec.addEventListener('click', e => { const b = e.target.closest('[data-gp]'); if (!b) return; G.precOpen = b.dataset.gp === 'open'; saveG(); }); // 숫자 판 펼치기·접기
  startOrientation();
  // 정적 장면(한 번만 계산): 표면·시야 좌표·거리 링
  const surf = buildSurface(geo.spec), D = geo.D || 1, frame = lineFrame(geo.ball, geo.hole, STAND_BACK);
  const rMax = D + STAND_BACK + 3;
  const scene = distMode || geo.D < 0.3 ? null : distanceRings(surf, frame, geo.inside, { rMax, heights: canSlope });
  const flow = scene && canSlope ? new SlopeFlow(surf, frame, geo.inside, { rMax, rMin: STAND_BACK + 0.3 }) : null;
  const zOf = s => (scene && canSlope ? surf.height(s.x, s.y) - scene.h0 : 0);
  // 🗺️ 굴곡 표현 (측량에서 쓰는 일반 기법): 2cm 등고선(10cm마다 굵게) · 능선(노랑)/골(파랑) — 경사를 잰 그린만
  const topo = scene && canSlope ? contours(surf, frame, geo.inside, { rMax }) : null;
  const ridges = scene && canSlope ? ridgeLines(surf, frame, geo.inside, { rMax, h0: scene.h0, half: Math.max(2.5, Math.min(5, D * 0.45)) }) : [];
  const verdict = canSlope && scene && !needD ? slopeVerdict(surf.height(geo.hole.x, geo.hole.y) - surf.height(geo.ball.x, geo.ball.y), D) : null;
  const fall = canSlope && scene ? fallLine(surf, frame, geo.ball) : null;
  let dots = null, dotsFor = null, t0 = performance.now(), last = t0;

  if (distMode) msg.textContent = '화면에서 홀컵을 탭하세요 (휴대폰 기울기로 거리 계산)';
  else if (!canLine) msg.textContent = '대회 모드: 퍼팅 길은 규칙상 보여 줄 수 없어요';
  else if (needD) msg.innerHTML = `👆 <b>화면의 홀컵을 누르면</b> 거리를 재고 안내선을 바로 그려요${canSlope && !topo?.lines.length && !ridges.length ? '<br><small>경사를 아직 안 재서 평평하게 보여요 · ✕ → ① 재기의 <b>기울기 재기</b>(휴대폰을 그린에 눕혀 2초)를 하면 등고선·능선이 바로 나와요</small>' : ' <small>(⚙ 설정에서 숫자로 넣어도 돼요)</small>'}`;
  else if (geo.D < 0.3) msg.textContent = '먼저 측정 탭에서 거리를 입력하세요';
  else msg.textContent = '홀 쪽을 비추고, 화면의 홀을 한 번 누르면 정확해져요';
  // 결과가 없으면 바로 계산 (영상처럼 비추자마자 라인이 보이도록)
  if (!distMode && canLine && !needD && geo.D >= 0.3 && !G.result) compute();

  $('#arClose').onclick = () => { G.tab = G.arMode === 'distance' ? 'measure' : (G.prevTab || 'measure'); G.arMode = null; saveG(); render(); };
  if (!distMode) bindArPanel(geo);
  $('#arCal').onclick = () => { if (distMode) { G.arMode = null; G.tab = 'measure'; render(); } else { calibrating = true; msg.textContent = '👆 화면에서 진짜 홀컵을 누르세요'; } };
  openCamera(video).then(stop => { camStop = stop; loop(); }).catch(e => { msg.textContent = '카메라를 열 수 없습니다: ' + e.message + ' (HTTPS·권한 확인)'; });
  cv.onclick = e => {
    if (!Rm || !popt) return toast('방향 센서를 기다리는 중이에요');
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const v = unproject(Rm, x, y, popt), gh = groundHit(v, { eye: eyeH });
    if (!isFinite(gh.h)) return toast('수평선 아래(땅)를 눌러 주세요');
    if (distMode || needD) { addDist(Math.max(0.3, gh.h - STAND_BACK), 'camera', { sd: gh.err }); const back = needD || G.distBack === 'ar'; G.arMode = null; G.distBack = null; G.tab = back ? 'ar' : 'measure'; G.result = null; saveG(); vibrate(50); toast(`거리 ${G.D.toFixed(2)}m (±${gh.err.toFixed(2)}m)${back ? ' · 안내선을 그려요' : ''}`); render(); return; } // AR에서 쟀으면 AR에 그대로
    if (calibrating) {
      // 누른 곳 = 진짜 홀: 그린의 '앞' 방위를 돌려 홀이 그 방향에 오게, 카메라가 본 거리와 입력 거리 차이도 알려 줌
      const hv = frame.toView(geo.hole), want = Math.atan2(hv.x, hv.y) * 180 / Math.PI;
      b0 = (gh.bearing - want + 360) % 360; calibrating = false;
      calGap = gh.h - Math.hypot(hv.x, hv.y);
      vibrate(40); msg.textContent = `✅ 홀에 맞췄어요 · 카메라가 본 거리와 ${calGap >= 0 ? '+' : ''}${(calGap * 100).toFixed(0)}cm 차이`;
      return;
    }
    // 아무 곳이나: 그 점의 그린 좌표 → 공·홀에서 거리 (1cm)
    const e3 = { x: Math.sin(gh.bearing * Math.PI / 180) * gh.h, y: Math.cos(gh.bearing * Math.PI / 180) * gh.h }, q = toLocalG(e3);
    tapPt = { ...q, err: gh.err, at: performance.now() }; vibrate(15);
  };

  function loop() {
    if (!camStop) return;
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio;
    const ctx = cv.getContext('2d'), k = devicePixelRatio, T = zoomed(video.videoWidth ? coverTransform(video, cv) : { s: 1, ox: 0, oy: 0, vw: cv.clientWidth, vh: cv.clientHeight }, zoom.z);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (Sensors.heading != null) { head = smoothAngle(head, Sensors.heading, 0.2); if (head0 == null) head0 = head; }
    // 자세: 회전행렬(α·β·γ, 흔들림 완화) · 화면 회전(가로·세로)과 영상 확대(object-fit)까지 반영
    const al = Sensors.alphaAbs ?? Sensors.alpha;
    if (al != null && Sensors.beta != null) {
      pa = smoothAngle(pa, al, 0.25); pb = pb == null ? Sensors.beta : pb + (Sensors.beta - pb) * 0.3; pg = pg == null ? Sensors.gamma : pg + (Sensors.gamma - pg) * 0.3;
      Rm = rotationMatrix(pa, pb, pg || 0);
      if (b0 == null) b0 = cameraAxis(Rm).bearing; // 켰을 때 비춘 쪽 = 홀 쪽
    }
    const W0 = cv.clientWidth, so = (screen.orientation && screen.orientation.angle) || 0;
    const f = focalPx(S.settings.cameraVFov || 63, T.vh) * T.s * k;
    popt = { f: focalPx(S.settings.cameraVFov || 63, T.vh) * T.s, cx: T.ox + T.vw * T.s / 2, cy: T.oy + T.vh * T.s / 2, screenAngle: so };
    if (!distMode && scene && !Rm) msg.textContent = '🧭 방향 센서를 기다려요…';
    if (!distMode && scene && Rm) {
      const P = q => { const pp = project(Rm, toWorld(q), popt); return pp.visible ? { x: pp.x * k, y: pp.y * k, d: pp.depth } : null; };
      void W0;
      const poly = (pts, close) => { ctx.beginPath(); let pen = false; for (const q of pts) { const p = P(q); if (!p) { pen = false; continue; } pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true; } if (close) ctx.closePath(); ctx.stroke(); };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';

      // ① 등고선: 같은 높이를 잇는 선 (낮은 곳 파랑 → 높은 곳 주황) · 10cm마다 굵게 + 높이 글자 · 어두운 테두리로 어떤 바탕에서도 보이게
      if (topo && topo.lines.length) {
        const span = Math.max(0.01, topo.hi - topo.lo), col = lv => { const t = (lv - topo.lo) / span; const c = t < 0.5 ? [88 + (255 - 88) * t * 2, 180 + (255 - 180) * t * 2, 255] : [255, 255 - (255 - 159) * (t - 0.5) * 2, 255 - (255 - 67) * (t - 0.5) * 2]; return `rgb(${c.map(Math.round).join(',')})`; };
        for (const pass of [0, 1]) for (const L of topo.lines) {
          ctx.strokeStyle = pass ? col(L.level) : 'rgba(0,0,0,.45)'; ctx.lineWidth = ((L.major ? 2.4 : 1.3) + (pass ? 0 : 2)) * k;
          ctx.beginPath();
          for (const [a, b] of L.segs) { const pa2 = P(a), pb2 = P(b); if (!pa2 || !pb2) continue; ctx.moveTo(pa2.x, pa2.y); ctx.lineTo(pb2.x, pb2.y); }
          ctx.stroke();
        }
        ctx.font = `800 ${11 * k}px system-ui, sans-serif`; ctx.textAlign = 'center';
        for (const L of topo.lines) {
          if (!L.major || Math.abs(L.level) < 0.005) continue;
          const seg = L.segs.reduce((m, sg) => (Math.abs(sg[0].x) < Math.abs(m[0].x) ? sg : m), L.segs[0]), q = P(seg[0]); if (!q) continue;
          const t = `${L.level > 0 ? '+' : '−'}${Math.round(Math.abs(L.level) * 100)}cm`, w = ctx.measureText(t).width + 10 * k;
          ctx.fillStyle = 'rgba(0,0,0,.6)'; roundRect(ctx, q.x - w / 2, q.y - 9 * k, w, 17 * k, 6 * k); ctx.fill(); ctx.fillStyle = col(L.level); ctx.fillText(t, q.x, q.y + 4 * k);
        }
        ctx.textAlign = 'start';
      }
      // ①-2 능선(노랑 점선: 공이 갈라지는 곳) · 골(파랑 점선: 공이 모이는 곳)
      for (const rl of ridges) {
        const c = rl.kind === 'ridge' ? '#ffe066' : '#58b4ff';
        for (const pass of [0, 1]) { ctx.strokeStyle = pass ? c : 'rgba(0,0,0,.5)'; ctx.lineWidth = (pass ? 3 : 5.5) * k; ctx.setLineDash(pass ? [10 * k, 7 * k] : []); poly(rl.pts); }
        ctx.setLineDash([]);
        // 이름표는 화면 안에 보이는 점에 (가운데부터 바깥으로 찾음)
        let m = null; const Wc = cv.width, Hc = cv.height, mid = Math.floor(rl.pts.length / 2);
        for (let o = 0; o < rl.pts.length && !m; o++) for (const i of [mid + o, mid - o]) { const q = rl.pts[i] && P(rl.pts[i]); if (q && q.x > 40 * k && q.x < Wc - 80 * k && q.y > 120 * k && q.y < Hc - 140 * k) { m = q; break; } }
        if (m) { const t = rl.kind === 'ridge' ? '능선' : '골'; ctx.font = `900 ${12 * k}px system-ui, sans-serif`; const w = ctx.measureText(t).width + 12 * k; ctx.fillStyle = c; roundRect(ctx, m.x + 6 * k, m.y - 20 * k, w, 18 * k, 6 * k); ctx.fill(); ctx.fillStyle = '#14241c'; ctx.fillText(t, m.x + 12 * k, m.y - 6 * k); }
      }
      // ①-3 거리 눈금: 공 → 홀 선 위 1m마다 짧은 가로 눈금 (거리 고리 대신 · 화면을 덜 가림)
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.6 * k;
      if (!needD) for (let m = 1; m < D; m += 1) { const yv = STAND_BACK + m, a = P({ x: -0.18, y: yv, z: zOf(frame.toSurf({ x: 0, y: yv })) }), b = P({ x: 0.18, y: yv, z: zOf(frame.toSurf({ x: 0, y: yv })) }); if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }

      // ② 경사 흐름: 내리막으로 흘러가는 흰 줄
      if (flow) {
        for (const tr of flow.step(dt)) {
          if (tr.pts.length < 3) continue;
          const hd = tr.pts[tr.pts.length - 1].s, gg = surf.grad(hd.x, hd.y); ctx.globalAlpha = 0.85 * tr.fade; ctx.strokeStyle = slopeHue(Math.hypot(gg[0], gg[1]) * 100); ctx.lineWidth = 2 * k; // 경사 세기 색: 초록<1% · 노랑<2% · 주황<3% · 빨강
          poly(tr.pts.map(q => ({ x: q.x, y: q.y, z: zOf(q.s) })));
          ctx.globalAlpha = 1;
        }
      }

      // ③ 홀: 컵 테두리 + 거리 태그 (│10 yd) — 거리를 재기 전(임시 장면)에는 그리지 않음
      const hv = frame.toView(geo.hole), hz = zOf(geo.hole);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5 * k;
      if (!needD) poly(Array.from({ length: 25 }, (_, i) => { const a = i / 24 * Math.PI * 2; return { x: hv.x + Math.cos(a) * 0.054, y: hv.y + Math.sin(a) * 0.054, z: hz }; }), true);
      const hp = needD ? null : P({ ...hv, z: hz });
      if (hp) {
        const txt = DU(geo.D, S.settings.unit === 'yd' ? 0 : 1);
        ctx.font = `700 ${17 * k}px system-ui, sans-serif`;
        const w = ctx.measureText(txt).width, bx = hp.x - 4 * k, by = hp.y - 34 * k;
        ctx.fillStyle = 'rgba(40,40,40,.55)'; roundRect(ctx, bx, by, w + 18 * k, 26 * k, 5 * k); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(bx, by, 3 * k, 26 * k); ctx.fillRect(hp.x - 1 * k, by + 26 * k, 2 * k, hp.y - by - 26 * k);
        ctx.fillText(txt, bx + 10 * k, by + 19 * k);
      }

      // ④ 퍼팅 라인: 초록 점선 + 출발 방향 실선 + 굴러가는 공 미리보기
      const r = G.result, showLine = r && canLine && r.conf >= 0.4 && !(currentMode() === 'practice' && G.training && !G.revealed);
      if (showLine) {
        if (dotsFor !== r) { dots = resamplePath(r.path, 0.22); dotsFor = r; t0 = now; }
        const L = dots[dots.length - 1].s, roll = ((now - t0) / 1000) % (2.6 + 0.9), sHead = Math.min(1, roll / 2.6) ** 0.6 * L; // 감속하듯 이동
        for (const d of dots) {
          if (d.s < 0.6) continue;
          const p = P({ ...frame.toView(d), z: zOf(d) }); if (!p) continue;
          const near = Math.max(0, 1 - Math.abs(d.s - sHead) / 0.5);
          ctx.fillStyle = `rgba(${110 + 145 * near},255,${120 + 100 * near},${0.85})`;
          ctx.shadowColor = '#3dff6a'; ctx.shadowBlur = 8 * k;
          ctx.beginPath(); ctx.arc(p.x, p.y, clamp(0.03 * f / p.d, 1.6 * k, 5 * k) * (1 + near * 0.6), 0, 7); ctx.fill();
        }
        ctx.shadowBlur = 10 * k; ctx.strokeStyle = '#4dff73'; ctx.lineWidth = 4 * k;
        poly(dots.filter(d => d.s <= 0.6).map(d => ({ ...frame.toView(d), z: zOf(d) })));
        ctx.shadowBlur = 0;
        const ap = P({ ...frame.toView(r.aimPoint), z: zOf(r.aimPoint) });
        if (ap) { ctx.strokeStyle = 'rgba(255,226,122,.9)'; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(ap.x, ap.y, 9 * k, 0, 7); ctx.stroke(); ctx.fillStyle = '#ffe27a'; ctx.font = `700 ${13 * k}px system-ui, sans-serif`; ctx.fillText('조준점', ap.x + 12 * k, ap.y + 4 * k); }
        info.textContent = easy() ? `${aimText(r)} · 퍼터를 뒤로 ${Math.round(backswingCm(r.flatEquiv, S.calib))}cm` : `${cupsText(r)} · 평지 ${r.flatEquiv.toFixed(1)}m 세기 · 백스윙 ${Math.round(backswingCm(r.flatEquiv, S.calib))}cm`;
      } else if (needD) info.textContent = '홀컵을 누르면 거리를 재요';
      else {
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2 * k; ctx.setLineDash([8 * k, 8 * k]);
        poly([{ x: 0, y: STAND_BACK, z: zOf(geo.ball) }, { ...hv, z: hz }]); ctx.setLineDash([]);
        info.textContent = G.result || !canLine ? DU(geo.D, 1) : '퍼팅 라인 계산 중…';
      }
      // 공 표시
      const bp = P({ x: 0, y: STAND_BACK, z: zOf(geo.ball) });
      if (bp) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(bp.x, bp.y, clamp(0.06 * f / bp.d, 5 * k, 16 * k), 0, 7); ctx.stroke(); }

      // ⑤ 오르막/내리막 배지(오른쪽 위) + 물 흐름 나침반(왼쪽 위)
      const top = 168 * k; // 위 정밀 숫자 판 아래
      if (verdict) {
        const t1 = verdict.en, t2 = verdict.en === 'FLAT' ? verdict.ko : `${verdict.ko} ${Math.abs(verdict.dh * 100).toFixed(0)}cm`;
        ctx.font = `800 ${20 * k}px system-ui, sans-serif`; const w1 = ctx.measureText(t1).width;
        ctx.font = `600 ${12 * k}px system-ui, sans-serif`; const w = Math.max(w1, ctx.measureText(t2).width) + 22 * k, x = cv.width - w - 10 * k;
        ctx.fillStyle = 'rgba(30,30,30,.55)'; roundRect(ctx, x, top, w, 46 * k, 8 * k); ctx.fill();
        ctx.fillStyle = verdict.en === 'UPHILL' ? '#ffd27a' : verdict.en === 'DOWNHILL' ? '#8fd3ff' : '#e6e6e6';
        ctx.font = `800 ${20 * k}px system-ui, sans-serif`; ctx.fillText(t1, x + 11 * k, top + 23 * k);
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `600 ${12 * k}px system-ui, sans-serif`; ctx.fillText(t2, x + 11 * k, top + 39 * k);
      }
      if (fall && fall.pct >= 0.3) {
        const yawRel = ((cameraAxis(Rm).bearing - b0 + 540) % 360) - 180, cx = 40 * k, cy = top + 30 * k, R0 = 26 * k, a = (fall.deg - yawRel) * Math.PI / 180;
        ctx.fillStyle = 'rgba(30,30,30,.55)'; ctx.beginPath(); ctx.arc(cx, cy, R0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5 * k; ctx.stroke();
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.fillStyle = '#8fd3ff';
        ctx.beginPath(); ctx.moveTo(0, -R0 + 5 * k); ctx.lineTo(8 * k, 4 * k); ctx.lineTo(0, 0); ctx.lineTo(-8 * k, 4 * k); ctx.closePath(); ctx.fill(); ctx.restore();
        ctx.fillStyle = '#fff'; ctx.font = `700 ${11 * k}px system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(`${fall.pct.toFixed(1)}%`, cx, cy + R0 + 13 * k); ctx.fillText('물 흐름', cx, cy + R0 + 26 * k); ctx.textAlign = 'start';
      }
      // 📍 누른 곳: 공·홀에서 거리
      if (tapPt) {
        const tp = P({ x: tapPt.x, y: tapPt.y, z: zOf(frame.toSurf(tapPt)) || 0 });
        if (tp) { ctx.fillStyle = '#ffc83d'; ctx.beginPath(); ctx.arc(tp.x, tp.y, 6 * k, 0, 7); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * k; ctx.stroke(); }
      }
      if (now - (loop._pT || 0) > 200) { loop._pT = now; precise(); }
    }
    arT = requestAnimationFrame(loop);
  }
  // 📐 정밀 숫자 (0.01m · 0.01° · 0.1%): 홀까지 · 고저차 · 경사 · 조준 · 카메라 자세 · 누른 곳
  function precise() {
    if (!Rm) return;
    const ax = cameraAxis(Rm), hv = frame.toView(geo.hole), bv = frame.toView(geo.ball);
    const D2 = Math.hypot(hv.x - bv.x, hv.y - bv.y), dh = canSlope && scene ? surf.height(geo.hole.x, geo.hole.y) - surf.height(geo.ball.x, geo.ball.y) : 0;
    const sl = canSlope && scene ? surf.grad(geo.ball.x, geo.ball.y) : [0, 0];
    const ux = (geo.hole.x - geo.ball.x) / (D || 1), uy = (geo.hole.y - geo.ball.y) / (D || 1);
    const along = (sl[0] * ux + sl[1] * uy) * 100, cross = (sl[0] * uy - sl[1] * ux) * 100; // + 오르막 · + 오른쪽이 높음
    const r = G.result && canLine ? G.result : null;
    const aimDeg = r ? Math.atan2(r.aimOffset, D) * 180 / Math.PI : null;
    const roll = pg ?? 0, tilt = ax.pitch;
    const c2 = x => x.toFixed(2), c1 = x => x.toFixed(1);
    let tapLine = '';
    if (tapPt) {
      const db = Math.hypot(tapPt.x - bv.x, tapPt.y - bv.y), dhl = Math.hypot(tapPt.x - hv.x, tapPt.y - hv.y);
      tapLine = `<div class="gp-tap">📍 누른 곳 · 공에서 <b>${c2(db)}m</b> · 홀까지 <b>${c2(dhl)}m</b> <small>±${c2(tapPt.err)}m</small></div>`;
    }
    const key3 = `<div class="gp-k">
      <span><small>홀까지</small><b>${c2(D2)}m</b></span>
      <span><small>고저차</small><b>${dh >= 0 ? '⬆' : '⬇'} ${c1(Math.abs(dh * 100))}cm</b></span>
      ${r ? `<span><small>조준</small><b>${Math.abs(aimDeg) < 0.005 ? '정면' : `${aimDeg > 0 ? '왼쪽' : '오른쪽'} ${c1(Math.abs(r.aimCups ?? r.aimOffset / CUP_W))}컵`}</b></span>` : `<span><small>경사</small><b>${along >= 0 ? '오르막' : '내리막'} ${c1(Math.abs(along))}%</b></span>`}
      <button class="gp-more" data-gp="open" aria-label="숫자 모두 보기">▾</button></div>`;
    if (needD) { prec.innerHTML = `<div class="gp-k"><span><small>홀까지</small><b>홀컵을 누르세요</b></span><span><small>발밑 경사</small><b>${along >= 0 ? '오르막' : '내리막'} ${c1(Math.abs(along))}%</b></span></div>`; return; }
    if (!G.precOpen) { prec.innerHTML = key3 + tapLine; return; } // 📱 기본은 한 줄 (카메라 화면을 가리지 않게)
    prec.innerHTML = `<button class="gp-less" data-gp="close" aria-label="숫자 접기">▴ 접기</button><div class="gp-g">
      <span><small>홀까지</small><b>${c2(D2)}m</b></span>
      <span><small>직선</small><b>${c2(Math.hypot(D2, dh))}m</b></span>
      <span><small>고저차</small><b>${dh >= 0 ? '⬆' : '⬇'} ${c1(Math.abs(dh * 100))}cm</b></span>
      <span><small>경사 (앞뒤)</small><b>${along >= 0 ? '오르막' : '내리막'} ${c1(Math.abs(along))}%</b></span>
      <span><small>경사 (좌우)</small><b>${Math.abs(cross) < 0.05 ? '평평' : `${cross > 0 ? '오른쪽' : '왼쪽'}↑ ${c1(Math.abs(cross))}%`}</b></span>
      ${r ? `<span><small>조준</small><b>${Math.abs(aimDeg) < 0.005 ? '정면' : `${aimDeg > 0 ? '왼쪽' : '오른쪽'} ${c2(Math.abs(aimDeg))}°`}</b></span>
      <span><small>조준 (컵)</small><b>${c1(Math.abs(r.aimCups ?? r.aimOffset / CUP_W))}컵</b></span>
      <span><small>평지 세기</small><b>${c2(r.flatEquiv)}m</b></span>` : ''}
      <span><small>카메라 위아래</small><b>${c1(tilt)}°</b></span>
      <span><small>좌우 기울기</small><b>${c1(roll)}°</b></span>
      <span><small>방향</small><b>${c1(ax.bearing)}°</b></span>
      ${calGap != null ? `<span><small>홀 맞춤 차이</small><b>${calGap >= 0 ? '+' : ''}${(calGap * 100).toFixed(0)}cm</b></span>` : ''}
    </div>${tapLine}`;
  }
}
// ⚙ AR 화면 설정 판: 그린 화면(① 재기)의 기능을 카메라를 끄지 않고 바로 (닫혀 있으면 화면을 가리지 않음 · 열면 아래 절반만)
function arPanelHTML(geo) {
  const E = easy(), hole = activeHole(), onsite = geo.kind === 'onsite';
  const srcs = [['onsite', E ? '직접 재기' : '현장 측정'], ...(hole?.greenGrid ? [['grid', E ? '그린 지도' : '그린맵']] : []), ['demo', E ? '연습 그린' : '데모 그린']];
  return `<button class="gar-pan-h" id="arPanClose" aria-label="설정 닫기"><i></i><span>그린 설정</span><em>${icon('shrink')}</em></button>
    <div class="gar-pan-b">
      <div class="gp-sec"><div class="gp-lab">어떤 그린</div><div class="seg" id="apSrc">${srcs.map(([k, n]) => `<button data-v="${k}" class="${G.src === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        ${G.src === 'demo' ? `<div class="seg" id="apDemo" style="margin-top:6px">${[['tier', '2단'], ['saddle', '말안장'], ['mound', '마운드']].map(([k, n]) => `<button data-v="${k}" class="${G.demoKind === k ? 'on' : ''}">${n}</button>`).join('')}</div>` : ''}</div>
      <div class="gp-sec"><div class="gp-lab">공에서 홀까지</div>
        ${onsite ? `<div class="gp-dist"><button class="gp-step" data-dd="-0.5" aria-label="0.5m 줄이기">−</button><b>${(G.D || 0).toFixed(1)}<small>m</small></b><button class="gp-step" data-dd="0.5" aria-label="0.5m 늘리기">＋</button></div>
          <div class="gp-row"><button class="gp-btn" id="apCam">${icon('camera')}카메라로 다시 재기</button>${depth?.ok ? `<button class="gp-btn" id="apDepth">${icon('ruler')}카메라로 한 번에 재기</button>` : ''}</div>`
        : `<div class="gp-dist"><b>${geo.D.toFixed(1)}<small>m</small></b></div><p class="gp-note">공·홀 위치는 ② 그린 지도에서 눌러 바꿔요</p>`}</div>
      ${allowed('greenSlope') && geo.D >= 0.3 ? profileHTML(geo) : ''}
      <div class="gp-sec"><div class="gp-lab">그린 빠르기</div><div class="seg" id="apSpd">${[[8, '🐢 느려요'], [10, '🙂 보통'], [12, '🐇 빨라요']].map(([v, n]) => `<button data-st="${v}" class="${speedWord(G.stimp) === speedWord(v) ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <div class="gp-sec gp-row"><button class="gp-btn" data-go="measure">${icon('ruler')}① 재기 화면</button>${allowed('greenSlope') ? `<button class="gp-btn" data-go="map">${icon('map')}② 그린 지도</button>` : ''}</div>
    </div>`;
}
// 퍼팅 길 단면 (공 → 홀 높낮이 그래프) + 화면 선 보는 법
function profileHTML(geo) {
  const pr = lineProfile(buildSurface(geo.spec), geo.ball, geo.hole, 40), hs = pr.map(p => p.h);
  const lo = Math.min(0, ...hs), hi = Math.max(0, ...hs), span = Math.max(2, hi - lo), W = 300, Hh = 64;
  const X = s => 8 + (W - 16) * s / (pr.at(-1).s || 1), Y = h => 8 + (Hh - 16) * (1 - (h - lo) / span);
  const pts = pr.map(p => `${X(p.s).toFixed(1)},${Y(p.h).toFixed(1)}`).join(' '), end = pr.at(-1).h;
  return `<div class="gp-sec"><div class="gp-lab">퍼팅 길 높낮이 <span class="gp-end">홀이 ${Math.abs(end) < 0.5 ? '거의 같은 높이' : `${Math.abs(end).toFixed(1)}cm ${end > 0 ? '높아요 (오르막)' : '낮아요 (내리막)'}`}</span></div>
    <svg class="gp-prof" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-label="공에서 홀까지 높낮이 그래프"><line x1="8" x2="${W - 8}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" class="z"/><polygon points="8,${Hh - 8} ${pts} ${W - 8},${Hh - 8}" class="f"/><polyline points="${pts}" class="l"/><circle cx="${X(0)}" cy="${Y(0)}" r="4" class="b"/><circle cx="${X(pr.at(-1).s)}" cy="${Y(end)}" r="4" class="h"/></svg>
    <div class="gp-axis"><span>공 0cm</span><span>${pr.at(-1).s.toFixed(1)}m</span><span>홀 ${end >= 0 ? '+' : '−'}${Math.abs(end).toFixed(1)}cm</span></div>
    <p class="gp-key"><i class="k1"></i>낮은 곳 <i class="k2"></i>높은 곳 · 2cm마다 선 · <i class="k3"></i>능선 <i class="k4"></i>골 · 흐르는 줄 색 = 경사(초록 1% 미만 → 빨강 3% 이상)</p></div>`;
}
function bindArPanel(geo) {
  const pan = $('#arPan'), btn = $('#arSet'), close = $('#arClose'); if (!pan || !btn) return;
  // 뒤로 가기: 판이 열려 있으면 판부터 닫음
  const show = on => {
    pan.hidden = !on; G.arPanel = on; btn.setAttribute('aria-expanded', String(on)); btn.classList.toggle('on', on); $('#cam').classList.toggle('pan-on', on);
    if (on) { close.removeAttribute('data-back'); $('#arPanClose').setAttribute('data-back', ''); } else { $('#arPanClose').removeAttribute('data-back'); close.setAttribute('data-back', ''); }
    saveG();
  };
  btn.onclick = () => show(pan.hidden);
  $('#arPanClose').onclick = () => show(false);
  if (G.arPanel) show(true);
  const redo = () => { G.result = null; saveG(); render(); }; // 바뀐 값으로 다시 계산 (판은 열린 채)
  $$('#apSrc button').forEach(b => b.onclick = () => { if (G.src === b.dataset.v) return; G.src = b.dataset.v; G.gBall = G.gHole = null; redo(); });
  $$('#apDemo button').forEach(b => b.onclick = () => { G.demoKind = b.dataset.v; G.gBall = G.gHole = null; redo(); });
  pan.querySelectorAll('[data-dd]').forEach(b => b.onclick = () => { addDist(Math.max(0.5, Math.round(((G.D || 0) + +b.dataset.dd) * 10) / 10), 'typed'); redo(); });
  $$('#apSpd button').forEach(b => b.onclick = () => { G.stimp = +b.dataset.st; S.settings.stimp = G.stimp; save('settings'); redo(); });
  $('#apCam')?.addEventListener('click', () => { G.arMode = 'distance'; G.distBack = 'ar'; G.arPanel = false; saveG(); render(); });
  $('#apDepth')?.addEventListener('click', () => { G.arPanel = false; G.tab = 'measure'; saveG(); render(); setTimeout(() => $('#depthGo')?.click(), 150); });
  pan.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { G.arPanel = false; G.tab = b.dataset.go; saveG(); render(); });
  void geo;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function stopAR() { if (document.documentElement.classList.contains('gar-on')) immersive(false); document.documentElement.classList.remove('gar-on'); if (arT) cancelAnimationFrame(arT); arT = null; if (camStop) { camStop(); camStop = null; } }
void makeView; void onOrientation; void unOri;
