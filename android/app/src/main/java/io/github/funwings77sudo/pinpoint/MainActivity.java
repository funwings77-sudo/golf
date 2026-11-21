package io.github.funwings77sudo.pinpoint;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import io.github.funwings77sudo.pinpoint.depth.DepthPlugin;
import io.github.funwings77sudo.pinpoint.watch.WatchPlugin;
import io.github.funwings77sudo.pinpoint.audio.AudioPlugin;

public class MainActivity extends BridgeActivity {
    // Android 15+ (targetSdk 35 이상)은 화면이 상태바·내비게이션 바 밑까지 그려짐(edge-to-edge 강제).
    // 웹 화면이 시스템 바에 가려지지 않도록 바 높이만큼 여백을 주고, 여백은 앱 상단바 색으로 칠한다.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DepthPlugin.class); // 📏 깊이 카메라 (앱 안 플러그인은 super.onCreate 전에 등록)
        registerPlugin(WatchPlugin.class); // watch swing events
        registerPlugin(AudioPlugin.class); // 🎧 음성 안내 · 이어폰
        super.onCreate(savedInstanceState);
        View root = findViewById(android.R.id.content);
        root.setBackgroundColor(Color.parseColor("#0f1b14"));
        WindowCompat.getInsetsController(getWindow(), root).setAppearanceLightStatusBars(false);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
