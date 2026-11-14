// KGBA 회원사 코스 DB 가져오기 (golf_courses.sql 덤프 · golf_courses.db SQLite)
//  스키마 (README 기준)
//   clubs: id, name, sido, sigungu, operation_type, total_holes, member_holes, public_holes, phone, address, homepage,
//          opened_year, course_layout, par_18, length_yards, fairway_grass, green_grass, architect,
//          greenfee_weekday, greenfee_weekend, cart_fee, caddie_fee, reservation, difficulty, features, facilities,
//          sources, checked_date, collection_status
//   holes: club_id, club_name, course_name, hole_no, par, handicap, tee_back, tee_champion_blue, tee_regular_white,
//          tee_lady_red, distance_unit, tee_names, hazards, green_notes, strategy, map_image_note, source_url,
//          checked_date, note, sheet_row
//  ※ 이 DB에는 GPS 좌표가 없습니다 → 스코어카드(파·핸디캡·티별 거리·공략)만 가져오고,
//    티·그린 위치는 코스 편집기(위성지도 · OSM 가져오기)에서 지정합니다.
import { newOfficialCourse, COURSE_ID_RE } from './model.js';

// ---------------- SQL 덤프 파서 (sqlite3 .dump 형식) ----------------
function tokenize(src) {
  const out = []; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '-' && src[i + 1] === '-') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'") { // 문자열 ('' = 따옴표)
      let s = ''; i++;
      for (;;) { const j = src.indexOf("'", i); if (j < 0) throw new Error('닫히지 않은 문자열'); s += src.slice(i, j); if (src[j + 1] === "'") { s += "'"; i = j + 2; } else { i = j + 1; break; } }
      out.push({ t: 'str', v: s }); continue;
    }
    if (c === '"' || c === '`' || c === '[') { // 따옴표 식별자
      const close = c === '[' ? ']' : c; let s = ''; i++;
      for (;;) { const j = src.indexOf(close, i); if (j < 0) throw new Error('닫히지 않은 식별자'); s += src.slice(i, j); if (close !== ']' && src[j + 1] === close) { s += close; i = j + 2; } else { i = j + 1; break; } }
      out.push({ t: 'id', v: s }); continue;
    }
    if ((c === 'X' || c === 'x') && src[i + 1] === "'") { const j = src.indexOf("'", i + 2); out.push({ t: 'blob', v: src.slice(i + 2, j) }); i = j + 1; continue; }
    if (/[0-9]/.test(c) || ((c === '-' || c === '+' || c === '.') && /[0-9.]/.test(src[i + 1] || ''))) {
      const m = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i, i + 40)); out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_\u0080-￿]/.test(c)) { const m = /^[A-Za-z_0-9\u0080-￿$]+/.exec(src.slice(i, i + 200)); out.push({ t: 'id', v: m[0], kw: m[0].toUpperCase() }); i += m[0].length; continue; }
    out.push({ t: 'p', v: c }); i++;
  }
  return out;
}

// 값 식: 문자열 | 숫자 | NULL | X'..' | replace(..)/char(..)/unistr(..) (sqlite 덤프의 줄바꿈 표현)
function evalValue(tk, p) {
  let v = evalPrimary(tk, p);
  while (tk[p.i]?.v === '|' && tk[p.i + 1]?.v === '|') { p.i += 2; v = String(v ?? '') + String(evalPrimary(tk, p) ?? ''); } // 문자열 연결 ||
  return v;
}
function evalPrimary(tk, p) {
  const k = tk[p.i];
  if (!k) throw new Error('값이 없습니다');
  if (k.t === 'p' && k.v === '-' && tk[p.i + 1]?.t === 'num') { p.i += 2; return -tk[p.i - 1].v; }
  p.i++;
  if (k.t === 'str' || k.t === 'num') return k.v;
  if (k.t === 'blob') return null;
  if (k.t === 'id') {
    if (k.kw === 'NULL') return null;
    if (k.kw === 'TRUE') return 1; if (k.kw === 'FALSE') return 0;
    if (tk[p.i]?.v === '(') {
      p.i++; const args = [];
      while (tk[p.i] && tk[p.i].v !== ')') { args.push(evalValue(tk, p)); if (tk[p.i]?.v === ',') p.i++; }
      p.i++;
      const f = k.kw;
      if (f === 'CHAR') return String.fromCharCode(...args.map(Number));
      if (f === 'REPLACE') return String(args[0] ?? '').split(String(args[1])).join(String(args[2] ?? ''));
      if (f === 'UNISTR') return String(args[0]).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      throw new Error('지원하지 않는 함수: ' + k.v);
    }
  }
  throw new Error('해석할 수 없는 값: ' + k.v);
}

export function parseSQLDump(text) {
  const tk = tokenize(String(text || '').replace(/^﻿/, ''));
  const tables = {};
  const skip = p => { let d = 0; while (p.i < tk.length) { const v = tk[p.i].v; if (tk[p.i].t === 'p') { if (v === '(') d++; else if (v === ')') d--; else if (v === ';' && d <= 0) { p.i++; return; } } p.i++; } };
  const p = { i: 0 };
  while (p.i < tk.length) {
    const a = tk[p.i];
    if (a.kw === 'CREATE' && tk[p.i + 1]?.kw === 'TABLE') {
      p.i += 2;
      if (tk[p.i]?.kw === 'IF') p.i += 3; // IF NOT EXISTS
      let name = tk[p.i++].v; if (tk[p.i]?.v === '.') { name = tk[p.i + 1].v; p.i += 2; }
      if (tk[p.i]?.v !== '(') { skip(p); continue; }
      p.i++;
      const cols = []; let d = 0, first = true;
      while (p.i < tk.length) {
        const k = tk[p.i];
        if (k.t === 'p' && k.v === '(') d++;
        else if (k.t === 'p' && k.v === ')') { if (d === 0) { p.i++; break; } d--; }
        else if (k.t === 'p' && k.v === ',' && d === 0) { first = true; p.i++; continue; }
        else if (first) { first = false; if (!['PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'CONSTRAINT'].includes(k.kw)) cols.push(k.v); }
        p.i++;
      }
      tables[name] = { columns: cols, rows: [] };
      skip(p); continue;
    }
    if (a.kw === 'INSERT') {
      p.i++;
      while (tk[p.i] && tk[p.i].kw !== 'INTO') p.i++; // OR REPLACE 등
      p.i++;
      let name = tk[p.i++].v; if (tk[p.i]?.v === '.') { name = tk[p.i + 1].v; p.i += 2; }
      const t = tables[name] || (tables[name] = { columns: [], rows: [] });
      let cols = t.columns;
      if (tk[p.i]?.v === '(') { p.i++; cols = []; while (tk[p.i].v !== ')') { if (tk[p.i].v !== ',') cols.push(tk[p.i].v); p.i++; } p.i++; }
      if (tk[p.i]?.kw !== 'VALUES') { skip(p); continue; }
      p.i++;
      for (;;) {
        if (tk[p.i]?.v !== '(') break;
        p.i++; const vals = [];
        while (tk[p.i] && tk[p.i].v !== ')') { vals.push(evalValue(tk, p)); if (tk[p.i]?.v === ',') p.i++; }
        p.i++;
        const row = {}; vals.forEach((v, j) => { row[cols[j] ?? `c${j}`] = v; }); t.rows.push(row);
        if (tk[p.i]?.v === ',') { p.i++; continue; }
        break;
      }
      skip(p); continue;
    }
    skip(p);
  }
  return tables;
}

// ---------------- SQLite 파일 (sql.js, 필요할 때만 CDN에서 로드) ----------------
const SQLJS = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
let sqlReady = null;
function loadSqlJs() {
  if (sqlReady) return sqlReady;
  sqlReady = new Promise((res, rej) => {
    if (globalThis.initSqlJs) return res(globalThis.initSqlJs);
    const s = document.createElement('script'); s.src = SQLJS + 'sql-wasm.js'; s.crossOrigin = 'anonymous';
    s.onload = () => res(globalThis.initSqlJs); s.onerror = () => { sqlReady = null; rej(new Error('sql.js를 불러오지 못했습니다 (인터넷 확인)')); };
    document.head.appendChild(s);
  }).then(init => init({ locateFile: f => SQLJS + f }));
  return sqlReady;
}
export async function readSQLiteFile(bytes) {
  const SQL = await loadSqlJs();
  const db = new SQL.Database(new Uint8Array(bytes));
  try {
    const tables = {};
    const names = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values.map(r => r[0]) || [];
    for (const name of names) {
      const r = db.exec(`SELECT * FROM "${name.replace(/"/g, '""')}"`)[0];
      tables[name] = { columns: r?.columns || [], rows: (r?.values || []).map(v => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))) };
    }
    return tables;
  } finally { db.close(); }
}
export const isSQLiteBytes = b => new TextDecoder().decode(new Uint8Array(b).slice(0, 15)) === 'SQLite format 3';

// ---------------- 정규화 · 코스 변환 ----------------
const num = v => { if (v == null || v === '') return null; const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const str = v => (v == null ? '' : String(v).trim());
export const YD = 0.9144;
export const unitOf = u => (/yd|yard|야드/i.test(String(u || '')) ? 'yd' : 'm');
export const toMeters = (v, unit) => (v == null ? null : unit === 'yd' ? v * YD : v);

export function normalizeKGBA(tables) {
  const clubsT = tables.clubs, holesT = tables.holes;
  if (!clubsT || !holesT) throw new Error(`clubs·holes 테이블이 없습니다 (찾은 테이블: ${Object.keys(tables).join(', ') || '없음'})`);
  const holesBy = new Map();
  for (const h of holesT.rows) {
    const id = num(h.club_id); if (id == null) continue;
    (holesBy.get(id) || holesBy.set(id, []).get(id)).push(h);
  }
  const clubs = clubsT.rows.map(c => {
    const id = num(c.id), hs = (holesBy.get(id) || []).slice().sort((a, b) => (num(a.sheet_row) ?? 0) - (num(b.sheet_row) ?? 0) || (num(a.hole_no) ?? 0) - (num(b.hole_no) ?? 0));
    const order = []; for (const h of hs) { const k = str(h.course_name) || '코스'; if (!order.includes(k)) order.push(k); }
    const nines = order.map(name => ({ name, holes: hs.filter(h => (str(h.course_name) || '코스') === name).sort((a, b) => (num(a.hole_no) ?? 0) - (num(b.hole_no) ?? 0)) }));
    return {
      id, name: str(c.name), sido: str(c.sido), sigungu: str(c.sigungu), status: str(c.collection_status) || '미수집',
      totalHoles: num(c.total_holes), par18: num(c.par_18), lengthYards: num(c.length_yards), raw: c, nines, holeCount: hs.length,
    };
  }).filter(c => c.id != null && c.name);
  return { clubs, holeRows: holesT.rows.length };
}

export function suggestId(club) { return `kgba-${club.id}`; }

// nines: 사용할 코스(9홀 묶음) 이름 목록 (기본 전체, 순서 유지)
export function clubToCourse(club, { id, name, nines } = {}) {
  id = (id || suggestId(club)).toLowerCase();
  if (!COURSE_ID_RE.test(id)) throw new Error('코스 ID 형식이 올바르지 않습니다');
  const use = (nines?.length ? club.nines.filter(x => nines.includes(x.name)) : club.nines).filter(x => x.holes.length);
  if (!use.length) throw new Error('가져올 홀 데이터가 없습니다 (수집 상태: ' + club.status + ')');
  const c = newOfficialCourse({ id, name: name || club.name, holes: 0 });
  const r = club.raw, warnings = [];
  c.region = [club.sido, club.sigungu].filter(Boolean).join(' ');
  c.address = str(r.address); c.phone = str(r.phone);
  c.info = {
    operationType: str(r.operation_type), totalHoles: num(r.total_holes), memberHoles: num(r.member_holes), publicHoles: num(r.public_holes),
    homepage: str(r.homepage), openedYear: num(r.opened_year), layout: str(r.course_layout), par18: num(r.par_18), lengthYards: num(r.length_yards),
    fairwayGrass: str(r.fairway_grass), greenGrass: str(r.green_grass), architect: str(r.architect),
    fees: { weekday: str(r.greenfee_weekday), weekend: str(r.greenfee_weekend), cart: str(r.cart_fee), caddie: str(r.caddie_fee) },
    reservation: str(r.reservation), difficulty: str(r.difficulty), features: str(r.features), facilities: str(r.facilities),
  };
  c.dataSources = [{ type: 'scorecard', provider: 'KGBA 회원사 코스 DB (골프장 홈페이지 수집)', license: '출처 표기', date: str(r.checked_date) || null, url: str(r.sources), note: `KGBA id ${club.id} · 수집 상태 ${club.status}` }];
  c.kgba = { clubId: club.id, name: club.name, nines: use.map(x => x.name) };
  let n = 0;
  c.holes = [];
  for (const nine of use) for (const h of nine.holes) {
    n++;
    const unit = unitOf(h.distance_unit), par = num(h.par);
    if (![3, 4, 5, 6].includes(par)) warnings.push(`${nine.name} ${num(h.hole_no)}번: 파 '${str(h.par) || '없음'}' → 4로 가정`);
    const card = { unit, back: num(h.tee_back), blue: num(h.tee_champion_blue), white: num(h.tee_regular_white), red: num(h.tee_lady_red), teeNames: str(h.tee_names), note: str(h.note) };
    const notes = [str(h.strategy), str(h.hazards) && `해저드: ${str(h.hazards)}`, str(h.green_notes) && `그린: ${str(h.green_notes)}`].filter(Boolean);
    c.holes.push({
      n, par: [3, 4, 5, 6].includes(par) ? par : 4, hdcp: null, hdcpCard: num(h.handicap), hazards: [], halfWidth: 16,
      note: notes.join(' · ').slice(0, 300), nine: use.length > 1 ? nine.name : null, nineHole: num(h.hole_no) ?? n, scorecard: card,
    });
  }
  // 핸디캡: 1..N 유일하면 그대로, 9홀 묶음별(1..9)이면 홀 수 기준 재배열 없이 카드값만 보관
  const hd = c.holes.map(h => h.hdcpCard);
  if (hd.every(v => Number.isInteger(v) && v >= 1 && v <= c.holes.length) && new Set(hd).size === hd.length) c.holes.forEach(h => { h.hdcp = h.hdcpCard; });
  else if (hd.some(v => v != null)) warnings.push('핸디캡 순위가 코스(9홀)별로 매겨져 있거나 중복이라 공식 핸디캡 칸은 비워 두었습니다 (카드 값은 보관)');
  if (use.length > 1) c.nines = use.map((x, i) => ({ name: x.name, holes: c.holes.filter(h => h.nine === x.name).map(h => h.n) }));
  if (club.totalHoles && club.totalHoles !== club.holeCount) warnings.push(`목록상 총 ${club.totalHoles}홀 · 수집된 홀 ${club.holeCount}개 (README 주의 사항 참고)`);
  return { course: c, warnings };
}

// 스코어카드 거리(m) — 티 세트 색 기준
export function cardMeters(h, color = 'white') {
  const s = h.scorecard; if (!s) return null;
  const key = { black: 'back', blue: 'blue', white: 'white', red: 'red' }[color] || 'white';
  return toMeters(s[key], s.unit);
}
