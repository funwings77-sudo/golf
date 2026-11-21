// 골프장 공략 메모(h.note): 코스 DB에서 온 '홀별 공략 텍스트 미수집' 같은 자리 채움 문장은 없는 것으로
//  · 골퍼 화면(홀 정보 · 티샷)과 AI 캐디에 빈 문장이 가지 않게 · 관리자 '앱 준비도'도 같은 기준
export const PLACEHOLDER_NOTE = /미수집|자료 없음|정보 없음|^(없음|-|—|\.)$/;
export function holeNote(h) {
  const t = String(h?.note ?? '').trim();
  return t && !PLACEHOLDER_NOTE.test(t) ? t : '';
}
