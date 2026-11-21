// 🗺️ 앱(APK)에 기본으로 넣는 구글 지도 키 — 저장소에는 늘 빈 값
//  APK를 만들 때 scripts/build-www.mjs가 local.keys.json(Git 제외)의 키로 빌드 복사본(www/)만 바꿔 씀
//  웹 버전(GitHub Pages)은 이 빈 값 그대로라 Esri 지도 · 설정에서 직접 넣은 키가 있으면 그게 먼저
export const BUILT_IN_MAPS_KEY = '';
