// 🗺️ 앱·관리자 시작 때 한 번: 구글 지도 키가 있으면 진짜 구글 지도(Maps JavaScript API)를 불러와 모든 지도 화면이 구글 지도를 씀
//  · 키 없음 · 신호 없음 · 불러오기 실패 · 키 거부(gm_authFailure) → 원래 지도(Leaflet + 위성 사진, 신호 없을 때 미리 받은 지도)
//  · 키가 거부되면 하루 동안은 다시 시도하지 않음 (매번 오류 화면이 뜨지 않게)
import { getMapsKey } from './gmaps.js';
import { loadGoogleMaps, makeGoogleL } from './gleaflet.js';

const FAIL = 'pinpoint.gmjsFail';
let engine = 'leaflet';
export const mapEngine = () => engine; // 'google' | 'leaflet'
export const gmFailInfo = () => { try { return JSON.parse(localStorage.getItem(FAIL) || 'null'); } catch { return null; } };
export function clearGmFail() { try { localStorage.removeItem(FAIL); } catch {} }

export async function initMaps({ timeout = 7000 } = {}) {
  if (window.L?.__google) return (engine = 'google');
  const key = getMapsKey();
  if (!key || navigator.onLine === false) return engine;
  const f = gmFailInfo();
  if (f && f.key === key.slice(-6) && Date.now() - f.at < 86400000) return engine;
  // 키가 막히면 구글이 이 함수를 부름 → 원래 지도로 돌아가 지금 화면을 다시 그림
  window.gm_authFailure = () => {
    try { localStorage.setItem(FAIL, JSON.stringify({ at: Date.now(), key: key.slice(-6) })); } catch {}
    if (window.__leafletL) { window.L = window.__leafletL; engine = 'leaflet'; window.dispatchEvent(new CustomEvent('pinpoint:maps-engine', { detail: 'leaflet' })); }
  };
  const google = await loadGoogleMaps(key, { timeout });
  if (!google) return engine;
  window.__leafletL = window.L; // 신호가 끊겨 다시 시작할 때 등을 위해 원래 것도 보관
  window.L = makeGoogleL(google);
  return (engine = 'google');
}
