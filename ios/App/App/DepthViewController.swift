import UIKit
import ARKit
import SceneKit

/// 📏 깊이 카메라 화면 (ARKit · LiDAR)
///  ① ＋를 공에 맞추고 [공 찍기] → ② ＋를 홀에 맞추고 [홀 찍기] → ③ (scan) 공~홀 그린을 천천히 비춤 → 결과
///  LiDAR가 있으면 sceneDepth 깊이 영상의 점을, 없으면 화면 여러 곳의 바닥 인식(raycast) 점을 모음.
final class DepthViewController: UIViewController, ARSessionDelegate {
    private let scan: Bool
    private let survey: Bool // 🛰️ 그린 전체 측량: A=그린 앞 끝, B=그린 뒤 끝
    private var done: (([String: Any]) -> Void)?
    private let arView = ARSCNView(frame: .zero)
    private let titleLabel = UILabel(), hintLabel = UILabel()
    private let mainButton = UIButton(type: .system), sideButton = UIButton(type: .system)
    private let cross = UIView()

    private var step = 0               // 0 공 · 1 홀 · 2 비추기 · 3 끝
    private var ball: simd_float3?, hole: simd_float3?
    private var ballNode: SCNNode?, holeNode: SCNNode?, lineNode: SCNNode?
    private var pts: [Float] = []
    private var scanFrames = 0, frameNo = 0
    private let maxPoints = 100000
    private var scanTarget = 45, stride = 3
    private var lidar = false

    // 🔴 실시간 AR 선: 잰 결과를 onScan으로 보내고 화면은 열린 채 · 앱이 보낸 선을 실제 세계에 고정 · LiDAR 깊이로 사물 뒤는 숨김
    static weak var current: DepthViewController?
    private let live: Bool, mode: String
    private let onScan: (([String: Any]) -> Void)?
    private var ovW: [[simd_float3]] = [], ovC: [UIColor] = [], ovWd: [CGFloat] = [], ovDash: [Bool] = []
    private var lbW: [simd_float3] = [], lbT: [String] = [], lbC: [UIColor] = []
    private var ovInfo = ""
    private let liveView = LiveOverlay()

    init(scan: Bool, survey: Bool = false, live: Bool = false, mode: String = "green", done: @escaping ([String: Any]) -> Void, onScan: (([String: Any]) -> Void)? = nil) {
        self.scan = scan || survey; self.survey = survey; self.done = done
        self.live = live; self.mode = mode; self.onScan = onScan
        if survey { scanTarget = 900; stride = 4 }
        if mode == "lie" { scanTarget = 25 }
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        arView.translatesAutoresizingMaskIntoConstraints = false
        arView.session.delegate = self
        arView.autoenablesDefaultLighting = true
        view.addSubview(arView)
        liveView.frame = view.bounds; liveView.autoresizingMask = [.flexibleWidth, .flexibleHeight]; liveView.isUserInteractionEnabled = false; liveView.backgroundColor = .clear; liveView.isHidden = true
        view.addSubview(liveView)
        DepthViewController.current = self

        // 가운데 ＋
        cross.translatesAutoresizingMaskIntoConstraints = false
        cross.isUserInteractionEnabled = false
        let h = UIView(), v = UIView(), ring = UIView()
        for bar in [h, v] { bar.backgroundColor = .white; bar.translatesAutoresizingMaskIntoConstraints = false; cross.addSubview(bar) }
        ring.layer.borderColor = UIColor.white.cgColor; ring.layer.borderWidth = 3; ring.layer.cornerRadius = 18
        ring.translatesAutoresizingMaskIntoConstraints = false; cross.addSubview(ring)
        view.addSubview(cross)

        let top = UIStackView(arrangedSubviews: [titleLabel, hintLabel])
        top.axis = .vertical; top.spacing = 6
        top.isLayoutMarginsRelativeArrangement = true
        top.layoutMargins = UIEdgeInsets(top: 14, left: 18, bottom: 14, right: 18)
        top.backgroundColor = UIColor.black.withAlphaComponent(0.6)
        top.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = .boldSystemFont(ofSize: 22); titleLabel.textColor = .white
        hintLabel.font = .systemFont(ofSize: 15); hintLabel.textColor = .white; hintLabel.numberOfLines = 0
        view.addSubview(top)

        style(mainButton, primary: true); style(sideButton, primary: false)
        let bot = UIStackView(arrangedSubviews: [mainButton, sideButton])
        bot.axis = .vertical; bot.spacing = 10
        bot.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bot)
        mainButton.addTarget(self, action: #selector(onMain), for: .touchUpInside)
        sideButton.addTarget(self, action: #selector(onSide), for: .touchUpInside)

        NSLayoutConstraint.activate([
            arView.topAnchor.constraint(equalTo: view.topAnchor), arView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            arView.leadingAnchor.constraint(equalTo: view.leadingAnchor), arView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            top.topAnchor.constraint(equalTo: view.topAnchor), top.leadingAnchor.constraint(equalTo: view.leadingAnchor), top.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            titleLabel.topAnchor.constraint(greaterThanOrEqualTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            bot.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16), bot.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            bot.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            mainButton.heightAnchor.constraint(equalToConstant: 64), sideButton.heightAnchor.constraint(equalToConstant: 52),
            cross.centerXAnchor.constraint(equalTo: view.centerXAnchor), cross.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            cross.widthAnchor.constraint(equalToConstant: 68), cross.heightAnchor.constraint(equalToConstant: 68),
            h.centerYAnchor.constraint(equalTo: cross.centerYAnchor), h.leadingAnchor.constraint(equalTo: cross.leadingAnchor), h.trailingAnchor.constraint(equalTo: cross.trailingAnchor), h.heightAnchor.constraint(equalToConstant: 3),
            v.centerXAnchor.constraint(equalTo: cross.centerXAnchor), v.topAnchor.constraint(equalTo: cross.topAnchor), v.bottomAnchor.constraint(equalTo: cross.bottomAnchor), v.widthAnchor.constraint(equalToConstant: 3),
            ring.centerXAnchor.constraint(equalTo: cross.centerXAnchor), ring.centerYAnchor.constraint(equalTo: cross.centerYAnchor),
            ring.widthAnchor.constraint(equalToConstant: 36), ring.heightAnchor.constraint(equalToConstant: 36),
        ])
        showStep()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let c = ARWorldTrackingConfiguration()
        c.planeDetection = [.horizontal]
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) { c.frameSemantics.insert(.sceneDepth); lidar = true }
        UIApplication.shared.isIdleTimerDisabled = true
        arView.session.run(c, options: [.resetTracking, .removeExistingAnchors])
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        arView.session.pause()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    // ---------- 단계 안내 ----------
    private func showStep() {
        cross.isHidden = step >= 2
        switch step {
        case 0:
            titleLabel.text = survey ? "① 그린 앞 끝을 찍어요" : "① 공을 찍어요"
            hintLabel.text = survey ? "페어웨이 쪽 그린 끝(관리자 지도의 '그린 앞')에 ＋를 맞춰요.\n바닥을 못 찾으면 휴대폰을 천천히 좌우로 움직여요." : "공 뒤에 서서 화면 가운데 ＋를 공에 맞춰요.\n바닥을 못 찾으면 휴대폰을 천천히 좌우로 움직여요."
            mainButton.setTitle(survey ? "📍  앞 끝 찍기" : "⚪  공 찍기", for: .normal); sideButton.setTitle("그만하기", for: .normal)
        case 1:
            titleLabel.text = survey ? "② 그린 뒤 끝을 찍어요" : "② 홀(컵)을 찍어요"
            hintLabel.text = survey ? "그린 반대편 끝(관리자 지도의 '그린 뒤')에 ＋를 맞춰요. 멀면 걸어가서 찍어도 돼요." : "이제 ＋를 홀 한가운데에 맞춰요."
            mainButton.setTitle(survey ? "📍  뒤 끝 찍기" : "⛳  홀 찍기", for: .normal); sideButton.setTitle("↩  공 다시 찍기", for: .normal)
        case 2:
            titleLabel.text = survey ? "③ 그린 전체를 비춰요" : "③ 그린을 천천히 비춰요"
            hintLabel.text = (survey ? "그린 둘레를 천천히 걸으며 1~3m 앞 바닥을 빈틈없이 비춰요. 다 비췄으면 [다 됐어요].\n" : "공에서 홀까지, 그 둘레 1m를 천천히 쓸 듯이 비춰요 (약 3초).\n") + (lidar ? "LiDAR로 높낮이를 재는 중" : "바닥 인식으로 기울기를 재는 중")
            mainButton.setTitle("✔  다 됐어요", for: .normal); sideButton.setTitle(survey ? "그만하기" : "기울기 없이 거리만", for: .normal)
        case 4:
            titleLabel.text = mode == "lie" ? "AR 라이" : "AR 그린 읽기"
            hintLabel.text = ovInfo.isEmpty ? "계산 중…" : ovInfo
            mainButton.setTitle("↻  다시 재기", for: .normal); sideButton.setTitle("닫기", for: .normal)
        default:
            titleLabel.text = "다 됐어요!"; hintLabel.text = ""
        }
        if mode == "lie" && step == 1 { titleLabel.text = "② 칠 방향을 찍어요"; hintLabel.text = "공 앞 1~2m, 깃발 쪽 땅에 ＋를 맞춰요."; mainButton.setTitle("🎯  방향 찍기", for: .normal) }
        if mode == "lie" && step == 2 { titleLabel.text = "③ 공 둘레를 비춰요"; hintLabel.text = "공 둘레 1m 땅을 천천히 비춰요 (약 2초)." }
        liveView.isHidden = step != 4
    }

    @objc private func onMain() {
        switch step {
        case 0:
            guard let p = hitCenter() else { return toast("여기서는 바닥을 못 찾았어요 · 조금 움직여서 다시 눌러요") }
            ball = p; ballNode = mark(p, color: .white, old: ballNode); step = 1; buzz(); showStep()
        case 1:
            guard let p = hitCenter() else { return toast("여기서는 바닥을 못 찾았어요 · 조금 움직여서 다시 눌러요") }
            hole = p; holeNode = mark(p, color: UIColor(red: 0.78, green: 0.95, blue: 0.41, alpha: 1), old: holeNode); drawLine(); buzz()
            if scan { step = 2; pts.removeAll(); scanFrames = 0; showStep() } else { finish() }
        case 2: finish()
        case 4: // 다시 재기
            ballNode?.removeFromParentNode(); holeNode?.removeFromParentNode(); lineNode?.removeFromParentNode()
            ball = nil; hole = nil; ovW = []; lbW = []; ovInfo = ""; pts.removeAll(); scanFrames = 0; step = 0; showStep()
        default: break
        }
    }
    @objc private func onSide() {
        if step == 4 { close(["ok": true, "closed": true]); return }
        switch step {
        case 0: close(["ok": false, "cancelled": true])
        case 1: step = 0; ball = nil; showStep()
        case 2 where survey: close(["ok": false, "cancelled": true])
        case 2: pts.removeAll(); scanFrames = 0; finish()
        default: break
        }
    }

    // 화면 가운데 바닥 (LiDAR 기기는 깊이로 더 정확하게 맞춰짐)
    private func hitCenter() -> simd_float3? { hit(CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)) }
    private func hit(_ pt: CGPoint) -> simd_float3? {
        guard let q = arView.raycastQuery(from: pt, allowing: .estimatedPlane, alignment: .any),
              let r = arView.session.raycast(q).first else { return nil }
        let t = r.worldTransform.columns.3
        return simd_float3(t.x, t.y, t.z)
    }

    // ---------- 높이 점 모으기 ----------
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        if step == 4 { liveFrame(frame); return }
        guard step == 2 else { return }
        frameNo += 1
        if frameNo % 2 != 0 { return }
        if case .normal = frame.camera.trackingState {} else { return }
        if lidar, let depth = frame.sceneDepth { collectDepth(frame, depth) } else { collectRaycast() }
        scanFrames += 1
        let pc = min(100, survey ? pts.count * 100 / (maxPoints * 3) : scanFrames * 100 / scanTarget)
        mainButton.setTitle("✔  다 됐어요  (\(pc)%)", for: .normal)
        if scanFrames >= scanTarget || pts.count >= maxPoints * 3 { finish() }
    }

    private func collectDepth(_ frame: ARFrame, _ depth: ARDepthData) {
        let dm = depth.depthMap
        CVPixelBufferLockBaseAddress(dm, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(dm, .readOnly) }
        let w = CVPixelBufferGetWidth(dm), h = CVPixelBufferGetHeight(dm), row = CVPixelBufferGetBytesPerRow(dm)
        guard let base = CVPixelBufferGetBaseAddress(dm) else { return }
        var confBase: UnsafeMutableRawPointer? = nil, confRow = 0
        if let cm = depth.confidenceMap {
            CVPixelBufferLockBaseAddress(cm, .readOnly)
            confBase = CVPixelBufferGetBaseAddress(cm); confRow = CVPixelBufferGetBytesPerRow(cm)
        }
        defer { if let cm = depth.confidenceMap { CVPixelBufferUnlockBaseAddress(cm, .readOnly) } }
        // 카메라 내부 값(전체 영상 해상도 기준)을 깊이 영상 크기로
        let K = frame.camera.intrinsics, res = frame.camera.imageResolution
        let sx = Float(w) / Float(res.width), sy = Float(h) / Float(res.height)
        let fx = K[0][0] * sx, fy = K[1][1] * sy, cx = K[2][0] * sx, cy = K[2][1] * sy
        let T = frame.camera.transform // 센서(가로) 방향 기준: 영상 오른쪽 = +x, 영상 아래 = −y, 앞 = −z
        var v = 1
        while v < h {
            let line = base.advanced(by: v * row).assumingMemoryBound(to: Float32.self)
            var u = 1
            while u < w {
                let d = line[u]
                var ok = d > 0.25 && d < 5
                if ok, let cb = confBase { ok = cb.advanced(by: v * confRow + u).assumingMemoryBound(to: UInt8.self).pointee >= 1 } // 보통 이상
                if ok {
                    let pc = simd_float4(d * (Float(u) - cx) / fx, -d * (Float(v) - cy) / fy, -d, 1)
                    let p = T * pc
                    pts.append(p.x); pts.append(p.y); pts.append(p.z)
                    if pts.count >= maxPoints * 3 { return }
                }
                u += stride
            }
            v += stride
        }
    }
    private func collectRaycast() {
        let W = arView.bounds.width, H = arView.bounds.height
        for j in 1...9 { for i in 1...6 {
            if let p = hit(CGPoint(x: W * CGFloat(i) / 7, y: H * CGFloat(j) / 10)) { pts.append(p.x); pts.append(p.y); pts.append(p.z) }
        } }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        close(["ok": false, "cancelled": true, "error": "카메라를 열지 못했어요 (설정 → PinPoint 캐디 → 카메라 허용): \(error.localizedDescription)"])
    }

    // ---------- 끝 ----------
    private func finish() {
        guard step != 3, let b = ball, let h = hole else { return }
        step = 3; showStep()
        let r: [String: Any] = [
            "ok": true, "kind": lidar ? "lidar" : "plane", "frames": scanFrames,
            "ball": ["x": b.x, "y": b.y, "z": b.z], "hole": ["x": h.x, "y": h.y, "z": h.z],
            "points": pts.map { (Double($0) * 1000).rounded() / 1000 },
        ]
        if live, let cb = onScan { cb(r); step = 4; showStep(); return } // 앱이 선을 계산해 overlay로 보내 줌
        close(r)
    }
    private func close(_ r: [String: Any]) {
        guard let cb = done else { return }
        done = nil
        arView.session.pause()
        dismiss(animated: true) { cb(r) }
    }

    // ---------- 🔴 실시간 AR 선 ----------
    // { info, lines:[{ p:[x,y,z,…] (공 기준: x 오른쪽 · y 홀 쪽 · z 위), c:[r,g,b,a], w, dash }], labels:[{ p, t, c }] }
    func setOverlay(_ d: [String: Any]) {
        guard let b = ball, let h = hole else { return }
        var f = simd_float2(h.x - b.x, h.z - b.z); let D = simd_length(f); if D < 1e-3 { return }
        f /= D; let r = simd_float2(-f.y, f.x) // 오른쪽 = 앞 × 위
        let W = { (x: Float, y: Float, z: Float) -> simd_float3 in simd_float3(b.x + x * r.x + y * f.x, b.y + z, b.z + x * r.y + y * f.y) }
        let col = { (a: Any?, def: UIColor) -> UIColor in
            guard let c = a as? [Double], c.count >= 3 else { return def }
            return UIColor(red: CGFloat(c[0]) / 255, green: CGFloat(c[1]) / 255, blue: CGFloat(c[2]) / 255, alpha: CGFloat(c.count > 3 ? c[3] : 1))
        }
        var lw: [[simd_float3]] = [], lc: [UIColor] = [], lwd: [CGFloat] = [], ld: [Bool] = []
        for o in (d["lines"] as? [[String: Any]]) ?? [] {
            let q = (o["p"] as? [Double]) ?? []; var pts: [simd_float3] = []
            var i = 0; while i + 2 < q.count { pts.append(W(Float(q[i]), Float(q[i + 1]), Float(q[i + 2]))); i += 3 }
            lw.append(pts); lc.append(col(o["c"], UIColor(white: 1, alpha: 0.8))); lwd.append(CGFloat((o["w"] as? Double) ?? 2)); ld.append((o["dash"] as? Bool) ?? false)
        }
        var bw: [simd_float3] = [], bt: [String] = [], bc: [UIColor] = []
        for o in (d["labels"] as? [[String: Any]]) ?? [] {
            let q = (o["p"] as? [Double]) ?? []; guard q.count >= 3 else { continue }
            bw.append(W(Float(q[0]), Float(q[1]), Float(q[2]))); bt.append((o["t"] as? String) ?? ""); bc.append(col(o["c"], UIColor(white: 0, alpha: 0.85)))
        }
        ovW = lw; ovC = lc; ovWd = lwd; ovDash = ld; lbW = bw; lbT = bt; lbC = bc; ovInfo = (d["info"] as? String) ?? ""
        showStep()
    }
    // 세계 → 화면 · 카메라 기준 깊이와 LiDAR 깊이(실제 사물까지)를 비교해 사물 뒤면 숨김
    private func liveFrame(_ frame: ARFrame) {
        let size = arView.bounds.size, cam = frame.camera, inv = cam.transform.inverse
        var dm: CVPixelBuffer? = nil
        if lidar, let d = frame.sceneDepth { dm = d.depthMap; CVPixelBufferLockBaseAddress(d.depthMap, .readOnly) }
        defer { if let m = dm { CVPixelBufferUnlockBaseAddress(m, .readOnly) } }
        let toImage = frame.displayTransform(for: .portrait, viewportSize: size).inverted()
        let real: (CGPoint) -> Float? = { pt in
            guard let m = dm, let base = CVPixelBufferGetBaseAddress(m) else { return nil }
            let w = CVPixelBufferGetWidth(m), h = CVPixelBufferGetHeight(m), row = CVPixelBufferGetBytesPerRow(m)
            let n = CGPoint(x: pt.x / size.width, y: pt.y / size.height).applying(toImage)
            let u = Int(n.x * CGFloat(w)), v = Int(n.y * CGFloat(h)); if u < 0 || v < 0 || u >= w || v >= h { return nil }
            let d = base.advanced(by: v * row).assumingMemoryBound(to: Float32.self)[u]; return d > 0 ? d : nil
        }
        let proj = { (p: simd_float3) -> (CGPoint, Bool) in
            let c = inv * simd_float4(p, 1), depth = -c.z
            if depth < 0.05 { return (.zero, false) }
            let s = cam.projectPoint(p, orientation: .portrait, viewportSize: size)
            if let r = real(s) { return (s, depth <= r + max(0.06, 0.03 * depth)) } // 실제 사물이 더 가까우면 가려짐
            return (s, true)
        }
        liveView.segs = ovW.map { $0.map(proj) }
        liveView.colors = ovC; liveView.widths = ovWd; liveView.dash = ovDash
        liveView.labels = zip(lbW, lbT).map { (w, t) in let (s, ok) = proj(w); return (s, ok, t) }
        liveView.labelColors = lbC
        liveView.setNeedsDisplay()
    }

    // ---------- 표시 ----------
    private func mark(_ p: simd_float3, color: UIColor, old: SCNNode?) -> SCNNode {
        old?.removeFromParentNode()
        let s = SCNSphere(radius: 0.025); s.firstMaterial?.diffuse.contents = color
        let n = SCNNode(geometry: s); n.simdPosition = p + simd_float3(0, 0.02, 0)
        arView.scene.rootNode.addChildNode(n)
        return n
    }
    private func drawLine() {
        lineNode?.removeFromParentNode()
        guard let b = ball, let h = hole else { return }
        let len = simd_distance(b, h)
        let c = SCNCylinder(radius: 0.006, height: CGFloat(len)); c.firstMaterial?.diffuse.contents = UIColor(red: 1, green: 0.82, blue: 0.25, alpha: 1)
        let n = SCNNode(geometry: c)
        n.simdPosition = (b + h) / 2 + simd_float3(0, 0.02, 0)
        n.simdOrientation = simd_quatf(from: simd_float3(0, 1, 0), to: simd_normalize(h - b))
        arView.scene.rootNode.addChildNode(n); lineNode = n
    }
    private func style(_ b: UIButton, primary: Bool) {
        b.titleLabel?.font = .boldSystemFont(ofSize: primary ? 19 : 15)
        b.backgroundColor = primary ? UIColor(red: 0.78, green: 0.95, blue: 0.41, alpha: 1) : UIColor(white: 0.05, alpha: 0.8)
        b.setTitleColor(primary ? UIColor(red: 0.05, green: 0.08, blue: 0.06, alpha: 1) : .white, for: .normal)
        b.layer.cornerRadius = primary ? 32 : 26
        if !primary { b.layer.borderWidth = 1; b.layer.borderColor = UIColor(white: 1, alpha: 0.4).cgColor }
    }
    private func toast(_ msg: String) {
        let l = UILabel(); l.text = "  \(msg)  "; l.numberOfLines = 0; l.textAlignment = .center
        l.textColor = .white; l.backgroundColor = UIColor(white: 0, alpha: 0.8); l.layer.cornerRadius = 12; l.clipsToBounds = true
        l.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(l)
        NSLayoutConstraint.activate([l.centerXAnchor.constraint(equalTo: view.centerXAnchor), l.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: 90), l.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -40)])
        UIView.animate(withDuration: 0.3, delay: 2.2, options: [], animations: { l.alpha = 0 }) { _ in l.removeFromSuperview() }
    }
    private func buzz() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
}

/// 🔴 실시간 AR 선 그리기 (보이는 구간만)
final class LiveOverlay: UIView {
    var segs: [[(CGPoint, Bool)]] = [], colors: [UIColor] = [], widths: [CGFloat] = [], dash: [Bool] = []
    var labels: [(CGPoint, Bool, String)] = [], labelColors: [UIColor] = []
    override func draw(_ rect: CGRect) {
        for (i, line) in segs.enumerated() {
            let path = UIBezierPath(); var pen = false
            for (pt, ok) in line { if ok { if pen { path.addLine(to: pt) } else { path.move(to: pt); pen = true } } else { pen = false } }
            path.lineWidth = i < widths.count ? widths[i] : 2; path.lineCapStyle = .round
            if i < dash.count && dash[i] { path.setLineDash([9, 7], count: 2, phase: 0) }
            (i < colors.count ? colors[i] : .white).setStroke(); path.stroke()
        }
        let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 13), .foregroundColor: UIColor.white]
        for (i, l) in labels.enumerated() where l.1 {
            let t = l.2 as NSString, sz = t.size(withAttributes: attrs)
            let box = CGRect(x: l.0.x - sz.width / 2 - 8, y: l.0.y - sz.height - 16, width: sz.width + 16, height: sz.height + 8)
            (i < labelColors.count ? labelColors[i] : UIColor(white: 0, alpha: 0.85)).setFill(); UIBezierPath(roundedRect: box, cornerRadius: 9).fill()
            t.draw(at: CGPoint(x: box.minX + 8, y: box.minY + 4), withAttributes: attrs)
        }
    }
}
