// 라운드 기록 · 통계 (퍼트·3퍼트·분실구·클럽 비거리) · 골프장 제출용 리포트
import { S, save, MODES } from '../core/state.js';
import { totals } from '../core/score.js';
import { buildRoundReport } from '../core/report.js';
import { $, $$, esc, confirmSheet, DU, sheet, toast } from '../ui.js';

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
        ${rs.length ? rs.map((r, i) => { const t = (r.totals || totals(r))[0]; return `<div class="card tight"><div class="row"><div class="grow"><b>${esc(r.courseName)}</b> <span class="pill ${r.mode === 'tournament' ? 'danger' : r.mode === 'practice' ? 'warn' : ''}">${MODES[r.mode]?.label}</span><br><span class="sub">${new Date(r.date).toLocaleDateString()} · ${t.played}홀 · ${t.strokes}타 (${t.toPar >= 0 ? '+' : ''}${t.toPar}) · 퍼트 ${t.putts} · 분실 ${t.lost}</span></div><button class="btn small" data-rep="${i}" title="골프장 제출용 리포트">📤 리포트</button><button class="btn small" data-del="${i}">삭제</button></div></div>`; }).join('') : '<div class="empty">완료된 라운드가 없습니다</div>'}`;
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
