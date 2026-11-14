// 라운드 기록 · 통계 (퍼트·3퍼트·분실구·클럽 비거리)
import { S, save, MODES } from '../core/state.js';
import { totals } from '../core/score.js';
import { $, $$, esc, confirmSheet, DU } from '../ui.js';

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
        ${Object.keys(byClub).length ? `<h3>클럽별 실제 캐리</h3><div class="tblwrap"><table class="score"><tr><th>클럽</th><th>샷</th><th>평균</th><th>최소~최대</th></tr>${Object.entries(byClub).map(([k, v]) => `<tr><td>${esc(S.bag.find(c => c.id === k)?.name || k)}</td><td>${v.length}</td><td>${DU(v.reduce((a, b) => a + b, 0) / v.length)}</td><td>${DU(Math.min(...v))}~${DU(Math.max(...v))}</td></tr>`).join('')}</table></div>` : ''}
        <h3>라운드</h3>
        ${rs.length ? rs.map((r, i) => { const t = (r.totals || totals(r))[0]; return `<div class="card tight"><div class="row"><div class="grow"><b>${esc(r.courseName)}</b> <span class="pill ${r.mode === 'tournament' ? 'danger' : r.mode === 'practice' ? 'warn' : ''}">${MODES[r.mode]?.label}</span><br><span class="sub">${new Date(r.date).toLocaleDateString()} · ${t.played}홀 · ${t.strokes}타 (${t.toPar >= 0 ? '+' : ''}${t.toPar}) · 퍼트 ${t.putts} · 분실 ${t.lost}</span></div><button class="btn small" data-del="${i}">삭제</button></div></div>`; }).join('') : '<div class="empty">완료된 라운드가 없습니다</div>'}`;
      $$('[data-del]').forEach(b => b.onclick = async () => { if (!(await confirmSheet('기록 삭제', '이 라운드 기록을 삭제할까요?', '삭제', 'danger'))) return; S.rounds.splice(+b.dataset.del, 1); save('rounds'); render(); });
    };
    render();
  },
};
