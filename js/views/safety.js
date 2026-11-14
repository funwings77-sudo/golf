// 날씨 · 낙뢰 · 폭염(WBGT) · 대피소 안내 · 응급 위치 공유
import { S, activeCourse } from '../core/state.js';
import { distance, bearing } from '../core/geo.js';
import { Sensors } from '../core/sensors.js';
import { fetchWeather, weatherText } from '../core/weather.js';
import { $, esc, toast, DU } from '../ui.js';

export default {
  async mount(el, App) {
    const draw = () => {
      const w = App.weather, c = activeCourse(), me = Sensors.pos;
      const shelters = (c?.shelters || []).map(s => ({ ...s, d: me ? distance(me, s) : null, b: me ? bearing(me, s) : null })).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
      el.innerHTML = `<h2>⚡ 날씨 · 안전</h2>
        ${!S.settings.weather ? '<div class="card">설정에서 날씨 정보를 켜면 낙뢰·폭염 경보를 받을 수 있습니다.</div>' : ''}
        ${w ? `<div class="card ${w.lightningRisk >= 2 ? 'locked' : ''}"><div class="row"><b class="grow mid">${w.lightningRisk >= 2 ? '⚡ 낙뢰 위험 — 즉시 대피' : w.lightningRisk === 1 ? '⛅ 대기 불안정 (뇌우 가능성)' : '✅ 낙뢰 위험 낮음'}</b></div>
            <p class="sub">${w.thunderNow ? '현재 뇌우가 관측/예보되었습니다.' : w.thunderSoon ? '3시간 내 뇌우 예보.' : ''} 대기 불안정도(CAPE) ${Math.round(w.cape)} J/kg. 천둥을 들으면 이미 사정거리 안입니다 — 넓은 페어웨이·큰 나무·물가를 피하고 건물이나 차량 안으로 대피하세요.</p></div>
          <div class="card"><div class="row"><b class="grow">🌡️ 체감 더위 (WBGT 추정)</b><b style="color:${w.heat.color}">${w.wbgt.toFixed(1)} · ${w.heat.label}</b></div><p class="sub">${esc(w.heat.advice)}</p></div>
          <div class="grid3"><div class="stat"><div class="v">${w.temp.toFixed(0)}°</div><div class="l">${weatherText(w.code)} · 습도 ${w.rh}%</div></div><div class="stat"><div class="v">${w.windSpeed.toFixed(1)}</div><div class="l">바람 m/s (돌풍 ${w.gust?.toFixed(0) ?? '—'})</div></div><div class="stat"><div class="v">${Math.round(w.elevation)}m</div><div class="l">고도</div></div></div>
          <p class="sub">업데이트 ${new Date(w.ts).toLocaleTimeString()} · Open-Meteo</p>` : `<div class="card">${me ? '날씨를 불러오는 중…' : '위치를 확인하면 날씨를 불러옵니다.'}</div>`}
        <h3>대피소 · 그늘집</h3>
        ${shelters.length ? shelters.map(s => `<div class="kv"><span>${esc(s.name)}</span><b>${s.d != null ? DU(s.d) + ' · ' + dirName(s.b) + '쪽' : '—'}</b></div>`).join('') : '<p class="sub">코스 편집에서 대피소·그늘집 위치를 지정하면 가장 가까운 곳을 안내합니다.</p>'}
        <h3>응급</h3>
        <div class="grid2"><a class="btn danger" href="tel:119">📞 119 전화</a><button class="btn" id="shareLoc">📍 내 위치 공유</button></div>
        <p class="sub">위치 공유는 지도 링크를 메시지 앱으로 보냅니다. 혼자 카트로 이동하는 시니어 골퍼에게 특히 유용합니다.</p>`;
      $('#shareLoc').onclick = async () => {
        if (!Sensors.pos) return toast('위치를 확인 중입니다');
        const url = `https://maps.google.com/?q=${Sensors.pos.lat.toFixed(6)},${Sensors.pos.lon.toFixed(6)}`;
        const text = `[긴급] 골프장 내 현재 위치: ${url}`;
        try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('위치 링크를 복사했습니다'); } } catch {}
      };
    };
    draw();
    if (S.settings.weather && Sensors.pos && (!App.weather || Date.now() - App.weather.ts > 5 * 60000)) {
      try { App.weather = await fetchWeather(Sensors.pos.lat, Sensors.pos.lon); draw(); } catch (e) { toast('날씨를 불러오지 못했습니다'); }
    }
  },
};
function dirName(d) { return ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round(((d % 360) + 360) % 360 / 45) % 8]; }
