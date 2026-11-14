// 대시보드: 발행 현황 · 오늘의 핀 · 공지 · 배포 상태 · 최근 발행 이력
import { $, esc } from '../../ui.js';
import { Store } from '../store.js';
import * as M from '../model.js';
import { fmtDT, ago, readonlyNote } from '../common.js';

export default {
  async mount(el) {
    el.innerHTML = `<div class="a-head"><div class="grow"><h1>📊 대시보드</h1><p class="sub">${esc(Store.conf.owner)}/${esc(Store.conf.repo)} · ${new Date().toLocaleDateString('ko-KR', { dateStyle: 'full' })}</p></div>
      <div class="a-actions"><a class="btn primary" href="#/pins">📍 오늘의 핀 입력</a><a class="btn" href="#/notices">📢 공지 올리기</a><a class="btn" href="#/courses">🗺️ 코스 관리</a></div></div>
      ${readonlyNote()}<div id="body"><div class="empty">불러오는 중…</div></div>`;
    const [cat, notices] = await Promise.all([Store.loadCatalog(true), Store.loadNotices(true)]);
    const today = M.todayKey();
    const pins = await Promise.all(cat.courses.map(c => Store.loadPins(c.id, true).catch(() => ({ data: null }))));
    const drafts = Store.draftIds();
    const active = notices.items.filter(n => M.noticeActive(n));
    const pinToday = pins.filter(p => p.data?.date === today).length;
    const reports = Store.reports();
    const bodyEl = $('#body', el); if (!bodyEl) return; // 불러오는 사이 다른 화면으로 이동
    bodyEl.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="v">${cat.courses.length}<small>개</small></div><div class="l">발행된 코스</div><div class="d">${cat.courses.reduce((a, c) => a + c.holes, 0)}홀 · 그린맵 ${cat.courses.reduce((a, c) => a + (c.greens || 0), 0)}개</div></div>
        <div class="kpi"><div class="v">${pinToday}<small>/ ${cat.courses.length}</small></div><div class="l">오늘 핀 발행</div><div class="d">${pinToday < cat.courses.length ? '<span class="badge warn">미발행 코스 있음</span>' : cat.courses.length ? '<span class="badge">모두 발행</span>' : '—'}</div></div>
        <div class="kpi"><div class="v">${active.length}<small>건</small></div><div class="l">게시 중 공지</div><div class="d">${active.some(n => n.level === 'danger') ? '<span class="badge err">⚠ 긴급 공지 게시 중</span>' : `전체 ${notices.items.length}건`}</div></div>
        <div class="kpi"><div class="v">${drafts.length}<small>개</small></div><div class="l">발행 안 된 임시저장</div><div class="d">${drafts.length ? '이 기기에만 있음' : '없음'}</div></div>
        <div class="kpi"><div class="v">${reports.length}<small>건</small></div><div class="l">수집한 라운드 리포트</div><div class="d"><a href="#/analytics">운영 분석 →</a></div></div>
      </div>
      <h2>코스별 현황</h2>
      ${cat.courses.length ? `<div class="tblbox"><table class="a-tbl"><thead><tr><th>코스</th><th>지역</th><th class="num">홀</th><th class="num">파</th><th class="num">rev</th><th>최근 발행</th><th>그린맵</th><th>오늘 핀</th><th></th></tr></thead><tbody>
        ${cat.courses.map((c, i) => { const p = pins[i].data; const pinOk = p?.date === today; return `<tr>
          <td><b>${esc(c.name)}</b><br><span class="sub mono">${esc(c.id)}</span>${drafts.includes(c.id) ? ' <span class="badge warn">임시저장</span>' : ''}</td>
          <td>${esc(c.region || '—')}</td><td class="num">${c.holes}</td><td class="num">${c.par}</td><td class="num">${c.rev}</td><td>${ago(c.updatedAt)}</td>
          <td>${c.greens >= c.holes ? '<span class="badge">전 홀</span>' : c.greens ? `<span class="badge warn">${c.greens}/${c.holes}</span>` : '<span class="badge mute">없음</span>'}</td>
          <td>${pinOk ? `<span class="badge">✓ 스팀프 ${p.stimp}</span>` : p ? `<span class="badge warn">${esc(p.date)}</span>` : '<span class="badge mute">없음</span>'}</td>
          <td style="white-space:nowrap"><a class="btn small" href="#/pins/${encodeURIComponent(c.id)}">핀</a> <a class="btn small" href="#/course/${encodeURIComponent(c.id)}">편집</a></td></tr>`; }).join('')}
      </tbody></table></div>` : `<div class="card empty-card">아직 발행된 코스가 없습니다.<br><a class="btn primary" href="#/courses" style="margin-top:10px">첫 코스 만들기</a></div>`}
      ${active.length ? `<h2>게시 중 공지</h2>${active.map(n => `<div class="card tight"><span class="badge ${n.level === 'danger' ? 'err' : n.level === 'warn' ? 'warn' : ''}">${M.NOTICE_LEVELS[n.level]}</span> <b>${esc(n.title)}</b> <span class="sub">${n.courseId ? esc(cat.courses.find(c => c.id === n.courseId)?.name || n.courseId) : '전체 코스'} · ${n.end ? '~' + fmtDT(n.end) : '종료 없음'}</span></div>`).join('')}` : ''}
      <h2>최근 발행 이력</h2><div id="hist"><div class="empty">불러오는 중…</div></div>`;
    try {
      const commits = await Store.publicGH().commits('data', 8);
      if (!$('#hist', el)) return;
      $('#hist', el).innerHTML = commits.length ? `<div class="tblbox"><table class="a-tbl"><thead><tr><th>시각</th><th>작성자</th><th>내용</th></tr></thead><tbody>${commits.map(c => `<tr><td style="white-space:nowrap">${fmtDT(c.commit.author.date)}</td><td>${esc(c.author?.login || c.commit.author.name)}</td><td><a href="${esc(c.html_url)}" target="_blank" rel="noopener">${esc(c.commit.message.split('\n')[0])}</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="sub">아직 발행 이력이 없습니다.</p>';
    } catch (e) { if ($('#hist', el)) $('#hist', el).innerHTML = `<p class="sub">이력을 불러오지 못했습니다: ${esc(e.message)}</p>`; }
  },
};
