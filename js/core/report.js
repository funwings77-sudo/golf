// 골프장 제출용 라운드 리포트 (비식별): 내 스코어 · 홀 도착 시각 · 분실구 지점만 포함
//  · 동반자 이름·스코어, 이동 경로, 기기 정보는 넣지 않음
//  · 분실구 좌표는 소수 5자리(약 1m)로 반올림
export const REPORT_FORMAT = 'pinpoint-round-report';

const r5 = v => Math.round(v * 1e5) / 1e5;
const dateKey = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

export function buildRoundReport(round, course = null) {
  const start = Date.parse(round.startedAt || round.date);
  const times = round.holeTimes || {};
  const holes = round.holes.map(h => {
    const sc = h.scores[0] || {};
    const at = times[h.n];
    return {
      n: h.n, par: h.par, strokes: sc.strokes || 0, putts: sc.putts || 0, penalties: sc.penalties || 0, lost: sc.lost || 0,
      ...(Number.isFinite(at) && Number.isFinite(start) ? { arrivedAt: Math.max(0, at - start) } : {}),
    };
  });
  return {
    format: REPORT_FORMAT, version: 1,
    reportId: `${round.id}-${(round.endedAt || '').replace(/\D/g, '').slice(0, 14)}`,
    courseId: course?.official?.id || round.officialId || null, courseRev: course?.official?.rev ?? null, courseName: round.courseName,
    date: dateKey(round.startedAt || round.date), mode: round.mode,
    startedAt: round.startedAt || round.date, endedAt: round.endedAt || null,
    holes,
    lost: (round.lostEvents || []).map(e => ({ hole: e.hole, lat: r5(e.lat), lon: r5(e.lon), found: !!e.found, searchSec: e.searchSec ?? null, penalty: e.penalty ?? 0 })),
  };
}
