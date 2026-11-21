package io.github.funwings77sudo.pinpoint.audio;

import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.KeyEvent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

/**
 * 🎧 음성 안내 · 이어폰 (블루투스 · 유선 · USB)
 *  안드로이드 WebView에는 음성 합성(speechSynthesis)이 없어 휴대폰 TTS를 직접 씀.
 *  · speak({ text, rate, flush }) : 내비게이션 안내 소리로 재생 → 음악은 잠깐 작아지고, 연결된 이어폰으로 나감
 *  · route() / 이벤트 'route' : 지금 소리가 나가는 곳 { kind: bluetooth|wired|usb|speaker, name }
 *  · buttons({ on }) / 이벤트 'button' { count } : 이어폰 버튼 1·2·3번 누름
 *  · openBluetooth() : 휴대폰 블루투스 설정 열기 (이어폰 연결)
 * JS: window.Capacitor.Plugins.PinpointAudio (js/core/voice.js)
 */
@CapacitorPlugin(name = "PinpointAudio")
public class AudioPlugin extends Plugin {
    private TextToSpeech tts;
    private volatile boolean ready = false;
    private AudioManager am;
    private AudioFocusRequest focus;
    private MediaSession session;
    private AudioDeviceCallback devCb;
    private final Handler main = new Handler(Looper.getMainLooper());
    private int clicks = 0;
    private final Runnable flushClicks = () -> { JSObject o = new JSObject(); o.put("count", clicks); clicks = 0; notifyListeners("button", o); };
    private final AudioAttributes attrs = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();

    @Override
    public void load() {
        Context c = getContext();
        am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        tts = new TextToSpeech(c, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            int r = tts.setLanguage(Locale.KOREAN);
            ready = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
            tts.setAudioAttributes(attrs);
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { }
            @Override public void onDone(String id) { if (!tts.isSpeaking()) releaseFocus(); }
            @Override public void onError(String id) { releaseFocus(); }
        });
        if (Build.VERSION.SDK_INT >= 23) {
            devCb = new AudioDeviceCallback() {
                @Override public void onAudioDevicesAdded(AudioDeviceInfo[] d) { notifyListeners("route", routeObj()); }
                @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] d) { notifyListeners("route", routeObj()); }
            };
            am.registerAudioDeviceCallback(devCb, main);
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (!ready) { call.reject("not-ready"); return; }
        float rate = call.getFloat("rate", 1f);
        boolean flush = call.getBoolean("flush", true);
        holdFocus();
        tts.setSpeechRate(Math.max(0.5f, Math.min(2f, rate)));
        Bundle p = new Bundle();
        tts.speak(text, flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, p, "pp" + System.nanoTime());
        JSObject o = new JSObject(); o.put("ok", true); call.resolve(o);
    }

    @PluginMethod
    public void stop(PluginCall call) { if (tts != null) tts.stop(); releaseFocus(); call.resolve(); }

    @PluginMethod
    public void available(PluginCall call) { JSObject o = routeObj(); o.put("ok", ready); call.resolve(o); }

    @PluginMethod
    public void route(PluginCall call) { call.resolve(routeObj()); }

    @PluginMethod
    public void buttons(PluginCall call) {
        boolean on = call.getBoolean("on", true);
        main.post(() -> {
            if (on && session == null) {
                session = new MediaSession(getContext(), "PinPointVoice");
                session.setCallback(new MediaSession.Callback() {
                    @Override public boolean onMediaButtonEvent(Intent i) {
                        KeyEvent k = i.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                        if (k == null || k.getAction() != KeyEvent.ACTION_DOWN || k.getRepeatCount() > 0) return true;
                        switch (k.getKeyCode()) {
                            case KeyEvent.KEYCODE_HEADSETHOOK: case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: case KeyEvent.KEYCODE_MEDIA_PLAY:
                            case KeyEvent.KEYCODE_MEDIA_PAUSE: case KeyEvent.KEYCODE_MEDIA_NEXT: click(); return true;
                            default: return super.onMediaButtonEvent(i);
                        }
                    }
                });
                session.setPlaybackState(new PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT)
                    .setState(PlaybackState.STATE_PLAYING, 0, 1f).build());
                session.setActive(true);
            } else if (!on && session != null) { session.release(); session = null; }
        });
        call.resolve();
    }

    @PluginMethod
    public void openBluetooth(PluginCall call) {
        try { getActivity().startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); JSObject o = new JSObject(); o.put("ok", true); call.resolve(o); }
        catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
    }

    private void click() { clicks++; main.removeCallbacks(flushClicks); main.postDelayed(flushClicks, 650); }

    // 소리가 나가는 곳: 블루투스 > 유선 > USB > 휴대폰 스피커
    private JSObject routeObj() {
        JSObject o = new JSObject();
        String kind = "speaker", name = "휴대폰 스피커";
        if (Build.VERSION.SDK_INT >= 23 && am != null) {
            int best = 0;
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int t = d.getType(), rank = 0; String k = null;
                if (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || (Build.VERSION.SDK_INT >= 31 && (t == AudioDeviceInfo.TYPE_BLE_HEADSET || t == AudioDeviceInfo.TYPE_BLE_SPEAKER))) { rank = 3; k = "bluetooth"; }
                else if (t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES) { rank = 2; k = "wired"; }
                else if (t == AudioDeviceInfo.TYPE_USB_HEADSET) { rank = 1; k = "usb"; }
                if (rank > best) { best = rank; kind = k; CharSequence n = d.getProductName(); name = n == null || n.length() == 0 ? k : n.toString(); }
            }
        }
        o.put("kind", kind); o.put("name", name);
        return o;
    }

    private void holdFocus() {
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focus == null) focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs).build();
            am.requestAudioFocus(focus);
        } else am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
    }
    private void releaseFocus() {
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) { if (focus != null) am.abandonAudioFocusRequest(focus); }
        else am.abandonAudioFocus(null);
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) tts.shutdown();
        if (session != null) session.release();
        if (devCb != null && Build.VERSION.SDK_INT >= 23) am.unregisterAudioDeviceCallback(devCb);
    }
}
