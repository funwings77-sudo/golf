// 🤖 AI 캐디 창: 이 샷 질문 · 규칙 질문 (사진·음성 입력) — 답의 숫자는 엔진 계산으로 검증된 것만 표시
import { askCaddie, askRule, engineAnswer, LIE_KO } from '../core/aicaddie.js';
import { hasKey, imagePart, usageToday } from '../core/gemini.js';
import { allowed } from '../core/state.js';
import { speak } from '../core/sensors.js';
import { $, esc, sheet } from '../ui.js';

const QUICK = { shot: ['이 샷 어떻게 쳐요?', '끊어 가는 게 나을까요?', '바람 영향은 어때요?', '위험한 곳은 어디예요?'], rule: ['공이 OB로 나갔어요', '물에 빠졌어요', '공을 못 치겠어요 (언플레이어블)', '카트길 위에 공이 있어요'] };
let tab = 'shot', photo = null;

export function openAICaddie({ getFacts }) {
  const canShot = allowed('clubRec');
  if (!canShot) tab = 'rule';
  const draw = () => `
    <div class="seg" id="aiTab"><button data-t="shot" class="${tab === 'shot' ? 'on' : ''}" ${canShot ? '' : 'disabled'}>🏌️ 이 샷</button><button data-t="rule" class="${tab === 'rule' ? 'on' : ''}">⚖️ 규칙</button></div>
    ${canShot ? '' : '<p class="sub">🏆 대회 모드에서는 AI 샷 조언을 쓸 수 없어요 (규칙 4.3a·10.2). 규칙 질문은 돼요.</p>'}
    ${hasKey() ? '' : '<div class="ai-nokey">🔑 AI를 쓰려면 Gemini API 키가 필요해요. <a href="#/settings" id="toSet">설정 → AI 캐디</a>에서 무료 키를 넣어 주세요.<br><small>키가 없어도 아래 [엔진 답]은 볼 수 있어요.</small></div>'}
    <div class="ai-chips">${QUICK[tab].map(q => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <div class="ai-in"><input id="aiQ" placeholder="${tab === 'shot' ? '예) 앞에 나무가 있는데 어떻게 해요?' : '예) 벙커에서 클럽이 모래에 닿았어요'}" maxlength="200">
      ${('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) ? '<button id="aiMic" title="말로 묻기">🎤</button>' : ''}
      <label class="ai-cam" title="사진 붙이기">📷<input type="file" accept="image/*" capture="environment" id="aiPic" hidden></label>
      <button id="aiGo" class="go">묻기</button></div>
    ${photo ? `<div class="ai-photo">📷 사진 붙임 <button id="aiPicX">빼기</button></div>` : ''}
    <div id="aiOut">${tab === 'shot' && canShot ? `<div class="ai-res eng"><div class="ai-h">🧮 엔진 답 <span>PinPoint 계산</span></div><p>${esc(engineAnswer(getFacts()))}</p></div>` : ''}</div>
    <p class="sub ai-foot">AI(Google Gemini)에는 거리·클럽 같은 숫자 정보와 질문만 보내요 (위치 좌표·이름 없음, 사진은 붙였을 때만). 오늘 ${usageToday().n}회 사용.</p>`;
  sheet({ title: '🤖 AI 캐디', body: `<div id="aiBox">${draw()}</div>`, actions: [{ label: '닫기' }] });
  const box = () => $('#aiBox');
  const wire = () => {
    box().querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; box().innerHTML = draw(); wire(); });
    box().querySelectorAll('[data-q]').forEach(b => b.onclick = () => ask(b.dataset.q));
    $('#aiGo').onclick = () => { const q = $('#aiQ').value.trim(); if (q) ask(q); };
    $('#aiQ').onkeydown = e => { if (e.key === 'Enter') $('#aiGo').click(); };
    $('#toSet')?.addEventListener('click', () => $('#sheet').classList.remove('open'));
    $('#aiPic').onchange = async e => { const f = e.target.files?.[0]; if (!f) return; try { photo = await imagePart(f); } catch { photo = null; } box().innerHTML = draw(); wire(); };
    $('#aiPicX')?.addEventListener('click', () => { photo = null; box().innerHTML = draw(); wire(); });
    $('#aiMic')?.addEventListener('click', () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition, r = new SR();
      r.lang = 'ko-KR'; r.interimResults = false; r.maxAlternatives = 1;
      $('#aiMic').textContent = '👂'; r.onresult = ev => { const t = ev.results[0][0].transcript; $('#aiQ').value = t; ask(t); };
      r.onend = () => { const m = $('#aiMic'); if (m) m.textContent = '🎤'; }; r.start();
    });
  };
  const ask = async q => {
    const out = $('#aiOut'); if (!out) return;
    const facts = tab === 'shot' ? getFacts() : null;
    if (!hasKey()) { out.innerHTML = tab === 'shot' ? `<div class="ai-res eng"><div class="ai-h">🧮 엔진 답</div><p>${esc(engineAnswer(facts))}</p></div>` : '<div class="ai-res warn">🔑 규칙 질문은 AI 키가 있어야 해요. ☰ → 룰·구제 도우미에서 직접 볼 수 있어요.</div>'; return; }
    out.innerHTML = `<div class="ai-res wait"><span class="spin"></span> “${esc(q)}” 생각하는 중…</div>`;
    try {
      if (tab === 'shot') {
        const r = await askCaddie(facts, q, photo ? [photo] : []);
        out.innerHTML = `<div class="ai-res ${r.ok ? 'ok' : 'warn'}"><div class="ai-h">${r.ok ? '🤖 AI 캐디' : '🧮 엔진 답'} <span>${r.ok ? `✓ 숫자 검증됨${r.retried ? ' (1번 고침)' : ''}` : '⚠ AI 답에 확인 안 된 숫자가 있어 엔진 계산으로 대신했어요'}</span></div>
          <p class="ai-a">${esc(r.answer)}</p>
          ${r.lie !== 'unknown' && LIE_KO[r.lie] ? `<p class="ai-lie">📷 사진으로 본 공 상태: <b>${LIE_KO[r.lie]}</b>${r.lieNote ? ' · ' + esc(r.lieNote) : ''}</p>` : ''}
          ${r.cautions.length ? `<ul class="ai-c">${r.cautions.map(c => `<li>⚠ ${esc(c)}</li>`).join('')}</ul>` : ''}
          ${engineChips(facts)}
          <details><summary>근거 · 확인 내용</summary><div class="sub">${r.ok ? '' : esc(r.problems.join(' / ')) + '<br>'}모델 ${esc(r.model)} · 확신 ${({ high: '높음', medium: '보통', low: '낮음' })[r.confidence] || '—'}<br>보낸 정보: ${esc(JSON.stringify(facts)).slice(0, 900)}…</div></details></div>`;
        speak(r.answer);
      } else {
        const r = await askRule(q, photo ? [photo] : []);
        out.innerHTML = `<div class="ai-res ${r.ok && !r.needs_referee ? 'ok' : 'warn'}"><div class="ai-h">⚖️ 규칙 도우미 <span>${r.ok ? '✓ 규칙 요약과 대조됨' : '⚠ ' + esc(r.problems.join(' / '))}</span></div>
          <p class="ai-a">${esc(r.answer)}</p>
          ${r.rules.map(x => `<div class="ai-rule"><b>${esc(x.title)}</b> · 규칙 ${esc(x.rule)} · ${x.penalty}벌타${x.altLabel ? ` (${esc(x.altLabel)})` : ''}<ul>${x.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>`).join('')}
          ${r.needs_referee || !r.ok ? '<p class="ai-lie">👉 확실하지 않은 상황이에요. 경기위원이나 공식 규칙서로 꼭 확인하세요.</p>' : ''}</div>`;
        speak(r.answer);
      }
    } catch (e) {
      out.innerHTML = `<div class="ai-res warn"><div class="ai-h">⚠ AI 연결 안 됨</div><p>${esc(e.message)}</p>${tab === 'shot' ? `<p><b>엔진 답:</b> ${esc(engineAnswer(facts))}</p>` : ''}</div>`;
    }
  };
  wire();
}

// 엔진이 계산한 숫자만 칩으로 (AI가 바꿀 수 없음)
function engineChips(f) {
  const e = f?.engine; if (!e?.club) return '';
  return `<div class="ai-eng"><span>클럽 <b>${esc(e.club_name)}</b></span><span>힘 <b>${e.power}%</b></span><span>조준 <b>${e.aim_deg ? (e.aim_deg > 0 ? '오른쪽 ' : '왼쪽 ') + Math.abs(e.aim_deg) + '°' : '똑바로'}</b></span><span>비거리 <b>${e.carry_m}m</b></span></div>`;
}
