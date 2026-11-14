// ⑥ 3자유도 탄도 모델 (항력·양력·스핀 + 바람 로그 프로파일 + 공기밀도)
// 좌표: x = 오른쪽, y = 타깃 방향, z = 위  (m, m/s)
export const BALL_M = 0.04593, BALL_R = 0.021335, BALL_A = Math.PI * BALL_R * BALL_R;

// 클럽 기본 발사 조건 (아마추어 평균 기준), roll = 런 비율
export const CLUB_TYPES = [
  { id: 'D', name: '드라이버', loft: 10.5, launch: 13, spin: 3100, roll: 0.10, sdLat: 5.5, sdDist: 0.08 },
  { id: '3W', name: '3번 우드', loft: 15, launch: 11.5, spin: 3800, roll: 0.07, sdLat: 5.0, sdDist: 0.08 },
  { id: '5W', name: '5번 우드', loft: 18, launch: 12.5, spin: 4400, roll: 0.06, sdLat: 4.8, sdDist: 0.075 },
  { id: '4H', name: '4번 하이브리드', loft: 22, launch: 13, spin: 4600, roll: 0.05, sdLat: 4.5, sdDist: 0.07 },
  { id: '5i', name: '5번 아이언', loft: 27, launch: 13.5, spin: 5200, roll: 0.04, sdLat: 4.3, sdDist: 0.07 },
  { id: '6i', name: '6번 아이언', loft: 30, launch: 15, spin: 5900, roll: 0.035, sdLat: 4.0, sdDist: 0.065 },
  { id: '7i', name: '7번 아이언', loft: 34, launch: 17, spin: 6700, roll: 0.03, sdLat: 3.8, sdDist: 0.065 },
  { id: '8i', name: '8번 아이언', loft: 38, launch: 19, spin: 7400, roll: 0.025, sdLat: 3.6, sdDist: 0.06 },
  { id: '9i', name: '9번 아이언', loft: 42, launch: 21.5, spin: 8100, roll: 0.02, sdLat: 3.4, sdDist: 0.06 },
  { id: 'PW', name: '피칭 웨지', loft: 46, launch: 24, spin: 8800, roll: 0.015, sdLat: 3.2, sdDist: 0.06 },
  { id: 'GW', name: '갭 웨지 50°', loft: 50, launch: 27, spin: 9200, roll: 0.01, sdLat: 3.0, sdDist: 0.065 },
  { id: 'SW', name: '샌드 웨지 56°', loft: 56, launch: 31, spin: 9600, roll: 0.008, sdLat: 3.0, sdDist: 0.07 },
  { id: 'LW', name: '로브 웨지 60°', loft: 60, launch: 34, spin: 9800, roll: 0.005, sdLat: 3.0, sdDist: 0.08 },
];
export const clubType = id => CLUB_TYPES.find(c => c.id === id);

export function airDensity(tempC = 20, pressureHpa = 1013.25, rh = 50) {
  const T = tempC + 273.15;
  const es = 6.1078 * Math.pow(10, 7.5 * tempC / (tempC + 237.3)); // hPa
  const pv = rh / 100 * es, pd = pressureHpa - pv;
  return (pd * 100) / (287.058 * T) + (pv * 100) / (461.495 * T);
}
export const RHO_STD = airDensity(20, 1013.25, 50);

// 계수는 PGA 투어 평균(드라이버 252m/정점 32m, 7번 157m/31m)에 맞춰 보정
function coeffs(S) {
  const s = Math.max(S, 1e-3);
  return { Cl: Math.min(0.4, 0.54 * Math.sqrt(s)), Cd: 0.2 + 0.3 * s };
}

// wind: {x, y} m/s (10m 높이 기준, 공이 "향하는" 방향 성분)
export function simulateFlight({ speed, launchDeg, spinRpm, azimuthDeg = 0, axisTiltDeg = 0, wind = { x: 0, y: 0 }, rho = RHO_STD, dt = 0.01, record = false }) {
  const la = launchDeg * Math.PI / 180, az = azimuthDeg * Math.PI / 180;
  let vx = speed * Math.cos(la) * Math.sin(az), vy = speed * Math.cos(la) * Math.cos(az), vz = speed * Math.sin(la);
  let x = 0, y = 0, z = 0, t = 0, apex = 0;
  let w = spinRpm * 2 * Math.PI / 60;
  // 스핀 축: 백스핀은 진행방향 기준 오른쪽(+) 수평축, 축 기울기로 휘어짐
  const tilt = axisTiltDeg * Math.PI / 180;
  const kq = 0.5 * rho * BALL_A / BALL_M;
  const z0 = 0.03, lnRef = Math.log(10 / z0);
  const path = record ? [[0, 0, 0]] : null;
  while (t < 15) {
    const wf = Math.max(0, Math.log(Math.max(z, 0.3) / z0) / lnRef);
    const rx = vx - wind.x * wf, ry = vy - wind.y * wf, rz = vz;
    const vr = Math.hypot(rx, ry, rz) || 1e-6;
    const { Cl, Cd } = coeffs(BALL_R * w / vr);
    // 스핀 축 단위벡터: 수평 진행방향의 오른쪽 벡터를 진행축 둘레로 tilt 만큼 회전
    const hx = rx, hy = ry, hn = Math.hypot(hx, hy) || 1e-6;
    let ox = hy / hn, oy = -hx / hn, oz = 0; // 오른쪽
    if (tilt) { const c = Math.cos(tilt), s = Math.sin(tilt); ox *= c; oy *= c; oz = s; }
    // 양력 방향 = ω̂ × v̂
    let lx = oy * rz - oz * ry, ly = oz * rx - ox * rz, lz = ox * ry - oy * rx;
    const ln = Math.hypot(lx, ly, lz) || 1e-6; lx /= ln; ly /= ln; lz /= ln;
    const ax = kq * vr * vr * (-Cd * rx / vr + Cl * lx);
    const ay = kq * vr * vr * (-Cd * ry / vr + Cl * ly);
    const az2 = kq * vr * vr * (-Cd * rz / vr + Cl * lz) - 9.81;
    vx += ax * dt; vy += ay * dt; vz += az2 * dt;
    const nz = z + vz * dt;
    if (nz < 0 && t > 0.1) {
      const f = z / (z - nz);
      x += vx * dt * f; y += vy * dt * f; z = 0; t += dt * f;
      break;
    }
    x += vx * dt; y += vy * dt; z = nz; t += dt;
    w *= Math.exp(-dt / 25); // 스핀 감쇠
    if (z > apex) apex = z;
    if (record) path.push([x, y, z]);
  }
  const landAngle = Math.atan2(-vz, Math.hypot(vx, vy)) * 180 / Math.PI;
  return { carry: Math.hypot(x, y), x, y, apex, time: t, landAngle, landSpeed: Math.hypot(vx, vy, vz), path };
}

// 표준 조건에서 주어진 캐리를 내는 볼스피드 (이분법)
const speedCache = new Map();
export function speedForCarry(club, carry) {
  const ct = typeof club === 'string' ? clubType(club) : club;
  const key = ct.id + ':' + Math.round(carry);
  if (speedCache.has(key)) return speedCache.get(key);
  let lo = 10, hi = 95;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (simulateFlight({ speed: mid, launchDeg: ct.launch, spinRpm: ct.spin, dt: 0.02 }).carry < carry) lo = mid; else hi = mid;
  }
  const v = (lo + hi) / 2; speedCache.set(key, v); return v;
}

// 바람·공기밀도 조건에서의 캐리 변화와 좌우 밀림 (표준 캐리 대비)
// windFromDeg: 바람이 불어오는 방위, shotBearing: 샷 방위
export function conditionsEffect(club, stdCarry, { windSpeed = 0, windFromDeg = 0, shotBearing = 0, rho = RHO_STD } = {}) {
  const ct = typeof club === 'string' ? clubType(club) : club;
  const v = speedForCarry(ct, stdCarry);
  const toDir = (windFromDeg + 180 - shotBearing) * Math.PI / 180; // 바람이 향하는 방향 (샷 기준)
  const wind = { x: windSpeed * Math.sin(toDir), y: windSpeed * Math.cos(toDir) };
  const r = simulateFlight({ speed: v, launchDeg: ct.launch, spinRpm: ct.spin, wind, rho, dt: 0.02 });
  return { carry: r.y, lateral: r.x, ratio: r.y / stdCarry, apex: r.apex, landAngle: r.landAngle };
}
