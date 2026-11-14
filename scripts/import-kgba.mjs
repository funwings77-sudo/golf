// KGBA 코스 DB → 앱 데이터 발행 파일 생성
//   node scripts/import-kgba.mjs <golf_courses.sql> [--geocode]
//   · data/clubs.json        : 209곳 골프장 목록(기본정보·요금·수집 상태·대략 위치)
//   · data/courses/kgba-*.json: 홀 데이터가 있는 골프장의 공식 코스(스코어카드: 파·핸디캡·티별 거리·공략)
//   · data/catalog.json      : 공식 코스 목록에 추가/갱신 (rev 증가)
//   --geocode : 주소로 대략 위치를 구해 scripts/kgba-geo.json에 캐시 (OSM Nominatim, 1초 1회, 골프장 이름·주소만 전송)
//   ※ DB에 GPS 좌표가 없어 티·그린 위치는 비어 있습니다 → 앱에서 그린을 한 번 눌러 지정하거나 관리자 편집기에서 지정
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = p => import(pathToFileURL(join(root, p)).href);
const K = await imp('js/admin/kgba.js');
const M = await imp('js/admin/model.js');

const src = process.argv[2];
if (!src || !existsSync(src)) { console.error('사용법: node scripts/import-kgba.mjs <golf_courses.sql> [--geocode]'); process.exit(1); }
const sql = readFileSync(src, 'utf8');
const { clubs, holeRows } = K.normalizeKGBA(K.parseSQLDump(sql));
const srcHash = createHash('sha256').update(sql).digest('hex').slice(0, 12);
console.log(`DB: 골프장 ${clubs.length}곳 · 홀 ${holeRows}행 · 홀 데이터 있는 곳 ${clubs.filter(c => c.holeCount).length}곳`);

// ---------- 대략 위치 (주소 → 시군구 순으로 시도) ----------
const geoFile = join(root, 'scripts', 'kgba-geo.json');
const geo = existsSync(geoFile) ? JSON.parse(readFileSync(geoFile, 'utf8')) : {};
if (process.argv.includes('--geocode')) {
  const UA = { 'User-Agent': 'PinPoint-course-import/1.0' };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const search = async q => { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(q)}`, { headers: UA }); await sleep(1100); return r.ok ? r.json() : []; };
  for (const c of clubs) {
    if (geo[c.id]?.lat) continue;
    const r = c.raw, addr = String(r.address || '').replace(/\(.*?\)/g, '').replace(/\s+\d+(-\d+)?\s*$/, m => m).trim();
    let hit = null, how = null;
    // 1) 골프장 이름 (같은 시군구일 때만 인정 — 다른 골프장이 잡히는 것 방지)
    for (const q of [`${c.name} 컨트리클럽 ${c.sigungu}`, `${c.name} 골프 ${c.sigungu}`]) {
      const l = (await search(q)).filter(x => x.type === 'golf_course' && x.display_name.includes(c.sigungu.slice(0, 2)) && x.display_name.replace(/\s/g, '').includes(c.name.replace(/\s/g, '').slice(0, 2)));
      if (l.length) { hit = l[0]; how = 'golf_course'; break; }
    }
    // 2) 주소
    if (!hit && addr) { const l = await search(addr); if (l.length) { hit = l[0]; how = 'address'; } }
    // 3) 시군구 중심
    if (!hit && c.sigungu) { const l = await search(`${c.sido} ${c.sigungu}`); if (l.length) { hit = l[0]; how = 'sigungu'; } }
    geo[c.id] = hit ? { lat: +(+hit.lat).toFixed(6), lon: +(+hit.lon).toFixed(6), how, label: hit.display_name.split(',').slice(0, 3).join(',') } : { lat: null, how: 'none' };
    writeFileSync(geoFile, JSON.stringify(geo, null, 1));
    console.log(`위치 ${c.id} ${c.name}: ${geo[c.id].how}`);
  }
}

// ---------- 공식 코스 (홀 데이터가 있는 곳) ----------
const catPath = join(root, 'data', 'catalog.json');
let catalog = existsSync(catPath) ? JSON.parse(readFileSync(catPath, 'utf8')) : null;
const issues = [];
for (const c of clubs.filter(x => x.holeCount)) {
  const id = K.suggestId(c), path = join(root, M.coursePath(id));
  const prev = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).course : null;
  const { course, warnings } = K.clubToCourse(c, { id });
  // 9·18홀 코스 묶음 단위로 핸디캡 순위가 맞으면 묶음 안에서 사용 (표시용)
  if (course.nines) for (const nine of course.nines) {
    const hs = nine.holes.map(n => course.holes.find(h => h.n === n)), v = hs.map(h => h.hdcpCard);
    if (v.every(x => Number.isInteger(x)) && new Set(v).size === v.length) hs.forEach(h => { h.hdcpNine = h.hdcpCard; });
  }
  const g = geo[c.id];
  if (g?.lat) course.center = { lat: g.lat, lon: g.lon, precision: g.how };
  // 이전에 관리자가 지정한 위치(티·그린 등)·그린맵은 보존
  if (prev) for (const h of course.holes) {
    const o = prev.holes.find(x => x.n === h.n && (x.nine || null) === (h.nine || null)); if (!o) continue;
    for (const k of ['tee', 'tees', 'green', 'front', 'back', 'ip', 'greenGrid']) if (o[k]) h[k] = o[k];
    if (o.hazards?.length) h.hazards = o.hazards;
  }
  if (prev?.shelters?.length) course.shelters = prev.shelters;
  if (prev?.localRules?.length) course.localRules = prev.localRules;
  const same = prev && JSON.stringify({ ...prev, rev: 0, updatedAt: 0 }) === JSON.stringify({ ...M.stripForPublish(course), rev: 0, updatedAt: 0, kgba: { ...course.kgba, srcHash }, official: true });
  const out = { ...M.stripForPublish(course), kgba: { ...course.kgba, srcHash }, rev: same ? prev.rev : (prev?.rev || 0) + 1, updatedAt: same ? prev.updatedAt : new Date().toISOString() };
  writeFileSync(path, JSON.stringify(M.courseFile(out), null, 1) + '\n');
  const entry = M.catalogEntry(out);
  entry.geometry = out.holes.every(h => h.tee && h.green) ? 'complete' : out.holes.some(h => h.green) ? 'partial' : 'none';
  entry.source = 'KGBA';
  catalog = M.upsertCatalog(catalog, entry);
  if (warnings.length) issues.push(`${c.name}: ${warnings.join(' / ')}`);
}
writeFileSync(catPath, JSON.stringify(catalog, null, 1) + '\n');

// ---------- 골프장 목록 (209곳) ----------
const s = v => (v == null ? '' : String(v).trim());
const list = clubs.map(c => {
  const r = c.raw, g = geo[c.id];
  return {
    id: c.id, name: c.name, sido: c.sido, sigungu: c.sigungu, status: c.status, holes: c.totalHoles, collected: c.holeCount,
    courses: c.nines.map(n => n.name), official: c.holeCount ? K.suggestId(c) : null,
    type: s(r.operation_type), phone: s(r.phone), address: s(r.address), homepage: s(r.homepage), opened: s(r.opened_year), layout: s(r.course_layout),
    par: r.par_18 ?? null, yards: r.length_yards ?? null, grass: [s(r.fairway_grass), s(r.green_grass)].filter(Boolean).join(' / '), architect: s(r.architect),
    fee: { weekday: s(r.greenfee_weekday), weekend: s(r.greenfee_weekend), cart: s(r.cart_fee), caddie: s(r.caddie_fee) }, reservation: s(r.reservation),
    difficulty: s(r.difficulty), checked: s(r.checked_date),
    ...(g?.lat ? { lat: g.lat, lon: g.lon, loc: g.how } : {}),
  };
});
writeFileSync(join(root, 'data', 'clubs.json'), JSON.stringify({ format: 'pinpoint-clubs', version: 1, source: 'KGBA 회원사 코스 DB (골프장 홈페이지 수집)', srcHash, updatedAt: new Date().toISOString(), clubs: list }, null, 0) + '\n');
console.log(`발행 파일: 공식 코스 ${clubs.filter(c => c.holeCount).length}개 · 골프장 목록 ${list.length}곳 · 위치 ${list.filter(x => x.lat).length}곳`);
if (issues.length) console.log('확인 사항:\n  ' + issues.join('\n  '));
