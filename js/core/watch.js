// ⌚ 워치 연동: 갤럭시워치(Wear OS, android/wear) · 애플워치(ios/PinpointWatch) 앱이 스윙을 알아채면 'swing' 이벤트
//  네이티브 플러그인 'PinpointWatch' (android/.../watch/WatchPlugin.java · ios/App/App/WatchPlugin.swift)
//   이벤트 swing { ts, impact, peakGyro, peakJerk } · send({ text }) → 워치 화면 한 줄

const W = () => globalThis.window?.Capacitor?.Plugins?.PinpointWatch || null;
export const watchSupported = () => !!globalThis.window?.Capacitor?.isNativePlatform?.() && !!W();

let handle = null;
export async function onWatchSwing(cb) {
  const w = W(); if (!w) return () => {};
  await handle?.remove?.();
  handle = await w.addListener('swing', cb);
  return () => { handle?.remove?.(); handle = null; };
}

// 워치에 보낼 한 줄: 바뀌었을 때만 · 3초에 한 번까지
let lastText = '', lastAt = 0;
export function watchSend(text, now = Date.now()) {
  const w = W(); if (!w || !text || text === lastText || now - lastAt < 3000) return false;
  lastText = text; lastAt = now;
  w.send({ text }).catch(() => {});
  return true;
}

// 워치 스윙을 어떻게 할까: 'hit'(쳤어요) · 'found-hit'(공 찾았어요 → 쳤어요) · null(무시)
//  연습 스윙(impact=false) · 그린 위(퍼팅은 [홀에 넣었어요]로) · 라운드 아님 → 무시
export function swingAction({ impact, inRound, onGreen, liveShot, sinceShotMs }) {
  if (!impact || !inRound || onGreen) return null;
  if (liveShot) return sinceShotMs > 20000 ? 'found-hit' : null; // 친 지 20초 안 = 같은 샷의 피니시·재감지
  return 'hit';
}
