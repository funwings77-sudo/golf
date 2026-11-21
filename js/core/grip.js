// 🏷️ 그립 센서: 클럽 끝(그립)에 붙인 블루투스 센서가 '이 클럽으로 쳤어요'를 알려 줌 → [쳤어요] 때 클럽을 고를 필요 없음
//  네이티브 플러그인: @capacitor-community/bluetooth-le (window.Capacitor.Plugins.BluetoothLe, 광고 신호만 읽음 · 연결 안 함)
//  센서 신호 두 가지를 알아봄
//   1) PinPoint 태그 규격 (공개): 제조사 데이터 회사 번호 0xFFFF, 내용 'P''T' · 버전 1 · 친 횟수(2바이트, 작은 쪽 먼저) · 배터리 %
//      → 친 횟수가 늘면 '쳤다'
//   2) 그 밖의 움직임 감지 태그: 광고 내용(제조사·서비스 데이터)이 바뀌면 '쳤다' (3초에 한 번만)
//  연결은 '클럽 고르기 → 그 클럽 센서를 손으로 톡톡' 하면 신호가 바뀐 센서를 그 클럽에 붙임

const BLE = () => globalThis.window?.Capacitor?.Plugins?.BluetoothLe || null;
const native = () => !!globalThis.window?.Capacitor?.isNativePlatform?.();
export const gripSupported = () => native() && !!BLE();

const hex = v => String(v || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
const bytes = h => { const s = hex(h), out = []; for (let i = 0; i + 1 < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16)); return out; };

// PinPoint 태그 해석 (아니면 null)
export function parseTag(manufacturerData) {
  const d = manufacturerData?.['65535'] ?? manufacturerData?.[65535];
  if (d == null) return null;
  const b = bytes(d);
  if (b.length < 6 || b[0] !== 0x50 || b[1] !== 0x54 || b[2] !== 1) return null;
  return { count: b[3] | (b[4] << 8), battery: Math.min(100, b[5]) };
}
// 광고 내용 지문 (내용이 바뀌었는지 비교용) — 신호 세기(RSSI)는 넣지 않음
export function signature(r) {
  const parts = [];
  for (const k of Object.keys(r.manufacturerData || {}).sort()) parts.push('m' + k + ':' + hex(r.manufacturerData[k]));
  for (const k of Object.keys(r.serviceData || {}).sort()) parts.push('s' + k + ':' + hex(r.serviceData[k]));
  return parts.join('|');
}

// 센서마다 마지막 신호를 기억했다가 '쳤다'를 찾음
export class GripTracker {
  constructor({ debounceMs = 3000 } = {}) { this.seen = new Map(); this.debounceMs = debounceMs; }
  // r: 스캔 결과 { device: { deviceId, name }, rssi, manufacturerData, serviceData } → 바뀌었으면 { deviceId, name, battery }
  feed(r, now = Date.now()) {
    const id = r?.device?.deviceId; if (!id) return null;
    const tag = parseTag(r.manufacturerData), sig = signature(r), prev = this.seen.get(id);
    this.seen.set(id, { sig, tag, name: r.device.name || prev?.name || '', rssi: r.rssi, at: now, lastHit: prev?.lastHit ?? -Infinity });
    if (!prev) return null; // 처음 본 신호는 기준만
    const cur = this.seen.get(id);
    const hit = tag && prev.tag ? ((tag.count - prev.tag.count + 65536) % 65536) > 0 && ((tag.count - prev.tag.count + 65536) % 65536) < 50 : sig && sig !== prev.sig;
    if (!hit || now - prev.lastHit < this.debounceMs) return null;
    cur.lastHit = now;
    return { deviceId: id, name: cur.name, battery: tag?.battery ?? null, at: now };
  }
  nearby(now = Date.now(), maxAge = 15000) { return [...this.seen.entries()].filter(([, v]) => now - v.at < maxAge).map(([id, v]) => ({ deviceId: id, name: v.name, rssi: v.rssi, tag: !!v.tag, battery: v.tag?.battery ?? null })).sort((a, b) => (b.rssi ?? -200) - (a.rssi ?? -200)); }
}

// 쳤을 때 어떤 클럽인가 (연결 목록 grips: [{ deviceId, club, name }])
export function clubForEvent(grips, ev) { return ev ? grips.find(g => g.deviceId === ev.deviceId) || null : null; }

// ---------- 스캔 (앱) ----------
let listener = null, tracker = null, onEvent = null, running = false;
export async function startGripScan(cb) {
  const ble = BLE(); if (!native() || !ble) throw new Error('그립 센서는 앱(안드로이드·아이폰)에서만 쓸 수 있어요');
  onEvent = cb;
  if (running) return tracker;
  tracker = new GripTracker();
  await ble.initialize({ androidNeverForLocation: true });
  await listener?.remove?.();
  listener = await ble.addListener('onScanResult', r => { const ev = tracker.feed(r); if (ev) onEvent?.(ev, tracker); });
  await ble.requestLEScan({ allowDuplicates: true });
  running = true;
  return tracker;
}
export async function stopGripScan() {
  const ble = BLE(); running = false; onEvent = null;
  try { await listener?.remove?.(); } catch {} listener = null;
  try { await ble?.stopLEScan(); } catch {}
}
export const gripTracker = () => tracker;
