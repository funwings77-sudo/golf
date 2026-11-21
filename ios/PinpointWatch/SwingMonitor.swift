import Foundation
import CoreMotion
import HealthKit
import WatchConnectivity
import WatchKit

/// 라운드 동안 손목 센서(100Hz)를 듣고 스윙을 아이폰 앱에 보냄.
/// 손목을 내려도 앱이 멈추지 않도록 '골프' 운동 세션(HKWorkoutSession)을 켬 — 애플워치 골프 앱들이 쓰는 방식
final class SwingMonitor: NSObject, ObservableObject, WCSessionDelegate, HKWorkoutSessionDelegate {
    @Published var running = false
    @Published var shots = 0
    @Published var last = ""
    @Published var info = "아이폰에서 PinPoint 골프 치기를 열어 주세요"

    private let motion = CMMotionManager()
    private let queue = OperationQueue()
    private let detector = SwingDetector()
    private let health = HKHealthStore()
    private var workout: HKWorkoutSession?

    override init() {
        super.init()
        if WCSession.isSupported() { WCSession.default.delegate = self; WCSession.default.activate() }
    }

    func toggle() { running ? stop() : start() }

    func start() {
        guard motion.isDeviceMotionAvailable else { last = "이 워치는 움직임 센서를 쓸 수 없어요"; return }
        startWorkout()
        motion.deviceMotionUpdateInterval = 1.0 / 100.0
        queue.maxConcurrentOperationCount = 1
        motion.startDeviceMotionUpdates(to: queue) { [weak self] m, _ in
            guard let self, let m else { return }
            let t = Int64(m.timestamp * 1000)
            let r = m.rotationRate, a = m.userAcceleration // a: g 단위
            self.detector.onAccel(t, 9.81 * (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot())
            if let s = self.detector.onGyro(t, (r.x * r.x + r.y * r.y + r.z * r.z).squareRoot()) { self.report(s) }
        }
        running = true; shots = 0; last = ""
    }

    func stop() {
        motion.stopDeviceMotionUpdates()
        workout?.end(); workout = nil
        running = false
    }

    private func report(_ s: Swing) {
        DispatchQueue.main.async {
            if s.impact { self.shots += 1; WKInterfaceDevice.current().play(.click) }
            self.last = s.impact ? "샷 \(self.shots) 기록" : "연습 스윙 (기록 안 함)"
        }
        let msg: [String: Any] = ["type": "swing", "ts": Int64(Date().timeIntervalSince1970 * 1000), "impact": s.impact, "peakGyro": s.peakGyro, "peakJerk": s.peakJerk]
        let ws = WCSession.default
        if ws.isReachable { ws.sendMessage(msg, replyHandler: nil) { _ in ws.transferUserInfo(msg) } }
        else { ws.transferUserInfo(msg) } // 아이폰이 잠깐 안 보이면 나중에라도 전달
    }

    // 골프 운동 세션: 화면이 꺼져도 센서를 계속 받음 (건강 앱 권한 필요)
    private func startWorkout() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let cfg = HKWorkoutConfiguration(); cfg.activityType = .golf; cfg.locationType = .outdoor
        health.requestAuthorization(toShare: [HKObjectType.workoutType()], read: nil) { _, _ in
            DispatchQueue.main.async {
                guard let w = try? HKWorkoutSession(healthStore: self.health, configuration: cfg) else { return }
                w.delegate = self; w.startActivity(with: Date()); self.workout = w
            }
        }
    }
    func workoutSession(_ s: HKWorkoutSession, didChangeTo to: HKWorkoutSessionState, from: HKWorkoutSessionState, date: Date) {}
    func workoutSession(_ s: HKWorkoutSession, didFailWithError error: Error) {}

    // 아이폰 → 워치 한 줄 (깃발까지 · 추천 클럽)
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { show(message) }
    func session(_ session: WCSession, didReceiveApplicationContext ctx: [String: Any]) { show(ctx) }
    private func show(_ m: [String: Any]) { if let t = m["info"] as? String { DispatchQueue.main.async { self.info = t } } }
    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        if let t = session.receivedApplicationContext["info"] as? String { DispatchQueue.main.async { self.info = t } }
    }
}

