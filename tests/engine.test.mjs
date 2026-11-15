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

import { adviseShot, predictBall, toBall, swingWords, dirWords } from '../js/physics/advice.js';
test('쉬운 플레이 추천: 풀샷·짧은 거리 힘 조절·퍼트·OB 피하기', () => {
  const bag = [{ id: 'D', name: '드라이버', carry: 200, sdDist: 0.08, sdLat: 6 }, { id: '7i', name: '7번 아이언', carry: 130, sdDist: 0.07, sdLat: 4 }, { id: 'SW', name: '샌드웨지', carry: 70, sdDist: 0.08, sdLat: 3 }];
  const me = { lat: 37.5, lon: 127 }, green = Geo.destination(me, 0, 360);
  const hole = { green, pin: green, front: Geo.destination(green, 180, 12), back: Geo.destination(green, 0, 12), hazards: [], halfWidth: 18 };
  const a = adviseShot({ me, hole, bag });
  assert.equal(a.kind, 'full'); assert.equal(a.club, 'D'); assert.ok(a.power >= 85);
  near(a.D, 360, 0.5); assert.ok(Math.abs(a.rel) <= 16);
  // 왼쪽 OB → 오른쪽 조준
  const ob = adviseShot({ me, hole: { ...hole, hazards: [{ type: 'ob', ...Geo.destination(me, 350, 200), r: 35 }] }, bag });
  assert.ok(ob.rel > a.rel, `${ob.rel} > ${a.rel}`);
  // 50m: 샌드웨지 힘 약 71%
  const near50 = adviseShot({ me: Geo.destination(green, 180, 50), hole, bag });
  assert.equal(near50.kind, 'partial'); assert.equal(near50.club, 'SW'); near(near50.power, 71, 2);
  assert.equal(near50.swing.short, '어깨 높이까지');
  assert.equal(adviseShot({ me: Geo.destination(green, 90, 5), hole, bag }).kind, 'putt');
  assert.equal(dirWords(0.3), '깃발 쪽으로 똑바로'); assert.equal(dirWords(-4.26), '깃발보다 왼쪽으로 4.3°');
  assert.equal(swingWords(100).short, '끝까지 크게');
});
test('친 공 위치 예측과 길 안내', () => {
  const start = { lat: 37.5, lon: 127 };
  const p = predictBall({ start, aimBearing: 30, club: { id: '7i', carry: 130 } });
  const t = toBall(start, p.center);
  near(t.bearing, 30, 4); assert.ok(t.d > 125 && t.d < 150, 'd ' + t.d);
  assert.equal(t.compass, '북동'); assert.equal(toBall(start, p.center, 30).rel != null, true);
});

import { rotationMatrix, project, enuOf, cameraAxis, yawCorrection, focalPx } from '../js/core/arproj.js';
test('AR 투영: 세워 든 휴대폰에서 북쪽 깃발은 화면 가운데, 동쪽은 오른쪽, 지면은 아래', () => {
  const W = 400, H = 800, f = focalPx(63, H), opt = { f, cx: W / 2, cy: H / 2 };
  // 세로로 세워 북쪽을 봄: alpha=0, beta=90, gamma=0
  const R = rotationMatrix(0, 90, 0);
  const ax = cameraAxis(R); near(ax.bearing, 0, 1e-6); near(ax.pitch, 0, 1e-6);
  const me = { lat: 37.5, lon: 127 };
  const flag = Geo.destination(me, 0, 120);
  const eyeLevel = project(R, enuOf(me, flag, { eye: 0 }), opt);
  near(eyeLevel.x, W / 2, 0.5); near(eyeLevel.y, H / 2, 0.5); near(eyeLevel.depth, 120, 0.5);
  const ground = project(R, enuOf(me, flag, { eye: 1.5 }), opt);
  assert.ok(ground.y > H / 2, '지면은 지평선 아래'); near(ground.y - H / 2, f * 1.5 / 120, 0.5);
  const east = project(R, enuOf(me, Geo.destination(me, 10, 120), { eye: 0 }), opt);
  assert.ok(east.x > W / 2, '오른쪽'); near(Math.atan((east.x - W / 2) / f) * 180 / Math.PI, 10, 0.2);
  assert.equal(project(R, enuOf(me, Geo.destination(me, 180, 50)), opt).visible, false, '뒤쪽은 안 보임');
  // 동쪽을 봄: 나침반 90° → alpha = 270
  const Re = rotationMatrix(270, 90, 0); near(cameraAxis(Re).bearing, 90, 1e-6);
  const pe = project(Re, enuOf(me, Geo.destination(me, 90, 80), { eye: 0 }), opt); near(pe.x, W / 2, 0.5);
  // 아래로 20° 숙임(beta=70) → 지평선이 화면 위로 올라감
  const Rd = rotationMatrix(0, 70, 0); near(cameraAxis(Rd).pitch, -20, 1e-6);
  assert.ok(project(Rd, enuOf(me, flag, { eye: 0 }), opt).y < H / 2);
  // 1탭 방위 보정: 깃발이 실제로 화면 x=150에 보이면 오차 각도
  const c = yawCorrection(R, enuOf(me, Geo.destination(me, 5, 120), { eye: 0 }), 200, opt);
  near(c, 5, 0.2);
});

import { contourSegments, greenGeoJSON, gridCorners, slopeAt } from '../js/physics/greenmesh.js';
test('3D 겹치기용 그린 데이터: 등고선·흐름 화살표·모서리', () => {
  const nx = 21, dx = 0.5, h = []; for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) h.push(0.02 * (-5 + j * dx)); // 북쪽으로 2% 오르막
  const g = { x0: -5, y0: -5, dx, nx, ny: nx, h }, gg = { origin: { lat: 37.5, lon: 127 }, grid: g };
  near(slopeAt(g, 10, 10).pct, 2, 1e-9);
  const segs = contourSegments(g, 0.02);
  assert.ok(segs.length > 50 && segs.every(s => Math.abs(s.a.y - s.b.y) < 1e-9), '동서 방향 등고선');
  const gj = greenGeoJSON(gg); assert.ok(gj.features.some(f => f.properties.k === 'flow'));
  const flow = gj.features.find(f => f.properties.k === 'flow').geometry.coordinates;
  assert.ok(flow[1][1] < flow[0][1], '화살표는 남쪽(내리막)으로');
  const c = gridCorners(gg); assert.equal(c.length, 4); assert.ok(c[0][1] > c[3][1] && c[1][0] > c[0][0]);
});

import { unproject, groundHit } from '../js/core/arproj.js';
test('AR 레인지파인더: 화면점 역투영 · 지면 거리', () => {
  const R = rotationMatrix(30, 85, 3), opt = { f: 900, cx: 200, cy: 400, screenAngle: 0 };
  for (const [x, y] of [[200, 400], [120, 300], [330, 620]]) {
    const v = unproject(R, x, y, opt), q = project(R, { x: v.x * 50, y: v.y * 50, z: v.z * 50 }, opt);
    assert.ok(Math.abs(q.x - x) < 1e-6 && Math.abs(q.y - y) < 1e-6, '역투영 왕복');
  }
  // 눈높이 1.5m에서 3° 내려다보면 약 28.6m
  const dep = 3 * Math.PI / 180, g = groundHit({ x: 0, y: Math.cos(dep), z: -Math.sin(dep) }, { eye: 1.5 });
  assert.ok(Math.abs(g.h - 1.5 / Math.tan(dep)) < 0.01 && Math.abs(g.bearing) < 1e-6);
  assert.ok(g.err > 2 && g.err < 12, '오차 추정 ' + g.err);
  // 수평 이상은 지면에 닿지 않음
  assert.equal(groundHit({ x: 0, y: 1, z: 0.01 }).h, Infinity);
  // 오르막(경사)이면 같은 각도에서 더 가까움
  assert.ok(groundHit({ x: 0, y: Math.cos(dep), z: -Math.sin(dep) }, { eye: 1.5, slope: 0.02 }).h < g.h);
});

import { verifyCaddie, badNumbers, factNumbers, engineAnswer } from '../js/core/aicaddie.js';
import { pickModel } from '../js/core/gemini.js';
test('AI 캐디 검증: 근거 없는 숫자·클럽·힘·조준을 걸러 냄', () => {
  const facts = { distances: { to_pin_m: 152, to_green_front_m: 137, plays_like_m: 156 }, engine: { club: '5i', club_name: '5번 아이언', power: 85, aim_deg: -2.3, carry_m: 146, remaining_m: 8, alternatives: [{ club: '6i' }] }, my_bag: [{ id: '5i', carry_m: 150 }, { id: '6i', carry_m: 141 }, { id: '7i', carry_m: 131 }], hazards: [{ type: '물', front_m: 120, carry_m: 135 }] };
  const ok = { answer: '5번 아이언으로 힘 85% 정도로 치세요. 물은 135m만 넘기면 돼요. 깃발까지 152m예요.', club: '5i', power: 85, aim_deg: -2.3, cautions: ['오른쪽 물 앞 120m'], confidence: 'high' };
  assert.deepEqual(verifyCaddie(ok, facts), []);
  assert.ok(verifyCaddie({ ...ok, answer: '깃발까지 170m예요' }, facts).some(p => p.includes('170')), '없는 거리');
  const f2 = { ...facts, my_bag: [...facts.my_bag, { id: 'D', carry_m: 200 }] };
  assert.ok(verifyCaddie({ ...ok, answer: '깃발까지 199m예요' }, f2).length, '다른 값(드라이버 200m)과 비슷해도 깃발 거리와 다르면 거절');
  assert.ok(verifyCaddie({ ...ok, answer: '깃발까지 153m예요' }, facts).length === 0, '±1m는 허용');
  assert.ok(verifyCaddie({ ...ok, answer: '물은 140m 넘기면 돼요' }, facts).length, '해저드 넘기기 거리 불일치');
  assert.ok(verifyCaddie({ ...ok, club: 'D' }, facts).length, '가방에 없는 클럽');
  assert.ok(verifyCaddie({ ...ok, club: '7i' }, facts).length, '엔진·대안에 없는 클럽');
  assert.deepEqual(verifyCaddie({ ...ok, club: '6i', power: null }, facts), [], '대안 클럽은 허용');
  assert.ok(verifyCaddie({ ...ok, power: 70 }, facts).length, '다른 힘');
  assert.ok(verifyCaddie({ ...ok, aim_deg: 5 }, facts).length, '다른 조준');
  assert.deepEqual(badNumbers('2번 홀에서 3타째, 152m', factNumbers(facts)), [], '작은 수와 맞는 거리');
  assert.ok(engineAnswer(facts).includes('5번 아이언') && engineAnswer(facts).includes('146m'));
});
test('Gemini 모델 자동 선택: 정식 flash 최신판', () => {
  const g = n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] });
  assert.equal(pickModel([g('gemini-1.5-flash'), g('gemini-2.5-flash'), g('gemini-2.5-pro'), g('gemini-2.5-flash-lite'), g('gemini-3.0-flash-preview'), g('gemini-2.5-flash-preview-tts'), { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }]), 'gemini-2.5-flash');
  assert.equal(pickModel([]), null);
});
