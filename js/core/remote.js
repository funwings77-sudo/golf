// 관리자 발행 데이터 수신 (GitHub Pages data/): 공식 코스 · 오늘의 핀 · 공지
//  · 웹: 같은 사이트의 data/ · 앱(APK): 배포 사이트 주소
//  · 오프라인이면 마지막으로 받은 값(localStorage) 사용
import { S, save } from './state.js';

const SITE = 'https://funwings77-sudo.github.io/golf/';
const native = () => !!globalThis.window?.Capacitor?.isNativePlatform?.();
export const DATA_BASE = () => (native() || globalThis.location?.protocol === 'file:' ? SITE : new URL('./', globalThis.location.href).href) + 'data/';

const LS = 'pinpoint.remote.';
const cacheGet = k => { try { return JSON.parse(localStorage.getItem(LS + k) || 'null'); } catch { return null; } };
const cacheSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch {} };

export function todayKey(d = new Date()) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

// Pages CDN 캐시(최대 10분)를 피하기 위해 1분 단위 쿼리 추가
async function fetchJSON(path, { timeout = 8000, cacheKey = null } = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(DATA_BASE() + path + '?m=' + Math.floor(Date.now() / 60000), { cache: 'no-store', signal: ctl.signal });
    if (res.status === 404) { if (cacheKey) cacheSet(cacheKey, null); return null; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (cacheKey) cacheSet(cacheKey, { at: Date.now(), data: j });
    return j;
  } catch (e) {
    if (cacheKey) { const c = cacheGet(cacheKey); if (c) return c.data; }
    throw e;
  } finally { clearTimeout(t); }
}

export const officialId = c => c?.official?.id || null;
export const findInstalled = id => S.courses.find(c => officialId(c) === id) || null;

export async function getCatalog() {
  const j = await fetchJSON('catalog.json', { cacheKey: 'catalog' });
  return j?.courses || [];
}

// 공식 코스 설치/업데이트: 같은 공식 ID면 로컬 ID를 유지(진행 중 라운드·기록 연결 유지)하고 오늘 기록한 내 핀은 보존
export async function installCourse(entry) {
  const j = await fetchJSON(entry.file || `courses/${entry.id}.json`);
  const src = j?.course;
  if (!src || !Array.isArray(src.holes)) throw new Error('코스 파일 형식이 올바르지 않습니다');
  const prev = findInstalled(src.id);
  const course = {
    id: prev?.id || 'o-' + src.id, name: src.name, created: prev?.created || Date.now(),
    official: { id: src.id, rev: src.rev || 1, updatedAt: src.updatedAt, region: src.region || '', phone: src.phone || '', address: src.address || '' },
    localRules: src.localRules || [], defaultStimp: src.defaultStimp ?? null,
    ...(src.nines ? { nines: src.nines } : {}), ...(src.center ? { center: src.center } : {}), ...(src.info ? { info: src.info } : {}), ...(src.dataSources ? { dataSources: src.dataSources } : {}),
    shelters: (src.shelters || []).map(s => ({ ...s })),
    holes: src.holes.map(h => {
      const old = prev?.holes.find(x => x.n === h.n);
      const keepPin = old?.pin && old.pin.src !== 'official' && new Date(old.pin.ts).toDateString() === new Date().toDateString();
      // 공식 데이터에 그린 위치가 없고 내가 지도에서 찍어 둔 위치가 있으면 보존
      const mine = !h.green && old?.greenBy === 'user' ? { green: old.green, greenBy: 'user' } : {};
      return { ...h, hazards: (h.hazards || []).map(z => ({ ...z })), ...mine, ...(keepPin ? { pin: old.pin } : {}) };
    }),
  };
  if (prev) S.courses[S.courses.indexOf(prev)] = course; else S.courses.push(course);
  if (S.round?.courseId === course.id) for (const rh of S.round.holes) { const h = course.holes.find(x => x.n === rh.n); if (h) rh.par = h.par; }
  save('courses'); if (S.round) save('round');
  await syncPins(course).catch(() => {});
  return { course, updated: !!prev };
}

// 오늘의 핀: 적용 날짜가 오늘인 것만. 내가 그 뒤에 직접 기록한 핀은 덮어쓰지 않음
export async function syncPins(course) {
  const id = officialId(course); if (!id) return null;
  const p = await fetchJSON(`pins/${id}.json`, { cacheKey: 'pins.' + id });
  const today = todayKey();
  if (!p || p.date !== today) { course.todayPins = null; return null; }
  const ts = Date.parse(p.updatedAt) || Date.now();
  let changed = 0;
  for (const h of course.holes) {
    const q = p.holes?.[h.n]; if (!q || !Number.isFinite(q.lat)) continue;
    const mine = h.pin && h.pin.src !== 'official' && new Date(h.pin.ts).toDateString() === new Date().toDateString() && h.pin.ts > ts;
    if (mine) continue;
    if (!h.pin || h.pin.src !== 'official' || h.pin.lat !== q.lat || h.pin.lon !== q.lon) changed++;
    h.pin = { lat: q.lat, lon: q.lon, ts, src: 'official', depth: q.depth, side: q.side };
  }
  course.todayPins = { date: p.date, stimp: p.stimp, note: p.note || '', updatedAt: p.updatedAt };
  save('courses');
  return { changed, ...course.todayPins };
}

// 공지: 기간 안 · 숨김 아님 · (전체 또는 현재 코스)
export async function getNotices(course = null) {
  const j = await fetchJSON('notices.json', { cacheKey: 'notices' });
  const now = Date.now(), id = officialId(course);
  return (j?.items || []).filter(n => !n.disabled && (!n.start || Date.parse(n.start) <= now) && (!n.end || Date.parse(n.end) >= now) && (!n.courseId || n.courseId === id))
    .sort((a, b) => ['danger', 'warn', 'info'].indexOf(a.level) - ['danger', 'warn', 'info'].indexOf(b.level));
}

// 설치한 공식 코스 중 새 버전이 있는 것
export function pendingUpdates(catalog) {
  return S.courses.filter(c => c.official).map(c => ({ c, e: catalog.find(x => x.id === c.official.id) })).filter(x => x.e && x.e.rev > (x.c.official.rev || 0));
}

// 전국 골프장 목록 (KGBA 회원사 209곳 · 기본정보·요금·대략 위치)
export async function getClubs() {
  const j = await fetchJSON('clubs.json', { cacheKey: 'clubs' });
  return j?.clubs || [];
}
