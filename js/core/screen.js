// 📱 완전 전체 화면(몰입 모드): 상단 상태바·하단 내비게이션 바까지 숨김
//  · 안드로이드 앱: 앱 안 플러그인 PinpointScreen (android/.../screen/ScreenPlugin.java)
//  · 웹(브라우저): Fullscreen API (사용자가 누른 직후에만 됨 · 안 되면 그냥 넘어감)
//  · 펀치홀·노치 높이를 --cut-top(CSS px)으로 알려 줌 → 위쪽 안내가 카메라 구멍에 가려지지 않게
//  · 끄기는 조금 늦게: 같은 화면을 다시 그리느라 껐다 바로 켜면 바가 깜빡이지 않게
let on = false, offTimer = null;
function apply(want) {
  if (want === on) return;
  on = want;
  const root = document.documentElement, P = window.Capacitor?.Plugins?.PinpointScreen;
  if (P?.immersive) {
    P.immersive({ on: want }).then(r => root.style.setProperty('--cut-top', `${want ? Math.max(0, r?.cutTop || 0) : 0}px`)).catch(() => {});
    return;
  }
  try {
    if (want && !document.fullscreenElement) root.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {});
    else if (!want && document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
  } catch {}
}
export function immersive(want) {
  clearTimeout(offTimer); offTimer = null;
  if (want) apply(true);
  else offTimer = setTimeout(() => { offTimer = null; apply(false); }, 150);
}
