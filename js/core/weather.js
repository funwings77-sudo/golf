// 날씨·안전(낙뢰/폭염)·고저차·플레이즈라이크
import { airDensity } from '../physics/flight.js';

const OM = 'https://api.open-meteo.com/v1';

export async function fetchWeather(lat, lon) {
  const url = `${OM}/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,surface_pressure&hourly=cape,weather_code&forecast_hours=3&wind_speed_unit=ms&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('weather ' + r.status);
  const j = await r.json();
  const c = j.current;
  const capeNext = Math.max(...(j.hourly?.cape || [0]));
  const codesNext = j.hourly?.weather_code || [];
  const thunderNow = [95, 96, 99].includes(c.weather_code);
  const thunderSoon = codesNext.some(x => [95, 96, 99].includes(x));
  const wbgt = estimateWBGT(c.temperature_2m, c.relative_humidity_2m);
  return {
    temp: c.temperature_2m, rh: c.relative_humidity_2m, windSpeed: c.wind_speed_10m, windFrom: c.wind_direction_10m,
    gust: c.wind_gusts_10m, code: c.weather_code, pressure: c.surface_pressure, elevation: j.elevation,
    cape: capeNext, thunderNow, thunderSoon, lightningRisk: thunderNow ? 3 : thunderSoon ? 2 : capeNext > 1500 ? 1 : 0,
    wbgt, heat: wbgtLevel(wbgt), rho: airDensity(c.temperature_2m, c.surface_pressure, c.relative_humidity_2m), ts: Date.now(),
  };
}

// 단순 WBGT 추정 (호주 기상청 근사식, 그늘·약풍 가정)
export function estimateWBGT(T, rh) {
  const e = rh / 100 * 6.105 * Math.exp(17.27 * T / (237.7 + T));
  return 0.567 * T + 0.393 * e + 3.94;
}
export function wbgtLevel(w) {
  if (w >= 31) return { level: 3, label: '위험', color: 'var(--danger)', hydrateMin: 15, advice: '라운드 중단 권고. 그늘에서 휴식하고 15분마다 물·전해질을 섭취하세요.' };
  if (w >= 28) return { level: 2, label: '경고', color: 'var(--warn)', hydrateMin: 20, advice: '격한 활동 자제. 카트 이용, 20분마다 수분 섭취.' };
  if (w >= 25) return { level: 1, label: '주의', color: 'var(--caution)', hydrateMin: 30, advice: '30분마다 수분 섭취, 모자·쿨링 타월 사용.' };
  return { level: 0, label: '안전', color: 'var(--ok)', hydrateMin: 0, advice: '쾌적한 조건입니다.' };
}
export function weatherText(code) {
  if (code == null) return '';
  if (code === 0) return '맑음'; if (code <= 3) return '구름'; if (code <= 48) return '안개';
  if (code <= 57) return '이슬비'; if (code <= 67) return '비'; if (code <= 77) return '눈';
  if (code <= 82) return '소나기'; if (code <= 86) return '눈 소나기'; return '뇌우';
}

// 고저차: Copernicus DEM 90m (페어웨이 고저차 용도. 그린 미세경사에는 쓰지 않음)
const elevCache = new Map();
export async function fetchElevations(points) {
  const keys = points.map(p => p.lat.toFixed(4) + ',' + p.lon.toFixed(4));
  const miss = [...new Set(keys.filter(k => !elevCache.has(k)))];
  if (miss.length) {
    const lats = miss.map(k => k.split(',')[0]).join(','), lons = miss.map(k => k.split(',')[1]).join(',');
    const r = await fetch(`${OM}/elevation?latitude=${lats}&longitude=${lons}`);
    if (r.ok) { const j = await r.json(); miss.forEach((k, i) => elevCache.set(k, j.elevation[i])); }
  }
  return keys.map(k => elevCache.get(k) ?? null);
}

// 플레이즈라이크 (경험식): 고저차 1:1, 맞바람 +1%/mph, 뒷바람 −0.5%/mph, 기온 0.22%/°C, 고도 1.1%/305m
export function playsLike({ dist, dh = 0, windSpeed = 0, windFrom = 0, shotBearing = 0, tempC = 20, altitude = 0 }) {
  const rel = (windFrom - shotBearing) * Math.PI / 180;
  const headMs = windSpeed * Math.cos(rel), crossMs = windSpeed * Math.sin(rel);
  const headMph = headMs * 2.237;
  const wind = headMph >= 0 ? dist * 0.01 * headMph : dist * 0.005 * headMph;
  const elev = dh;
  const temp = -dist * 0.0022 * (tempC - 20);
  const alt = -dist * 0.011 * Math.max(0, altitude) / 304.8;
  const crossDrift = -dist * 0.0043 * crossMs * 2.237; // +: 오른쪽으로 밀림
  return { total: dist + elev + wind + temp + alt, parts: { elev, wind, temp, alt }, headMs, crossMs, crossDrift };
}
