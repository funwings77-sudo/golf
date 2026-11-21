// 사용자 편의(내비 UX 원칙): 추천이 이유 없이 흔들리지 않기 · 위치가 한 번 튄 것으로 홀이 넘어가지 않기
import test from 'node:test';
import assert from 'node:assert/strict';
import { keepClub } from '../js/physics/advice.js';
import { dwell } from '../js/core/course.js';

const A = (club, es, alts = []) => ({ kind: 'full', club, clubName: club, es, alternatives: alts });

test('추천 클럽: 1~2m 흔들림에 두 클럽이 거의 같으면 이전 추천 유지', () => {
  const prev = A('7i', 3.10), next = A('6i', 3.08, [{ club: '7i', es: 3.12 }]);
  const r = keepClub(prev, next, { moved: 2 });
  assert.equal(r.kept, true); assert.equal(r.adv.club, '7i');
});

test('추천 클럽: 차이가 크면 바꾸고 이유를 붙임 · 많이 옮기거나 바람·핀이 바뀌면 이유가 달라짐', () => {
  assert.deepEqual(keepClub(A('7i', 3.4), A('6i', 3.1, [{ club: '7i', es: 3.4 }]), { moved: 2 }).reason, { from: '7i', to: '6i', why: '남은 거리가 바뀌어서' });
  assert.equal(keepClub(A('7i', 3.1), A('8i', 3.0, [{ club: '7i', es: 3.02 }]), { moved: 14 }).reason.why, '14m 옮겨서');
  assert.equal(keepClub(A('7i', 3.1), A('6i', 3.0, [{ club: '7i', es: 3.02 }]), { moved: 1, windDelta: 3 }).reason.why, '바람이 바뀌어서');
  assert.equal(keepClub(A('7i', 3.1), A('6i', 3.0, [{ club: '7i', es: 3.02 }]), { pinMoved: true }).reason.why, '핀 위치가 바뀌어서');
  assert.equal(keepClub(A('7i', 3), A('7i', 3)).reason, null, '같은 클럽이면 아무 일 없음');
});

test('자동 홀 넘김: 한 번 튄 위치로는 안 넘어가고, 3번·5초 넘게 머물러야 넘어감', () => {
  let c = null, r;
  r = dwell(c, 5, true, 0); assert.equal(r.fire, false); c = r.cand;        // 한 번 들어옴
  r = dwell(c, 5, false, 1000); assert.equal(r.fire, false); c = r.cand;    // 바로 벗어남 → 처음부터
  assert.equal(c, null);
  for (const t of [2000, 3000, 4000, 7000]) { r = dwell(c, 5, true, t); c = r.cand; if (r.fire) break; }
  assert.equal(r.fire, true, '2초~7초(5초) 동안 4번 머묾 → 넘어감');
  r = dwell(null, 5, true, 0); r = dwell(r.cand, 5, true, 1000); r = dwell(r.cand, 5, true, 2000);
  assert.equal(r.fire, false, '3번이어도 5초가 안 됐으면 아직');
});
