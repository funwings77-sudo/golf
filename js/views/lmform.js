// 📟 론치 모니터 수치 입력: 기기 화면의 숫자를 옮겨 적기 (단위 선택 · 범위 확인 · 빈칸은 계산)
import { S, save } from '../core/state.js';
import { learnClub } from '../core/score.js';
import { SPEED_UNITS, DIST_UNITS, toMS, fromMS, toM, fromM, lmErrors, analyzeStored, clubStats } from '../physics/shotfit.js';
import { shotCardHtml } from './shotviz.js';
import { $, $$, esc, sheet, toast } from '../ui.js';

// [키, 이름, 종류(speed|dist|deg|rpm), 도움말]
const FIELDS = [
  ['ballSpeed', '공 속도 (Ball Speed)', 'speed', '꼭 넣어 주세요'],
  ['launchDeg', '발사 각도 (Launch Angle)', 'deg', ''],
  ['spinRpm', '백스핀 (Spin Rate)', 'rpm', ''],
  ['headSpeed', '헤드 속도 (Club Speed)', 'speed', ''],
  ['carry', '캐리 (Carry)', 'dist', ''],
  ['total', '총거리 (Total)', 'dist', ''],
  ['sideDeg', '좌우 방향 (Launch Direction)', 'deg', '왼쪽은 −'],
  ['offlineM', '좌우 거리 (Offline / Side)', 'dist', '왼쪽은 −'],
  ['apex', '최고 높이 (Height / Apex)', 'dist', ''],
];

// shot: 기존 샷(수치를 붙임) 또는 null(새 샷 추가). onSave(lm, clubId)
export function openLMForm({ shot = null, onSave }) {
  let su = S.settings.lmSpeedUnit || 'kmh', du = S.settings.lmDistUnit || 'm';
  const lm = { ...(shot?.lm || {}) }; // 사본에만 씀 (저장 전 원본을 바꾸지 않음)
  const clubs = S.bag.filter(c => c.enabled);
  const show = (k, kind) => {
    const v = lm[k]; if (v == null) return '';
    const x = kind === 'speed' ? fromMS(v, su) : kind === 'dist' ? fromM(v, du) : v;
    return String(Math.round(x * 10) / 10);
  };
  const unitOf = kind => (kind === 'speed' ? SPEED_UNITS[su].label : kind === 'dist' ? DIST_UNITS[du].label : kind === 'rpm' ? 'rpm' : '°');
  const body = () => `<div class="lmf">
    ${shot ? '' : `<label class="f"><span>클럽</span><select id="lmClub">${clubs.map(c => `<option value="${esc(c.id)}" ${c.id === (S.settings.lmLastClub || '7i') ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`}
    <div class="lmf-u"><span>속도 단위</span><div class="seg" id="lmSu">${Object.entries(SPEED_UNITS).map(([k, u]) => `<button type="button" data-su="${k}" class="${k === su ? 'on' : ''}">${u.label}</button>`).join('')}</div></div>
    <div class="lmf-u"><span>거리 단위</span><div class="seg" id="lmDu">${Object.entries(DIST_UNITS).map(([k, u]) => `<button type="button" data-du="${k}" class="${k === du ? 'on' : ''}">${u.label}</button>`).join('')}</div></div>
    <p class="sub">론치 모니터 화면에 보이는 숫자만 넣으면 돼요. <b>공 속도</b>만 꼭 넣고, 나머지 빈칸은 물리식으로 계산해요.</p>
    <div class="lmf-g">${FIELDS.map(([k, n, kind, hint]) => `<label class="lmf-i" data-k="${k}"><span>${n}</span><span class="lmf-in"><input type="number" inputmode="decimal" step="any" id="lm_${k}" value="${show(k, kind)}"><em>${unitOf(kind)}</em></span>${hint ? `<small>${hint}</small>` : ''}</label>`).join('')}</div>
    <label class="f"><span>기기 이름 (선택)</span><input type="text" id="lm_device" maxlength="30" placeholder="예: 가민 R10, 보이스캐디 SC4" value="${esc(lm.device || '')}"></label>
  </div>`;
  const read = card => {
    const g = k => { const v = $('#lm_' + k, card)?.value.trim(); return v === '' || v == null ? null : +v; };
    const out = {};
    for (const [k, , kind] of FIELDS) {
      const v = g(k); if (v == null) continue;
      out[k] = kind === 'speed' ? toMS(v, su) : kind === 'dist' ? toM(v, du) : v;
    }
    const dev = $('#lm_device', card)?.value.trim(); if (dev) out.device = dev;
    return out;
  };
  const wire = card => {
    // 단위를 바꾸면 이미 쓴 숫자도 새 단위로 바꿔 보여 줌
    $$('[data-su]', card).forEach(b => b.onclick = () => { const cur = read(card); su = b.dataset.su; S.settings.lmSpeedUnit = su; save('settings'); Object.assign(lm, cur); $('.sheet-body', card).innerHTML = body(); wire(card); });
    $$('[data-du]', card).forEach(b => b.onclick = () => { const cur = read(card); du = b.dataset.du; S.settings.lmDistUnit = du; save('settings'); Object.assign(lm, cur); $('.sheet-body', card).innerHTML = body(); wire(card); });
  };
  sheet({
    title: shot ? '📟 론치 모니터 수치 넣기' : '📟 론치 모니터 샷 추가', body: body(),
    onMount: card => wire(card),
    actions: [
      ...(shot?.lm && shot.source !== 'lm' ? [{ label: '수치 지우기', onClick: () => { onSave(null, shot.club); toast('모니터 수치를 지웠어요'); return false; } }] : []),
      { label: '취소' },
      { label: '저장', kind: 'primary', onClick: root => {
        const out = read(root), bad = lmErrors(out);
        $$('.lmf-i', root).forEach(el => el.classList.toggle('bad', bad.includes(el.dataset.k)));
        if (bad.length) { toast(bad.includes('ballSpeed') && !(out.ballSpeed > 0) ? '공 속도를 넣어 주세요' : '빨간 칸의 숫자를 확인해 주세요 (단위가 맞나요?)', 3500); return false; }
        const club = shot ? shot.club : $('#lmClub', root).value;
        if (!shot) { S.settings.lmLastClub = club; save('settings'); }
        onSave(out, club);
        return false; // onSave가 결과 화면을 새로 띄움
      } },
    ],
  });
}

// 샷에 모니터 수치를 붙이거나(lm) 지움(null) → 캐리·(모니터 전용 샷이면 총거리·방향) 다시 계산 → 클럽 비거리 다시 학습
const r1 = v => Math.round(v * 10) / 10;
export function applyLM(shot, lm) {
  if (lm) shot.lm = Object.fromEntries(Object.entries(lm).map(([k, v]) => [k, typeof v === 'number' ? (k === 'spinRpm' ? Math.round(v) : Math.round(v * 100) / 100) : v]));
  else delete shot.lm;
  if (shot.source === 'lm' && !shot.lm) return shot; // 모니터 전용 샷은 수치를 지우지 않음 (샷 지우기로)
  const a = analyzeStored(shot);
  shot.carry = r1(a.est.carry);
  if (shot.source === 'lm') { shot.total = r1(a.measured.total); shot.latDeg = a.measured.latDeg == null ? null : r1(a.measured.latDeg); }
  relearn(shot.club); return shot;
}
// 연습장 등 GPS 없이 모니터 값만으로 새 샷
export function addLMShot(lm, club) {
  const shot = { id: Date.now(), club, source: 'lm', ts: Date.now(), partial: false, total: 0 };
  applyLM(shot, lm); S.shots.push(shot); relearn(club); return shot;
}
function relearn(club) { const i = S.bag.findIndex(c => c.id === club); if (i >= 0) S.bag[i] = learnClub(S.bag[i], S.shots); save('shots', 'bag'); }

// 샷 결과 화면 (모니터 수치 넣기/고치기 포함). extra: 더 붙일 버튼 [{label, onClick}]
export function shotSheet(shot, { title = '', kind = 'result', extra = [], onChange = null } = {}) {
  const name = clubStats([{ ...shot, total: shot.total || 1 }])[0]?.name || shot.club;
  sheet({
    title: title || `🏌️ ${name}${shot.source === 'lm' ? ' · 📟 론치 모니터' : ''}`, body: shotCardHtml(shot, { kind }),
    actions: [
      ...(kind === 'result' ? [{ label: shot.lm ? '📟 수치 고치기' : '📟 모니터 수치 넣기', onClick: () => {
        openLMForm({ shot, onSave: lm => { if (!lm && shot.source === 'lm') return; applyLM(shot, lm); toast(lm ? '📟 모니터 수치를 저장했어요' : '지웠어요'); onChange?.(); shotSheet(shot, { title, kind, extra, onChange }); } });
        return false;
      } }] : []),
      ...extra, { label: '확인', kind: 'primary' },
    ],
  });
}
