// 배포 · 이력: GitHub Pages 배포 상태 · 데이터 파일 주소 · Android APK · 발행 이력(감사 로그)
import { $, esc, toast } from '../../ui.js';
import { Store } from '../store.js';
import { fmtDT, ago } from '../common.js';

export default {
  async mount(el) {
    const site = new URL('./', location.href).href;
    const files = ['data/catalog.json', 'data/notices.json'];
    el.innerHTML = `<div class="a-head"><div class="grow"><h1>🚀 배포 · 이력</h1><p class="sub">발행한 데이터는 GitHub Pages로 배포되어 앱이 읽습니다. 모든 변경은 커밋으로 남아 되돌릴 수 있습니다.</p></div>
      <div class="a-actions"><button class="btn" id="re">새로고침</button></div></div>
      <div class="kpis" id="k"><div class="kpi"><div class="v">…</div><div class="l">Pages 배포</div></div></div>
      <div class="split" style="margin-top:12px">
        <div><h2 style="margin-top:0">발행 이력 (data/)</h2><div id="hist"><div class="empty">불러오는 중…</div></div></div>
        <div>
          <div class="card"><h3 style="margin-top:0">앱 연동 주소</h3>
            <div class="kv"><span>웹앱</span><a href="${esc(site)}" target="_blank" rel="noopener">${esc(site)}</a></div>
            <div class="kv"><span>APK 다운로드</span><a href="${esc(site)}download.html" target="_blank" rel="noopener">download.html</a></div>
            ${files.map(f => `<div class="kv"><span>${f}</span><a href="${esc(site + f)}" target="_blank" rel="noopener">열기</a></div>`).join('')}
            <p class="sub" style="margin:8px 0 0">앱(웹·APK)은 위 <code>data/</code>를 읽습니다. 코스 파일은 <code>data/courses/&lt;ID&gt;.json</code>, 오늘의 핀은 <code>data/pins/&lt;ID&gt;.json</code>.</p></div>
          <div class="card" id="apk"><h3 style="margin-top:0">Android 앱</h3><p class="sub">불러오는 중…</p></div>
          <div class="card"><h3 style="margin-top:0">되돌리기</h3><p class="sub" style="margin:0">잘못 발행했으면 이력에서 해당 커밋을 열어 이전 파일 내용을 확인한 뒤, 관리자에서 다시 수정·발행하세요. 저장소 관리자는 GitHub에서 <code>git revert</code>로 커밋 단위 복구도 할 수 있습니다.</p></div>
        </div>
      </div>`;
    const load = async () => {
      const gh = Store.publicGH();
      const [build, pages, commits, runs] = await Promise.all([
        Store.connected ? gh.latestPagesBuild().catch(e => ({ error: e.message })) : null,
        Store.connected ? gh.pages().catch(() => null) : null,
        gh.commits('data', 30).catch(e => ({ error: e.message })),
        Store.connected ? gh.workflowRuns(3) : [],
      ]);
      const run = runs?.[0];
      if (!$('#k', el)) return; // 다른 화면으로 이동함
      $('#k', el).innerHTML = `
        <div class="kpi"><div class="v" style="font-size:20px">${run ? (run.status === 'completed' ? (run.conclusion === 'success' ? '✅ 완료' : '❌ ' + esc(run.conclusion)) : '⏳ 진행 중') : build?.status ? (build.status === 'built' ? '✅ 완료' : esc(build.status)) : '—'}</div><div class="l">최근 Pages 배포</div><div class="d">${run ? ago(run.updated_at) : build?.updated_at ? ago(build.updated_at) : Store.connected ? '권한(Pages/Actions 읽기) 필요' : '연결하면 표시'}</div></div>
        <div class="kpi"><div class="v" style="font-size:20px">${pages?.https_enforced ? '🔒 HTTPS' : pages ? 'HTTP' : '—'}</div><div class="l">사이트</div><div class="d">${pages ? esc(pages.html_url) : '—'}</div></div>
        <div class="kpi"><div class="v">${Array.isArray(commits) ? commits.length : '—'}</div><div class="l">최근 데이터 커밋 (최대 30)</div><div class="d">${Array.isArray(commits) && commits[0] ? ago(commits[0].commit.author.date) : ''}</div></div>`;
      $('#hist', el).innerHTML = commits.error ? `<p class="sub">이력을 불러오지 못했습니다: ${esc(commits.error)}</p>` : commits.length
        ? `<div class="tblbox tall"><table class="a-tbl"><thead><tr><th>시각</th><th>작성자</th><th>내용</th><th></th></tr></thead><tbody>${commits.map(c => `<tr><td style="white-space:nowrap">${fmtDT(c.commit.author.date)}</td><td>${esc(c.author?.login || c.commit.author.name)}</td><td>${esc(c.commit.message.split('\n')[0])}</td><td><a href="${esc(c.html_url)}" target="_blank" rel="noopener" class="mono">${c.sha.slice(0, 7)}</a></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="sub">아직 데이터 발행 이력이 없습니다.</p>';
      try {
        const m = await (await fetch('apk.json?t=' + Date.now(), { cache: 'no-store' })).json();
        if (!$('#apk', el)) return;
        $('#apk', el).innerHTML = `<h3 style="margin-top:0">Android 앱</h3><div class="kv"><span>버전</span><b>${esc(m.versionName)} (code ${m.versionCode})</b></div><div class="kv"><span>크기</span><b>${(m.bytes / 1048576).toFixed(1)}MB</b></div><div class="kv"><span>빌드</span><b>${fmtDT(m.builtAt)}</b></div><p class="sub" style="margin:8px 0 0">새 APK는 개발 PC에서 <code>npm run release:apk</code>로 빌드·업로드합니다. 코스·핀·공지는 APK 재배포 없이 바로 반영됩니다.</p>`;
      } catch { if ($('#apk', el)) $('#apk', el).innerHTML = '<h3 style="margin-top:0">Android 앱</h3><p class="sub">apk.json을 읽지 못했습니다.</p>'; }
    };
    $('#re', el).onclick = () => { load(); toast('새로고침'); };
    await load();
  },
};
