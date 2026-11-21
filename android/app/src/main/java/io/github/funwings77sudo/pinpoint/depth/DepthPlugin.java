package io.github.funwings77sudo.pinpoint.depth;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Session;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;

/**
 * 📏 깊이 카메라 (ARCore): 공·홀을 찍어 거리(cm)·고저차를 재고, 그린을 비춰 높이 점들을 모음.
 * JS: window.Capacitor.Plugins.PinpointDepth (js/core/depth.js)
 *  available() → { ok, kind: 'depth' | 'plane' | 'none', reason, needsInstall }
 *  measure({ scan }) → { ok, kind, ball, hole, points: [x,y,z,…], frames } (월드 좌표, y 위쪽, m)
 */
@CapacitorPlugin(name = "PinpointDepth")
public class DepthPlugin extends Plugin {

    @PluginMethod
    public void available(PluginCall call) {
        JSObject o = new JSObject();
        if (Build.VERSION.SDK_INT < 24) {
            o.put("ok", false); o.put("kind", "none"); o.put("reason", "android-too-old");
            call.resolve(o); return;
        }
        try {
            ArCoreApk.Availability a = ArCoreApk.getInstance().checkAvailability(getContext());
            for (int i = 0; i < 15 && a.isTransient(); i++) { // 처음 확인은 잠깐 걸릴 수 있음 (플러그인 스레드라 기다려도 화면은 안 멈춤)
                Thread.sleep(200);
                a = ArCoreApk.getInstance().checkAvailability(getContext());
            }
            if (!a.isSupported()) {
                o.put("ok", false); o.put("kind", "none"); o.put("reason", "unsupported");
                call.resolve(o); return;
            }
            String kind = "plane";
            boolean installed = a == ArCoreApk.Availability.SUPPORTED_INSTALLED;
            if (installed) {
                Session s = null;
                try {
                    s = new Session(getContext());
                    if (s.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) kind = "depth";
                } catch (Exception ignored) {
                } finally { if (s != null) s.close(); }
            }
            o.put("ok", true); o.put("kind", kind); o.put("needsInstall", !installed); o.put("reason", "");
        } catch (Exception e) {
            o.put("ok", false); o.put("kind", "none"); o.put("reason", String.valueOf(e.getMessage()));
        }
        call.resolve(o);
    }

    @PluginMethod
    public void measure(PluginCall call) {
        Intent i = new Intent(getContext(), DepthActivity.class);
        i.putExtra("scan", call.getBoolean("scan", true));
        i.putExtra("survey", call.getBoolean("survey", false)); // 🛰️ 그린 전체 측량
        startActivityForResult(call, i, "onMeasureResult");
    }

    @ActivityCallback
    private void onMeasureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        File f = new File(getContext().getCacheDir(), DepthActivity.RESULT_FILE);
        if (result.getResultCode() != Activity.RESULT_OK || !f.exists()) {
            JSObject o = new JSObject(); o.put("ok", false); o.put("cancelled", true);
            String err = result.getData() != null ? result.getData().getStringExtra("error") : null;
            if (err != null) o.put("error", err);
            call.resolve(o); return;
        }
        try {
            // 점이 많아 Intent(1MB 제한) 대신 캐시 파일로 받음
            String json = readAll(f); // Files.readAllBytes는 Android 8+ 전용이라 직접 읽음
            f.delete();
            call.resolve(new JSObject(json));
        } catch (Exception e) {
            call.reject("결과를 읽지 못했어요: " + e.getMessage());
        }
    }

    private static String readAll(File f) throws Exception {
        try (FileInputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[64 * 1024]; int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return out.toString("UTF-8");
        }
    }
}
