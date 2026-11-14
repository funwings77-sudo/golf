# PinPoint AI 캐디 (PWA)

기획서 「아마추어 골퍼 필드 페인포인트 정밀 분석 & 올인원 AI 캐디 앱 기획」을 구현한 오프라인 우선 모바일 웹앱입니다.

**배포 주소: https://funwings77-sudo.github.io/golf/** (GitHub Pages, `main` 브랜치에 푸시하면 자동 재배포)
휴대폰에서 열고 "홈 화면에 추가"하면 앱처럼 쓸 수 있습니다.

**Android 앱 다운로드 페이지: https://funwings77-sudo.github.io/golf/download.html** (APK 직접: [pinpoint-caddie.apk](https://funwings77-sudo.github.io/golf/pinpoint-caddie.apk)) (디버그 서명, 설치 시 "출처를 알 수 없는 앱" 허용 필요 · 재빌드+업로드: `npm run release:apk`)

## 실행
```
npm start          # http://localhost:8080
npm test           # 엔진 15개 + 관리자 8개 단위 테스트
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

## 관리자 페이지 (골프장 운영자용)
**https://funwings77-sudo.github.io/golf/admin.html**

서버 없이 **GitHub 저장소를 데이터 저장소로** 씁니다. 관리자가 발행하면 `data/`에 커밋되고(이력·되돌리기·권한은 GitHub가 관리), GitHub Pages로 배포되어 앱(웹·APK)이 읽습니다.

| 메뉴 | 하는 일 | 발행 파일 |
|---|---|---|
| 대시보드 | 코스·오늘 핀·공지·임시저장·리포트 현황, 최근 발행 이력 | — |
| 코스 관리 · 편집 | 위성지도에서 티(블랙·블루·화이트·레드)·그린 앞/중앙/뒤·IP·해저드·대피소 지정·드래그, 좌표 직접 입력, 파·핸디캡·반폭·공략 메모, 로컬 룰, 실시간 검증, 변경 요약 후 발행 | `data/courses/<ID>.json`, `data/catalog.json` |
| 오늘의 핀 | 핀 시트 방식(앞에서 m · 좌우 m) 입력, 지도 드래그, 자동 로테이션(앞·중·뒤 균형, 가장자리 4m 이상), 오늘 그린 스피드, 핀 시트 인쇄 | `data/pins/<ID>.json` |
| 그린맵 | 측량 높이 격자 업로드(JSON · CSV 행렬 · XYZ/위경도 측량점 → 역거리 가중 리샘플), 경사 히트맵·등고선·흐름 미리보기, 경사 통계 | 코스 파일에 포함 |
| 공지 · 안전 | 낙뢰 중단·폭염·카트 도로 등 템플릿, 대상 코스·게시 기간, 긴급 공지는 앱에서 진동·음성 | `data/notices.json` |
| 운영 분석 | 골퍼가 앱에서 내보낸 **비식별 라운드 리포트**로 홀별 진행 시간·병목, 난이도 순위 vs 공식 핸디캡, 분실구 지점 지도, CSV | 브라우저에만 저장 |
| 배포 · 이력 | Pages 배포 상태, 데이터 커밋 이력(감사 로그), APK 버전 | — |

- **연결**: 저장소 협업자가 [세분화 토큰](https://github.com/settings/personal-access-tokens/new)(이 저장소만, *Contents: Read and write*)을 만들어 '연결 설정'에 입력. 토큰은 `api.github.com`으로만 전송되고 기본은 탭을 닫으면 삭제. 토큰 없이는 읽기 전용.
- **동시 편집 안전장치**: 발행 시 편집 시작 때의 파일 버전과 원격을 비교해 다르면 충돌로 막고(낙관적 잠금), 여러 파일은 커밋 1개로 원자적으로 발행.
- **앱 연동**: 코스 관리 → '공식 코스'에서 설치·업데이트, 오늘 날짜의 핀·스팀프 자동 적용(5분마다 확인), 공지는 상단 경보 바·홈, 기록 → 📤 리포트로 골프장 제출.
- 관련 코드: `admin.html`, `css/admin.css`, `js/admin/`(model·github·store·views), 앱 쪽 `js/core/remote.js`, `js/core/report.js`.

## 한계 (웹 플랫폼)
- 브라우저는 LiDAR·ARCore Depth에 접근 불가 → 기획서의 Tier 2~3 방식(기울기 센서 + 사전 그린맵, 카메라 지면 투영 1탭 보정)으로 구현. 결과마다 신뢰도 표시.
- 실제 골프장 그린맵 원천 데이터는 측량사 제휴 영역입니다. 관리자 페이지가 측량 파일(격자·측량점)을 받아 발행하는 경로를 제공합니다. 데모 코스·그린은 가상 데이터.
- 운영 분석은 골퍼가 직접 보낸 리포트 파일만 사용합니다(자동 수집 서버 없음).
