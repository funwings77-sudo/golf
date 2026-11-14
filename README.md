# PinPoint AI 캐디 (PWA)

기획서 「아마추어 골퍼 필드 페인포인트 정밀 분석 & 올인원 AI 캐디 앱 기획」을 구현한 오프라인 우선 모바일 웹앱입니다.

**배포 주소: https://funwings77-sudo.github.io/golf/** (GitHub Pages, `main` 브랜치에 푸시하면 자동 재배포)
휴대폰에서 열고 "홈 화면에 추가"하면 앱처럼 쓸 수 있습니다.

**Android 앱 다운로드 페이지: https://funwings77-sudo.github.io/golf/download.html** (APK 직접: [pinpoint-caddie.apk](https://funwings77-sudo.github.io/golf/pinpoint-caddie.apk)) (디버그 서명, 설치 시 "출처를 알 수 없는 앱" 허용 필요 · 재빌드+업로드: `npm run release:apk`)

## 실행
```
npm start          # http://localhost:8080
npm test           # 엔진 단위 테스트 15개
```
휴대폰의 GPS·나침반·기울기 센서·카메라는 **HTTPS**에서만 동작합니다. 폴더를 그대로 GitHub Pages / Netlify / Cloudflare Pages 등에 올리고 휴대폰에서 열어 "홈 화면에 추가"하세요. 실내 테스트는 설정 → GPS 시뮬레이션 + 홈 → 데모 코스.

## 기능 ↔ 기획서
| 기획서 | 구현 위치 |
|---|---|
| ① 공↔홀컵 거리 (GNSS·핀·플레이즈라이크) | `views/distance.js`, `core/sensors.js`(칼만), `core/weather.js` |
| ② 라이 경사 (접촉 모드 ±0.3°, 셋업 안내) | `views/lie.js` |
| ③ 그린 위 거리 (걸음·카메라 탭·GPS) | `views/green.js`, `core/camera.js` |
| ④ 그린 경사 지도 (사전 격자 + 현장 융합) | `physics/putt.js`, `views/greencanvas.js` |
| ⑤ 퍼팅 라인·세기·백스윙 (물리 역문제 + 몬테카를로) | `physics/putt.js`, `putt.worker.js` |
| ⑥ 티샷 클럽·조준 (3DOF 탄도 + 기대 타수) | `physics/flight.js`, `physics/strategy.js`, `views/tee.js` |
| ⑦ 분실구 (낙하 확률 → 레이더 → 카메라 탐지) | `physics/lostball.js`, `views/lost.js` |
| 토너먼트/캐주얼/연습 모드 (규칙 4.3a) | `core/state.js` `allowed()` |
| 룰·구제, 스코어·내기 정산, 낙뢰·폭염, 내 백 갭 분석, 공 소모, 입문자 가이드, 음성 | `views/rules.js`, `score.js`, `safety.js`, `bag.js` |

## 한계 (웹 플랫폼)
- 브라우저는 LiDAR·ARCore Depth에 접근 불가 → 기획서의 Tier 2~3 방식(기울기 센서 + 사전 그린맵, 카메라 지면 투영 1탭 보정)으로 구현. 결과마다 신뢰도 표시.
- 실제 골프장 그린맵·실시간 핀 API·서버 동기화는 제휴/백엔드 영역이라 미포함. 코스는 위성지도에서 직접 지정하거나 JSON으로 공유. 데모 코스·그린은 가상 데이터.
