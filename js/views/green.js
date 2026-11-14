// ③ 그린 위 거리 · ④ 그린 경사 지도 · ⑤ 퍼팅 라인/조준점/세기/백스윙
import { todayKey } from '../core/remote.js';
import { S, save, allowed, activeHole, activeCourse, currentMode, FEATURE_NAMES } from '../core/state.js';
import { distance, toLocal, toRad } from '../core/geo.js';
import { Sensors, sampleTilt, startSteps, onOrientation, vibrate, speak } from '../core/sensors.js';
import { muFromStimp, buildSurface, fitQuadFromGradients, optimizePutt, backswingCm, demoGreen, CUP_W } from '../physics/putt.js';
import { openCamera, GroundProjector, coverTransform } from '../core/camera.js';
import { drawGreen, makeView } from './greencanvas.js';
import { $, $$, esc, toast, sheet, lockedCard, confBadge, metronome, signed } from '../ui.js';

const STAND_BACK = 0.6; // 공 뒤에 서는 거리 (m)
let el_, App_, G, worker = null, reqId = 0, camStop = null, arT = null, unOri = null, metroOn = false;

function loadG() {
  try { const g = JSON.parse(sessionStorage.getItem('pinpoint.green') || 'null'); if (g) return g; } catch {}
  return { src: null, demoKind: 'tier', D: 0, distSrc: '', meas: {}, precise: false, gBall: null, gHole: null, stimp: S.settings.stimp, result: null, tab: 'measure', training: false, guess: null, revealed: false, holeN: null };
}
function saveG() { try { const { result, ...rest } = G; sessionStorage.setItem('pinpoint.green', JSON.stringify({ ...rest, result: null })); } catch {} }

export default {
  mount(el, App) {
    el_ = el; App_ = App; G = loadG();
    const hole = activeHole();
    // 골프장이 발행한 오늘 그린 스피드가 있으면 그 값으로 시작 (사용자가 바꾸면 그 값 유지)
    const tp = activeCourse()?.todayPins;
    if (tp?.stimp && tp.date === todayKey() && G.stimpSrc !== tp.date) { G.stimp = tp.stimp; G.stimpSrc = tp.date; G.result = null; }
    if (G.holeN !== (hole?.n ?? null)) { G.gBall = G.gHole = null; G.result = null; G.meas = {}; G.D = 0; G.holeN = hole?.n ?? null; }
    if (!G.src) G.src = hole?.greenGrid ? 'grid' : 'onsite';
    if (G.src === 'grid' && !hole?.greenGrid) G.src = 'demo';
    render();
  },
  unmount() { stopAR(); metronome(false); metroOn = false; saveG(); },
  onHole() { G.holeN = null; this.mount(el_, App_); },
};

function gridInfo() {
  const hole = activeHole();
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
  const D = G.D || 0;
  const pts = measurePoints(D).filter(p => p.m);
  const surf = fitQuadFromGradients(pts.map(p => ({ x: 0, y: p.y, gx: p.m.gx, gy: p.m.gy })));
  const half = Math.max(2.5, D * 0.4);
  return { spec: { kind: 'quad', coeffs: surf.coeffs }, ball: { x: 0, y: 0 }, hole: { x: 0, y: D }, inside: p => Math.abs(p.x) <= half && p.y >= -1.5 && p.y <= D + 2, D, kind: 'onsite', name: '현장 측정', nMeas: pts.length };
}
function measurePoints(D) {
  return [{ key: 'ball', label: '공 위치', y: 0 }, { key: 'mid', label: '중간 지점', y: D / 2 }, { key: 'hole', label: '홀 1m 앞', y: Math.max(0, D - 1) }].map(p => ({ ...p, m: G.meas[p.key] }));
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
  return { a: a / ms.length, b: b / ms.length };
}
function confidence(geo) {
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
  el_.innerHTML = `<h2>🟢 그린 리딩 · 퍼팅</h2>
    <div class="seg" id="srcSeg"><button data-v="onsite" class="${G.src === 'onsite' ? 'on' : ''}">현장 측정</button>${gridName ? `<button data-v="grid" class="${G.src === 'grid' ? 'on' : ''}">그린맵</button>` : ''}<button data-v="demo" class="${G.src === 'demo' ? 'on' : ''}">데모 그린</button></div>
    ${G.src === 'demo' ? `<div class="seg" id="demoSeg" style="margin-top:6px">${[['tier', '2단'], ['saddle', '말안장'], ['mound', '마운드']].map(([k, n]) => `<button data-v="${k}" class="${G.demoKind === k ? 'on' : ''}">${n}</button>`).join('')}</div><p class="sub">가상의 사전 측량 그린입니다 (실제 코스 아님). 그린맵 탭에서 공·홀 위치를 탭으로 바꿔 보세요.</p>` : ''}
    <div class="seg" id="tabSeg" style="margin-top:10px"><button data-v="measure" class="${G.tab === 'measure' ? 'on' : ''}">③ 측정</button><button data-v="map" class="${G.tab === 'map' ? 'on' : ''}">④ 그린맵</button><button data-v="ar" class="${G.tab === 'ar' ? 'on' : ''}">⑤ AR 라인</button></div>
    <div id="tabBody"></div><div id="result"></div>`;
  $$('#srcSeg button').forEach(b => b.onclick = () => { G.src = b.dataset.v; G.result = null; G.gBall = G.gHole = null; saveG(); render(); });
  $$('#demoSeg button').forEach(b => b.onclick = () => { G.demoKind = b.dataset.v; G.result = null; G.gBall = G.gHole = null; saveG(); render(); });
  $$('#tabSeg button').forEach(b => b.onclick = () => { G.tab = b.dataset.v; saveG(); render(); });
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
  body.innerHTML = `<div class="card"><div class="row"><b class="grow">③ 공 ↔ 홀컵 거리</b>${isGrid ? '<span class="pill">그린맵 좌표</span>' : G.distSrc ? `<span class="pill">${esc(G.distSrc)}</span>` : ''}</div>
      ${isGrid ? `<div class="big" style="margin-top:6px">${geo.D.toFixed(1)}<small>m</small></div><p class="sub">그린맵 탭에서 공·홀 위치를 바꿀 수 있습니다.</p>`
      : `<div class="row" style="margin-top:6px"><input type="number" id="dIn" inputmode="decimal" step="0.1" min="0.5" max="40" value="${G.D || ''}" placeholder="거리 (m)" style="max-width:140px;font-size:22px;font-weight:800"><span class="sub">m</span></div>
         <div class="grid3" style="margin-top:8px"><button class="btn small" id="dSteps">👣 걸음</button><button class="btn small" id="dCam">📷 카메라 탭</button><button class="btn small" id="dGps">📍 GPS·핀</button></div>
         <p class="sub">10m 이상은 걸음 측정, 5m 이내는 카메라 탭이 정확합니다. GPS는 오차 3~5m라 참고용.</p>`}</div>
    <div class="card"><b>그린 스피드 (스팀프)</b> <span class="sub">${G.stimp} ft · μ=${muFromStimp(G.stimp).toFixed(3)}</span>
      <input type="range" id="stimp" min="6" max="14" step="0.5" value="${G.stimp}"><div class="row sub"><span>느림 6</span><span class="grow"></span><span>보통 10</span><span class="grow"></span><span>빠름 14</span></div></div>
    ${canSlope ? `<div class="card"><div class="row"><b class="grow">경사 측정 ${isGrid ? '(선택: 현장 보정)' : ''}</b><label class="row sub"><input type="checkbox" id="precise" ${G.precise ? 'checked' : ''}> 정밀(180° 2회)</label></div>
      <p class="sub">휴대폰을 화면이 위로, <b>윗부분이 홀을 향하게</b> 그린 위에 내려놓고 [측정]을 누르세요. 2초간 움직이지 마세요.</p>
      ${measurePoints(G.D || geo.D).map(p => `<div class="kv"><span>${p.label}${!isGrid && G.D ? ` <span class="sub">(${p.y.toFixed(1)}m)</span>` : ''}</span><span>${p.m ? slopeText(p.m) : '<span class="sub">미측정</span>'} <button class="btn small" data-meas="${p.key}">${p.m ? '다시' : '측정'}</button></span></div>`).join('')}
      ${Object.values(G.meas).some(Boolean) ? '<button class="btn small ghost" id="clrMeas">측정값 지우기</button>' : ''}
    </div>` : lockedCard(FEATURE_NAMES.greenSlope)}
    <button class="btn primary block" id="calc" ${!isGrid && !(G.D > 0) ? 'disabled' : ''}>퍼팅 계산</button>`;
  $('#dIn')?.addEventListener('change', e => { G.D = Math.max(0, +e.target.value || 0); G.distSrc = '직접 입력'; G.result = null; saveG(); render(); });
  $('#stimp').oninput = e => { G.stimp = +e.target.value; e.target.previousElementSibling.textContent = `${G.stimp} ft · μ=${muFromStimp(G.stimp).toFixed(3)}`; };
  $('#stimp').onchange = () => { S.settings.stimp = G.stimp; save('settings'); G.result = null; saveG(); };
  $('#precise')?.addEventListener('change', e => { G.precise = e.target.checked; saveG(); });
  $$('[data-meas]').forEach(b => b.onclick = () => measureSlope(b.dataset.meas));
  $('#clrMeas')?.addEventListener('click', () => { G.meas = {}; G.result = null; saveG(); render(); });
  $('#dSteps')?.addEventListener('click', stepsSheet);
  $('#dCam')?.addEventListener('click', () => { G.tab = 'ar'; G.arMode = 'distance'; render(); });
  $('#dGps')?.addEventListener('click', () => {
    const h = activeHole(), pin = h?.pin; if (!pin || !Sensors.pos) return toast('기록된 핀 위치와 GPS가 필요합니다');
    G.D = +distance(Sensors.pos, pin).toFixed(1); G.distSrc = `GPS ±${Math.round(Sensors.pos.acc || 4)}m`; saveG(); render();
  });
  $('#calc').onclick = compute;
}
function slopeText(m) {
  const along = m.gy * 100, cross = m.gx * 100;
  return `<b>${along >= 0 ? '오르막' : '내리막'} ${Math.abs(along).toFixed(1)}%</b> · ${Math.abs(cross) < 0.15 ? '좌우 평평' : (cross > 0 ? '오른쪽이 높음' : '왼쪽이 높음') + ' ' + Math.abs(cross).toFixed(1) + '%'}${m.precise ? ' <span class="pill">정밀</span>' : ''}`;
}

// 기울기 센서 측정 (gx: 오른쪽 방향 경사, gy: 홀 방향 경사). 정밀 모드는 180° 회전 2회로 센서 바이어스 상쇄
async function measureSlope(key) {
  if (Sensors.beta == null) return toast('기울기 센서를 사용할 수 없습니다 (설정 → 센서 권한)');
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
    actions: [{ label: '취소', onClick: () => stop && stop() }, { label: '도착', kind: 'primary', onClick: () => { stop && stop(); if (!n) return; G.D = +(n * S.settings.stepLen).toFixed(1); G.distSrc = `걸음 ${n}`; G.result = null; saveG(); render(); } }],
  });
}

// ---------- 계산 ----------
function compute() {
  const geo = geometry();
  if (geo.D < 0.3) return toast('거리를 먼저 입력하세요');
  if (geo.kind === 'onsite' && !geo.nMeas && allowed('greenSlope')) toast('경사 측정이 없어 평지로 가정합니다');
  const res = $('#result'); res.innerHTML = '<div class="card"><div class="empty">물리 시뮬레이션 · 몬테카를로 계산 중…</div></div>';
  const msg = { id: ++reqId, spec: geo.spec, mu: muFromStimp(G.stimp), ball: geo.ball, hole: geo.hole, skill: { sigmaAimDeg: S.settings.aimSigma, sigmaSpeed: S.settings.speedSigma } };
  const done = r => { if (msg.id !== reqId) return; G.result = { ...r, conf: confidence(geo), D: geo.D, kind: geo.kind }; G.revealed = false; renderResult(allowed('puttLine')); if (G.tab === 'map') mapTab($('#tabBody')); announce(); };
  try {
    worker = worker || new Worker(new URL('../physics/putt.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { if (e.data.ok) done(e.data.r); else fallback(); };
    worker.onerror = () => { worker = null; fallback(); };
    worker.postMessage(msg);
  } catch { fallback(); }
  function fallback() { setTimeout(() => { const s = buildSurface(msg.spec); done(optimizePutt(s, msg.mu, msg.ball, msg.hole, msg.skill, { bounds: s.bounds })); }, 20); }
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
  speak(`${cupsText(r)}, 평지 ${r.flatEquiv.toFixed(1)}미터 세기, 백스윙 ${Math.round(bs)}센티`);
}

function renderResult(canLine) {
  const box = $('#result'); if (!box) return;
  const r = G.result; if (!r) { box.innerHTML = ''; return; }
  const dhTxt = Math.abs(r.dh) < 0.01 ? '평지' : `${r.dh > 0 ? '오르막' : '내리막'} ${Math.abs(r.dh * 100).toFixed(0)}cm`;
  const head = `<div class="card"><div class="row"><b class="grow">실제 ${r.D.toFixed(1)}m · ${dhTxt}</b>${confBadge(r.conf)}</div>
      <p class="sub" style="margin:4px 0 0">공 위치 경사: ${r.slopeAtBall.along >= 0 ? '오르막' : '내리막'} ${Math.abs(r.slopeAtBall.along).toFixed(1)}% · 옆경사 ${Math.abs(r.slopeAtBall.cross).toFixed(1)}% (${r.slopeAtBall.cross > 0 ? '왼쪽 높음 → 오른쪽으로 휨' : r.slopeAtBall.cross < 0 ? '오른쪽 높음 → 왼쪽으로 휨' : '휨 없음'})</p></div>`;
  if (!canLine) { box.innerHTML = head.replace(/<p class="sub"[\s\S]*?<\/p>/, '') + lockedCard(FEATURE_NAMES.puttLine); return; }
  if (r.conf < 0.4) {
    box.innerHTML = head + `<div class="card"><b>신뢰도가 낮아 라인 대신 경사 정보만 표시합니다</b><p class="sub">경사를 2곳 이상 측정하거나 정밀(180°) 모드를 쓰면 라인을 보여드립니다.</p></div>`; return;
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
    </div>
    ${alt ? `<details class="card tight"><summary class="sub">지나치는 거리별 비교 (몬테카를로 ${160}회)</summary><div class="tblwrap" style="margin-top:8px"><table class="score"><tr><th>지나침</th><th>성공</th><th>2퍼트↓</th><th>조준(컵)</th></tr>${alt}</table></div></details>` : ''}
    <p class="sub">백스윙 크기는 ${S.calib.samples?.length ? '내 캘리브레이션' : '기본값'} 기준입니다. <a href="#/calib">연습 그린 캘리브레이션</a>(3m·6m·9m)을 하면 정확해집니다. 오차 가정: 조준 ±${S.settings.aimSigma}° · 세기 ±${Math.round(S.settings.speedSigma * 100)}%.</p>`;
  $('#metro').onclick = () => { metroOn = !metroOn; metronome(metroOn, S.settings.tempoBpm); renderResult(true); };
  $('#spk').onclick = () => { const was = S.settings.voice; speak(`${cupsText(r)}, 평지 ${r.flatEquiv.toFixed(1)}미터 세기, 백스윙 ${Math.round(bs)}센티`, true); void was; };
  $('#train')?.addEventListener('change', e => { G.training = e.target.checked; G.revealed = false; saveG(); renderResult(true); });
}

// ---------- ④ 그린맵 ----------
let tapMode = null;
function mapTab(body) {
  const geo = geometry();
  if (geo.D < 0.3 && geo.kind === 'onsite') { body.innerHTML = '<div class="card">측정 탭에서 거리를 먼저 입력하세요.</div>'; return; }
  body.innerHTML = `<div class="card tight" style="padding:6px"><canvas class="view" id="gcv" width="900" height="1100"></canvas></div>
    ${geo.kind === 'grid' ? `<div class="grid2"><button class="btn ${tapMode === 'ball' ? 'on' : ''}" id="tBall">⚪ 공 위치 탭</button><button class="btn ${tapMode === 'hole' ? 'on' : ''}" id="tHole">⛳ 홀 위치 탭</button></div>` : ''}
    <p class="sub">${esc(geo.name)} · 색 = 경사 크기, 흰 선 = 등고선(${'1~5'}cm), 화살표 = 물이 흐르는(공이 휘는) 방향. ${geo.kind === 'onsite' ? '현장 측정 범위(라인 주변)만 표시합니다.' : ''}</p>
    ${!G.result ? '<button class="btn primary block" id="calc2">퍼팅 계산</button>' : ''}`;
  const cv = $('#gcv');
  const surf = buildSurface(geo.spec);
  const showLine = !(currentMode() === 'practice' && G.training && !G.revealed) && allowed('puttLine') && G.result && G.result.conf >= 0.4;
  const V = drawGreen(cv, surf, { ball: geo.ball, hole: geo.hole, result: showLine ? G.result : null, inside: geo.inside, stimpNote: `스팀프 ${G.stimp}ft · ${geo.D.toFixed(1)}m` });
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

// ---------- ⑤ AR 라인 (단안 지면 투영, 1탭 보정) ----------
function arTab(body, canLine) {
  const geo = geometry();
  const distMode = G.arMode === 'distance' && geo.kind === 'onsite';
  body.innerHTML = `<div class="cam" id="cam"><video autoplay playsinline muted></video><canvas id="arcv"></canvas>
      <div class="hud top" id="arHud"><b>${distMode ? '카메라로 거리 재기' : 'AR 퍼팅 라인'}</b><div class="sub" id="arMsg"></div></div>
      <div class="hud bottom"><div class="row"><button class="btn small" id="arCal">${distMode ? '취소' : '🎯 홀컵 탭으로 보정'}</button><span class="sub grow" id="arInfo"></span></div></div></div>
    <p class="sub">공 뒤 ${STAND_BACK}m에 서서 휴대폰을 눈높이(${S.settings.eyeHeight}m, 설정에서 변경)로 들고 홀 쪽을 비추세요. LiDAR 없이 카메라 높이·기울기로 지면을 투영하는 근사 AR이며, 화면의 홀컵을 한 번 탭하면 각도가 보정됩니다.</p>`;
  const video = $('#cam video'), cv = $('#arcv'), msg = $('#arMsg'), info = $('#arInfo');
  const proj = new GroundProjector({ height: S.settings.eyeHeight, vfovDeg: S.settings.cameraVFov });
  let cal = null; // { pitch, beta }
  if (!distMode && !G.result) msg.textContent = '먼저 측정 탭에서 퍼팅 계산을 하세요. 지금은 거리·조준선만 표시합니다.';
  else msg.textContent = distMode ? '화면에서 홀컵을 탭하세요 (휴대폰 기울기로 거리 계산)' : '화면에서 홀컵을 탭해 보정하세요';
  if (!canLine && !distMode) msg.textContent = '토너먼트 모드: 퍼팅 라인 표시가 차단됩니다';
  $('#arCal').onclick = () => { if (distMode) { G.arMode = null; G.tab = 'measure'; render(); } else { cal = null; msg.textContent = '화면에서 홀컵을 탭하세요'; } };
  openCamera(video).then(stop => { camStop = stop; loop(); }).catch(e => { msg.textContent = '카메라를 열 수 없습니다: ' + e.message + ' (HTTPS·권한 확인)'; });
  cv.onclick = e => {
    const r = cv.getBoundingClientRect(), T = coverTransform(video, cv);
    const u = (e.clientX - r.left - T.ox) / T.s, v = (e.clientY - r.top - T.oy) / T.s;
    const beta = Sensors.beta;
    if (distMode) {
      proj.pitchDeg = beta != null ? 90 - beta : 25; proj.yawDeg = 0;
      const g = proj.toGround(u, v, video.videoWidth, video.videoHeight);
      if (!g) return toast('수평선 아래(지면)를 탭하세요');
      G.D = +Math.max(0.3, g.dist - STAND_BACK).toFixed(1); G.distSrc = '카메라'; G.arMode = null; G.tab = 'measure'; G.result = null; saveG(); vibrate(50); toast(`거리 ${G.D}m`); render(); return;
    }
    const D = geometry().D; if (!(D > 0)) return toast('거리를 먼저 입력하세요');
    proj.calibrateFromTap(u, v, D + STAND_BACK, video.videoWidth, video.videoHeight);
    cal = { pitch: proj.pitchDeg, beta };
    vibrate(40); msg.textContent = '보정 완료 · 휴대폰을 기울여도 라인이 따라갑니다';
  };
  function loop() {
    if (!camStop) return;
    cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio;
    const ctx = cv.getContext('2d'), k = devicePixelRatio, T = coverTransform(video, cv);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!distMode && cal) {
      proj.pitchDeg = cal.pitch + (cal.beta != null && Sensors.beta != null ? cal.beta - Sensors.beta : 0);
      const g = geometry(), D = g.D || 1;
      const ux = (g.hole.x - g.ball.x) / D, uy = (g.hole.y - g.ball.y) / D;
      const toLine = (p) => { const dx = p.x - g.ball.x, dy = p.y - g.ball.y; return { x: dx * uy - dy * ux, y: dx * ux + dy * uy + STAND_BACK }; };
      const S2 = q => { const im = proj.toImage(q.x, q.y, video.videoWidth, video.videoHeight); return im ? [(T.ox + im.u * T.s) * k, (T.oy + im.v * T.s) * k] : null; };
      // 홀 링
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * k; ctx.beginPath();
      for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2; const p = S2({ x: Math.cos(a) * 0.054, y: D + STAND_BACK + Math.sin(a) * 0.054 }); if (p) i ? ctx.lineTo(...p) : ctx.moveTo(...p); }
      ctx.stroke();
      const r = G.result, showLine = r && canLine && r.conf >= 0.4 && !(currentMode() === 'practice' && G.training && !G.revealed);
      if (showLine) {
        ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 6 * k; ctx.setLineDash([3 * k, 10 * k]); ctx.lineCap = 'round'; ctx.beginPath();
        let first = true; for (const [x, y] of r.path) { const p = S2(toLine({ x, y })); if (!p) continue; first ? ctx.moveTo(...p) : ctx.lineTo(...p); first = false; }
        ctx.stroke(); ctx.setLineDash([]);
        const ap = S2(toLine(r.aimPoint)); if (ap) { ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 3 * k; ctx.beginPath(); ctx.arc(ap[0], ap[1], 12 * k, 0, 7); ctx.stroke(); ctx.fillStyle = '#ffe27a'; ctx.font = `bold ${15 * k}px sans-serif`; ctx.fillText('조준점', ap[0] + 16 * k, ap[1]); }
        info.textContent = `${cupsText(r)} · 평지 ${r.flatEquiv.toFixed(1)}m · 백스윙 ${Math.round(backswingCm(r.flatEquiv, S.calib))}cm`;
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2 * k; ctx.setLineDash([8 * k, 8 * k]); ctx.beginPath();
        const a = S2({ x: 0, y: STAND_BACK }), b = S2({ x: 0, y: D + STAND_BACK }); if (a && b) { ctx.moveTo(...a); ctx.lineTo(...b); } ctx.stroke(); ctx.setLineDash([]);
        info.textContent = `${D.toFixed(1)}m`;
      }
    }
    arT = requestAnimationFrame(loop);
  }
}
function stopAR() { if (arT) cancelAnimationFrame(arT); arT = null; if (camStop) { camStop(); camStop = null; } }
void makeView; void onOrientation; void unOri;
