import SwiftUI

/// ⌚ PinPoint 워치 (watchOS): 아이폰이 보낸 한 줄 + [라운드 시작] 버튼 하나 + 이번 라운드 샷 수
@main
struct PinpointWatchApp: App {
    @StateObject private var monitor = SwingMonitor()
    var body: some Scene {
        WindowGroup { ContentView().environmentObject(monitor) }
    }
}

struct ContentView: View {
    @EnvironmentObject var m: SwingMonitor
    var body: some View {
        VStack(spacing: 8) {
            Text(m.info).font(.system(size: 17, weight: .bold)).multilineTextAlignment(.center).minimumScaleFactor(0.7)
            Text(m.running ? "⌚ 스윙 감지 중 · 샷 \(m.shots)" + (m.last.isEmpty ? "" : "\n\(m.last)") : "스윙 감지 꺼짐")
                .font(.system(size: 13)).foregroundColor(Color(red: 0.78, green: 0.95, blue: 0.41)).multilineTextAlignment(.center)
            Button(m.running ? "그만 듣기" : "🏌️ 라운드 시작") { m.toggle() }
                .tint(m.running ? .gray : Color(red: 0.78, green: 0.95, blue: 0.41))
        }
        .padding(.horizontal, 6)
    }
}
