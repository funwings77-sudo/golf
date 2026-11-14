// 내 백(My Bag): 클럽별 비거리·분산 (샷 학습) · 갭 분석 · 공 소모 추적
import { S, save, defaultBag } from '../core/state.js';
import { gapAnalysis, ballConsumption } from '../core/score.js';
import { $, $$, esc, toast, confirmSheet, DU } from '../ui.js';

export default {
  mount(el) {
    const render = () => {
      const gap = gapAnalysis(S.bag), bc = ballConsumption(S.rounds, S.settings.roundsPerMonth);
      const on = S.bag.filter(c => c.enabled).length;
      el.innerHTML = `<h2>🏌️ 내 백</h2>
        <p class="sub">캐리 거리(m)를 입력하거나 [샷] 기록으로 자동 학습됩니다. 클럽 ${on}개 사용 중 (규칙 최대 14개).</p>
        ${S.bag.map((c, i) => `<div class="card tight"><div class="row"><label class="row grow" style="gap:8px"><input type="checkbox" data-en="${i}" ${c.enabled ? 'checked' : ''} style="width:22px;height:22px"><b>${esc(c.name)}</b></label>
          <input type="number" data-carry="${i}" value="${c.carry}" min="10" max="350" style="width:90px"><span class="sub">m</span></div>
          <div class="sub">좌우 ±${(c.sdLat ?? 4).toFixed(1)}° · 거리 ±${Math.round((c.sdDist ?? 0.07) * 100)}% · ${c.learned ? `<b style="color:var(--green)">샷 ${c.n}개 학습</b>` : `샷 ${c.n || 0}개 (3개부터 학습)`}</div></div>`).join('')}
        <h3>갭 분석</h3>
        <div class="card">${gap.issues.length ? gap.issues.map(x => `<p>${x.kind === 'gap' ? '🕳️' : x.kind === 'overlap' ? '🔁' : '⚠️'} ${esc(x.text)}</p>`).join('') : '<p>클럽 간 거리 간격이 고릅니다 👍</p>'}
          <div class="tblwrap" style="margin-top:8px"><table class="score"><tr><th>클럽</th><th>캐리</th><th>다음과 차이</th></tr>${gap.clubs.map((c, i) => `<tr><td>${esc(c.name)}</td><td>${DU(c.carry)}</td><td>${gap.clubs[i + 1] ? DU(c.carry - gap.clubs[i + 1].carry) : '—'}</td></tr>`).join('')}</table></div></div>
        <h3>공 소모</h3>
        <div class="card">${bc ? `<div class="grid3"><div class="stat"><div class="v">${bc.avgPerRound.toFixed(1)}</div><div class="l">라운드당 분실</div></div><div class="stat"><div class="v">${bc.perMonth.toFixed(1)}</div><div class="l">월 예상 (${S.settings.roundsPerMonth}회)</div></div><div class="stat"><div class="v">${isFinite(bc.dozenMonths) ? bc.dozenMonths.toFixed(1) + '개월' : '—'}</div><div class="l">1더즌 지속</div></div></div>
          <p class="sub">${bc.avgPerRound >= 2 ? '분실이 많은 편입니다: 가성비 공·고시인성 컬러 공을 고려하세요.' : '분실이 적은 편입니다.'} (${bc.rounds}라운드 기준)</p>` : '<p class="sub">라운드를 마치면 분실구 기록으로 월 공 소모량을 예측합니다.</p>'}</div>
        <button class="btn block" id="reset">핸디캡 ${S.settings.hcp} 기본값으로 초기화</button>`;
      $$('[data-en]').forEach(x => x.onchange = () => { S.bag[+x.dataset.en].enabled = x.checked; save('bag'); render(); });
      $$('[data-carry]').forEach(x => x.onchange = () => { const c = S.bag[+x.dataset.carry]; c.carry = Math.max(10, +x.value || c.carry); c.priorCarry = c.carry; save('bag'); render(); });
      $('#reset').onclick = async () => { if (!(await confirmSheet('초기화', '클럽 거리와 학습값을 기본값으로 되돌릴까요? (샷 기록은 유지)', '초기화', 'danger'))) return; S.bag = defaultBag(S.settings.hcp, S.settings.gender); save('bag'); toast('초기화했습니다'); render(); };
    };
    render();
  },
};
