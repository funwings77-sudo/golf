// 운영 분석 (골프장 B2B): 골퍼가 제출한 비식별 라운드 리포트 → 홀별 진행 속도·병목, 난이도, 분실구 지점
//  · 리포트는 앱 '기록 → 골프장 제출용 리포트'로 만든 파일. 이 기기 브라우저에만 저장됩니다.
import { $, $$, esc, toast, sheet } from '../../ui.js';
import { createMap, destroyMap, ll } from '../../map.js';
import { Store } from '../store.js';
import * as M from '../model.js';
import { download, readFiles, courseSelect, remember, n1, pct, signed, bindTip } from '../common.js';

let st = null, el_ = null;
export default {
  async mount(el) {
    el_ = el;
    const cat = await Store.loadCatalog();
    st = { cat, courseId: remember('anaCourse') || '', from: '', to: '', map: null };
    render();
  },
  unmount() { destroyMap(st?.map); st = null; },
};

async function render() {
  destroyMap(st.map); st.map = null;
  const all = Store.reports();
  const ids = [...new Set(all.map(r => r.courseId).filter(Boolean))];
  const courses = [...st.cat.courses.filter(c => ids.includes(c.id)), ...ids.filter(i => !st.cat.courses.some(c => c.id === i)).map(i => ({ id: i, name: i + ' (미등록)', holes: 0 }))];
  if (!courses.some(c => c.id === st.courseId)) st.courseId = courses[0]?.id || '';
  const rs = all.filter(r => r.courseId === st.courseId && (!st.from || r.date >= st.from) && (!st.to || r.date <= st.to));
  const course = st.courseId ? (await Store.loadCourse(st.courseId).catch(() => ({ data: null }))).data : null;
  const agg = rs.length ? M.aggregateReports(rs, course) : null;
  const unlinked = all.filter(r => !r.courseId).length;

  el_.innerHTML = `<div class="a-head"><div class="grow"><h1>📈 운영 분석</h1><p class="sub">골퍼가 앱에서 내보낸 <b>비식별 라운드 리포트</b>(내 스코어·홀 도착 시각·분실구 지점만 포함)를 모아 홀별 진행 속도와 난이도를 봅니다. 데이터는 이 브라우저에만 저장되고 서버로 보내지 않습니다.</p></div>
    <div class="a-actions"><button class="btn primary" id="imp">📥 리포트 가져오기</button><input type="file" id="impFile" accept=".json,application/json" multiple hidden>${agg ? '<button class="btn" id="csv">⬇ CSV</button>' : ''}<button class="btn" id="mgr">🗂️ 데이터 관리 (${all.length})</button></div></div>
    ${!all.length ? `<div class="card empty-card"><b>아직 리포트가 없습니다</b><p>골퍼가 앱 <b>☰ → 라운드 기록 → 골프장 제출용 리포트</b>로 만든 JSON 파일(여러 개 가능)을 가져오세요.<br>카카오톡·이메일로 받은 파일을 그대로 선택하면 됩니다. 중복은 자동으로 걸러집니다.</p></div>` : `
    <div class="card tight row">${courses.length ? courseSelect(courses.map(c => ({ ...c, holes: c.holes || '?' })), st.courseId) : ''}
      <label class="row" style="gap:6px;font-size:13px">기간 <input type="date" id="from" value="${st.from}" style="width:auto;min-height:36px"> ~ <input type="date" id="to" value="${st.to}" style="width:auto;min-height:36px"></label>
      <span class="sub">${rs.length}개 라운드${unlinked ? ` · 공식 코스 아닌 리포트 ${unlinked}건 제외` : ''}</span></div>
    ${!agg ? '<div class="card empty-card">이 조건에 맞는 리포트가 없습니다.</div>' : body(agg, course)}`}`;

  $('#imp').onclick = () => $('#impFile').click();
  $('#impFile').onchange = async e => {
    const files = await readFiles(e.target); e.target.value = '';
    const list = [];
    for (const f of files) { try { const j = JSON.parse(f.text); (Array.isArray(j) ? j : [j]).forEach(x => list.push(x)); } catch { toast(`${f.name}: JSON이 아닙니다`); } }
    try {
      const r = Store.addReports(list);
      toast(`추가 ${r.added}건 · 중복 ${r.dup}건${r.bad.length ? ` · 형식 오류 ${r.bad.length}건` : ''}`, 4000);
      if (!st.courseId && list[0]?.courseId) st.courseId = list[0].courseId;
      render();
    } catch (err) { toast(err.message, 5000); }
  };
  $('#csv')?.addEventListener('click', () => download(`pinpoint-${st.courseId}-${M.todayKey()}.csv`, M.reportsToCSV(agg), 'text/csv;charset=utf-8'));
  $('#mgr').onclick = manage;
  $('#courseSel')?.addEventListener('change', e => { st.courseId = e.target.value; remember('anaCourse', st.courseId); render(); });
  $('#from')?.addEventListener('change', e => { st.from = e.target.value; render(); });
  $('#to')?.addEventListener('change', e => { st.to = e.target.value; render(); });
  if (agg) { bindTip(el_); drawLostMap(agg, course); }
}

function body(agg, course) {
  const hs = agg.holes, flagged = hs.filter(h => h.bottleneck);
  const hdcpGap = course ? hs.filter(h => h.difficultyRank && course.holes.find(x => x.n === h.n)?.hdcp && Math.abs(course.holes.find(x => x.n === h.n).hdcp - h.difficultyRank) >= 5) : [];
  return `
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><div class="v">${agg.rounds}</div><div class="l">라운드 (연습 ${agg.excludedPractice} 제외)</div></div>
      <div class="kpi"><div class="v">${agg.medianRoundMin ? Math.floor(agg.medianRoundMin / 60) + '<small>시간</small> ' + Math.round(agg.medianRoundMin % 60) + '<small>분</small>' : '—'}</div><div class="l">라운드 소요 (중앙값)</div></div>
      <div class="kpi"><div class="v">${signed(agg.avgToPar, 1)}</div><div class="l">평균 스코어 (파 대비, 완주 ${agg.fullRounds})</div></div>
      <div class="kpi"><div class="v">${n1(agg.lostPerRound, 2)}</div><div class="l">라운드당 분실구</div><div class="d">찾은 비율 ${pct(agg.lostFoundRate)}</div></div>
      <div class="kpi"><div class="v">${flagged.length}<small>홀</small></div><div class="l">진행 병목 (목표 +15% 초과)</div><div class="d">${flagged.length ? flagged.map(h => h.n + '번').join(' · ') : '없음'}</div></div>
    </div>
    <h2>홀별 진행 시간 <span class="sub" style="font-weight:400">· 중앙값(분), 표본 3개 이상</span></h2>
    <div class="card">${paceChart(hs)}</div>
    ${flagged.length ? `<div class="note"><b>⚠ 병목 ${flagged.map(h => h.n + '번').join(', ')}</b> — ${flagged.map(h => `${h.n}번: 중앙값 ${n1(h.paceMedian)}분 (목표 ${h.paceTarget}분)${h.lostPerRound > 0.3 ? `, 분실구 라운드당 ${n1(h.lostPerRound, 2)}개 → 분실구 지점 정비·마커 보강 검토` : ''}`).join(' / ')}</div>` : ''}
    <h2>홀별 지표</h2>
    <div class="tblbox"><table class="a-tbl"><thead><tr><th>홀</th><th class="num">Par</th><th class="num">표본</th><th class="num">평균 타수</th><th class="num">파 대비</th><th class="num">퍼트</th><th class="num">3퍼트</th><th class="num">버디↑</th><th class="num">더블↓</th><th class="num">분실/라운드</th><th class="num">진행(중앙값)</th><th class="num">난이도 순위</th><th class="num">공식 핸디캡</th></tr></thead><tbody>
      ${hs.map(h => { const hd = course?.holes.find(x => x.n === h.n)?.hdcp; return `<tr><td><b>${h.n}</b></td><td class="num">${h.par}</td><td class="num">${h.rounds}</td><td class="num">${n1(h.avgStrokes, 2)}</td><td class="num">${signed(h.avgToPar, 2)}</td><td class="num">${n1(h.avgPutts, 2)}</td><td class="num">${pct(h.threePuttRate)}</td><td class="num">${pct(h.birdieRate)}</td><td class="num">${pct(h.doubleRate)}</td><td class="num">${n1(h.lostPerRound, 2)}</td>
        <td class="num">${h.paceMedian != null ? n1(h.paceMedian) + '분' : '—'}${h.bottleneck ? ' <span class="badge warn">⚠ 병목</span>' : ''}</td><td class="num">${h.difficultyRank ?? '—'}</td><td class="num">${hd ?? '—'}${hd && h.difficultyRank && Math.abs(hd - h.difficultyRank) >= 5 ? ' <span class="badge warn">차이</span>' : ''}</td></tr>`; }).join('')}
    </tbody></table></div>
    ${hdcpGap.length ? `<p class="sub">공식 핸디캡 순위와 실제 난이도 순위가 5 이상 차이 나는 홀: ${hdcpGap.map(h => h.n + '번').join(', ')} — 표본이 충분히 쌓이면(홀당 30라운드 이상 권장) 핸디캡 재배정을 검토하세요.</p>` : ''}
    <h2>분실구 지점 <span class="sub" style="font-weight:400">· ${hs.reduce((a, h) => a + h.lostPoints.length, 0)}개 (빨강 = 못 찾음, 초록 = 찾음)</span></h2>
    <div class="a-map short"><div class="map" id="lmap"></div></div>
    <p class="sub">분실이 몰리는 지점은 러프 정리·OB 말뚝 가시성·티잉 구역 방향 조정 후보입니다. 진행 병목과 함께 보세요.</p>`;
}

// 단일 계열 막대(진행 중앙값) + 목표선. 병목은 경고색 + ⚠ 라벨(색만으로 구분하지 않음)
function paceChart(hs) {
  const data = hs.filter(h => h.paceMedian != null && h.paceN >= 3);
  if (!data.length) return '<p class="sub">진행 시간 표본이 부족합니다 (홀당 3라운드 이상 필요, 리포트에 홀 도착 시각이 있어야 함).</p>';
  const W = 760, H = 240, pl = 34, pr = 8, pt = 14, pb = 26, max = Math.max(...data.map(h => Math.max(h.paceP80 ?? h.paceMedian, h.paceTarget))) * 1.1;
  const bw = (W - pl - pr) / data.length, y = v => pt + (H - pt - pb) * (1 - v / max);
  const ticks = []; for (let v = 0; v <= max; v += max > 30 ? 10 : 5) ticks.push(v);
  return `<div class="legend"><span><i class="sw"></i>진행 시간 중앙값</span><span><i class="sw flag"></i>⚠ 병목 (목표 +15% 초과)</span><span><i class="tk"></i>목표 (파3 11 · 파4 15 · 파5 18분)</span></div>
  <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="홀별 진행 시간 막대 차트">
    <g class="grid">${ticks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
    <g class="ax">${ticks.map(v => `<text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      ${data.map((h, i) => `<text x="${pl + bw * i + bw / 2}" y="${H - 8}" text-anchor="middle">${h.n}</text>`).join('')}</g>
    ${data.map((h, i) => {
      const x = pl + bw * i + bw * 0.18, w = bw * 0.64, top = y(h.paceMedian), base = y(0), r = Math.min(4, w / 2);
      const tip = `<b>${h.n}번 홀 · Par ${h.par}</b><br>중앙값 ${n1(h.paceMedian)}분 · 상위 20% ${n1(h.paceP80)}분<br>목표 ${h.paceTarget}분 · 표본 ${h.paceN}${h.bottleneck ? '<br>⚠ 병목' : ''}`;
      return `<g data-tip="${esc(tip)}"><rect class="hit" x="${pl + bw * i}" y="${pt}" width="${bw}" height="${H - pt - pb}"/>
        <path class="bar ${h.bottleneck ? 'flag' : ''}" d="M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z"/>
        <line class="target" x1="${x - 3}" x2="${x + w + 3}" y1="${y(h.paceTarget)}" y2="${y(h.paceTarget)}"/>
        ${h.bottleneck ? `<text x="${x + w / 2}" y="${top - 5}" text-anchor="middle" font-size="12" fill="currentColor">⚠</text>` : ''}</g>`;
    }).join('')}
  </svg></div>`;
}

function drawLostMap(agg, course) {
  const pts = agg.holes.flatMap(h => h.lostPoints.map(p => ({ ...p, hole: h.n })));
  const el = $('#lmap'); if (!el) return;
  const center = pts[0] || course?.holes.find(h => h.green)?.green || { lat: 36.5, lon: 127.8 };
  st.map = createMap(el, { center: ll(center), zoom: pts.length ? 16 : 15, me: false });
  if (!st.map) return;
  for (const h of course?.holes || []) if (h.tee && h.green) {
    L.polyline([ll(h.tee), ll(h.green)], { color: '#fff', weight: 1.5, opacity: 0.6, dashArray: '4 6', interactive: false }).addTo(st.map);
    L.marker(ll(h.tee), { icon: L.divIcon({ className: '', html: `<div class="a-mk tee">${h.n}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: false }).addTo(st.map);
  }
  for (const p of pts) L.circleMarker(ll(p), { radius: 6, color: '#fff', weight: 1.5, fillColor: p.found ? '#2f8a5b' : '#d93b2b', fillOpacity: 0.85 }).bindTooltip(`${p.hole}번 홀 · ${p.found ? '찾음' : '분실'}${p.searchSec ? ` · 수색 ${Math.round(p.searchSec / 60)}분` : ''}`).addTo(st.map);
  const b = [...pts.map(ll), ...(course?.holes || []).flatMap(h => [h.tee, h.green].filter(Boolean).map(ll))];
  if (b.length > 1) st.map.fitBounds(L.latLngBounds(b), { padding: [30, 30], maxZoom: 18 });
}

function manage() {
  const all = Store.reports(), by = {};
  for (const r of all) { const k = r.courseId || '(공식 코스 아님)'; by[k] = (by[k] || 0) + 1; }
  sheet({
    title: `저장된 리포트 ${all.length}건`,
    body: `${Object.entries(by).map(([k, n]) => `<div class="kv"><span>${esc(st.cat.courses.find(c => c.id === k)?.name || k)}</span><span class="row" style="gap:6px"><b>${n}건</b><button class="btn small" data-delc="${esc(k)}">삭제</button></span></div>`).join('') || '<p class="sub">없음</p>'}
      <p class="sub" style="margin-top:10px">리포트는 이 브라우저(localStorage)에만 있습니다. 다른 PC로 옮기려면 백업 파일을 내려받아 가져오세요.</p>`,
    actions: [{ label: '닫기' }, { label: '⬇ 전체 백업', onClick: () => download(`pinpoint-reports-${M.todayKey()}.json`, JSON.stringify(all)) }, { label: '모두 삭제', kind: 'danger', onClick: () => { Store.clearReports(); render(); toast('리포트를 모두 삭제했습니다'); } }],
    onMount(card, close) { $$('[data-delc]', card).forEach(b => b.onclick = () => { const k = b.dataset.delc; Store.clearReports(r => (r.courseId || '(공식 코스 아님)') === k); close(); render(); }); },
  });
}
