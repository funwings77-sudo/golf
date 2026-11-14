// GeoTIFF DEM → 그린 높이 격자 (기획서 2+-3: 골프맵코리아 GeoTIFF · WGS84 / UTM-K / TM 중부·서부·동부원점)
//  그린 중앙(origin) 기준 반경 radius 안을 cell 간격으로 다시 샘플링(쌍선형)
const GEOTIFF_URL = 'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js';
const PROJ4_URL = 'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.11.0/proj4.js';
export const KOREA_CRS = {
  4326: '+proj=longlat +datum=WGS84 +no_defs',
  5179: '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs', // UTM-K
  5185: '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',  // 서부원점
  5186: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',  // 중부원점
  5187: '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',  // 동부원점
  5188: '+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',  // 동해원점
  32651: '+proj=utm +zone=51 +datum=WGS84 +units=m +no_defs',
  32652: '+proj=utm +zone=52 +datum=WGS84 +units=m +no_defs',
  3857: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs',
};
const loaded = {};
function script(url, global) {
  if (globalThis[global]) return Promise.resolve(globalThis[global]);
  return loaded[url] || (loaded[url] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = url; s.crossOrigin = 'anonymous';
    s.onload = () => res(globalThis[global]); s.onerror = () => { delete loaded[url]; rej(new Error(url.split('/').pop() + '를 불러오지 못했습니다 (인터넷 확인)')); };
    document.head.appendChild(s);
  }));
}

export async function gridFromGeoTIFF(buf, origin, { radius = 22, cell = 0.5, epsg = null } = {}) {
  const [GT, proj4] = await Promise.all([script(GEOTIFF_URL, 'GeoTIFF'), script(PROJ4_URL, 'proj4')]);
  const tiff = await GT.fromArrayBuffer(buf), img = await tiff.getImage();
  const keys = img.getGeoKeys() || {};
  const code = epsg || keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey || 4326;
  if (!KOREA_CRS[code]) throw new Error(`좌표계 EPSG:${code}는 지원하지 않습니다 (지원: ${Object.keys(KOREA_CRS).join(', ')}). 내보낼 때 WGS84 또는 UTM-K로 지정하세요`);
  const fwd = proj4(KOREA_CRS[4326], KOREA_CRS[code]);
  const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution(), W = img.getWidth(), Hh = img.getHeight();
  const nodata = img.getGDALNoData();
  const { fromLocal } = await import('../core/geo.js');
  const n = Math.round((2 * radius) / cell) + 1, x0 = -radius, y0 = -radius;
  // 필요한 픽셀 창만 읽기
  const pix = (lat, lon) => { const [X, Y] = fwd.forward([lon, lat]); return [(X - ox) / rx, (Y - oy) / ry]; };
  const corners = [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]].map(([x, y]) => { const p = fromLocal(origin, { x, y }); return pix(p.lat, p.lon); });
  const px0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c[0]))) - 2), px1 = Math.min(W, Math.ceil(Math.max(...corners.map(c => c[0]))) + 2);
  const py0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c[1]))) - 2), py1 = Math.min(Hh, Math.ceil(Math.max(...corners.map(c => c[1]))) + 2);
  if (px1 <= px0 || py1 <= py0) throw new Error('이 GeoTIFF는 이 홀의 그린을 포함하지 않습니다 (좌표 범위 밖)');
  const [band] = await img.readRasters({ window: [px0, py0, px1, py1], samples: [0] });
  const ww = px1 - px0, wh = py1 - py0;
  const at = (i, j) => { const v = band[j * ww + i]; return v == null || (nodata != null && v === nodata) || !Number.isFinite(v) ? NaN : v; };
  const h = new Array(n * n); let missing = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p = fromLocal(origin, { x: x0 + i * cell, y: y0 + j * cell });
    const [fx, fy] = pix(p.lat, p.lon), u = fx - px0 - 0.5, v = fy - py0 - 0.5; // 픽셀 중심 기준
    const iu = Math.floor(u), iv = Math.floor(v), tu = u - iu, tv = v - iv;
    if (iu < 0 || iv < 0 || iu + 1 >= ww || iv + 1 >= wh) { h[j * n + i] = NaN; missing++; continue; }
    const z = (at(iu, iv) * (1 - tu) + at(iu + 1, iv) * tu) * (1 - tv) + (at(iu, iv + 1) * (1 - tu) + at(iu + 1, iv + 1) * tu) * tv;
    if (Number.isNaN(z)) missing++;
    h[j * n + i] = z;
  }
  if (missing > n * n * 0.3) throw new Error(`그린 범위의 ${Math.round(missing / (n * n) * 100)}%가 데이터 밖입니다 (반경을 줄이거나 다른 타일을 쓰세요)`);
  const ok = h.filter(Number.isFinite), mean = ok.reduce((a, b) => a + b, 0) / ok.length;
  for (let k = 0; k < h.length; k++) if (!Number.isFinite(h[k])) h[k] = mean;
  const res = Math.abs(rx) * (code === 4326 ? 111000 : 1);
  return { grid: { x0, y0, dx: cell, nx: n, ny: n, h }, info: `GeoTIFF EPSG:${code} · 원본 해상도 약 ${res.toFixed(2)}m → ${n}×${n} 격자(셀 ${cell}m, 반경 ${radius}m)${missing ? ` · 빈 칸 ${missing}개 평균값` : ''}` };
}
