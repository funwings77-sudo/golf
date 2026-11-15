// 라운드 기록 · 통계 (퍼트·3퍼트·분실구·클럽 비거리) · 골프장 제출용 리포트
import { S, save, MODES } from '../core/state.js';
import { totals } from '../core/score.js';
import { buildRoundReport } from '../core/report.js';
import { $, $$, esc, confirmSheet, DU, sheet, toast } from '../ui.js';

// 홀별 색 막대 (이글 보라 · 버디 파랑 · 파 초록 · 보기 노랑 · 더블+ 주황)
function holeBar(r) {
  const cells = r.holes.map(h => { const st = h.scores?.[0]?.strokes; if (!st) return '<i></i>'; const d = st - h.par; return `<i class="${d <= -2 ? 'e' : d === -1 ? 'b' : d === 0 ? 'p' : d === 1 ? 'o' : 'd'}" title="${h.n}번 ${st}타"></i>`; });
  return `<div class="hbar">${cells.join('')}</div>`;
}

// 영역별 실력(핸디캡 환산) → 가장 먼저 연습할 것
// 일반 아마추어 평균표(핸디캡 0·10·20·30): 페어웨이 안착 · 그린 적중(GIR) · 리커버리(GIR 실패 후 파 이하) · 홀당 퍼트
const BENCH = { fw: [0.60, 0.50, 0.42, 0.35], gir: [0.65, 0.40, 0.20, 0.08], scr: [0.55, 0.35, 0.20, 0.10], putt: [1.75, 1.85, 1.95, 2.05] };
const AREA = {
  fw: ['티샷', '페어웨이에 올리는 비율', '드라이버 대신 3번 우드·하이브리드로 페어웨이를 먼저 지켜 보세요. 연습장에서는 폭 30m 목표로 10개 중 몇 개 들어가는지 세어 보세요.'],
  gir: ['어프로치', '정규 타수로 그린에 올리는 비율', '깃발 대신 그린 가운데를 보고 치세요. 클럽별 실제 비거리(내 백)를 믿고 한 클럽 길게 잡는 게 도움이 돼요.'],
  scr: ['숏게임', '그린을 놓친 뒤 파를 지키는 비율', '그린 주변 칩샷은 굴리는 샷(7·8번 아이언)부터 연습해 보세요. 1~2m 안에 붙이는 연습이 효과가 커요.'],
  putt: ['퍼팅', '홀당 퍼트 수', '먼 거리는 홀 주변 1m 원 안에 붙이는 거리감, 짧은 거리는 1m 퍼트 20개 연속 넣기를 연습해 보세요.'],
};
function toHcp(key, v) { // 평균표 사이를 직선으로 이어 핸디캡으로 환산 (0~36)
  const xs = [0, 10, 20, 30], dir = key === 'putt' ? 1 : -1, g = BENCH[key].map(x => x * dir), gv = v * dir;
  if (gv <= g[0]) return 0;
  for (let i = 1; i < 4; i++) if (gv <= g[i]) return xs[i - 1] + (gv - g[i - 1]) / (g[i] - g[i - 1]) * 10;
  return Math.min(36, 30 + (gv - g[3]) / (g[3] - g[2]) * 10);
}
function areaStats(rounds) {
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
  if (fwN >= 5) out.fw = { v: fwY / fwN, n: fwN, txt: `${Math.round(fwY / fwN * 100)}%` };
  if (girN >= 9) out.gir = { v: girY / girN, n: girN, txt: `${Math.round(girY / girN * 100)}%` };
  if (scrN >= 6) out.scr = { v: scrY / scrN, n: scrN, txt: `${Math.round(scrY / scrN * 100)}%` };
  if (pN >= 9) out.putt = { v: pS / pN, n: pN, txt: (pS / pN).toFixed(2) };
  for (const k in out) out[k].hcp = toHcp(k, out[k].v);
  return out;
}
function practiceCard(rounds) {
  const a = areaStats(rounds), keys = Object.keys(a);
  if (keys.length < 2) return `<div class="card"><b>🎯 연습 우선순위</b><p class="sub">9홀 이상 점수와 퍼트를 기록하면 티샷·어프로치·숏게임·퍼팅 중 무엇부터 연습하면 좋을지 알려 드려요. (다음 홀로 갈 때 나오는 점수 창에서 퍼트·티샷 방향을 눌러 주세요)</p></div>`;
  const worst = keys.reduce((w, k) => (a[k].hcp > a[w].hcp ? k : w));
  const mx = Math.max(36, ...keys.map(k => a[k].hcp));
  return `<div class="card prio"><b>🎯 가장 먼저 연습할 것</b><div class="big">${AREA[worst][0]}</div>
    <p class="sub" style="margin:0">${AREA[worst][1]} ${a[worst].txt} → 핸디캡 약 ${Math.round(a[worst].hcp)} 수준이에요.</p>
    <p style="margin:6px 0 0;font-size:14px">💡 ${AREA[worst][2]}</p>
    <div class="lvl">${['fw', 'gir', 'scr', 'putt'].map(k => a[k] ? `<div><i class="${k === worst ? 'bad' : ''}" style="height:${Math.max(6, a[k].hcp / mx * 70)}px"></i>${AREA[k][0]}<br><b>${Math.round(a[k].hcp)}</b><br><span class="sub">${a[k].txt}</span></div>` : `<div><i style="height:4px;background:#ccc"></i>${AREA[k][0]}<br><span class="sub">기록 부족</span></div>`).join('')}</div>
    <p class="sub" style="margin:8px 0 0">막대 = 그 영역만 봤을 때의 핸디캡 (낮을수록 잘함) · 일반 아마추어 평균과 비교</p></div>`;
}
// 골프장별 성적
function courseCard(rounds) {
  const by = {};
  for (const r of rounds) { const t = (r.totals || totals(r))[0]; if (!t.played) continue; (by[r.courseName] ||= []).push({ t, date: r.date }); }
  const rows = Object.entries(by).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  if (!rows.length) return '';
  return `<h3>골프장별 성적</h3><div class="tblwrap"><table class="score"><tr><th>골프장</th><th>라운드</th><th>평균</th><th>최고</th><th>최근</th></tr>${rows.map(([n, v]) => {
    const tp = v.map(x => x.t.toPar), avg = tp.reduce((a, b) => a + b, 0) / tp.length, best = Math.min(...tp), last = v.map(x => x.date).sort().at(-1);
    const f = x => (x > 0 ? '+' : '') + (Math.round(x * 10) / 10);
    return `<tr><td style="text-align:left">${esc(n)}</td><td>${v.length}</td><td>${f(avg)}</td><td>${f(best)}</td><td>${new Date(last).toLocaleDateString()}</td></tr>`;
  }).join('')}</table></div>`;
}

export default {
  mount(el) {
    const render = () => {
      const rs = S.rounds, counted = rs.filter(r => r.mode !== 'practice');
      const me = counted.map(r => (r.totals || totals(r))[0]).filter(t => t.played);
      const avg = k => me.length ? me.reduce((a, t) => a + t[k], 0) / me.length : 0;
      const holes = me.reduce((a, t) => a + t.played, 0);
      const shots = S.shots.filter(s => !s.excluded);
      const byClub = {}; for (const s of shots) (byClub[s.club] = byClub[s.club] || []).push(s.carry);
      el.innerHTML = `<h2>📊 기록 · 통계</h2>
        <div class="grid3"><div class="stat"><div class="v">${me.length ? avg('toPar').toFixed(1) : '—'}</div><div class="l">평균 스코어(파 대비)</div></div>
          <div class="stat"><div class="v">${holes ? (me.reduce((a, t) => a + t.putts, 0) / holes * 18).toFixed(1) : '—'}</div><div class="l">18홀당 퍼트</div></div>
          <div class="stat"><div class="v">${holes ? (me.reduce((a, t) => a + t.threePutts, 0) / holes * 100).toFixed(0) + '%' : '—'}</div><div class="l">3퍼트 비율</div></div></div>
        <div class="grid2" style="margin-top:8px"><div class="stat"><div class="v">${me.length ? avg('lost').toFixed(1) : '—'}</div><div class="l">라운드당 분실구</div></div><div class="stat"><div class="v">${shots.length}</div><div class="l">기록된 샷</div></div></div>
        <p class="sub">연습 모드 라운드는 통계에서 제외됩니다.</p>
        ${practiceCard(counted)}${courseCard(counted)}
        ${Object.keys(byClub).length ? `<h3>클럽별 실제 캐리</h3><div class="tblwrap"><table class="score"><tr><th>클럽</th><th>샷</th><th>평균</th><th>최소~최대</th></tr>${Object.entries(byClub).map(([k, v]) => `<tr><td>${esc(S.bag.find(c => c.id === k)?.name || k)}</td><td>${v.length}</td><td>${DU(v.reduce((a, b) => a + b, 0) / v.length)}</td><td>${DU(Math.min(...v))}~${DU(Math.max(...v))}</td></tr>`).join('')}</table></div>` : ''}
        <h3>라운드</h3>
        ${rs.length ? rs.map((r, i) => { const t = (r.totals || totals(r))[0]; return `<div class="card tight"><div class="row"><div class="grow"><b>${esc(r.courseName)}</b> <span class="pill ${r.mode === 'tournament' ? 'danger' : r.mode === 'practice' ? 'warn' : ''}">${MODES[r.mode]?.label}</span><br><span class="sub">${new Date(r.date).toLocaleDateString()} · ${t.played}홀 · ${t.strokes}타 (${t.toPar >= 0 ? '+' : ''}${t.toPar}) · 퍼트 ${t.putts} · 분실 ${t.lost}</span>${holeBar(r)}</div><button class="btn small" data-rep="${i}" title="골프장 제출용 리포트">📤 리포트</button><button class="btn small" data-del="${i}">삭제</button></div></div>`; }).join('') : '<div class="empty">완료된 라운드가 없습니다</div>'}`;
      $$('[data-rep]').forEach(b => b.onclick = () => shareReport(rs[+b.dataset.rep]));
      $$('[data-del]').forEach(b => b.onclick = async () => { if (!(await confirmSheet('기록 삭제', '이 라운드 기록을 삭제할까요?', '삭제', 'danger'))) return; S.rounds.splice(+b.dataset.del, 1); save('rounds'); render(); });
    };
    render();
  },
};

// 골프장 제출용 리포트 (비식별): 골프장의 진행 속도·난이도·분실구 지점 분석용
function shareReport(r) {
  const course = S.courses.find(c => c.id === r.courseId);
  const rep = buildRoundReport(r, course);
  const timed = rep.holes.filter(h => h.arrivedAt != null).length;
  sheet({
    title: '골프장 제출용 리포트',
    body: `<p>골프장이 <b>진행 속도·홀 난이도·분실구 다발 지점</b>을 개선하는 데 쓰는 익명 리포트입니다.</p>
      <div class="kv"><span>포함</span><b>내 스코어·퍼트·벌타 ${rep.holes.length}홀 · 홀 도착 시각 ${timed}개 · 분실구 지점 ${rep.lost.length}개</b></div>
      <div class="kv"><span>포함 안 함</span><b>이름 · 동반자 스코어 · 이동 경로 · 기기 정보</b></div>
      ${rep.courseId ? '' : '<p class="sub">⚠ 골프장이 제공한 공식 코스로 친 라운드가 아니라 골프장 분석에서 제외될 수 있습니다.</p>'}
      ${r.mode === 'practice' ? '<p class="sub">연습 라운드는 분석에서 제외됩니다.</p>' : ''}
      <p class="sub">파일을 골프장 담당자에게 카카오톡·이메일로 보내세요. 직접 보내기 전에는 어디에도 전송되지 않습니다.</p>`,
    actions: [{ label: '닫기' }, {
      label: '📤 파일 보내기', kind: 'primary', onClick: async () => {
        const txt = JSON.stringify(rep), name = `pinpoint-round-${rep.courseId || 'course'}-${rep.date}.json`;
        try {
          const file = new File([txt], name, { type: 'application/json' });
          if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'PinPoint 라운드 리포트' }); return; }
        } catch (e) { if (e.name === 'AbortError') return; }
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('리포트 파일을 저장했습니다');
      },
    }],
  });
}
