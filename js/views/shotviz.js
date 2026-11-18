// 친 공 결과 화면: 측정(거리·방향) + 추정(공 속도·높이·시간…) 숫자 카드 + 옆에서 본 비행 곡선
import { analyzeStored, kmh, mph } from '../physics/shotfit.js';
import { esc } from '../ui.js';

const f0 = v => (v == null || !Number.isFinite(v) ? '—' : Math.round(v));
const f1 = v => (v == null || !Number.isFinite(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1));
const side = (deg, m) => (deg == null ? '—' : Math.abs(deg) < 0.5 ? '똑바로' : `${deg > 0 ? '오른쪽' : '왼쪽'} ${f1(Math.abs(deg))}°${m != null ? ` · ${f0(Math.abs(m))}m` : ''}`);

// 옆에서 본 비행 곡선 (캐리 실선 + 런 점선, 최고점 표시). path: [[앞 m, 높이 m]…]
export function flightSvg(path, { carry, total, apex }) {
  if (!path?.length) return '';
  const W = 320, H = 130, L = 8, R = 8, T = 18, B = 22;
  const maxX = Math.max(total || carry, 10), maxZ = Math.max(apex || 1, maxX * 0.12);
  const X = x => (L + x / maxX * (W - L - R)).toFixed(1), Y = z => (H - B - z / maxZ * (H - T - B)).toFixed(1);
  const d = path.map(([x, z], i) => `${i ? 'L' : 'M'}${X(x)} ${Y(z)}`).join(' ');
  const top = path.reduce((a, p) => (p[1] > a[1] ? p : a), [0, 0]);
  return `<svg class="sv-fly" viewBox="0 0 ${W} ${H}" role="img" aria-label="옆에서 본 공 비행: 최고 높이 ${f0(apex)}m, 캐리 ${f0(carry)}m">
    <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" class="sv-g"/>
    ${[0.25, 0.5, 0.75, 1].map(k => `<text x="${X(maxX * k)}" y="${H - 6}" class="sv-t" text-anchor="middle">${f0(maxX * k)}</text>`).join('')}
    <path d="${d}" class="sv-p"/>
    ${total > carry ? `<line x1="${X(carry)}" y1="${H - B}" x2="${X(total)}" y2="${H - B}" class="sv-r"/>` : ''}
    <line x1="${X(top[0])}" y1="${Y(top[1])}" x2="${X(top[0])}" y2="${H - B}" class="sv-a"/>
    <text x="${X(top[0])}" y="${+Y(top[1]) - 5}" class="sv-t b" text-anchor="middle">${f0(apex)}m</text>
    <circle cx="${X(carry)}" cy="${H - B}" r="3.5" class="sv-l"/><circle cx="${X(total)}" cy="${H - B}" r="4" class="sv-e"/>
  </svg>`;
}

// 결과 카드 HTML. s = 저장된 샷 { club, total, latDeg, err, wind, rho, lm?(론치 모니터), source?, estPos?(예상 위치) }
//  kind: 'result'(공 찾은 뒤·기록) | 'predict'(위치를 못 재서 예상)
export function shotCardHtml(s, { kind = 'result', title = '' } = {}) {
  const a = analyzeStored(s), e = a.est, predict = kind === 'predict' || s.estPos;
  const src = k => (predict && k === 'total' ? 'calc' : a.src[k] || 'calc');
  const T = t => `<em class="sv-tag ${t === 'gps' ? 'm' : t === 'lm' ? 'l' : 'c'}">${t === 'gps' ? 'GPS' : t === 'lm' ? '모니터' : '계산'}</em>`; // 출처 종류로
  const tag = k => T(src(k)); // 값 이름으로
  const rng = (lo, hi, f, u = '') => (src(f) === 'lm' || Math.abs(hi - lo) < 0.5 ? '' : ` <span>(${f0(lo)}~${f0(hi)}${u})</span>`);
  const total = a.measured.total, latDeg = a.measured.latDeg;
  const dCarry = a.lm && s.lm.carry != null ? (s.lm.carry - e.modelCarry) / e.modelCarry * 100 : null;
  return `<div class="sv">
    ${title ? `<div class="sv-h">${esc(title)}</div>` : ''}
    ${a.lm ? `<div class="sv-lm">📟 론치 모니터 수치${s.lm.device ? ` · ${esc(s.lm.device)}` : ''}</div>` : ''}
    <div class="sv-top">
      <div class="sv-big"><small>${predict ? '예상 거리' : '날아간 거리'} ${tag('total')}</small><b>${f1(total)}<i>m</i></b><span>${src('total') === 'gps' ? `±${f0(a.measured.err ?? 5)}m (GPS)` : src('total') === 'lm' ? '모니터 총거리' : predict ? '친 클럽 평균 기준' : '캐리 + 계산한 런'}</span></div>
      <div class="sv-big"><small>공 속도 ${tag('ballSpeed')}</small><b>${f0(kmh(e.ballSpeed))}<i>km/h</i></b><span>${f0(mph(e.ballSpeed))} mph${rng(kmh(e.ballSpeedRange[0]), kmh(e.ballSpeedRange[1]), 'ballSpeed')}</span></div>
    </div>
    ${flightSvg(a.path, { carry: e.carry, total, apex: e.apex })}
    <div class="sv-grid">
      <div><small>방향 ${latDeg == null ? '' : tag('latDeg')}</small><b>${predict ? '—' : side(latDeg, a.measured.lateralM)}</b></div>
      <div><small>발사 각도 ${tag('launchDeg')}</small><b>${f1(e.launchDeg)}°${rng(e.launchRange[0], e.launchRange[1], 'launchDeg', '°')}</b></div>
      <div><small>최고 높이 ${tag('apex')}</small><b>${f0(e.apex)}m${rng(e.apexRange[0], e.apexRange[1], 'apex')}</b></div>
      <div><small>날아간 시간 ${T('calc')}</small><b>${f1(e.time)}초</b></div>
      <div><small>공중 거리(캐리) ${tag('carry')}</small><b>${f0(e.carry)}m</b></div>
      <div><small>굴러간 거리(런) ${T(a.lm && src('total') !== 'calc' && src('carry') === 'lm' ? 'lm' : 'calc')}</small><b>${f0(e.roll)}m</b></div>
      <div><small>떨어질 때 각도 ${T('calc')}</small><b>${f0(e.landAngle)}°</b></div>
      <div><small>떨어질 때 속도 ${T('calc')}</small><b>${f0(kmh(e.landSpeed))}km/h</b></div>
      <div><small>헤드 속도 ${tag('headSpeed')}</small><b>${f0(kmh(e.headSpeed))}km/h <span>(${f0(mph(e.headSpeed))}mph)</span></b></div>
      <div><small>백스핀 ${tag('spinRpm')}</small><b>${Math.round(e.spinRpm / 10) * 10}rpm</b></div>
      ${a.lm ? `<div><small>스매시 팩터 ${T(src('headSpeed') === 'lm' ? 'lm' : 'calc')}</small><b>${e.smash.toFixed(2)}</b></div>` : ''}
      ${dCarry != null ? `<div><small>물리식 캐리와 차이</small><b>${dCarry > 0 ? '+' : ''}${dCarry.toFixed(1)}% <span>(계산 ${f0(e.modelCarry)}m)</span></b></div>` : ''}
    </div>
    <p class="sv-note">${a.lm ? '<em class="sv-tag l">모니터</em> 론치 모니터에서 옮겨 적은 값 · ' : ''}<em class="sv-tag m">GPS</em> 휴대폰 GPS로 잰 값 · <em class="sv-tag c">계산</em> ${a.lm ? '잰 공 속도·발사 각도·스핀으로 공 비행 물리식을 풀어 낸 값이에요.' : `잰 거리${s.wind ? '·바람' : ''}·공기로 공 비행 물리식을 거꾸로 풀어 낸 값이에요. 휴대폰은 공 속도·각도·스핀을 직접 잴 수 없어서, 발사 각도·스핀은 ${esc(a.clubName)} 평균을 쓰고 괄호 안에 범위를 함께 보여 줘요. 론치 모니터 수치를 넣으면 더 정확해져요.`}</p>
  </div>`;
}
