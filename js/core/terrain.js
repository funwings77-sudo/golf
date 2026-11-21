// ⛰️ 지형 높이: 카메라 화면에 '입체 지도'를 그리려고 땅 높이를 읽음
//  Terrarium 고도 타일 (3D 지도와 같은 원천 · z15 ≈ 4m 화소) → 높이 = R·256 + G + B/256 − 32768 (m)
//  그린 측량 격자(greenGrid)가 있으면 그린 안은 그 높이(cm 정밀)를 씀 — 그린 가운데 지형 높이에 맞춰 붙임
import { toLocal } from './geo.js';

export const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const ZOOM = 15;

export const decodeTerrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;
// 위도·경도 → 타일 번호와 타일 안 화소 위치 (웹 메르카토르)
export function tileXY(lat, lon, z = ZOOM) {
  const n = 2 ** z, x = (lon + 180) / 360 * n, s = Math.sin(lat * Math.PI / 180), y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { tx: Math.floor(x), ty: Math.floor(y), px: (x - Math.floor(x)) * 256, py: (y - Math.floor(y)) * 256 };
}

// 높이 읽개: tiles = Map('x/y' → Float32Array(256*256)), 화소 사이는 쌍선형 보간
export function makeSampler(tiles, z = ZOOM) {
  const px = (tx, ty, i, j) => {
    if (i < 0) { tx--; i += 256; } else if (i > 255) { tx++; i -= 256; }
    if (j < 0) { ty--; j += 256; } else if (j > 255) { ty++; j -= 256; }
    const t = tiles.get(tx + '/' + ty); return t ? t[j * 256 + i] : NaN;
  };
  return (lat, lon) => {
    const { tx, ty, px: x, py: y } = tileXY(lat, lon, z);
    const fx = x - 0.5, fy = y - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const a = px(tx, ty, i, j), b = px(tx, ty, i + 1, j), c = px(tx, ty, i, j + 1), d = px(tx, ty, i + 1, j + 1);
    if ([a, b, c, d].some(Number.isNaN)) { const ok = [a, b, c, d].filter(Number.isFinite); return ok.length ? ok.reduce((p, q) => p + q, 0) / ok.length : NaN; }
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

// 그린 측량 격자를 지형에 덧붙임: 그린 안 점은 격자 높이 + (지형의 그린 가운데 높이 − 격자의 가운데 높이)
export function withGreen(sampler, greenGrid) {
  if (!greenGrid?.grid?.h?.length || !greenGrid.origin) return sampler;
  const g = greenGrid.grid, o = greenGrid.origin;
  const gh = (x, y) => {
    const fx = (x - g.x0) / g.dx, fy = (y - g.y0) / g.dx;
    if (fx < 0 || fy < 0 || fx > g.nx - 1 || fy > g.ny - 1) return NaN;
    const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.ny - 2, Math.floor(fy)), u = fx - i, v = fy - j, H = (a, b) => g.h[b * g.nx + a];
    const q = [H(i, j), H(i + 1, j), H(i, j + 1), H(i + 1, j + 1)];
    if (!q.every(Number.isFinite)) return NaN;
    return (q[0] * (1 - u) + q[1] * u) * (1 - v) + (q[2] * (1 - u) + q[3] * u) * v;
  };
  const c0 = gh(0, 0), base = sampler(o.lat, o.lon);
  if (!Number.isFinite(c0) || !Number.isFinite(base)) return sampler;
  return (lat, lon) => { const q = toLocal(o, { lat, lon }), v = gh(q.x, q.y); return Number.isFinite(v) ? base + (v - c0) : sampler(lat, lon); };
}

// 필요한 타일 번호들 (점들 주변 margin m)
export function tilesFor(points, marginM = 120, z = ZOOM) {
  const out = new Set();
  for (const p of points) {
    if (!p) continue;
    const dLat = marginM / 111320, dLon = marginM / (111320 * Math.cos(p.lat * Math.PI / 180));
    for (const [la, lo] of [[p.lat - dLat, p.lon - dLon], [p.lat + dLat, p.lon + dLon], [p.lat - dLat, p.lon + dLon], [p.lat + dLat, p.lon - dLon], [p.lat, p.lon]]) { const t = tileXY(la, lo, z); out.add(t.tx + '/' + t.ty); }
  }
  return [...out];
}

// ---------- 불러오기 (브라우저) ----------
const cache = new Map(); // 'x/y' → Float32Array | Promise
async function loadTile(key, z = ZOOM) {
  if (cache.has(key)) return cache.get(key);
  const [x, y] = key.split('/');
  const p = (async () => {
    const r = await fetch(TERRAIN_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y), { mode: 'cors' });
    if (!r.ok) throw new Error('terrain ' + r.status);
    const bmp = await createImageBitmap(await r.blob());
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, 256, 256).data, out = new Float32Array(256 * 256);
    for (let i = 0; i < out.length; i++) out[i] = decodeTerrarium(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    return out;
  })();
  cache.set(key, p);
  try { const v = await p; cache.set(key, v); return v; } catch (e) { cache.delete(key); throw e; }
}
// 홀(티·IP·그린·해저드)과 내 위치 주변 지형 → 높이 읽개 (실패하면 null: 평평하게 그림)
export async function loadTerrain(points, { greenGrid = null } = {}) {
  const keys = tilesFor(points);
  if (!keys.length || keys.length > 12) return null;
  const tiles = new Map();
  await Promise.all(keys.map(async k => { try { tiles.set(k, await loadTile(k)); } catch {} }));
  if (!tiles.size) return null;
  return withGreen(makeSampler(tiles), greenGrid);
}
