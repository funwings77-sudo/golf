// 코스 데이터: 생성·데모·가져오기/내보내기
import { destination, bearing, distance } from './geo.js';
import { demoGreen } from '../physics/putt.js';
import { uid } from './state.js';

export function blankCourse(name = '새 코스', holes = 18) {
  const pars = holes === 9 ? [4, 4, 3, 5, 4, 4, 3, 4, 5] : [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  return { id: uid(), name, created: Date.now(), holes: pars.slice(0, holes).map((par, i) => ({ n: i + 1, par, hazards: [] })), shelters: [] };
}

// 가상 데모 코스 (실제 코스 아님): 기준점 주변에 4홀 배치 + 사전 측량 그린(가상)
export function demoCourse(base = { lat: 37.4419, lon: 127.0094 }) {
  const c = { id: uid(), name: '데모 코스 (가상)', created: Date.now(), demo: true, holes: [], shelters: [] };
  const specs = [
    { par: 4, len: 340, brg: 20, green: 'tier', hz: [[-0.55, 35, 'bunker', 14], [0.62, 22, 'water', 26], [0.2, -50, 'ob', 0]], ip: 0.65 },
    { par: 3, len: 150, brg: 110, green: 'saddle', hz: [[0.9, -14, 'bunker', 9], [0.93, 16, 'bunker', 8], [0.5, 0, 'water', 18]] },
    { par: 5, len: 470, brg: 200, green: 'mound', hz: [[0.45, 28, 'trees', 30], [0.42, -32, 'ob', 18], [0.8, -18, 'bunker', 12]], ip: 0.5 },
    { par: 4, len: 360, brg: 300, green: 'tier', hz: [[0.6, -26, 'bunker', 12], [0.6, 26, 'bunker', 12], [0.35, 45, 'ob', 22]], ip: 0.62 },
  ];
  let tee = base;
  specs.forEach((s, i) => {
    const green = destination(tee, s.brg, s.len);
    const h = { n: i + 1, par: s.par, tee, green, front: destination(green, s.brg + 180, 13), back: destination(green, s.brg, 13), hazards: [], halfWidth: 16 };
    if (s.ip) h.ip = destination(tee, s.brg + 2, s.len * s.ip);
    for (const [frac, off, type, r] of s.hz) {
      if (type === 'ob' && r === 0) continue;
      const along = destination(tee, s.brg, s.len * frac);
      const p = destination(along, s.brg + 90, off);
      h.hazards.push({ id: uid(), type, lat: p.lat, lon: p.lon, r });
    }
    h.pin = { ...destination(green, s.brg + 60, 4), ts: Date.now() };
    const g = demoGreen(s.green);
    g.y0 -= 12.5; // 그린 중앙을 원점에 맞춤
    h.greenGrid = { origin: { lat: green.lat, lon: green.lon }, grid: g, source: '데모(가상) 측량 그린' };
    c.holes.push(h);
    tee = destination(green, s.brg + 70, 40);
  });
  c.shelters.push({ id: uid(), name: '그늘집 (데모)', ...destination(base, 290, 60) });
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
