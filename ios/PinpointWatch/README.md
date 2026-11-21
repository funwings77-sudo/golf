# ⌚ PinPoint 워치 (애플워치)

손목 센서로 스윙과 임팩트를 알아채서 아이폰 PinPoint 앱에 **[쳤어요]**를 저절로 눌러 줍니다. 빈 스윙(연습 스윙)과 퍼팅은 기록하지 않습니다. 감지 규칙은 갤럭시워치용 `android/wear/.../SwingDetector.java`와 같습니다. 안드로이드 쪽에는 단위 테스트가 있습니다.

이 폴더의 소스는 아직 Xcode 프로젝트에 **워치 타깃으로 들어가 있지 않습니다.** 워치 타깃은 Xcode에서만 만들 수 있어서, 맥에서 한 번 아래처럼 추가해 주세요.

1. `npx cap sync ios`를 실행한 뒤 `ios/App/App.xcworkspace`를 Xcode로 엽니다.
2. **File → New → Target → watchOS → App**을 고릅니다.
   - Product Name: `PinpointWatch`
   - Interface: SwiftUI
   - "Watch App for Existing iOS App"을 고르고 `App`을 연결합니다.
3. Xcode가 만든 `PinpointWatchApp.swift`와 `ContentView.swift`를 지웁니다. 이 폴더의 `PinpointWatchApp.swift`, `SwingMonitor.swift`, `SwingDetector.swift`를 워치 타깃에 추가합니다.
4. 워치 타깃 설정:
   - **Signing & Capabilities → + HealthKit**을 추가합니다. 화면이 꺼져도 센서를 듣도록 '골프' 운동 세션을 씁니다.
   - **Info**에 `NSHealthShareUsageDescription`과 `NSHealthUpdateUsageDescription`을 넣습니다. 문구 예: "라운드 동안 손목 센서로 스윙을 감지하려고 운동 세션을 써요"
   - **Info**에 `WKBackgroundModes` = `workout-processing`을 넣습니다.
5. 아이폰 앱 쪽 `WatchPlugin.swift`는 이미 App 타깃에 들어가 있습니다. `PinpointViewController`에 등록되어 있어서 따로 할 일은 없습니다.

## 쓰는 법
1. 워치에서 PinPoint 워치를 열고 **🏌️ 라운드 시작**을 누릅니다.
2. 아이폰에서 골프 치기를 엽니다. 워치 화면에 "1번 홀 · 깃발까지 142m · 7번 아이언"이 보입니다.
3. 치면 워치가 톡 진동하고, 아이폰에 [쳤어요]가 저절로 적힙니다. 공을 찾으러 가는 중에 다음 샷을 치면 [공 찾았어요] → [쳤어요]가 한 번에 적힙니다.
4. 잘못 적혔으면 아이폰에서 **[잘못 눌렀어요]**를 누릅니다. 이 기능은 설정 → "⌚ 워치가 스윙을 알아채면 저절로 [쳤어요]"에서 끌 수 있습니다.
