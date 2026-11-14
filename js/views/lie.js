// ② 필드(라이) 경사각도: 지면 접촉 모드(기울기 센서 2초, 선택적 180° 정밀) → 셋업·조준·거리 보정
import { S, save, allowed, FEATURE_NAMES } from '../core/state.js';
import { toRad, toDeg } from '../core/geo.js';
import { Sensors, onOrientation, sampleTilt, vibrate, speak } from '../core/sensors.js';
import { clubType } from '../physics/flight.js';
import { $, toast, sheet, lockedCard, clubOptions, DU } from '../ui.js';

let unOri = null, last = null, clubSel = '7i', precise = false;

export default {
  mount(el) {
    if (!allowed('lieSlope')) { el.innerHTML = `<h2>📐 라이 경사</h2>` + lockedCard(FEATURE_NAMES.lieSlope); return; }
    el.innerHTML = `<h2>📐 라이 경사 측정</h2>
      <div class="card"><p class="sub" style="margin-top:0">공 옆 스탠스 자리에 휴대폰을 <b>화면이 위로, 윗부분이 목표 방향</b>을 향하게 내려놓고 측정하세요. (${S.settings.hand === 'R' ? '오른손' : '왼손'}잡이 기준 · 설정에서 변경)</p>
        <div class="level" id="level"><i></i></div>
        <div class="row" style="justify-content:center"><span class="sub" id="live">센서 대기 중…</span></div>
        <label class="switch"><span>정밀 모드 (180° 돌려 2회 측정 · 센서 오차 상쇄)</span><input type="checkbox" id="precise" ${precise ? 'checked' : ''}></label>
        <button class="btn primary block" id="meas">2초 측정</button></div>
      <div class="card"><label class="f" style="margin:0"><span>칠 클럽</span><select id="club">${clubOptions(clubSel)}</select></label></div>
      <div id="out"></div>`;
    unOri = onOrientation(s => {
      if (s.beta == null) return;
      const lv = $('#level i'), lt = $('#live'); if (!lv) return;
      const b = s.beta - (S.calib.tilt?.beta || 0), g = s.gamma - (S.calib.tilt?.gamma || 0);
      lv.style.left = (50 + Math.max(-45, Math.min(45, g * 4.5))) + '%';
      lv.style.top = (50 + Math.max(-45, Math.min(45, b * 4.5))) + '%';
      lt.textContent = `목표 방향 ${b >= 0 ? '↑' : '↓'}${Math.abs(b).toFixed(1)}° · 좌우 ${Math.abs(g).toFixed(1)}°`;
    });
    $('#precise').onchange = e => precise = e.target.checked;
    $('#club').onchange = e => { clubSel = e.target.value; if (last) renderOut(); };
    $('#meas').onclick = measure;
    if (Sensors.beta == null) $('#live').textContent = '기울기 센서가 없거나 권한이 필요합니다 (설정 → 센서 권한 요청)';
    if (last) renderOut();
  },
  unmount() { unOri && unOri(); unOri = null; },
};

async function measure() {
  if (Sensors.beta == null) return toast('기울기 센서를 사용할 수 없습니다');
  const run = async () => { const a = await sampleTilt(2000); if (!a) return null; if (a.sdBeta > 0.5 || a.sdGamma > 0.5) { toast('흔들림이 큽니다. 다시 측정하세요'); return null; } return a; };
  toast('측정 중… 움직이지 마세요');
  const A = await run(); if (!A) return;
  let beta, gamma;
  if (precise) {
    vibrate(60);
    const ok = await new Promise(res => sheet({ title: '180° 돌려 놓기', body: '<p>같은 자리에서 휴대폰을 반대 방향으로 돌려 놓은 뒤 계속을 누르세요.</p>', actions: [{ label: '취소', onClick: () => res(false) }, { label: '계속', kind: 'primary', onClick: () => res(true) }], dismissable: false }));
    if (!ok) return;
    const B = await run(); if (!B) return;
    beta = (A.beta - B.beta) / 2; gamma = (A.gamma - B.gamma) / 2;
    S.calib.tilt = { beta: (A.beta + B.beta) / 2, gamma: (A.gamma + B.gamma) / 2, ts: Date.now() }; save('calib');
  } else { beta = A.beta - (S.calib.tilt?.beta || 0); gamma = A.gamma - (S.calib.tilt?.gamma || 0); }
  last = { beta, gamma, precise };
  vibrate(40); renderOut();
}

// 물리: 발끝 경사에서 로프트가 있는 클럽 페이스는 경사 방향으로 돌아감 → 방향 변화 ≈ atan(sin(로프트)·tan(경사))
export function lieAdvice({ beta, gamma }, club, hand = 'R', carry = 130) {
  // beta>0: 목표 방향이 높음 = 오르막 라이 (오른손: 왼발 오르막)
  // gamma>0: 휴대폰 오른쪽이 낮음 = 왼쪽이 높음. 오른손잡이는 목표를 볼 때 공의 왼쪽에 섬 → 발 쪽이 높음 = 공이 발보다 낮음
  const along = beta, cross = gamma;
  const ballBelowFeet = hand === 'R' ? cross > 0 : cross < 0;
  const loft = club?.loft ?? 34;
  const crossAbs = Math.abs(cross);
  const dirDeg = toDeg(Math.atan(Math.sin(toRad(loft)) * Math.tan(toRad(crossAbs))));
  // 공이 발보다 높으면 훅(오른손: 왼쪽), 낮으면 슬라이스 경향(오른쪽). 왼손잡이는 반대
  const curveLeft = hand === 'R' ? !ballBelowFeet : ballBelowFeet;
  const lateral = Math.tan(toRad(dirDeg)) * carry * (ballBelowFeet ? 0.7 : 1); // 발끝 내리막은 페이스 효과 일부만 (스윙 보상)
  const uphill = along > 0;
  const alongAbs = Math.abs(along);
  // 오르막: 유효 로프트 증가 → 탄도↑ 거리↓ (경험값 1°당 약 1.3%), 내리막: 반대 (1°당 약 1%)
  const distPct = uphill ? -alongAbs * 1.3 : alongAbs * 1.0;
  const tips = [];
  if (alongAbs >= 1) {
    if (uphill) tips.push(`${hand === 'R' ? '왼발' : '오른발'} 오르막 ${alongAbs.toFixed(1)}°: 어깨를 경사와 평행하게, 공은 스탠스 중앙보다 약간 앞`, `탄도가 높아지고 거리가 약 ${Math.abs(distPct).toFixed(0)}% 줄어듭니다 → ${alongAbs > 3 ? '1클럽 이상' : '반 클럽'} 길게`, '체중이 뒷발에 남기 쉬우니 피니시까지 앞발로 이동', `공이 ${hand === 'R' ? '왼쪽' : '오른쪽'}으로 감기기 쉬움 → 약간 ${hand === 'R' ? '오른쪽' : '왼쪽'} 조준`);
    else tips.push(`${hand === 'R' ? '왼발' : '오른발'} 내리막 ${alongAbs.toFixed(1)}°: 어깨를 경사와 평행하게, 공은 뒷발 쪽`, `탄도가 낮고 런이 많아져 약 ${distPct.toFixed(0)}% 더 갑니다 → ${alongAbs > 3 ? '1클럽' : '반 클럽'} 짧게, 뒤땅 주의`, `공이 ${hand === 'R' ? '오른쪽' : '왼쪽'}으로 밀리기 쉬움 → 약간 ${hand === 'R' ? '왼쪽' : '오른쪽'} 조준`);
  }
  if (crossAbs >= 1) {
    if (ballBelowFeet) tips.push(`공이 발보다 낮음 ${crossAbs.toFixed(1)}°: 무릎을 더 굽히고 끝까지 낮은 자세 유지`, `${curveLeft ? '왼쪽' : '오른쪽'}으로 휘기 쉬움 → ${curveLeft ? '오른쪽' : '왼쪽'}으로 약 ${DU(Math.abs(lateral))} 조준`);
    else tips.push(`공이 발보다 높음 ${crossAbs.toFixed(1)}°: 그립을 짧게 잡고 상체를 세움`, `${curveLeft ? '왼쪽' : '오른쪽'}으로 휘기 쉬움 → ${curveLeft ? '오른쪽' : '왼쪽'}으로 약 ${DU(Math.abs(lateral))} 조준`);
  }
  if (!tips.length) tips.push('거의 평평한 라이입니다. 평소처럼 셋업하세요.');
  return { along, cross, uphill, ballBelowFeet, dirDeg, curveLeft, lateral, distPct, tips };
}

function renderOut() {
  const club = S.bag.find(c => c.id === clubSel), ct = clubType(clubSel);
  const a = lieAdvice(last, ct, S.settings.hand, club?.carry || 130);
  const aim = Math.abs(a.lateral) >= 1 && Math.abs(a.cross) >= 1 ? `${a.curveLeft ? '오른쪽' : '왼쪽'} ${DU(Math.abs(a.lateral))}` : '보정 없음';
  $('#out').innerHTML = `<div class="card">
      <div class="grid2"><div class="stat"><div class="v">${Math.abs(a.along).toFixed(1)}°</div><div class="l">${a.uphill ? (S.settings.hand === 'R' ? '왼발 오르막' : '오른발 오르막') : (S.settings.hand === 'R' ? '왼발 내리막' : '오른발 내리막')}</div></div>
      <div class="stat"><div class="v">${Math.abs(a.cross).toFixed(1)}°</div><div class="l">${a.ballBelowFeet ? '발끝 내리막 (공이 낮음)' : '발끝 오르막 (공이 높음)'}</div></div></div>
      <div class="grid2" style="margin-top:8px"><div class="stat"><div class="v">${aim}</div><div class="l">조준 보정 (${ct?.name || clubSel}, 로프트 ${ct?.loft ?? '—'}°)</div></div>
      <div class="stat"><div class="v">${a.distPct >= 0 ? '+' : ''}${a.distPct.toFixed(0)}%</div><div class="l">거리 영향 (추정)</div></div></div>
      ${last.precise ? '<p><span class="pill">정밀 측정</span> 센서 오차를 상쇄했습니다 (±0.3° 목표)</p>' : '<p class="sub">빠른 측정: 기기 보정값 적용. 정밀 모드는 ±0.3°까지 정확합니다.</p>'}
      <h3>셋업 가이드</h3><ul class="tips">${a.tips.map(t => `<li>${t}</li>`).join('')}</ul>
      <p class="sub">페이스 방향 변화 = atan(sin(로프트)·tan(경사)) = ${a.dirDeg.toFixed(1)}°. 로프트가 클수록(웨지) 발끝 경사 영향이 큽니다.</p></div>`;
  speak(`${a.uphill ? '오르막' : '내리막'} ${Math.abs(a.along).toFixed(0)}도, ${a.ballBelowFeet ? '공이 발보다 낮음' : '공이 발보다 높음'}`);
}
