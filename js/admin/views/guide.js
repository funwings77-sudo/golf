// 📘 사용자 가이드 (매뉴얼): 실제 앱 화면 캡처 + 번호 설명
//  원고·캡처 순서는 scripts/guide-steps.mjs · 화면이 바뀌면 npm run guide:capture 로 다시 찍음 → guide/guide.json
import { $, $$, esc } from '../../ui.js';

let data = null;
export default {
  async mount(el) {
    el.innerHTML = `<div class="a-head"><div class="grow"><h1>📘 사용자 가이드</h1>
      <p class="sub">골퍼용 앱 사용법입니다. 실제 앱 화면을 찍은 그림에 번호를 달아 설명했습니다. 골퍼 안내·직원 교육·인쇄용으로 쓰세요.</p></div>
      <div class="a-actions"><button class="btn" id="gPrint">🖨️ 인쇄 · PDF</button></div></div>
      <div id="gBody"><div class="empty">가이드를 불러오는 중…</div></div>`;
    $('#gPrint', el).onclick = () => window.print();
    try { data = data || await (await fetch('guide/guide.json', { cache: 'no-cache' })).json(); }
    catch { $('#gBody', el).innerHTML = '<div class="card empty-card">가이드 파일(guide/guide.json)을 불러오지 못했습니다. <code>npm run guide:capture</code>로 만드세요.</div>'; return; }
    render(el);
  },
};

const screenCount = () => data.sections.reduce((a, s) => a + s.screens.length, 0);

function render(el) {
  const d = data, when = d.capturedAt ? new Date(d.capturedAt).toLocaleDateString('ko-KR') : '';
  $('#gBody', el).innerHTML = `
    <div class="card gd-cover">
      <div class="gd-cover-t"><b>${esc(d.meta.title)}</b><span class="sub">화면 ${screenCount()}개 · 앱 화면 기준일 ${esc(when)}</span></div>
      <div class="gd-quick"><b>처음이라면 이것만!</b>
        <ol><li>앱을 열고 아래 가운데 <b>[골프 치기]</b>를 눌러요.</li><li>위치를 <b>허용</b>하고, 가까운 골프장의 <b>[여기서 시작]</b>을 눌러요.</li>
        <li>휴대폰을 들어 치고 싶은 곳을 비추면 <b>거리와 클럽</b>이 나와요. 친 뒤에는 <b>[쳤어요]</b>.</li><li>그린에서는 아래 메뉴 <b>[그린]</b> → 화면의 <b>홀컵을 한 번</b> 누르면 퍼팅 길이 나와요.</li>
        <li>홀이 끝나면 <b>[홀 끝 · 점수]</b>로 타수를 적고 다음 홀로 가요.</li></ol></div>
      <nav class="gd-toc">${d.sections.map(s => `<div><b>${esc(s.title)}</b>${s.screens.map(sc => `<a href="javascript:void 0" data-go="${esc(sc.id)}">${esc(sc.title)}</a>`).join('')}</div>`).join('')}
        <div><b>7. 자주 묻는 질문</b><a href="javascript:void 0" data-go="faq">문제가 생겼을 때</a></div></nav>
    </div>
    ${d.sections.map(s => `<section class="gd-sec"><h2>${esc(s.title)}</h2>${s.intro ? `<p class="sub">${esc(s.intro)}</p>` : ''}${s.screens.map(screen).join('')}</section>`).join('')}
    <section class="gd-sec" id="gd-faq"><h2>7. 자주 묻는 질문</h2>
      <div class="card">${(d.faq || []).map(([q, a]) => `<details class="gd-faq" open><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>
    <p class="sub gd-foot">그림 속 숫자·거리는 예시입니다 (강남300 1번 홀 · 연습용 그린 값). 그림의 카메라 배경은 설명용으로 그린 그림입니다.</p>`;
  $$('[data-go]', el).forEach(a => (a.onclick = () => $(a.dataset.go === 'faq' ? '#gd-faq' : `#gd-${a.dataset.go}`, el)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  // 번호 ↔ 설명 강조
  $$('.gd-scr', el).forEach(box => {
    const on = (n, v) => box.querySelectorAll(`[data-n="${n}"]`).forEach(x => x.classList.toggle('hl', v));
    box.querySelectorAll('[data-n]').forEach(x => { x.onmouseenter = () => on(x.dataset.n, true); x.onmouseleave = () => on(x.dataset.n, false); });
  });
}

function screen(sc) {
  const shown = sc.marks.map((m, i) => ({ ...m, n: i + 1 })), pct = (v, t) => `${Math.max(0, Math.min(100, (v / t) * 100)).toFixed(2)}%`;
  const badges = shown.filter(m => !m.miss && !m.off).map(m => `
    <span class="gd-box" data-n="${m.n}" style="left:${pct(m.x, sc.w)};top:${pct(m.y, sc.h)};width:${pct(m.w, sc.w)};height:${pct(m.h, sc.h)}"></span>
    <span class="gd-badge" data-n="${m.n}" style="left:${pct(m.w > sc.w * 0.45 ? Math.min(m.x + m.w - 20, sc.w - 26) : Math.min(m.x, sc.w - 26), sc.w)};top:${pct(Math.max(0, m.y - 10), sc.h)}">${m.n}</span>`).join('');
  return `<article class="card gd-scr" id="gd-${esc(sc.id)}">
    <div class="gd-txt">
      <h3>${esc(sc.title)}</h3>
      ${sc.how ? `<p class="gd-how"><b>여는 법</b> ${esc(sc.how)}</p>` : ''}
      ${sc.intro ? `<p>${esc(sc.intro)}</p>` : ''}
      <ol class="gd-marks">${shown.map(m => `<li data-n="${m.n}"><span class="gd-num">${m.n}</span><div><b>${esc(m.t)}</b><p>${esc(m.d)}</p></div></li>`).join('')}</ol>
      ${sc.legend?.length ? `<div class="gd-legend"><b>화면 기호</b><dl>${sc.legend.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>` : ''}
      ${sc.tips?.length ? `<div class="gd-tips">${sc.tips.map(t => `<p>💡 ${esc(t)}</p>`).join('')}</div>` : ''}
    </div>
    <figure class="gd-phone"><div class="gd-shot"><img src="${esc(sc.img)}" alt="${esc(sc.title)} 화면" loading="lazy" width="${sc.w}" height="${sc.h}">${badges}</div></figure>
  </article>`;
}
