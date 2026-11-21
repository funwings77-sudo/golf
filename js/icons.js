// 🎨 PinPoint 아이콘 세트 (직접 그린 SVG · 라이선스 걱정 없음)
//  스타일: 'lineal color' — 24×24 격자 · 선 1.8 · 둥근 끝/모서리 · 선은 글자색(currentColor) · 포인트는 라임(--ic-acc)
//  · 포인트 면(class="a")을 먼저 깔고 그 위에 선을 그림 → 어두운 메뉴·밝은 시트 어디서나 같은 느낌
//  · 골프 화면답게: 깃발·그린·공(딤플)·티·클럽을 기본 모양으로 반복 사용
const A = 'class="a"'; // 포인트 면
const K = 'class="k"'; // 포인트 면 위의 작은 선(딤플·글자): 늘 진한 색 → 어두운 메뉴에서도 보임
const P = {
  menu: `<path d="M4 7h16M4 12h16M4 17h11"/>`,
  // 그린: 그린(타원) + 깃대 + 깃발
  green: `<ellipse ${A} cx="12" cy="18.5" rx="8.5" ry="3"/><path ${A} d="M12 3.5l6.5 2.6L12 8.7z"/><ellipse cx="12" cy="18.5" rx="8.5" ry="3"/><path d="M12 18.5V3.5l6.5 2.6L12 8.7"/><ellipse ${K} cx="12" cy="18.5" rx="1.6" ry=".6"/>`,
  // 골프 치기(가운데): 홀컵 깃발 + 공
  play: `<circle ${A} cx="7" cy="17" r="3.2"/><path ${A} d="M14 3l6 2.5-6 2.5z"/><path d="M14 20V3l6 2.5-6 2.5"/><path d="M10.5 20.5h8"/><circle cx="7" cy="17" r="3.2"/><path ${K} d="M6 16.2h.01M8 16.2h.01M7 18h.01"/>`,
  // 공 찾기: 돋보기 안에 공
  lost: `<circle ${A} cx="10.5" cy="10.5" r="3"/><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3L20.5 20.5"/><path ${K} d="M9.6 9.8h.01M11.4 9.8h.01M10.5 11.6h.01"/>`,
  // 내 샷 기록: 올라가는 그래프 + 공 궤적
  shots: `<path ${A} d="M4 20V15l4-4 4 3 7-7v13z"/><path d="M4 4v16h16"/><path d="M4 15l4-4 4 3 7-7"/><circle cx="19" cy="7" r="1.6"/>`,
  // 거리표: 클립보드 + 거리 줄 + 작은 깃발
  yard: `<rect ${A} x="9" y="2.8" width="6" height="3.4" rx="1"/><rect x="5" y="4.5" width="14" height="17" rx="2.5"/><rect x="9" y="2.8" width="6" height="3.4" rx="1"/><path d="M8.5 11h4M8.5 14.5h7M8.5 18h5.5"/><path d="M16 12.5V9l2 .8-2 .8"/>`,
  // 도구: 공구함
  tools: `<rect ${A} x="3" y="11" width="18" height="3.2"/><rect x="3" y="7.5" width="18" height="12.5" rx="2.5"/><path d="M9 7.5V5.5a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0115 5.5v2"/><path d="M3 12.5h18M10.5 11.5v2.5h3v-2.5"/>`,
  home: `<path ${A} d="M9.5 21v-6h5v6"/><path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/>`,
  // 라이 경사: 비탈 + 공 + 각도
  lie: `<path ${A} d="M3 20L21 11v9z"/><path d="M3 20L21 11v9H3z"/><circle cx="12" cy="12.3" r="2.3"/><path d="M8 20a5 5 0 00-.6-2.4"/>`,
  map: `<path ${A} d="M9 4.5l6 2.5v13l-6-2.5z"/><path d="M3 6.5l6-2 6 2.5 6-2v13l-6 2-6-2.5-6 2z"/><path d="M9 4.5V17M15 7v13"/>`,
  // 내 백: 골프백 + 클럽 헤드 3개
  bag: `<rect ${A} x="7" y="8" width="10" height="4"/><path d="M7.5 8h9l-1 13h-7z"/><path d="M9 8V3.5M12 8V2.5M15 8V4"/><path d="M8 3.5h2M11 2.5h2.2M14 4h2"/><path d="M7.4 12h9.2"/>`,
  // 룰: 책
  book: `<path ${A} d="M12 6.5c-2-1.6-5-2-8-1.5v13c3-.5 6 0 8 1.5z"/><path d="M12 6.5c-2-1.6-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6-.1-8 1.5z"/><path d="M12 6.5v13"/>`,
  // 안전(낙뢰): 번개
  bolt: `<path ${A} d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/><path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>`,
  // 기록·통계: 막대
  bars: `<rect ${A} x="10.5" y="7" width="3.5" height="13" rx="1"/><path d="M4 20h16"/><rect x="5" y="12" width="3.5" height="8" rx="1"/><rect x="10.5" y="7" width="3.5" height="13" rx="1"/><rect x="16" y="3.5" width="3.5" height="16.5" rx="1"/>`,
  sliders: `<circle ${A} cx="9" cy="8" r="2.2"/><circle ${A} cx="15" cy="16" r="2.2"/><path d="M4 8h2.8M11.2 8H20M4 16h8.8M17.2 16H20"/><circle cx="9" cy="8" r="2.2"/><circle cx="15" cy="16" r="2.2"/>`,
  gear: `<circle ${A} cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M5.5 18.5l1.9-1.9M16.6 7.4l1.9-1.9"/><circle cx="12" cy="12" r="6.3"/>`,
  info: `<circle ${A} cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path ${K} d="M12 11v6M12 7.5h.01"/>`,
  refresh: `<path d="M20 12a8 8 0 01-14.3 4.9M4 12a8 8 0 0114.3-4.9"/><path ${A} d="M18.8 3.5v4.2h-4.2z"/><path d="M18.8 3.5v4.2h-4.2M5.2 20.5v-4.2h4.2"/>`,
  // AI 캐디: 반짝임
  ai: `<path ${A} d="M10 3.5l1.7 4.8 4.8 1.7-4.8 1.7L10 16.5l-1.7-4.8L3.5 10l4.8-1.7z"/><path d="M10 3.5l1.7 4.8 4.8 1.7-4.8 1.7L10 16.5l-1.7-4.8L3.5 10l4.8-1.7z"/><path d="M17.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>`,
  // 위치 핀
  pin: `<path ${A} d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z"/><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>`,
  // 정밀하게 재기: 조준선
  target: `<circle ${A} cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>`,
  // 티샷: 티 위의 공 + 방향
  tee: `<circle ${A} cx="9" cy="9" r="3.6"/><circle cx="9" cy="9" r="3.6"/><path d="M6.5 13.5h5L10 15v5.5H8V15z"/><path d="M14.5 6.5L20 3M17 3h3v3"/>`,
  camera: `<rect ${A} x="9" y="10" width="6" height="6" rx="3"/><path d="M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.6"/>`,
  compass: `<path ${A} d="M15.5 8.5l-2 5-5 2 2-5z"/><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>`,
  wind: `<path ${A} d="M3 12h13a3 3 0 10-3-3"/><path d="M3 12h13a3 3 0 10-3-3"/><path d="M3 8h6.5M3 16h9a2.6 2.6 0 11-2.6 2.6"/>`,
  // 규칙: 저울
  scale: `<path ${A} d="M3 13l3-6.5L9 13a3 3 0 01-6 0zM15 13l3-6.5 3 6.5a3 3 0 01-6 0z"/><path d="M12 3.5v17M7.5 20.5h9M5 6.5h14"/><path d="M3 13l3-6.5L9 13a3 3 0 01-6 0zM15 13l3-6.5 3 6.5a3 3 0 01-6 0z"/>`,
  // 점수표
  card: `<rect ${A} x="4" y="4" width="16" height="4.5" rx="1"/><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 8.5h16M4 13.5h16M9.5 8.5V20M14.5 8.5V20"/>`,
  swap: `<path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5"/>`,
  // 라운드 끝: 체크 깃발
  finish: `<path ${A} d="M6 4h5v4H6zM11 8h5v4h-5z"/><path d="M6 21V4h12v8H6"/><path d="M11 4v8M6 8h12"/>`,
  big: `<path ${A} d="M3 19L8 5l5 14z"/><path d="M3 19L8 5l5 14M5 14h6"/><path d="M15 19v-6.5a2.5 2.5 0 015 0V19M15 15.5h5"/>`,
  mountain: `<path ${A} d="M14 6l7 13H8.5z"/><path d="M2.5 19l6.5-11 3.2 5.3L14 6l7 13z"/><path d="M12.4 9.6l1.6 1.6 1.4-1.3"/>`,
  film: `<rect ${A} x="9" y="9" width="6" height="6" rx="1"/><rect x="3" y="5" width="18" height="14" rx="2.5"/><path ${K} d="M10.5 9.5v5l4-2.5z"/>`,
  ball: `<circle ${A} cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="8"/><path ${K} d="M9.5 9.5h.01M12.5 9h.01M14.6 11.2h.01M10.4 12.6h.01M13 14.4h.01M15.5 14h.01"/>`,
  user: `<circle ${A} cx="12" cy="8" r="3.6"/><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5a7.5 7.5 0 0115 0"/>`,
  // ---- 본문 버튼용 ----
  // 골퍼: 피니시 자세 (머리 · 몸 · 다리 · 어깨 위로 넘어간 클럽)
  golfer: `<circle ${A} cx="11" cy="4.8" r="2.2"/><circle cx="11" cy="4.8" r="2.2"/><path d="M11 7.5l-1 6.5-3 7M10 14l3.5 2.5 1 4.5M10.5 9.5l4.5 1.5M15 11l3.5-8.5"/><path d="M18.5 2.5l2 .6"/>`,
  share: `<path ${A} d="M5 11v8.5a1 1 0 001 1h12a1 1 0 001-1V11z"/><path d="M5 11v8.5a1 1 0 001 1h12a1 1 0 001-1V11M12 14.5V3M8 6.8L12 3l4 3.8"/>`,
  download: `<path ${A} d="M4 16v3.5a1 1 0 001 1h14a1 1 0 001-1V16z"/><path d="M4 16v3.5a1 1 0 001 1h14a1 1 0 001-1V16M12 3.5v11M8 10.8l4 3.7 4-3.7"/>`,
  check: `<circle ${A} cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path ${K} d="M7.8 12.3l2.8 2.8 5.6-5.8"/>`,
  xcircle: `<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>`,
  edit: `<path ${A} d="M15.5 4.5l4 4L9 19l-5 1 1-5z"/><path d="M15.5 4.5l4 4L9 19l-5 1 1-5zM13 7l4 4"/>`,
  trash: `<path ${A} d="M6.5 7.5h11l-1 12.5a1 1 0 01-1 .9h-7a1 1 0 01-1-.9z"/><path d="M4.5 7.5h15M9.5 7.5V4.5h5v3M6.5 7.5l1 12.5a1 1 0 001 .9h7a1 1 0 001-.9l1-12.5M10 11v6M14 11v6"/>`,
  save: `<rect ${A} x="7.5" y="13" width="9" height="7" rx=".5"/><path d="M5 3.5h11.5L20.5 7.5V19.5a1 1 0 01-1 1h-15a1 1 0 01-1-1v-15a1 1 0 011-1z"/><path d="M7.5 3.5v4.5h8V3.5M7.5 20.5V13h9v7.5"/>`,
  folder: `<path ${A} d="M3.5 9h17v9.5a1 1 0 01-1 1h-15a1 1 0 01-1-1z"/><path d="M3.5 18.5v-13a1 1 0 011-1h5l2 2.5h8a1 1 0 011 1V18.5a1 1 0 01-1 1h-15a1 1 0 01-1-1zM3.5 9h17"/>`,
  undo: `<path d="M9 5L4.5 9.5 9 14"/><path d="M4.5 9.5h10a5 5 0 010 10H11"/>`,
  flask: `<path ${A} d="M6.3 15h11.4l2 4a1 1 0 01-.9 1.5H5.2a1 1 0 01-.9-1.5z"/><path d="M9.5 3.5h5M10 3.5v6l-5.7 9.9a1 1 0 00.9 1.6h13.6a1 1 0 00.9-1.6L14 9.5v-6M6.3 15h11.4"/>`,
  signal: `<circle ${A} cx="12" cy="13" r="2"/><circle cx="12" cy="13" r="2"/><path d="M8.2 9.2a5.4 5.4 0 000 7.6M15.8 9.2a5.4 5.4 0 010 7.6M5.3 6.3a9.5 9.5 0 000 13.4M18.7 6.3a9.5 9.5 0 010 13.4"/>`,
  ruler: `<path ${A} d="M3.5 15.5l12-12 5 5-12 12z"/><path d="M3.5 15.5l12-12 5 5-12 12zM7.5 11.5l2 2M10.5 8.5l2 2M13.5 5.5l2 2"/>`,
  phone: `<path ${A} d="M5 3.5h3.5l1.7 4.3-2.3 1.4a11 11 0 006.9 6.9l1.4-2.3 4.3 1.7V19a1.5 1.5 0 01-1.5 1.5A16.5 16.5 0 013.5 5 1.5 1.5 0 015 3.5z"/><path d="M5 3.5h3.5l1.7 4.3-2.3 1.4a11 11 0 006.9 6.9l1.4-2.3 4.3 1.7V19a1.5 1.5 0 01-1.5 1.5A16.5 16.5 0 013.5 5 1.5 1.5 0 015 3.5z"/>`,
  mic: `<rect ${A} x="9" y="3" width="6" height="11" rx="3"/><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5v3.5M9 21h6"/>`,
  speaker: `<path ${A} d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4.5 4.5 0 010 6M18 6.5a8 8 0 010 11"/>`,
  headphones: `<path ${A} d="M4 14h3.5v6H5a1 1 0 01-1-1zM20 14h-3.5v6H19a1 1 0 001-1z"/><path d="M4 18v-5a8 8 0 0116 0v5M4 14h3.5v6H5a1 1 0 01-1-1zM20 14h-3.5v6H19a1 1 0 001-1z"/>`,
  video: `<rect ${A} x="3" y="6.5" width="12.5" height="11" rx="2"/><rect x="3" y="6.5" width="12.5" height="11" rx="2"/><path d="M15.5 10.5l5-3v9l-5-3"/>`,
  flag: `<path ${A} d="M6 4h12l-2.5 4L18 12H6z"/><path d="M6 21V4h12l-2.5 4L18 12H6"/>`,
  tree: `<path ${A} d="M12 2.5l6 8.5h-3l4 6H5l4-6H6z"/><path d="M12 2.5l6 8.5h-3l4 6H5l4-6H6zM12 17v4.5"/>`,
  pulse: `<path ${A} d="M12 20.5s-8-4.7-8-11a4.4 4.4 0 018-2.6 4.4 4.4 0 018 2.6c0 6.3-8 11-8 11z"/><path d="M12 20.5s-8-4.7-8-11a4.4 4.4 0 018-2.6 4.4 4.4 0 018 2.6c0 6.3-8 11-8 11z"/><path ${K} d="M6.5 12h3l1.5-2.5 2 5 1.5-2.5h3"/>`,
  stop: `<rect ${A} x="6" y="6" width="12" height="12" rx="2"/><rect x="6" y="6" width="12" height="12" rx="2"/>`,
  playtri: `<path ${A} d="M7 4.5l12 7.5-12 7.5z"/><path d="M7 4.5l12 7.5-12 7.5z"/>`,
  walk: `<circle ${A} cx="13" cy="4.5" r="2"/><circle cx="13" cy="4.5" r="2"/><path d="M12 8l-2 6.5 3 2.5 1 4.5M10 14.5L8 21M12 8l3.5 4 3 1M12 8.5L8.5 10.5 7 13.5"/>`,
  timer: `<circle ${A} cx="12" cy="13.5" r="7.5"/><circle cx="12" cy="13.5" r="7.5"/><path ${K} d="M12 9.5v4l2.5 2"/><path d="M9.5 2.5h5M12 2.5v3.5M18.5 6.5l1.5-1.5"/>`,
  users: `<circle ${A} cx="9" cy="8" r="3.2"/><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0113 0M15.5 5a3.2 3.2 0 010 6.2M17.5 14a6.5 6.5 0 014 6"/>`,
  globe: `<circle ${A} cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path ${K} d="M3 12h18M12 3c2.6 2.5 3.8 5.5 3.8 9s-1.2 6.5-3.8 9c-2.6-2.5-3.8-5.5-3.8-9S9.4 5.5 12 3z"/>`,
  thermo: `<circle ${A} cx="12" cy="17" r="3"/><path d="M9.5 14.6V5.5a2.5 2.5 0 015 0v9.1a4.2 4.2 0 11-5 0z"/><circle cx="12" cy="17" r="3"/><path ${K} d="M12 14V9"/>`,
  plug: `<path ${A} d="M7 9h10v3.5a5 5 0 01-10 0z"/><path d="M9 3.5V9M15 3.5V9M7 9h10v3.5a5 5 0 01-10 0zM12 17.5v3.5"/>`,
  metronome: `<path ${A} d="M8.5 3.5h7L19 20.5H5z"/><path d="M8.5 3.5h7L19 20.5H5zM5.8 16.5h12.4M12 16.5l4-9"/>`,
};

// icon('green') → <svg class="ic">…</svg> · cls로 크기 등 추가
export function icon(name, cls = '') {
  const d = P[name]; if (!d) return '';
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
export const ICON_NAMES = Object.keys(P);
