// 친 공 결과 화면: 측정(거리·방향) + 추정(공 속도·높이·시간…) 숫자 카드 + 옆에서 본 비행 곡선
import { analyzeShot, kmh, mph } from '../physics/shotfit.js';
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

// 결과 카드 HTML. s = 저장된 샷 { club, total, latDeg, err, wind, rho, est(예상 위치) }
//  kind: 'result'(공 찾은 뒤) | 'predict'(치자마자 예상)
export function shotCardHtml(s, { kind = 'result', title = '' } = {}) {
  const a = analyzeShot({ clubId: s.club, total: s.total, err: s.err ?? 5, latDeg: s.latDeg, wind: s.wind, rho: s.rho });
  const e = a.est, meas = kind === 'result' && !s.estPos;
  const tag = t => `<em class="sv-tag ${t}">${t === 'm' ? '측정' : '계산'}</em>`;
  return `<div class="sv">
    ${title ? `<div class="sv-h">${esc(title)}</div>` : ''}
    <div class="sv-top">
      <div class="sv-big"><small>${meas ? '날아간 거리' : '예상 거리'} ${tag(meas ? 'm' : 'c')}</small><b>${f1(s.total)}<i>m</i></b><span>${meas ? `±${f0(s.err ?? 5)}m (GPS)` : '친 클럽 평균 기준'}</span></div>
      <div class="sv-big"><small>공 속도 ${tag('c')}</small><b>${f0(kmh(e.ballSpeed))}<i>km/h</i></b><span>${f0(mph(e.ballSpeed))} mph · ${f0(kmh(e.ballSpeedRange[0]))}~${f0(kmh(e.ballSpeedRange[1]))}</span></div>
    </div>
    ${flightSvg(a.path, { carry: e.carry, total: s.total, apex: e.apex })}
    <div class="sv-grid">
      <div><small>방향 ${tag(meas && s.latDeg != null ? 'm' : 'c')}</small><b>${meas ? side(s.latDeg, a.measured.lateralM) : '—'}</b></div>
      <div><small>발사 각도 ${tag('c')}</small><b>${f0(e.launchDeg)}° <span>(${f0(e.launchRange[0])}~${f0(e.launchRange[1])}°)</span></b></div>
      <div><small>최고 높이 ${tag('c')}</small><b>${f0(e.apex)}m <span>(${f0(e.apexRange[0])}~${f0(e.apexRange[1])})</span></b></div>
      <div><small>날아간 시간 ${tag('c')}</small><b>${f1(e.time)}초</b></div>
      <div><small>공중 거리(캐리) ${tag('c')}</small><b>${f0(e.carry)}m</b></div>
      <div><small>굴러간 거리(런) ${tag('c')}</small><b>${f0(e.roll)}m</b></div>
      <div><small>떨어질 때 각도 ${tag('c')}</small><b>${f0(e.landAngle)}°</b></div>
      <div><small>떨어질 때 속도 ${tag('c')}</small><b>${f0(kmh(e.landSpeed))}km/h</b></div>
      <div><small>헤드 속도 ${tag('c')}</small><b>${f0(kmh(e.headSpeed))}km/h <span>(${f0(mph(e.headSpeed))}mph)</span></b></div>
      <div><small>백스핀 ${tag('c')}</small><b>${Math.round(e.spinRpm / 100) * 100}rpm</b></div>
    </div>
    <p class="sv-note"><em class="sv-tag m">측정</em> GPS로 잰 값 · <em class="sv-tag c">계산</em> 잰 거리${s.wind ? '·바람' : ''}·공기로 공 비행 물리식을 거꾸로 풀어 낸 값이에요. 휴대폰은 공 속도·각도·스핀을 직접 잴 수 없어서, 발사 각도·스핀은 ${esc(a.clubName)} 평균을 쓰고 괄호 안에 범위를 함께 보여 줘요.</p>
  </div>`;
}
