// KGBA 코스 DB 가져오기 테스트 (README 스키마와 같은 합성 덤프)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSQLDump, normalizeKGBA, clubToCourse, cardMeters, unitOf } from '../js/admin/kgba.js';
import { validateCourse } from '../js/admin/model.js';

const DUMP = `PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE clubs (id INTEGER PRIMARY KEY, name TEXT, sido TEXT, sigungu TEXT, operation_type TEXT, total_holes INTEGER, member_holes INTEGER, public_holes INTEGER, phone TEXT, address TEXT, homepage TEXT, opened_year INTEGER, course_layout TEXT, par_18 INTEGER, length_yards INTEGER, fairway_grass TEXT, green_grass TEXT, architect TEXT, greenfee_weekday TEXT, greenfee_weekend TEXT, cart_fee TEXT, caddie_fee TEXT, reservation TEXT, difficulty TEXT, features TEXT, facilities TEXT, sources TEXT, checked_date TEXT, collection_status TEXT);
INSERT INTO clubs VALUES(1,'경주신라','경북','경주시','회원제',27,27,0,'054-000-0000','경북 경주시 어딘가','https://example.com',1990,'신라·화랑·천마',72,7000,'켄터키블루','벤트그라스','홍길동','20만원','25만원','10만원','15만원','홈페이지','중','line1'||char(10)||'line2','클럽하우스','https://example.com/course','2026-11-14','완료');
INSERT INTO "clubs" VALUES(2,'접속 안 됨 CC','제주','제주시',NULL,18,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,replace('a\\nb','\\n',char(10)),NULL,NULL,NULL,'접속불가');
CREATE TABLE holes (club_id INTEGER, club_name TEXT, course_name TEXT, hole_no INTEGER, par INTEGER, handicap INTEGER, tee_back INTEGER, tee_champion_blue INTEGER, tee_regular_white INTEGER, tee_lady_red INTEGER, distance_unit TEXT, tee_names TEXT, hazards TEXT, green_notes TEXT, strategy TEXT, map_image_note TEXT, source_url TEXT, checked_date TEXT, note TEXT, sheet_row INTEGER, FOREIGN KEY(club_id) REFERENCES clubs(id));
${[['신라', 1], ['화랑', 10]].flatMap(([cn, row0]) => Array.from({ length: 9 }, (_, i) => `INSERT INTO holes VALUES(1,'경주신라','${cn}',${i + 1},${[4, 4, 3, 5, 4, 4, 3, 5, 4][i]},${i + 1},${400 + i},${380 + i},${360 + i},${300 + i},'m','블랙·블루·화이트·레드','왼쪽 벙커','2단 그린','오른쪽 공략 O''Neil',NULL,'https://example.com/h',NULL,NULL,${row0 + i});`)).join('\n')}
CREATE VIEW club_summary AS SELECT club_id, COUNT(*) AS n FROM holes GROUP BY club_id;
COMMIT;`;

test('SQL 덤프 파서: 테이블·따옴표·char(10)·replace·NULL', () => {
  const t = parseSQLDump(DUMP);
  assert.equal(t.clubs.rows.length, 2);
  assert.equal(t.holes.rows.length, 18);
  assert.equal(t.clubs.columns.length, 29);
  assert.equal(t.clubs.rows[1].features, 'a\nb');
  assert.equal(t.holes.rows[0].strategy, "오른쪽 공략 O'Neil");
  assert.equal(t.holes.columns.includes('FOREIGN'), false, '제약 조건은 컬럼 아님');
});

test('정규화 → 공식 코스 초안: 9홀 묶음·스코어카드·출처', () => {
  const { clubs } = normalizeKGBA(parseSQLDump(DUMP));
  const c1 = clubs.find(c => c.id === 1);
  assert.deepEqual(c1.nines.map(n => n.name), ['신라', '화랑']);
  const { course, warnings } = clubToCourse(c1, { id: 'kgba-1' });
  assert.equal(course.holes.length, 18);
  assert.equal(course.holes[9].nine, '화랑'); assert.equal(course.holes[9].nineHole, 1); assert.equal(course.holes[9].n, 10);
  assert.equal(course.holes[2].par, 3);
  assert.equal(course.holes[0].hdcp, null, '9홀별 핸디캡 → 공식 칸 비움');
  assert.ok(warnings.some(w => /핸디캡/.test(w)));
  assert.ok(warnings.some(w => /27홀/.test(w)), '목록 27홀 vs 수집 18홀 경고');
  assert.equal(course.nines.length, 2); assert.deepEqual(course.nines[1].holes, [10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.equal(cardMeters(course.holes[0], 'white'), 360);
  assert.equal(course.dataSources[0].type, 'scorecard');
  assert.equal(course.info.greenGrass, '벤트그라스');
  const only = clubToCourse(c1, { id: 'kgba-1-hwarang', nines: ['화랑'] }).course;
  assert.equal(only.holes.length, 9); assert.equal(only.nines, undefined);
  // 좌표가 없으므로 검증 오류(티·그린 미지정)가 나는 것이 정상
  assert.ok(validateCourse(course).ok && validateCourse(course).warnings.some(e => /그린 중앙 위치/.test(e.msg)), '좌표 없음 = 경고(발행 가능)');
  assert.throws(() => clubToCourse(clubs.find(c => c.id === 2)), /홀 데이터/);
});

test('거리 단위', () => {
  assert.equal(unitOf('yd'), 'yd'); assert.equal(unitOf('야드'), 'yd'); assert.equal(unitOf('m'), 'm'); assert.equal(unitOf(null), 'm');
  assert.ok(Math.abs(cardMeters({ scorecard: { unit: 'yd', white: 400 } }) - 365.76) < 1e-9);
});

import { parseOSM, applyOSM } from '../js/admin/osm.js';
import { destination, distance } from '../js/core/geo.js';
import { newOfficialCourse, validateCourse as vc } from '../js/admin/model.js';

test('OSM 골프 태그 → 홀 지오메트리 · 스코어카드 거리 대조', () => {
  const tee = { lat: 37.5, lon: 127 }, ip = destination(tee, 10, 220), gc = destination(ip, 20, 150);
  const ring = (c, r, n = 12) => Array.from({ length: n + 1 }, (_, i) => destination(c, i * 360 / n, r));
  const els = [
    { type: 'way', id: 1, tags: { golf: 'hole', ref: '1', par: '4' }, geometry: [tee, ip, gc] },
    { type: 'way', id: 2, tags: { golf: 'green' }, geometry: ring(gc, 15) },
    { type: 'way', id: 3, tags: { golf: 'bunker' }, geometry: ring(destination(ip, 100, 25), 8) },
    { type: 'way', id: 4, tags: { golf: 'water_hazard' }, geometry: ring(destination(tee, 180, 900), 20) },
  ];
  const osm = parseOSM(els);
  assert.equal(osm.holes.length, 1); assert.equal(osm.greens.length, 1); assert.equal(osm.hazards.length, 2);
  const c = newOfficialCourse({ id: 'osm-test', name: 'OSM', holes: 2 });
  const rep = applyOSM(c, osm);
  assert.deepEqual(rep.matched, [1]); assert.deepEqual(rep.skipped, [2]);
  const h = c.holes[0];
  assert.ok(distance(h.green, gc) < 0.5, '그린 중심 = 폴리곤 중심');
  assert.ok(Math.abs(distance(h.front, h.back) - 30) < 1.5, '그린 깊이 ≈ 지름 30m');
  assert.equal(h.hazards.length, 1, '멀리 있는 물은 제외');
  assert.ok(Math.abs(h.hazards[0].r - 8) < 1);
  assert.ok(c.dataSources.some(s => s.type === 'geometry-osm'));
  // 스코어카드 거리 대조: 실제 경로 370m, 카드 360m → 통과 / 카드 330m → 경고
  h.scorecard = { unit: 'm', white: 360 };
  assert.ok(!vc(c).warnings.some(w => w.hole === 1 && /스코어카드/.test(w.msg)));
  h.scorecard.white = 330;
  assert.ok(vc(c).warnings.some(w => w.hole === 1 && /스코어카드 330m/.test(w.msg)));
});

import { verifyGrid, gridGradAt } from '../js/admin/model.js';
test('그린맵 현장 검증: 수평계 측정 vs 격자 (±0.2%p)', () => {
  // z = 0.02x (동쪽으로 2% 오르막) → 공은 서쪽(270°)으로 흐름
  const nx = 21, dx = 0.5, h = []; for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) h.push(0.02 * (-5 + i * dx));
  const g = { x0: -5, y0: -5, dx, nx, ny: nx, h };
  const [gx, gy] = gridGradAt(g, 1, 1); assert.ok(Math.abs(gx - 0.02) < 1e-9 && Math.abs(gy) < 1e-9);
  const ok = verifyGrid(g, [{ x: 0, y: 0, pct: 2.0, dir: 270 }, { x: 2, y: -1, pct: 2.1, dir: 268 }, { x: -2, y: 2, pct: 1.9, dir: 272 }]);
  assert.ok(ok.pass, 'rms ' + ok.rms); assert.ok(Math.abs(ok.rows[0].gridDir - 270) < 1e-6);
  const bad = verifyGrid(g, [{ x: 0, y: 0, pct: 2.0, dir: 90 }]);
  assert.ok(!bad.pass && bad.rms > 3.9, '반대 방향이면 실패');
});
