// 오프라인 우선 서비스 워커: 앱 셸·물리 엔진은 캐시 우선, 지도 타일은 런타임 캐시
const VER = 'pinpoint-v73';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/theme.css', 'icons/icon.svg', 'icons/google-maps-logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'js/core/files.js',
  'js/app.js', 'js/ui.js', 'js/icons.js', 'js/iconize.js', 'js/canvasicon.js', 'js/core/screen.js', 'js/core/gmaps.js', 'js/core/mapskey.js', 'js/map.js',
  'js/core/geo.js', 'js/core/state.js', 'js/core/sensors.js', 'js/core/weather.js', 'js/core/camera.js', 'js/core/score.js', 'js/core/rules.js', 'js/core/course.js', 'js/core/holenote.js', 'js/core/remote.js', 'js/core/report.js', 'js/core/appver.js', 'js/core/appupdate.js', 'js/core/search.js', 'js/core/gemini.js', 'js/core/aicaddie.js', 'js/views/aisheet.js', 'js/core/offline.js', 'js/core/insights.js', 'js/core/depth.js', 'js/core/live.js', 'js/core/grip.js', 'js/core/watch.js', 'js/core/voice.js', 'js/core/terrain.js', 'js/physics/flight3d.js', 'js/core/horizon.js', 'js/core/fusion.js', 'js/core/balltrack.js',
  'js/physics/putt.js', 'js/physics/putt.worker.js', 'js/physics/flight.js', 'js/physics/strategy.js', 'js/physics/lostball.js',
  'js/views/home.js', 'js/views/play.js', 'js/views/view3d.js', 'js/views/arview.js', 'js/views/flagcam.js', 'js/physics/advice.js', 'js/physics/greenmesh.js', 'js/core/arproj.js', 'js/core/greenar.js', 'js/core/heading.js', 'js/physics/shotfit.js', 'js/views/shotviz.js', 'js/views/shots.js', 'js/views/lmform.js', 'js/views/lmimport.js', 'js/core/lmcsv.js', 'css/play.css', 'js/views/distance.js', 'js/views/tee.js', 'js/views/lost.js', 'js/views/green.js', 'js/views/greencanvas.js', 'js/views/green3d.js', 'js/views/lie.js', 'js/views/score.js',
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
  if (url.hostname.includes('open-meteo.com') || url.hostname === 'api.github.com' || url.hostname === 'generativelanguage.googleapis.com' || url.hostname === 'tile.googleapis.com') return; // 날씨·관리자·AI API와 구글 지도 타일(약관상 저장 안 함)은 항상 네트워크
  // APK·관리자 페이지·발행 데이터는 캐시하지 않음 (발행 데이터는 앱이 localStorage에 직접 보관)
  if (url.origin === location.origin && (/(\.apk|\/apk\.json|\/watch\.json|\/releases\.json|\/download\.html|\/admin\.html)$/.test(url.pathname) || /\/(data|js\/admin)\//.test(url.pathname))) return;
  if (url.hostname.includes('arcgisonline.com')) {
    e.respondWith(caches.open('pinpoint-tiles').then(async c => {
      // Leaflet(<img>, no-cors)이 저장한 불투명 응답은 3D 지도(fetch, cors)에 쓸 수 없음 → 다시 받아 교체
      const hit = await c.match(e.request); if (hit && !(e.request.mode === 'cors' && hit.type === 'opaque')) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }
  // 앱 파일: 네트워크 우선(업데이트 반영). 단 신호가 약해 3초 안에 안 오면 저장본으로 먼저 열고, 받아지면 저장본을 새로 바꿔 둠
  //  저장본도 없고 네트워크도 안 되면: 화면 이동만 첫 화면(index.html)으로, 그 밖의 파일은 504 (HTML을 JS로 주지 않게)
  e.respondWith((async () => {
    const net = fetch(e.request).then(r => {
      if (r.ok && (url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com')) { const cp = r.clone(); caches.open(VER).then(c => c.put(e.request, cp)); }
      return r;
    });
    const cached = await caches.match(e.request, { ignoreSearch: true });
    if (cached) return Promise.race([net.catch(() => cached), new Promise(res => setTimeout(() => res(cached), 3000))]);
    try { return await net; } catch { return e.request.mode === 'navigate' ? (await caches.match('index.html')) || new Response('', { status: 504 }) : new Response('', { status: 504 }); }
  })());
});
