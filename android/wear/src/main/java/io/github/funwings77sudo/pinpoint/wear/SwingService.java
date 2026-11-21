package io.github.funwings77sudo.pinpoint.wear;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * 라운드 동안 손목 센서(자이로 · 선형 가속도)를 100Hz로 듣고, 스윙을 알아채면 휴대폰 앱에 "/pinpoint/swing" 메시지.
 * 화면이 꺼져도 돌도록 포그라운드 서비스 + 부분 wake lock (최대 6시간).
 */
public class SwingService extends Service implements SensorEventListener {
    public static final String PATH_SWING = "/pinpoint/swing";
    static volatile boolean running = false;
    static volatile int shots = 0, practice = 0;
    static volatile String last = "";
    static Runnable onChange = null;

    private SensorManager sm;
    private PowerManager.WakeLock wl;
    private final SwingDetector det = new SwingDetector();

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel("swing", "스윙 감지", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, WearActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, "swing").setContentTitle("PinPoint 스윙 감지 중")
            .setContentText("치면 휴대폰에 저절로 적어요").setSmallIcon(android.R.drawable.ic_menu_compass).setContentIntent(open).setOngoing(true).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(7, n);
        if (!running) {
            sm = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
            Sensor g = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE), a = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION);
            if (g != null) sm.registerListener(this, g, 10000);
            if (a != null) sm.registerListener(this, a, 10000);
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pinpoint:swing");
            wl.acquire(6 * 3600 * 1000L);
            running = true; shots = 0; practice = 0; last = "";
            changed();
        }
        return START_STICKY;
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        long t = SystemClock.elapsedRealtime();
        float m = (float) Math.sqrt(e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2]);
        if (e.sensor.getType() == Sensor.TYPE_LINEAR_ACCELERATION) { det.onAccel(t, m); return; }
        SwingDetector.Swing s = det.onGyro(t, m);
        if (s == null) return;
        if (s.impact) shots++; else practice++;
        last = s.impact ? "샷 " + shots + " 기록" : "연습 스윙 (기록 안 함)";
        changed();
        if (s.impact) buzz();
        String json = String.format(Locale.US, "{\"type\":\"swing\",\"ts\":%d,\"impact\":%b,\"peakGyro\":%.1f,\"peakJerk\":%.1f}",
            System.currentTimeMillis(), s.impact, s.peakGyro, s.peakJerk);
        send(json.getBytes(StandardCharsets.UTF_8));
    }

    private void send(byte[] data) {
        Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
            for (Node node : nodes) Wearable.getMessageClient(this).sendMessage(node.getId(), PATH_SWING, data);
        });
    }
    private void buzz() {
        Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (v != null) v.vibrate(VibrationEffect.createOneShot(80, VibrationEffect.DEFAULT_AMPLITUDE));
    }
    private static void changed() { Runnable r = onChange; if (r != null) r.run(); }

    @Override public void onAccuracyChanged(Sensor s, int a) { }
    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (sm != null) sm.unregisterListener(this);
        if (wl != null && wl.isHeld()) wl.release();
        running = false; changed();
    }
}
