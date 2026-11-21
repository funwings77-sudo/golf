// 음성 안내 문장 테스트 (core/voice.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { m, deg, clock, aimWords, windWords, holeIntro, shotCue, walkCue, resultCue, say, configureVoice } from '../js/core/voice.js';

test('숫자: 10m 안은 0.1m, 그 밖은 1m · 각도는 0.5° · 시계 방향', () => {
  assert.equal(m(4.63), '4.6미터'); assert.equal(m(5), '5미터'); assert.equal(m(142.6), '143미터'); assert.equal(m(-3.2), '3.2미터');
  assert.equal(deg(2.3), '2.5도'); assert.equal(deg(-1.1), '1도');
  assert.equal(clock(0), '12시 방향'); assert.equal(clock(60), '2시 방향'); assert.equal(clock(-90), '9시 방향'); assert.equal(clock(185), '6시 방향');
});

test('조준·바람 말: 왼쪽/오른쪽 · 맞바람/뒷바람/옆바람', () => {
  assert.equal(aimWords(0.3, 1), '깃발을 바로 보고 치세요');
  assert.equal(aimWords(-2.2, -5.4), '깃발보다 왼쪽으로 2도, 깃발 왼쪽 5.4미터 지점을 보고 치세요');
  assert.equal(windWords(-4, 0.5), '맞바람 초속 4미터');
  assert.equal(windWords(3, 0), '뒷바람 초속 3미터');
  assert.equal(windWords(0.2, 3.5), '왼쪽에서 부는 바람 초속 3.5미터');
  assert.equal(windWords(-2, -2), '앞 오른쪽에서 부는 바람 초속 2.8미터');
  assert.equal(windWords(0.3, 0.2), '');
});

test('치기 전 안내: 자세히는 거리·앞뒤·고저차·바람·체감·클럽·조준·위험, 간단히는 세 가지', () => {
  const o = { D: 142.4, front: 133, back: 151.2, elev: 3.1, along: -4, cross: 0, plays: 151, temp: 3, club: '7번 아이언', swing: '끝까지 크게', power: 100, rel: -2.1, lateral: -5.2, carry: 140, rest: 4, hazards: [{ name: '벙커', front: 120, carry: 131 }], pBad: 0.2 };
  const d = shotCue(o, 'detail');
  assert.equal(d, '깃발까지 142미터, 그린 앞 133미터, 뒤 151미터. 오르막 3.1미터, 맞바람 초속 4미터, 추워서 덜 날아가요. 그래서 151미터처럼 쳐야 해요. 7번 아이언, 끝까지 크게. 깃발보다 왼쪽으로 2도, 깃발 왼쪽 5.2미터 지점을 보고 치세요. 벙커 앞까지 120미터, 넘기려면 131미터. 위험한 곳에 갈 확률 20퍼센트.');
  assert.equal(shotCue(o, 'simple'), '깃발까지 142미터. 7번 아이언으로 끝까지 크게. 깃발보다 왼쪽으로 2도 비켜서 보고 치세요.');
  assert.match(shotCue({ kind: 'putt', D: 4.37, elev: -0.06 }), /홀까지 4.4미터, 내리막 6센티/);
  assert.match(shotCue({ ...o, hazards: [{ name: 'OB', side: '오른쪽' }] }), /오른쪽 OB 조심/);
});

test('홀 소개 · 걸을 때 거리 (정해 둔 거리 지날 때만) · 결과', () => {
  assert.equal(holeIntro({ name: '3번 홀', par: 4, len: 380, hd: 5, toPin: 352.3, hist: '지난 2번 평균 5.5타', memo: '왼쪽 OB' }), '3번 홀, 파 4, 380미터, 핸디캡 5. 깃발까지 352미터. 지난 2번 평균 5.5타. 메모: 왼쪽 OB.');
  assert.equal(holeIntro({ name: '3번 홀', par: 4, hd: 5, toPin: 900, level: 'simple' }), '3번 홀, 파 4.');
  assert.equal(walkCue(null, 160), null);
  assert.equal(walkCue(160, 149, 60), '공까지 149미터, 2시 방향.');
  assert.equal(walkCue(149, 140), null);
  assert.equal(walkCue(12, 9.6), '공까지 9.6미터.');
  assert.equal(walkCue(6, 3.5), '거의 다 왔어요. 주변을 둘러보세요.');
  assert.equal(resultCue({ club: '7번 아이언', total: 133.6, lateral: 6.2, usual: 140 }), '7번 아이언, 134미터 날아갔어요. 오른쪽으로 6.2미터. 평소보다 6.4미터 짧아요.');
  assert.equal(resultCue({ club: '드라이버', total: 205, estimated: true, usual: 220 }), '드라이버, 205미터쯤 갔을 거예요.');
});

test('조사: 받침 따라 으로/로', async () => {
  const { ro } = await import('../js/core/voice.js');
  assert.equal(ro('7번 아이언'), '으로'); assert.equal(ro('드라이버'), '로'); assert.equal(ro('피칭 웨지'), '로'); assert.equal(ro('3번 우드'), '로'); assert.equal(ro('퍼터'), '로'); assert.equal(ro('발'), '로'); assert.equal(ro('샌드 웨지 56°'), '로');
});

test('말하기: 꺼져 있으면 안 말함(버튼은 force) · 같은 안내는 잠깐 동안 되풀이 안 함', async () => {
  const said = [];
  globalThis.window = { speechSynthesis: { cancel() {}, speak: u => said.push(u.text) } };
  globalThis.speechSynthesis = globalThis.window.speechSynthesis;
  globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; };
  configureVoice({ on: () => false, rate: () => 1 });
  assert.equal(await say('a'), false);
  assert.equal(await say('b', { force: true }), true);
  configureVoice({ on: () => true });
  assert.equal(await say('c', { key: 'k' }), true);
  assert.equal(await say('c', { key: 'k' }), false);
  assert.deepEqual(said, ['b', 'c']);
});
