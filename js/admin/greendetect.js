// 위성사진(Esri, z18)에서 그린 후보 자동 찾기
//  그린 = 아주 매끈하고(짧게 깎아 결이 거의 없음) 밝은 초록 · 면적 250~1600㎡ · 둥근 덩어리 · 주변에 벙커(모래색)가 자주 있음
//  결과는 '후보'일 뿐이며 사람이 홀 번호를 붙여 확인합니다.
import { SAT_URL } from '../map.js';

const TILE = 256;
const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

async function loadTile(z, x, y) {
  const url = SAT_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('타일 ' + res.status);
  return createImageBitmap(await res.blob());
}

// bounds: {s,w,n,e}
export async function detectGreens(bounds, { z = 18, maxTiles = 100, onProgress } = {}) {
  const x0 = Math.floor(lon2x(bounds.w, z)), x1 = Math.floor(lon2x(bounds.e, z)), y0 = Math.floor(lat2y(bounds.n, z)), y1 = Math.floor(lat2y(bounds.s, z));
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
  if (nx * ny > maxTiles) throw new Error(`범위가 너무 넓습니다 (타일 ${nx * ny}개). 골프장의 일부(코스 하나)가 보이도록 확대하세요`);
  const W = nx * TILE, H = ny * TILE, cv = new OffscreenCanvas(W, H), ctx = cv.getContext('2d', { willReadFrequently: true });
  let done = 0;
  await Promise.all(Array.from({ length: nx * ny }, (_, k) => k).map(async k => {
    const tx = x0 + (k % nx), ty = y0 + Math.floor(k / nx);
    try { ctx.drawImage(await loadTile(z, tx, ty), (tx - x0) * TILE, (ty - y0) * TILE); } catch {}
    onProgress?.(++done / (nx * ny));
  }));
  const px = ctx.getImageData(0, 0, W, H).data;
  const latC = (bounds.s + bounds.n) / 2, mpp = 156543.03392 * Math.cos(latC * Math.PI / 180) / 2 ** z, a1 = mpp * mpp;
  // 1) 밝기·초록도·모래색
  const N = W * H, L = new Float32Array(N), G = new Uint8Array(N), S = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    G[i] = g > r + 6 && g > b + 4 && g > 60 ? 1 : 0;
    S[i] = r > 150 && g > 130 && b > 90 && r >= g && r - b > 25 && r - b < 110 ? 1 : 0;
  }
  // 2) 결(텍스처): 5×5 창의 밝기 표준편차 (적분 영상)
  const I = new Float64Array((W + 1) * (H + 1)), I2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let s = 0, s2 = 0; for (let x = 0; x < W; x++) { const v = L[y * W + x]; s += v; s2 += v * v; const k = (y + 1) * (W + 1) + x + 1; I[k] = I[k - W - 1] + s; I2[k] = I2[k - W - 1] + s2; } }
  const R = 3, sd = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xa = Math.max(0, x - R), xb = Math.min(W, x + R + 1), ya = Math.max(0, y - R), yb = Math.min(H, y + R + 1), n = (xb - xa) * (yb - ya);
    const q = (A, xx, yy) => A[yy * (W + 1) + xx], s = q(I, xb, yb) - q(I, xa, yb) - q(I, xb, ya) + q(I, xa, ya), s2 = q(I2, xb, yb) - q(I2, xa, yb) - q(I2, xb, ya) + q(I2, xa, ya);
    sd[y * W + x] = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
  }
  // 3) 적응 임계값: 초록 픽셀 중 가장 매끈한 쪽 + 평균 이상 밝기
  const gs = [], gl = []; for (let i = 0; i < N; i += 7) if (G[i]) { gs.push(sd[i]); gl.push(L[i]); }
  if (gs.length < 500) return { candidates: [], info: '초록 영역이 거의 없습니다' };
  gs.sort((a, b) => a - b); gl.sort((a, b) => a - b);
  const sdT = gs[Math.floor(gs.length * 0.22)], lT = gl[Math.floor(gl.length * 0.45)];
  const M = new Uint8Array(N); for (let i = 0; i < N; i++) M[i] = G[i] && sd[i] <= sdT && L[i] >= lT ? 1 : 0;
  // 4) 잡음 정리: 열림(침식→팽창) 1px
  const er = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; er[i] = M[i] && M[i - 1] && M[i + 1] && M[i - W] && M[i + W] ? 1 : 0; }
  const op = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; op[i] = er[i] || er[i - 1] || er[i + 1] || er[i - W] || er[i + W] ? 1 : 0; }
  // 5) 연결 요소
  const lab = new Int32Array(N), stack = []; let nl = 0; const comps = [];
  for (let i = 0; i < N; i++) {
    if (!op[i] || lab[i]) continue;
    nl++; lab[i] = nl; stack.push(i);
    let n = 0, sx = 0, sy = 0, minx = W, maxx = 0, miny = H, maxy = 0, edge = 0;
    while (stack.length) {
      const j = stack.pop(), x = j % W, y = (j / W) | 0; n++; sx += x; sy += y;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (const d of [1, -1, W, -W]) { const k = j + d; if (k < 0 || k >= N || (d === 1 && x === W - 1) || (d === -1 && x === 0)) { edge++; continue; } if (op[k] && !lab[k]) { lab[k] = nl; stack.push(k); } else if (!op[k]) edge++; }
    }
    comps.push({ n, cx: sx / n, cy: sy / n, minx, maxx, miny, maxy, edge });
  }
  // 6) 후보 평가: 면적 · 둥근 정도 · 사각형 채움 · 주변 모래
  const cands = [];
  for (const c of comps) {
    const area = c.n * a1; if (area < 250 || area > 1600) continue;
    const bw = (c.maxx - c.minx + 1) * mpp, bh = (c.maxy - c.miny + 1) * mpp, fill = area / (bw * bh), aspect = Math.max(bw, bh) / Math.min(bw, bh);
    const per = c.edge * mpp, round = 4 * Math.PI * area / (per * per);
    if (aspect > 2.6 || fill < 0.45) continue;
    // 반경 25m 안 모래(벙커) 비율
    const rr = Math.round(25 / mpp); let sand = 0, tot = 0;
    for (let y = Math.max(0, Math.round(c.cy) - rr); y < Math.min(H, Math.round(c.cy) + rr); y += 2) for (let x = Math.max(0, Math.round(c.cx) - rr); x < Math.min(W, Math.round(c.cx) + rr); x += 2) { tot++; sand += S[y * W + x]; }
    const sandF = sand / Math.max(1, tot);
    const score = Math.min(1, round * 1.4) * 0.45 + Math.min(1, fill / 0.75) * 0.25 + Math.min(1, sandF * 25) * 0.3;
    const gx = x0 * TILE + c.cx, gy = y0 * TILE + c.cy;
    cands.push({ lat: +y2lat(gy / TILE, z).toFixed(7), lon: +x2lon(gx / TILE, z).toFixed(7), area: Math.round(area), r: +Math.sqrt(area / Math.PI).toFixed(1), score: +score.toFixed(2), sand: sandF > 0.01, w: +bw.toFixed(1), h: +bh.toFixed(1) });
  }
  cands.sort((a, b) => b.score - a.score);
  return { candidates: cands, info: `타일 ${nx * ny}개 · 해상도 ${mpp.toFixed(2)}m/px · 후보 ${cands.length}개` };
}
