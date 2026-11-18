// 자동 스코어 · 내기 정산 (타당/스킨, 최소 송금)
import { S, save, activeCourse, MODES } from '../core/state.js';
import { totals, settle } from '../core/score.js';
import { keepAwake } from '../core/sensors.js';
import { $, $$, esc, toast, confirmSheet } from '../ui.js';

let el_, App_;
export default {
  mount(el, App) { el_ = el; App_ = App; render(); },
  onHole() { render(); },
};

function render() {
  const r = S.round;
  if (!r) { el_.innerHTML = `<div class="empty"><p>진행 중인 라운드가 없습니다.</p><a class="btn primary" href="#/play">🏌️ 골프 치러 가기</a></div>`; return; }
  const n = S.ui.hole, h = r.holes.find(x => x.n === n) || r.holes[0];
  const tot = totals(r), st = settle(r);
  el_.innerHTML = `<div class="row"><h2 class="grow" style="margin:0">📝 ${esc(r.courseName)}</h2><span class="pill">${MODES[r.mode].label}</span></div>
    <div class="card"><div class="row"><b class="grow mid">${h.n}번 홀 · Par ${h.par}</b></div>
      ${r.players.map((p, i) => { const sc = h.scores[i]; return `<div class="kv" style="align-items:center"><span style="color:var(--ink)"><b>${esc(p.name)}</b><br><span class="sub">퍼트 ${sc.putts} · 벌타 ${sc.penalties} · 분실 ${sc.lost}</span></span>
        <span class="row" style="gap:6px"><span class="stepper"><button data-p="${i}" data-k="strokes" data-d="-1">−</button><b class="${sc.strokes && sc.strokes < h.par ? 'under' : ''}">${sc.strokes || '–'}</b><button data-p="${i}" data-k="strokes" data-d="1">+</button></span>
        <span class="stepper"><button data-p="${i}" data-k="putts" data-d="-1">−</button><b style="font-size:15px">P${sc.putts}</b><button data-p="${i}" data-k="putts" data-d="1">+</button></span></span></div>`; }).join('')}
      <div class="grid2" style="margin-top:10px"><button class="btn" id="par">모두 파</button><button class="btn primary" id="next">다음 홀 ›</button></div></div>
    <div class="tblwrap"><table class="score"><tr><th>홀</th>${r.holes.map(x => `<th>${x.n}</th>`).join('')}<th>합</th></tr>
      <tr><td>Par</td>${r.holes.map(x => `<td>${x.par}</td>`).join('')}<td>${r.holes.reduce((a, x) => a + x.par, 0)}</td></tr>
      ${r.players.map((p, i) => `<tr><td><b>${esc(p.name)}</b></td>${r.holes.map(x => { const s = x.scores[i].strokes, d = s ? s - x.par : null, m = d == null ? '' : d <= -2 ? 'sc-e' : d === -1 ? 'sc-b' : d === 1 ? 'sc-o' : d >= 2 ? 'sc-d' : ''; return `<td class="${x.n === n ? 'cur' : ''} ${m}" data-h="${x.n}"><span>${s || ''}</span></td>`; }).join('')}<td><b>${tot[i].strokes || ''}</b></td></tr>`).join('')}
    </table></div><div class="legend-s"><span>○ 버디</span><span>◎ 이글</span><span>□ 보기</span><span>▣ 더블 이상</span></div>
    <div class="grid3" style="margin-top:10px">${tot.slice(0, 1).map(t => `<div class="stat"><div class="v">${t.played ? (t.toPar >= 0 ? '+' : '') + t.toPar : '–'}</div><div class="l">${esc(t.name)} 스코어</div></div><div class="stat"><div class="v">${t.putts}</div><div class="l">퍼트 (3퍼트 ${t.threePutts})</div></div><div class="stat"><div class="v">${t.lost}</div><div class="l">분실구</div></div>`).join('')}</div>
    ${(r.games?.stroke || r.games?.skins) ? `<div class="card"><h3 style="margin-top:0">💰 내기 정산</h3>${st.lines.map(l => `<p class="sub">${esc(l)}</p>`).join('')}
      ${st.net.map(x => `<div class="kv"><span>${esc(x.name)}</span><b style="color:${x.amount > 0 ? 'var(--green)' : x.amount < 0 ? 'var(--danger)' : 'inherit'}">${x.amount > 0 ? '+' : ''}${x.amount.toLocaleString()}원</b></div>`).join('')}
      ${st.transfers.length ? `<h3>송금</h3>${st.transfers.map(t => `<div class="kv"><span>${esc(t.from)} → ${esc(t.to)}</span><b>${t.amount.toLocaleString()}원</b></div>`).join('')}<button class="btn block" id="share" style="margin-top:8px">📤 정산 내역 공유</button>` : '<p class="sub">아직 정산할 금액이 없습니다.</p>'}</div>` : ''}
    <button class="btn danger block" id="end" style="margin-top:12px">라운드 종료 · 저장</button>`;
  $$('.stepper button', el_).forEach(b => b.onclick = () => {
    const sc = h.scores[+b.dataset.p], k = b.dataset.k, d = +b.dataset.d;
    if (k === 'strokes') sc.strokes = Math.max(0, (sc.strokes || (d > 0 ? h.par - 1 : 0)) + d);
    else sc.putts = Math.max(0, sc.putts + d);
    if (k === 'putts' && sc.strokes && sc.putts > sc.strokes) sc.strokes = sc.putts;
    sc.saved = true; save('round'); render();
  });
  $$('td[data-h]', el_).forEach(td => td.onclick = () => App_.setHole(+td.dataset.h));
  $('#par').onclick = () => { h.scores.forEach(s => { if (!s.strokes) s.strokes = h.par; s.saved = true; }); save('round'); render(); };
  $('#next').onclick = () => App_.stepHole(1);
  $('#share')?.addEventListener('click', async () => {
    const txt = `[PinPoint] ${r.courseName} 정산\n` + st.lines.join('\n') + '\n' + st.transfers.map(t => `${t.from} → ${t.to}: ${t.amount.toLocaleString()}원`).join('\n');
    try { if (navigator.share) await navigator.share({ text: txt }); else { await navigator.clipboard.writeText(txt); toast('클립보드에 복사했습니다'); } } catch {}
  });
  $('#end').onclick = async () => {
    if (!(await confirmSheet('라운드 종료', '스코어를 저장하고 라운드를 종료할까요?', '종료', 'danger'))) return;
    r.endedAt = new Date().toISOString(); r.totals = totals(r);
    S.rounds.unshift(r); S.round = null; save('rounds', 'round');
    keepAwake(false); toast('라운드를 저장했습니다'); App_.go('history');
  };
}
