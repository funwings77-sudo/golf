// 🏷️ 앱 아이콘 만들기: 브랜드 마크(위치 핀 + 골프 깃발, js/icons.js의 'brand'와 같은 모양)로
//   웹(파비콘·PWA) · 안드로이드 런처(보통·둥근·적응형 앞그림) · 시작 화면(splash)을 한 번에 다시 그림
//   node scripts/make-icons.mjs        (크롬으로 SVG를 PNG로 그림 · 크롬 경로는 CHROME 환경변수로 바꿀 수 있음)
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(root, 'android', 'app', 'src', 'main', 'res');
const BG = '#1F5F3F', LIME = '#C8F169', INK = '#14241C', SHADE = 'rgba(0,0,0,.22)';

// 브랜드 마크 (24 격자 기준 모양을 cx,cy 가운데에 크기 s배로)
const mark = (cx, cy, s) => `
  <ellipse cx="${cx}" cy="${cy + s * 10.4}" rx="${s * 3.6}" ry="${s * 0.9}" fill="${SHADE}"/>
  <g transform="translate(${cx} ${cy}) scale(${s}) translate(-12 -12.1)">
    <path d="M12 22s-7.5-6.6-7.5-12.3a7.5 7.5 0 0115 0C19.5 15.4 12 22 12 22z" fill="${LIME}"/>
    <path d="M10.3 5.2l4.6 1.8-4.6 1.8z" fill="${INK}"/>
    <path d="M10.3 14.5V5.2M8.6 14.5h3.4" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" fill="none"/>
  </g>`;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

// 모양별 그림 (n = 한 변 픽셀)
const ICON = {
  rounded: n => svg(n, n, `<rect width="${n}" height="${n}" rx="${n * 0.22}" fill="${BG}"/>${mark(n / 2, n * 0.48, n * 0.0315)}`), // 파비콘·옛 런처
  square: n => svg(n, n, `<rect width="${n}" height="${n}" fill="${BG}"/>${mark(n / 2, n * 0.48, n * 0.026)}`),                   // PWA maskable (가운데 80% 안)
  round: n => svg(n, n, `<circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}" fill="${BG}"/>${mark(n / 2, n * 0.48, n * 0.029)}`),
  fore: n => svg(n, n, mark(n / 2, n * 0.48, n * 0.0225)),                                                                       // 적응형 앞그림 (안전 영역 66/108 안)
};
const splash = (w, h) => svg(w, h, `<rect width="${w}" height="${h}" fill="${BG}"/>${mark(w / 2, h / 2, Math.min(w, h) * 0.0105)}`);

const jobs = [];
const out = (path, w, h, markup) => jobs.push({ path, w, h, markup });
await writeFile(join(root, 'icons', 'icon.svg'), ICON.rounded(512) + '\n');
out(join(root, 'icons', 'icon-192.png'), 192, 192, ICON.square(192));
out(join(root, 'icons', 'icon-512.png'), 512, 512, ICON.square(512));
for (const [d, n] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  out(join(RES, `mipmap-${d}`, 'ic_launcher.png'), n, n, ICON.rounded(n));
  out(join(RES, `mipmap-${d}`, 'ic_launcher_round.png'), n, n, ICON.round(n));
  const f = Math.round(n * 108 / 48);
  out(join(RES, `mipmap-${d}`, 'ic_launcher_foreground.png'), f, f, ICON.fore(f));
}
const SPL = { 'drawable': [480, 320], 'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720], 'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920] };
for (const [d, [w, h]] of Object.entries(SPL)) out(join(RES, d, 'splash.png'), w, h, splash(w, h));

// 크롬(헤드리스)으로 그리기: 배경 투명 · 정확한 픽셀 크기
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!CHROME) throw new Error('크롬을 찾지 못했어요 · CHROME 환경변수로 경로를 알려 주세요');
const prof = await mkdtemp(join(tmpdir(), 'pp-icons-')), port = 9400 + Math.floor(Math.random() * 400);
const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  let tabs; for (let i = 0; i < 50 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await wait(200); } }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  await new Promise(r => (ws.onopen = r));
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const j of jobs) {
    await send('Emulation.setDeviceMetricsOverride', { width: j.w, height: j.h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${j.markup}`) });
    await wait(120);
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: j.w, height: j.h, scale: 1 } });
    await writeFile(j.path, Buffer.from(r.result.data, 'base64'));
  }
  ws.close();
  console.log(`아이콘 ${jobs.length + 1}개를 새로 그렸어요 (icons/ · android res/mipmap-* · drawable*/splash.png)`);
} finally { ch.kill(); await wait(300); await rm(prof, { recursive: true, force: true }).catch(() => {}); }
