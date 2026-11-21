// ⚙️ 설정: 쉬운 질문으로 (키·실력·빠르기를 고르면 필요한 숫자는 앱이 계산) · 전문가 숫자는 맨 아래에 접어 둠
import { S, save, MODES, defaultBag, exportAll, importAll, storageReport } from '../core/state.js';
import { saveFile, pickTextFile } from '../core/files.js';
import { requestMotionPermission, Sensors, startOrientation, restartGPS } from '../core/sensors.js';
import { $, $$, toast, confirmSheet, esc } from '../ui.js';
import { getKey, setKey, getModel, setModel, hasKey, testConnection, usageToday } from '../core/gemini.js';
import { say, audioRoute, openBluetooth, audioNative, ROUTE_WORD } from '../core/voice.js';

// 켜고 끄는 것: [키, 이름, 설명]
const SW = [
  ['bigText', '🔠 큰 글씨', '글씨를 크게 보여 줘요'],
  ['outdoor', '☀️ 햇빛 아래 잘 보이게', '대비를 높여서 밝은 데서도 잘 보여요'],
  ['weather', '⚡ 날씨·번개·더위 알림', '위치를 날씨 서비스(Open-Meteo)에 보내서 날씨를 받아요'],
  ['beginner', '🌱 처음 치는 사람 안내', '홀마다 할 일과 예절을 알려 줘요'],
  ['watchAuto', '⌚ 워치가 스윙을 알아채면 저절로 [쳤어요]', '갤럭시워치·애플워치에서 PinPoint 워치 앱을 켜고 [라운드 시작]을 눌러 두세요'],
  ['swingDetect', '🏌️ 스윙하면 저절로 기록 (실험)', '휴대폰을 주머니에 넣고 치면 친 자리를 기억해요'],
];
// 보통 몇 타 치나요? → 핸디캡 (기본 클럽 거리 계산용)
const LEVELS = [[36, '처음이에요'], [28, '100타쯤'], [18, '90타쯤'], [9, '80타쯤']];
// 퍼팅 실력 → 조준·세기 흔들림 (몬테카를로 확률 계산용)
const PUTT = [[[0.7, 0.05], '잘해요'], [[1.0, 0.06], '보통'], [[1.6, 0.09], '연습 중']];
// 그린 빠르기 (스팀프 ft)
const SPEED = [[8, '🐢 느려요'], [10, '🙂 보통'], [12, '🐇 빨라요']];
// 키(cm) → 눈높이·가슴 높이(m): 서 있을 때 평균 비율
const fromHeight = cm => ({ eyeHeight: +(cm * 0.0093).toFixed(2), phoneHeight: +(cm * 0.0072).toFixed(2) });

export default {
  mount(el) {
    const st = S.settings, E = !st.detail;
    const near = (v, list) => list.reduce((b, x) => (Math.abs(x[0] - v) < Math.abs(b[0] - v) ? x : b))[0];
    const seg = (id, items, cur) => `<div class="seg" id="${id}">${items.map(([v, n]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    const num = (k, label, min, max, step, unit = '') => `<label class="f"><span>${label}</span><div class="row"><input type="number" data-num="${k}" value="${st[k]}" min="${min}" max="${max}" step="${step}" class="grow"><span class="sub">${unit}</span></div></label>`;
    const heightCm = st.myHeight || Math.round(st.eyeHeight / 0.0093);
    const puttCur = PUTT.reduce((b, x) => (Math.abs(x[0][0] - st.aimSigma) < Math.abs(b[0][0] - st.aimSigma) ? x : b))[0].join(',');
    const sensorOk = Sensors.heading != null && Sensors.beta != null;
    el.innerHTML = `<h2>⚙️ 설정</h2>
      <div class="card"><b>화면</b>
        ${seg('detailSeg', [['easy', '🙂 쉬운 화면'], ['detail', '🔧 자세히 (전문가)']], E ? 'easy' : 'detail')}
        <p class="sub">${E ? '지금 할 일 한 줄과 큰 버튼 하나만 보여요. 다른 기능은 [더보기]에 모두 있어요.' : '숫자·지도 표시가 많은 전문가 화면이에요.'}</p></div>
      <div class="card"><b>나</b>
        <label class="f"><span>보통 몇 타 치나요?</span>${seg('lvlSeg', LEVELS, near(st.hcp, LEVELS))}</label>
        <div class="grid2"><label class="f"><span>치는 손</span>${seg('hand', [['R', '오른손'], ['L', '왼손']], st.hand)}</label>
          <label class="f"><span>기본 거리 기준</span>${seg('gender', [['M', '남자'], ['F', '여자']], st.gender)}</label></div>
        <label class="f"><span>내 키 <small class="sub">(카메라로 거리 잴 때 써요)</small></span><div class="row"><input type="number" id="myH" value="${heightCm}" min="100" max="210" step="1" class="grow" inputmode="numeric"><span class="sub">cm</span></div></label>
        <label class="f"><span>거리 단위</span>${seg('unit', [['m', '미터 (m)'], ['yd', '야드 (yd)']], st.unit)}</label></div>
      <div class="card"><b>퍼팅</b>
        <label class="f"><span>퍼팅 실력 <small class="sub">(들어갈 확률 계산에 써요)</small></span>${seg('puttSeg', PUTT.map(([v, n]) => [v.join(','), n]), puttCur)}</label>
        <label class="f"><span>우리 골프장 그린 빠르기</span>${seg('spdSeg', SPEED, near(st.stimp, SPEED))}</label></div>
      <div class="card"><b>경기 방식</b>${seg('mode', Object.entries(MODES).map(([k, m]) => [k, m.label]), st.mode)}<p class="sub">${MODES[st.mode].desc}</p></div>
      <div class="card" id="earCard"><b>🎧 이어폰 · 음성 안내</b>
        <p class="sub" id="routeLine">${window.App?.audioRoute ? `지금 소리: <b>${esc(window.App.audioRoute.name || ROUTE_WORD[window.App.audioRoute.kind])}</b> (${ROUTE_WORD[window.App.audioRoute.kind]})` : '블루투스 이어폰(버즈·에어팟 등)이나 유선 이어폰을 연결하면 안내가 이어폰으로 나와요.'}</p>
        <label class="switch"><span><b>🔊 음성으로 안내하기</b><br><span class="sub">깃발까지 거리·앞뒤·고저차·바람·클럽·조준 방향을 읽어 줘요</span></span><input type="checkbox" data-sw="voice" ${st.voice ? 'checked' : ''}></label>
        <label class="f"><span>얼마나 자세히</span>${seg('vLvl', [['detail', '자세히 (숫자 정밀)'], ['simple', '간단히']], st.voiceLevel || 'detail')}</label>
        <label class="f"><span>말 빠르기</span>${seg('vRate', [['0.85', '🐢 천천히'], ['1', '보통'], ['1.2', '🐇 빠르게']], String(st.voiceRate || 1))}</label>
        <label class="switch"><span><b>이어폰 연결하면 저절로 켜기</b></span><input type="checkbox" data-sw="voiceAuto" ${st.voiceAuto !== false ? 'checked' : ''}></label>
        <label class="switch"><span><b>이어폰 버튼으로 조작</b><br><span class="sub">1번: 다시 듣기 · 2번: 쳤어요 / 공 찾았어요 · 3번: 방금 것 취소</span></span><input type="checkbox" data-sw="voiceButtons" ${st.voiceButtons !== false ? 'checked' : ''}></label>
        <div class="grid2"><button class="btn" id="vTest">🔊 시험 듣기</button><button class="btn" id="btOpen">🎧 블루투스 이어폰 연결</button></div></div>
      <div class="card">${SW.map(([k, n, d]) => `<label class="switch"><span><b>${n}</b>${d ? `<br><span class="sub">${d}</span>` : ''}</span><input type="checkbox" data-sw="${k}" ${st[k] ? 'checked' : ''}></label>`).join('')}</div>
      <div class="card"><b>📍 위치 · 🧭 나침반</b><p class="sub">위치 ${Sensors.pos ? '✅ 쓰고 있어요' : Sensors.gpsState === 'denied' ? '❌ 꺼져 있어요 · 휴대폰 설정 → 애플리케이션 → PinPoint 캐디 → 권한 → 위치를 허용해 주세요' : '아직 못 찾았어요'} · 나침반·기울기 ${sensorOk ? '✅' : '아직'}</p>${sensorOk && Sensors.pos ? '' : '<button class="btn block" id="perm">↻ 다시 허락받기 · 찾기</button>'}</div>
      <details class="card ai-set" id="aiSet" ${hasKey() ? '' : ''}><summary><b>🤖 AI 캐디 (선택)</b> <span class="sub">${hasKey() ? '✓ 켜짐' : '꺼짐 · 구글 키가 있으면 켤 수 있어요'}</span></summary>
        <p class="sub">질문에 쉬운 말로 답하고, 라운드를 돌아보며 연습할 거리를 알려 줘요. <b>거리·클럽·힘·방향 숫자는 PinPoint가 계산</b>하고, AI 답에 다른 숫자가 있으면 저절로 걸러 내요.</p>
        <label class="f"><span>Gemini API 키 ${hasKey() ? '<b style="color:var(--green)">✓ 저장됨</b>' : ''}</span><input type="password" id="gKey" autocomplete="off" spellcheck="false" placeholder="AIza… (Google AI Studio에서 무료 발급)" value="${esc(getKey())}"></label>
        <div class="grid2"><button class="btn primary" id="gTest">🔌 저장 · 연결 시험</button><button class="btn" id="gDel">키 지우기</button></div>
        <p class="sub" id="gStat">${hasKey() ? `모델: ${esc(getModel() || '자동 선택')} · 오늘 ${usageToday().n}회` : '키 받기: 브라우저에서 aistudio.google.com/apikey → [API 키 만들기] → 복사해서 위에 붙여 넣기'}</p>
        <details><summary>개인정보 · 안전 안내</summary><p class="sub">· 키는 이 휴대폰에만 저장되고, 요청은 휴대폰에서 Google로 바로 가요 (PinPoint 서버 없음).<br>· AI에 보내는 것: 홀 번호·파·거리·클럽 비거리·바람·질문 글 (위치 좌표·이름·동반자 정보는 보내지 않아요). 사진은 직접 붙였을 때만.<br>· Google 무료 사용량에서는 보낸 내용이 Google 서비스 개선에 쓰일 수 있어요 (Google 약관). 원하지 않으면 키를 지우세요.<br>· 🏆 대회 모드에서는 AI 샷 조언이 꺼져요 (규칙 4.3a·10.2). 규칙 질문만 돼요.<br>· 키를 다른 사람에게 보여 주지 마세요. 사용량은 Google AI Studio에서 확인·제한할 수 있어요.</p></details></details>
      <details class="card"><summary><b>🔧 전문가 숫자</b> <span class="sub">(보통은 안 바꿔도 돼요)</span></summary>
        <div class="grid2">${num('hcp', '핸디캡', 0, 54, 1)}${num('stimp', '그린 스피드 (스팀프)', 6, 14, 0.5, 'ft')}${num('eyeHeight', '눈높이 (AR 퍼팅)', 1.0, 2.0, 0.01, 'm')}${num('phoneHeight', '가슴 높이 (공 탐지)', 0.8, 1.8, 0.01, 'm')}${num('stepLen', '한 걸음 길이', 0.4, 1.2, 0.01, 'm')}${num('cameraVFov', '카메라 세로 화각', 40, 90, 1, '°')}${num('aimSigma', '조준 오차 σ', 0.3, 4, 0.1, '°')}${num('speedSigma', '세기 오차 σ (0.06=6%)', 0.02, 0.2, 0.01)}${num('roundsPerMonth', '한 달 라운드 수 (공 소모 예측)', 0, 30, 1, '회')}</div>
        <label class="switch"><span><b>가짜 위치로 테스트</b><br><span class="sub">집 안에서 시험할 때 지도를 눌러 내 위치를 정해요 (GPS 시뮬레이션)</span></span><input type="checkbox" data-sw="simGPS" ${st.simGPS ? 'checked' : ''}></label></details>
      ${(() => {
        const rep = storageReport(), mb = rep.total / 1024, pct = Math.min(100, mb / 5 * 100), lb = +localStorage.getItem('pinpoint.lastBackup') || 0;
        const days = lb ? Math.floor((Date.now() - lb) / 86400000) : null;
        return `<div class="card" id="storageCard"><b>💾 내 기록 지키기</b>
          <p class="sub">기록은 이 휴대폰 안에만 있어요. <b>앱을 지웠다 다시 깔거나 휴대폰을 바꾸면 사라져요.</b> 가끔 백업 파일을 만들어 카톡·드라이브에 보관하세요.</p>
          <p class="sub">마지막 백업: <b>${days == null ? '아직 안 했어요' : days === 0 ? '오늘' : `${days}일 전`}</b> · 라운드 ${S.rounds.length}개 · 샷 ${S.shots.length}개</p>
          <div class="grid2"><button class="btn primary" id="bkSave">💾 백업 파일 만들기</button><button class="btn" id="bkLoad">📂 백업에서 되살리기</button></div>
          <div class="st-bar" aria-label="저장 공간 ${pct.toFixed(0)}% 사용"><i style="width:${pct}%" class="${pct > 80 ? 'hot' : ''}"></i></div>
          <p class="sub">저장 공간 ${mb < 1 ? `${Math.round(rep.total)}KB` : `${mb.toFixed(1)}MB`} / 약 5MB 사용 중${pct > 80 ? ' · <b style="color:var(--danger)">거의 찼어요</b>' : ''}</p>
          <button class="btn block" id="bkClean">🧹 받아 둔 골프장 목록·공지 지우기 <small>(다시 받을 수 있어요)</small></button></div>`;
      })()}
      <button class="btn danger block" id="wipe">🗑 모든 기록 지우기</button>`;
    const re = () => this.mount(el);
    const onSeg = (id, fn) => $$(`#${id} button`).forEach(b => b.onclick = () => { fn(b.dataset.v); save('settings'); re(); });
    onSeg('detailSeg', v => { st.detail = v === 'detail'; });
    onSeg('lvlSeg', v => { const old = st.hcp; st.hcp = +v; if (old !== st.hcp && !S.bag.some(c => c.learned)) { S.bag = defaultBag(st.hcp, st.gender); save('bag'); } toast('클럽 기본 거리를 맞췄어요'); });
    onSeg('gender', v => { st.gender = v; if (!S.bag.some(c => c.learned)) { S.bag = defaultBag(st.hcp, st.gender); save('bag'); } });
    onSeg('hand', v => { st.hand = v; }); onSeg('unit', v => { st.unit = v; });
    onSeg('puttSeg', v => { const [a, s] = v.split(',').map(Number); st.aimSigma = a; st.speedSigma = s; });
    onSeg('spdSeg', v => { st.stimp = +v; });
    onSeg('mode', v => { st.mode = v; });
    $('#myH').onchange = e => { const cm = Math.round(+e.target.value); if (!(cm >= 100 && cm <= 210)) return toast('키를 cm로 넣어 주세요 (예: 170)'); st.myHeight = cm; Object.assign(st, fromHeight(cm)); save('settings'); toast(`눈높이 ${st.eyeHeight}m로 맞췄어요`); };
    $$('[data-num]').forEach(i => i.onchange = () => { const v = +i.value; if (isFinite(v)) { st[i.dataset.num] = v; save('settings'); toast('저장했어요'); } });
    $$('#vLvl button').forEach(b => b.onclick = () => { st.voiceLevel = b.dataset.v; save('settings'); $$('#vLvl button').forEach(x => x.classList.toggle('on', x === b)); });
    $$('#vRate button').forEach(b => b.onclick = () => { st.voiceRate = +b.dataset.v; save('settings'); $$('#vRate button').forEach(x => x.classList.toggle('on', x === b)); say('깃발까지 142미터. 7번 아이언, 끝까지 크게.', { force: true }); });
    $('#vTest').onclick = () => say(st.voiceLevel === 'simple' ? '깃발까지 142미터. 7번 아이언으로 끝까지 크게. 깃발을 바로 보고 치세요.' : '깃발까지 142미터, 그린 앞 133미터, 뒤 151미터. 오르막 3미터, 맞바람 초속 4미터. 그래서 151미터처럼 쳐야 해요. 7번 아이언, 끝까지 크게. 깃발보다 왼쪽으로 2도, 깃발 왼쪽 5미터 지점을 보고 치세요.', { force: true });
    $('#btOpen').onclick = async () => { const r = await openBluetooth(); if (!audioNative()) toast('휴대폰 설정 → 블루투스에서 이어폰을 연결해 주세요', 3500); else if (r?.reason === 'ios') toast('제어 센터나 설정 → Bluetooth에서 이어폰을 연결해 주세요', 4000); };
    audioRoute().then(r => { const el = $('#routeLine'); if (r && el) el.innerHTML = `지금 소리: <b>${esc(r.name || ROUTE_WORD[r.kind])}</b> (${ROUTE_WORD[r.kind]})`; });
    $$('[data-sw]').forEach(i => i.onchange = () => { st[i.dataset.sw] = i.checked; save('settings'); });
    $('#perm')?.addEventListener('click', async () => { const ok = await requestMotionPermission(); startOrientation(); restartGPS(); toast(ok ? '허락했어요 · 위치를 다시 찾고 있어요' : '위치를 다시 찾고 있어요'); setTimeout(re, 1200); });
    $('#gTest').onclick = async () => {
      const k = $('#gKey').value.trim(), st2 = $('#gStat');
      if (!/^[A-Za-z0-9_\-]{20,}$/.test(k)) { st2.textContent = '⚠ 키 모양이 이상해요. 복사한 키 전체를 붙여 넣어 주세요'; return; }
      st2.textContent = '🔌 Google에 연결하는 중…';
      try { const r = await testConnection(k, m => { st2.textContent = `🔌 ${m} 응답 확인 중…`; }); setKey(k); setModel(r.model); st2.innerHTML = `✅ 연결 성공 · <b>${esc(r.model)}</b> (응답 ${(r.ms / 1000).toFixed(1)}초)${r.backups.length ? ` · 예비 ${r.backups.map(esc).join(', ')}` : ''}`; toast('AI 캐디 준비 완료'); }
      catch (e) { st2.textContent = '❌ ' + e.message; }
    };
    $('#gDel').onclick = () => { setKey(''); setModel(''); $('#gKey').value = ''; $('#gStat').textContent = '키를 지웠어요. AI 기능이 꺼졌어요'; };
    $('#bkSave').onclick = async () => {
      try {
        const txt = JSON.stringify(exportAll());
        const r = await saveFile(`pinpoint-backup-${new Date().toISOString().slice(0, 10)}.json`, txt, 'application/json', 'PinPoint 백업');
        if (r.ok) { localStorage.setItem('pinpoint.lastBackup', String(Date.now())); toast(`💾 백업 파일을 만들었어요 (${Math.round(txt.length / 1024)}KB) · 카톡·드라이브에 보관하세요`, 4000); re(); }
      } catch (e) { toast('백업하지 못했어요: ' + e.message, 4000); }
    };
    $('#bkLoad').onclick = async () => {
      try {
        const txt = await pickTextFile(); if (!txt) return;
        const data = JSON.parse(txt);
        if (!(await confirmSheet('백업에서 되살리기', '백업 파일의 라운드·샷 기록을 지금 기록에 합치고, 설정·클럽 거리는 백업 값으로 바꿔요. 계속할까요?', '되살리기'))) return;
        const r = importAll(data); toast(`되살렸어요 · 라운드 ${r.rounds}개 · 샷 ${r.shots}개`, 3000); setTimeout(() => location.reload(), 1200);
      } catch (e) { toast('되살리지 못했어요: ' + (e instanceof SyntaxError ? '백업 파일이 아니에요' : e.message), 4000); }
    };
    $('#bkClean').onclick = () => {
      const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('pinpoint.remote.') || k?.startsWith('pinpoint.corrupt.') || k === 'pinpoint.errlog') keys.push(k); }
      keys.forEach(k => localStorage.removeItem(k)); toast(`정리했어요 (${keys.length}개)`); re();
    };
    if (/\?storage/.test(location.hash)) setTimeout(() => $('#storageCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    $('#wipe').onclick = async () => {
      if (!(await confirmSheet('모든 기록 지우기', '골프장·라운드·샷 기록·설정을 모두 지워요. 되돌릴 수 없어요.', '모두 지우기', 'danger'))) return;
      Object.keys(localStorage).filter(k => k.startsWith('pinpoint.')).forEach(k => localStorage.removeItem(k));
      sessionStorage.clear(); location.reload();
    };
  },
};
