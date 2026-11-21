package io.github.funwings77sudo.pinpoint.wear;

import static org.junit.Assert.*;
import org.junit.Test;

public class SwingDetectorTest {
    // 100Hz로 스윙 하나 흉내: 0.25초 동안 손목 회전이 빨라졌다 느려짐, impact면 가운데에서 가속도가 튐
    private SwingDetector.Swing run(SwingDetector d, long t0, float peak, boolean impact, int afterMs) {
        SwingDetector.Swing out = null;
        for (int i = 0; i < 25 + afterMs / 10; i++) {
            long t = t0 + i * 10L;
            float g = i < 25 ? (float) (peak * Math.sin(Math.PI * i / 25.0)) : 0.5f;
            float a = 8f + (i < 25 ? g : 0) + (impact && i == 12 ? 70f : 0f);
            d.onAccel(t, a);
            SwingDetector.Swing s = d.onGyro(t, g);
            if (s != null) out = s;
        }
        return out;
    }

    @Test public void fullSwingWithImpact() {
        SwingDetector.Swing s = run(new SwingDetector(), 1000, 30f, true, 400);
        assertNotNull(s); assertTrue(s.impact); assertTrue(s.peakGyro > 25f);
    }

    @Test public void practiceSwingHasNoImpact() {
        SwingDetector.Swing s = run(new SwingDetector(), 1000, 30f, false, 400);
        assertNotNull(s); assertFalse(s.impact);
    }

    @Test public void puttIsIgnored() {
        assertNull(run(new SwingDetector(), 1000, 4f, true, 400));
    }

    @Test public void refractoryThenNextSwing() {
        SwingDetector d = new SwingDetector();
        assertNotNull(run(d, 1000, 30f, true, 300));
        assertNull("피니시 동작은 무시", run(d, 1700, 30f, true, 300));
        assertNotNull("4초 뒤 다음 샷", run(d, 7000, 30f, true, 300));
    }
}
