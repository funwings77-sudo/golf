// ⑥ 티샷 전략 최적화: 후보 조준점 × 클럽 × 스윙크기 × 분산 몬테카를로 → 기대 타수 최소화
import { rng, polylineDist, vecBearing, bearingVec, weightedStats, ellipsePoints, normAngle } from '../core/geo.js';
import { conditionsEffect, clubType } from './flight.js';

// 투어 기준 기대 타수(Broadie 계열 기준표를 m로 환산·단순화) → 핸디캡 배율 적용
const T_FAIRWAY = [[0, 1.0], [5, 2.1], [10, 2.18], [20, 2.4], [30, 2.52], [50, 2.65], [75, 2.75], [100, 2.85], [125, 2.95], [150, 3.05], [175, 3.17], [200, 3.3], [250, 3.65], [300, 3.95], [400, 4.25], [500, 4.75], [600, 5.1]];
const T_PUTT = [[0, 1.0], [0.5, 1.01], [1, 1.04], [2, 1.35], [3, 1.55], [5, 1.78], [7, 1.89], [10, 1.98], [15, 2.1], [20, 2.2], [30, 2.4]];
const LIE_ADD = { tee: -0.05, fairway: 0, rough: 0.17, bunker: 0.33, trees: 0.6, green: 0 };
function interp(T, d) {
  if (d <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (d <= T[i][0]) { const [x0, y0] = T[i - 1], [x1, y1] = T[i]; return y0 + (y1 - y0) * (d - x0) / (x1 - x0); }
  return T[T.length - 1][1];
}
export function expectedStrokes(dist, lie = 'fairway', hcp = 18) {
  const amateur = 1 + Math.max(0, hcp) * 0.0115; // 핸디캡이 높을수록 각 샷 효율이 떨어짐
  if (lie === 'green') return 1 + (interp(T_PUTT, dist) - 1) * (1 + Math.max(0, hcp) * 0.008);
  const base = interp(T_FAIRWAY, dist) + (LIE_ADD[lie] ?? 0.2);
  return 1 + (base - 1) * amateur;
}

// hole(로컬 m, 티 원점): { tee:{x,y}, pin:{x,y}, green:{x,y,r}, center:[pts], halfWidth, hazards:[{type,x,y,r}] }
export function classify(p, hole) {
  for (const hz of hole.hazards || []) {
    if (Math.hypot(p.x - hz.x, p.y - hz.y) <= hz.r) return { lie: hz.type, hazard: hz };
  }
  const g = hole.green;
  if (g && Math.hypot(p.x - g.x, p.y - g.y) <= (g.r || 14)) return { lie: 'green' };
  const dc = polylineDist(p, hole.center);
  const hw = hole.halfWidth || 16;
  if (dc <= hw) return { lie: 'fairway' };
  if (dc <= hw * 3) return { lie: 'rough' };
  return { lie: 'trees' };
}

function outcomeE(p, hole, hcp, teeE) {
  const c = classify(p, hole), d = Math.hypot(hole.pin.x - p.x, hole.pin.y - p.y);
  switch (c.lie) {
    case 'ob': return { e: 1 + teeE, lie: 'ob' }; // 1벌타 + 티에서 다시 (스트로크와 거리)
    case 'water': {
      // 들어간 지점 근처(해저드 경계에서 티 쪽으로 2m) 드롭 + 1벌타
      const hz = c.hazard;
      const tx = -hz.x, ty = -hz.y, tl = Math.hypot(tx, ty) || 1; // 티 방향
      const dx = hz.x + (tx / tl) * (hz.r + 2), dy = hz.y + (ty / tl) * (hz.r + 2);
      const dd = Math.hypot(hole.pin.x - dx, hole.pin.y - dy);
      return { e: 1 + expectedStrokes(dd, 'rough', hcp), lie: 'water' };
    }
    default: return { e: expectedStrokes(d, c.lie, hcp), lie: c.lie };
  }
}

export function optimizeTeeShot({ hole, bag, hcp = 18, weather = {}, n = 220, aimRange = 20, aimStep = 2, swings = [1.0, 0.85], seed = 11 }) {
  const R = rng(seed);
  const center1 = hole.center[1] || hole.pin;
  const baseBrg = vecBearing(center1.x - hole.tee.x, center1.y - hole.tee.y);
  const holeLen = Math.hypot(hole.pin.x - hole.tee.x, hole.pin.y - hole.tee.y);
  const teeE = expectedStrokes(holeLen, 'tee', hcp);
  const clubs = bag.filter(c => c.enabled !== false && c.carry > 0 && c.carry * (1 + (clubType(c.id)?.roll || 0.03)) <= holeLen + 25 && c.carry >= Math.min(holeLen * 0.45, 140));
  const results = [];
  for (const club of clubs) {
    const ct = clubType(club.id) || { roll: 0.03 };
    const fx = conditionsEffect(club.id, club.carry, { windSpeed: weather.windSpeed || 0, windFromDeg: weather.windFrom || 0, shotBearing: baseBrg, rho: weather.rho });
    for (const sw of swings) {
      const carry = fx.carry * (sw === 1 ? 1 : 0.9), sdD = (club.sdDist ?? ct.sdDist ?? 0.07) * (sw === 1 ? 1 : 0.85);
      const sdLat = (club.sdLat ?? ct.sdLat ?? 4.5) * (sw === 1 ? 1 : 0.85) * (1 + (hcp - 18) * 0.015);
      const drift = fx.lateral * (sw === 1 ? 1 : 0.85);
      for (let a = -aimRange; a <= aimRange + 1e-9; a += aimStep) {
        const brg = baseBrg + a;
        let sum = 0, ob = 0, haz = 0, fw = 0; const pts = [];
        for (let i = 0; i < n; i++) {
          const b = brg + R.gauss() * sdLat;
          const c = carry * (1 + R.gauss() * sdD);
          const u = bearingVec(b), r = { x: u.y, y: -u.x }; // r: 오른쪽 단위벡터
          let p = { x: hole.tee.x + u.x * c + r.x * drift, y: hole.tee.y + u.y * c + r.y * drift };
          const land = classify(p, hole).lie;
          const rollF = land === 'fairway' ? 1 : land === 'rough' ? 0.35 : land === 'green' ? 0.6 : 0.1;
          const roll = c * (ct.roll || 0.03) * rollF * (0.6 + 0.8 * R());
          p = { x: p.x + u.x * roll, y: p.y + u.y * roll };
          const o = outcomeE(p, hole, hcp, teeE);
          sum += o.e;
          if (o.lie === 'ob') ob++; else if (o.lie === 'water' || o.lie === 'bunker' || o.lie === 'trees') haz++;
          if (o.lie === 'fairway' || o.lie === 'green') fw++;
          if (pts.length < 150) pts.push(p);
        }
        results.push({ club: club.id, clubName: club.name || ct.name, swing: sw, aim: a, bearing: (brg + 360) % 360, es: 1 + sum / n, pOB: ob / n, pHaz: haz / n, pFw: fw / n, carry, drift, pts });
      }
    }
  }
  results.sort((a, b) => a.es - b.es);
  const best = results[0];
  if (!best) return null;
  const st = weightedStats(best.pts);
  const perClub = [];
  for (const r of results) if (!perClub.find(p => p.club === r.club && p.swing === r.swing)) perClub.push(r);
  return { best: { ...best, stats: st, ellipse: ellipsePoints(st, 2) }, perClub: perClub.slice(0, 6), baseBearing: baseBrg, holeLen };
}

// 조준점을 지형 랜드마크 기준 문장으로
export function describeAim(best, hole) {
  const side = best.aim > 0.5 ? '오른쪽' : best.aim < -0.5 ? '왼쪽' : '';
  const u = bearingVec(best.bearing), d = best.carry;
  const ap = { x: hole.tee.x + u.x * d, y: hole.tee.y + u.y * d };
  let land = '';
  let near = null;
  for (const hz of hole.hazards || []) {
    const gap = Math.hypot(ap.x - hz.x, ap.y - hz.y) - hz.r;
    if (gap < 30 && (!near || gap < near.gap)) near = { hz, gap };
  }
  if (near) {
    const rel = normAngle(vecBearing(near.hz.x - hole.tee.x, near.hz.y - hole.tee.y) - best.bearing);
    const hside = rel < 0 ? '왼쪽' : '오른쪽';
    const name = { ob: 'OB', water: '페널티 구역(물)', bunker: '벙커', trees: '숲' }[near.hz.type] || '해저드';
    land = `${hside} ${name} ${rel < 0 ? '우측' : '좌측'} 끝에서 ${Math.max(0, near.gap).toFixed(0)}m ${rel < 0 ? '오른쪽' : '왼쪽'}`;
  }
  return { text: side ? `중앙선보다 ${side} ${Math.abs(best.aim).toFixed(0)}°` : '중앙선 정조준', landmark: land, aimPoint: ap };
}
