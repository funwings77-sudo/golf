// 📱 앱 준비도: 사용자 앱의 각 화면이 어떤 코스 데이터를 쓰는지(사용자 페이지 분석 결과)를 기준으로
//   발행된 코스가 골퍼에게 어떻게 보일지 점검 (DOM 없음 → node --test로 검증)
//   · 홀 항목: 그린 위치 · 티 위치 · 그린 앞뒤 · 오늘 핀 · 스코어카드 · 그린 경사 지도 · 해저드 · 공략 메모
//   · 코스 항목: 그린 빠르기 · 낙뢰 대피소 · 로컬 룰 · 연락처 · 실시간 장비(선택)
import { holeNote } from '../core/holenote.js';
const isLL = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
export const holeLabel = h => (h.nine ? `${h.nine} ${h.nineHole ?? h.n}번` : `${h.n}번`);
export const holeHdcp = h => h.hdcpNine ?? h.hdcp ?? h.hdcpCard ?? null;
// KGBA DB의 '미수집' 같은 자리 채움 문장은 메모로 보지 않음 (골퍼 앱과 같은 기준)
export const realNote = holeNote;
const pinOn = (pins, today, n) => (pins?.date === today && isLL(pins.holes?.[n]) ? pins.holes[n] : null);

// w: 골퍼에게 미치는 영향(가중치) · fix: 고치는 관리자 화면 · miss: 없으면 앱에서 어떻게 되는지
export const READY_FEATURES = [
  { key: 'green', scope: 'hole', w: 5, fix: 'course', icon: '⛳', label: '그린 위치', uses: '거리 화면 · 골프 치기 카메라(AR) · 공 찾기 지도 · 다음 홀 자동 전환', miss: '골퍼가 첫 라운드에 지도에서 그린을 직접 눌러야 거리 안내가 시작돼요', has: h => isLL(h.green) },
  { key: 'tee', scope: 'hole', w: 3, fix: 'course', icon: '🏌️', label: '티 위치', uses: '티샷 공략 · 클럽 추천 · 티 도착 시 홀 자동 전환 · 홀 길이 음성 안내', miss: '첫 샷 위치로 대신 배워서 정확도가 떨어져요', has: h => isLL(h.tee) },
  { key: 'pin', scope: 'hole', w: 3, fix: 'pins', icon: '📍', label: '오늘의 핀', uses: '핀까지 거리 · 그린 AR의 홀 위치 · 퍼팅 계산', miss: '그린 중앙까지 거리로 안내해요 (핀 위치만큼 오차)', has: (h, ctx) => !!pinOn(ctx.pins, ctx.today, h.n) },
  { key: 'card', scope: 'hole', w: 2, fix: 'course', icon: '📋', label: '파 · 핸디캡', uses: '홀 정보 · 음성 홀 소개 · 쉬운/어려운 홀 표시 · 스코어 카드', miss: '어려운 홀 경고와 홀 소개가 빠져요', has: h => [3, 4, 5, 6].includes(h.par) && holeHdcp(h) != null },
  { key: 'depth', scope: 'hole', w: 2, fix: 'course', icon: '↕️', label: '그린 앞 · 뒤', uses: '앞 · 중앙 · 뒤 거리 · 핀 시트 입력 정확도', miss: '그린을 반지름 14m 원으로 가정해 앞·뒤 거리가 어림값이에요', has: h => isLL(h.front) && isLL(h.back) },
  { key: 'grid', scope: 'hole', w: 2, fix: 'greens', icon: '🟢', label: '그린 경사 지도', uses: '그린 ② 그린 지도 · AR 등고선·능선 · 퍼팅 라인', miss: '골퍼가 현장에서 직접 재야 경사가 나와요 (안 재면 평지로 계산)', has: h => !!h.greenGrid?.grid },
  { key: 'hazard', scope: 'hole', w: 1, fix: 'course', icon: '⚠️', label: '해저드', uses: '카메라 화면 노란 경고 · 티샷 위험 회피 · 앞으로 나올 곳 목록', miss: 'OB·물·벙커 경고가 나오지 않아요', has: h => (h.hazards || []).length > 0 },
  { key: 'note', scope: 'hole', w: 1, fix: 'course', icon: '📝', label: '공략 메모', uses: '골프 치기 홀 정보 · AI 캐디 조언', miss: '골프장 공략 설명 없이 일반 조언만 나와요', has: h => !!realNote(h) },
  { key: 'stimp', scope: 'course', w: 1, fix: 'pins', icon: '💨', label: '그린 빠르기', uses: '퍼팅 세기 · 굴릴 방향 계산', miss: '보통 빠르기(10)로 계산해요', has: (c, ctx) => (ctx.pins?.date === ctx.today && ctx.pins.stimp) || c.defaultStimp ? 1 : 0 },
  { key: 'shelter', scope: 'course', w: 2, fix: 'course', icon: '⚡', label: '낙뢰 대피소', uses: '낙뢰·안전 공지 때 가까운 대피소 안내', miss: '낙뢰 때 대피할 곳을 알려 주지 못해요', has: c => ((c.shelters || []).filter(isLL).length ? 1 : 0) },
  { key: 'rules', scope: 'course', w: 1, fix: 'course', icon: '📖', label: '로컬 룰', uses: '룰 화면의 이 골프장 로컬 룰', miss: '일반 골프 규칙만 보여요', has: c => ((c.localRules || []).length ? 1 : 0) },
  { key: 'contact', scope: 'course', w: 1, fix: 'course', icon: '📞', label: '연락처', uses: '골프장 정보의 전화 · 홈페이지 버튼', miss: '전화·홈페이지 버튼이 없어요', has: c => (c.phone || c.info?.homepage || c.homepage ? 1 : 0) },
  { key: 'live', scope: 'course', w: 0, fix: 'devices', icon: '📡', label: '실시간 장비 (선택)', uses: '홀 풍속계 바람 · 낙구 카메라로 공 찾기', miss: '날씨 예보 바람으로 계산해요', has: c => (c.live?.url ? 1 : 0) },
];

export function courseReadiness(c, pins = null, today = '') {
  const ctx = { pins, today }, holes = c?.holes || [];
  const features = READY_FEATURES.map(f => {
    const total = f.scope === 'hole' ? holes.length : 1;
    const have = f.scope === 'hole' ? holes.filter(h => f.has(h, ctx)).length : f.has(c, ctx);
    const pct = total ? have / total : 0;
    return { ...f, have, total, pct, level: pct >= 0.999 ? 'ok' : pct > 0 ? 'part' : 'none' };
  });
  const W = features.reduce((a, f) => a + f.w, 0);
  const score = Math.round((100 * features.reduce((a, f) => a + f.w * f.pct, 0)) / (W || 1));
  // 먼저 할 일: 영향(가중치 × 빠진 비율)이 큰 순서
  const todo = features.filter(f => f.w && f.level !== 'ok').map(f => ({ ...f, impact: f.w * (1 - f.pct) })).sort((a, b) => b.impact - a.impact);
  const holeRows = holes.map(h => ({ n: h.n, label: holeLabel(h), par: h.par, has: Object.fromEntries(features.filter(f => f.scope === 'hole').map(f => [f.key, !!f.has(h, ctx)])) }));
  return { score, features, todo, holes: holeRows, grade: score >= 85 ? 'ok' : score >= 50 ? 'part' : 'none' };
}

// 골퍼 앱에서 이 홀이 어떻게 보이는지 (골프 치기 화면 · 그린 화면 기준)
export function holePreview(c, h, pins = null, today = '') {
  const pin = pinOn(pins, today, h.n), sc = h.scorecard, unit = sc?.unit === 'yd' ? 'yd' : 'm';
  const len = sc ? [['백', sc.back], ['블루', sc.blue], ['화이트', sc.white], ['레드', sc.red]].filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}${unit}`) : [];
  const hz = (h.hazards || []).reduce((m, z) => ((m[z.type] = (m[z.type] || 0) + 1), m), {});
  const HZ = { ob: 'OB', water: '물', bunker: '벙커', trees: '나무' };
  return {
    title: `${c.name} · ${holeLabel(h)} 홀`, par: h.par, hdcp: holeHdcp(h), len,
    distance: isLL(h.green) ? (pin ? '핀까지 거리 안내 (오늘 핀 기준)' : '그린 중앙까지 거리 안내') + (isLL(h.front) && isLL(h.back) ? ' · 앞/뒤 거리 함께' : '')
      : '⚠ 그린 위치가 없어요 → 골퍼에게 "지도에서 그린을 눌러 주세요"가 먼저 떠요',
    tee: isLL(h.tee) ? '티에 오면 이 홀로 자동 전환 · 티샷 공략 표시' : '티 위치 없음 → 첫 샷 위치로 대신 배움',
    hazards: Object.entries(hz).map(([k, v]) => `${HZ[k] || k}${v > 1 ? ' ' + v : ''}`),
    note: realNote(h),
    green: h.greenGrid?.grid ? '그린 지도 · AR 등고선이 바로 나와요' : '그린 화면: 직접 재기 + 카메라로 보기 (경사는 골퍼가 현장에서 재요)',
    stimp: (pins?.date === today && pins.stimp) || c.defaultStimp || 10,
  };
}
