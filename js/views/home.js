import { S, save, MODES, activeCourse } from '../core/state.js';
import { newRound } from '../core/score.js';
import { demoCourse } from '../core/course.js';
import { Sensors, keepAwake } from '../core/sensors.js';
import { $, $$, esc, toast } from '../ui.js';

export default {
  mount(el, App) {
    const r = S.round;
    if (r) {
      el.innerHTML = `<div class="hero"><h2>라운드 진행 중</h2><p>${esc(r.courseName)} · ${MODES[r.mode].label} 모드 · ${r.players.map(p => esc(p.name)).join(', ')}</p></div>
        <div class="grid2"><a class="btn primary" href="#/distance">⛳ 거리 보기</a><a class="btn" href="#/score">📝 스코어</a></div>
        ${quick()}`;
      return;
    }
    const courses = S.courses;
    el.innerHTML = `<div class="hero"><h2>PinPoint AI 캐디</h2><p>거리 → 라이 경사 → 티샷 공략 → 분실구 → 그린 리딩 → 퍼팅까지, 한 라운드 한 앱.</p></div>
      <div class="card"><h3 style="margin-top:0">라운드 시작</h3>
        ${courses.length ? `<label class="f"><span>코스</span><select id="course">${courses.map(c => `<option value="${c.id}" ${c.id === S.ui.courseId ? 'selected' : ''}>${esc(c.name)} (${c.holes.length}홀)</option>`).join('')}</select></label>`
        : `<p class="sub">등록된 코스가 없습니다. 코스를 직접 만들거나(위성지도에서 티·그린·해저드 지정) 데모 코스로 체험해 보세요.</p>
           <div class="grid2"><button class="btn" id="mkDemo">🧪 데모 코스 만들기</button><a class="btn" href="#/courses">🗺️ 코스 만들기</a></div>`}
        ${courses.length ? `
        <label class="f"><span>플레이어 (쉼표로 구분, 첫 번째가 나)</span><input type="text" id="players" value="${esc(localStorage.getItem('pinpoint.lastPlayers') || '나')}"></label>
        <label class="f"><span>모드</span><div class="seg" id="modeSeg">${Object.entries(MODES).map(([k, m]) => `<button data-m="${k}" class="${S.settings.mode === k ? 'on' : ''}">${m.label}</button>`).join('')}</div></label>
        <p class="sub" id="modeDesc">${MODES[S.settings.mode].desc}</p>
        <div class="grid2"><label class="f"><span>타당 (원, 0=안 함)</span><input type="number" id="gStroke" inputmode="numeric" value="0" min="0" step="1000"></label>
        <label class="f"><span>스킨 (원, 0=안 함)</span><input type="number" id="gSkins" inputmode="numeric" value="0" min="0" step="1000"></label></div>
        <button class="btn primary block" id="start">라운드 시작</button>` : ''}
      </div>${quick()}`;
    $('#mkDemo')?.addEventListener('click', () => {
      const base = Sensors.pos ? { lat: Sensors.pos.lat + 0.0006, lon: Sensors.pos.lon } : undefined;
      const c = demoCourse(base); S.courses.push(c); S.ui.courseId = c.id; S.ui.hole = 1; save('courses', 'ui');
      toast('데모 코스를 만들었습니다' + (base ? ' (현재 위치 근처)' : ''));
      App.refreshHeader(); this.mount(el, App);
    });
    let mode = S.settings.mode;
    $$('#modeSeg button', el).forEach(b => b.onclick = () => { mode = b.dataset.m; $$('#modeSeg button', el).forEach(x => x.classList.toggle('on', x === b)); $('#modeDesc').textContent = MODES[mode].desc; });
    $('#course')?.addEventListener('change', e => { S.ui.courseId = e.target.value; S.ui.hole = 1; save('ui'); App.refreshHeader(); });
    $('#start')?.addEventListener('click', () => {
      const course = S.courses.find(c => c.id === $('#course').value);
      const players = $('#players').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
      if (!players.length) return toast('플레이어 이름을 입력하세요');
      localStorage.setItem('pinpoint.lastPlayers', players.join(', '));
      S.settings.mode = mode; save('settings');
      S.round = newRound({ course, players, mode, games: { stroke: +$('#gStroke').value || 0, skins: +$('#gSkins').value || 0 } });
      S.ui.courseId = course.id; S.ui.hole = 1; save('round', 'ui');
      keepAwake(true);
      App.go('distance');
    });
  },
};

// 골프장 공지 (관리자 발행 · 게시 중 · 현재 코스 대상)
function notices() {
  const ns = window.App?.notices || [];
  if (!ns.length) return '';
  return `<h3>📢 골프장 공지</h3>${ns.map(n => `<div class="card tight" style="border-left:4px solid ${n.level === 'danger' ? 'var(--danger)' : n.level === 'warn' ? 'var(--warn)' : 'var(--blue)'}"><b>${esc(n.title)}</b>${n.body ? `<p class="sub" style="margin:4px 0 0">${esc(n.body)}</p>` : ''}${n.end ? `<p class="sub" style="margin:4px 0 0">~ ${new Date(n.end).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>` : ''}</div>`).join('')}`;
}
function updates() {
  const u = window.App?.updates || [];
  return u.length ? `<div class="card tight row"><span class="grow">🔄 공식 코스 업데이트 ${u.length}개: ${u.map(x => esc(x.c.name)).join(', ')}</span><a class="btn small" href="#/courses">업데이트</a></div>` : '';
}

function quick() {
  return `${notices()}${updates()}<h3>바로 쓰기</h3>
    <a class="list-btn" href="#/green?measure"><span class="ico">🟢</span><span class="grow"><b>그린 리딩 · 퍼팅 계산</b><br><span class="sub">경사 측정 → 라인·조준점·세기·백스윙</span></span></a>
    <a class="list-btn" href="#/lost"><span class="ico">📡</span><span class="grow"><b>분실구 안내</b><br><span class="sub">낙하 예상 구역 → 레이더 길안내 → 카메라 탐지</span></span></a>
    <a class="list-btn" href="#/lie"><span class="ico">📐</span><span class="grow"><b>라이 경사 측정</b><br><span class="sub">휴대폰을 지면에 2초 → 셋업·조준 보정</span></span></a>
    <a class="list-btn" href="#/rules"><span class="ico">📖</span><span class="grow"><b>룰 · 구제 도우미</b><br><span class="sub">OB·페널티 구역·언플레이어블 벌타와 구제 구역</span></span></a>`;
}
