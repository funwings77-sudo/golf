// 앱 상태 (오프라인 우선: localStorage 저장)
import { CLUB_TYPES } from '../physics/flight.js';
import { DEFAULT_CALIB } from '../physics/putt.js';

const PREFIX = 'pinpoint.';
function load(key, def) {
  try { const v = localStorage.getItem(PREFIX + key); return v ? JSON.parse(v) : structuredClone(def); } catch { return structuredClone(def); }
}
function store(key, val) { try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) { console.warn('save failed', key, e); } }

export const DEFAULT_SETTINGS = {
  mode: 'casual',          // tournament | casual | practice
  unit: 'm', hand: 'R', hcp: 18, gender: 'M',
  stimp: 10, eyeHeight: 1.55, phoneHeight: 1.45, cameraVFov: 63, stepLen: 0.75,
  voice: false, outdoor: false, bigText: false, beginner: false,
  weather: true, swingDetect: false, simGPS: false,
  aimSigma: 1.0, speedSigma: 0.06, roundsPerMonth: 3,
  tempoBpm: 76,
  detail: false,           // false = 쉬운 화면(기본), true = 자세히 화면
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
  for (const k of keys) {
    if (k === 'ui') { store('uiHole', S.ui.hole); store('uiCourse', S.ui.courseId); }
    else store(k, S[k]);
  }
  subs.forEach(f => { try { f(keys); } catch (e) { console.error(e); } });
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
