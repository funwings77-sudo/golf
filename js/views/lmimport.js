// 📂 론치 모니터 파일 불러오기 화면: 파일 고르기 → 자동 연결 미리보기(열·단위·클럽 고치기) → 불러오기
import { S, save } from '../core/state.js';
import { decodeBytes, readLaunchFile, toShots, clubIdOf, FIELD_NAMES } from '../core/lmcsv.js';
import { addLMShots } from './lmform.js';
import { kmh } from '../physics/shotfit.js';
import { $, $$, esc, sheet, toast } from '../ui.js';

// 파일 고르기 창 열기 → 읽어서 미리보기. done(넣은 개수)
export function pickLaunchFile(done) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.csv,.txt,text/csv,text/plain';
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast('파일이 너무 커요 (5MB 이하)');
    try {
      const file = readLaunchFile(decodeBytes(await f.arrayBuffer()));
      if (file.error) return toast(file.error, 4500);
      if (!file.rows.length) return toast('샷 줄을 찾지 못했어요', 3500);
      preview(file, f.name, done);
    } catch (e) { toast('파일을 읽지 못했어요: ' + e.message, 4000); }
  };
  inp.click();
}

function preview(file, fname, done) {
  const st = S.settings, us = new Set(Object.values(file.units).filter(Boolean));
  const usDevice = /Garmin|Rapsodo|FlightScope|TrackMan/.test(file.device);
  const o = {
    map: { ...file.map }, units: file.units, flipSide: false,
    speedUnit: us.has('kmh') ? 'kmh' : us.has('ms') ? 'ms' : us.has('mph') || usDevice ? 'mph' : st.lmSpeedUnit || 'kmh',
    distUnit: us.has('m') ? 'm' : us.has('yd') || usDevice ? 'yd' : st.lmDistUnit || 'm',
    clubMap: Object.fromEntries(file.clubNames.map(n => [n, clubIdOf(n)])), defaultClub: st.lmLastClub || '7i',
  };
  const bag = S.bag.filter(c => c.enabled), clubOpts = sel => `<option value="">— 골라 주세요 —</option>${bag.map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__skip" ${sel === null ? 'selected' : ''}>퍼터 · 빼기</option>`;
  const colOpts = (_, j) => `<option value="">— 없음 —</option>${file.header.map((h, k) => `<option value="${k}" ${k === j ? 'selected' : ''}>${esc(h)}</option>`).join('')}`;
  const seg = (id, cur, items) => `<div class="seg" id="${id}">${items.map(([k, l]) => `<button type="button" data-v="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const draw = card => {
    const res = toShots(file, o);
    const seen = new Set(S.shots.map(x => x.importKey).filter(Boolean)), dup = res.shots.filter(x => seen.has(x.key)).length, fresh = res.shots.length - dup;
    const unk = file.clubNames.filter(n => o.clubMap[n] === undefined || o.clubMap[n] === '');
    $('.sheet-body', card).innerHTML = `<div class="lmi">
      <p class="lmi-f">📄 <b>${esc(fname)}</b> · ${file.rows.length}줄${file.device ? ` · <b>${esc(file.device)}</b> 형식으로 보여요` : ''}</p>
      <details class="lmi-sec" ${Object.keys(o.map).length < 3 ? 'open' : ''}><summary>🔗 열 연결 (${Object.keys(o.map).filter(k => o.map[k] != null).length}개 찾음) · 고치기</summary>
        <div class="lmi-map">${Object.entries(FIELD_NAMES).map(([f, n]) => `<label><span>${n}${f === 'ballSpeed' ? ' *' : ''}</span><select data-f="${f}">${colOpts(f, o.map[f])}</select>${o.map[f] != null && file.units[o.map[f]] ? `<em>${file.units[o.map[f]]}</em>` : ''}</label>`).join('')}</div></details>
      <div class="lmi-u"><span>단위가 안 적힌 열</span>${seg('uS', o.speedUnit, [['kmh', 'km/h'], ['mph', 'mph'], ['ms', 'm/s']])}${seg('uD', o.distUnit, [['m', 'm'], ['yd', 'yd']])}</div>
      ${file.clubNames.length ? `<div class="lmi-sec"><b>🏌️ 클럽 이름 연결</b>${unk.length ? ` <span class="lmi-warn">${unk.length}개를 골라 주세요</span>` : ''}
        <div class="lmi-clubs">${file.clubNames.map(n => `<label><span>${esc(n)}</span><select data-club="${esc(n)}">${clubOpts(o.clubMap[n])}</select></label>`).join('')}</div></div>`
        : `<label class="lmi-one"><span>모든 샷의 클럽</span><select id="lmiAll">${clubOpts(o.defaultClub)}</select></label>`}
      <label class="lmi-flip"><input type="checkbox" id="lmiFlip" ${o.flipSide ? 'checked' : ''}> 좌우가 반대로 나오면 체크 (왼쪽 ↔ 오른쪽)</label>
      <div class="lmi-sec"><b>미리보기</b> <span class="sub">(처음 6샷 · 바꾼 단위로)</span>
        ${res.shots.length ? `<div class="tblwrap"><table class="score lmi-t"><tr><th>클럽</th><th>공 속도</th><th>발사각</th><th>스핀</th><th>캐리</th><th>좌우</th></tr>
          ${res.shots.slice(0, 6).map(x => `<tr><td>${esc(x.club)}</td><td>${Math.round(kmh(x.lm.ballSpeed))}km/h</td><td>${x.lm.launchDeg != null ? x.lm.launchDeg.toFixed(1) + '°' : '—'}</td><td>${x.lm.spinRpm != null ? Math.round(x.lm.spinRpm) : '—'}</td><td>${x.lm.carry != null ? Math.round(x.lm.carry) + 'm' : '—'}</td><td>${x.lm.offlineM != null ? (x.lm.offlineM < 0 ? '왼 ' : '오 ') + Math.abs(Math.round(x.lm.offlineM)) + 'm' : x.lm.sideDeg != null ? x.lm.sideDeg.toFixed(1) + '°' : '—'}</td></tr>`).join('')}</table></div>
          <p class="sub">숫자가 이상하면(예: 공 속도가 너무 작거나 큼) 위에서 단위를 바꿔 보세요.</p>` : '<p class="lmi-warn">불러올 샷이 없어요 · 공 속도 열과 클럽을 확인해 주세요</p>'}
      </div>
      <p class="lmi-sum">✅ 새 샷 <b>${fresh}</b>개${dup ? ` · 이미 있는 ${dup}개는 건너뜀` : ''}${res.skipped.putter ? ` · 퍼터 ${res.skipped.putter}개 뺌` : ''}${res.skipped.noClub ? ` · 클럽 모름 ${res.skipped.noClub}개` : ''}${res.skipped.noSpeed ? ` · 공 속도 없음 ${res.skipped.noSpeed}개` : ''}</p>
    </div>`;
    $$('[data-f]', card).forEach(s => s.onchange = () => { const v = s.value; if (v === '') delete o.map[s.dataset.f]; else o.map[s.dataset.f] = +v; draw(card); });
    $$('#uS [data-v]', card).forEach(b => b.onclick = () => { o.speedUnit = b.dataset.v; draw(card); });
    $$('#uD [data-v]', card).forEach(b => b.onclick = () => { o.distUnit = b.dataset.v; draw(card); });
    $$('[data-club]', card).forEach(s => s.onchange = () => { o.clubMap[s.dataset.club] = s.value === '__skip' ? null : s.value || undefined; draw(card); });
    $('#lmiAll', card)?.addEventListener('change', e => { o.defaultClub = e.target.value === '__skip' ? null : e.target.value || null; draw(card); });
    $('#lmiFlip', card).onchange = e => { o.flipSide = e.target.checked; draw(card); };
    o.result = res;
  };
  sheet({
    title: '📂 론치 모니터 기록 불러오기', body: '', onMount: card => draw(card),
    actions: [{ label: '취소' }, { label: '불러오기', kind: 'primary', onClick: () => {
      const list = o.result?.shots || [];
      if (!list.length) { toast('불러올 샷이 없어요'); return false; }
      const n = addLMShots(list);
      S.settings.lmSpeedUnit = o.speedUnit; S.settings.lmDistUnit = o.distUnit; save('settings');
      toast(n ? `📟 샷 ${n}개를 불러왔어요` : '모두 이미 불러온 샷이에요', 3500);
      done?.(n);
    } }],
  });
}
