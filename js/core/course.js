// 코스 데이터: 생성·데모·가져오기/내보내기
import { destination, bearing, distance } from './geo.js';
import { demoGreen } from '../physics/putt.js';
import { uid } from './state.js';

export function blankCourse(name = '새 코스', holes = 18) {
  const pars = holes === 9 ? [4, 4, 3, 5, 4, 4, 3, 4, 5] : [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  return { id: uid(), name, created: Date.now(), holes: pars.slice(0, holes).map((par, i) => ({ n: i + 1, par, hazards: [] })), shelters: [] };
}

// 가상 테스트 코스 (실제 코스 아님): 9홀 · 스코어카드(티 4종) · 핸디캡 · 해저드 · 측량 그린(가상)
//  scale 1 = 실제 크기, walk = 걸어서 테스트용(약 1/4 크기, 1번 티 = 지금 내 위치)
const DEMO_HOLES = [
  { par: 4, len: 340, brg: 20, green: 'tier', hdcp: 5, note: '오른쪽 물 · 왼쪽 벙커 사이로 페어웨이 중앙', hz: [[-0.55, 35, 'bunker', 14], [0.62, 22, 'water', 26], [0.92, -16, 'bunker', 8]], ip: 0.65 },
  { par: 3, len: 150, brg: 110, green: 'saddle', hdcp: 17, note: '그린 앞 연못 · 짧으면 물', hz: [[0.9, -14, 'bunker', 9], [0.93, 16, 'bunker', 8], [0.5, 0, 'water', 18]] },
  { par: 5, len: 470, brg: 200, green: 'mound', hdcp: 3, note: '왼쪽 OB · 두 번째 샷은 오른쪽 숲 앞까지 끊어 가기', hz: [[0.45, 28, 'trees', 30], [0.42, -32, 'ob', 18], [0.8, -18, 'bunker', 12]], ip: 0.5 },
  { par: 4, len: 360, brg: 300, green: 'tier', hdcp: 1, note: '가장 어려운 홀 · 양쪽 벙커 · 2단 그린', hz: [[0.6, -26, 'bunker', 12], [0.6, 26, 'bunker', 12], [0.35, 45, 'ob', 22]], ip: 0.62 },
  { par: 4, len: 310, brg: 15, green: 'saddle', hdcp: 13, note: '짧은 파4 · 그린 앞 크로스 벙커', hz: [[0.78, 0, 'bunker', 10], [0.4, -30, 'trees', 22]], ip: 0.7 },
  { par: 3, len: 175, brg: 95, green: 'mound', hdcp: 15, note: '긴 파3 · 그린 오른쪽 물', hz: [[0.95, 22, 'water', 16], [0.97, -15, 'bunker', 8]] },
  { par: 4, len: 380, brg: 185, green: 'tier', hdcp: 7, note: '오른쪽 도그렉 · 티샷은 왼쪽 벙커 오른쪽', hz: [[0.55, -24, 'bunker', 13], [0.55, 34, 'trees', 26], [0.9, 18, 'bunker', 9]], ip: 0.6 },
  { par: 5, len: 500, brg: 270, green: 'saddle', hdcp: 9, note: '투온 노리면 그린 앞 물 · 세 번에 끊어 가기', hz: [[0.88, 0, 'water', 22], [0.5, -34, 'ob', 20], [0.3, 28, 'bunker', 12]], ip: 0.52 },
  { par: 4, len: 395, brg: 0, green: 'mound', hdcp: 11, note: '마지막 홀 · 왼쪽 물 길게 · 그린 뒤 OB', hz: [[0.55, -30, 'water', 28], [0.6, 26, 'bunker', 12], [1.12, 0, 'ob', 15]], ip: 0.6 },
];
export function demoCourse(base = { lat: 37.4419, lon: 127.0094 }, { walk = false, holes = 9 } = {}) {
  const k = walk ? 0.25 : 1;
  const c = { id: uid(), name: walk ? '걸어서 테스트 코스 (가상)' : '테스트 골프장 9홀 (가상)', created: Date.now(), demo: true, walk, holes: [], shelters: [] };
  let tee = base;
  DEMO_HOLES.slice(0, holes).forEach((s, i) => {
    const len = s.len * k, green = destination(tee, s.brg, len), gr = walk ? 8 : 13;
    const h = { n: i + 1, par: s.par, tee, green, front: destination(green, s.brg + 180, gr), back: destination(green, s.brg, gr), hazards: [], halfWidth: 16 * (walk ? 0.6 : 1), hdcp: s.hdcp, note: s.note };
    h.scorecard = { unit: 'm', back: Math.round(len * 1.06), blue: Math.round(len), white: Math.round(len * 0.93), red: Math.round(len * 0.82) };
    if (s.ip) h.ip = destination(tee, s.brg + 2, len * s.ip);
    for (const [frac, off, type, r] of s.hz) {
      const along = destination(tee, s.brg, len * frac);
      const p = destination(along, s.brg + 90, off * (walk ? 0.5 : 1));
      h.hazards.push({ id: uid(), type, lat: p.lat, lon: p.lon, r: r * (walk ? 0.5 : 1) });
    }
    h.pin = { ...destination(green, s.brg + 60 + i * 37, walk ? 2 : 4), ts: Date.now(), src: 'demo' };
    const g = demoGreen(s.green);
    g.y0 -= 12.5; // 그린 중앙을 원점에 맞춤
    h.greenGrid = { origin: { lat: green.lat, lon: green.lon }, grid: g, source: '데모(가상) 측량 그린' };
    c.holes.push(h);
    tee = destination(green, s.brg + 70, 40 * k);
  });
  c.center = { lat: c.holes.reduce((a, h) => a + h.green.lat, 0) / c.holes.length, lon: c.holes.reduce((a, h) => a + h.green.lon, 0) / c.holes.length };
  c.shelters.push({ id: uid(), name: '그늘집 (데모)', ...destination(c.holes[Math.min(4, c.holes.length - 1)].tee, 250, 30 * k) });
  return c;
}

export function exportCourse(c) {
  return JSON.stringify({ format: 'pinpoint-course', version: 1, course: c });
}
export function importCourse(text) {
  const j = JSON.parse(text);
  const c = j.format === 'pinpoint-course' ? j.course : j;
  if (!c || !Array.isArray(c.holes)) throw new Error('코스 형식이 아닙니다');
  for (const h of c.holes) {
    if (typeof h.n !== 'number' || typeof h.par !== 'number') throw new Error('홀 번호/파 누락');
    h.hazards = (h.hazards || []).filter(z => ['ob', 'water', 'bunker', 'trees'].includes(z.type) && isFinite(z.lat) && isFinite(z.lon) && z.r > 0);
  }
  return { ...c, id: uid(), shelters: c.shelters || [] };
}

export function holeLength(h) { return h.tee && h.green ? distance(h.tee, h.green) : null; }
export function holeBearing(h) { return h.tee && h.green ? bearing(h.tee, h.green) : null; }
// 가까운 다음 홀 티 감지 (자동 홀 전환)
export function detectHoleByTee(course, pos, current) {
  for (const h of course.holes) {
    if (h.n === current || !h.tee) continue;
    if (distance(h.tee, pos) < 22) return h.n;
  }
  return null;
}

// ⏱️ 머무름 판정 (내비의 '측위가 한 번 튀었다고 바로 재탐색하지 않음'): 같은 곳이 n번 이상 · ms 이상 이어져야 확정
//  cand: 이전 상태(없으면 null) · key: 무엇에 대한 판정인지(예: 다음 홀 번호) · inside: 이번 위치가 조건 안인지
//  → { cand: 다음 상태, fire: 확정됐는지 }
export function dwell(cand, key, inside, now, { n = 3, ms = 5000 } = {}) {
  if (!inside) return { cand: cand?.key === key ? null : cand, fire: false };
  const c = cand?.key === key ? { ...cand, k: cand.k + 1 } : { key, t: now, k: 1 };
  if (c.k >= n && now - c.t >= ms) return { cand: null, fire: true };
  return { cand: c, fire: false };
}
