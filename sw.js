// 오프라인 우선 서비스 워커: 앱 셸·물리 엔진은 캐시 우선, 지도 타일은 런타임 캐시
const VER = 'pinpoint-v3';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/ui.js', 'js/map.js',
  'js/core/geo.js', 'js/core/state.js', 'js/core/sensors.js', 'js/core/weather.js', 'js/core/camera.js', 'js/core/score.js', 'js/core/rules.js', 'js/core/course.js',
  'js/physics/putt.js', 'js/physics/putt.worker.js', 'js/physics/flight.js', 'js/physics/strategy.js', 'js/physics/lostball.js',
  'js/views/home.js', 'js/views/distance.js', 'js/views/tee.js', 'js/views/lost.js', 'js/views/green.js', 'js/views/greencanvas.js', 'js/views/lie.js', 'js/views/score.js',
  'js/views/courses.js', 'js/views/bag.js', 'js/views/rules.js', 'js/views/safety.js', 'js/views/history.js', 'js/views/calib.js', 'js/views/settings.js', 'js/views/about.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => Promise.all(SHELL.map(u => c.add(u).catch(err => console.warn('cache miss', u, err))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER && k !== 'pinpoint-tiles').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.includes('open-meteo.com')) return; // 날씨는 항상 네트워크
  if (url.origin === location.origin && /(\.apk|\/apk\.json|\/download\.html)$/.test(url.pathname)) return; // APK 다운로드는 캐시하지 않음
  if (url.hostname.includes('arcgisonline.com')) {
    e.respondWith(caches.open('pinpoint-tiles').then(async c => {
      const hit = await c.match(e.request); if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }
  // 앱 파일: 네트워크 우선(업데이트 반영) → 실패 시 캐시 (오프라인)
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && (url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com')) { const cp = r.clone(); caches.open(VER).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
