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
// 🗺️ 앱에 기본으로 넣는 구글 지도 키: local.keys.json(Git 제외) 또는 환경변수 PINPOINT_MAPS_KEY → 빌드 복사본에만
{
  let mapsKey = process.env.PINPOINT_MAPS_KEY || '';
  try { mapsKey ||= JSON.parse(await readFile(join(root, 'local.keys.json'), 'utf8')).mapsKey || ''; } catch {}
  if (mapsKey) {
    if (!/^[A-Za-z0-9_-]{20,60}$/.test(mapsKey)) throw new Error('local.keys.json의 mapsKey 모양이 이상합니다');
    await writeFile(join(out, 'js', 'core', 'mapskey.js'), `// 빌드 때 넣은 키 (저장소에는 없음)
export const BUILT_IN_MAPS_KEY = '${mapsKey}';
`);
    console.log('🗺️ 구글 지도 키를 앱에 넣었어요 (…' + mapsKey.slice(-4) + ')');
  } else console.log('🗺️ 구글 지도 키 없음 → 앱 지도는 Esri (설정에서 넣을 수 있음)');
}
console.log('www/ 준비 완료');
