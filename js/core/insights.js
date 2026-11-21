// 내 숫자 알기 (기획서 ①~⑥을 쉬운 말 한 줄로): DOM 없이 계산만 — 화면은 views에서
//  ② 클럽 거리 분포(10번 중 8번 범위)·믿음 정도·웨지 표·스크린 거리로 시작 · 날씨를 뺀 '표준 거리'
//  ③ 친 직후 OB 가능성 → 잠정구 안내
//  ④ 오늘 컨디션 한 줄 (추위·바람·그린 빠르기) · 체감 거리 이유
//  ⑤ 이번 라운드 가장 아쉬운 곳 → 레슨 영상·연습 → 다음 라운드 변화
//  ⑥ 이 홀 지난 기록 한 줄 · 홀별 공략 미리 보기
import { clubType, simulateFlight, RHO_STD } from '../physics/flight.js';

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const quant = (sorted, q) => { if (!sorted.length) return null; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };
const r1 = v => Math.round(v * 10) / 10;

// ---------- ② 날씨를 뺀 표준 거리 ----------
// 추운 날·맞바람에 친 샷을 그대로 평균 내면 '내 거리'가 짧게 굳고, 추천은 날씨를 또 빼서 두 번 짧아짐.
// 그래서 잰 거리로 풀어 낸 공 속도·발사각·스핀을 표준 조건(20°C·바람 없음)에서 다시 날려 캐리를 구함
export function stdCarry(shot) {
  const e = shot?.fit?.est;
  if (!e || !(e.ballSpeed > 0) || shot.lm) return shot?.carry ?? null;
  const ct = clubType(shot.club) || clubType('7i');
  try {
    const r = simulateFlight({ speed: e.ballSpeed, launchDeg: e.launchDeg ?? ct.launch, spinRpm: e.spinRpm ?? ct.spin, rho: RHO_STD, dt: 0.01 });
    const c = r.carry ?? r.y;
    return Number.isFinite(c) && c > 0 ? r1(c) : shot.carry;
  } catch { return shot.carry; }
}
export const carryOf = s => s.stdCarry ?? s.carry;

// ---------- ② 믿음 정도 (샷 수) ----------
export function trustLevel(n) {
  if (n >= 15) return { dots: 4, word: '잘 알아요' };
  if (n >= 8) return { dots: 3, word: '꽤 알아요' };
  if (n >= 3) return { dots: 2, word: '조금 알아요' };
  if (n >= 1) return { dots: 1, word: '이제 배우는 중' };
  return { dots: 0, word: '아직 어림' };
}
export const dots = d => '●'.repeat(d) + '○'.repeat(4 - d);

// ---------- ② 10번 중 8번은 이 범위 (P10~P90) ----------
//  샷이 5개 이상이면 내 샷으로, 그 전에는 클럽 평균 퍼짐으로 어림
export function clubRange(club, shots) {
  const list = shots.filter(s => s.club === club.id && !s.excluded && !s.partial && s.carry > 10);
  const c = list.map(carryOf).filter(Number.isFinite).sort((a, b) => a - b);
  const t = list.map(s => s.total).filter(Number.isFinite).sort((a, b) => a - b);
  const trust = trustLevel(list.length);
  if (c.length >= 5) return { n: c.length, src: 'shots', lo: Math.round(quant(c, 0.1)), hi: Math.round(quant(c, 0.9)), mid: Math.round(quant(c, 0.5)), total: t.length ? Math.round(quant(t, 0.5)) : null, trust };
  const sd = club.sdDist ?? clubType(club.id)?.sdDist ?? 0.07, k = 1.2816 * sd;
  const roll = clubType(club.id)?.roll ?? 0.03;
  return { n: c.length, src: 'guess', lo: Math.round(club.carry * (1 - k)), hi: Math.round(club.carry * (1 + k)), mid: Math.round(club.carry), total: Math.round(club.carry * (1 + roll)), trust };
}

// ---------- ② 웨지 표: 로프트 × 스윙 크기 ----------
//  스윙 크기는 플레이 화면이 말하는 것과 같은 띠 (advice.js swingWords): 끝까지(≥90%) · 어깨 10시(68~90%) · 허리 9시(45~68%)
export const SWINGS = [
  { k: 'full', label: '끝까지', sub: '풀스윙', lo: 90, hi: 101, pct: 100 },
  { k: 'ten', label: '어깨까지', sub: '10시', lo: 68, hi: 90, pct: 75 },
  { k: 'nine', label: '허리까지', sub: '9시', lo: 45, hi: 68, pct: 59 },
];
const WEDGES = ['9i', 'PW', 'GW', 'SW', 'LW'];
export function wedgeMatrix(bag, shots) {
  const clubs = bag.filter(c => c.enabled && WEDGES.includes(c.id) && c.carry > 0).sort((a, b) => b.carry - a.carry);
  return clubs.filter(c => c.id !== '9i' || clubs.length < 3).map(c => ({
    id: c.id, name: c.name,
    cells: SWINGS.map(sw => {
      const pool = shots.filter(s => s.club === c.id && !s.excluded && s.carry > 5 && (s.power ?? 100) >= sw.lo && (s.power ?? 100) < sw.hi && (sw.k === 'full' ? !s.partial : true));
      const v = pool.map(carryOf).filter(Number.isFinite).sort((a, b) => a - b);
      return v.length >= 2 ? { v: Math.round(quant(v, 0.5)), n: v.length, src: 'shots' } : { v: Math.round(c.carry * sw.pct / 100), n: v.length, src: 'guess' };
    }),
  }));
}

// ---------- ② 스크린 거리로 시작 ----------
//  스크린(매트·바람 없음·런 설정)은 필드보다 길게 나오기 쉬움 → 필드 예상 = 스크린 × 0.94 (기본 가정, 샷이 쌓이면 실제 거리로 바뀜)
export const SCREEN_TO_FIELD = 0.94;
export function fromScreen(bag, screenCarry, refId = '7i') {
  const ref = bag.find(c => c.id === refId) || bag.find(c => c.id === '7i');
  if (!ref || !(screenCarry > 30)) return { bag, changed: 0, field: null };
  const field = Math.round(screenCarry * SCREEN_TO_FIELD), k = field / ref.carry;
  let changed = 0;
  const out = bag.map(c => {
    if (c.learned || !(c.carry > 0)) return c; // 이미 필드 샷으로 배운 클럽은 그대로
    changed++;
    const carry = Math.max(10, Math.round(c.carry * k));
    return { ...c, carry, priorCarry: carry };
  });
  return { bag: out, changed, field };
}
// 스크린과 필드 차이: '스크린보다 7번 기준 약 8m 짧아요'
export function screenGap(bag, screen) {
  if (!screen?.carry) return null;
  const c = bag.find(x => x.id === (screen.club || '7i'));
  if (!c?.learned) return null;
  const d = Math.round(c.carry - screen.carry);
  return { club: c.name, d, text: Math.abs(d) < 3 ? `${c.name}는 스크린과 필드 거리가 거의 같아요` : `필드에서는 스크린보다 ${c.name} 기준 약 ${Math.abs(d)}m ${d < 0 ? '짧아요' : '길어요'}` };
}

// ---------- ③ 친 직후: OB·숲으로 갔을 수 있으면 잠정구 ----------
//  est: lostball.estimateLanding 결과(로컬 좌표), hazards: 같은 로컬 좌표의 해저드
//  물(페널티 구역)은 잠정구 대상이 아님 (규칙 18.3) → OB·숲만
export function provisionalRisk(est, hazards = []) {
  const zones = hazards.filter(z => z.type === 'ob' || z.type === 'trees');
  if (!est?.parts?.length || !zones.length) return { p: 0, kind: null };
  let mOB = 0, mTr = 0;
  for (const p of est.parts) {
    const z = zones.find(q => Math.hypot(p.x - q.x, p.y - q.y) <= q.r);
    if (z) { if (z.type === 'ob') mOB += p.w; else mTr += p.w; }
  }
  const p = mOB + mTr;
  return { p, kind: p < 0.25 ? null : mOB >= mTr ? 'ob' : 'trees' };
}

// ---------- ④ 오늘 컨디션 한 줄 ----------
//  기온: 20°C 기준 1°C에 0.22% (weather.js playsLike와 같은 식) · 7번 아이언 거리로 말함
export function conditionBrief(weather, bag, greenToday = null) {
  const out = [];
  if (weather && Number.isFinite(weather.temp)) {
    const c7 = bag.find(c => c.id === '7i' && c.enabled) || bag.filter(c => c.enabled).sort((a, b) => Math.abs(a.carry - 130) - Math.abs(b.carry - 130))[0];
    const base = c7?.carry || 130, d = Math.round(base * 0.0022 * (20 - weather.temp));
    const T = Math.round(weather.temp);
    if (d >= 6) out.push({ i: '🥶', t: `${T}°C · 추워서 공이 약 ${d}m 덜 날아가요`, s: '평소보다 한 클럽 길게 잡아요 (추천에는 이미 넣었어요)' });
    else if (d >= 3) out.push({ i: '🧥', t: `${T}°C · 쌀쌀해서 공이 약 ${d}m 덜 날아가요`, s: '조금 길게 잡아요 (추천에는 이미 넣었어요)' });
    else if (d <= -3) out.push({ i: '☀️', t: `${T}°C · 더워서 공이 약 ${-d}m 더 날아가요`, s: '그린을 넘기지 않게 조심해요' });
    else out.push({ i: '🙂', t: `${T}°C · 평소 거리 그대로 쳐도 돼요`, s: '' });
  }
  if (weather && weather.windSpeed >= 3) {
    const w = Math.round(weather.windSpeed), g = weather.gust >= weather.windSpeed + 4 ? ` (돌풍 ${Math.round(weather.gust)}m/s)` : '';
    out.push(w >= 7 ? { i: '🌬️', t: `바람이 강해요 · ${w}m/s${g}`, s: '맞바람이면 한두 클럽 길게 · 낮게 치면 덜 흔들려요' }
      : { i: '💨', t: `바람이 조금 있어요 · ${w}m/s${g}`, s: '홀마다 바람까지 넣어서 클럽을 골라 드려요' });
  }
  if (greenToday?.stimp) {
    const s = greenToday.stimp, word = s >= 11 ? '빨라요' : s <= 8.5 ? '느려요' : '보통이에요';
    out.push({ i: '🟢', t: `오늘 그린은 ${word}${greenToday.src === 'club' ? ' (골프장 발표)' : greenToday.n ? ` (퍼트 ${greenToday.n}번 결과)` : ''}`, s: s >= 11 ? '퍼트는 평소보다 살살' : s <= 8.5 ? '퍼트는 평소보다 조금 세게' : '' });
  }
  return out;
}

// 체감 거리 이유: '체감 152m · 추워서 +5 · 맞바람 +7 · 오르막 +2'  (3m 넘게 다를 때만)
export function playsWhy(D, pl) {
  if (!pl || !Number.isFinite(pl.total) || Math.abs(pl.total - D) < 3) return null;
  const p = pl.parts || {}, bits = [];
  const add = (v, pos, neg) => { if (Math.abs(v) >= 1.5) bits.push(`${v > 0 ? pos : neg} ${v > 0 ? '+' : '−'}${Math.round(Math.abs(v))}`); };
  add(p.wind || 0, '맞바람', '뒷바람');
  add(p.temp || 0, '추워서', '더워서');
  add(p.elev || 0, '오르막', '내리막');
  add(p.alt || 0, '높은 곳', '높은 곳');
  return { total: Math.round(pl.total), text: `체감 ${Math.round(pl.total)}m${bits.length ? ' · ' + bits.join(' · ') : ''}` };
}

// ---------- ⑥ 이 홀 지난 기록 ----------
export function holeHistory(rounds, courseId, holeN, hand = 'R') {
  const rs = rounds.filter(r => r.mode !== 'practice' && r.courseId === courseId);
  const rows = [];
  for (const r of rs) { const h = r.holes.find(x => x.n === holeN); const sc = h?.scores?.[0]; if (sc?.strokes) rows.push({ sc, par: h.par, date: r.date }); }
  if (!rows.length) return null;
  const par = rows[0].par, st = rows.map(x => x.sc.strokes), avg = mean(st);
  const pen = rows.reduce((a, x) => a + (x.sc.penalties || 0), 0), lost = rows.reduce((a, x) => a + (x.sc.lost || 0), 0);
  const fw = { L: 0, C: 0, R: 0, n: 0 }; for (const x of rows) if (x.sc.fw) { fw[x.sc.fw]++; fw.n++; }
  const three = rows.filter(x => x.sc.putts >= 3).length;
  const bits = [`지난 ${rows.length}번 평균 ${r1(avg)}타`];
  if (pen + lost) bits.push(`벌타·분실 ${pen + lost}번`);
  let tip = null, miss = null;
  if (fw.n >= 2 && Math.max(fw.L, fw.R) / fw.n >= 0.5 && Math.max(fw.L, fw.R) >= 2) {
    miss = fw.R >= fw.L ? 'R' : 'L';
    tip = `티샷이 ${miss === 'R' ? '오른쪽' : '왼쪽'}으로 자주 갔어요 → 페어웨이 ${miss === 'R' ? '왼쪽' : '오른쪽'}을 보고 쳐요`;
  } else if (pen + lost >= 2) tip = '여기서 공을 자주 잃었어요 → 짧은 클럽으로 안전하게';
  else if (three >= 2) tip = '이 그린에서 3번 퍼트가 잦았어요 → 첫 퍼트는 홀 근처에 붙이기만';
  else if (avg - par <= 0.4) tip = '잘 치는 홀이에요 → 자신 있게';
  return { n: rows.length, par, avg, best: Math.min(...st), pen, lost, fw, three, miss, tip, text: bits.join(' · ') };
}

// 홀별 공략 미리 보기: 지키는 홀 / 노려 볼 홀 / 보통 + 한 줄
export function roundBriefing(course, holeNs, rounds) {
  const holes = holeNs.map(n => course.holes.find(h => h.n === n)).filter(Boolean);
  return holes.map(h => {
    const hist = holeHistory(rounds, course.id, h.n), hd = h.hdcpNine ?? h.hdcp ?? h.hdcpCard;
    const hard = (hd != null && hd <= (h.hdcpNine != null ? 2 : 4)) || (hist && hist.avg - h.par >= 1.6) || (hist && hist.pen + hist.lost >= 2);
    const easy = !hard && (h.par === 5 || (hist && hist.avg - h.par <= 0.6) || (hd != null && hd >= (h.hdcpNine != null ? 8 : 15)));
    const tag = hard ? 'safe' : easy ? 'attack' : 'normal';
    const line = h.memo || hist?.tip || (tag === 'safe' ? '어려운 홀이에요 → 무리하지 말고 보기로 지켜요' : tag === 'attack' ? (h.par === 5 ? '긴 홀이지만 넓어요 → 파를 노려 봐요' : '쉬운 편이에요 → 파를 노려 봐요') : h.par === 3 ? '그린 가운데를 보고 한 번에 올려요' : '페어웨이에 먼저 올리는 게 먼저예요');
    return { n: h.n, label: h.nine ? `${h.nine} ${h.nineHole}` : String(h.n), par: h.par, hd, tag, line, hist };
  });
}

// ---------- ⑤ 영역별 실력 (일반 아마추어 평균표와 비교) ----------
//  핸디캡 0·10·20·30: 페어웨이 안착 · 그린 적중(GIR) · 그린 놓친 뒤 파(스크램블) · 홀당 퍼트
export const BENCH = { fw: [0.60, 0.50, 0.42, 0.35], gir: [0.65, 0.40, 0.20, 0.08], scr: [0.55, 0.35, 0.20, 0.10], putt: [1.75, 1.85, 1.95, 2.05] };
export function toHcp(key, v) {
  const xs = [0, 10, 20, 30], dir = key === 'putt' ? 1 : -1, g = BENCH[key].map(x => x * dir), gv = v * dir;
  if (gv <= g[0]) return 0;
  for (let i = 1; i < 4; i++) if (gv <= g[i]) return xs[i - 1] + (gv - g[i - 1]) / (g[i] - g[i - 1]) * 10;
  return Math.min(36, 30 + (gv - g[3]) / (g[3] - g[2]) * 10);
}
export function benchAt(key, hcp) { // 핸디캡 hcp인 사람의 평균값 (직선 보간)
  const h = Math.max(0, Math.min(30, hcp)), i = Math.min(2, Math.floor(h / 10)), t = (h - i * 10) / 10, b = BENCH[key];
  return b[i] + (b[i + 1] - b[i]) * t;
}
export function areaStats(rounds, min = { fw: 5, gir: 9, scr: 6, putt: 9 }) {
  let fwN = 0, fwY = 0, girN = 0, girY = 0, scrN = 0, scrY = 0, pN = 0, pS = 0;
  for (const r of rounds) for (const h of r.holes) {
    const sc = h.scores?.[0]; if (!sc?.strokes) continue;
    if (sc.fw && h.par >= 4) { fwN++; if (sc.fw === 'C') fwY++; }
    if (sc.putts > 0) {
      pN++; pS += sc.putts;
      const gir = sc.strokes - sc.putts <= h.par - 2; girN++; if (gir) girY++;
      else { scrN++; if (sc.strokes <= h.par) scrY++; }
    }
  }
  const out = {};
  if (fwN >= min.fw) out.fw = { v: fwY / fwN, n: fwN, txt: `${Math.round(fwY / fwN * 100)}%` };
  if (girN >= min.gir) out.gir = { v: girY / girN, n: girN, txt: `${Math.round(girY / girN * 100)}%` };
  if (scrN >= min.scr) out.scr = { v: scrY / scrN, n: scrN, txt: `${Math.round(scrY / scrN * 100)}%` };
  if (pN >= min.putt) out.putt = { v: pS / pN, n: pN, txt: (pS / pN).toFixed(2) };
  for (const k in out) out[k].hcp = toHcp(k, out[k].v);
  return out;
}

// ---------- ⑤ 레슨 영상·연습 (영역 → 유튜브 검색 + 측정 가능한 연습) ----------
const yt = q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
export const LESSONS = {
  putt: { name: '퍼팅', why: '그린에서 친 횟수가 많아요', videos: [['먼 퍼트 거리감 맞추기', '골프 롱퍼팅 거리감 레슨'], ['1m 짧은 퍼트 넣기', '골프 짧은 퍼팅 레슨']], drill: '1m 퍼트 20개 연속 넣기 · 10m 퍼트 10개 중 7개를 홀 1m 안에' },
  scr: { name: '그린 주변 (칩샷)', why: '그린을 놓친 뒤 파를 잘 못 지켜요', videos: [['굴리는 칩샷 기본', '골프 칩샷 굴리기 레슨'], ['벙커 탈출 기본', '골프 벙커샷 기초 레슨']], drill: '그린 밖 5m에서 10개 굴려 1m 원 안에 5개 이상' },
  gir: { name: '그린에 올리기 (아이언)', why: '정해진 타수에 그린에 잘 못 올려요', videos: [['아이언 정타 맞히기', '아이언 정타 레슨'], ['웨지 거리 조절', '웨지 거리 조절 레슨 시계 스윙']], drill: '100·130·150m 목표에 3개씩, 목표 10m 안에 5개 이상' },
  fw: { name: '티샷', why: '첫 샷이 페어웨이를 자주 벗어나요', videos: [['드라이버 똑바로 치기', '드라이버 방향성 레슨'], ['슬라이스 고치기', '드라이버 슬라이스 교정 레슨']], drill: '연습장 폭 30m 목표에 10개 중 6개 이상' },
  pen: { name: '벌타 줄이기', why: 'OB·분실로 잃는 타수가 많아요', videos: [['OB 안 나는 코스 공략', '골프 코스 매니지먼트 OB 줄이기'], ['티샷 안전하게 치기', '티샷 우드 유틸 안전 공략']], drill: '위험한 홀은 드라이버 대신 우드·유틸로 · 라운드당 벌타 2개 이하' },
};
export const lessonVideos = (k, miss = null) => (LESSONS[k]?.videos || []).map(([t, q], i) => ({ title: k === 'fw' && i === 1 && miss === 'L' ? '훅 고치기' : t, url: yt(k === 'fw' && i === 1 && miss === 'L' ? '드라이버 훅 교정 레슨' : q) }));

// ---------- ⑤ 이번 라운드 가장 아쉬운 곳 (내 핸디캡 기준보다 잃은 타수) ----------
//  퍼팅: (퍼트 − 평균 퍼트) · 벌타: 벌타+분실 − 기대치 · 어프로치: GIR 부족 × 0.5타 · 티샷: 페어웨이 부족 × 0.3타 · 숏게임: 스크램블 부족 × 0.8타
export function roundDiagnosis(round, hcp = 18) {
  const holes = round.holes.filter(h => h.scores?.[0]?.strokes);
  if (holes.length < 6) return null;
  const N = holes.length;
  let putts = 0, pN = 0, pen = 0, girN = 0, girY = 0, scrN = 0, scrY = 0, fwN = 0, fwY = 0;
  for (const h of holes) {
    const sc = h.scores[0];
    pen += (sc.penalties || 0) + (sc.lost || 0);
    if (sc.putts > 0) { putts += sc.putts; pN++; const gir = sc.strokes - sc.putts <= h.par - 2; girN++; if (gir) girY++; else { scrN++; if (sc.strokes <= h.par) scrY++; } }
    if (sc.fw && h.par >= 4) { fwN++; if (sc.fw === 'C') fwY++; }
  }
  const loss = [];
  if (pN >= 6) loss.push({ k: 'putt', v: putts - pN * benchAt('putt', hcp), fact: `그린에서 ${putts}번 (홀당 ${(putts / pN).toFixed(1)}번)` });
  loss.push({ k: 'pen', v: pen - N / 18 * Math.max(0.5, hcp * 0.1), fact: pen ? `벌타·잃어버린 공 ${pen}개` : '' });
  if (girN >= 6) loss.push({ k: 'gir', v: (benchAt('gir', hcp) - girY / girN) * girN * 0.5, fact: `그린에 제때 올린 홀 ${girY}/${girN}` });
  if (scrN >= 4) loss.push({ k: 'scr', v: (benchAt('scr', hcp) - scrY / scrN) * scrN * 0.8, fact: `그린 놓치고 파 지킨 홀 ${scrY}/${scrN}` });
  if (fwN >= 4) loss.push({ k: 'fw', v: (benchAt('fw', hcp) - fwY / fwN) * fwN * 0.3, fact: `페어웨이에 간 첫 샷 ${fwY}/${fwN}` });
  loss.sort((a, b) => b.v - a.v);
  const top = loss[0];
  if (!top || top.v < 0.8) return { ok: true, text: '고르게 잘 쳤어요 👍 특별히 많이 잃은 곳이 없어요', loss };
  return { ok: false, k: top.k, strokes: Math.round(top.v), fact: top.fact, name: LESSONS[top.k].name, text: `가장 아쉬운 곳: ${LESSONS[top.k].name} · 내 실력 기준보다 약 ${Math.max(1, Math.round(top.v))}타 더 쳤어요`, loss };
}

// ---------- ⑤ 처방 효과: 최근 3라운드 vs 그 전 3라운드 ----------
function metric(k, rs) {
  if (k === 'pen') { const holes = rs.reduce((a, r) => a + r.holes.filter(h => h.scores?.[0]?.strokes).length, 0); if (holes < 9) return null; return rs.reduce((a, r) => a + r.holes.reduce((x, h) => x + (h.scores?.[0]?.penalties || 0) + (h.scores?.[0]?.lost || 0), 0), 0) / holes * 18; }
  const a = areaStats(rs, { fw: 3, gir: 6, scr: 3, putt: 6 })[k]; return a ? a.v : null;
}
export function lessonTrend(rounds, k) {
  const rs = rounds.filter(r => r.mode !== 'practice');
  if (rs.length < 4) return null;
  const recent = rs.slice(0, 3), before = rs.slice(3, 6);
  const a = metric(k, before), b = metric(k, recent);
  if (a == null || b == null) return null;
  const lowerBetter = k === 'putt' || k === 'pen';
  const better = lowerBetter ? b < a - 0.02 : b > a + 0.02, worse = lowerBetter ? b > a + 0.02 : b < a - 0.02;
  const f = v => (k === 'putt' ? v.toFixed(2) + '번' : k === 'pen' ? v.toFixed(1) + '개' : Math.round(v * 100) + '%');
  const what = { putt: '홀당 퍼트', pen: '18홀당 벌타·분실', gir: '그린 적중', scr: '파 지키기', fw: '페어웨이' }[k];
  return { before: a, after: b, better, worse, text: `${what} ${f(a)} → ${f(b)}${better ? ' · 좋아지고 있어요 👍' : worse ? ' · 조금 나빠졌어요, 연습을 이어가요' : ' · 비슷해요'}` };
}

// ---------- ① 오늘 그린 빠르기: 골프장 발표 또는 내 퍼트 결과(짧았어요/길었어요)로 맞춤 ----------
//  짧았어요 = 그린이 생각보다 느림 → 스팀프 −0.5 (다음 계산은 조금 세게) · 길었어요 = +0.5 · 하루·골프장마다 따로
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const FEEL_KEY = 'pinpoint.greenFeel';
function readFeel() { try { return JSON.parse(localStorage.getItem(FEEL_KEY) || 'null'); } catch { return null; } }
export function greenToday(course, today = dayKey()) {
  if (!course) return null;
  const f = readFeel();
  if (f && f.date === today && f.courseId === course.id && f.stimp) return { stimp: f.stimp, n: f.n, src: 'feel' };
  const tp = course.todayPins;
  if (tp?.stimp && tp.date === today) return { stimp: tp.stimp, n: 0, src: 'club' };
  return null;
}
export function nextStimp(stimp, feel) {
  const d = feel === 'short' ? -0.5 : feel === 'long' ? 0.5 : 0;
  return Math.max(6, Math.min(14, Math.round((stimp + d) * 2) / 2));
}
export function recordPuttFeel(course, stimp, feel, today = dayKey()) {
  const f = readFeel(), same = f && f.date === today && f.courseId === course?.id;
  const out = { date: today, courseId: course?.id ?? null, stimp: nextStimp(stimp, feel), n: (same ? f.n || 0 : 0) + 1 };
  try { localStorage.setItem(FEEL_KEY, JSON.stringify(out)); } catch {}
  return out;
}
