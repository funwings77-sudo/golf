// 📂 론치 모니터 기록 파일(CSV) 불러오기: 머리줄 찾기 · 열 자동 연결 · 단위 알아보기 · 클럽 이름 → 내 클럽
//  가민 R10(Garmin Golf 내보내기), 랩소도 MLM2PRO, 플라이트스코프, 트랙맨, 국산 기기(한글 열 이름)에서 흔히 쓰는 이름을 알아봄.
//  형식이 달라도 미리보기에서 열·단위·클럽을 직접 고칠 수 있게 '추측'만 하고 확정은 사람이 함.

// ---------- CSV 읽기 (따옴표 · 쉼표/세미콜론/탭 자동) ----------
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/).slice(0, 15).join('\n');
  const delim = [',', ';', '\t'].map(d => [d, (first.match(new RegExp(d === '\t' ? '\t' : d, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
}
// 깨진 글자(UTF-8로 못 읽은 한글)가 많으면 EUC-KR로 다시 읽기
export function decodeBytes(buf) {
  const u = new TextDecoder('utf-8').decode(buf);
  if ((u.match(/�/g) || []).length < 3) return u;
  try { return new TextDecoder('euc-kr').decode(buf); } catch { return u; }
}

// ---------- 열 이름 → 항목 ----------
// 앞에 있는 이름일수록 우선 (예: 백스핀이 있으면 전체 스핀보다 먼저)
export const ALIASES = {
  club: ['club name', 'club type', 'club', 'clubname', '클럽명', '클럽 종류', '클럽', '채'],
  date: ['date', 'date time', 'datetime', 'timestamp', 'time', 'shot time', '날짜', '일시', '시간'],
  ballSpeed: ['ball speed', 'ballspeed', 'ball', '볼 스피드', '볼스피드', '공 속도', '공속도', '볼속도', '볼 속도'],
  headSpeed: ['club speed', 'club head speed', 'clubhead speed', 'head speed', 'club', '헤드 스피드', '헤드스피드', '클럽 스피드', '클럽스피드', '헤드속도'],
  launchDeg: ['launch angle', 'vertical launch angle', 'launch v', 'vla', 'launch', '발사각', '발사 각도', '발사각도', '탄도각'],
  sideDeg: ['launch direction', 'horizontal launch angle', 'launch h', 'hla', 'direction', '발사 방향', '발사방향', '방향각', '좌우 방향'],
  spinRpm: ['backspin', 'back spin', 'spin rate', 'total spin', 'spin', '백스핀', '스핀량', '스핀'],
  carry: ['carry distance', 'carry', '캐리 거리', '캐리거리', '캐리'],
  total: ['total distance', 'total', 'distance', '비거리', '총거리', '총 거리', '토탈'],
  offlineM: ['carry deviation distance', 'side carry', 'carry side', 'lateral', 'offline', 'carry lateral', 'side', 'total deviation distance', '좌우 거리', '좌우편차', '편차', '좌우'],
  apex: ['apex height', 'apex', 'max height', 'peak height', 'height', '최고 높이', '최고높이', '타구 높이', '정점'],
};
export const FIELD_NAMES = { club: '클럽', date: '날짜', ballSpeed: '공 속도', headSpeed: '헤드 속도', launchDeg: '발사 각도', sideDeg: '좌우 방향(°)', spinRpm: '백스핀', carry: '캐리', total: '총거리', offlineM: '좌우 거리', apex: '최고 높이' };
const KIND = { ballSpeed: 'speed', headSpeed: 'speed', carry: 'dist', total: 'dist', offlineM: 'dist', apex: 'height', launchDeg: 'deg', sideDeg: 'deg', spinRpm: 'rpm' };

// 머리 글자에서 단위 꺼내기: "Ball Speed (mph)", "Carry [yds]", "캐리(m)"
export function unitIn(s) {
  const t = String(s || '').toLowerCase();
  if (/km\s*\/\s*h|kmh|kph/.test(t)) return 'kmh';
  if (/mph/.test(t)) return 'mph';
  if (/m\s*\/\s*s|mps/.test(t)) return 'ms';
  if (/yds|yards?|\byd\b/.test(t)) return 'yd';
  if (/\bft\b|feet|\bfeet\b/.test(t)) return 'ft';
  if (/\(m\)|\[m\]|\bmeters?\b|미터|\bm\b/.test(t)) return 'm';
  return null;
}
const norm = s => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9가-힣 ]/g, ' ').replace(/\s+/g, ' ').trim();

// 숫자 읽기: "12.3", "1,234", "5.2 L"(왼쪽 = −), "R 3", "-"
export function num(v) {
  if (v == null) return null;
  const t = String(v).trim(); if (!t || t === '-' || /^n\/?a$/i.test(t)) return null;
  const m = t.replace(/,(?=\d{3}\b)/g, '').match(/-?\d+(\.\d+)?/); if (!m) return null;
  let x = +m[0];
  if (/(^|\s|\d)(l|left|왼|좌)\b/i.test(t) || /^[lL좌왼]/.test(t)) x = -Math.abs(x);
  return x;
}

// 머리줄 찾기 (앞에 선수 이름·기기 정보 줄이 있어도): 알아보는 열 이름이 가장 많은 줄
export function findHeader(rows) {
  let best = { i: -1, n: 0 };
  rows.slice(0, 30).forEach((r, i) => {
    const n = r.filter(c => Object.values(ALIASES).some(a => a.includes(norm(c)))).length;
    if (n > best.n) best = { i, n };
  });
  return best.n >= 2 ? best.i : -1;
}

// 열 자동 연결: { field: 열 번호 }, 열마다 단위
export function autoMap(header, unitRow, body) {
  const N = header.map(norm), used = new Set(), map = {}, units = {};
  // 숫자 칸: "12.3", "-4", "1,234", "5.2 L", "R 3" (클럽 이름 "56°"·"7i"는 숫자 아님)
  const isNum = x => /^[-+]?\d[\d.,]*\s*(l|r|left|right|좌|우)?$/i.test(x) || /^(l|r|좌|우)\s*[-+]?\d[\d.,]*$/i.test(x);
  const numericRatio = j => { const v = body.slice(0, 20).map(r => r[j]).filter(x => x != null && x !== ''); return v.length ? v.filter(isNum).length / v.length : 0; };
  for (const [f, al] of Object.entries(ALIASES)) {
    for (const a of al) {
      const j = N.findIndex((n, k) => n === a && !used.has(k)
        && (f === 'club' ? numericRatio(k) < 0.5 : f === 'date' ? true : numericRatio(k) >= 0.5));
      if (j >= 0) { map[f] = j; used.add(j); break; }
    }
  }
  header.forEach((h, j) => { units[j] = unitIn(h) || unitIn(unitRow?.[j]) || null; });
  return { map, units };
}

// ---------- 클럽 이름 → 내 클럽 (D·3W·5W·4H·5i~9i·PW·GW·SW·LW), 퍼터는 null ----------
export function clubIdOf(name) {
  const t = String(name || '').toLowerCase().replace(/\s+/g, '');
  if (!t) return undefined;
  if (/putt|퍼터/.test(t)) return null;
  if (/driver|드라이버|^dr$|^1w$/.test(t)) return 'D';
  const deg = t.match(/(\d{2})(°|도|deg)?$/);
  const code = c => new RegExp(`(^|[^a-z])${c}([^a-z]|$)`).test(t); // "gapwedge" 속 'pw' 같은 우연한 일치 막기
  if (/gap|approach|갭|어프로치/.test(t) || code('gw') || code('aw')) return 'GW';
  if (/pitch|피칭/.test(t) || code('pw')) return 'PW';
  if (/sand|샌드/.test(t) || code('sw')) return 'SW';
  if (/lob|로브/.test(t) || code('lw')) return 'LW';
  let m = t.match(/(\d+)(w|wood|우드)/) || t.match(/(w|wood|우드)(\d+)/);
  if (m) { const n = +(m[1].match(/\d/) ? m[1] : m[2]); return n <= 3 ? '3W' : '5W'; }
  m = t.match(/(\d+)(h|hy|hybrid|하이브리드|유틸|ut)/) || t.match(/(h|hy|hybrid|하이브리드|유틸|ut)(\d+)/);
  if (m || /hybrid|하이브리드|유틸|rescue/.test(t)) return '4H';
  if (/fairway|wood|우드/.test(t)) return '3W';
  m = t.match(/(\d+)(i|iron|아이언|번)/) || t.match(/(i|iron)(\d+)/);
  if (m) { const n = +(m[1].match(/\d/) ? m[1] : m[2]); return n <= 4 ? '4H' : n >= 9 ? '9i' : `${n}i`; }
  if (/wedge|웨지/.test(t) && deg) { const d = +deg[1]; return d <= 48 ? 'PW' : d <= 52 ? 'GW' : d <= 57 ? 'SW' : 'LW'; }
  if (deg && /^\d{2}(°|도|deg)?$/.test(t)) { const d = +deg[1]; return d <= 48 ? 'PW' : d <= 52 ? 'GW' : d <= 57 ? 'SW' : 'LW'; }
  return undefined; // 모름 → 미리보기에서 고르게
}

// ---------- 파일 전체 해석 ----------
//  반환: { header, rows(본문), map, units, unitRowUsed, device(추측), clubNames: [이름…] }
export function readLaunchFile(text) {
  const rows = parseCSV(text);
  const hi = findHeader(rows);
  if (hi < 0) return { error: '열 이름을 찾지 못했어요. 론치 모니터 앱에서 CSV로 내보낸 파일인지 확인해 주세요.' };
  const header = rows[hi];
  // 머리줄 바로 아래가 단위 줄이면(가민: "[mph]" "[deg]"…) 단위로 쓰고 본문에서 뺌
  const next = rows[hi + 1] || [];
  const unitRowUsed = next.filter(c => /^\[.*\]$|^\(.*\)$|^(mph|km\/h|m\/s|yds?|m|ft|deg|°|rpm)$/i.test(c)).length >= 2;
  const body = rows.slice(hi + (unitRowUsed ? 2 : 1)).filter(r => r.length >= Math.min(3, header.length) && r.some(c => num(c) != null));
  const { map, units } = autoMap(header, unitRowUsed ? next : null, body);
  const all = rows.slice(0, hi).flat().join(' ') + ' ' + header.join(' ');
  const device = /garmin|가민/i.test(all) || header.some(h => /carry deviation/i.test(h)) ? 'Garmin' : /rapsodo|랩소도/i.test(all) ? 'Rapsodo' : /flightscope/i.test(all) || header.some(h => /^ball \(/i.test(h)) ? 'FlightScope' : /trackman/i.test(all) ? 'TrackMan' : /[가-힣]/.test(header.join('')) ? '국산 기기' : '';
  const clubNames = map.club != null ? [...new Set(body.map(r => r[map.club]).filter(Boolean))] : [];
  return { header, rows: body, map, units, unitRowUsed, device, clubNames };
}

// 단위 없는 열의 기본 단위(speed: kmh|mph|ms, dist: m|yd)로 변환해 샷 목록 만들기
//  opts: { map, units, speedUnit, distUnit, clubMap: {이름: id|null}, defaultClub, flipSide, device }
const SPD = { kmh: 1 / 3.6, mph: 1 / 2.23694, ms: 1 }, DST = { m: 1, yd: 0.9144, ft: 0.3048 };
export function toShots(file, { map = file.map, units = file.units, speedUnit = 'mph', distUnit = 'yd', clubMap = {}, defaultClub = null, flipSide = false, device = file.device } = {}) {
  const out = [], skipped = { noSpeed: 0, putter: 0, noClub: 0 };
  for (const r of file.rows) {
    const get = f => (map[f] == null ? null : num(r[map[f]]));
    const conv = (f, v) => {
      if (v == null) return null;
      const u = units[map[f]], k = KIND[f];
      if (k === 'speed') return v * (SPD[u] ?? SPD[speedUnit]);
      if (k === 'dist') return v * (DST[u] ?? DST[distUnit]);
      if (k === 'height') return v * (DST[u] ?? DST[distUnit]); // 높이도 거리 단위 (ft면 ft)
      return v;
    };
    const name = map.club != null ? r[map.club] : '';
    let club = defaultClub; // 클럽 열이 없는 파일은 '모든 샷의 클럽'
    if (map.club != null) {
      club = name in clubMap ? clubMap[name] : clubIdOf(name);
      if (club === null) { skipped.putter++; continue; } // 퍼터 · 빼기로 고른 이름
    }
    if (!club) { skipped.noClub++; continue; }
    const lm = {};
    for (const f of ['ballSpeed', 'headSpeed', 'launchDeg', 'sideDeg', 'spinRpm', 'carry', 'total', 'offlineM', 'apex']) {
      let v = conv(f, get(f)); if (v == null || !Number.isFinite(v)) continue;
      if (flipSide && (f === 'sideDeg' || f === 'offlineM')) v = -v;
      lm[f] = v;
    }
    if (!(lm.ballSpeed > 0)) { skipped.noSpeed++; continue; }
    if (device) lm.device = device;
    const dRaw = map.date != null ? r[map.date] : null, ts = dRaw ? Date.parse(dRaw.replace(/\./g, '-').replace(/-\s/g, '-')) : NaN;
    const key = [club, dRaw || '', lm.ballSpeed.toFixed(2), (lm.carry ?? 0).toFixed(1), (lm.launchDeg ?? '').toString()].join('|');
    out.push({ club, name, lm, ts: Number.isFinite(ts) ? ts : null, key });
  }
  return { shots: out, skipped };
}
