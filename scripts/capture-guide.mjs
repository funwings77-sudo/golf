// 📘 사용자 가이드 화면 캡처: npm run guide:capture
//  scripts/guide-steps.mjs 순서대로 실제 앱을 헤드리스 크롬(휴대폰 크기)으로 열어 화면을 찍고, 번호 붙일 곳의 위치를 기록
//  → guide/img/<id>.jpg · guide/guide.json (관리자 페이지 📘 사용자 가이드가 읽음)
//  카메라는 직접 그린 페어웨이 그림(scripts/guide-camera.mjpeg) · 위치는 강남300 1번 홀 티 · 방향 센서는 가짜 값
//  크롬 경로: 환경 변수 CHROME (기본: Windows 기본 설치 경로)
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { META, SECTIONS, FAQ } from './guide-steps.mjs';

const ROOT = resolve(import.meta.dirname, '..'), OUT = join(ROOT, 'guide'), PORT = 8097, DBG = 9337;
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!CHROME) { console.error('✖ 크롬을 찾지 못했습니다. CHROME 환경 변수로 경로를 지정하세요'); process.exit(1); }
const ONLY = process.argv.slice(2); // 일부 화면만: npm run guide:capture -- gar gslope
const wait = ms => new Promise(r => setTimeout(r, ms));
const { w: W, h: H } = META.viewport, DPR = 1.5;
const TEE = { latitude: 37.38558, longitude: 127.17935 }; // 강남300 OUT 1번 티 근처

// 1) 정적 서버
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (q, s) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  try { const b = await readFile(join(ROOT, p)); s.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); s.end(b); } catch { s.writeHead(404); s.end(); }
}).listen(PORT);

// 2) 크롬 (새 프로필 · 가짜 카메라)
const prof = join(tmpdir(), 'pinpoint-guide-chrome'); await rm(prof, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${prof}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${join(ROOT, 'scripts', 'guide-camera.mjpeg')}`, '--no-first-run', '--lang=ko-KR', 'about:blank'], { stdio: 'ignore' });
let page; for (let i = 0; i < 40 && !page; i++) { await wait(250); page = await fetch(`http://127.0.0.1:${DBG}/json`).then(r => r.json()).then(t => t.find(x => x.type === 'page')).catch(() => null); }
if (!page) { console.error('✖ 크롬 디버깅 연결 실패'); chrome.kill(); server.close(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pend = new Map(), exc = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') exc.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n')[0]); };
await new Promise(r => (ws.onopen = r));
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
// 구글 지도 키(local.keys.json · 저장소에 없음)가 있으면 캡처 브라우저에만 넣어 진짜 구글 지도로 찍음 (그림·guide.json에는 키가 남지 않음)
let MAPS_KEY = process.env.PINPOINT_MAPS_KEY || ''; try { MAPS_KEY ||= JSON.parse(await readFile(join(ROOT, 'local.keys.json'), 'utf8')).mapsKey || ''; } catch {}
await send('Page.enable');
if (MAPS_KEY) await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!localStorage.getItem('pinpoint.mapsKey')) localStorage.setItem('pinpoint.mapsKey', ${JSON.stringify(MAPS_KEY)}); } catch {}` });
await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true });
await send('Emulation.setGeolocationOverride', { ...TEE, accuracy: 4 });
// 방향 센서: 1번 홀 그린 쪽(남동 140°)을 눈높이로 비춤 (alpha = 360 − 방위)
const ORI = `clearInterval(window.__o); window.__o = setInterval(() => { for (const t of ['deviceorientationabsolute', 'deviceorientation']) { const e = new Event(t); Object.assign(e, { alpha: 220, beta: ${Number(process.env.BETA || 79)}, gamma: 0, absolute: true }); window.dispatchEvent(e); } }, 60);`;
const BASE = `http://localhost:${PORT}/index.html?guide=${Date.now()}`;

// 번호 붙일 요소 찾기 (선택자 또는 화면 글자) → 화면 좌표(CSS px)
const FIND = `(${function (marks, H) {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return marks.map(m => {
    let el = null;
    if (m.sel) el = [...document.querySelectorAll(m.sel)].find(vis) || null;
    else if (m.find) {
      const scope = [...document.querySelectorAll(m.in || 'body')];
      const c = scope.flatMap(s => [s, ...s.querySelectorAll('*')]).filter(e => vis(e) && [].concat(m.find).every(t => (e.innerText || '').includes(t)));
      el = c.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.width * ra.height - rb.width * rb.height; })[0] || null;
      // 너무 작은 글자 조각이면 줄 단위로 넓힘 (버튼·줄 전체에 번호)
      if (el && !Array.isArray(m.find)) { const up = el.closest('button, a, label, .kv, .card, .row, li, tr, h1, h2, h3, section') ; if (up && up.getBoundingClientRect().height < 220) el = up; }
    }
    if (!el) return { miss: true };
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H) return { off: true };
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
}})`;

// 예열: 지도 화면을 한 번 열어 둠 → 구글이 키를 거부하면(지도 API 꺼짐 등) 이때 원래 지도로 정해져, 캡처 중간에 화면이 바뀌지 않음
if (MAPS_KEY) { await send('Page.navigate', { url: BASE + '#/distance' }); await wait(9000); console.log('🗺️ 지도: ' + ((await ev('window.L && window.L.__google ? "구글 지도" : "위성 사진 지도 (구글 지도 키 거부 또는 없음)"')) || '?')); }
await mkdir(join(OUT, 'img'), { recursive: true });
let old = null; try { old = JSON.parse(await readFile(join(OUT, 'guide.json'), 'utf8')); } catch {}
const oldScreens = new Map((old?.sections || []).flatMap(s => s.screens).map(s => [s.id, s]));
const sections = [];
let problems = 0, granted = false, seq = -1;
const lastBefore = SECTIONS.flatMap(s => s.screens).reduce((a, s, i) => (s.beforeGrant ? i : a), -1); // 권한 묻는 화면까지는 허용 전 상태로
for (const sec of SECTIONS) {
  const out = { ...sec, screens: [] };
  for (const sc of sec.screens) {
    seq++;
    if (ONLY.length && !ONLY.includes(sc.id)) { out.screens.push(oldScreens.get(sc.id) || { ...sc }); continue; }
    exc.length = 0;
    const g = sc.go || {};
    if (seq > lastBefore && !granted) { await send('Browser.grantPermissions', { origin: `http://localhost:${PORT}`, permissions: ['geolocation', 'videoCapture', 'audioCapture'] }); granted = true; }
    await send('Page.navigate', { url: 'about:blank' }); await wait(150);
    await send('Page.navigate', { url: BASE + (g.url || '#/home') }); await wait(g.wait ?? 3000); await ev(ORI);
    for (const j of g.js || []) { await ev(j); await wait(700); }
    if (g.after) await wait(g.after);
    for (const j of g.js2 || []) { await ev(j); await wait(1200); }
    await ev(`document.querySelectorAll('#sheet').forEach(s => { if (!s.classList.contains('open')) s.innerHTML = ''; })`);
    if (g.scroll) { await ev(`document.querySelector('${g.scroll}')?.scrollIntoView({ block: 'center' })`); await wait(500); }
    const pos = await ev(`${FIND}(${JSON.stringify(sc.marks || [])}, ${H})`);
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    await writeFile(join(OUT, 'img', `${sc.id}.jpg`), Buffer.from(shot.result.data, 'base64'));
    const marks = (sc.marks || []).map((m, i) => ({ t: m.t, d: m.d, ...pos[i] }));
    const bad = marks.filter(m => m.miss || m.off);
    for (const j of sc.post || []) { await ev(j); await wait(600); }
    if (bad.length || exc.length) problems++;
    console.log(`${bad.length || exc.length ? '⚠' : '✓'} ${sc.id}  번호 ${marks.length - bad.length}/${marks.length}${bad.length ? ' · 못 찾음: ' + bad.map(m => m.t + (m.off ? '(화면 밖)' : '')).join(', ') : ''}${exc.length ? ' · 오류: ' + exc.join(' | ') : ''}`);
    const { go, post, ...rest } = sc;
    out.screens.push({ ...rest, img: `guide/img/${sc.id}.jpg`, w: W, h: H, marks });
  }
  sections.push(out);
}
await writeFile(join(OUT, 'guide.json'), JSON.stringify({ meta: META, capturedAt: new Date().toISOString(), sections, faq: FAQ }, null, 1) + '\n');
console.log(`\n📘 guide/guide.json · 화면 ${sections.reduce((a, s) => a + s.screens.length, 0)}개${problems ? ` · 확인 필요 ${problems}개` : ''}`);
ws.close(); chrome.kill(); server.close();
setTimeout(() => process.exit(0), 300);
