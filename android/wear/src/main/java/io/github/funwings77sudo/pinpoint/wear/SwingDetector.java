package io.github.funwings77sudo.pinpoint.wear;

/**
 * 손목 센서로 골프 스윙 알아채기 (휴대폰과 상관없는 순수 계산 · 단위 테스트 있음)
 *  · 스윙: 손목 회전 속도(자이로 크기)가 SWING_RAD 넘는 구간이 MIN_SWING_MS 이상
 *  · 임팩트(공을 맞힘): 회전이 가장 빠른 순간 ±IMPACT_WIN_MS 안에서 가속도가 한 번에 크게 튐(jerk)
 *    → 빈 스윙(연습 스윙)은 튐이 작아 impact=false
 *  · 퍼팅처럼 느린 스윙은 SWING_RAD에 못 미쳐 무시
 *  · 한 번 알아채면 REFRACTORY_MS 동안 쉼 (피니시·클럽 내려놓기 무시)
 */
public class SwingDetector {
    public static final float SWING_RAD = 9f;          // rad/s (약 520°/s)
    public static final long MIN_SWING_MS = 60;
    public static final long IMPACT_WIN_MS = 120;
    public static final float IMPACT_JERK = 35f;       // 한 샘플 사이 가속도 변화 (m/s²)
    public static final long REFRACTORY_MS = 4000;

    public static class Swing {
        public final long tMs; public final float peakGyro, peakJerk; public final boolean impact;
        Swing(long t, float g, float j, boolean i) { tMs = t; peakGyro = g; peakJerk = j; impact = i; }
    }

    private long swingStart = -1, peakT = 0, lastSwing = -REFRACTORY_MS * 2, endT = -1;
    private float peakGyro = 0, prevAcc = Float.NaN;
    // 최근 가속도 튐 기록 (원형 버퍼)
    private final long[] jt = new long[64];
    private final float[] jv = new float[64];
    private int jn = 0;

    /** 가속도 크기 (중력 뺀 선형 가속도, m/s²) */
    public void onAccel(long tMs, float mag) {
        if (!Float.isNaN(prevAcc)) { jt[jn % 64] = tMs; jv[jn % 64] = Math.abs(mag - prevAcc); jn++; }
        prevAcc = mag;
    }

    /** 자이로 크기 (rad/s) → 스윙이 끝난 순간 Swing, 아니면 null */
    public Swing onGyro(long tMs, float mag) {
        if (tMs - lastSwing < REFRACTORY_MS) return null;
        if (mag >= SWING_RAD) {
            if (swingStart < 0) { swingStart = tMs; peakGyro = 0; }
            if (mag > peakGyro) { peakGyro = mag; peakT = tMs; }
            endT = -1;
            return null;
        }
        if (swingStart < 0) return null;
        // 빠른 구간이 끝남: 임팩트 판정을 위해 IMPACT_WIN_MS만큼 더 기다림
        if (endT < 0) endT = tMs;
        if (tMs - endT < IMPACT_WIN_MS) return null;
        long dur = endT - swingStart;
        swingStart = -1; endT = -1;
        if (dur < MIN_SWING_MS) return null;
        float jerk = 0;
        for (int i = Math.max(0, jn - 64); i < jn; i++) {
            if (Math.abs(jt[i % 64] - peakT) <= IMPACT_WIN_MS && jv[i % 64] > jerk) jerk = jv[i % 64];
        }
        lastSwing = tMs;
        return new Swing(peakT, peakGyro, jerk, jerk >= IMPACT_JERK);
    }
}
