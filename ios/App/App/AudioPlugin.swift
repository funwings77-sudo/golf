import Foundation
import Capacitor
import AVFoundation
import MediaPlayer
import UIKit

/// 🎧 음성 안내 · 이어폰 (에어팟·블루투스 · 유선) — 안드로이드 AudioPlugin.java와 같은 모양
/// JS: window.Capacitor.Plugins.PinpointAudio (js/core/voice.js)
@objc(AudioPlugin)
public class AudioPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "AudioPlugin"
    public let jsName = "PinpointAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "route", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buttons", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openBluetooth", returnType: CAPPluginReturnPromise),
    ]
    private let synth = AVSpeechSynthesizer()
    private var clicks = 0
    private var flush: DispatchWorkItem?
    private var buttonsOn = false

    override public func load() {
        synth.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
    }

    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let rate = Float(call.getDouble("rate") ?? 1)
        let s = AVAudioSession.sharedInstance()
        // 안내 음성: 음악은 잠깐 작게, 에어팟·블루투스·유선 이어폰이 있으면 그쪽으로
        try? s.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? s.setActive(true)
        DispatchQueue.main.async {
            if call.getBool("flush") ?? true { self.synth.stopSpeaking(at: .immediate) }
            let u = AVSpeechUtterance(string: text)
            u.voice = AVSpeechSynthesisVoice(language: "ko-KR")
            u.rate = max(AVSpeechUtteranceMinimumSpeechRate, min(AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * rate))
            self.synth.speak(u)
            call.resolve(["ok": true])
        }
    }
    public func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) {
        if !s.isSpeaking && !buttonsOn { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }

    @objc func stop(_ call: CAPPluginCall) { DispatchQueue.main.async { self.synth.stopSpeaking(at: .immediate) }; call.resolve() }
    @objc func available(_ call: CAPPluginCall) { var o = routeObj(); o["ok"] = true; call.resolve(o) }
    @objc func route(_ call: CAPPluginCall) { call.resolve(routeObj()) }
    @objc func routeChanged() { notifyListeners("route", data: routeObj()) }

    private func routeObj() -> [String: Any] {
        for o in AVAudioSession.sharedInstance().currentRoute.outputs {
            switch o.portType {
            case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP: return ["kind": "bluetooth", "name": o.portName]
            case .headphones: return ["kind": "wired", "name": o.portName]
            case .usbAudio: return ["kind": "usb", "name": o.portName]
            default: continue
            }
        }
        return ["kind": "speaker", "name": "휴대폰 스피커"]
    }

    // 이어폰 버튼 (에어팟 꾹 누르기 · 유선 이어폰 가운데 버튼): 1·2·3번 누름
    @objc func buttons(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? true
        DispatchQueue.main.async {
            let c = MPRemoteCommandCenter.shared()
            let cmds = [c.togglePlayPauseCommand, c.playCommand, c.pauseCommand, c.nextTrackCommand]
            cmds.forEach { $0.removeTarget(nil) }
            self.buttonsOn = on
            if on {
                try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .voicePrompt, options: [.mixWithOthers])
                try? AVAudioSession.sharedInstance().setActive(true)
                cmds.forEach { $0.isEnabled = true; $0.addTarget { [weak self] _ in self?.click(); return .success } }
                MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: "PinPoint 캐디 음성 안내"]
                UIApplication.shared.beginReceivingRemoteControlEvents()
            } else {
                MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
                UIApplication.shared.endReceivingRemoteControlEvents()
            }
            call.resolve()
        }
    }
    private func click() {
        clicks += 1
        flush?.cancel()
        let w = DispatchWorkItem { [weak self] in guard let self else { return }; self.notifyListeners("button", data: ["count": self.clicks]); self.clicks = 0 }
        flush = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.65, execute: w)
    }

    // 아이폰은 블루투스 설정을 직접 열 수 없어 앱 설정을 엶 (제어 센터에서 연결)
    @objc func openBluetooth(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
            call.resolve(["ok": false, "reason": "ios"])
        }
    }
}
