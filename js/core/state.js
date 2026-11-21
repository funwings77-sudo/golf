// 앱 상태 (오프라인 우선: localStorage 저장)
import { CLUB_TYPES } from '../physics/flight.js';
import { DEFAULT_CALIB } from '../physics/putt.js';

const PREFIX = 'pinpoint.';
// ---------- 그린 높이 격자 압축 (저장할 때만) ----------
//  긴 소수(0.2100003191567568) 대신: 가장 낮은 점 기준 16비트 정수(기본 0.1mm 단위) → base64. 오차 ≤ 단위/2. 메모리에서는 그대로 숫자 배열
//  65535 = 값 없음(null/NaN, 그린 밖)
export function packHeights(h) {
  if (!Array.isArray(h) || h.length < 64) return null;
  let lo = Infinity, hi = -Infinity;
  for (const v of h) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) return null;
  const scale = Math.max(0.0001, (hi - lo) / 65534), u = new Uint16Array(h.length);
  for (let i = 0; i < h.length; i++) u[i] = Number.isFinite(h[i]) ? Math.round((h[i] - lo) / scale) : 65535;
  const b = new Uint8Array(u.buffer); let str = '';
  for (let i = 0; i < b.length; i += 0x8000) str += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return { base: lo, scale, n: h.length, b64: btoa(str) };
}
export function unpackHeights(q) {
  const str = atob(q.b64), b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i);
  const u = new Uint16Array(b.buffer, 0, q.n), out = new Array(q.n);
  for (let i = 0; i < q.n; i++) out[i] = u[i] === 65535 ? null : q.base + u[i] * q.scale;
  return out;
}
const mapGrids = (courses, fn) => (Array.isArray(courses) ? courses.map(c => (c?.holes ? { ...c, holes: c.holes.map(h => (h?.greenGrid?.grid ? { ...h, greenGrid: { ...h.greenGrid, grid: fn(h.greenGrid.grid) } } : h)) } : c)) : courses);
const packCourses = cs => mapGrids(cs, g => { const q = g.hq ? null : packHeights(g.h); if (!q) return g; const { h, ...rest } = g; return { ...rest, hq: q }; });
const unpackCourses = cs => mapGrids(cs, g => { if (!g.hq) return g; const { hq, ...rest } = g; return { ...rest, h: unpackHeights(hq) }; });

// 읽기: 깨진 값은 기본값으로 대신하되, 원래 내용은 'pinpoint.corrupt.<키>'에 남겨 둠 (다음 저장이 덮어써 영영 잃지 않게)
function load(key, def) {
  let v = null;
  try { v = localStorage.getItem(PREFIX + key); if (!v) return structuredClone(def); const o = JSON.parse(v); return key === 'courses' ? unpackCourses(o) : o; }
  catch { try { if (v && !localStorage.getItem(PREFIX + 'corrupt.' + key)) localStorage.setItem(PREFIX + 'corrupt.' + key, v); } catch {} return structuredClone(def); }
}
// 쓰기: 실패하면(저장 공간 부족 등) false + 알림 (조용히 버리지 않음)
const failSubs = new Set();
export function onSaveFail(fn) { failSubs.add(fn); return () => failSubs.delete(fn); }
function store(key, val) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(key === 'courses' ? packCourses(val) : val)); return true; }
  catch (e) { console.warn('save failed', key, e); failSubs.forEach(f => { try { f(key, e); } catch {} }); return false; }
}

export const DEFAULT_SETTINGS = {
  mode: 'casual',          // tournament | casual | practice
  unit: 'm', hand: 'R', hcp: 18, gender: 'M',
  stimp: 10, eyeHeight: 1.55, phoneHeight: 1.45, cameraVFov: 63, stepLen: 0.75,
  voice: false, outdoor: false, bigText: false, beginner: false,
  weather: true, swingDetect: false, simGPS: false,
  aimSigma: 1.0, speedSigma: 0.06, roundsPerMonth: 3,
  tempoBpm: 76,
  detail: false,           // false = 쉬운 화면(기본), true = 자세히 화면
  voiceLevel: 'detail',    // 🎧 음성 안내: detail(자세히 · 숫자 정밀) | simple(간단히)
  voiceRate: 1,            // 말 빠르기 0.85 · 1 · 1.2
  voiceButtons: true,      // 이어폰 버튼: 1번 다시 듣기 · 2번 쳤어요/찾았어요 · 3번 취소
  voiceAuto: true,         // 이어폰을 꽂거나 연결하면 음성 안내 저절로 켜기
  watchAuto: true,         // ⌚ 워치가 스윙을 알아채면 저절로 [쳤어요]
  grips: [],               // 🏷️ 그립 센서 연결 [{ deviceId, club, name, battery }]
};

// 핸디캡 18 남성 기준 캐리(m) → 핸디캡·성별로 스케일
const BASE_CARRY = { D: 200, '3W': 182, '5W': 172, '4H': 162, '5i': 150, '6i': 141, '7i': 131, '8i': 121, '9i': 110, PW: 100, GW: 88, SW: 74, LW: 60 };
export function defaultBag(hcp = 18, gender = 'M') {
  const scale = (gender === 'F' ? 0.8 : 1) * (1 - (hcp - 18) * 0.008);
  const on = ['D', '3W', '5W', '4H', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW'];
  return CLUB_TYPES.map(c => ({
    id: c.id, name: c.name, enabled: on.includes(c.id),
    carry: Math.round(BASE_CARRY[c.id] * scale), sdDist: c.sdDist, sdLat: c.sdLat, n: 0, learned: false,
  }));
}

export const S = {
  settings: { ...DEFAULT_SETTINGS, ...load('settings', {}) },
  courses: load('courses', []),
  bag: load('bag', null),
  rounds: load('rounds', []),       // 완료 라운드
  round: load('round', null),       // 진행 중 라운드
  shots: load('shots', []),         // 샷 기록 (개인 비거리 학습)
  calib: load('calib', DEFAULT_CALIB),
  lost: load('lost', null),         // 진행 중 분실구 탐색
  ui: { hole: load('uiHole', 1), courseId: load('uiCourse', null) },
};
if (!S.bag) S.bag = defaultBag(S.settings.hcp, S.settings.gender);

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function save(...keys) {
  let ok = true;
  for (const k of keys) {
    if (k === 'ui') ok = store('uiHole', S.ui.hole) && store('uiCourse', S.ui.courseId) && ok;
    else ok = store(k, S[k]) && ok;
  }
  subs.forEach(f => { try { f(keys); } catch (e) { console.error(e); } });
  return ok;
}

// ---------- 전체 백업 · 복원 · 저장 공간 ----------
// 백업: 내 기록 전부(설정·골프장·라운드·샷·클럽·보정·공 찾기 기록). 서버에서 다시 받는 캐시(remote.*)는 뺌
export const BACKUP_FORMAT = 'pinpoint-backup';
export function exportAll() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(PREFIX) || k.startsWith(PREFIX + 'remote.') || k.startsWith(PREFIX + 'corrupt.')) continue;
    data[k.slice(PREFIX.length)] = localStorage.getItem(k);
  }
  return { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), data };
}
// 복원: 라운드·샷은 id 기준으로 합치고(지금 기록 + 백업 기록), 나머지는 백업 값으로. 진행 중 라운드는 지금 것이 있으면 유지
export function importAll(backup) {
  if (backup?.format !== BACKUP_FORMAT || typeof backup.data !== 'object') throw new Error('PinPoint 백업 파일이 아니에요');
  const parse = v => { try { return JSON.parse(v); } catch { return null; } };
  const mergeById = (cur, inc, idOf) => { const m = new Map(); for (const x of [...(inc || []), ...(cur || [])]) if (x) m.set(idOf(x), x); return [...m.values()]; };
  const d = backup.data, out = {};
  for (const [k, v] of Object.entries(d)) {
    if (k === 'rounds') out.rounds = mergeById(S.rounds, parse(v), r => r.id + '|' + (r.endedAt || '')).sort((a, b) => String(b.endedAt || b.date).localeCompare(String(a.endedAt || a.date)));
    else if (k === 'shots') out.shots = mergeById(S.shots, parse(v), x => String(x.id) + '|' + x.club).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    else if (k === 'courses') out.courses = mergeById(parse(v), S.courses, c => c.id); // 같은 골프장이면 지금 휴대폰 것(배운 그린 포함) 우선
    else if (k === 'round') { if (!S.round) out.round = parse(v); }
    else out[k] = parse(v) ?? v;
  }
  let n = 0;
  for (const [k, v] of Object.entries(out)) { if (v == null) continue; if (!store(k, v)) throw new Error('저장 공간이 부족해서 복원하지 못했어요'); n++; }
  return { keys: n, rounds: out.rounds?.length ?? S.rounds.length, shots: out.shots?.length ?? S.shots.length };
}
// 저장 공간: 키별 크기(KB)와 합계 (localStorage는 보통 5MB 안팎)
export function storageReport() {
  const rows = []; let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i); if (!k?.startsWith(PREFIX)) continue;
    const kb = ((localStorage.getItem(k) || '').length * 2) / 1024; total += kb; rows.push([k.slice(PREFIX.length), kb]);
  }
  return { total, rows: rows.sort((a, b) => b[1] - a[1]) };
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------- 규칙 엔진 (골프 규칙 4.3a) ----------
export const MODES = {
  tournament: { label: '대회', short: 'TOUR', desc: '대회 규칙대로 직선 거리만 보여 줘요. 경사·클럽 추천·퍼팅 길은 꺼져요 (규칙 4.3a)' },
  casual: { label: '친구랑', short: 'CASUAL', desc: '모든 기능을 써요' },
  practice: { label: '연습', short: 'PRACTICE', desc: '모든 기능 + 연습 도구(힘 맞추기·그린 읽기 연습). 기록 통계에는 안 들어가요' },
};
const POLICY = {
  distance: ['tournament', 'casual', 'practice'],
  playsLike: ['casual', 'practice'],
  lieSlope: ['casual', 'practice'],
  greenSlope: ['casual', 'practice'],
  puttLine: ['casual', 'practice'],
  clubRec: ['casual', 'practice'],
  windAdjust: ['casual', 'practice'],
  lostBall: ['tournament', 'casual', 'practice'],
  score: ['tournament', 'casual', 'practice'],
  rules: ['tournament', 'casual', 'practice'],
  safety: ['tournament', 'casual', 'practice'],
  aiCaddie: ['casual', 'practice'],
};
export const FEATURE_NAMES = { playsLike: '플레이즈라이크', lieSlope: '라이 경사 측정', greenSlope: '그린 경사 지도', puttLine: '퍼팅 라인·세기 계산', clubRec: '클럽·조준 추천', windAdjust: '바람 보정' };
export function allowed(feature, mode = S.settings.mode) {
  const m = S.round?.mode || mode;
  return (POLICY[feature] || []).includes(m);
}
export function currentMode() { return S.round?.mode || S.settings.mode; }

export function activeCourse() {
  const id = S.round?.courseId || S.ui.courseId;
  return S.courses.find(c => c.id === id) || null;
}
export function activeHole() {
  const c = activeCourse(); if (!c) return null;
  return c.holes.find(h => h.n === S.ui.hole) || c.holes[0] || null;
}
