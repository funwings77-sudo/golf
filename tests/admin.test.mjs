// 관리자 도메인 로직 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/admin/model.js';
import { buildRoundReport } from '../js/core/report.js';
import { utf8ToB64, b64ToUtf8, gitBlobSha } from '../js/admin/github.js';
import { destination, distance } from '../js/core/geo.js';
import { demoGreen } from '../js/physics/putt.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≉ ${b} (±${tol})`);

function sampleCourse() {
  const c = M.newOfficialCourse({ id: 'test-cc', name: '테스트 CC', holes: 2 });
  const t1 = { lat: 37.5, lon: 127 }, g1 = destination(t1, 30, 350);
  Object.assign(c.holes[0], { par: 4, hdcp: 1, tee: t1, green: g1, front: destination(g1, 210, 14), back: destination(g1, 30, 14) });
  const t2 = destination(g1, 90, 40), g2 = destination(t2, 120, 150);
  Object.assign(c.holes[1], { par: 3, hdcp: 2, tee: t2, green: g2, front: destination(g2, 300, 12), back: destination(g2, 120, 12) });
  c.shelters = [{ id: 's', name: '그늘집', ...t2 }];
  return c;
}

test('코스 검증: 정상 코스 통과, 누락·이상값 검출', () => {
  const c = sampleCourse();
  const ok = M.validateCourse(c);
  assert.equal(ok.errors.length, 0, JSON.stringify(ok.errors));
  assert.ok(ok.warnings.some(w => /그린맵/.test(w.msg)), '그린맵 없음 경고');

  const bad = M.clone(c);
  bad.id = 'Bad ID'; delete bad.holes[1].tee; bad.holes[0].par = 7; bad.holes[0].hazards.push({ type: 'lava', lat: 37.5, lon: 127, r: 5 });
  const v = M.validateCourse(bad);
  assert.ok(!v.ok);
  assert.ok(v.errors.some(e => /코스 ID/.test(e.msg)));
  assert.ok(v.warnings.some(e => e.hole === 2 && /티 위치/.test(e.msg)), '위치 누락은 경고');
  assert.ok(v.errors.some(e => e.hole === 1 && /Par 7/.test(e.msg)));
  assert.ok(v.errors.some(e => /lava/.test(e.msg)));

  const longPar3 = M.clone(c); longPar3.holes[0].par = 3;
  assert.ok(M.validateCourse(longPar3).warnings.some(w => w.hole === 1 && /일반 범위/.test(w.msg)), '파3 350m 경고');
});

test('발행 정리: 핀 제외, 격자 mm 반올림, 카탈로그 갱신', () => {
  const c = sampleCourse();
  c.holes[0].pin = { lat: 1, lon: 2, ts: 1 };
  c.holes[0].greenGrid = { origin: c.holes[0].green, grid: { x0: -1, y0: -1, dx: 1, nx: 3, ny: 3, h: [0.12345, 0, 0, 0, 0, 0, 0, 0, 0] } };
  const p = M.stripForPublish(c);
  assert.equal(p.holes[0].pin, undefined);
  assert.equal(p.holes[0].greenGrid.grid.h[0], 0.123);
  assert.equal(c.holes[0].pin.lat, 1, '원본은 그대로');
  let cat = M.upsertCatalog(null, M.catalogEntry({ ...p, rev: 1 }));
  cat = M.upsertCatalog(cat, M.catalogEntry({ ...p, name: '바뀐 이름', rev: 2 }));
  assert.equal(cat.courses.length, 1);
  assert.equal(cat.courses[0].rev, 2);
  assert.equal(cat.courses[0].par, 7);
  assert.equal(M.removeFromCatalog(cat, 'test-cc').courses.length, 0);
});

test('변경 요약: 이동 거리와 파 변경을 표시', () => {
  const a = sampleCourse(), b = M.clone(a);
  b.holes[0].par = 5; b.holes[1].green = destination(a.holes[1].green, 0, 3);
  const d = M.diffCourse(a, b);
  assert.ok(d.some(x => /1번 홀: Par 4→5/.test(x)));
  assert.ok(d.some(x => /2번 홀: green 3\.0m 이동/.test(x)));
  assert.deepEqual(M.diffCourse(a, M.clone(a)), []);
});

test('핀 시트: 앞에서 m · 좌우 m ↔ 좌표 왕복', () => {
  const h = sampleCourse().holes[0];
  for (const [depth, side] of [[5, 0], [14, -4], [22, 6]]) {
    const pin = M.pinFromOffsets(h, { depth, side });
    const o = M.offsetsFromPin(h, pin);
    near(o.depth, depth, 0.05, 'depth'); near(o.side, side, 0.05, 'side');
  }
  near(distance(M.pinFromOffsets(h, { depth: 14, side: 0 }), h.green), 0, 0.3, '앞에서 14m = 중앙');
  assert.ok(M.checkPin(h, M.pinFromOffsets(h, { depth: 14, side: 0 })).ok);
  assert.ok(!M.checkPin(h, M.pinFromOffsets(h, { depth: 40, side: 0 })).ok, '그린 밖');
  assert.ok(M.checkPin(h, M.pinFromOffsets(h, { depth: 2, side: 0 })).warn, '가장자리 경고');
});

test('그린 격자: 행렬 CSV(북쪽 먼저)·단위 변환·XYZ 리샘플·JSON', () => {
  const csv = '# heights\n3,3,3\n2,2,2\n1,1,1\n0,0,0';
  const { grid } = M.parseGridInput(csv, { dx: 0.5, unit: 'cm', mode: 'matrix' });
  assert.equal(grid.nx, 3); assert.equal(grid.ny, 4);
  near(grid.h[0], 0, 1e-9, '남쪽(첫 행 j=0)=마지막 입력 행');
  near(grid.h[grid.h.length - 1], 0.03, 1e-9, '북쪽=첫 입력 행, cm→m');
  near(grid.x0, -0.5, 1e-9); near(grid.y0, -0.75, 1e-9);
  const st = M.gridStats(grid);
  near(st.maxSlope, 2, 1e-6, '1cm/0.5m = 2%');

  // 평면 z = 0.02x + 0.01y 측량 점 → 격자 기울기 복원
  const pts = [];
  for (let x = -8; x <= 8; x += 1.3) for (let y = -8; y <= 8; y += 1.1) pts.push(`${x.toFixed(2)},${y.toFixed(2)},${(0.02 * x + 0.01 * y).toFixed(4)}`);
  const r = M.parseGridInput(pts.join('\n'), { cellSize: 0.5 });
  assert.equal(r.kind, 'xyz');
  near(M.gridStats(r.grid).meanSlope, Math.hypot(2, 1), 0.35, '평균 경사 %');

  const g = demoGreen('tier');
  const j = M.parseGridInput(JSON.stringify({ grid: g }));
  assert.equal(j.grid.nx * j.grid.ny, g.h.length);
  assert.throws(() => M.parseGridInput('1,2\n3'), /열 수/);
  assert.match(M.validateGrid({ x0: 0, y0: 0, dx: 1, nx: 3, ny: 3, h: [0, 0, 0, 0, 900, 0, 0, 0, 0] }), /단위/);
});

test('라운드 리포트: 비식별 생성 → 집계(난이도·진행 병목·분실구)', () => {
  const c = sampleCourse();
  const mk = (i, s1, s2, m1, lost) => {
    const start = Date.parse('2026-11-14T08:00:00Z') + i * 86400000;
    const round = {
      id: 'r' + i, courseName: c.name, date: new Date(start).toISOString(), startedAt: new Date(start).toISOString(), endedAt: new Date(start + (m1 + 12) * 60000).toISOString(), mode: i === 9 ? 'practice' : 'casual',
      players: [{ name: '홍길동' }, { name: '친구' }],
      holes: [{ n: 1, par: 4, scores: [{ strokes: s1, putts: 2, penalties: lost, lost }, { strokes: 9, putts: 4, penalties: 0, lost: 0 }] }, { n: 2, par: 3, scores: [{ strokes: s2, putts: 3, penalties: 0, lost: 0 }, { strokes: 3, putts: 1, penalties: 0, lost: 0 }] }],
      holeTimes: { 1: start, 2: start + m1 * 60000 },
      lostEvents: lost ? [{ hole: 1, lat: 37.5012345678, lon: 127.0012345678, found: false, searchSec: 180, penalty: 1 }] : [],
    };
    return buildRoundReport(round, { official: { id: 'test-cc', rev: 3 } });
  };
  const reports = [mk(0, 6, 3, 20, 1), mk(1, 5, 4, 19, 0), mk(2, 7, 3, 22, 1), mk(9, 9, 9, 40, 0)];
  const r0 = reports[0];
  assert.equal(M.validateReport(r0), null);
  assert.equal(r0.courseId, 'test-cc'); assert.equal(r0.courseRev, 3);
  assert.ok(!JSON.stringify(r0).includes('홍길동') && !JSON.stringify(r0).includes('친구'), '이름 미포함');
  assert.equal(r0.holes[0].strokes, 6, '내 스코어만');
  assert.equal(r0.lost[0].lat, 37.50123, '좌표 반올림');
  assert.equal(r0.holes[1].arrivedAt, 20 * 60000);

  const agg = M.aggregateReports(reports, c);
  assert.equal(agg.rounds, 3, '연습 라운드 제외'); assert.equal(agg.excludedPractice, 1);
  const h1 = agg.holes[0], h2 = agg.holes[1];
  near(h1.avgToPar, 2, 1e-9); near(h2.avgToPar, 1 / 3, 1e-9);
  assert.equal(h1.difficultyRank, 1);
  near(h1.paceMedian, 20, 1e-9); assert.ok(h1.bottleneck, '1번 홀 20분 > 목표 15분');
  near(h2.paceMedian, 12, 1e-9); assert.ok(!h2.bottleneck);
  near(h2.threePuttRate, 1, 1e-9);
  near(agg.lostPerRound, 2 / 3, 1e-9); assert.equal(h1.lostPoints.length, 2);
  assert.deepEqual(agg.bottlenecks, [1]);
  assert.match(M.reportsToCSV(agg), /^﻿홀,Par/);
});

test('공지: 기간·비활성·검증', () => {
  const now = Date.parse('2026-11-14T10:00:00');
  assert.ok(M.noticeActive({ start: '2026-11-14T09:00', end: '2026-11-14T11:00' }, now));
  assert.ok(!M.noticeActive({ start: '2026-11-14T11:00' }, now));
  assert.ok(!M.noticeActive({ disabled: true }, now));
  assert.ok(M.noticeActive({}, now));
  assert.match(M.validateNotice({ title: '', level: 'info' }), /제목/);
  assert.match(M.validateNotice({ title: 'a', level: 'info', start: '2026-11-14T10:00', end: '2026-11-14T09:00' }), /종료/);
  assert.equal(M.validateNotice({ title: '낙뢰', level: 'danger' }), null);
});

test('GitHub 인코딩: UTF-8 base64 왕복, git blob sha', async () => {
  const s = '그린 스피드 10.5 ⛳ "quote"';
  assert.equal(b64ToUtf8(utf8ToB64(s)), s);
  assert.equal(await gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
});
