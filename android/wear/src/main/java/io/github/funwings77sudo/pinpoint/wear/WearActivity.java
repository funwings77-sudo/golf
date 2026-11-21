package io.github.funwings77sudo.pinpoint.wear;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import java.nio.charset.StandardCharsets;

/**
 * 워치 화면: 휴대폰이 보내 준 한 줄(깃발까지 · 추천 클럽) + 스윙 감지 켜기/끄기 + 이번 라운드 샷 수
 * 둥근 화면에 맞춰 가운데 정렬 · 큰 글씨 · 버튼 하나
 */
public class WearActivity extends Activity implements MessageClient.OnMessageReceivedListener {
    public static final String PATH_INFO = "/pinpoint/info";
    private static String info = "휴대폰에서 PinPoint 골프 치기를 열어 주세요";
    private TextView infoV, statusV;
    private Button btn;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(28, 28, 28, 28);
        root.setBackgroundColor(Color.parseColor("#0F1B14"));
        infoV = new TextView(this); infoV.setTextColor(Color.WHITE); infoV.setTextSize(17); infoV.setTypeface(Typeface.DEFAULT_BOLD); infoV.setGravity(Gravity.CENTER);
        statusV = new TextView(this); statusV.setTextColor(Color.parseColor("#C8F169")); statusV.setTextSize(13); statusV.setGravity(Gravity.CENTER); statusV.setPadding(0, 8, 0, 10);
        btn = new Button(this); btn.setAllCaps(false); btn.setTextSize(15); btn.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(infoV); root.addView(statusV); root.addView(btn, new LinearLayout.LayoutParams(-1, 110));
        setContentView(root);
        btn.setOnClickListener(v -> toggle());
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
    }

    private void toggle() {
        Intent i = new Intent(this, SwingService.class);
        if (SwingService.running) stopService(i); else startForegroundService(i);
        infoV.postDelayed(this::show, 300);
    }

    private void show() {
        runOnUiThread(() -> {
            infoV.setText(info);
            boolean on = SwingService.running;
            statusV.setText(on ? "⌚ 스윙 감지 중 · 샷 " + SwingService.shots + (SwingService.last.isEmpty() ? "" : "\n" + SwingService.last) : "스윙 감지 꺼짐");
            btn.setText(on ? "그만 듣기" : "🏌️ 라운드 시작");
            GradientDrawable bg = new GradientDrawable(); bg.setCornerRadius(60);
            bg.setColor(on ? Color.parseColor("#33FFFFFF") : Color.parseColor("#C8F169"));
            btn.setBackground(bg); btn.setTextColor(on ? Color.WHITE : Color.parseColor("#0E1410"));
        });
    }

    @Override
    public void onMessageReceived(MessageEvent e) {
        if (PATH_INFO.equals(e.getPath())) { info = new String(e.getData(), StandardCharsets.UTF_8); show(); }
    }

    @Override protected void onResume() { super.onResume(); Wearable.getMessageClient(this).addListener(this); SwingService.onChange = this::show; show(); }
    @Override protected void onPause() { super.onPause(); Wearable.getMessageClient(this).removeListener(this); SwingService.onChange = null; }
}
