// 개발용 정적 서버: node server.mjs [port]  →  http://localhost:8080
// 휴대폰 센서·카메라·GPS는 HTTPS(또는 localhost)에서만 동작합니다. 실제 기기 테스트는 HTTPS 호스팅을 쓰세요.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const port = +process.argv[2] || 8080;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
    if (p.includes('..')) throw new Error('bad path');
    let f = join(root, p || 'index.html');
    if ((await stat(f)).isDirectory()) f = join(f, 'index.html');
    const body = await readFile(f);
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(port, () => console.log(`PinPoint: http://localhost:${port}`));
