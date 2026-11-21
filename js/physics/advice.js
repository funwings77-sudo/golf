// 지금 공 위치에서의 샷 추천 (쉬운 플레이 화면용): 클럽 · 힘(%) · 방향(각도) · 떨어질 곳
//  풀샷: 몬테카를로 기대 타수 최적화(strategy.js) / 짧은 거리: 웨지 힘 조절 / 그린 위: 퍼터
//  + 친 공 위치 예측 (lostball.js 파티클 추정)
import { distance, bearing, normAngle, destination, toLocal, fromLocal } from '../core/geo.js';
import { optimizeTeeShot } from './strategy.js';
import { clubType } from './flight.js';
import { estimateLanding } from './lostball.js';

const COMPASS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
export const compassName = b => COMPASS[Math.round(((b % 360) + 360) % 360 / 45) % 8];
export const greenR = h => (h.front && h.back ? Math.max(8, distance(h.front, h.back) / 2 + 2) : 14);

// 출발점 원점 로컬 홀 (map.js localHole과 같은 규칙, DOM 의존 없음)
export function localFrom(hole, start) {
  const L = p => (p ? toLocal(start, p) : null);
  const pin = L(hole.pin || hole.green), green = L(hole.green || hole.pin);
  const center = [{ x: 0, y: 0 }];
  if (hole.ip && distance(start, hole.green) > distance(hole.ip, hole.green) + 20) center.push(L(hole.ip));
  center.push(green);
  return { tee: { x: 0, y: 0 }, pin, green: { ...green, r: greenR(hole) }, center, halfWidth: hole.halfWidth || 16, hazards: (hole.hazards || []).map(z => ({ ...L(z), r: z.r, type: z.type })) };
}

// 힘(%) → 초등학생도 아는 말
export function swingWords(power) {
  if (power >= 95) return { short: '끝까지 크게', clock: '풀스윙' };
  if (power >= 82) return { short: '조금만 작게', clock: '11시까지' };
  if (power >= 68) return { short: '어깨 높이까지', clock: '10시까지' };
  if (power >= 50) return { short: '허리 높이까지', clock: '9시까지' };
  if (power >= 35) return { short: '무릎 높이까지', clock: '8시까지' };
  return { short: '살짝 톡', clock: '7시까지' };
}
export function dirWords(rel) {
  const a = Math.abs(rel);
  if (a < 0.75) return '깃발 쪽으로 똑바로';
  return `깃발보다 ${rel > 0 ? '오른쪽' : '왼쪽'}으로 ${a.toFixed(1)}°`;
}

export function adviseShot({ me, hole, bag, hcp = 18, weather = {}, n = 160 }) {
  const pin = hole.pin || hole.green;
  if (!me || !pin) return null;
  const D = distance(me, pin), pinBrg = bearing(me, pin);
  const base = { D, pinBrg, pin };
  if (D < 1.2) return { ...base, kind: 'holed' };
  const onGreen = hole.green && distance(me, hole.green) <= greenR(hole) + 1;
  if (onGreen || D < 25) return { ...base, kind: 'putt', club: 'PT', clubName: '퍼터', power: null, aimBearing: pinBrg, rel: 0, carry: D, landing: pin, text: onGreen ? '그린 위예요. 퍼터로 굴려요' : '그린 근처예요. 퍼터나 웨지로 굴려요' };
  const clubs = bag.filter(c => c.enabled !== false && c.carry > 0).sort((a, b) => a.carry - b.carry);
  if (!clubs.length) return { ...base, kind: 'noclub' };
  const shortest = clubs[0];
  // 가장 짧은 클럽의 풀샷보다 가까우면: 그 클럽으로 힘 조절, 깃발을 바로 봄
  if (D <= shortest.carry * 1.03) {
    const power = Math.max(25, Math.min(100, Math.round(D / shortest.carry * 100)));
    return { ...base, kind: 'partial', club: shortest.id, clubName: shortest.name, power, swing: swingWords(power), aimBearing: pinBrg, rel: 0, lateral: 0, carry: D, landing: { lat: pin.lat, lon: pin.lon }, pBad: 0 };
  }
  const lh = localFrom(hole, me);
  const res = optimizeTeeShot({ hole: lh, bag: clubs, hcp, weather, n, aimRange: 16, aimStep: 1 });
  if (!res) {
    // 후보가 없으면 남은 거리에 가장 가까운 클럽
    const c = clubs.reduce((b, x) => (Math.abs(x.carry - D) < Math.abs(b.carry - D) ? x : b));
    const power = Math.min(100, Math.round(Math.min(1, D / c.carry) * 100));
    return { ...base, kind: 'full', club: c.id, clubName: c.name, power, swing: swingWords(power), aimBearing: pinBrg, rel: 0, lateral: 0, carry: Math.min(D, c.carry), landing: destination(me, pinBrg, Math.min(D, c.carry)), pBad: null };
  }
  const b = res.best, club = clubs.find(c => c.id === b.club);
  let power = b.swing === 1 ? 100 : Math.round(b.swing * 100);
  let carry = b.carry;
  // 긴 클럽으로 넘길 위험이 있으면 힘을 줄여 깃발 앞에 떨어뜨림
  const roll = clubType(b.club)?.roll ?? 0.03;
  if (carry * (1 + roll) > D + 8) { const want = D / (1 + roll); power = Math.max(30, Math.round(power * want / carry)); carry = want; }
  const rel = normAngle(b.bearing - pinBrg);
  return {
    ...base, kind: 'full', club: b.club, clubName: club?.name || b.clubName, power, swing: swingWords(power),
    aimBearing: b.bearing, rel, lateral: carry * Math.sin(rel * Math.PI / 180), carry,
    landing: destination(me, b.bearing, carry), pBad: b.pOB + b.pHaz, es: b.es,
    ellipse: (b.ellipse || []).map(q => fromLocal(me, q)),
    alternatives: res.perClub.filter(x => x.club !== b.club).slice(0, 2).map(x => ({ club: x.club, clubName: x.clubName, es: x.es })),
  };
}

// 친 공이 떨어졌을 곳 예측: 출발점·조준 방위·클럽 → 확률 구역 중심·반경
export function predictBall({ start, aimBearing, club, hole = null, power = 100, sigmaBearing = 7 }) {
  const ct = clubType(club.id) || {};
  const est = estimateLanding({
    start: { x: 0, y: 0 }, bearing: aimBearing, sigmaBearing,
    club: { carry: club.carry * power / 100, sdDist: club.sdDist ?? ct.sdDist ?? 0.08, roll: ct.roll ?? 0.06 },
    hazards: hole ? (hole.hazards || []).map(z => ({ ...toLocal(start, z), r: z.r, type: z.type })) : [], n: 1500,
  });
  return { center: fromLocal(start, est.center), r80: est.r80, confidence: est.confidence, est };
}

// 지금 위치에서 공까지: 거리 · 방위 · 내 방향(나침반) 기준 화살표 각도
export function toBall(me, ball, heading = null) {
  const d = distance(me, ball), b = bearing(me, ball);
  return { d, bearing: b, compass: compassName(b), rel: heading == null ? null : normAngle(b - heading) };
}

// 🔁 추천 클럽 흔들림 막기 (내비의 '이탈 판정 지연·재탐색 이유 표시'와 같은 생각)
//  GPS가 1~2m 튀거나 두 클럽이 거의 같을 때 7번 ↔ 6번이 오락가락하지 않게:
//   · 조금만 움직였고(6m 미만) 바람·핀이 그대로이고, 이전 클럽의 기대 타수가 새 최선과 거의 같으면(0.06타 미만) 이전 추천 유지
//   · 진짜로 바뀌면 이유를 한 줄로 (몇 m 옮겨서 · 바람이 바뀌어서 · 핀이 바뀌어서)
export function keepClub(prev, next, { moved = 0, windDelta = 0, pinMoved = false } = {}) {
  if (!prev || !next || !prev.club || !next.club || prev.club === next.club) return { adv: next, reason: null, kept: false };
  const big = moved >= 6 || windDelta >= 1.5 || pinMoved || prev.kind !== next.kind;
  if (!big && next.kind === 'full' && next.es != null) {
    const alt = (next.alternatives || []).find(a => a.club === prev.club);
    if (alt && alt.es - next.es < 0.06) return { adv: prev, reason: null, kept: true };
  }
  const why = pinMoved ? '핀 위치가 바뀌어서' : windDelta >= 1.5 ? '바람이 바뀌어서' : moved >= 6 ? `${Math.round(moved)}m 옮겨서` : '남은 거리가 바뀌어서';
  return { adv: next, reason: { from: prev.clubName, to: next.clubName, why }, kept: false };
}
