package io.github.funwings77sudo.pinpoint.depth;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.Image;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.Matrix;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.google.ar.core.Anchor;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Camera;
import com.google.ar.core.CameraIntrinsics;
import com.google.ar.core.Config;
import com.google.ar.core.Coordinates2d;
import com.google.ar.core.DepthPoint;
import com.google.ar.core.Frame;
import com.google.ar.core.HitResult;
import com.google.ar.core.Plane;
import com.google.ar.core.Point;
import com.google.ar.core.Pose;
import com.google.ar.core.Session;
import com.google.ar.core.Trackable;
import com.google.ar.core.TrackingState;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;
import java.util.Locale;
import java.lang.ref.WeakReference;
import org.json.JSONArray;
import org.json.JSONObject;
import android.graphics.DashPathEffect;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * 📏 깊이 카메라 화면 (ARCore)
 *  ① ＋를 공에 맞추고 [공 찍기] → ② ＋를 홀에 맞추고 [홀 찍기] → ③ (scan) 공~홀 그린을 천천히 비춤 → 결과
 *  깊이(Depth API)를 쓸 수 있으면 깊이 영상의 점을, 아니면 화면 여러 곳의 바닥 인식(hit test) 점을 모음.
 *  결과는 캐시 파일(RESULT_FILE)로 넘김 (Intent 크기 제한).
 */
public class DepthActivity extends Activity implements GLSurfaceView.Renderer {
    static final String RESULT_FILE = "pinpoint-depth.json";
    private static final int REQ_CAM = 41;
    private static final int MAX_POINTS = 100000;
    private int scanTarget = 45, stride = 3; // 깊이 영상 표본 수 (퍼트: 약 3초 · 측량: 최대 약 1분) · 점 간격(px)
    private boolean survey = false;           // 🛰️ 그린 전체 측량: A=그린 앞 끝, B=그린 뒤 끝

    private GLSurfaceView glView;
    private Overlay overlay;
    private TextView title, hint;
    private Button mainBtn, sideBtn;
    private Session session;
    private boolean installRequested = false, depthOn = false, scanWanted = true;
    private int viewW = 1, viewH = 1;
    private boolean geometryChanged = true;

    // GL 스레드와 UI 스레드가 같이 보는 상태
    private volatile int step = 0;            // 0 공 · 1 홀 · 2 비추기 · 3 끝 · 4 실시간 AR 선(live)
    // 🔴 실시간 AR 선: 앱(JS)이 보낸 선(공 기준 로컬 좌표)을 실제 세계 좌표로 바꿔 고정 · 깊이 영상으로 사물 뒤는 숨김
    static WeakReference<DepthActivity> current = new WeakReference<>(null);
    private boolean live = false; private String mode = "green";
    private volatile float[][] ovW;      // 선마다 세계 좌표 [x,y,z,…]
    private volatile int[] ovC; private volatile float[] ovWd; private volatile boolean[] ovDash;
    private volatile float[][] lbW; private volatile String[] lbT; private volatile int[] lbC;
    private volatile String ovInfo = "";
    private short[] dbuf; private int dW, dH;
    private volatile int pendingTap = -1;     // 찍기 요청 (0 공 · 1 홀)
    private volatile boolean finishReq = false;
    private Anchor ballA, holeA;
    private final float[] pts = new float[MAX_POINTS * 3];
    private int nPts = 0, scanFrames = 0, frameNo = 0;
    private final float[] view = new float[16], proj = new float[16], vp = new float[16];

    // 카메라 배경 그리기
    private int camTex = -1, prog, aPos, aTex, uTex;
    private final FloatBuffer quad = floats(new float[]{-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f});
    private final FloatBuffer quadUV = floats(new float[8]);

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        scanWanted = getIntent().getBooleanExtra("scan", true);
        survey = getIntent().getBooleanExtra("survey", false);
        live = getIntent().getBooleanExtra("live", false);
        String m = getIntent().getStringExtra("mode"); if (m != null) mode = m;
        if ("lie".equals(mode)) scanTarget = 25;
        current = new WeakReference<>(this);
        if (survey) { scanWanted = true; scanTarget = 900; stride = 4; }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        glView = new GLSurfaceView(this);
        glView.setPreserveEGLContextOnPause(true);
        glView.setEGLContextClientVersion(2);
        glView.setEGLConfigChooser(8, 8, 8, 8, 16, 0);
        glView.setRenderer(this);
        glView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
        root.addView(glView, new FrameLayout.LayoutParams(-1, -1));
        overlay = new Overlay(this); overlay.owner = this;
        root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));

        // 위: 큰 안내 · 아래: 큰 버튼 하나 + 보조 버튼
        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.VERTICAL);
        top.setPadding(dp(18), dp(36), dp(18), dp(14));
        top.setBackgroundColor(0x99000000);
        title = text(22, true); hint = text(15, false);
        top.addView(title); top.addView(hint);
        root.addView(top, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));

        LinearLayout bot = new LinearLayout(this);
        bot.setOrientation(LinearLayout.VERTICAL);
        bot.setPadding(dp(16), dp(12), dp(16), dp(28));
        mainBtn = button(true); sideBtn = button(false);
        bot.addView(mainBtn, new LinearLayout.LayoutParams(-1, dp(64)));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(52)); lp.topMargin = dp(10);
        bot.addView(sideBtn, lp);
        root.addView(bot, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        setContentView(root);

        mainBtn.setOnClickListener(v -> onMain());
        sideBtn.setOnClickListener(v -> onSide());
        showStep();
    }

    // ---------- 단계 안내 ----------
    private void showStep() {
        runOnUiThread(() -> {
            switch (step) {
                case 0:
                    title.setText(survey ? "① 그린 앞 끝을 찍어요" : "① 공을 찍어요");
                    if ("lie".equals(mode)) { title.setText("① 공을 찍어요"); }
                    hint.setText(survey ? "페어웨이 쪽 그린 끝(관리자 지도의 '그린 앞')에 ＋를 맞춰요.\n바닥을 못 찾으면 휴대폰을 천천히 좌우로 움직여요." : "공 뒤에 서서 화면 가운데 ＋를 공에 맞춰요.\n바닥을 못 찾으면 휴대폰을 천천히 좌우로 움직여요.");
                    mainBtn.setText(survey ? "📍  앞 끝 찍기" : "⚪  공 찍기"); sideBtn.setText("그만하기"); break;
                case 1:
                    title.setText(survey ? "② 그린 뒤 끝을 찍어요" : "② 홀(컵)을 찍어요");
                    hint.setText(survey ? "그린 반대편 끝(관리자 지도의 '그린 뒤')에 ＋를 맞춰요. 멀면 걸어가서 찍어도 돼요." : "이제 ＋를 홀 한가운데에 맞춰요.");
                    mainBtn.setText(survey ? "📍  뒤 끝 찍기" : "⛳  홀 찍기"); sideBtn.setText("↩  공 다시 찍기");
                    if ("lie".equals(mode)) { title.setText("② 칠 방향을 찍어요"); hint.setText("공 앞 1~2m, 깃발 쪽 땅에 ＋를 맞춰요."); mainBtn.setText("🎯  방향 찍기"); }
                    break;
                case 2:
                    title.setText(survey ? "③ 그린 전체를 비춰요" : "③ 그린을 천천히 비춰요");
                    hint.setText((survey ? "그린 둘레를 천천히 걸으며 1~3m 앞 바닥을 빈틈없이 비춰요. 다 비췄으면 [다 됐어요].\n" : "공에서 홀까지, 그 둘레 1m를 천천히 쓸 듯이 비춰요 (약 3초).\n") + (depthOn ? "깊이 카메라로 높낮이를 재는 중" : "바닥 인식으로 기울기를 재는 중"));
                    mainBtn.setText("✔  다 됐어요"); sideBtn.setText(survey ? "그만하기" : "기울기 없이 거리만");
                    if ("lie".equals(mode)) { title.setText("③ 공 둘레를 비춰요"); hint.setText("공 둘레 1m 땅을 천천히 비춰요 (약 2초)."); }
                    break;
                case 4:
                    title.setText("lie".equals(mode) ? "AR 라이" : "AR 그린 읽기");
                    hint.setText(ovInfo.isEmpty() ? "계산 중…" : ovInfo);
                    mainBtn.setText("↻  다시 재기"); sideBtn.setText("닫기"); break;
                default:
                    title.setText("다 됐어요!"); hint.setText(""); break;
            }
        });
    }

    private void onMain() {
        if (step == 4) { // 다시 재기: 같은 AR 세션에서 처음부터
            if (ballA != null) ballA.detach(); if (holeA != null) holeA.detach(); ballA = holeA = null;
            ovW = null; lbW = null; ovInfo = ""; nPts = 0; scanFrames = 0; finishReq = false; step = 0; showStep(); return;
        }
        if (step == 0) pendingTap = 0;
        else if (step == 1) pendingTap = 1;
        else if (step == 2) finishReq = true;
    }
    private void onSide() {
        if (step == 4) { Intent d = new Intent(); d.putExtra("closed", true); setResult(RESULT_OK, d); finish(); return; }
        if (step == 0) { setResult(RESULT_CANCELED); finish(); }
        else if (step == 1) { step = 0; showStep(); }
        else if (step == 2 && survey) { setResult(RESULT_CANCELED); finish(); }
        else if (step == 2) { scanFrames = 0; nPts = 0; finishReq = true; }
    }

    // ---------- 생명주기: 권한 → ARCore 설치 → 세션 ----------
    @Override
    protected void onResume() {
        super.onResume();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQ_CAM);
            return;
        }
        if (session == null) {
            try {
                if (ArCoreApk.getInstance().requestInstall(this, !installRequested) == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                    installRequested = true; return; // 설치 화면 다녀온 뒤 onResume 다시
                }
                session = new Session(this);
                Config c = new Config(session);
                depthOn = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC);
                c.setDepthMode(depthOn ? Config.DepthMode.AUTOMATIC : Config.DepthMode.DISABLED);
                c.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL);
                c.setFocusMode(Config.FocusMode.AUTO);
                c.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
                session.configure(c);
            } catch (Exception e) {
                fail("이 휴대폰에서 AR을 시작하지 못했어요: " + e.getMessage()); return;
            }
        }
        try { session.resume(); } catch (Exception e) { fail("카메라를 열지 못했어요: " + e.getMessage()); return; }
        glView.onResume();
        geometryChanged = true;
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (session != null) { glView.onPause(); session.pause(); }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (session != null) { session.close(); session = null; }
    }

    @Override
    public void onRequestPermissionsResult(int code, @NonNull String[] perms, @NonNull int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == REQ_CAM && (res.length == 0 || res[0] != PackageManager.PERMISSION_GRANTED)) fail("카메라를 허락해야 잴 수 있어요");
    }

    private void fail(String msg) {
        Intent d = new Intent(); d.putExtra("error", msg);
        setResult(RESULT_CANCELED, d);
        runOnUiThread(() -> { title.setText("재지 못했어요"); hint.setText(msg); });
        glView.postDelayed(this::finish, 2200);
    }

    // ---------- GL ----------
    @Override
    public void onSurfaceCreated(GL10 gl, EGLConfig config) {
        GLES20.glClearColor(0f, 0f, 0f, 1f);
        int[] t = new int[1];
        GLES20.glGenTextures(1, t, 0);
        camTex = t[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, camTex);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        String vs = "attribute vec4 aPos; attribute vec2 aTex; varying vec2 vTex; void main(){ gl_Position = aPos; vTex = aTex; }";
        String fs = "#extension GL_OES_EGL_image_external : require\nprecision mediump float; varying vec2 vTex; uniform samplerExternalOES uTex; void main(){ gl_FragColor = texture2D(uTex, vTex); }";
        prog = GLES20.glCreateProgram();
        GLES20.glAttachShader(prog, shader(GLES20.GL_VERTEX_SHADER, vs));
        GLES20.glAttachShader(prog, shader(GLES20.GL_FRAGMENT_SHADER, fs));
        GLES20.glLinkProgram(prog);
        aPos = GLES20.glGetAttribLocation(prog, "aPos");
        aTex = GLES20.glGetAttribLocation(prog, "aTex");
        uTex = GLES20.glGetUniformLocation(prog, "uTex");
    }

    @Override
    public void onSurfaceChanged(GL10 gl, int w, int h) {
        GLES20.glViewport(0, 0, w, h);
        viewW = w; viewH = h; geometryChanged = true;
    }

    @Override
    public void onDrawFrame(GL10 gl) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
        Session s = session;
        if (s == null) return;
        try {
            if (geometryChanged) { s.setDisplayGeometry(getWindowManager().getDefaultDisplay().getRotation(), viewW, viewH); geometryChanged = false; }
            s.setCameraTextureName(camTex);
            Frame frame = s.update();
            if (frame.hasDisplayGeometryChanged()) {
                quad.position(0); quadUV.position(0);
                frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, quad, Coordinates2d.TEXTURE_NORMALIZED, quadUV);
            }
            drawBackground();
            Camera cam = frame.getCamera();
            boolean tracking = cam.getTrackingState() == TrackingState.TRACKING;
            cam.getProjectionMatrix(proj, 0, 0.05f, 50f);
            cam.getViewMatrix(view, 0);
            Matrix.multiplyMM(vp, 0, proj, 0, view, 0);

            int tap = pendingTap;
            if (tap >= 0) {
                pendingTap = -1;
                if (!tracking) toastUi("휴대폰을 천천히 움직여 바닥을 비춰 주세요");
                else {
                    Anchor a = hitCenter(frame);
                    if (a == null) toastUi("여기서는 바닥을 못 찾았어요 · 조금 움직여서 다시 눌러요");
                    else if (tap == 0) { if (ballA != null) ballA.detach(); ballA = a; step = 1; buzz(); showStep(); }
                    else {
                        if (holeA != null) holeA.detach(); holeA = a; buzz();
                        if (scanWanted) { step = 2; nPts = 0; scanFrames = 0; showStep(); }
                        else finishReq = true;
                    }
                }
            }
            if (step == 2 && tracking && !finishReq && (frameNo++ % 2 == 0)) {
                collect(frame, cam);
                final int pc = Math.min(100, survey ? nPts * 100 / MAX_POINTS : scanFrames * 100 / scanTarget);
                runOnUiThread(() -> mainBtn.setText(String.format(Locale.KOREA, "✔  다 됐어요  (%d%%)", pc)));
                if (scanFrames >= scanTarget || nPts >= MAX_POINTS) finishReq = true;
            }
            if (finishReq && ballA != null && holeA != null && step != 3 && step != 4) { step = 3; showStep(); writeResult(); return; }
            if (step == 4) liveFrame(frame, cam);
            overlay.update(project(ballA), project(holeA), tracking, step);
        } catch (Throwable e) {
            // 카메라가 잠깐 끊기는 경우 등 → 다음 프레임에서 다시
        }
    }

    // 화면 가운데 바닥 찾기 (평면 > 깊이 점 > 표면 방향이 있는 점)
    private Anchor hitCenter(Frame frame) {
        HitResult best = null; int rank = 9;
        for (HitResult hit : frame.hitTest(viewW / 2f, viewH / 2f)) {
            Trackable t = hit.getTrackable(); int r = 9;
            if (t instanceof Plane && ((Plane) t).isPoseInPolygon(hit.getHitPose())) r = 0;
            else if (t instanceof DepthPoint) r = 1;
            else if (t instanceof Point && ((Point) t).getOrientationMode() == Point.OrientationMode.ESTIMATED_SURFACE_NORMAL) r = 2;
            if (r < rank) { rank = r; best = hit; }
        }
        return best == null ? null : best.createAnchor();
    }

    // 높이 점 모으기: 깊이 영상(가능하면) 또는 화면 격자 hit test
    private void collect(Frame frame, Camera cam) {
        if (depthOn) {
            Image img = null;
            try {
                img = frame.acquireDepthImage16Bits();
                int w = img.getWidth(), h = img.getHeight();
                Image.Plane p = img.getPlanes()[0];
                ByteBuffer buf = p.getBuffer().order(ByteOrder.nativeOrder());
                int rs = p.getRowStride(), ps = p.getPixelStride();
                CameraIntrinsics k = cam.getTextureIntrinsics();
                float[] f = k.getFocalLength(), c = k.getPrincipalPoint(); int[] dim = k.getImageDimensions();
                float fx = f[0] * w / dim[0], fy = f[1] * h / dim[1], cx = c[0] * w / dim[0], cy = c[1] * h / dim[1];
                Pose pose = cam.getPose(); // 영상 읽는 방향 기준 (깊이 영상과 같은 방향)
                float[] q = new float[3];
                for (int v = 1; v < h; v += stride) for (int u = 1; u < w; u += stride) {
                    int mm = buf.getShort(v * rs + u * ps) & 0xFFFF;
                    if (mm < 250 || mm > 5000) continue;
                    float d = mm / 1000f;
                    q[0] = d * (u - cx) / fx; q[1] = d * (cy - v) / fy; q[2] = -d;
                    float[] wpt = pose.transformPoint(q);
                    if (!add(wpt[0], wpt[1], wpt[2])) break;
                }
                scanFrames++;
            } catch (Exception ignored) {
                // 깊이가 아직 준비 안 됨 (처음 몇 프레임)
            } finally { if (img != null) img.close(); }
        } else {
            for (int j = 1; j <= 9; j++) for (int i = 1; i <= 6; i++) {
                for (HitResult hit : frame.hitTest(viewW * i / 7f, viewH * j / 10f)) {
                    Trackable t = hit.getTrackable();
                    if (t instanceof Plane || t instanceof DepthPoint || t instanceof Point) {
                        Pose hp = hit.getHitPose(); add(hp.tx(), hp.ty(), hp.tz()); break;
                    }
                }
            }
            scanFrames++;
        }
    }
    private boolean add(float x, float y, float z) {
        if (nPts >= MAX_POINTS) return false;
        pts[nPts * 3] = x; pts[nPts * 3 + 1] = y; pts[nPts * 3 + 2] = z; nPts++;
        return true;
    }

    // ---------- 🔴 실시간 AR 선 ----------
    // 앱(JS)에서: { info, lines:[{ p:[x,y,z,…] (공 기준: x 오른쪽 · y 홀 쪽 · z 위, m), c:[r,g,b,a], w, dash }], labels:[{ p:[x,y,z], t, c }] }
    void setOverlay(JSONObject d) {
        try {
            if (ballA == null || holeA == null) return;
            Pose b = ballA.getPose(), h = holeA.getPose();
            float fx = h.tx() - b.tx(), fz = h.tz() - b.tz(), D = (float) Math.hypot(fx, fz); if (D < 1e-3) return;
            fx /= D; fz /= D; float rx = -fz, rz = fx; // 오른쪽 = 앞 × 위
            JSONArray L = d.optJSONArray("lines"); int n = L == null ? 0 : L.length();
            float[][] W = new float[n][]; int[] C = new int[n]; float[] Wd = new float[n]; boolean[] Ds = new boolean[n];
            for (int i = 0; i < n; i++) {
                JSONObject o = L.getJSONObject(i); JSONArray q = o.getJSONArray("p"); float[] w = new float[q.length()];
                for (int k = 0; k + 2 < q.length(); k += 3) { float x = (float) q.getDouble(k), y = (float) q.getDouble(k + 1), z = (float) q.getDouble(k + 2); w[k] = b.tx() + x * rx + y * fx; w[k + 1] = b.ty() + z; w[k + 2] = b.tz() + x * rz + y * fz; }
                W[i] = w; C[i] = color(o.optJSONArray("c"), 0xCCFFFFFF); Wd[i] = (float) o.optDouble("w", 2); Ds[i] = o.optBoolean("dash", false);
            }
            JSONArray B = d.optJSONArray("labels"); int m = B == null ? 0 : B.length();
            float[][] LW = new float[m][3]; String[] LT = new String[m]; int[] LC = new int[m];
            for (int i = 0; i < m; i++) {
                JSONObject o = B.getJSONObject(i); JSONArray q = o.getJSONArray("p"); float x = (float) q.getDouble(0), y = (float) q.getDouble(1), z = (float) q.getDouble(2);
                LW[i] = new float[]{b.tx() + x * rx + y * fx, b.ty() + z, b.tz() + x * rz + y * fz}; LT[i] = o.optString("t"); LC[i] = color(o.optJSONArray("c"), 0xE6000000);
            }
            ovW = W; ovC = C; ovWd = Wd; ovDash = Ds; lbW = LW; lbT = LT; lbC = LC; ovInfo = d.optString("info", "");
            showStep();
        } catch (Exception ignored) { }
    }
    private static int color(JSONArray a, int def) {
        if (a == null || a.length() < 3) return def;
        int al = a.length() > 3 ? (int) Math.round(a.optDouble(3, 1) * 255) : 255;
        return Color.argb(al, a.optInt(0), a.optInt(1), a.optInt(2));
    }
    // 매 화면: 세계 좌표 → 화면 · 카메라 기준 깊이와 깊이 영상(실제 사물까지 거리)을 비교해 사물 뒤면 숨김
    private void liveFrame(Frame frame, Camera cam) {
        float[][] W = ovW, LW = lbW; if (W == null) { overlay.setLive(null, null, null, null); return; }
        if (depthOn && (frameNo++ % 2 == 0)) {
            Image img = null;
            try {
                img = frame.acquireDepthImage16Bits();
                int w = img.getWidth(), h = img.getHeight(); Image.Plane pl = img.getPlanes()[0];
                ByteBuffer buf = pl.getBuffer().order(ByteOrder.nativeOrder()); int rs = pl.getRowStride(), ps = pl.getPixelStride();
                if (dbuf == null || dbuf.length != w * h) dbuf = new short[w * h];
                for (int v = 0; v < h; v++) for (int u = 0; u < w; u++) dbuf[v * w + u] = buf.getShort(v * rs + u * ps);
                dW = w; dH = h;
            } catch (Exception ignored) { } finally { if (img != null) img.close(); }
        }
        int nv = 0; for (float[] w : W) nv += w.length / 3; int nl = LW == null ? 0 : LW.length;
        float[] scr = new float[(nv + nl) * 2], cz = new float[nv + nl]; boolean[] front = new boolean[nv + nl];
        float[] in = new float[4], out = new float[4], vv = new float[4]; int k = 0;
        for (int pass = 0; pass < 2; pass++) {
            float[][] src = pass == 0 ? W : LW; if (src == null) continue;
            for (float[] w : src) for (int i = 0; i + 2 < w.length; i += 3) {
                in[0] = w[i]; in[1] = w[i + 1]; in[2] = w[i + 2]; in[3] = 1f;
                Matrix.multiplyMV(out, 0, vp, 0, in, 0); Matrix.multiplyMV(vv, 0, view, 0, in, 0);
                front[k] = out[3] > 0.05f; cz[k] = -vv[2];
                scr[k * 2] = front[k] ? (out[0] / out[3] + 1f) / 2f * viewW : -1; scr[k * 2 + 1] = front[k] ? (1f - out[1] / out[3]) / 2f * viewH : -1;
                k++;
            }
        }
        // 화면 점 → 깊이 영상 좌표 (한 번에 바꿈)
        boolean[] vis = new boolean[k];
        float[] tex = null;
        if (dbuf != null && k > 0) {
            FloatBuffer a = floats(scr), t = floats(new float[scr.length]);
            try { frame.transformCoordinates2d(Coordinates2d.VIEW, a, Coordinates2d.TEXTURE_NORMALIZED, t); tex = new float[scr.length]; t.position(0); t.get(tex); } catch (Exception ignored) { }
        }
        for (int i = 0; i < k; i++) {
            if (!front[i]) { vis[i] = false; continue; }
            vis[i] = true;
            if (tex != null) {
                int u = (int) (tex[i * 2] * dW), v = (int) (tex[i * 2 + 1] * dH);
                if (u >= 0 && v >= 0 && u < dW && v < dH) {
                    int mm = dbuf[v * dW + u] & 0xFFFF;
                    if (mm > 0) { float real = mm / 1000f; vis[i] = cz[i] <= real + Math.max(0.06f, 0.03f * cz[i]); } // 실제 사물이 더 가까우면 가려짐
                }
            }
        }
        overlay.setLive(scr, vis, W, LW);
    }

    private void writeResult() {
        try {
            Pose b = ballA.getPose(), h = holeA.getPose();
            StringBuilder sb = new StringBuilder(nPts * 24 + 256);
            sb.append("{\"ok\":true,\"kind\":\"").append(depthOn ? "depth" : "plane").append("\",\"frames\":").append(scanFrames)
              .append(",\"ball\":{\"x\":").append(b.tx()).append(",\"y\":").append(b.ty()).append(",\"z\":").append(b.tz())
              .append("},\"hole\":{\"x\":").append(h.tx()).append(",\"y\":").append(h.ty()).append(",\"z\":").append(h.tz())
              .append("},\"points\":[");
            for (int i = 0; i < nPts * 3; i++) {
                if (i > 0) sb.append(',');
                sb.append(Math.round(pts[i] * 1000f) / 1000f);
            }
            sb.append("]}");
            if (live) { // 앱이 높이 지도·퍼팅 길을 계산해 선을 보내 줌 (overlay) · 화면은 닫지 않음
                DepthPlugin.emitScan(sb.toString());
                finishReq = false; step = 4; showStep();
                return;
            }
            File f = new File(getCacheDir(), RESULT_FILE);
            try (FileOutputStream out = new FileOutputStream(f)) { out.write(sb.toString().getBytes("UTF-8")); }
            setResult(RESULT_OK);
        } catch (Exception e) {
            Intent d = new Intent(); d.putExtra("error", String.valueOf(e.getMessage())); setResult(RESULT_CANCELED, d);
        }
        runOnUiThread(this::finish);
    }

    private float[] project(Anchor a) {
        if (a == null || a.getTrackingState() != TrackingState.TRACKING) return null;
        Pose p = a.getPose();
        float[] w = {p.tx(), p.ty(), p.tz(), 1f}, c = new float[4];
        Matrix.multiplyMV(c, 0, vp, 0, w, 0);
        if (c[3] <= 0) return null;
        return new float[]{(c[0] / c[3] + 1f) / 2f * viewW, (1f - c[1] / c[3]) / 2f * viewH};
    }

    private void drawBackground() {
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);
        GLES20.glUseProgram(prog);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, camTex);
        GLES20.glUniform1i(uTex, 0);
        quad.position(0); quadUV.position(0);
        GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 0, quad);
        GLES20.glVertexAttribPointer(aTex, 2, GLES20.GL_FLOAT, false, 0, quadUV);
        GLES20.glEnableVertexAttribArray(aPos); GLES20.glEnableVertexAttribArray(aTex);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
        GLES20.glDisableVertexAttribArray(aPos); GLES20.glDisableVertexAttribArray(aTex);
        GLES20.glDepthMask(true);
    }

    private static int shader(int type, String src) {
        int s = GLES20.glCreateShader(type);
        GLES20.glShaderSource(s, src);
        GLES20.glCompileShader(s);
        return s;
    }
    private static FloatBuffer floats(float[] a) {
        FloatBuffer b = ByteBuffer.allocateDirect(a.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        b.put(a); b.position(0); return b;
    }

    // ---------- 작은 도우미 ----------
    private int dp(int v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics())); }
    private TextView text(int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setTextColor(Color.WHITE); t.setTextSize(sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(2), 0, dp(2));
        return t;
    }
    private Button button(boolean primary) {
        Button b = new Button(this);
        b.setAllCaps(false); b.setTextSize(primary ? 19 : 15); b.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable bg = new GradientDrawable(); bg.setCornerRadius(dp(32));
        bg.setColor(primary ? Color.parseColor("#C8F169") : 0xCC0E1410);
        if (!primary) bg.setStroke(dp(1), 0x66FFFFFF);
        b.setBackground(bg); b.setTextColor(primary ? Color.parseColor("#0E1410") : Color.WHITE);
        return b;
    }
    private void toastUi(String msg) { runOnUiThread(() -> android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()); }
    private void buzz() {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) return;
            if (android.os.Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(60);
        } catch (Exception ignored) { }
    }

    // 화면 위 표시: 가운데 ＋, 찍은 공(흰 점)·홀(라임 점)과 잇는 선
    static class Overlay extends View {
        private final Paint cross = new Paint(Paint.ANTI_ALIAS_FLAG), ball = new Paint(Paint.ANTI_ALIAS_FLAG), hole = new Paint(Paint.ANTI_ALIAS_FLAG), line = new Paint(Paint.ANTI_ALIAS_FLAG);
        private volatile float[] b, h; private volatile boolean tracking; private volatile int step;
        Overlay(Context c) {
            super(c);
            cross.setColor(Color.WHITE); cross.setStrokeWidth(6f); cross.setStyle(Paint.Style.STROKE);
            ball.setColor(Color.WHITE); hole.setColor(Color.parseColor("#C8F169"));
            line.setColor(Color.parseColor("#FFD23F")); line.setStrokeWidth(8f);
        }
        void update(float[] b, float[] h, boolean tracking, int step) { this.b = b; this.h = h; this.tracking = tracking; this.step = step; postInvalidate(); }
        private volatile float[] ls; private volatile boolean[] lv; private volatile float[][] lw, llw;
        private final Paint lp = new Paint(Paint.ANTI_ALIAS_FLAG), tp = new Paint(Paint.ANTI_ALIAS_FLAG), bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        void setLive(float[] scr, boolean[] vis, float[][] w, float[][] lw2) { ls = scr; lv = vis; lw = w; llw = lw2; postInvalidate(); }
        DepthActivity owner;
        private void drawLive(Canvas c) {
            float[] S = ls; boolean[] V = lv; float[][] W = lw; DepthActivity o = owner; if (S == null || V == null || W == null || o == null) return;
            int[] C = o.ovC; float[] Wd = o.ovWd; boolean[] Ds = o.ovDash; if (C == null) return;
            lp.setStyle(Paint.Style.STROKE); lp.setStrokeCap(Paint.Cap.ROUND);
            int k = 0;
            for (int li = 0; li < W.length; li++) {
                int n = W[li].length / 3;
                lp.setColor(C[li]); lp.setStrokeWidth(Wd[li] * getResources().getDisplayMetrics().density);
                lp.setPathEffect(Ds[li] ? new DashPathEffect(new float[]{18f, 14f}, 0) : null);
                for (int i = 1; i < n; i++) { int a = k + i - 1, b2 = k + i; if (V[a] && V[b2]) c.drawLine(S[a * 2], S[a * 2 + 1], S[b2 * 2], S[b2 * 2 + 1], lp); }
                k += n;
            }
            lp.setPathEffect(null);
            String[] T = o.lbT; int[] LC = o.lbC; if (T == null) return;
            tp.setColor(Color.WHITE); tp.setTextSize(13 * getResources().getDisplayMetrics().density); tp.setFakeBoldText(true);
            for (int i = 0; i < T.length && k + i < V.length; i++) {
                if (!V[k + i]) continue;
                float x = S[(k + i) * 2], y = S[(k + i) * 2 + 1], tw = tp.measureText(T[i]);
                bg.setColor(LC[i]); c.drawRoundRect(x - tw / 2 - 12, y - 46, x + tw / 2 + 12, y - 8, 18, 18, bg);
                c.drawText(T[i], x - tw / 2, y - 20, tp);
            }
        }
        @Override protected void onDraw(Canvas c) {
            float cx = getWidth() / 2f, cy = getHeight() / 2f, r = 34f;
            if (step < 2) {
                cross.setColor(tracking ? Color.WHITE : 0x88FFFFFF);
                c.drawLine(cx - r, cy, cx + r, cy, cross); c.drawLine(cx, cy - r, cx, cy + r, cross);
                c.drawCircle(cx, cy, r * 0.55f, cross);
            }
            if (step == 4) { drawLive(c); return; }
            float[] B = b, H = h;
            if (B != null && H != null) c.drawLine(B[0], B[1], H[0], H[1], line);
            if (B != null) c.drawCircle(B[0], B[1], 16f, ball);
            if (H != null) c.drawCircle(H[0], H[1], 18f, hole);
        }
    }
}
