// 골프장 지도 미리 받기 (오프라인): 각 홀 티~그린 주변 위성 타일을 휴대폰에 저장
// 받은 타일은 서비스 워커의 'pinpoint-tiles' 캐시에 들어가 신호가 없어도 지도가 보입니다.
import { SAT_URL } from '../map.js';
import { distance, destination, bearing } from './geo.js';

const tileXY = (lat, lon, z) => {
  const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n);
  const r = lat * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return [x, y];
};

// 홀별 상자(티·그린·해저드 + 여유 60m)
function holeBoxes(course) {
  const out = [];
  for (const h of course.holes || []) {
    const pts = [h.tee, h.green, h.pin, h.front, h.back, ...(h.hazards || [])].filter(p => p && Number.isFinite(p.lat));
    if (!pts.length) continue;
    if (pts.length === 1) { const p = pts[0]; pts.push(destination(p, 0, 120), destination(p, 180, 120)); }
    const pad = [];
    for (const p of pts) for (const b of [0, 90, 180, 270]) pad.push(destination(p, b, 60));
    out.push({ s: Math.min(...pad.map(p => p.lat)), n: Math.max(...pad.map(p => p.lat)), w: Math.min(...pad.map(p => p.lon)), e: Math.max(...pad.map(p => p.lon)) });
  }
  return out;
}

export function courseTiles(course, zooms = [15, 16, 17, 18]) {
  const set = new Set();
  for (const b of holeBoxes(course)) for (const z of zooms) {
    const [x0, y0] = tileXY(b.n, b.w, z), [x1, y1] = tileXY(b.s, b.e, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set.add(SAT_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  }
  return [...set];
}

export async function prefetchCourse(course, onProgress = () => {}) {
  const urls = courseTiles(course);
  if (!urls.length) return { total: 0, ok: 0, note: '그린·티 위치가 있는 홀이 없어요' };
  const cache = 'caches' in self ? await caches.open('pinpoint-tiles') : null;
  let ok = 0, done = 0, i = 0;
  const work = async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try {
        const hit = cache ? await cache.match(u) : null;
        if (hit && !(hit.type === 'opaque' && window.Capacitor?.isNativePlatform?.())) ok++; // 앱에서는 예전에 읽을 수 없게 받은 타일은 다시 받음
        else {
          // 읽을 수 있는 응답(CORS)으로 저장해야 앱(APK)의 지도가 꺼내 쓸 수 있음. 안 되면 웹(서비스 워커)용으로만
          let r = null; try { r = await fetch(u, { mode: 'cors' }); } catch {}
          if (r?.ok) { if (cache) await cache.put(u, r.clone()); ok++; }
          else if (!window.Capacitor?.isNativePlatform?.()) { r = await fetch(u, { mode: 'no-cors' }); if (cache && r.type === 'opaque') { await cache.put(u, r.clone()); ok++; } }
        }
      } catch {}
      done++; if (done % 10 === 0 || done === urls.length) onProgress(done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, work));
  const mb = (urls.length * 22 / 1024).toFixed(1); // 타일 1장 평균 약 22KB
  try { localStorage.setItem('pinpoint.offline.' + course.id, JSON.stringify({ ts: Date.now(), n: ok })); } catch {}
  return { total: urls.length, ok, mb };
}

export function offlineInfo(course) {
  try { return JSON.parse(localStorage.getItem('pinpoint.offline.' + course.id) || 'null'); } catch { return null; }
}
void distance; void bearing;
