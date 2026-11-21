import Foundation
import Capacitor
import WatchConnectivity

/// ⌚ 애플워치 연동: 워치 앱(ios/PinpointWatch)이 보낸 스윙을 JS 'swing' 이벤트로, JS 한 줄 안내를 워치로.
/// JS: window.Capacitor.Plugins.PinpointWatch (js/core/watch.js) — 안드로이드 WatchPlugin.java와 같은 모양
@objc(WatchPlugin)
public class WatchPlugin: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    public let identifier = "WatchPlugin"
    public let jsName = "PinpointWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    @objc func available(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else { call.resolve(["ok": false, "watches": 0]); return }
        let s = WCSession.default
        call.resolve(["ok": s.isPaired && s.isWatchAppInstalled, "watches": s.isPaired ? 1 : 0, "reachable": s.isReachable])
    }

    @objc func send(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { call.resolve(["ok": false, "sent": 0]); return }
        let s = WCSession.default
        if s.isReachable { s.sendMessage(["info": text], replyHandler: nil, errorHandler: nil) }
        else { try? s.updateApplicationContext(["info": text]) } // 워치 앱이 꺼져 있으면 다음에 열 때 보이게
        call.resolve(["ok": true, "sent": 1])
    }

    // 워치 → 휴대폰: { type: "swing", ts, impact, peakGyro, peakJerk }
    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard (message["type"] as? String) == "swing" else { return }
        notifyListeners("swing", data: message, retainUntilConsumed: true)
    }
    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        self.session(session, didReceiveMessage: userInfo)
    }
    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    public func sessionDidBecomeInactive(_ session: WCSession) {}
    public func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }
}
