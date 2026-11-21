import Foundation

/// 손목 센서로 골프 스윙 알아채기 — 안드로이드 워치(android/wear/.../SwingDetector.java)와 같은 규칙
///  · 스윙: 손목 회전 속도가 9 rad/s 넘는 구간이 60ms 이상 · 퍼팅처럼 느린 스윙은 무시
///  · 임팩트: 회전이 가장 빠른 순간 ±120ms 안에서 가속도가 한 번에 35 m/s² 넘게 튐 → 빈 스윙은 impact=false
///  · 한 번 알아채면 4초 쉼
struct Swing { let tMs: Int64; let peakGyro: Double; let peakJerk: Double; let impact: Bool }

final class SwingDetector {
    static let swingRad = 9.0, minSwingMs: Int64 = 60, impactWinMs: Int64 = 120, impactJerk = 35.0, refractoryMs: Int64 = 4000
    private var swingStart: Int64 = -1, peakT: Int64 = 0, lastSwing: Int64 = -8000, endT: Int64 = -1
    private var peakGyro = 0.0, prevAcc = Double.nan
    private var jerks: [(Int64, Double)] = []

    /// 선형 가속도 크기 (m/s²)
    func onAccel(_ t: Int64, _ mag: Double) {
        if !prevAcc.isNaN { jerks.append((t, abs(mag - prevAcc))); if jerks.count > 64 { jerks.removeFirst(jerks.count - 64) } }
        prevAcc = mag
    }

    /// 회전 속도 크기 (rad/s) → 스윙이 끝난 순간 Swing
    func onGyro(_ t: Int64, _ mag: Double) -> Swing? {
        if t - lastSwing < Self.refractoryMs { return nil }
        if mag >= Self.swingRad {
            if swingStart < 0 { swingStart = t; peakGyro = 0 }
            if mag > peakGyro { peakGyro = mag; peakT = t }
            endT = -1
            return nil
        }
        if swingStart < 0 { return nil }
        if endT < 0 { endT = t }
        if t - endT < Self.impactWinMs { return nil }
        let dur = endT - swingStart
        swingStart = -1; endT = -1
        if dur < Self.minSwingMs { return nil }
        let jerk = jerks.filter { abs($0.0 - peakT) <= Self.impactWinMs }.map { $0.1 }.max() ?? 0
        lastSwing = t
        return Swing(tMs: peakT, peakGyro: peakGyro, peakJerk: jerk, impact: jerk >= Self.impactJerk)
    }
}
