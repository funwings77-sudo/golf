// ① 공↔홀컵 거리: GNSS(칼만) + 핀 위치(골프장/사용자 기록/그린 중앙) + 플레이즈라이크 + 해저드 캐리 + 레이업 도구
import { S, save, allowed, activeCourse, activeHole } from '../core/state.js';
import { distance, bearing, normAngle, vecBearing, toLocal } from '../core/geo.js';
import { Sensors, onPos, sampleFix, setSimPos, speak, vibrate } from '../core/sensors.js';
import { playsLike, fetchElevations } from '../core/weather.js';
import { learnClub } from '../core/score.js';
import { BEGINNER_TIPS } from '../core/rules.js';
import { createMap, destroyMap, drawHole, fitHole, ll, labelIcon, HZ_STYLE } from '../map.js';
import { $, esc, toast, sheet, DU, D, U, clubOptions } from '../ui.js';

let map, holeLayer, lineLayer, unPos, target = null, placing = false, elev = { me: null, pin: null, at: null }, lastSpoken = 0, App_;

export default {
  full: true,
  mount(el, App) {
    App_ = App;
    const hole = activeHole();
    el.innerHTML = `<div class="mapwrap"><div class="map" id="map"></div>
      <div class="hud top" id="hud"></div>
      <div class="fab-col" style="top:${hole ? 150 : 90}px">
        ${S.settings.simGPS ? '<button class="fab" id="fabSim" title="지도를 탭해 내 위치 지정">📍</button>' : ''}
        <button class="fab" id="fabFit" title="홀 전체 보기">⤢</button>
        <button class="fab" id="fabVoice" title="음성 안내">🔊</button>
        ${hole ? '<button class="fab" id="fabPin" title="홀컵 옆에서 핀 위치 기록">핀</button>' : ''}
        ${hole ? '<button class="fab" id="fabShot" title="샷 기록 (개인 비거리 학습)">샷</button>' : ''}
      </div>
      <div class="hud bottom" id="hudB" style="display:none"></div></div>`;
    const c = hole?.green || hole?.tee || Sensors.pos || { lat: 37.5665, lon: 126.978 };
    map = createMap($('#map', el), { center: ll(c), zoom: 17 });
    if (map) {
      holeLayer = drawHole(map, hole); lineLayer = L.layerGroup().addTo(map);
      if (hole) fitHole(map, hole, Sensors.pos);
      map.on('click', e => {
        if (placing) { setSimPos(e.latlng.lat, e.latlng.lng); return; }
        target = { lat: e.latlng.lat, lon: e.latlng.lng }; render();
      });
    }
    $('#fabFit', el).onclick = () => { const h = activeHole(); if (h && map) fitHole(map, h, Sensors.pos); else if (Sensors.pos && map) map.setView(ll(Sensors.pos), 18); };
    $('#fabVoice', el).onclick = () => announce(true);
    $('#fabSim', el) && ($('#fabSim', el).onclick = e => { placing = !placing; e.currentTarget.classList.toggle('on', placing); toast(placing ? '지도를 탭하면 내 위치가 이동합니다' : '위치 지정 끝'); });
    $('#fabPin', el) && ($('#fabPin', el).onclick = recordPin);
    $('#fabShot', el) && ($('#fabShot', el).onclick = shotFlow);
    unPos = onPos(() => render());
    render();
  },
  unmount() { unPos && unPos(); destroyMap(map); map = null; target = null; placing = false; },
  onHole() { const h = activeHole(); target = null; if (map) { drawHole(map, h, holeLayer); fitHole(map, h, Sensors.pos); } render(); },
};

function pinOf(h) { return h?.pin || h?.green || null; }
function isToday(ts) { return ts && new Date(ts).toDateString() === new Date().toDateString(); }

async function refreshElevation(me, pin) {
  if (!S.settings.weather || !allowed('playsLike')) return;
  if (elev.at && distance(elev.at, me) < 12 && elev.pinAt === pin) return;
  elev.at = me; elev.pinAt = pin;
  try { const [a, b] = await fetchElevations([me, pin]); elev.me = a; elev.pin = b; render(); } catch {}
}

function render() {
  const hud = $('#hud'); if (!hud) return;
  const hole = activeHole(), me = Sensors.pos, pin = pinOf(hole);
  if (!hole) {
    hud.innerHTML = `<b>코스 없음</b><div class="sub">지도를 탭하면 내 위치에서 그 지점까지 거리를 잽니다. 코스를 만들면 핀·해저드 거리가 표시됩니다. <a href="#/courses" style="color:#ffe27a">코스 관리</a></div>${target && me ? `<div class="mid" style="margin-top:6px">${DU(distance(me, target))}</div>` : ''}`;
    drawLines(me, null, hole); return;
  }
  if (!me) { hud.innerHTML = `<b>위치 확인 중…</b><div class="sub">GPS 신호를 기다립니다. 실내라면 설정 → GPS 시뮬레이션을 켜세요.</div>`; drawLines(null, pin, hole); return; }
  const dPin = distance(me, pin), brg = bearing(me, pin);
  const dF = hole.front ? distance(me, hole.front) : null, dB = hole.back ? distance(me, hole.back) : null;
  let pl = null;
  if (allowed('playsLike')) {
    refreshElevation(me, pin);
    const w = App_.weather;
    pl = playsLike({ dist: dPin, dh: elev.me != null && elev.pin != null ? elev.pin - elev.me : 0, windSpeed: w?.windSpeed || 0, windFrom: w?.windFrom || 0, shotBearing: brg, tempC: w?.temp ?? 20, altitude: elev.me || 0 });
  }
  const pinNote = !hole.pin ? '핀 미기록 · 그린 중앙 기준' : isToday(hole.pin.ts) ? (hole.pin.src === 'official' ? `오늘 핀 (골프장 제공${hole.pin.depth != null ? ` · 앞에서 ${hole.pin.depth}m` : ''})` : '오늘 핀 (내 기록)') : `핀 ${new Date(hole.pin.ts).toLocaleDateString()} 기록 · 오늘 핀 아님`;
  // 앞쪽 해저드 캐리
  const hz = (hole.hazards || []).map(z => {
    const d = distance(me, z), rel = normAngle(bearing(me, z) - brg);
    return { ...z, d, rel, front: d - z.r, carry: d + z.r };
  }).filter(z => Math.abs(z.rel) < 45 && z.front > 0 && z.d < dPin + 30).sort((a, b) => a.d - b.d).slice(0, 4);
  const shot = App_.pendingShot && !App_.pendingShot.auto ? App_.pendingShot : null;
  hud.innerHTML = `<div class="hud-row">
      <div><div class="sub">핀까지 <span style="opacity:.8">· ±${Math.round(me.acc || 0)}m</span></div><div class="big">${D(dPin)}<small>${U()}</small></div></div>
      ${pl ? `<div><div class="sub">플레이즈라이크</div><div class="mid">${D(pl.total)}<small style="font-size:13px">${U()}</small></div></div>` : ''}
      <div class="tri" style="margin-left:auto"><div><span class="sub">앞</span><b>${dF ? D(dF) : '—'}</b></div><div><span class="sub">뒤</span><b>${dB ? D(dB) : '—'}</b></div></div>
    </div>
    <div class="sub" style="margin-top:4px">${pinNote}${pl ? ` · 고저 ${pl.parts.elev >= 0 ? '+' : ''}${pl.parts.elev.toFixed(0)} · 바람 ${pl.parts.wind >= 0 ? '+' : ''}${pl.parts.wind.toFixed(0)} · 기온 ${pl.parts.temp >= 0 ? '+' : ''}${pl.parts.temp.toFixed(0)}` : ''}${shot ? ` · <b style="color:#ffe27a">샷 기록 중 (${esc(shot.clubName)})</b>` : ''}</div>
    ${hz.length ? `<div class="sub" style="margin-top:4px">${hz.map(z => `${HZ_STYLE[z.type]?.label || z.type}(${z.rel < 0 ? '좌' : '우'}) 앞 ${D(z.front)} / 넘김 ${D(z.carry)}`).join(' · ')}</div>` : ''}`;
  const hb = $('#hudB');
  if (target) {
    const dt = distance(me, target), tp = distance(target, pin);
    hb.style.display = ''; hb.innerHTML = `<div class="row"><div class="grow"><span class="sub">선택 지점까지</span> <b class="mid">${DU(dt)}</b> <span class="sub">→ 남는 거리</span> <b class="mid">${DU(tp)}</b></div><button class="btn small" id="clrT">✕</button></div>`;
    $('#clrT').onclick = () => { target = null; render(); };
  } else if (S.settings.beginner) {
    const ctx = hole.tee && distance(me, hole.tee) < 25 ? 'tee' : hole.green && distance(me, hole.green) < 20 ? 'green' : 'fairway';
    hb.style.display = ''; hb.innerHTML = `<b>지금 할 일</b><div class="sub">${BEGINNER_TIPS[ctx].map(esc).join('<br>')}</div>`;
  } else hb.style.display = 'none';
  drawLines(me, pin, hole);
  if (S.settings.voice && Date.now() - lastSpoken > 45000) announce(false, dPin, pl);
}

function drawLines(me, pin, hole) {
  if (!map || !lineLayer) return;
  lineLayer.clearLayers();
  if (me && pin) {
    L.polyline([ll(me), ll(pin)], { color: '#ffe27a', weight: 2, dashArray: '6 6', interactive: false }).addTo(lineLayer);
  }
  if (me && target) {
    L.polyline([ll(me), ll(target)], { color: '#fff', weight: 3, interactive: false }).addTo(lineLayer);
    if (pin) L.polyline([ll(target), ll(pin)], { color: '#fff', weight: 2, dashArray: '4 6', interactive: false }).addTo(lineLayer);
    L.circleMarker(ll(target), { radius: 6, color: '#fff', fillColor: '#ffe27a', fillOpacity: 1 }).addTo(lineLayer);
    L.marker(ll(target), { icon: labelIcon(DU(distance(me, target)), 'y'), interactive: false }).addTo(lineLayer);
  }
}

function announce(force, dPin, pl) {
  const hole = activeHole(), me = Sensors.pos; if (!hole || !me) return;
  dPin = dPin ?? distance(me, pinOf(hole));
  const u = S.settings.unit === 'yd' ? '야드' : '미터';
  let t = `핀까지 ${D(dPin)} ${u}`;
  if (pl) t += `, 플레이즈라이크 ${D(pl.total)} ${u}`;
  lastSpoken = Date.now();
  speak(t, force);
  if (force && !('speechSynthesis' in window)) toast(t);
}

async function recordPin() {
  const hole = activeHole(); if (!hole) return;
  if (!Sensors.pos) return toast('위치를 확인 중입니다');
  if (hole.green && distance(Sensors.pos, hole.green) > 45) return toast('그린 근처(45m 이내)에서 홀컵 옆에 서서 기록하세요');
  toast('홀컵 옆에 3초간 서 있어 주세요…');
  const f = await sampleFix(3000);
  if (!f) return toast('위치를 얻지 못했습니다');
  hole.pin = { lat: f.lat, lon: f.lon, ts: Date.now(), acc: f.acc };
  save('courses'); vibrate(80);
  toast(`핀 위치 기록 (±${Math.round(f.acc)}m) · 다음 라운드/동반자와 코스 내보내기로 공유`);
  drawHole(map, hole, holeLayer); render();
}

// 샷 기록: 출발 → 공 도착 → 캐리 학습 (개인 비거리·분산)
function shotFlow() {
  const hole = activeHole();
  const ps = App_.pendingShot && !App_.pendingShot.auto ? App_.pendingShot : null;
  if (!ps) {
    sheet({
      title: '샷 기록 시작', body: `<p class="sub">공 옆에서 클럽을 고르고 시작을 누르세요. 공에 도착하면 다시 [샷] 버튼을 눌러 비거리를 기록합니다. 기록이 쌓이면 클럽 추천·분실구 추정이 정확해집니다.</p>
        <label class="f"><span>클럽</span><select id="shClub">${clubOptions('7i')}</select></label>`,
      actions: [{ label: '취소' }, {
        label: '여기서 시작', kind: 'primary', onClick: async card => {
          const id = $('#shClub', card).value, club = S.bag.find(c => c.id === id);
          const f = await sampleFix(2000); if (!f) { toast('위치를 얻지 못했습니다'); return; }
          App_.pendingShot = { lat: f.lat, lon: f.lon, club: id, clubName: club.name, hole: hole.n, ts: Date.now(), aimBearing: bearing(f, pinOf(hole)) };
          toast(`${club.name} 샷 시작 위치 저장`); render();
        },
      }],
    });
    return;
  }
  sheet({
    title: '공에 도착했나요?', body: `<p>${esc(ps.clubName)} 샷 · 출발점에서 ${DU(distance(ps, Sensors.pos || ps))}</p><label class="switch"><span>풀샷이 아니었음 (학습 제외)</span><input type="checkbox" id="shEx"></label>`,
    actions: [{ label: '기록 취소', onClick: () => { App_.pendingShot = null; render(); } }, {
      label: '여기가 공 위치', kind: 'primary', onClick: async card => {
        const ex = $('#shEx', card).checked;
        const f = await sampleFix(2000); if (!f) return;
        const total = distance(ps, f), latDeg = normAngle(bearing(ps, f) - ps.aimBearing);
        const ct = S.bag.find(c => c.id === ps.club);
        const rollF = { D: 0.1, '3W': 0.07, '5W': 0.06 }[ps.club] ?? 0.03;
        const shot = { id: Date.now(), club: ps.club, total, carry: total / (1 + rollF), latDeg, start: { lat: ps.lat, lon: ps.lon }, end: { lat: f.lat, lon: f.lon }, hole: ps.hole, ts: Date.now(), excluded: ex };
        S.shots.push(shot);
        const i = S.bag.findIndex(c => c.id === ps.club);
        if (i >= 0) S.bag[i] = learnClub(S.bag[i], S.shots);
        save('shots', 'bag'); App_.pendingShot = null;
        toast(`${ct?.name} ${DU(total)} (방향 ${latDeg >= 0 ? '우' : '좌'} ${Math.abs(latDeg).toFixed(1)}°) 기록`);
        render();
      },
    }],
  });
}
