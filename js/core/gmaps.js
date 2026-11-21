// 🗺️ 구글 위성지도 (Google Maps Platform · Map Tiles API · 2D 타일)
//  · 키는 이 휴대폰에만 저장 (설정 → 구글 지도) · 요청은 휴대폰에서 Google로 바로
//  · 세션(약 2주 유효)을 한 번 만들어 보관하고 타일 주소에 붙여 씀
//  · 지도 아래 표시: 'Google' + 보이는 곳의 저작권 문구(viewport API) — 구글 약관대로
//  · 신호 없는 코스용 '미리 받기'는 구글 약관상 타일 저장이 안 돼서 Esri 지도로 계속 함 (map.js · offline.js)
import { BUILT_IN_MAPS_KEY } from './mapskey.js';
const K_KEY = 'pinpoint.mapsKey', K_SES = 'pinpoint.mapsSession';
const API = 'https://tile.googleapis.com';

const ls = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };
// 설정에서 직접 넣은 키가 먼저, 없으면 앱에 들어 있는 기본 키
export const userMapsKey = () => ls.get(K_KEY).trim();
export const builtInMapsKey = () => BUILT_IN_MAPS_KEY || '';
export const getMapsKey = () => userMapsKey() || builtInMapsKey();
export const hasMapsKey = () => !!getMapsKey();
export function setMapsKey(k) { ls.set(K_KEY, (k || '').trim()); ls.set(K_SES, ''); }

// 보관된 세션 (키가 같고 하루 이상 남았을 때만)
export function cachedSession() {
  try {
    const s = JSON.parse(ls.get(K_SES) || 'null'), key = getMapsKey();
    if (s && key && s.key === key && s.expiry * 1000 - Date.now() > 86400000) return s;
  } catch {}
  return null;
}
// 새 세션 만들기 (위성 · 한국어) → { session, expiry, key }
export async function createSession(key = getMapsKey()) {
  if (!key) throw new Error('구글 지도 키가 없어요');
  const r = await fetch(`${API}/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // region은 넣지 않음: region 'KR'이면 한국 땅 위성사진을 가까이(확대 17 이상) 주지 않음 (2026-11 시험)
    body: JSON.stringify({ mapType: 'satellite', language: 'ko-KR' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.session) throw new Error(j?.error?.message || `구글 지도 연결 실패 (${r.status})`);
  const s = { session: j.session, expiry: +j.expiry || Math.floor(Date.now() / 1000) + 7 * 86400, key };
  ls.set(K_SES, JSON.stringify(s));
  return s;
}
export async function getSession() { return cachedSession() || createSession(); }
export function forgetSession() { ls.set(K_SES, ''); }

export const tileUrl = s => `${API}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(s.session)}&key=${encodeURIComponent(s.key)}`;

// 보이는 곳의 저작권 문구 (예: "Imagery ©2026 Google, Maxar Technologies")
export async function viewportCopyright(s, b, zoom) {
  const q = `session=${encodeURIComponent(s.session)}&key=${encodeURIComponent(s.key)}&zoom=${Math.round(zoom)}&north=${b.getNorth()}&south=${b.getSouth()}&east=${b.getEast()}&west=${b.getWest()}`;
  const r = await fetch(`${API}/tile/v1/viewport?${q}`);
  if (!r.ok) return '';
  const j = await r.json().catch(() => ({}));
  return j.copyright || '';
}

// 설정의 '연결 시험': 세션을 새로 만들고 타일 한 장을 받아 봄
export async function testMapsKey(key) {
  const s = await createSession(key);
  const r = await fetch(tileUrl(s).replace('{z}', '17').replace('{x}', '111767').replace('{y}', '50745')); // 서울 시청 근처 한 장 (확대 17)
  if (!r.ok) throw new Error(`타일을 받지 못했어요 (${r.status})`);
  return s;
}
