// 📡 골프장 장비 실시간 연동: 홀마다 풍속계 · 낙구 지점 카메라
//  골프장(관리자 페이지 → 장비 연동)이 코스에 live = { url, devices: [...] } 를 적어 발행하면
//  앱이 라운드 중 30초마다 그 주소에서 아래 모양의 JSON을 읽음 (장비 업체가 이 모양으로 내보내 주면 됨)
//  {
//    "format": "pinpoint-live", "updatedAt": "2026-11-21T09:00:00+09:00",
//    "wind":  [{ "hole": 3, "speed": 4.2, "from": 270, "gust": 7.1, "ts": "…" }],   // m/s · 불어오는 방위(°, 북=0)
//    "balls": [{ "hole": 3, "lat": 37.1, "lon": 127.2, "ts": "…", "conf": 0.9 }]     // 카메라가 본 공 멈춘 곳
//  }
import { distance } from './geo.js';

export const LIVE_FORMAT = 'pinpoint-live';
export const WIND_MAX_AGE = 10 * 60 * 1000; // 10분 넘은 바람은 안 씀
const t = v => (typeof v === 'number' ? v : Date.parse(v));

// 받은 JSON 확인·정리 (이상한 값은 버림)
export function normalizeLive(j) {
  if (!j || typeof j !== 'object') throw new Error('JSON이 아니에요');
  if (j.format && j.format !== LIVE_FORMAT) throw new Error(`format이 '${LIVE_FORMAT}'이 아니에요`);
  const wind = (Array.isArray(j.wind) ? j.wind : []).map(w => ({ hole: +w.hole, speed: +w.speed, from: ((+w.from % 360) + 360) % 360, gust: w.gust == null ? null : +w.gust, ts: t(w.ts ?? j.updatedAt), device: w.device || null }))
    .filter(w => Number.isInteger(w.hole) && w.speed >= 0 && w.speed < 60 && Number.isFinite(w.from) && Number.isFinite(w.ts));
  const balls = (Array.isArray(j.balls) ? j.balls : []).map(b => ({ hole: +b.hole, lat: +b.lat, lon: +b.lon, ts: t(b.ts), conf: b.conf == null ? 0.8 : +b.conf, device: b.device || null }))
    .filter(b => Number.isInteger(b.hole) && Math.abs(b.lat) <= 90 && Math.abs(b.lon) <= 180 && Number.isFinite(b.ts));
  return { updatedAt: t(j.updatedAt) || Date.now(), wind, balls };
}

// 이 홀 바람: 그 홀 풍속계(가장 최근) · 없으면 null (그러면 날씨 예보 바람을 씀)
export function holeWind(live, holeN, now = Date.now()) {
  if (!live) return null;
  const w = live.wind.filter(x => x.hole === holeN && now - x.ts <= WIND_MAX_AGE).sort((a, b) => b.ts - a.ts)[0];
  return w ? { windSpeed: w.speed, windFrom: w.from, gust: w.gust, windSrc: 'course', ts: w.ts } : null;
}
// 예보 날씨에 홀 바람을 덮어씀 (기온·공기 밀도는 예보 그대로)
export function withHoleWind(weather, live, holeN, now = Date.now()) {
  const w = holeWind(live, holeN, now);
  return w ? { ...(weather || {}), ...w } : weather;
}

// 친 공과 카메라 낙구 맞추기: 같은 홀 · 친 뒤 3~90초 · 예상 구역 근처(반경 2.5×r80 + 25m) 중 가장 가까운 것
export function matchBall(live, shot, now = Date.now()) {
  if (!live || !shot?.pred) return null;
  const lim = 2.5 * (shot.r80 || 15) + 25;
  let best = null, bd = Infinity;
  for (const b of live.balls) {
    if (b.hole !== shot.hole || b.ts < shot.ts + 3000 || b.ts > shot.ts + 90000 || b.ts > now + 60000) continue;
    const d = distance(shot.pred, b);
    if (d <= lim && d < bd) { bd = d; best = b; }
  }
  return best ? { lat: best.lat, lon: best.lon, ts: best.ts, conf: best.conf, off: Math.round(bd) } : null;
}

// 관리자 페이지 '시험용 JSON 만들기': 장비 목록으로 예시 데이터
export function sampleLive(devices = [], now = Date.now()) {
  return {
    format: LIVE_FORMAT, updatedAt: new Date(now).toISOString(),
    wind: devices.filter(d => d.type === 'wind').map((d, i) => ({ hole: d.hole, device: d.id, speed: Math.round((2 + (i * 1.7) % 6) * 10) / 10, from: (200 + i * 35) % 360, gust: Math.round((4 + (i * 2.3) % 7) * 10) / 10, ts: new Date(now - 30000).toISOString() })),
    balls: devices.filter(d => d.type === 'camera' && Number.isFinite(d.lat)).map(d => ({ hole: d.hole, device: d.id, lat: d.lat, lon: d.lon, ts: new Date(now - 15000).toISOString(), conf: 0.9 })),
  };
}

// 앱: 주소에서 읽기 (8초 제한)
export async function fetchLive(url) {
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return normalizeLive(await r.json());
  } finally { clearTimeout(to); }
}
