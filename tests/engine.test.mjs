// 엔진 단위 테스트: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Geo from '../js/core/geo.js';
import * as P from '../js/physics/putt.js';
import * as F from '../js/physics/flight.js';
import { optimizeTeeShot, expectedStrokes, classify } from '../js/physics/strategy.js';
import { estimateLanding, addMark, markSearched, guidance, massWithin } from '../js/physics/lostball.js';
import { settle, minTransfers, gapAnalysis, learnClub, newRound } from '../js/core/score.js';
import { playsLike, estimateWBGT, wbgtLevel } from '../js/core/weather.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);

test('geo: 거리·방위·로컬 좌표 왕복', () => {
  const a = { lat: 37.5, lon: 127 }, b = Geo.destination(a, 45, 150);
  near(Geo.distance(a, b), 150, 0.01);
  near(Geo.bearing(a, b), 45, 0.01);
  const q = Geo.toLocal(a, b), back = Geo.fromLocal(a, q);
  near(Geo.distance(back, b), 0, 0.05);
  near(Math.hypot(q.x, q.y), 150, 0.3);
});

test('퍼팅: 스팀프 정의 재현 (v0=1.83m/s → 스팀프 거리)', () => {
  for (const s of [8, 10, 12]) {
    const mu = P.muFromStimp(s);
    const r = P.simulate(P.planeSurface(0, 0), mu, { x: 0, y: 0 }, 1.83, Math.PI / 2, { record: false });
    near(r.stop.y, s * 0.3048, 0.01, `stimp ${s}`);
  }
});

test('퍼팅: 평지는 직선·평지 환산=실제+지나침', () => {
  const mu = P.muFromStimp(10);
  const r = P.optimizePutt(P.planeSurface(0, 0), mu, { x: 0, y: 0 }, { x: 0, y: 5 });
  near(r.theta, 0, 1e-3);
  assert.ok(r.flatEquiv > 5 && r.flatEquiv < 5.8, 'flat ' + r.flatEquiv);
  assert.ok(r.holed, '계산된 라인은 홀인');
});

test('퍼팅: 오른쪽 내리막 → 왼쪽 조준, 오르막 → 더 세게', () => {
  const mu = P.muFromStimp(10);
  const side = P.optimizePutt(P.planeSurface(-0.02, 0), mu, { x: 0, y: 0 }, { x: 0, y: 4 });
  assert.ok(side.aimCups > 1, '왼쪽 조준 ' + side.aimCups);
  assert.ok(side.holed);
  const flat = P.optimizePutt(P.planeSurface(0, 0), mu, { x: 0, y: 0 }, { x: 0, y: 4 });
  const up = P.optimizePutt(P.planeSurface(0, 0.02), mu, { x: 0, y: 0 }, { x: 0, y: 4 });
  const down = P.optimizePutt(P.planeSurface(0, -0.02), mu, { x: 0, y: 0 }, { x: 0, y: 4 });
  assert.ok(up.flatEquiv > flat.flatEquiv && flat.flatEquiv > down.flatEquiv);
  near(up.dh, 0.08, 1e-6, '고저차');
});

test('퍼팅: 2단 그린 격자에서도 해를 찾음', () => {
  const g = P.gridSurface(P.demoGreen('tier'));
  const r = P.optimizePutt(g, P.muFromStimp(10), { x: -4, y: 2 }, { x: 3, y: 20 }, {}, { bounds: g.bounds });
  assert.ok(r.solved && r.holed, 'solved');
});

test('퍼팅: 경사 측정점 → 2차 곡면 적합 복원', () => {
  const truth = P.quadSurface({ a: 0.01, b: 0.015, d: 0.001, e: 0.0008 });
  const ms = [0, 2, 4, 6].flatMap(y => [-1, 1].map(x => { const [gx, gy] = truth.grad(x, y); return { x, y, gx, gy }; }));
  const fit = P.fitQuadFromGradients(ms, 1e-6);
  const [gx, gy] = fit.grad(0.5, 3), [tx, ty] = truth.grad(0.5, 3);
  near(gx, tx, 1e-4); near(gy, ty, 1e-4);
});

test('퍼팅: 현장 측정 융합이 사전맵 오차를 보정', () => {
  const base = P.planeSurface(0.01, 0), meas = [{ x: 0, y: 0, gx: 0.02, gy: 0.005 }];
  const fused = P.fuseMeasurements(base, meas);
  const g = fused.grad(0, 0); near(g[0], 0.02, 1e-9); near(g[1], 0.005, 1e-9);
});

test('백스윙 캘리브레이션: √거리 = a·cm + b', () => {
  const c = P.fitCalibration([{ cm: 12, dist: 3 }, { cm: 20, dist: 6 }, { cm: 26, dist: 9 }]);
  near(P.backswingCm(6, c), 20, 1.5);
  near(P.backswingCm(7.2), 24, 0.2, '기본값');
});

test('탄도: PGA 투어 평균 재현 (드라이버 ~252m, 7번 ~157m)', () => {
  const d = F.simulateFlight({ speed: 74.6, launchDeg: 10.9, spinRpm: 2686 });
  near(d.carry, 252, 8); near(d.apex, 32, 4);
  const i7 = F.simulateFlight({ speed: 53.6, launchDeg: 16.3, spinRpm: 7097 });
  near(i7.carry, 157, 10);
});

test('탄도: 맞바람은 짧게, 오른쪽에서 부는 바람은 왼쪽으로', () => {
  const head = F.conditionsEffect('7i', 130, { windSpeed: 5, windFromDeg: 0, shotBearing: 0 });
  const tail = F.conditionsEffect('7i', 130, { windSpeed: 5, windFromDeg: 180, shotBearing: 0 });
  const cross = F.conditionsEffect('7i', 130, { windSpeed: 5, windFromDeg: 90, shotBearing: 0 });
  assert.ok(head.carry < 125 && tail.carry > 130);
  assert.ok(cross.lateral < -3, 'drift ' + cross.lateral);
  near(F.conditionsEffect('7i', 130).carry, 130, 1.5, '무풍 캐리 복원');
});

test('전략: 왼쪽 OB가 있으면 오른쪽 조준', () => {
  const bag = [{ id: 'D', carry: 200, sdDist: 0.08, sdLat: 6 }, { id: '5i', carry: 150, sdDist: 0.07, sdLat: 4 }];
  const base = { tee: { x: 0, y: 0 }, pin: { x: 0, y: 360 }, green: { x: 0, y: 360, r: 14 }, center: [{ x: 0, y: 0 }, { x: 0, y: 360 }], halfWidth: 16 };
  const clear = optimizeTeeShot({ hole: { ...base, hazards: [] }, bag });
  const ob = optimizeTeeShot({ hole: { ...base, hazards: [{ type: 'ob', x: -45, y: 200, r: 30 }] }, bag });
  assert.ok(ob.best.aim > clear.best.aim, `${ob.best.aim} > ${clear.best.aim}`);
  assert.ok(ob.best.pOB < 0.1);
  assert.equal(classify({ x: 0, y: 360 }, base).lie, 'green');
  assert.ok(expectedStrokes(150, 'rough') > expectedStrokes(150, 'fairway'));
});

test('분실구: 낙하 구역 추정 · 동반자 마킹으로 축소 · 수색 후 이동', () => {
  const e = estimateLanding({ start: { x: 0, y: 0 }, bearing: 0, sigmaBearing: 8, club: { carry: 180, sdDist: 0.08, roll: 0.08 } });
  near(e.center.x, 0, 3); near(e.center.y, 180 * 1.08, 15);
  const m = addMark(e, { x: 5, y: 190, sigma: 6 });
  assert.ok(m.r80 < e.r80, `마킹 후 반경 축소 ${m.r80} < ${e.r80}`);
  assert.ok(m.confidence > e.confidence);
  const s = markSearched(m, m.center, 6, 0.9);
  assert.ok(massWithin(s.parts, m.center, 6) < massWithin(m.parts, m.center, 6));
  const g1 = guidance(m, { x: 0, y: 100 }), g2 = guidance(m, { x: 0, y: 150 }, g1.dist);
  assert.equal(g2.trend, 'closer');
});

test('정산: 타당·스킨 합계 0, 최소 송금', () => {
  const course = { id: 'c', name: 't', holes: [1, 2, 3].map(n => ({ n, par: 4 })) };
  const r = newRound({ course, players: ['A', 'B', 'C'], mode: 'casual', games: { stroke: 1000, skins: 5000 } });
  const S = [[4, 5, 5], [5, 5, 4], [4, 4, 4]];
  r.holes.forEach((h, i) => h.scores.forEach((s, j) => s.strokes = S[i][j]));
  const st = settle(r);
  near(st.net.reduce((a, x) => a + x.amount, 0), 0, 1);
  const tr = minTransfers(['A', 'B', 'C'], st.net.map(x => x.amount));
  assert.ok(tr.length <= 2);
});

test('내 백: 갭/중복 분석과 샷 학습', () => {
  const bag = [{ id: '5i', name: '5i', enabled: true, carry: 150 }, { id: '6i', name: '6i', enabled: true, carry: 147 }, { id: 'PW', name: 'PW', enabled: true, carry: 100 }];
  const g = gapAnalysis(bag);
  assert.ok(g.issues.some(x => x.kind === 'overlap') && g.issues.some(x => x.kind === 'gap'));
  const l = learnClub({ id: '7i', carry: 130, sdDist: 0.07, sdLat: 4 }, [120, 122, 118, 121, 119].map(c => ({ club: '7i', carry: c, latDeg: 2 })));
  assert.ok(l.learned && l.carry < 126 && l.carry > 119);
});

test('날씨: 플레이즈라이크 방향성, WBGT 단계', () => {
  const up = playsLike({ dist: 150, dh: 10 }), head = playsLike({ dist: 150, windSpeed: 5, windFrom: 0, shotBearing: 0 });
  near(up.total, 160, 0.01); assert.ok(head.total > 150);
  assert.ok(playsLike({ dist: 150, windSpeed: 5, windFrom: 180, shotBearing: 0 }).total < 150);
  assert.equal(wbgtLevel(estimateWBGT(35, 70)).level, 3);
  assert.equal(wbgtLevel(estimateWBGT(18, 50)).level, 0);
});
