import UIKit
import Capacitor

/// 앱 안 플러그인 등록 (Capacitor 6: 저장소 안에 있는 플러그인은 여기서 직접 등록)
/// Main.storyboard의 첫 화면이 이 클래스를 씀
class PinpointViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DepthPlugin())  // 📏 LiDAR
        bridge?.registerPluginInstance(WatchPlugin())  // ⌚ 애플워치
        bridge?.registerPluginInstance(AudioPlugin())  // 🎧 음성 안내 · 이어폰
    }
}
