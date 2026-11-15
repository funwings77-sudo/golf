import { S, save, MODES, DEFAULT_SETTINGS } from '../core/state.js';
import { requestMotionPermission, Sensors, startOrientation } from '../core/sensors.js';
import { $, $$, toast, confirmSheet, esc } from '../ui.js';
import { getKey, setKey, getModel, setModel, hasKey, testConnection, usageToday } from '../core/gemini.js';

const SW = [
  ['detail', '자세히 화면 (전문가)', '끄면 쉬운 화면: 큰 거리 · 한 줄 안내 · 큰 버튼 4개 (기능은 [더보기]에 모두 있어요)'],
  ['voice', '음성 안내', '이어버드로 "핀까지 142미터" 안내'],
  ['outdoor', '야외 고대비 모드', '강한 햇빛 아래 가독성'],
  ['bigText', '큰 글씨 (시니어)', ''],
  ['beginner', '입문자 가이드', '홀마다 "지금 할 일"·에티켓 안내'],
  ['weather', '날씨·낙뢰·폭염 정보', '위치 좌표를 Open-Meteo에 보내 날씨를 받습니다'],
  ['swingDetect', '스윙 자동 감지 (실험)', '휴대폰을 주머니에 넣고 스윙하면 샷 위치 저장'],
  ['simGPS', 'GPS 시뮬레이션', '실내 테스트: 지도를 탭해 내 위치 지정'],
];

export default {
  mount(el) {
    const st = S.settings;
    const num = (k, label, min, max, step, unit = '') => `<label class="f"><span>${label}</span><div class="row"><input type="number" data-num="${k}" value="${st[k]}" min="${min}" max="${max}" step="${step}" class="grow"><span class="sub">${unit}</span></div></label>`;
    el.innerHTML = `<h2>⚙️ 설정</h2>
      <div class="card ai-set" id="aiSet"><b>🤖 AI 캐디 (Google Gemini)</b>
        <p class="sub">질문에 쉬운 말로 답하고, 라운드를 분석해 연습을 처방해요. <b>거리·클럽·힘·조준 숫자는 PinPoint 엔진이 계산</b>하고, AI 답에 엔진과 다른 숫자가 있으면 자동으로 걸러 내요.</p>
        <label class="f"><span>Gemini API 키 ${hasKey() ? '<b style="color:var(--green)">✓ 저장됨</b>' : ''}</span><input type="password" id="gKey" autocomplete="off" spellcheck="false" placeholder="AIza… (Google AI Studio에서 무료 발급)" value="${esc(getKey())}"></label>
        <div class="grid2"><button class="btn primary" id="gTest">🔌 저장 · 연결 시험</button><button class="btn" id="gDel">키 지우기</button></div>
        <p class="sub" id="gStat">${hasKey() ? `모델: ${esc(getModel() || '자동 선택')} · 오늘 ${usageToday().n}회` : '키 발급: 컴퓨터나 휴대폰 브라우저에서 aistudio.google.com/apikey → [API 키 만들기] → 복사해서 위에 붙여 넣기'}</p>
        <details><summary>개인정보 · 안전 안내</summary><p class="sub">· 키는 이 휴대폰에만 저장되고, 요청은 휴대폰에서 Google로 바로 가요 (PinPoint 서버 없음).<br>· AI에 보내는 것: 홀 번호·파·거리·클럽 비거리·바람·질문 글 (위치 좌표·이름·동반자 정보는 보내지 않아요). 사진은 직접 붙였을 때만.<br>· Google 무료 사용량에서는 보낸 내용이 Google 서비스 개선에 쓰일 수 있어요 (Google 약관). 원하지 않으면 키를 지우세요.<br>· 🏆 대회 모드에서는 AI 샷 조언이 꺼져요 (규칙 4.3a·10.2). 규칙 질문만 돼요.<br>· 키를 다른 사람에게 보여 주지 마세요. 사용량은 Google AI Studio에서 확인·제한할 수 있어요.</p></details></div>
      <div class="card"><b>기본 플레이 모드</b><div class="seg" id="mode" style="margin-top:8px">${Object.entries(MODES).map(([k, m]) => `<button data-v="${k}" class="${st.mode === k ? 'on' : ''}">${m.label}</button>`).join('')}</div><p class="sub">${MODES[st.mode].desc}</p></div>
      <div class="card"><div class="grid2">
        <label class="f"><span>거리 단위</span><div class="seg" id="unit"><button data-v="m" class="${st.unit === 'm' ? 'on' : ''}">미터</button><button data-v="yd" class="${st.unit === 'yd' ? 'on' : ''}">야드</button></div></label>
        <label class="f"><span>주 사용 손</span><div class="seg" id="hand"><button data-v="R" class="${st.hand === 'R' ? 'on' : ''}">오른손</button><button data-v="L" class="${st.hand === 'L' ? 'on' : ''}">왼손</button></div></label></div>
        <div class="grid2">${num('hcp', '핸디캡', 0, 54, 1)}<label class="f"><span>성별 (기본 비거리)</span><div class="seg" id="gender"><button data-v="M" class="${st.gender === 'M' ? 'on' : ''}">남</button><button data-v="F" class="${st.gender === 'F' ? 'on' : ''}">여</button></div></label></div></div>
      <div class="card"><b>측정</b><div class="grid2">${num('eyeHeight', '눈높이 (AR 퍼팅)', 1.0, 2.0, 0.01, 'm')}${num('phoneHeight', '가슴 높이 (공 탐지)', 0.8, 1.8, 0.01, 'm')}${num('stepLen', '보폭', 0.4, 1.2, 0.01, 'm')}${num('cameraVFov', '카메라 세로 화각', 40, 90, 1, '°')}${num('stimp', '기본 그린 스피드', 6, 14, 0.5, 'ft')}${num('roundsPerMonth', '월 라운드 수', 0, 30, 1, '회')}</div></div>
      <div class="card"><b>퍼팅 실력 (몬테카를로 오차)</b><div class="grid2">${num('aimSigma', '조준 오차 σ', 0.3, 4, 0.1, '°')}${num('speedSigma', '세기 오차 σ (0.06=6%)', 0.02, 0.2, 0.01)}</div></div>
      <div class="card">${SW.map(([k, n, d]) => `<label class="switch"><span><b>${n}</b>${d ? `<br><span class="sub">${d}</span>` : ''}</span><input type="checkbox" data-sw="${k}" ${st[k] ? 'checked' : ''}></label>`).join('')}</div>
      <div class="card"><b>센서 권한</b><p class="sub">iPhone은 나침반·기울기 센서 사용에 권한 요청이 필요합니다. 현재: 방위 ${Sensors.heading != null ? '✅' : '—'} · 기울기 ${Sensors.beta != null ? '✅' : '—'} · 위치 ${Sensors.pos ? '✅' : '—'}</p><button class="btn block" id="perm">센서 권한 요청</button></div>
      <button class="btn danger block" id="wipe">모든 데이터 삭제</button>`;
    const seg = (id, key, after) => $$(`#${id} button`).forEach(b => b.onclick = () => { st[key] = b.dataset.v; save('settings'); after ? after() : this.mount(el); });
    seg('mode', 'mode'); seg('unit', 'unit'); seg('hand', 'hand'); seg('gender', 'gender');
    $$('[data-num]').forEach(i => i.onchange = () => { const v = +i.value; if (isFinite(v)) { st[i.dataset.num] = v; save('settings'); toast('저장'); } });
    $$('[data-sw]').forEach(i => i.onchange = () => { st[i.dataset.sw] = i.checked; save('settings'); });
    $('#perm').onclick = async () => { const ok = await requestMotionPermission(); startOrientation(); if ('geolocation' in navigator) navigator.geolocation.getCurrentPosition(() => {}, () => {}); toast(ok ? '센서 권한 허용' : '권한이 거부되었거나 필요 없습니다'); setTimeout(() => this.mount(el), 1200); };
    $('#gTest').onclick = async () => {
      const k = $('#gKey').value.trim(), st2 = $('#gStat');
      if (!/^[A-Za-z0-9_\-]{20,}$/.test(k)) { st2.textContent = '⚠ 키 모양이 이상해요. 복사한 키 전체를 붙여 넣어 주세요'; return; }
      st2.textContent = '🔌 Google에 연결하는 중…';
      try { const r = await testConnection(k, m => { st2.textContent = `🔌 ${m} 응답 확인 중…`; }); setKey(k); setModel(r.model); st2.innerHTML = `✅ 연결 성공 · <b>${esc(r.model)}</b> (응답 ${(r.ms / 1000).toFixed(1)}초)${r.backups.length ? ` · 예비 ${r.backups.map(esc).join(', ')}` : ''}`; toast('AI 캐디 준비 완료'); }
      catch (e) { st2.textContent = '❌ ' + e.message; }
    };
    $('#gDel').onclick = () => { setKey(''); setModel(''); $('#gKey').value = ''; $('#gStat').textContent = '키를 지웠어요. AI 기능이 꺼졌어요'; };
    $('#wipe').onclick = async () => {
      if (!(await confirmSheet('모든 데이터 삭제', '코스·라운드·샷 기록·설정을 모두 지웁니다. 되돌릴 수 없습니다.', '삭제', 'danger'))) return;
      Object.keys(localStorage).filter(k => k.startsWith('pinpoint.')).forEach(k => localStorage.removeItem(k));
      sessionStorage.clear(); location.reload();
    };
    void DEFAULT_SETTINGS;
  },
};
