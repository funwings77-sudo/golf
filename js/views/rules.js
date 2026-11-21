// 룰·구제 도우미: 상황 선택 → 절차 · 벌타 자동 반영 · 지도 위 구제 구역 표시
import { S, save, activeHole, activeCourse } from '../core/state.js';
import { RULES, CLUB_LEN } from '../core/rules.js';
import { Sensors } from '../core/sensors.js';
import { createMap, destroyMap, drawHole, ll, mapSheetPage, sheetHTML, sheetCover, bindSheet } from '../map.js';
import { $, $$, esc, toast } from '../ui.js';

let map = null;
export default {
  mount(el) {
    const list = () => {
      mapSheetPage(false); destroyMap(map); map = null;
      const lr = activeCourse()?.localRules || [];
      el.innerHTML = `<h2>📖 룰 · 구제 도우미</h2><p class="sub">상황을 고르면 절차와 벌타를 알려주고, 라운드 중이면 스코어에 반영합니다.</p>
        ${lr.length ? `<div class="card"><b>📌 ${esc(activeCourse().name)} 로컬 룰</b><ol class="tips">${lr.map(x => `<li>${esc(x)}</li>`).join('')}</ol><p class="sub" style="margin:0">골프장이 정한 규칙으로, 아래 일반 규칙보다 우선합니다.</p></div>` : ''}
        ${RULES.map(r => `<button class="list-btn" data-r="${r.id}"><span class="ico">${r.penalty ? '⚠️' : '🆓'}</span><span class="grow"><b>${esc(r.title)}</b><br><span class="sub">규칙 ${r.rule} · ${r.penalty ? r.penalty + '벌타' : '무벌타'}</span></span>›</button>`).join('')}`;
      $$('[data-r]').forEach(b => b.onclick = () => detail(RULES.find(r => r.id === b.dataset.r)));
    };
    const detail = r => {
      // 📱 구제 지도가 있으면: 지도 전체 화면 + 절차·벌타 버튼은 지도 위 아래 판 (티샷·코스 편집과 같은 부품)
      const withMap = !!(r.reliefClubLengths && Sensors.pos);
      mapSheetPage(withMap);
      const body = `<button class="btn small" id="bk">‹ 목록</button><h2 style="margin-top:10px">${esc(r.title)}</h2>
        <div class="card"><span class="pill ${r.penalty ? 'danger' : ''}">${r.penalty ? r.penalty + '벌타' : '무벌타'}</span> <span class="sub">규칙 ${r.rule}</span>
          <ol class="tips">${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>
        ${r.reliefClubLengths && Sensors.pos ? `<p class="sub">노란 원: 현재 위치(기준점) 기준 ${r.reliefClubLengths}클럽 길이(약 ${(r.reliefClubLengths * CLUB_LEN).toFixed(1)}m) 구제 구역. 홀에 더 가까워지면 안 됩니다 (빨간 선 = 홀과의 같은 거리).</p>` : ''}
        ${S.round ? `<div class="grid2">${r.penalty ? `<button class="btn primary" data-pen="${r.penalty}">+${r.penalty}벌타 기록</button>` : '<span></span>'}${r.altPenalty ? `<button class="btn" data-pen="${r.altPenalty}">${esc(r.altLabel)}</button>` : ''}</div>` : ''}`;
      el.innerHTML = withMap ? `<div class="mapwrap m-map"><div class="map" id="map"></div></div>` + sheetHTML(body, '구제 판 크게·작게') : body;
      $('#bk').onclick = list;
      $$('[data-pen]').forEach(b => b.onclick = () => {
        const h = S.round.holes.find(x => x.n === S.ui.hole), sc = h.scores[0], p = +b.dataset.pen;
        sc.penalties += p; sc.strokes += p; if (r.id === 'lost' || r.id === 'ob') sc.lost += r.id === 'lost' ? 1 : 0;
        save('round'); toast(`${h.n}번 홀에 ${p}벌타 기록`);
      });
      if (r.reliefClubLengths && Sensors.pos) {
        const hole = activeHole();
        map = createMap($('#map'), { center: ll(Sensors.pos), zoom: 20, full: false });
        bindSheet(map);
        if (map) {
          drawHole(map, hole);
          const zone = L.circle(ll(Sensors.pos), { radius: r.reliefClubLengths * CLUB_LEN, color: '#ffe27a', weight: 3, fillOpacity: 0.2 }).addTo(map);
          // 구제 구역(노란 원)이 판 위 보이는 칸 가운데에 오게
          const fit = () => {
            if (!map) return; map.invalidateSize();
            const cover = sheetCover(), sz = map.getSize(), vis = L.point(sz.x - 100, Math.max(120, sz.y - cover - 120));
            const z = Math.min(20, map.getBoundsZoom(zone.getBounds(), false, L.point(sz.x - vis.x, sz.y - vis.y)));
            map.setView(ll(Sensors.pos), z, { animate: false }); map.panBy([0, cover / 2], { animate: false }); // 판이 덮은 만큼 위로
          };
          fit(); setTimeout(fit, 150);
          const pin = hole?.pin || hole?.green;
          if (pin) { const d = map.distance(ll(Sensors.pos), ll(pin)); L.circle(ll(pin), { radius: d, color: '#e84c3d', weight: 2, fill: false, dashArray: '6 6' }).addTo(map); }
        }
      }
    };
    list();
  },
  unmount() { mapSheetPage(false); destroyMap(map); map = null; },
};
