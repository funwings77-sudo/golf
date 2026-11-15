// AR 투영: 휴대폰 방향(alpha·beta·gamma) + GPS → 실제 지점(깃발·떨어질 곳·공)의 화면 좌표
//  W3C DeviceOrientation: 기기→지구(ENU: x=동, y=북, z=위) 회전 R = Rz(α)·Rx(β)·Ry(γ)
//  후면 카메라 광축 = 기기 −Z, 화면 오른쪽 = +X, 화면 위 = +Y
import { toLocal } from './geo.js';

const rad = d => d * Math.PI / 180;
export function rotationMatrix(alpha, beta, gamma) {
  const a = rad(alpha), b = rad(beta), g = rad(gamma);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  // Rz(a)·Rx(b)·Ry(g)
  return [
    [ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg],
    [sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg],
    [-cb * sg, sb, cb * cg],
  ];
}

// 세로 화각(°)과 화면 높이 → 초점거리(px)
export const focalPx = (vfovDeg, h) => (h / 2) / Math.tan(rad(vfovDeg) / 2);

// enu: {x 동, y 북, z 위}(m) → 화면 {x, y, depth, visible}
//  screenAngle: 화면 회전(0 세로, 90 가로-왼쪽, -90/270 가로-오른쪽)
export function project(R, enu, { f, cx, cy, screenAngle = 0 }) {
  // d = Rᵀ · enu (기기 좌표)
  let dx = R[0][0] * enu.x + R[1][0] * enu.y + R[2][0] * enu.z;
  let dy = R[0][1] * enu.x + R[1][1] * enu.y + R[2][1] * enu.z;
  const dz = R[0][2] * enu.x + R[1][2] * enu.y + R[2][2] * enu.z;
  if (screenAngle) { const t = -rad(screenAngle), c = Math.cos(t), s = Math.sin(t); [dx, dy] = [dx * c - dy * s, dx * s + dy * c]; }
  const depth = -dz;
  if (depth <= 0.3) return { x: NaN, y: NaN, depth, visible: false };
  return { x: cx + f * dx / depth, y: cy - f * dy / depth, depth, visible: true };
}

// 내 위치 기준 지점의 ENU (눈높이 eye, 고저차 dz=대상 고도−내 지면 고도)
export function enuOf(me, p, { eye = 1.5, dz = 0 } = {}) { const q = toLocal(me, p); return { x: q.x, y: q.y, z: dz - eye }; }

// 카메라 광축의 방위·하향각 (지평선·조준 보조 표시용)
export function cameraAxis(R) {
  const fx = -R[0][2], fy = -R[1][2], fz = -R[2][2];
  return { bearing: (Math.atan2(fx, fy) * 180 / Math.PI + 360) % 360, pitch: Math.asin(Math.max(-1, Math.min(1, fz))) * 180 / Math.PI };
}

// 1탭 방위 보정: 화면의 x 위치에 실제로 보이는 대상(깃발)을 맞추도록 alpha 오프셋(°) 계산
export function yawCorrection(R, enuTarget, tapX, { f, cx }) {
  const p = project(R, enuTarget, { f, cx, cy: 0 });
  if (!p.visible) return null;
  // 화면 x 오차 → 각도 오차 (작은 각 근사 대신 atan 사용). 대상이 오른쪽에 보이는데 탭은 왼쪽이면 alpha를 키워 시야를 오른쪽으로…
  return (Math.atan((p.x - cx) / f) - Math.atan((tapX - cx) / f)) * 180 / Math.PI;
}

// 화면 점(x,y) → 그 방향의 ENU 단위벡터 (project의 역)
export function unproject(R, x, y, { f, cx, cy, screenAngle = 0 }) {
  let dx = (x - cx) / f, dy = -(y - cy) / f;
  if (screenAngle) { const t = rad(screenAngle), c = Math.cos(t), s = Math.sin(t); [dx, dy] = [dx * c - dy * s, dx * s + dy * c]; }
  const dz = -1;
  const v = { x: R[0][0] * dx + R[0][1] * dy + R[0][2] * dz, y: R[1][0] * dx + R[1][1] * dy + R[1][2] * dz, z: R[2][0] * dx + R[2][1] * dy + R[2][2] * dz };
  const n = Math.hypot(v.x, v.y, v.z); return { x: v.x / n, y: v.y / n, z: v.z / n };
}
// 조준 광선과 지면의 교차 (눈높이 eye, 지면 경사 slope = 거리 1m당 높이 변화)
//  반환: 수평거리 h(m), 방위, 내려다보는 각, 예상 오차(기울기 센서 ±0.5°, 눈높이 ±10%)
export function groundHit(v, { eye = 1.45, slope = 0, tiltErrDeg = 0.5 } = {}) {
  const vh = Math.hypot(v.x, v.y), den = v.z - slope * vh;
  const brg = (Math.atan2(v.x, v.y) * 180 / Math.PI + 360) % 360, elev = Math.atan2(v.z, vh) * 180 / Math.PI;
  if (den >= -1e-4) return { h: Infinity, bearing: brg, elev, err: Infinity };
  const t = -eye / den, h = t * vh;
  const dep = Math.atan2(-den, vh), dH = eye / Math.sin(dep) ** 2 * rad(tiltErrDeg);
  return { h, bearing: brg, elev, err: Math.hypot(dH, 0.1 * h) };
}

// 각도 흔들림 완화 (원형 평균)
export function smoothAngle(prev, next, k = 0.25) {
  if (prev == null) return next;
  let d = ((next - prev + 540) % 360) - 180;
  return (prev + d * k + 360) % 360;
}
