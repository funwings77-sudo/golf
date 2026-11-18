// 친 공 분석: GPS로 잰 거리·방향(측정) → 3자유도 탄도 모델을 거꾸로 풀어 공 속도·높이·비행 시간 등(추정)
//  휴대폰은 공 속도·발사각·스핀을 직접 잴 수 없음(론치 모니터 필요). 그래서
//   · 측정: 총거리(친 곳 → 공 찾은 곳), 좌우 방향(°, m), GPS 오차
//   · 추정: 클럽 평균 발사각·스핀을 쓰고, 바람·공기밀도까지 넣어 '이 거리를 내려면 필요한' 공 속도를 이분법으로 찾음
//           → 그 비행을 다시 계산해 최고 높이·비행 시간·캐리·런·착지 각도·착지 속도
//   · 오차: 거리 오차(GPS) + 발사각 ±3°·스핀 ±15%(아마추어 샷마다 차이)를 넣어 다시 풀어 범위로 표시
import { clubType, simulateFlight, RHO_STD } from './flight.js';

const KMH = 3.6, MPH = 2.23694;
// 클럽별 스매시 팩터(공 속도 ÷ 헤드 속도) 평균 — 헤드 속도 추정용
const SMASH = { D: 1.46, '3W': 1.44, '5W': 1.42, '4H': 1.39, '5i': 1.36, '6i': 1.35, '7i': 1.33, '8i': 1.31, '9i': 1.29, PW: 1.25, GW: 1.22, SW: 1.18, LW: 1.15 };

// 바람(앞뒤 along: +뒷바람, 옆 cross: +왼쪽→오른쪽) m/s
function flightFor(ct, speed, { launchDeg = ct.launch, spinRpm = ct.spin, wind = { x: 0, y: 0 }, rho = RHO_STD, record = false } = {}) {
  const r = simulateFlight({ speed, launchDeg, spinRpm, wind, rho, dt: 0.01, record });
  return { ...r, total: r.y * (1 + ct.roll) };
}
// 총거리 total을 내는 공 속도 (이분법)
function solveSpeed(ct, total, opt) {
  let lo = 5, hi = 95;
  if (flightFor(ct, hi, opt).total < total) return hi;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (flightFor(ct, mid, opt).total < total) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// 한 샷 분석
//  clubId, total(측정 총거리 m), err(거리 오차 m), latDeg(측정 좌우 각, +오른쪽), wind {along, cross} m/s, rho
export function analyzeShot({ clubId, total, err = 5, latDeg = null, wind = null, rho = RHO_STD }) {
  const ct = clubType(clubId) || clubType('7i');
  const w = wind ? { x: wind.cross || 0, y: wind.along || 0 } : { x: 0, y: 0 };
  const base = { wind: w, rho };
  const speed = solveSpeed(ct, total, base);
  const f = flightFor(ct, speed, { ...base, record: true });
  // 오차 범위: 거리 ±err, 발사각 ±3°, 스핀 ±15% 조합 중 최소·최대 속도
  const sp = [];
  for (const d of [-err, err]) for (const dl of [-3, 0, 3]) for (const ds of [0.85, 1, 1.15]) {
    const T = Math.max(3, total + d);
    sp.push(solveSpeed(ct, T, { ...base, launchDeg: ct.launch + dl, spinRpm: ct.spin * ds }));
  }
  const apexes = [-3, 3].map(dl => flightFor(ct, speed, { ...base, launchDeg: ct.launch + dl }).apex);
  const head = speed / (SMASH[ct.id] || 1.3);
  const lateralM = latDeg == null ? null : total * Math.sin(latDeg * Math.PI / 180);
  return {
    club: ct.id, clubName: ct.name,
    src: { total: 'gps', latDeg: latDeg == null ? null : 'gps' }, // 나머지는 모두 'calc'
    measured: { total, err, latDeg, lateralM },
    est: {
      ballSpeed: speed, ballSpeedRange: [Math.min(...sp), Math.max(...sp)],
      headSpeed: head, smash: SMASH[ct.id] || 1.3,
      launchDeg: ct.launch, launchRange: [ct.launch - 3, ct.launch + 3], spinRpm: ct.spin,
      carry: f.y, roll: f.total - f.y, apex: f.apex, apexRange: [Math.min(...apexes), Math.max(...apexes)],
      time: f.time, landAngle: f.landAngle, landSpeed: f.landSpeed,
    },
    // 옆에서 본 비행 곡선 (앞으로 m, 높이 m) — 그리기용, 저장하지 않음
    path: f.path ? f.path.filter((_, i) => i % 4 === 0).map(([, y, z]) => [y, z]).concat([[f.y, 0]]) : [],
  };
}

// 저장용 요약 (localStorage 크기를 줄이려 소수 정리, path 제외)
export function shotSummary(a) {
  const r1 = v => (v == null ? null : Math.round(v * 10) / 10), r0 = v => (v == null ? null : Math.round(v));
  const e = a.est;
  return {
    measured: { total: r1(a.measured.total), err: r1(a.measured.err), latDeg: r1(a.measured.latDeg), lateralM: r1(a.measured.lateralM) },
    est: { ballSpeed: r1(e.ballSpeed), ballSpeedRange: e.ballSpeedRange.map(r1), headSpeed: r1(e.headSpeed), launchDeg: r1(e.launchDeg), spinRpm: r0(e.spinRpm), carry: r1(e.carry), roll: r1(e.roll), apex: r1(e.apex), apexRange: e.apexRange.map(r1), time: Math.round(e.time * 100) / 100, landAngle: r1(e.landAngle), landSpeed: r1(e.landSpeed) },
  };
}

// 클럽별 통계: 샷 수 · 평균/최장 거리 · 평균 공 속도 · 높이 · 방향 퍼짐(좌우 표준편차)
export function clubStats(shots) {
  const by = new Map();
  for (const s of shots) { if (!s.club || !s.total) continue; if (!by.has(s.club)) by.set(s.club, []); by.get(s.club).push(s); }
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const sd = (a, m) => (a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) : null);
  return [...by.entries()].map(([club, list]) => {
    const tot = list.map(s => s.total), full = list.filter(s => !s.partial), ftot = full.map(s => s.total);
    const sp = list.map(s => s.lm?.ballSpeed ?? s.fit?.est?.ballSpeed).filter(Number.isFinite), ap = list.map(s => s.lm?.apex ?? s.fit?.est?.apex).filter(Number.isFinite);
    const la = list.map(s => s.lm?.launchDeg).filter(Number.isFinite), spin = list.map(s => s.lm?.spinRpm).filter(Number.isFinite);
    const lat = list.map(s => s.latDeg).filter(Number.isFinite), mLat = mean(lat), mT = mean(ftot.length ? ftot : tot);
    return {
      club, name: clubType(club)?.name || club, n: list.length, nFull: full.length,
      avgTotal: mT, sdTotal: sd(ftot.length ? ftot : tot, mT), longest: Math.max(...tot),
      avgCarry: mean(list.map(s => s.lm?.carry ?? s.fit?.est?.carry ?? s.carry).filter(Number.isFinite)),
      nLM: list.filter(s => s.lm?.ballSpeed > 0).length, avgLaunchLM: mean(la), avgSpinLM: mean(spin),
      avgSpeed: mean(sp), maxSpeed: sp.length ? Math.max(...sp) : null, avgApex: mean(ap),
      avgLat: mLat, sdLat: sd(lat, mLat ?? 0), launchDeg: clubType(club)?.launch ?? null,
      shots: [...list].sort((a, b) => b.ts - a.ts),
    };
  }).sort((a, b) => (b.avgTotal || 0) - (a.avgTotal || 0));
}

export const kmh = v => v * KMH, mph = v => v * MPH;
// 바람(불어오는 방위 windFrom, 세기) → 샷 방향 기준 앞뒤(+뒷바람)·옆(+오른쪽으로 미는) 성분
export function windAlongCross(windSpeed, windFromDeg, shotBearingDeg) {
  if (!windSpeed) return { along: 0, cross: 0 };
  const to = (windFromDeg + 180 - shotBearingDeg) * Math.PI / 180;
  return { along: windSpeed * Math.cos(to), cross: windSpeed * Math.sin(to) };
}

// ---------- 📟 론치 모니터 수치 ----------
// 저장 단위: 속도 m/s, 거리 m, 각도 °, 스핀 rpm. 입력 단위 변환
export const SPEED_UNITS = { kmh: { label: 'km/h', k: 1 / 3.6 }, mph: { label: 'mph', k: 1 / 2.23694 }, ms: { label: 'm/s', k: 1 } };
export const DIST_UNITS = { m: { label: 'm', k: 1 }, yd: { label: 'yd', k: 0.9144 } };
export const toMS = (v, u) => v * (SPEED_UNITS[u]?.k ?? 1), fromMS = (v, u) => v / (SPEED_UNITS[u]?.k ?? 1);
export const toM = (v, u) => v * (DIST_UNITS[u]?.k ?? 1), fromM = (v, u) => v / (DIST_UNITS[u]?.k ?? 1);
// 입력 확인: 범위를 벗어나면 고칠 곳을 알려 줌
export const LM_LIMITS = { ballSpeed: [8, 95], headSpeed: [8, 70], launchDeg: [-10, 60], spinRpm: [0, 14000], carry: [1, 400], total: [1, 450], sideDeg: [-45, 45], offlineM: [-120, 120], apex: [0, 80] };
export function lmErrors(lm) {
  const out = [];
  if (!(lm.ballSpeed > 0)) out.push('ballSpeed');
  for (const [k, [a, b]] of Object.entries(LM_LIMITS)) if (lm[k] != null && (!Number.isFinite(lm[k]) || lm[k] < a || lm[k] > b)) out.push(k);
  return [...new Set(out)];
}

// 론치 모니터 값으로 분석: 잰 공 속도·발사각·스핀으로 비행을 계산하고, 잰 값(캐리·총거리·높이·방향)은 그대로 씀
//  gpsTotal/gpsErr/gpsLat: 같은 샷을 GPS로도 쟀다면 함께 (총거리·방향은 GPS가 없을 때만 모니터 값 사용)
export function analyzeLM({ clubId, lm, wind = null, rho = RHO_STD, gpsTotal = null, gpsErr = null, gpsLat = null }) {
  const ct = clubType(clubId) || clubType('7i');
  const launchDeg = lm.launchDeg ?? ct.launch, spinRpm = lm.spinRpm ?? ct.spin;
  const w = wind ? { x: wind.cross || 0, y: wind.along || 0 } : { x: 0, y: 0 };
  const f = flightFor(ct, lm.ballSpeed, { launchDeg, spinRpm, wind: w, rho, record: true });
  const carry = lm.carry ?? f.y;
  const total = gpsTotal ?? lm.total ?? carry + (f.total - f.y);
  const latDeg = gpsLat ?? lm.sideDeg ?? (lm.offlineM != null && total > 0 ? Math.asin(Math.max(-1, Math.min(1, lm.offlineM / total))) * 180 / Math.PI : null);
  const lateralM = lm.offlineM != null && gpsLat == null ? lm.offlineM : latDeg == null ? null : total * Math.sin(latDeg * Math.PI / 180);
  const head = lm.headSpeed ?? lm.ballSpeed / (SMASH[ct.id] || 1.3);
  const src = {
    ballSpeed: 'lm', launchDeg: lm.launchDeg != null ? 'lm' : 'calc', spinRpm: lm.spinRpm != null ? 'lm' : 'calc', headSpeed: lm.headSpeed != null ? 'lm' : 'calc',
    carry: lm.carry != null ? 'lm' : 'calc', apex: lm.apex != null ? 'lm' : 'calc',
    total: gpsTotal != null ? 'gps' : lm.total != null ? 'lm' : 'calc', latDeg: gpsLat != null ? 'gps' : lm.sideDeg != null || lm.offlineM != null ? 'lm' : null,
  };
  const k = carry / Math.max(1, f.y); // 잰 캐리에 맞춰 곡선 길이만 맞춤 (모양은 물리식)
  return {
    club: ct.id, clubName: ct.name, src, lm: true,
    measured: { total, err: gpsTotal != null ? gpsErr : 0, latDeg, lateralM },
    est: {
      ballSpeed: lm.ballSpeed, ballSpeedRange: [lm.ballSpeed, lm.ballSpeed], headSpeed: head, smash: lm.headSpeed ? lm.ballSpeed / lm.headSpeed : SMASH[ct.id] || 1.3,
      launchDeg, launchRange: [launchDeg, launchDeg], spinRpm, carry, roll: Math.max(0, total - carry),
      apex: lm.apex ?? f.apex, apexRange: [lm.apex ?? f.apex, lm.apex ?? f.apex], time: f.time, landAngle: f.landAngle, landSpeed: f.landSpeed,
      modelCarry: f.y, // 물리식이 계산한 캐리 (잰 캐리와 비교용)
    },
    path: f.path ? f.path.filter((_, i) => i % 4 === 0).map(([, y, z]) => [y * k, z]).concat([[carry, 0]]) : [],
  };
}
// 저장된 샷 하나 분석 (모니터 값이 있으면 그것 우선)
export function analyzeStored(s) {
  return s.lm?.ballSpeed > 0
    ? analyzeLM({ clubId: s.club, lm: s.lm, wind: s.wind, rho: s.rho, gpsTotal: s.source === 'lm' ? null : s.total, gpsErr: s.err, gpsLat: s.source === 'lm' ? null : s.latDeg })
    : analyzeShot({ clubId: s.club, total: s.total, err: s.err ?? 5, latDeg: s.latDeg, wind: s.wind, rho: s.rho });
}
