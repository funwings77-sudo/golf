// 스코어·내기 자동 정산 / 내 백 갭 분석 / 공 소모 추적
export function emptyHole() { return { strokes: 0, putts: 0, penalties: 0, lost: 0 }; }

export function newRound({ course, players, mode, games }) {
  const now = Date.now();
  return {
    id: Math.random().toString(36).slice(2), courseId: course.id, courseName: course.name, date: new Date(now).toISOString(),
    startedAt: new Date(now).toISOString(), officialId: course.official?.id || null, officialRev: course.official?.rev ?? null,
    holeTimes: { [course.holes[0]?.n ?? 1]: now }, lostEvents: [],
    mode, players: players.map(p => ({ name: p })), games,
    holes: course.holes.map(h => ({ n: h.n, par: h.par, scores: players.map(() => emptyHole()) })),
  };
}

export function totals(round) {
  return round.players.map((p, i) => {
    let s = 0, par = 0, putts = 0, pen = 0, lost = 0, played = 0, three = 0;
    for (const h of round.holes) {
      const sc = h.scores[i]; if (!sc?.strokes) continue;
      s += sc.strokes; par += h.par; putts += sc.putts; pen += sc.penalties; lost += sc.lost; played++;
      if (sc.putts >= 3) three++;
    }
    return { name: p.name, strokes: s, toPar: s - par, putts, penalties: pen, lost, played, threePutts: three };
  });
}

// games: { stroke: 단가(타당), skins: 스킨 단가 }  → 각자 순손익과 최소 송금 목록
export function settle(round) {
  const n = round.players.length, net = new Array(n).fill(0), lines = [];
  const g = round.games || {};
  const done = round.holes.filter(h => h.scores.every(s => s.strokes > 0));
  if (g.stroke > 0 && done.length) {
    const tot = round.players.map((_, i) => done.reduce((a, h) => a + h.scores[i].strokes, 0));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const diff = (tot[j] - tot[i]) * g.stroke; // i가 적게 쳤으면 j가 i에게 지불
      net[i] += diff; net[j] -= diff;
    }
    lines.push(`타당 ${g.stroke.toLocaleString()}원 · 완료 ${done.length}홀 기준`);
  }
  if (g.skins > 0 && done.length) {
    let carry = 1; const won = new Array(n).fill(0);
    for (const h of done) {
      const sc = h.scores.map(s => s.strokes), min = Math.min(...sc);
      const winners = sc.map((v, i) => v === min ? i : -1).filter(i => i >= 0);
      if (winners.length === 1) {
        const w = winners[0];
        won[w] += carry;
        for (let i = 0; i < n; i++) if (i !== w) { net[i] -= g.skins * carry; net[w] += g.skins * carry; }
        carry = 1;
      } else carry++;
    }
    lines.push(`스킨 ${g.skins.toLocaleString()}원 · ` + round.players.map((p, i) => `${p.name} ${won[i]}개`).join(', ') + (carry > 1 ? ` · 이월 ${carry - 1}개 미정산` : ''));
  }
  return { net: round.players.map((p, i) => ({ name: p.name, amount: Math.round(net[i]) })), transfers: minTransfers(round.players.map(p => p.name), net), lines };
}

export function minTransfers(names, net) {
  const cred = [], debt = [];
  net.forEach((v, i) => { if (v > 0.5) cred.push([i, v]); else if (v < -0.5) debt.push([i, -v]); });
  cred.sort((a, b) => b[1] - a[1]); debt.sort((a, b) => b[1] - a[1]);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const amt = Math.min(debt[i][1], cred[j][1]);
    out.push({ from: names[debt[i][0]], to: names[cred[j][0]], amount: Math.round(amt) });
    debt[i][1] -= amt; cred[j][1] -= amt;
    if (debt[i][1] < 0.5) i++; if (cred[j][1] < 0.5) j++;
  }
  return out;
}

// ---------- 내 백(My Bag) ----------
// 샷 기록으로 클럽별 캐리 평균/분산 학습 (사전값을 n0=5 샷 가중치로 둔 베이지안 갱신)
export function learnClub(club, shots) {
  const s = shots.filter(x => x.club === club.id && x.carry > 10 && !x.excluded);
  if (s.length < 3) return { ...club, n: s.length, learned: false };
  const n0 = 5, prior = club.priorCarry ?? club.carry;
  const mean = (prior * n0 + s.reduce((a, x) => a + x.carry, 0)) / (n0 + s.length);
  const sd = Math.sqrt(s.reduce((a, x) => a + (x.carry - mean) ** 2, 0) / s.length) / mean;
  const lat = s.filter(x => x.latDeg != null);
  const sdLat = lat.length >= 3 ? Math.sqrt(lat.reduce((a, x) => a + x.latDeg ** 2, 0) / lat.length) : club.sdLat;
  return { ...club, priorCarry: prior, carry: Math.round(mean), sdDist: Math.max(0.03, Math.min(0.2, sd || club.sdDist)), sdLat: Math.max(1.5, Math.min(12, sdLat)), n: s.length, learned: true };
}

export function gapAnalysis(bag) {
  const clubs = bag.filter(c => c.enabled && c.carry > 0).sort((a, b) => b.carry - a.carry);
  const issues = [];
  for (let i = 0; i < clubs.length - 1; i++) {
    const a = clubs[i], b = clubs[i + 1], gap = a.carry - b.carry;
    if (gap > 18) issues.push({ kind: 'gap', a, b, gap, text: `${a.name}↔${b.name} 사이 ${gap}m 공백 → ${suggest(a, b)} 추가 검토` });
    else if (gap < 6) issues.push({ kind: 'overlap', a, b, gap, text: `${a.name}와 ${b.name} 비거리 차이 ${gap}m → 중복. 하나를 빼고 다른 공백을 메우세요` });
  }
  if (clubs.length > 14) issues.push({ kind: 'count', text: `클럽 ${clubs.length}개: 규칙상 최대 14개` });
  return { clubs, issues };
}
function suggest(a, b) {
  const mid = (a.carry + b.carry) / 2;
  if (mid > 165) return '하이브리드/유틸리티';
  if (mid > 95) return '중간 로프트 아이언·하이브리드';
  return '갭 웨지(50~52°)';
}

export function ballConsumption(rounds, roundsPerMonth = 3) {
  const rs = rounds.filter(r => r.mode !== 'practice');
  if (!rs.length) return null;
  const lost = rs.map(r => r.holes.reduce((a, h) => a + (h.scores[0]?.lost || 0), 0));
  const avg = lost.reduce((a, b) => a + b, 0) / lost.length;
  const perMonth = avg * roundsPerMonth;
  return { avgPerRound: avg, perMonth, dozenMonths: perMonth > 0 ? 12 / perMonth : Infinity, rounds: rs.length };
}
