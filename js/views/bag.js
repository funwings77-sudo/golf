// 🎒 내 클럽 비거리: 클럽마다 '10번 중 8번은 이 범위' · 얼마나 믿을 만한지(●○) · 웨지 표(스윙 크기별) · 스크린 거리로 시작 · 갭 · 공 소모
import { S, save, defaultBag } from '../core/state.js';
import { gapAnalysis, ballConsumption } from '../core/score.js';
import { clubRange, dots, wedgeMatrix, SWINGS, fromScreen, screenGap, SCREEN_TO_FIELD } from '../core/insights.js';
import { $, $$, esc, toast, confirmSheet, sheet, DU } from '../ui.js';
import { gripSupported, startGripScan, stopGripScan } from '../core/grip.js';

export default {
  mount(el) {
    let edit = false;
    const render = () => {
      const gap = gapAnalysis(S.bag), bc = ballConsumption(S.rounds, S.settings.roundsPerMonth);
      const on = S.bag.filter(c => c.enabled).sort((a, b) => b.carry - a.carry);
      const learnedN = on.filter(c => c.learned).length, wm = wedgeMatrix(S.bag, S.shots), sg = screenGap(S.bag, S.settings.screen);
      el.innerHTML = `<h2>🎒 내 클럽 비거리</h2>
        <p class="sub">공중으로 날아간 거리(캐리)예요. 골프 치기에서 <b>[쳤어요] → [공 찾았어요]</b>를 누르면 실제로 친 거리로 저절로 맞춰져요. 추운 날·바람 부는 날에 친 샷도 <b>보통 날씨 기준</b>으로 바꿔서 모아요.</p>
        ${learnedN < 3 ? `<button class="list-btn bag-scr" id="scr"><span class="ico">🖥️</span><span class="grow"><b>스크린 거리로 시작하기</b><br><span class="sub">스크린골프 7번 거리만 알면 나머지 클럽을 한 번에 맞춰요</span></span><span>›</span></button>` : ''}
        ${sg ? `<div class="card tight bag-sg">🖥️ ${esc(sg.text)}</div>` : ''}
        <div class="bag-list">${on.map(c => { const rg = clubRange(c, S.shots); return `<div class="bag-c">
          <div class="bag-n"><b>${esc(c.name)}</b><small>${dots(rg.trust.dots)} ${esc(rg.trust.word)}</small></div>
          <div class="bag-v"><b>${DU(c.carry)}</b><small>${rg.src === 'shots' ? '' : '어림 '}10번 중 8번 ${rg.lo}~${rg.hi}m</small></div>
          <div class="bag-bar" aria-hidden="true"><i style="left:${pct(rg.lo, on)}%;width:${Math.max(2, pct(rg.hi, on) - pct(rg.lo, on))}%"></i><em style="left:${pct(c.carry, on)}%"></em></div>
          ${rg.total ? `<div class="bag-t">굴러간 것까지 약 ${rg.total}m${rg.n ? ` · 실제 샷 ${rg.n}개` : ''}</div>` : ''}
        </div>`; }).join('')}</div>
        <button class="btn block" id="edit">${edit ? '✔ 다 고쳤어요' : '✏️ 거리 직접 고치기 · 클럽 넣고 빼기'}</button>
        ${edit ? `<div class="card">${S.bag.map((c, i) => `<div class="row bag-e"><label class="row grow" style="gap:8px"><input type="checkbox" data-en="${i}" ${c.enabled ? 'checked' : ''} style="width:22px;height:22px"><span>${esc(c.name)}</span></label>
          <input type="number" data-carry="${i}" value="${c.carry}" min="10" max="350" style="width:84px" inputmode="numeric"><span class="sub">m</span></div>`).join('')}
          <p class="sub">클럽 ${on.length}개 사용 중 (규칙상 최대 14개)</p>
          <button class="btn block" id="reset">처음 값으로 되돌리기 (핸디캡 ${S.settings.hcp} 기준)</button></div>` : ''}
        ${wm.length ? `<h3>🎯 웨지 표 <small class="sub">스윙 크기마다 날아가는 거리</small></h3>
          <div class="tblwrap"><table class="score wedge"><tr><th></th>${SWINGS.map(sw => `<th>${sw.label}<br><small>${sw.sub}</small></th>`).join('')}</tr>
          ${wm.map(r => `<tr><td>${esc(r.name)}</td>${r.cells.map(x => `<td class="${x.src}">${x.v}m${x.src === 'shots' ? `<small>${x.n}샷</small>` : ''}</td>`).join('')}</tr>`).join('')}</table></div>
          <p class="sub">진한 칸은 내가 실제로 친 거리, 흐린 칸은 어림이에요. 골프 치기에서 짧은 거리를 칠 때 '어깨까지·허리까지' 안내대로 치면 그 칸이 채워져요.</p>` : ''}
        <h3>🏷️ 그립 센서 <small class="sub">친 클럽을 저절로 적어요</small></h3>
        <div class="card">${(S.settings.grips || []).length ? (S.settings.grips || []).map((g, i) => `<div class="row bag-e"><span class="grow"><b>${esc(S.bag.find(c => c.id === g.club)?.name || g.club)}</b> <span class="sub">← ${esc(g.name || '센서')}${g.battery != null ? ` · 배터리 ${g.battery}%${g.battery < 20 ? ' ⚠' : ''}` : ''}</span></span><button class="btn small" data-gdel="${i}">빼기</button></div>`).join('') : '<p class="sub">클럽 끝(그립)에 블루투스 센서를 붙이면, 칠 때마다 어떤 클럽을 썼는지 저절로 알아요. 클럽 거리가 더 정확하게 쌓여요.</p>'}
          <button class="btn block" id="gripAdd">＋ 센서 연결하기</button>
          ${gripSupported() ? '' : '<p class="sub">앱(안드로이드·아이폰)에서만 쓸 수 있어요.</p>'}</div>
        <h3>클럽 사이 간격</h3>
        <div class="card">${gap.issues.length ? gap.issues.map(x => `<p>${x.kind === 'gap' ? '🕳️' : x.kind === 'overlap' ? '🔁' : '⚠️'} ${esc(x.text)}</p>`).join('') : '<p>클럽 사이 거리 간격이 고르게 잘 나뉘어 있어요 👍</p>'}</div>
        <h3>공 소모</h3>
        <div class="card">${bc ? `<div class="grid3"><div class="stat"><div class="v">${bc.avgPerRound.toFixed(1)}</div><div class="l">라운드당 잃어버림</div></div><div class="stat"><div class="v">${bc.perMonth.toFixed(1)}</div><div class="l">한 달 예상 (${S.settings.roundsPerMonth}회)</div></div><div class="stat"><div class="v">${isFinite(bc.dozenMonths) ? bc.dozenMonths.toFixed(1) + '개월' : '—'}</div><div class="l">공 12개로 버티는 기간</div></div></div>
          <p class="sub">${bc.avgPerRound >= 2 ? '잃어버리는 공이 많은 편이에요: 값싼 공·눈에 잘 띄는 색 공도 생각해 보세요.' : '공을 잘 지키고 있어요.'} (${bc.rounds}라운드 기준)</p>` : '<p class="sub">라운드를 마치면 잃어버린 공 기록으로 한 달에 공이 몇 개 드는지 알려 드려요.</p>'}</div>`;
      $('#edit').onclick = () => { edit = !edit; render(); };
      $('#gripAdd').onclick = () => gripSheet(render);
      $$('[data-gdel]').forEach(b => b.onclick = () => { S.settings.grips.splice(+b.dataset.gdel, 1); save('settings'); render(); });
      $('#scr')?.addEventListener('click', () => screenSheet(render));
      $$('[data-en]').forEach(x => x.onchange = () => { S.bag[+x.dataset.en].enabled = x.checked; save('bag'); render(); });
      $$('[data-carry]').forEach(x => x.onchange = () => { const c = S.bag[+x.dataset.carry]; c.carry = Math.max(10, +x.value || c.carry); c.priorCarry = c.carry; save('bag'); render(); });
      $('#reset')?.addEventListener('click', async () => { if (!(await confirmSheet('처음 값으로', '클럽 거리를 처음 값으로 되돌릴까요? (친 샷 기록은 그대로 있어요)', '되돌리기', 'danger'))) return; S.bag = defaultBag(S.settings.hcp, S.settings.gender); save('bag'); toast('되돌렸어요'); render(); });
    };
    render();
  },
};

// 막대 위치 (가장 짧은~가장 긴 클럽 사이 %)
function pct(v, clubs) {
  const lo = Math.min(...clubs.map(c => c.carry)) * 0.8, hi = Math.max(...clubs.map(c => c.carry)) * 1.08;
  return Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
}

// 🏷️ 센서 연결: 클럽 고르기 → 그 클럽 센서를 톡톡 → 신호가 바뀐 센서를 그 클럽에 붙임
function gripSheet(done) {
  if (!gripSupported()) return toast('그립 센서는 앱(안드로이드·아이폰)에서만 쓸 수 있어요', 3500);
  let club = null, closed = false;
  const clubs = S.bag.filter(c => c.enabled && c.id !== 'PT');
  const finish = async () => { closed = true; await stopGripScan(); window.App?.setupGrip?.(); };
  sheet({ title: '🏷️ 그립 센서 연결', body: `<p><b>① 센서를 붙인 클럽을 골라요</b></p><div class="chips" id="gc">${clubs.map(c => `<button data-c="${c.id}">${esc(c.name)}</button>`).join('')}</div>
    <p id="gstep" class="sub" style="margin-top:10px">클럽을 고르면 ② 그 클럽 센서를 손가락으로 톡톡 두드려 주세요.</p>`,
    actions: [{ label: '닫기', onClick: finish }], dismissable: false,
    onMount(card, close) {
      $$('[data-c]', card).forEach(b => b.onclick = async () => {
        club = b.dataset.c; $$('[data-c]', card).forEach(x => x.classList.toggle('on', x === b));
        const st = $('#gstep', card); st.innerHTML = `📡 <b>${esc(b.textContent)}</b> 센서를 찾는 중… 센서를 톡톡 두드리거나 클럽을 한 번 흔들어 주세요.`;
        try {
          await startGripScan(async ev => {
            if (closed || !club) return;
            const grips = (S.settings.grips ||= []).filter(g => g.deviceId !== ev.deviceId && g.club !== club);
            grips.push({ deviceId: ev.deviceId, club, name: ev.name || '센서 ' + ev.deviceId.slice(-5), battery: ev.battery });
            S.settings.grips = grips; save('settings');
            toast(`✅ ${S.bag.find(c => c.id === club)?.name} 센서를 연결했어요`); await finish(); close(); done();
          });
        } catch (e) { st.textContent = '⚠ ' + e.message + ' (블루투스·근처 기기 권한을 켜 주세요)'; }
      });
    } });
}

// 🖥️ 스크린 7번 거리 하나로 모든 클럽 맞추기 (이미 필드에서 배운 클럽은 그대로)
function screenSheet(done) {
  const last = S.settings.screen?.carry || '';
  sheet({ title: '🖥️ 스크린 거리로 시작하기', body: `<p>스크린골프에서 <b>7번 아이언</b>이 보통 몇 m 나와요?</p>
    <div class="row" style="gap:8px"><input type="number" id="scrV" inputmode="numeric" min="60" max="220" value="${last}" placeholder="예: 140" style="font-size:22px;flex:1"><b>m</b></div>
    <p class="sub" id="scrOut">스크린은 매트·바람 없음 때문에 필드보다 조금 길게 나와요. 그래서 약 ${Math.round((1 - SCREEN_TO_FIELD) * 100)}% 빼서 맞춰요. 필드에서 치면 실제 거리로 저절로 바뀌어요.</p>`,
    actions: [{ label: '취소' }, { label: '맞추기', kind: 'primary', onClick: card => {
      const v = +$('#scrV', card).value;
      if (!(v >= 60 && v <= 220)) { toast('60~220m 사이로 넣어 주세요'); return false; }
      const r = fromScreen(S.bag, v, '7i');
      S.bag = r.bag; S.settings.screen = { club: '7i', carry: v, ts: Date.now() }; save('bag', 'settings');
      toast(`필드 7번은 약 ${r.field}m · 클럽 ${r.changed}개를 맞췄어요`, 3500); done();
    } }],
    onMount(card) {
      const inp = $('#scrV', card), out = $('#scrOut', card);
      inp.oninput = () => { const v = +inp.value; if (v >= 60 && v <= 220) out.innerHTML = `필드에서는 7번이 약 <b>${Math.round(v * SCREEN_TO_FIELD)}m</b>일 거예요. 다른 클럽도 같은 비율로 맞춰요. 필드에서 치면 실제 거리로 저절로 바뀌어요.`; };
    } });
}
