// 📈 내 샷 기록: 클럽별 평균·최장 거리, 공 속도·높이(계산), 방향 퍼짐(측정) + 위에서 본 탄착점 + 샷마다 결과 카드
import { S, save } from '../core/state.js';
import { learnClub } from '../core/score.js';
import { clubStats, kmh } from '../physics/shotfit.js';
import { shotSheet, openLMForm, addLMShot } from './lmform.js';
import { pickLaunchFile } from './lmimport.js';
import { $, $$, esc, toast, confirmSheet } from '../ui.js';

let el_, open = null;
export default { mount(el) { el_ = el; render(); } };

const f0 = v => (v == null || !Number.isFinite(v) ? '—' : Math.round(v));
const dir = d => (d == null || !Number.isFinite(d) ? '—' : Math.abs(d) < 0.5 ? '가운데' : `${d > 0 ? '오른쪽' : '왼쪽'} ${Math.abs(d).toFixed(1)}°`);
const day = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// 위에서 본 탄착점: 가로 = 좌우(m), 세로 = 거리(m), 평균 거리 선
function scatter(st) {
  const pts = st.shots.filter(s => Number.isFinite(s.latDeg)).map(s => ({ x: s.total * Math.sin(s.latDeg * Math.PI / 180), y: s.total * Math.cos(s.latDeg * Math.PI / 180), p: s.partial }));
  if (!pts.length) return '';
  const W = 150, H = 150, maxY = Math.max(...pts.map(p => p.y), st.avgTotal || 0) * 1.08, half = Math.max(15, ...pts.map(p => Math.abs(p.x))) * 1.15;
  const X = x => (W / 2 + x / half * (W / 2 - 8)).toFixed(1), Y = y => (H - 8 - y / maxY * (H - 16)).toFixed(1);
  return `<svg class="sh-sc" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(st.name)} 탄착점 ${pts.length}개">
    <line x1="${W / 2}" y1="${H - 8}" x2="${W / 2}" y2="6" class="sh-ax"/>
    ${st.avgTotal ? `<line x1="6" y1="${Y(st.avgTotal)}" x2="${W - 6}" y2="${Y(st.avgTotal)}" class="sh-avg"/><text x="${W - 6}" y="${+Y(st.avgTotal) - 3}" text-anchor="end" class="sh-t">${f0(st.avgTotal)}m</text>` : ''}
    ${pts.map(p => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4" class="${p.p ? 'sh-pp' : 'sh-p'}"/>`).join('')}
    <circle cx="${W / 2}" cy="${H - 8}" r="3" class="sh-o"/></svg>`;
}

function render() {
  const stats = clubStats(S.shots);
  if (!stats.length) {
    el_.innerHTML = `<h2>📈 내 샷 기록</h2><div class="card"><p><b>아직 기록한 샷이 없어요.</b></p><p class="sub">골프 치기에서 공을 치고 <b>[🏌️ 쳤어요]</b> → 공이 있는 곳에서 <b>[✅ 공 찾았어요]</b>를 누르면, 날아간 거리·방향을 재고 공 속도·높이·비행 시간을 계산해서 여기에 클럽별로 모아 보여 줘요.</p><a class="btn primary block" href="#/play">🏌️ 골프 치러 가기</a></div>
      <div class="grid2"><button class="btn" id="lmAdd">📟 샷 하나 적기</button><button class="btn" id="lmFile">📂 기록 파일 불러오기</button></div>
      <p class="sub">론치 모니터 앱(가민·랩소도·플라이트스코프·트랙맨·국산 기기)에서 CSV로 내보낸 파일을 한꺼번에 불러올 수 있어요.</p>`;
    $('#lmAdd').onclick = addShot; $('#lmFile').onclick = () => pickLaunchFile(() => render());
    return;
  }
  el_.innerHTML = `<h2>📈 내 샷 기록</h2>
    <p class="sub">클럽 ${stats.length}개 · 샷 ${S.shots.filter(s => s.club && s.total).length}개. 거리·방향은 GPS로 <b>잰 값</b>, 공 속도·높이는 잰 거리로 <b>계산한 값</b>이에요 (📟 론치 모니터 수치를 넣은 샷은 모니터 값). 힘을 덜 준 샷(흐린 점)은 평균에서 빼요.</p>
    <div class="grid2" style="margin-bottom:10px"><button class="btn" id="lmAdd">📟 모니터 샷 적기</button><button class="btn" id="lmFile">📂 기록 파일(CSV)</button></div>
    ${stats.map(st => `<div class="card sh-card">
      <button class="sh-head" data-open="${esc(st.club)}"><span class="sh-name"><b>${esc(st.name)}</b><small>${st.n}샷${st.nFull !== st.n ? ` (풀스윙 ${st.nFull})` : ''}</small></span>
        <span class="sh-main"><b>${f0(st.avgTotal)}<i>m</i></b><small>평균${st.sdTotal ? ` ±${f0(st.sdTotal)}` : ''} · 최장 ${f0(st.longest)}m</small></span><em>${open === st.club ? '▲' : '▼'}</em></button>
      <div class="sh-body">
        ${scatter(st)}
        <div class="sh-kv">
          <div><small>공 속도 ${st.nLM ? `(📟 ${st.nLM}샷 반영)` : '(계산)'}</small><b>${st.avgSpeed ? `${f0(kmh(st.avgSpeed))}km/h` : '—'}</b>${st.maxSpeed ? `<span>최고 ${f0(kmh(st.maxSpeed))}</span>` : ''}</div>
          <div><small>발사 각도 ${st.avgLaunchLM != null ? '(📟 모니터)' : '(클럽 평균)'}</small><b>${st.avgLaunchLM != null ? st.avgLaunchLM.toFixed(1) : f0(st.launchDeg)}°</b>${st.avgSpinLM != null ? `<span>스핀 ${Math.round(st.avgSpinLM / 10) * 10}rpm</span>` : ''}</div>
          <div><small>최고 높이 ${st.nLM ? '(📟·계산)' : '(계산)'}</small><b>${st.avgApex ? `${f0(st.avgApex)}m` : '—'}</b></div>
          <div><small>공중 거리 (계산)</small><b>${st.avgCarry ? `${f0(st.avgCarry)}m` : '—'}</b></div>
          <div><small>방향 평균 (잰 값)</small><b>${dir(st.avgLat)}</b></div>
          <div><small>좌우 퍼짐 (잰 값)</small><b>${st.sdLat ? `±${st.sdLat.toFixed(1)}°` : '—'}</b></div>
        </div>
      </div>
      ${st.miss.n >= 2 ? (() => { const p = k => Math.round(st.miss[k] / st.miss.n * 100); return `<div class="sh-miss"><div class="sh-miss-h">좌우 결과 <span>가운데 ${p('c')}%</span></div>
        <div class="sh-bar" role="img" aria-label="왼쪽 ${p('l')}% 가운데 ${p('c')}% 오른쪽 ${p('r')}%">${p('l') ? `<i class="l" style="width:${p('l')}%"></i>` : ''}${p('c') ? `<i class="c" style="width:${p('c')}%"></i>` : ''}${p('r') ? `<i class="r" style="width:${p('r')}%"></i>` : ''}</div>
        <div class="sh-leg"><div><i class="l"></i>왼쪽<b>${p('l')}%</b></div><div><i class="c"></i>가운데<b>${p('c')}%</b></div><div><i class="r"></i>오른쪽<b>${p('r')}%</b></div></div></div>`; })() : ''}
      ${open === st.club ? `<div class="sh-list">${st.shots.map(s => `<button data-shot="${s.id}"><span>${s.lm ? '📟 ' : ''}${day(s.ts)}${s.hole ? ` · ${s.hole}번 홀` : ''}${s.partial ? ' · 힘 덜 줌' : ''}</span><b>${f0(s.total)}m</b><span>${s.fit?.est?.ballSpeed ? `${f0(kmh(s.fit.est.ballSpeed))}km/h` : ''}</span><span>${dir(s.latDeg)}</span><em>›</em></button>`).join('')}</div>` : ''}
    </div>`).join('')}`;
  $$('[data-open]').forEach(b => b.onclick = () => { open = open === b.dataset.open ? null : b.dataset.open; render(); });
  $$('[data-shot]').forEach(b => b.onclick = () => detail(S.shots.find(s => String(s.id) === b.dataset.shot)));
  $('#lmAdd').onclick = addShot; $('#lmFile').onclick = () => pickLaunchFile(() => render());
}
function addShot() {
  openLMForm({ onSave: (lm, club) => { const s = addLMShot(lm, club); open = club; render(); toast('📟 샷을 추가했어요'); detail(s); } });
}

function detail(s) {
  if (!s) return;
  shotSheet(s, { onChange: render, extra: [{ label: '🗑 지우기', onClick: async () => {
    if (!(await confirmSheet('샷 지우기', '잘못 잰 샷이면 지워요. 클럽 평균 거리도 다시 계산해요.', '지우기', 'danger'))) return;
    S.shots = S.shots.filter(x => x !== s);
    const i = S.bag.findIndex(c => c.id === s.club); if (i >= 0) S.bag[i] = learnClub(S.bag[i], S.shots);
    save('shots', 'bag'); toast('지웠어요'); render();
  } }] });
}
