// 연결 설정: GitHub 저장소 + 세분화 토큰(fine-grained PAT)
import { $, esc, toast } from '../../ui.js';
import { Store } from '../store.js';
import { userMapsKey, setMapsKey, testMapsKey } from '../../core/gmaps.js';
import { mapEngine, gmFailInfo, clearGmFail } from '../../core/mapsinit.js';
import { testMapsJs } from '../../core/gleaflet.js';

export default {
  mount(el) {
    const render = (msg = '') => {
      const c = Store.conf;
      el.innerHTML = `<div class="a-head"><div class="grow"><h1>🔑 연결 설정</h1><p class="sub">발행(코스·핀·공지)은 이 저장소의 <code>data/</code> 폴더에 커밋하는 방식입니다. 서버 없이 GitHub가 저장소·이력·권한 관리를 맡습니다.</p></div></div>
        ${msg}
        <div class="split">
          <div>
            <div class="card">
              <h3 style="margin-top:0">${Store.connected ? '✅ 연결됨' : '저장소 연결'}</h3>
              ${Store.connected ? `<div class="kv"><span>계정</span><b>${esc(Store.user?.login || '—')}</b></div>
                <div class="kv"><span>저장소</span><b>${esc(c.owner)}/${esc(c.repo)}</b></div>
                <div class="kv"><span>브랜치</span><b>${esc(c.branch)}</b></div>
                <div class="kv"><span>공개 여부</span><b>${Store.repoInfo?.private ? '비공개' : '공개'}</b></div>
                <div class="kv"><span>토큰 보관</span><b>${Store.remembered ? '이 기기에 기억' : '이 탭을 닫으면 삭제'}</b></div>
                <button class="btn danger block" id="disc" style="margin-top:12px">연결 해제 (토큰 삭제)</button>`
              : `<div class="formgrid">
                  <label class="f"><span>소유자 (owner)</span><input type="text" id="owner" value="${esc(c.owner)}" autocomplete="off"></label>
                  <label class="f"><span>저장소 (repo)</span><input type="text" id="repo" value="${esc(c.repo)}" autocomplete="off"></label>
                  <label class="f"><span>브랜치</span><input type="text" id="branch" value="${esc(c.branch)}" autocomplete="off"></label>
                </div>
                <label class="f"><span>GitHub 토큰 (fine-grained personal access token)</span><input type="password" id="token" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
                <label class="row" style="margin:6px 0 12px;font-size:14px"><input type="checkbox" id="remember"> 이 기기에 기억 (공용 PC에서는 끄세요)</label>
                <button class="btn primary block" id="conn">연결하고 권한 확인</button>
                ${Store.connError ? `<div class="note err">${esc(Store.connError)}</div>` : ''}`}
            </div>
            <div class="card">
              <h3 style="margin-top:0">🗺️ 구글 지도 <span class="badge ${mapEngine() === 'google' ? '' : 'warn'}">${mapEngine() === 'google' ? '진짜 구글 지도 사용 중' : userMapsKey() ? (gmFailInfo() ? '키 거부됨 · 위성 사진 지도' : '위성 사진 지도') : '키 없음 · Esri 위성지도'}</span></h3>
              <p class="sub">관리자 페이지의 지도(코스 편집 · 오늘의 핀 · 운영 분석)를 구글 지도로 봅니다. 키는 <b>이 브라우저에만</b> 저장되고 저장소에는 올라가지 않습니다. 같은 브라우저에서 연 골퍼 앱(웹)도 이 키를 씁니다.</p>
              <label class="f"><span>Google Maps API 키 ${userMapsKey() ? '<b style="color:var(--green)">✓ 저장됨</b>' : ''}</span><input type="password" id="gmKey" autocomplete="off" spellcheck="false" placeholder="AIza…" value="${esc(userMapsKey())}"></label>
              <div class="row" style="gap:8px"><button class="btn primary" id="gmTest">🔌 저장 · 연결 시험</button><button class="btn" id="gmDel">키 지우기</button></div>
              <p class="sub" id="gmStat" style="margin-bottom:0">${gmFailInfo() ? '⚠ 구글이 키를 거부했습니다. Google Cloud 콘솔에서 <b>Maps JavaScript API</b>를 켜고, 키의 웹사이트 제한에 이 주소를 넣은 뒤 다시 시험하세요.' : '필요한 API: <b>Maps JavaScript API</b>(지도 화면) · <b>Map Tiles API</b>(위성 사진·그린 자동 찾기)'}</p>
            </div>
          </div>
          <div class="card">
            <h3 style="margin-top:0">토큰 만드는 법 (3분)</h3>
            <ol style="padding-left:20px;margin:0;font-size:14px;line-height:1.8">
              <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Settings → Fine-grained tokens → Generate new token</a></li>
              <li><b>Token name</b>: <code>pinpoint-admin</code>, <b>Expiration</b>: 90일 권장</li>
              <li><b>Repository access</b>: <i>Only select repositories</i> → <code>${esc(c.owner)}/${esc(c.repo)}</code></li>
              <li><b>Permissions → Repository</b>
                <ul style="padding-left:18px"><li><b>Contents: Read and write</b> (필수 · 발행)</li><li>Pages: Read-only (선택 · 배포 상태 확인)</li><li>Actions: Read-only (선택 · 배포 진행 표시)</li></ul></li>
              <li><b>Generate token</b> → 복사해서 왼쪽에 붙여 넣기</li>
            </ol>
            <div class="note" style="margin-top:12px"><b>보안</b><br>· 토큰은 <code>api.github.com</code>으로만 전송되고 다른 곳으로 보내지 않습니다.<br>· 기본값은 탭을 닫으면 삭제(sessionStorage)입니다.<br>· 이 페이지는 공개 주소지만 토큰 없이는 아무것도 바꿀 수 없습니다.<br>· 관리자를 추가하려면 저장소에 협업자로 초대하고 각자 토큰을 만드세요. 퇴사자는 협업자에서 제거하면 즉시 권한이 사라집니다.</div>
          </div>
        </div>`;
      $('#gmTest').onclick = async () => {
        const k = $('#gmKey').value.trim(), st = $('#gmStat');
        if (!/^[A-Za-z0-9_-]{20,60}$/.test(k)) { st.textContent = '키 모양이 이상합니다. 복사한 키 전체를 붙여 넣으세요'; return; }
        st.textContent = '구글에 연결하는 중…';
        try { await testMapsKey(k); } catch (e) { st.textContent = '위성 사진(Map Tiles API) 연결 실패: ' + e.message; return; }
        setMapsKey(k); clearGmFail();
        const js = await testMapsJs(k);
        st.innerHTML = js.ok ? '<b style="color:var(--green)">✓ 연결됐습니다</b> · 페이지를 새로 고치면 모든 지도가 구글 지도로 바뀝니다' : `위성 사진은 연결됨 · ⚠ 지도 화면은 안 됨: ${esc(js.why)}`;
      };
      $('#gmDel').onclick = () => { setMapsKey(''); clearGmFail(); toast('지도 키를 지웠습니다 · 새로 고치면 Esri 위성지도'); render(); };
      $('#disc')?.addEventListener('click', () => { Store.disconnect(); toast('연결을 해제하고 토큰을 지웠습니다'); render(); });
      $('#conn')?.addEventListener('click', async () => {
        const token = $('#token').value.trim();
        const conf = { owner: $('#owner').value.trim(), repo: $('#repo').value.trim(), branch: $('#branch').value.trim() || 'main' };
        if (!conf.owner || !conf.repo) return toast('소유자와 저장소를 입력하세요');
        if (!/^(github_pat_|ghp_|gho_|ghu_)[A-Za-z0-9_]{20,}$/.test(token)) return toast('GitHub 토큰 형식이 아닙니다');
        const btn = $('#conn'); btn.disabled = true; btn.textContent = '확인 중…';
        try {
          const info = await Store.connect(token, $('#remember').checked, conf);
          toast(`${info.user?.login || ''} 계정으로 연결했습니다`);
          render(`<div class="note ok">연결 성공 · ${esc(conf.owner)}/${esc(conf.repo)} 쓰기 권한 확인됨</div>`);
        } catch (e) { Store.connError = e.message; Store.emit(); render(); }
      });
    };
    render();
  },
};
