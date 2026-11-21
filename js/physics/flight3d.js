// 🎬 공 비행을 실제 땅 위 3D로: 탄도 모델(공 속도·발사각·스핀·바람·공기 밀도) → 위도·경도·높이·시간 점들
//  카메라 화면(arview.js)이 이 점들을 지형 높이 위에 그려서 '공 날려 보기'를 재생
import { clubType, simulateFlight, speedForCarry, RHO_STD } from './flight.js';
import { destination } from '../core/geo.js';

// from: 친 곳 · aim: 조준 방위(°) · club: 클럽 id · stdCarry: 표준 조건 캐리(m, 내 클럽 거리 × 힘%)
// wind: { windSpeed, windFrom } (m/s · 불어오는 방위) · rho: 공기 밀도 · hand: 'R'|'L'
export function flightPath({ from, aim, club = '7i', stdCarry, wind = null, rho = RHO_STD, step = 3 }) {
  const ct = clubType(club) || clubType('7i');
  const carry0 = Math.max(5, stdCarry || 100);
  const speed = speedForCarry(ct, carry0);
  // 바람: 샷 방향 기준 (x 오른쪽, y 앞쪽) — 불어오는 방위 + 180 = 바람이 가는 방향
  let w = { x: 0, y: 0 };
  if (wind?.windSpeed) { const to = (wind.windFrom + 180 - aim) * Math.PI / 180; w = { x: wind.windSpeed * Math.sin(to), y: wind.windSpeed * Math.cos(to) }; }
  const f = simulateFlight({ speed, launchDeg: ct.launch, spinRpm: ct.spin, wind: w, rho, dt: 0.01, record: true });
  const at = (x, y) => (Math.abs(x) < 0.01 ? destination(from, aim, y) : destination(destination(from, aim, y), aim + 90, x));
  const pts = [];
  for (let i = 0; i < f.path.length; i += step) { const [x, y, z] = f.path[i]; pts.push({ ...at(x, y), h: z, t: i * 0.01 }); }
  const land = at(f.x, f.y);
  pts.push({ ...land, h: 0, t: f.time });
  // 굴러감: 착지 방향으로 (클럽별 비율 · 1초 안팎)
  const rollM = f.carry * (ct.roll ?? 0.03), dir = Math.atan2(f.x, f.y) * 180 / Math.PI + aim;
  const rest = destination(land, dir, rollM), rollT = Math.min(2.5, 0.4 + rollM / 6);
  const roll = [];
  for (let k = 1; k <= 8; k++) { const s = k / 8, e = 1 - (1 - s) ** 2; roll.push({ ...destination(land, dir, rollM * e), h: 0, t: f.time + rollT * s }); }
  return { pts, roll, landing: land, rest, carry: f.carry, total: f.carry + rollM, apex: f.apex, time: f.time, totalTime: f.time + rollT, lateral: f.x, speed, landAngle: f.landAngle };
}

// 재생 위치: t초에 공이 있는 곳 (점 사이 직선 보간)
export function flightAt(path, t) {
  const all = [...path.pts, ...path.roll];
  if (t <= 0) return { ...all[0], i: 0 };
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1], b = all[i];
    if (t <= b.t) { const u = (t - a.t) / Math.max(1e-6, b.t - a.t); return { lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u, h: a.h + (b.h - a.h) * u, t, i }; }
  }
  return { ...all.at(-1), i: all.length - 1 };
}
