// PinPoint 관리자 — 셸 · 라우터 · 연결 상태
import { $, $$, esc } from '../ui.js';
import { Store } from './store.js';

const ROUTES = {
  dashboard: () => import('./views/dashboard.js'),
  ready: () => import('./views/ready.js'),
  courses: () => import('./views/courses.js'),
  kgba: () => import('./views/kgba.js'),
  course: () => import('./views/editor.js'),
  pins: () => import('./views/pins.js'),
  greens: () => import('./views/greens.js'),
  notices: () => import('./views/notices.js'),
  devices: () => import('./views/devices.js'),
  analytics: () => import('./views/analytics.js'),
  deploy: () => import('./views/deploy.js'),
  connect: () => import('./views/connect.js'),
  guide: () => import('./views/guide.js'),
};
const NAV_OF = { course: 'courses' };

let current = null, seq = 0;
export function go(path) { location.hash = '#/' + path; }

async function route() {
  const [name = 'dashboard', ...args] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const key = ROUTES[name] ? name : 'dashboard';
  const my = ++seq;
  try { current?.unmount?.(); } catch (e) { console.error(e); }
  current = null;
  const sh = $('#sheet'); sh.classList.remove('open'); sh.innerHTML = ''; // 이전 화면의 확인 창 닫기
  $('#tip').classList.remove('show');
  const view = $('#aview');
  view.innerHTML = '<div class="empty">불러오는 중…</div>';
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (NAV_OF[key] || key)));
  try {
    const mod = (await ROUTES[key]()).default;
    if (my !== seq) return; // 그사이 다른 화면으로 이동
    // 화면마다 새 컨테이너: 늦게 끝난 이전 화면의 비동기 작업이 새 화면을 덮어쓰지 않게 함
    current = mod; view.innerHTML = '';
    const box = document.createElement('div'); view.appendChild(box);
    await mod.mount(box, args);
  } catch (e) {
    console.error(e);
    if (my === seq) view.innerHTML = `<div class="card"><b>화면을 여는 중 오류가 발생했습니다</b><p class="sub">${esc(e.message)}</p><button class="btn" onclick="location.reload()">새로고침</button></div>`;
  }
  window.scrollTo(0, 0);
}

function chip() {
  const c = $('#connChip');
  if (Store.connected) { c.className = 'a-conn ok'; c.textContent = `● ${Store.user?.login || '연결됨'} · ${Store.conf.repo}`; c.title = `${Store.conf.owner}/${Store.conf.repo}@${Store.conf.branch} 쓰기 가능`; }
  else { c.className = 'a-conn ro'; c.textContent = Store.connError ? '⚠ 연결 오류' : '읽기 전용 · 연결하기'; c.title = Store.connError || '발행하려면 GitHub 토큰으로 연결하세요'; }
}

// 편집 중 이탈 방지
window.addEventListener('beforeunload', e => { if (current?.dirty?.()) { e.preventDefault(); e.returnValue = ''; } });

(async function init() {
  $('#connChip').onclick = () => go('connect');
  Store.on(chip); chip();
  window.addEventListener('hashchange', route);
  await Store.init();
  route();
})();
