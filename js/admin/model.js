// 관리자 도메인 로직 (DOM 없음 → node --test로 검증)
//  · 코스 검증 · 발행용 정리 · 카탈로그
//  · 핀 시트 좌표(앞에서 m / 좌우 m) ↔ 위경도
//  · 그린 높이 격자 입력(JSON / CSV 행렬 / XYZ 점) → 격자 · 경사 통계
//  · 라운드 리포트 검증·집계 (홀별 난이도 · 진행 속도 · 분실구)
//  · 공지 유효기간
import { distance, bearing, destination, toLocal } from '../core/geo.js';

export const DATA_FORMATS = { course: 'pinpoint-course', catalog: 'pinpoint-catalog', pins: 'pinpoint-pins', notices: 'pinpoint-notices', report: 'pinpoint-round-report' };
export const HAZARD_TYPES = ['ob', 'water', 'bunker', 'trees'];
export const TEE_SETS = [['black', '블랙'], ['blue', '블루'], ['white', '화이트'], ['red', '레드']];
export const COURSE_ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const PACE_TARGET_MIN = { 3: 11, 4: 15, 5: 18, 6: 21 }; // 18홀 4시간 30분 기준 홀당 목표
const PAR_LEN = { 3: [60, 260], 4: [220, 500], 5: [390, 660], 6: [560, 800] };

export const clone = o => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
const isLL = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

// 로컬 날짜 키 (골프장 현지 = 관리자 기기 시간대)
export function todayKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------- 코스 ----------------
export function newOfficialCourse({ id, name, holes = 18 }) {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  return {
    id, name, region: '', address: '', phone: '', defaultStimp: 10, localRules: [], shelters: [], rev: 0,
    holes: Array.from({ length: holes }, (_, i) => ({ n: i + 1, par: pars[i % 18], hdcp: null, hazards: [], halfWidth: 16, note: '' })),
  };
}

export function greenRadius(h) { return h.front && h.back ? Math.max(8, distance(h.front, h.back) / 2 + 2) : 14; }
export function holeLength(h) { return isLL(h.tee) && isLL(h.green) ? distance(h.tee, h.green) : null; }

export function validateCourse(c) {
  const errors = [], warnings = [];
  const E = (msg, hole = null) => errors.push({ hole, msg }), W = (msg, hole = null) => warnings.push({ hole, msg });
  if (!c || typeof c !== 'object') return { errors: [{ hole: null, msg: '코스 데이터가 없습니다' }], warnings, ok: false };
  if (!COURSE_ID_RE.test(c.id || '')) E('코스 ID는 영문 소문자·숫자·하이픈 2~40자여야 합니다 (예: hanwha-jeju)');
  if (!String(c.name || '').trim()) E('코스 이름이 비어 있습니다');
  if (!Array.isArray(c.holes) || !c.holes.length) { E('홀이 없습니다'); return { errors, warnings, ok: false }; }
  if (c.holes.length > 72) E(`홀 수 ${c.holes.length}개: 최대 72개까지 지원합니다`); // 54홀 골프장(9홀 코스 6개)도 발행
  if (c.defaultStimp != null && !(c.defaultStimp >= 6 && c.defaultStimp <= 15)) E('기본 그린 스피드(스팀프)는 6~15 사이여야 합니다');
  const ns = c.holes.map(h => h.n);
  ns.forEach((n, i) => { if (n !== i + 1) E(`홀 번호가 1부터 순서대로가 아닙니다 (${i + 1}번째 홀 = ${n})`); });
  const hd = c.holes.map(h => h.hdcp).filter(v => v != null && v !== '');
  if (hd.length) {
    if (hd.length !== c.holes.length) W(`핸디캡 순위가 ${c.holes.length - hd.length}개 홀에 비어 있습니다`);
    const dup = hd.filter((v, i) => hd.indexOf(v) !== i);
    if (dup.length) W(`핸디캡 순위 중복: ${[...new Set(dup)].join(', ')}`);
    if (hd.some(v => !(Number.isInteger(+v) && +v >= 1 && +v <= c.holes.length))) E(`핸디캡 순위는 1~${c.holes.length} 정수여야 합니다`);
  }
  for (const h of c.holes) {
    const n = h.n;
    if (![3, 4, 5, 6].includes(h.par)) E(`Par ${h.par}: 3~6만 가능`, n);
    // 지도 위치가 없는 홀(스코어카드만 있는 DB 코스 등)은 발행은 허용하고 경고: 앱에서 사용자가 그린을 눌러 지정
    if (!isLL(h.tee)) W('티 위치가 없습니다 (티샷 공략·티 거리 안내 불가)', n);
    if (!isLL(h.green)) W('그린 중앙 위치가 없습니다 (앱에서 사용자가 그린을 직접 지정해야 거리 안내 가능)', n);
    for (const k of ['front', 'back', 'ip']) if (h[k] != null && !isLL(h[k])) E(`${k} 좌표가 올바르지 않습니다`, n);
    if (isLL(h.tee) && isLL(h.green)) {
      const L = distance(h.tee, h.green), [lo, hi] = PAR_LEN[h.par] || [0, 1e9];
      if (L < lo || L > hi) W(`길이 ${Math.round(L)}m가 Par ${h.par} 일반 범위(${lo}~${hi}m)를 벗어납니다. 티·그린 위치를 확인하세요`, n);
      if (h.ip && isLL(h.ip) && distance(h.tee, h.ip) > L) W('IP(공략점)가 그린보다 멀리 있습니다', n);
    }
    // 스코어카드(KGBA DB 등) 거리와 지도 거리 대조: 티→(IP)→그린 경로 기준
    if (h.scorecard && isLL(h.green)) {
      const s = h.scorecard, conv = v => (v == null ? null : s.unit === 'yd' ? v * 0.9144 : v);
      const sets = [['white', h.tees?.white || h.tee, s.white], ['black', h.tees?.black, s.back], ['blue', h.tees?.blue, s.blue], ['red', h.tees?.red, s.red]];
      for (const [color, tp, card] of sets) {
        if (!isLL(tp) || card == null) continue;
        const route = isLL(h.ip) ? distance(tp, h.ip) + distance(h.ip, h.green) : distance(tp, h.green), cm = conv(card), diff = route - cm;
        if (Math.abs(diff) > Math.max(15, cm * 0.07)) W(`${TEE_SETS.find(t => t[0] === color)[1]} 티: 지도 ${Math.round(route)}m vs 스코어카드 ${Math.round(cm)}m (${diff > 0 ? '+' : ''}${Math.round(diff)}m) — 티·그린 위치를 확인하세요`, n);
      }
    }
    if (isLL(h.front) && isLL(h.back)) {
      const d = distance(h.front, h.back);
      if (d < 12 || d > 60) W(`그린 깊이 ${Math.round(d)}m: 일반 범위(12~60m) 밖입니다`, n);
      if (isLL(h.green) && Math.abs(distance(h.front, h.green) - distance(h.green, h.back)) > d * 0.45) W('그린 중앙이 앞·뒤의 가운데에서 많이 벗어나 있습니다', n);
    } else if (isLL(h.green)) W('그린 앞·뒤가 없어 그린 반경을 14m로 가정합니다 (핀 시트 입력 정확도 저하)', n);
    if (h.tees) for (const [k, p] of Object.entries(h.tees)) if (!isLL(p)) E(`${k} 티 좌표가 올바르지 않습니다`, n);
    for (const z of h.hazards || []) {
      if (!HAZARD_TYPES.includes(z.type)) E(`알 수 없는 해저드 종류 '${z.type}'`, n);
      if (!isLL(z)) E('해저드 좌표가 올바르지 않습니다', n);
      if (!(z.r >= 2 && z.r <= 200)) E(`해저드 반경 ${z.r}m: 2~200m만 가능`, n);
    }
    if (h.halfWidth != null && !(h.halfWidth >= 5 && h.halfWidth <= 60)) W(`페어웨이 반폭 ${h.halfWidth}m가 비정상적입니다`, n);
    if (h.greenGrid) {
      const g = h.greenGrid.grid, gv = validateGrid(g);
      if (gv) E('그린 격자: ' + gv, n);
      else if (!isLL(h.greenGrid.origin)) E('그린 격자 원점 좌표가 없습니다', n);
      else if (isLL(h.green) && distance(h.greenGrid.origin, h.green) > 15) W('그린 격자 원점이 그린 중앙에서 15m 이상 떨어져 있습니다', n);
      const vr = !gv && h.greenGrid.checks?.length ? verifyGrid(h.greenGrid.grid, h.greenGrid.checks) : null;
      if (vr?.n && !vr.pass) W(`그린맵 현장 검증 오차 RMS ${vr.rms.toFixed(2)}%p > 허용 ${GREEN_TOL_PCT}%p (측정점 ${vr.n}개) — 측량 데이터를 확인하세요`, n);
      else if (!gv && !h.greenGrid.checks?.length) W('그린맵 현장 검증(디지털 수평계 대조)이 아직 없습니다', n);
    } else W('사전 측량 그린맵이 없습니다 (현장 측정으로만 퍼팅 계산)', n);
  }
  if (!c.shelters?.length) W('낙뢰 대피소가 하나도 없습니다 (안전 화면에서 안내 불가)');
  return { errors, warnings, ok: !errors.length };
}

// 발행용 정리: 핀은 별도 파일(data/pins)로 관리하므로 제외, 앱 전용 필드 제거
export function stripForPublish(c) {
  const o = clone(c);
  delete o.demo; delete o.created;
  o.official = true;
  o.holes = o.holes.map(h => { const x = { ...h }; delete x.pin; if (x.greenGrid) x.greenGrid = { ...x.greenGrid, grid: roundGrid(x.greenGrid.grid) }; return x; });
  return o;
}

export function courseFile(c) { return { format: DATA_FORMATS.course, version: 1, course: c }; }
export function coursePath(id) { return `data/courses/${id}.json`; }
export function pinsPath(id) { return `data/pins/${id}.json`; }

export function catalogEntry(c) {
  const holes = c.holes || [];
  return {
    id: c.id, name: c.name, region: c.region || '', holes: holes.length, par: holes.reduce((a, h) => a + (h.par || 0), 0),
    length: Math.round(holes.reduce((a, h) => a + (holeLength(h) || 0), 0)),
    greens: holes.filter(h => h.greenGrid).length, rev: c.rev || 1, updatedAt: c.updatedAt || new Date().toISOString(), file: `courses/${c.id}.json`,
  };
}
export function upsertCatalog(catalog, entry) {
  const cat = catalog ? clone(catalog) : { format: DATA_FORMATS.catalog, version: 1, courses: [] };
  const i = cat.courses.findIndex(x => x.id === entry.id);
  if (i >= 0) cat.courses[i] = entry; else cat.courses.push(entry);
  cat.courses.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  cat.updatedAt = new Date().toISOString();
  return cat;
}
export function removeFromCatalog(catalog, id) {
  const cat = clone(catalog); cat.courses = cat.courses.filter(x => x.id !== id); cat.updatedAt = new Date().toISOString(); return cat;
}

// 변경 요약 (발행 전 확인용)
export function diffCourse(a, b) {
  if (!a) return [`새 코스 · ${b.holes.length}홀`];
  const out = [];
  for (const k of ['name', 'region', 'address', 'phone', 'defaultStimp']) if ((a[k] ?? '') !== (b[k] ?? '')) out.push(`${k}: ${a[k] ?? '—'} → ${b[k] ?? '—'}`);
  if (JSON.stringify(a.localRules || []) !== JSON.stringify(b.localRules || [])) out.push(`로컬 룰 ${a.localRules?.length || 0} → ${b.localRules?.length || 0}개`);
  if ((a.shelters?.length || 0) !== (b.shelters?.length || 0) || JSON.stringify(a.shelters) !== JSON.stringify(b.shelters)) out.push(`대피소 ${a.shelters?.length || 0} → ${b.shelters?.length || 0}개`);
  if (a.holes.length !== b.holes.length) out.push(`홀 수 ${a.holes.length} → ${b.holes.length}`);
  for (const h of b.holes) {
    const o = a.holes.find(x => x.n === h.n); if (!o) { out.push(`${h.n}번 홀 추가`); continue; }
    const ch = [];
    if (o.par !== h.par) ch.push(`Par ${o.par}→${h.par}`);
    if ((o.hdcp ?? null) !== (h.hdcp ?? null)) ch.push(`핸디캡 ${o.hdcp ?? '—'}→${h.hdcp ?? '—'}`);
    for (const k of ['tee', 'green', 'front', 'back', 'ip']) {
      if (!!o[k] !== !!h[k]) ch.push(`${k} ${h[k] ? '추가' : '삭제'}`);
      else if (o[k] && h[k] && distance(o[k], h[k]) > 0.5) ch.push(`${k} ${distance(o[k], h[k]).toFixed(1)}m 이동`);
    }
    if (JSON.stringify(o.tees || {}) !== JSON.stringify(h.tees || {})) ch.push('티 세트 변경');
    if ((o.hazards?.length || 0) !== (h.hazards?.length || 0)) ch.push(`해저드 ${o.hazards?.length || 0}→${h.hazards?.length || 0}`);
    else if (JSON.stringify(o.hazards) !== JSON.stringify(h.hazards)) ch.push('해저드 수정');
    if (!!o.greenGrid !== !!h.greenGrid) ch.push(`그린맵 ${h.greenGrid ? '추가' : '삭제'}`);
    else if (o.greenGrid && JSON.stringify(o.greenGrid) !== JSON.stringify(h.greenGrid)) ch.push('그린맵 교체');
    if ((o.note || '') !== (h.note || '')) ch.push('공략 메모');
    if ((o.halfWidth || 16) !== (h.halfWidth || 16)) ch.push(`반폭 ${o.halfWidth || 16}→${h.halfWidth || 16}m`);
    if (ch.length) out.push(`${h.n}번 홀: ${ch.join(', ')}`);
  }
  return out;
}

// ---------------- 핀 시트 ----------------
// 그린 축 = 그린 앞 → 뒤 (없으면 티 → 그린). 핀 시트 표기: 앞에서 depth m, 중앙선에서 오른쪽 + / 왼쪽 − side m
export function greenAxis(h) {
  if (isLL(h.front) && isLL(h.back)) return bearing(h.front, h.back);
  if (isLL(h.tee) && isLL(h.green)) return bearing(h.tee, h.green);
  return 0;
}
export function greenFront(h) { return isLL(h.front) ? h.front : destination(h.green, greenAxis(h) + 180, greenRadius(h) - 2); }
export function greenDepth(h) { return isLL(h.front) && isLL(h.back) ? distance(h.front, h.back) : (greenRadius(h) - 2) * 2; }
export function pinFromOffsets(h, { depth, side = 0 }) {
  const ax = greenAxis(h), p = destination(destination(greenFront(h), ax, depth), ax + 90, side);
  return { lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7) };
}
export function offsetsFromPin(h, pin) {
  const q = toLocal(greenFront(h), pin), a = greenAxis(h) * Math.PI / 180;
  const ux = Math.sin(a), uy = Math.cos(a); // 축 단위벡터 (동, 북)
  return { depth: q.x * ux + q.y * uy, side: q.x * uy - q.y * ux };
}
export function checkPin(h, pin) {
  if (!isLL(pin)) return { ok: false, msg: '좌표 없음' };
  if (!isLL(h.green)) return { ok: false, msg: '그린 중앙이 지정되지 않은 홀' };
  // 그린을 앞·뒤 지름의 원으로 근사 → 가장자리까지 거리
  const D = greenDepth(h), { depth, side } = offsetsFromPin(h, pin);
  const edge = D / 2 - Math.hypot(depth - D / 2, side);
  if (edge < -1) return { ok: false, edge, msg: `그린 밖 (가장자리 바깥 ${(-edge).toFixed(1)}m)` };
  if (edge < 3) return { ok: true, warn: true, edge, msg: `가장자리까지 ${Math.max(0, edge).toFixed(1)}m — 3m 이상 떨어뜨리는 것을 권장` };
  return { ok: true, edge, msg: `가장자리까지 ${edge.toFixed(1)}m` };
}
export function pinsFile({ courseId, date, stimp, holes, note = '' }) {
  return { format: DATA_FORMATS.pins, version: 1, courseId, date, stimp, note, updatedAt: new Date().toISOString(), holes };
}

// ---------------- 그린 높이 격자 ----------------
export const GRID_MAX_CELLS = 60000;
export function validateGrid(g) {
  if (!g) return '격자가 없습니다';
  const { nx, ny, dx, x0, y0, h } = g;
  if (!(Number.isInteger(nx) && Number.isInteger(ny) && nx >= 3 && ny >= 3)) return 'nx, ny는 3 이상 정수여야 합니다';
  if (nx * ny > GRID_MAX_CELLS) return `격자 셀 ${nx * ny}개: 최대 ${GRID_MAX_CELLS}개 (셀 크기를 키우세요)`;
  if (!(dx > 0.05 && dx <= 5)) return '셀 크기(dx)는 0.05~5m여야 합니다';
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return 'x0, y0가 숫자가 아닙니다';
  if (!Array.isArray(h) || h.length !== nx * ny) return `높이 값 개수 ${h?.length} ≠ nx×ny ${nx * ny}`;
  if (h.some(v => !Number.isFinite(v))) return '높이 값에 숫자가 아닌 항목이 있습니다';
  const span = Math.max(...h) - Math.min(...h);
  if (span > 5) return `그린 내 고저차 ${span.toFixed(2)}m: 단위(m)를 확인하세요 (cm·mm로 입력했을 수 있음)`;
  return null;
}
export function roundGrid(g) { return { ...g, h: g.h.map(v => Math.round(v * 1000) / 1000) }; }

function parseNums(line) { return line.split(/[,;\t ]+/).map(s => s.trim()).filter(Boolean).map(Number); }

// text: JSON 격자 | CSV 행렬(높이) | XYZ 점 목록(x,y,z 또는 위도,경도,높이)
// opts: { dx, rowOrder: 'north-first'|'south-first', origin: {lat,lon}(XYZ 위경도용), unit: 'm'|'cm'|'mm', cellSize(XYZ 리샘플) }
export function parseGridInput(text, opts = {}) {
  const t = String(text || '').trim();
  if (!t) throw new Error('입력이 비어 있습니다');
  const scale = { m: 1, cm: 0.01, mm: 0.001 }[opts.unit || 'm'];
  if (t[0] === '{') {
    const j = JSON.parse(t), g = j.grid || j.greenGrid?.grid || j;
    const grid = { x0: +g.x0, y0: +g.y0, dx: +g.dx, nx: +g.nx, ny: +g.ny, h: (g.h || []).map(v => +v * scale) };
    const err = validateGrid(grid); if (err) throw new Error(err);
    return { grid, kind: 'json', info: `JSON 격자 ${grid.nx}×${grid.ny}` };
  }
  const rows = t.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^[#a-z]/i.test(l)).map(parseNums);
  if (!rows.length) throw new Error('숫자 행이 없습니다');
  if (rows.some(r => r.some(v => !Number.isFinite(v)))) throw new Error('숫자가 아닌 값이 있습니다');
  const width = rows[0].length;
  const looksXYZ = width === 3 && rows.length >= 10 && !rows.every(r => r.length === width && rows.length === width);
  if (opts.mode === 'xyz' || (opts.mode !== 'matrix' && looksXYZ)) {
    if (width !== 3) throw new Error('XYZ 점 목록은 한 줄에 x,y,z(또는 위도,경도,높이) 3개 값이어야 합니다');
    return xyzToGrid(rows, opts, scale);
  }
  if (rows.some(r => r.length !== width)) throw new Error('행마다 값 개수가 다릅니다 (행렬 CSV는 모든 행의 열 수가 같아야 합니다)');
  const dx = +opts.dx || 0.5, ny = rows.length, nx = width;
  const ordered = (opts.rowOrder || 'north-first') === 'north-first' ? rows.slice().reverse() : rows; // 격자는 j=0이 남쪽
  const grid = { dx, nx, ny, x0: -((nx - 1) * dx) / 2, y0: -((ny - 1) * dx) / 2, h: ordered.flat().map(v => v * scale) };
  const err = validateGrid(grid); if (err) throw new Error(err);
  return { grid, kind: 'matrix', info: `높이 행렬 ${nx}×${ny} · 셀 ${dx}m · 그린 중앙 기준 배치` };
}

// 측량 점 → 정규 격자 (역거리 가중, 반경 내 최근접 12점)
export function xyzToGrid(rows, opts = {}, scale = 1) {
  const geo = rows.every(([a, b]) => Math.abs(a) <= 90 && Math.abs(b) <= 180 && (String(a).includes('.') || String(b).includes('.'))) && rows.some(([a]) => Math.abs(a) > 20);
  let pts;
  if (geo) {
    if (!isLL(opts.origin)) throw new Error('위경도 점을 쓰려면 그린 중앙(원점)이 지정되어 있어야 합니다');
    pts = rows.map(([lat, lon, z]) => ({ ...toLocal(opts.origin, { lat, lon }), z: z * scale }));
  } else pts = rows.map(([x, y, z]) => ({ x, y, z: z * scale }));
  const dx = +opts.cellSize || 0.5;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.floor(Math.min(...xs) / dx) * dx, y0 = Math.floor(Math.min(...ys) / dx) * dx;
  const nx = Math.round((Math.max(...xs) - x0) / dx) + 1, ny = Math.round((Math.max(...ys) - y0) / dx) + 1;
  if (nx * ny > GRID_MAX_CELLS) throw new Error(`격자가 너무 큽니다 (${nx}×${ny}). 셀 크기를 키우세요`);
  // 공간 버킷
  const B = 4 * dx, buckets = new Map(), key = (i, j) => i + ',' + j;
  for (const p of pts) { const k = key(Math.floor(p.x / B), Math.floor(p.y / B)); (buckets.get(k) || buckets.set(k, []).get(k)).push(p); }
  const h = new Array(nx * ny);
  let empty = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * dx, y = y0 + j * dx, bi = Math.floor(x / B), bj = Math.floor(y / B);
    let near = [];
    for (let r = 1; r <= 4 && near.length < 4; r++) {
      near = [];
      for (let a = bi - r; a <= bi + r; a++) for (let b = bj - r; b <= bj + r; b++) for (const p of buckets.get(key(a, b)) || []) near.push(p);
    }
    if (!near.length) { h[j * nx + i] = NaN; empty++; continue; }
    near.sort((p, q) => (p.x - x) ** 2 + (p.y - y) ** 2 - ((q.x - x) ** 2 + (q.y - y) ** 2));
    let ws = 0, zs = 0;
    for (const p of near.slice(0, 12)) {
      const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d2 < 1e-6) { ws = 1; zs = p.z; break; }
      const w = 1 / d2; ws += w; zs += w * p.z;
    }
    h[j * nx + i] = zs / ws;
  }
  // 점이 없는 칸은 이웃 평균으로 채움
  for (let pass = 0; pass < 20 && h.some(v => Number.isNaN(v)); pass++) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!Number.isNaN(h[j * nx + i])) continue;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => h[(j + b) * nx + i + a]).filter((v, k) => { const [a, b] = [[1, 0], [-1, 0], [0, 1], [0, -1]][k]; return i + a >= 0 && i + a < nx && j + b >= 0 && j + b < ny && Number.isFinite(v); });
      if (nb.length) h[j * nx + i] = nb.reduce((s, v) => s + v, 0) / nb.length;
    }
  }
  const grid = { x0, y0, dx, nx, ny, h };
  const err = validateGrid(grid); if (err) throw new Error(err);
  return { grid, kind: 'xyz', info: `측량 점 ${pts.length}개 → ${nx}×${ny} 격자 (셀 ${dx}m${geo ? ', 위경도 → 그린 중앙 기준' : ''}${empty ? `, 빈 칸 ${empty}개 보간` : ''})` };
}

export function gridStats(g) {
  const { nx, ny, dx, h } = g;
  let min = Infinity, max = -Infinity, sum = 0, n = 0, over3 = 0, maxS = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = h[j * nx + i]; min = Math.min(min, v); max = Math.max(max, v);
    const ip = Math.min(nx - 1, i + 1), im = Math.max(0, i - 1), jp = Math.min(ny - 1, j + 1), jm = Math.max(0, j - 1);
    const gx = (h[j * nx + ip] - h[j * nx + im]) / ((ip - im) * dx), gy = (h[jp * nx + i] - h[jm * nx + i]) / ((jp - jm) * dx);
    const s = Math.hypot(gx, gy) * 100; sum += s; n++; if (s > 3) over3++; if (s > maxS) maxS = s;
  }
  return { relief: max - min, meanSlope: sum / n, maxSlope: maxS, over3Pct: over3 / n * 100, width: (nx - 1) * dx, depth: (ny - 1) * dx, cells: nx * ny };
}

// ---------------- 라운드 리포트 ----------------
export function validateReport(r) {
  if (!r || r.format !== DATA_FORMATS.report) return '라운드 리포트 형식이 아닙니다';
  if (!Array.isArray(r.holes) || !r.holes.length) return '홀 기록이 없습니다';
  if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return '날짜가 없습니다';
  for (const h of r.holes) if (!Number.isInteger(h.n) || !(h.par >= 3 && h.par <= 6)) return '홀 번호/파가 올바르지 않습니다';
  return null;
}
export function reportKey(r) { return r.reportId || `${r.courseId}|${r.startedAt}|${r.holes.map(h => h.strokes).join('')}`; }

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// 홀 소요 시간(분): 다음 홀 도착 시각 − 이 홀 도착 시각 (마지막 홀은 라운드 종료 시각)
export function holeMinutes(r) {
  const out = {};
  const hs = r.holes.filter(h => Number.isFinite(h.arrivedAt)).sort((a, b) => a.arrivedAt - b.arrivedAt);
  hs.forEach((h, i) => {
    const next = hs[i + 1]?.arrivedAt ?? (r.endedAt && r.startedAt ? Date.parse(r.endedAt) - Date.parse(r.startedAt) : null);
    if (next == null) return;
    const m = (next - h.arrivedAt) / 60000;
    if (m >= 3 && m <= 45) out[h.n] = m; // 휴식(그늘집)·기록 누락은 제외
  });
  return out;
}

export function aggregateReports(reports, course = null) {
  const rs = reports.filter(r => r.mode !== 'practice');
  const holeNs = course ? course.holes.map(h => h.n) : [...new Set(rs.flatMap(r => r.holes.map(h => h.n)))].sort((a, b) => a - b);
  const parOf = n => course?.holes.find(h => h.n === n)?.par ?? rs.flatMap(r => r.holes).find(h => h.n === n)?.par ?? 4;
  const holes = holeNs.map(n => {
    const rec = rs.map(r => r.holes.find(h => h.n === n)).filter(h => h && h.strokes > 0);
    const mins = rs.map(r => holeMinutes(r)[n]).filter(v => v != null);
    const par = parOf(n), cnt = rec.length;
    const avg = k => cnt ? rec.reduce((a, h) => a + (h[k] || 0), 0) / cnt : null;
    const lostPts = rs.flatMap(r => (r.lost || []).filter(l => l.hole === n));
    return {
      n, par, rounds: cnt, avgStrokes: avg('strokes'), avgToPar: cnt ? avg('strokes') - par : null, avgPutts: avg('putts'),
      threePuttRate: cnt ? rec.filter(h => h.putts >= 3).length / cnt : null, lostPerRound: cnt ? rec.reduce((a, h) => a + (h.lost || 0), 0) / cnt : null,
      penaltiesPerRound: avg('penalties'), paceMedian: median(mins), paceP80: pct(mins, 0.8), paceN: mins.length, paceTarget: PACE_TARGET_MIN[par] || 15,
      birdieRate: cnt ? rec.filter(h => h.strokes < par).length / cnt : null, doubleRate: cnt ? rec.filter(h => h.strokes >= par + 2).length / cnt : null,
      lostPoints: lostPts,
    };
  });
  const ranked = holes.filter(h => h.avgToPar != null).sort((a, b) => b.avgToPar - a.avgToPar);
  ranked.forEach((h, i) => { h.difficultyRank = i + 1; });
  for (const h of holes) h.bottleneck = h.paceMedian != null && h.paceN >= 3 && h.paceMedian > h.paceTarget * 1.15;
  const full = rs.filter(r => r.holes.filter(h => h.strokes > 0).length === holeNs.length);
  const durations = rs.map(r => (r.endedAt && r.startedAt ? (Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 60000 : null)).filter(v => v && v > 30 && v < 600);
  const lostTotal = rs.reduce((a, r) => a + r.holes.reduce((b, h) => b + (h.lost || 0), 0), 0);
  const days = {}; for (const r of rs) days[r.date] = (days[r.date] || 0) + 1;
  return {
    rounds: rs.length, excludedPractice: reports.length - rs.length, fullRounds: full.length,
    avgToPar: full.length ? full.reduce((a, r) => a + r.holes.reduce((b, h) => b + h.strokes - h.par, 0), 0) / full.length : null,
    medianRoundMin: median(durations), lostPerRound: rs.length ? lostTotal / rs.length : null, lostTotal,
    lostFoundRate: (() => { const l = rs.flatMap(r => r.lost || []); return l.length ? l.filter(x => x.found).length / l.length : null; })(),
    holes, byDate: Object.entries(days).sort(), bottlenecks: holes.filter(h => h.bottleneck).map(h => h.n),
  };
}

export function reportsToCSV(agg) {
  const head = ['홀', 'Par', '라운드', '평균타수', '파대비', '평균퍼트', '3퍼트율', '라운드당분실', '진행중앙값(분)', '진행80%(분)', '목표(분)', '난이도순위', '병목'];
  const f = (v, d = 2) => (v == null ? '' : typeof v === 'number' ? v.toFixed(d) : v);
  const rows = agg.holes.map(h => [h.n, h.par, h.rounds, f(h.avgStrokes), f(h.avgToPar), f(h.avgPutts), f(h.threePuttRate), f(h.lostPerRound), f(h.paceMedian, 1), f(h.paceP80, 1), h.paceTarget, h.difficultyRank ?? '', h.bottleneck ? 'Y' : '']);
  return '﻿' + [head, ...rows].map(r => r.join(',')).join('\n');
}

// ---------------- 공지 ----------------
export const NOTICE_LEVELS = { info: '안내', warn: '주의', danger: '긴급' };
export function noticeActive(n, now = Date.now()) {
  const s = n.start ? Date.parse(n.start) : -Infinity, e = n.end ? Date.parse(n.end) : Infinity;
  return !n.disabled && now >= s && now <= e;
}
export function validateNotice(n) {
  if (!String(n.title || '').trim()) return '제목이 비어 있습니다';
  if (String(n.title).length > 60) return '제목은 60자 이내';
  if (String(n.body || '').length > 400) return '내용은 400자 이내';
  if (!NOTICE_LEVELS[n.level]) return '등급이 올바르지 않습니다';
  if (n.start && n.end && Date.parse(n.end) <= Date.parse(n.start)) return '종료 시각이 시작보다 빠릅니다';
  return null;
}
export function noticesFile(items) { return { format: DATA_FORMATS.notices, version: 1, updatedAt: new Date().toISOString(), items }; }

// ---------------- 그린맵 현장 검증 (기획서 PoC: 디지털 수평계 대조, 경사 오차 ±0.2%p) ----------------
// 측정값: 경사 pct(%)와 공이 흘러내리는 방향 dir(방위°, 0=북). 격자 경사와 벡터 오차를 비교
export function gridGradAt(g, x, y) {
  const { nx, ny, dx, x0, y0, h } = g;
  const at = (i, j) => h[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  const gr = (i, j) => [(at(i + 1, j) - at(i - 1, j)) / (2 * dx), (at(i, j + 1) - at(i, j - 1)) / (2 * dx)];
  let fx = (x - x0) / dx, fy = (y - y0) / dx; fx = Math.max(0, Math.min(nx - 1.0001, fx)); fy = Math.max(0, Math.min(ny - 1.0001, fy));
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const a = gr(i, j), b = gr(i + 1, j), c = gr(i, j + 1), d = gr(i + 1, j + 1);
  return [0, 1].map(k => (a[k] * (1 - tx) + b[k] * tx) * (1 - ty) + (c[k] * (1 - tx) + d[k] * tx) * ty);
}
export const GREEN_TOL_PCT = 0.2;
export function verifyGrid(g, checks = []) {
  const rows = checks.filter(c => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.pct) && Number.isFinite(c.dir)).map(c => {
    const [gx, gy] = gridGradAt(g, c.x, c.y), r = c.dir * Math.PI / 180;
    const mx = -Math.sin(r) * c.pct / 100, my = -Math.cos(r) * c.pct / 100; // 내리막 방향의 반대 = 경사(오르막) 벡터
    const err = Math.hypot(gx - mx, gy - my) * 100;
    const gridPct = Math.hypot(gx, gy) * 100, gridDir = (Math.atan2(-gx, -gy) * 180 / Math.PI + 360) % 360;
    return { ...c, gridPct, gridDir, err, pass: err <= GREEN_TOL_PCT };
  });
  if (!rows.length) return { n: 0, rows };
  const rms = Math.sqrt(rows.reduce((a, r) => a + r.err * r.err, 0) / rows.length);
  return { n: rows.length, rows, rms, max: Math.max(...rows.map(r => r.err)), pass: rms <= GREEN_TOL_PCT, enough: rows.length >= 5 };
}
