// 센서 퓨전: GNSS(칼만 필터), 나침반, 기울기, 걸음, 스윙 감지, 진동, 음성
import { toLocal, fromLocal } from './geo.js';
import { say, configureVoice } from './voice.js';
import { pointingHeading, AngleFilter, wrap180 } from './heading.js';

const posSubs = new Set(), oriSubs = new Set();
let watchId = null, kf = null, simPos = null, simOn = false;

export const Sensors = {
  pos: null,            // { lat, lon, acc, raw, ts }
  heading: null,        // 나침반 방위 (0=북)
  point: null,          // 휴대폰 윗부분이 가리키는 방위 (자세 보정 + 떨림 필터, 정밀 화살표용)
  pointJitter: null,    // 최근 1초 원시 방위 흔들림(°): 크면 '잠깐 멈춰 주세요'
  beta: null, gamma: null,
  orientationOn: false,
  get sim() { return simOn; },
};

// ---------- GNSS + 칼만 필터 (정지/보행 모델) ----------
function kalman(fix) {
  const now = fix.ts;
  if (!kf || now - kf.ts > 30000) {
    kf = { o: { lat: fix.lat, lon: fix.lon }, x: 0, y: 0, P: fix.acc * fix.acc, ts: now };
  } else {
    const z = toLocal(kf.o, fix), dt = Math.max(0.05, (now - kf.ts) / 1000);
    const q = 1.2 * dt; // 보행 속도 수준의 이동을 허용하는 과정 잡음
    const P = kf.P + q, Rm = fix.acc * fix.acc, K = P / (P + Rm);
    kf.x += K * (z.x - kf.x); kf.y += K * (z.y - kf.y); kf.P = (1 - K) * P; kf.ts = now;
    // 큰 점프(카트 이동 등) 시 재수렴
    if (Math.hypot(z.x - kf.x, z.y - kf.y) > 40) { kf.x = z.x; kf.y = z.y; kf.P = Rm; }
  }
  const p = fromLocal(kf.o, { x: kf.x, y: kf.y });
  return { ...p, acc: Math.sqrt(kf.P), raw: fix, ts: now };
}
function pushPos(p) { Sensors.pos = p; posSubs.forEach(f => f(p)); }

// 위치 상태 (화면 안내용): waiting 찾는 중 · ok · weak 신호 약함(오차 80m 넘음) · denied 허락 안 됨 · unsupported
//  gpsSince: 찾기 시작한 시각 (30초 넘게 못 찾으면 '지도에서 내 위치 누르기' 안내)
export function startGPS() {
  if (simOn) return;
  if (!('geolocation' in navigator)) { Sensors.gpsState = 'unsupported'; return; }
  if (watchId != null) return;
  if (Sensors.gpsState !== 'ok') { Sensors.gpsState = 'waiting'; Sensors.gpsSince = Date.now(); }
  watchId = navigator.geolocation.watchPosition(
    g => {
      const fix = { lat: g.coords.latitude, lon: g.coords.longitude, acc: g.coords.accuracy || 10, alt: g.coords.altitude, ts: Date.now() };
      if (fix.acc > 80) { Sensors.gpsWeakAcc = Math.round(fix.acc); if (!Sensors.pos) Sensors.gpsState = 'weak'; posSubs.forEach(f => f(Sensors.pos, null)); return; }
      Sensors.gpsState = 'ok'; Sensors.gpsWeakAcc = null;
      pushPos(kalman(fix));
    },
    err => {
      console.warn('GPS', err.code, err.message);
      if (err.code === 1) { Sensors.gpsState = 'denied'; stopGPS(); } // 허락이 안 되면 감시를 멈춰야 나중에 다시 시작할 수 있음
      else if (!Sensors.pos) Sensors.gpsState = 'weak';
      posSubs.forEach(f => f(null, err));
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
}
// 다시 시도 (설정에서 허락한 뒤 앱으로 돌아왔을 때 · [다시 찾기] 버튼)
export function restartGPS() { stopGPS(); Sensors.gpsState = 'waiting'; Sensors.gpsSince = Date.now(); startGPS(); }
export function stopGPS() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }
export function onPos(fn) { posSubs.add(fn); if (Sensors.pos) fn(Sensors.pos); return () => posSubs.delete(fn); }

export function setSim(on) {
  simOn = on;
  if (on) { stopGPS(); if (simPos) pushPos(simPos); }
  else { simPos = null; kf = null; startGPS(); }
}
export function setSimPos(lat, lon) { if (!Number.isFinite(lat) || !Number.isFinite(lon)) return; simPos = { lat, lon, acc: 1, ts: Date.now(), sim: true }; if (simOn) pushPos(simPos); } // 잘못된 좌표는 무시 (지도가 NaN으로 멈추지 않게)

// "공 옆에 서서 기록": 여러 측위값을 정확도 가중 평균
export function sampleFix(ms = 4000) {
  return new Promise(resolve => {
    if (simOn && simPos) return resolve({ ...simPos, n: 1 });
    const fixes = [];
    const un = onPos(p => { if (p) fixes.push(p); });
    setTimeout(() => {
      un();
      if (!fixes.length) return resolve(Sensors.pos ? { ...Sensors.pos, n: 1 } : null);
      let W = 0, la = 0, lo = 0;
      for (const f of fixes) { const w = 1 / (f.acc * f.acc); W += w; la += w * f.lat; lo += w * f.lon; }
      // GNSS 오차는 시간적으로 상관되어 있어 평균해도 1/√n 만큼 줄지 않음 → 보수적으로 추정
      const minAcc = Math.min(...fixes.map(f => f.acc));
      resolve({ lat: la / W, lon: lo / W, acc: Math.max(Math.sqrt(1 / W), minAcc * 0.7), n: fixes.length, ts: Date.now() });
    }, ms);
  });
}

// ---------- 방향 센서 ----------
export async function requestMotionPermission() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') return false;
    }
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission(); if (r !== 'granted') return false;
    }
    return true;
  } catch { return false; }
}
const pointFilter = new AngleFilter({ minCutoff: 0.8, beta: 0.03 }), recent = [];
function onOri(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
  // AR 회전행렬용 절대 alpha (Rz·Rx·Ry, 북 기준). iOS·Android 모두 '360 − 나침반 방위'와 같음
  Sensors.alphaAbs = h != null ? (360 - h) % 360 : null;
  Sensors.compassAcc = typeof e.webkitCompassAccuracy === 'number' ? e.webkitCompassAccuracy : null;
  if (h != null) {
    const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    Sensors.heading = (h + so + 360) % 360;
  }
  if (e.beta != null) { Sensors.beta = e.beta; Sensors.gamma = e.gamma; }
  // 가리키는 방위: 회전행렬(윗변/카메라) → One-Euro 필터. 행렬을 못 만들면 나침반 방위로
  const ph = pointingHeading(Sensors.alphaAbs, e.beta, e.gamma), raw = ph ? ph.deg : Sensors.heading;
  if (raw != null) {
    const t = performance.now();
    Sensors.point = pointFilter.update(raw, t);
    // 손떨림 = 부드러운 방향(필터 값)에서 벗어난 정도의 RMS (일부러 천천히 돌리는 건 떨림이 아님)
    recent.push([t, wrap180(raw - Sensors.point)]); while (recent.length && t - recent[0][0] > 1000) recent.shift();
    Sensors.pointJitter = Math.sqrt(recent.reduce((a, r) => a + r[1] * r[1], 0) / recent.length);
    Sensors.pointSpeed = pointFilter.speed;
  }
  oriSubs.forEach(f => f(Sensors));
}
export function startOrientation() {
  if (Sensors.orientationOn) return;
  Sensors.orientationOn = true;
  // Android Chrome: deviceorientationabsolute(자북 기준) / iOS Safari: webkitCompassHeading
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOri);
  else window.addEventListener('deviceorientation', onOri);
}
export function onOrientation(fn) { oriSubs.add(fn); return () => oriSubs.delete(fn); }

// 기울기 평균 측정 (지면 접촉 모드). 안정성(표준편차) 함께 반환
export function sampleTilt(ms = 2000) {
  return new Promise(resolve => {
    const b = [], g = [];
    const un = onOrientation(s => { if (s.beta != null) { b.push(s.beta); g.push(s.gamma); } });
    setTimeout(() => {
      un();
      if (b.length < 3) return resolve(null);
      const m = a => a.reduce((x, y) => x + y, 0) / a.length;
      const sd = (a, mu) => Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / a.length);
      const mb = m(b), mg = m(g);
      resolve({ beta: mb, gamma: mg, sdBeta: sd(b, mb), sdGamma: sd(g, mg), n: b.length });
    }, ms);
  });
}

// ---------- 걸음 측정 / 스윙 감지 (가속도) ----------
let motionHandler = null;
const motionSubs = new Set();
function ensureMotion() {
  if (motionHandler) return;
  motionHandler = e => motionSubs.forEach(f => f(e));
  window.addEventListener('devicemotion', motionHandler);
}
export function startSteps(cb) {
  ensureMotion();
  let lp = 9.81, last = 0, count = 0, above = false;
  const f = e => {
    const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
    const m = Math.hypot(a.x, a.y, a.z);
    lp = lp * 0.9 + m * 0.1;
    const now = performance.now();
    if (!above && m > lp + 1.3 && now - last > 320) { above = true; last = now; count++; cb(count); }
    else if (above && m < lp) above = false;
  };
  motionSubs.add(f);
  return () => motionSubs.delete(f);
}
export function startSwingDetect(cb) {
  ensureMotion();
  let last = 0;
  const f = e => {
    const a = e.acceleration, r = e.rotationRate;
    const am = a && a.x != null ? Math.hypot(a.x, a.y, a.z) : 0;
    const rm = r && r.alpha != null ? Math.hypot(r.alpha, r.beta, r.gamma) : 0;
    const now = Date.now();
    if ((am > 28 || rm > 700) && now - last > 8000) { last = now; cb({ ts: now, accel: am, rot: rm }); }
  };
  motionSubs.add(f);
  return () => motionSubs.delete(f);
}

// ---------- 출력 ----------
export function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }
let voiceOn = false;
export function setVoice(on) { voiceOn = on; }
configureVoice({ on: () => voiceOn });
export function speak(text, force = false) { return say(text, { force }); } // 🎧 core/voice.js: 앱은 휴대폰 TTS → 이어폰
let wakeLock = null;
export async function keepAwake(on = true) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
