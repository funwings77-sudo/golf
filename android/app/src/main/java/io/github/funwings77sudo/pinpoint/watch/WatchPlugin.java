package io.github.funwings77sudo.pinpoint.watch;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * ⌚ 워치 연동 (Wear OS): 워치 앱(android/wear)이 보낸 스윙을 JS 'swing' 이벤트로, JS 한 줄 안내를 워치 화면으로.
 * JS: window.Capacitor.Plugins.PinpointWatch (js/core/watch.js)
 *  available() → { ok, watches }   send({ text }) → { ok, sent }   이벤트 'swing' { ts, impact, peakGyro, peakJerk }
 */
@CapacitorPlugin(name = "PinpointWatch")
public class WatchPlugin extends Plugin implements MessageClient.OnMessageReceivedListener {
    static final String PATH_SWING = "/pinpoint/swing", PATH_INFO = "/pinpoint/info";

    @Override
    public void load() {
        try { Wearable.getMessageClient(getContext()).addListener(this); } catch (Exception ignored) { } // 구글 플레이 서비스가 없는 폰
    }

    @Override
    protected void handleOnDestroy() {
        try { Wearable.getMessageClient(getContext()).removeListener(this); } catch (Exception ignored) { }
    }

    @Override
    public void onMessageReceived(MessageEvent e) {
        if (!PATH_SWING.equals(e.getPath())) return;
        try { notifyListeners("swing", new JSObject(new String(e.getData(), StandardCharsets.UTF_8)), true); }
        catch (Exception ignored) { }
    }

    private List<Node> nodes() throws Exception { return Tasks.await(Wearable.getNodeClient(getContext()).getConnectedNodes()); }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject o = new JSObject();
        try { int n = nodes().size(); o.put("ok", n > 0); o.put("watches", n); }
        catch (Exception e) { o.put("ok", false); o.put("watches", 0); o.put("reason", String.valueOf(e.getMessage())); }
        call.resolve(o);
    }

    @PluginMethod
    public void send(PluginCall call) {
        byte[] data = call.getString("text", "").getBytes(StandardCharsets.UTF_8);
        int sent = 0;
        try {
            MessageClient mc = Wearable.getMessageClient(getContext());
            for (Node n : nodes()) { mc.sendMessage(n.getId(), PATH_INFO, data); sent++; }
        } catch (Exception ignored) { }
        JSObject o = new JSObject(); o.put("ok", sent > 0); o.put("sent", sent);
        call.resolve(o);
    }
}
