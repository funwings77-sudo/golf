package io.github.funwings77sudo.pinpoint.screen;

import android.app.Activity;
import android.view.View;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.github.funwings77sudo.pinpoint.MainActivity;

// 📱 완전 전체 화면(몰입 모드): 상단 상태바·하단 내비게이션 바를 숨김 (가장자리를 쓸어내리면 잠깐 보임)
//   JS: Capacitor.Plugins.PinpointScreen.immersive({ on: true|false }) → { cutTop: 펀치홀/노치 높이(CSS px) }
@CapacitorPlugin(name = "PinpointScreen")
public class ScreenPlugin extends Plugin {
    @PluginMethod
    public void immersive(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            if (a instanceof MainActivity) ((MainActivity) a).setImmersive(on);
            View root = a.findViewById(android.R.id.content);
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(a.getWindow(), root);
            if (on) {
                c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                c.show(WindowInsetsCompat.Type.systemBars());
            }
            ViewCompat.requestApplyInsets(root);
            WindowInsetsCompat w = ViewCompat.getRootWindowInsets(root);
            float d = a.getResources().getDisplayMetrics().density;
            int top = w != null ? w.getInsets(WindowInsetsCompat.Type.displayCutout()).top : 0;
            JSObject r = new JSObject();
            r.put("on", on);
            r.put("cutTop", top / d);
            call.resolve(r);
        });
    }
}
