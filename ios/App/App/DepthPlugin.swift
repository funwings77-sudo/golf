import Foundation
import Capacitor
import ARKit

/// 📏 깊이 카메라 (아이폰 LiDAR · ARKit): 공·홀을 찍어 거리(cm)·고저차를 재고, 그린을 비춰 높이 점들을 모음.
/// JS: window.Capacitor.Plugins.PinpointDepth (js/core/depth.js) — 안드로이드 DepthPlugin.java와 같은 모양
///  available() → { ok, kind: "lidar" | "plane" | "none", reason }
///  measure({ scan }) → { ok, kind, ball, hole, points: [x,y,z,…], frames } (월드 좌표, y 위쪽, m)
@objc(DepthPlugin)
public class DepthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DepthPlugin"
    public let jsName = "PinpointDepth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "measure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "overlay", returnType: CAPPluginReturnPromise),
    ]

    @objc func available(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.isSupported else {
            call.resolve(["ok": false, "kind": "none", "reason": "unsupported"]); return
        }
        // LiDAR가 있는 기기(아이폰 12 Pro 이상 Pro · 아이패드 Pro)만 sceneDepth를 지원
        let lidar = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        call.resolve(["ok": true, "kind": lidar ? "lidar" : "plane", "reason": "", "needsInstall": false])
    }

    @objc func measure(_ call: CAPPluginCall) {
        let scan = call.getBool("scan") ?? true
        let survey = call.getBool("survey") ?? false // 🛰️ 그린 전체 측량
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else { call.reject("화면을 열 수 없어요"); return }
            let live = call.getBool("live") ?? false, mode = call.getString("mode") ?? "green"
            let vc = DepthViewController(scan: scan, survey: survey, live: live, mode: mode, done: { result in call.resolve(result) },
                                         onScan: { [weak self] r in self?.notifyListeners("scan", data: r, retainUntilConsumed: true) })
            vc.modalPresentationStyle = .fullScreen
            host.present(vc, animated: true)
        }
    }

    // 🔴 실시간 AR 선: 앱이 계산한 선을 열린 AR 화면에
    @objc func overlay(_ call: CAPPluginCall) {
        let data = call.options as? [String: Any] ?? [:]
        DispatchQueue.main.async {
            guard let vc = DepthViewController.current else { call.reject("AR 화면이 닫혀 있어요"); return }
            vc.setOverlay(data); call.resolve()
        }
    }
}
