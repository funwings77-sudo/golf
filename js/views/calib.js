// 캘리브레이션: 퍼팅 백스윙↔거리(연습 그린 3·6·9m), 기울기 센서 바이어스(180° 회전), 템포
import { S, save } from '../core/state.js';
import { fitCalibration, backswingCm, DEFAULT_CALIB } from '../physics/putt.js';
import { Sensors, sampleTilt, vibrate } from '../core/sensors.js';
import { $, $$, toast, sheet, metronome } from '../ui.js';

let metro = false;
export default {
  mount(el) {
    const render = () => {
      const c = S.calib, samples = c.samples || [];
      el.innerHTML = `<h2>🎚️ 캘리브레이션</h2>
        <div class="card"><b>① 퍼팅 세기 → 백스윙 크기</b>
          <p class="sub">연습 그린에서 같은 템포로 백스윙 크기만 바꿔 치고, 공이 굴러간 거리를 적으세요 (3m·6m·9m 목표 각 1회 이상). 공 속도는 백스윙 크기에 비례한다는 모델 √거리 = a·cm + b 로 적합합니다.</p>
          ${samples.map((s, i) => `<div class="kv"><span>백스윙 ${s.cm}cm → ${s.dist}m</span><button class="btn small" data-del="${i}">삭제</button></div>`).join('') || '<p class="sub">기록 없음 (기본값: 백스윙 24cm ≈ 평지 7.2m)</p>'}
          <div class="row" style="margin-top:8px"><input type="number" id="cm" placeholder="백스윙 cm" inputmode="decimal" style="flex:1"><input type="number" id="dist" placeholder="굴러간 m" inputmode="decimal" style="flex:1"><button class="btn" id="add">추가</button></div>
          <div class="grid3" style="margin-top:10px">${[3, 6, 9, 12].slice(0, 3).map(d => `<div class="stat"><div class="v">${Math.round(backswingCm(d, c))}cm</div><div class="l">평지 ${d}m</div></div>`).join('')}</div>
          <button class="btn small ghost" id="resetP" style="margin-top:6px">기본값으로</button></div>
        <div class="card"><b>② 템포 메트로놈</b><p class="sub">시작 · 정점 · 임팩트 3박 (백스윙:다운스윙 = 2:1). 같은 템포를 유지해야 백스윙 크기 = 세기가 성립합니다.</p>
          <label class="f"><span>템포 ${S.settings.tempoBpm} BPM</span><input type="range" id="bpm" min="56" max="100" value="${S.settings.tempoBpm}"></label>
          <button class="btn block ${metro ? 'on' : ''}" id="metro">${metro ? '⏹ 정지' : '▶ 메트로놈 시작'}</button></div>
        <div class="card"><b>③ 기울기 센서 보정</b>
          <p class="sub">평평한 바닥에 휴대폰을 놓고 측정 → 180° 돌려 다시 측정하면 센서 자체 오차를 구해 이후 빠른 측정에 적용합니다. 현재 보정값: 앞뒤 ${(S.calib.tilt?.beta || 0).toFixed(2)}° · 좌우 ${(S.calib.tilt?.gamma || 0).toFixed(2)}°</p>
          <button class="btn block" id="tilt">센서 보정 시작</button></div>`;
      $('#add').onclick = () => {
        const cm = +$('#cm').value, dist = +$('#dist').value;
        if (!(cm > 2 && dist > 0.3)) return toast('백스윙(cm)과 거리(m)를 입력하세요');
        S.calib = { ...fitCalibration([...samples, { cm, dist }]), tilt: S.calib.tilt }; save('calib'); render();
      };
      $$('[data-del]').forEach(b => b.onclick = () => { const s = samples.filter((_, i) => i !== +b.dataset.del); S.calib = { ...(s.length ? fitCalibration(s) : DEFAULT_CALIB), samples: s, tilt: S.calib.tilt }; save('calib'); render(); });
      $('#resetP').onclick = () => { S.calib = { ...DEFAULT_CALIB, tilt: S.calib.tilt }; save('calib'); render(); };
      $('#bpm').onchange = e => { S.settings.tempoBpm = +e.target.value; save('settings'); if (metro) metronome(true, S.settings.tempoBpm); render(); };
      $('#metro').onclick = () => { metro = !metro; metronome(metro, S.settings.tempoBpm); render(); };
      $('#tilt').onclick = async () => {
        if (Sensors.beta == null) return toast('기울기 센서를 사용할 수 없습니다');
        toast('측정 중…'); const A = await sampleTilt(2500); if (!A) return;
        vibrate(60);
        sheet({ title: '180° 돌려 놓기', body: '<p>같은 자리에서 휴대폰을 반대 방향으로 돌려 놓고 계속을 누르세요.</p>', actions: [{ label: '취소' }, { label: '계속', kind: 'primary', onClick: async () => {
          const B = await sampleTilt(2500); if (!B) return;
          S.calib.tilt = { beta: (A.beta + B.beta) / 2, gamma: (A.gamma + B.gamma) / 2, ts: Date.now() }; save('calib');
          toast(`보정 완료: 앞뒤 ${S.calib.tilt.beta.toFixed(2)}°, 좌우 ${S.calib.tilt.gamma.toFixed(2)}°`); render();
        } }] });
      };
    };
    render();
  },
  unmount() { metronome(false); metro = false; },
};
