// 저장 · 백업 · 복원 (localStorage 대신 메모리 저장소, 용량 한도 흉내)
import test from 'node:test';
import assert from 'node:assert/strict';

class MemStorage {
  constructor(limit = Infinity) { this.m = new Map(); this.limit = limit; }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) {
    const used = [...this.m].reduce((a, [kk, vv]) => a + (kk === k ? 0 : vv.length), 0);
    if (used + String(v).length > this.limit) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    this.m.set(k, String(v));
  }
  removeItem(k) { this.m.delete(k); }
}
globalThis.localStorage = new MemStorage();
localStorage.setItem('pinpoint.shots', '{broken json');               // 깨진 값
localStorage.setItem('pinpoint.rounds', JSON.stringify([{ id: 'r1', endedAt: '2026-01-01', courseName: 'A' }]));
const St = await import('../js/core/state.js');

test('깨진 저장값은 기본값으로 읽되 원본은 따로 남김', () => {
  assert.deepEqual(St.S.shots, []);
  assert.equal(localStorage.getItem('pinpoint.corrupt.shots'), '{broken json');
});

test('백업에는 내 기록만 (서버 캐시·깨진 값 제외), 복원은 라운드·샷을 합침', () => {
  localStorage.setItem('pinpoint.remote.clubs', '{"big":1}');
  St.S.shots = [{ id: 1, club: '7i', total: 150, ts: 1 }]; St.save('shots');
  const b = St.exportAll();
  assert.equal(b.format, St.BACKUP_FORMAT);
  assert.ok(b.data.rounds && b.data.shots && !b.data['remote.clubs'] && !b.data['corrupt.shots']);
  // 다른 휴대폰의 백업: 라운드 1개(겹침) + 1개(새것), 샷 1개(새것)
  const other = { format: St.BACKUP_FORMAT, version: 1, data: {
    rounds: JSON.stringify([{ id: 'r1', endedAt: '2026-01-01', courseName: 'A' }, { id: 'r2', endedAt: '2026-02-01', courseName: 'B' }]),
    shots: JSON.stringify([{ id: 2, club: 'D', total: 220, ts: 2 }]),
    settings: JSON.stringify({ unit: 'yd' }),
  } };
  const r = St.importAll(other);
  assert.equal(r.rounds, 2); assert.equal(r.shots, 2);
  assert.deepEqual(JSON.parse(localStorage.getItem('pinpoint.rounds')).map(x => x.id), ['r2', 'r1']); // 최신 먼저
  assert.equal(JSON.parse(localStorage.getItem('pinpoint.settings')).unit, 'yd');
  assert.throws(() => St.importAll({ hello: 1 }), /백업 파일이 아니에요/);
});

test('저장 실패는 false + 알림 (조용히 버리지 않음)', () => {
  const fails = []; const un = St.onSaveFail(k => fails.push(k));
  localStorage.limit = 10; // 거의 꽉 참
  St.S.shots = Array.from({ length: 50 }, (_, i) => ({ id: i, club: '7i', total: 100 + i }));
  assert.equal(St.save('shots'), false);
  assert.deepEqual(fails, ['shots']);
  localStorage.limit = Infinity; un();
  assert.equal(St.save('shots'), true);
  const rep = St.storageReport(); assert.ok(rep.total > 0 && rep.rows.length > 0);
});

test('그린 높이 격자: 저장할 때 압축 · 읽을 때 복원 (오차 0.05mm 이하, 빈 칸 유지, 크기 1/5 이하)', () => {
  const n = 121 * 141, h = Array.from({ length: n }, (_, i) => (i === 5 ? null : 0.21 + Math.sin(i / 37) * 0.3 + i * 1e-6));
  const q = St.packHeights(h), back = St.unpackHeights(q);
  assert.equal(back.length, n); assert.equal(back[5], null);
  let worst = 0; for (let i = 0; i < n; i++) if (i !== 5) worst = Math.max(worst, Math.abs(back[i] - h[i]));
  assert.ok(worst <= 0.00005 + 1e-12, `worst ${worst}`);
  assert.ok(q.b64.length < JSON.stringify(h).length / 5);
  // 골프장 저장 → 다시 읽기: 메모리에서는 숫자 배열 그대로
  St.S.courses = [{ id: 'c1', name: 'G', holes: [{ n: 1, greenGrid: { origin: { lat: 37, lon: 127 }, grid: { x0: 0, y0: 0, dx: 0.25, nx: 121, ny: 141, h } } }] }];
  assert.equal(St.save('courses'), true);
  const raw = localStorage.getItem('pinpoint.courses');
  assert.ok(raw.includes('"hq"') && !raw.includes('0.21'));
  const g = JSON.parse(raw).holes; void g;
});
