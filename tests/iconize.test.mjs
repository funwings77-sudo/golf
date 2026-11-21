// 본문 버튼 이모지 → 아이콘: 이모지 찾기 규칙과 아이콘 표가 맞는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { RE, EMOJI_ICON } from '../js/iconize.js';
import { ICON_NAMES } from '../js/icons.js';

const swap = s => s.replace(RE, (_, e) => `[${EMOJI_ICON[e]}]`);

test('표의 모든 이모지가 실제 있는 아이콘을 가리킴', () => {
  for (const [e, n] of Object.entries(EMOJI_ICON)) assert.ok(ICON_NAMES.includes(n), `${e} → ${n} 없음`);
});

test('변형 선택자(️)·성별 조합까지 한 덩어리로 바꾸고, 표에 없는 기호는 그대로', () => {
  assert.equal(swap('🏌️ 골프 치러 가기'), '[golfer] 골프 치러 가기');
  assert.equal(swap('🏌️‍♂️ 스윙'), '[golfer] 스윙');
  assert.equal(swap('🗺️ 코스 만들기'), '[map] 코스 만들기');
  assert.equal(swap('⚖️ 규칙'), '[scale] 규칙');
  assert.equal(swap('ℹ️ 정보'), '[info] 정보');
  assert.equal(swap('📍 여기서 쳤어요'), '[pin] 여기서 쳤어요');
  assert.equal(swap('▶ 공 날려 보기'), '[playtri] 공 날려 보기');
  assert.equal(swap('🐢 느려요 · 🙂 보통 · 🐇 빨라요'), '[slow] 느려요 · [smile] 보통 · [fast] 빨라요');
  assert.equal(swap('😊 친선'), '[smile] 친선'); assert.equal(swap('🏆 대회'), '[trophy] 대회'); assert.equal(swap('☀️'), '[sun]');
  assert.equal(swap('✕ 닫기'), '✕ 닫기');
  assert.equal(swap('⬆0.3m · ⬇0.2m'), '⬆0.3m · ⬇0.2m'); // 높낮이 화살표는 그대로
  assert.equal(swap('⚠️ 낙뢰 · 💧 물 · ⌚ 워치'), '[warn] 낙뢰 · [drop] 물 · [watch] 워치');
  assert.equal(swap('‹ 목록'), '‹ 목록');
  assert.equal(swap('3번 홀 7타'), '3번 홀 7타');
});
