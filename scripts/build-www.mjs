// Android(Capacitor)용 웹 자산 복사: 웹앱 파일 → www/, Leaflet을 CDN 대신 로컬 번들로 교체(오프라인 실행)
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons']) {
  await cp(join(root, f), join(out, f), { recursive: true });
}
// 처음 실행 때 인터넷이 약해도 골프장 목록이 보이도록 목록 파일 2개를 앱에 함께 넣음 (코스 상세는 받아서)
await mkdir(join(out, 'data'), { recursive: true });
for (const f of ['clubs.json', 'catalog.json']) await cp(join(root, 'data', f), join(out, 'data', f));
const lf = join(root, 'node_modules', 'leaflet', 'dist');
await cp(lf, join(out, 'vendor', 'leaflet'), { recursive: true });

const idx = join(out, 'index.html');
let html = await readFile(idx, 'utf8');
const css = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const js = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
if (!html.includes(css) || !html.includes(js)) throw new Error('index.html의 Leaflet CDN 경로를 찾지 못했습니다');
html = html.replace(css, 'vendor/leaflet/leaflet.css').replace(js, 'vendor/leaflet/leaflet.js');
await writeFile(idx, html);
console.log('www/ 준비 완료');
