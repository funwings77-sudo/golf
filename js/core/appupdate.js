// 설치형 앱(APK) 새 버전 알림: 배포 사이트의 apk.json과 내 버전을 비교
//  웹(브라우저)은 서비스 워커가 자동으로 최신 파일을 받으므로 확인하지 않음
import { APP_VERSION } from './appver.js';

export const SITE = 'https://funwings77-sudo.github.io/golf/';
export const isNative = () => !!globalThis.window?.Capacitor?.isNativePlatform?.();

export async function checkAppUpdate() {
  if (!isNative() || !navigator.onLine) return null;
  try {
    const r = await fetch(SITE + 'apk.json?t=' + Date.now(), { cache: 'no-store' });
    const j = await r.json();
    if (+j.versionCode > APP_VERSION.code) return { name: j.versionName, code: +j.versionCode, mb: (j.bytes / 1048576).toFixed(1), current: APP_VERSION.name };
  } catch {}
  return null;
}

// 업데이트 받기: 휴대폰 기본 브라우저로 다운로드 페이지를 엶 (앱 밖에서 설치)
export function openDownload() {
  const url = SITE + 'download.html#versions';
  // 앱(WebView) 안에서 다른 주소로 이동하면 Capacitor가 휴대폰 기본 브라우저로 열어 줌
  if (isNative()) { location.href = url; return; }
  window.open(url, '_blank');
}
