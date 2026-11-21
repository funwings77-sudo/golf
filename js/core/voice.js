// 🎧 음성 안내 (이어폰): 말하기 + 정밀한 안내 문장
//  말하기: 앱(안드로이드·아이폰)은 휴대폰 TTS 네이티브 플러그인 'PinpointAudio' (안드로이드 WebView에는 음성 합성이 없음)
//          → 블루투스·유선 이어폰으로 나가고, 음악은 잠깐 작아짐 · 웹은 speechSynthesis
//  문장: 숫자는 정밀하게 (10m 안은 0.1m, 방향은 0.5° · m), 자세히/간단히 두 단계

const A = () => globalThis.window?.Capacitor?.Plugins?.PinpointAudio || null;
const native = () => !!globalThis.window?.Capacitor?.isNativePlatform?.();
export const audioNative = () => native() && !!A();

// ---------- 숫자·방향을 말로 ----------
// 받침에 맞는 조사: 7번 아이언+으로, 드라이버+로 (ㄹ 받침은 '로')
const jong = w => { const c = String(w).trim().slice(-1).charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : -1; };
export const ro = w => { const j = jong(w); return j > 0 && j !== 8 ? '으로' : '로'; };
export function m(v) { // 거리: 10m 안은 소수 한 자리
  if (v == null || !Number.isFinite(v)) return '';
  const a = Math.abs(v);
  return a < 10 ? `${(Math.round(a * 10) / 10).toFixed(1).replace(/\.0$/, '')}미터` : `${Math.round(a)}미터`;
}
export function deg(v) { const a = Math.round(Math.abs(v) * 2) / 2; return `${String(a).replace(/\.0$/, '')}도`; }
// 내 앞 방향 기준 → 시계 방향 (12시 = 앞)
export function clock(rel) { let h = Math.round(((rel % 360) + 360) % 360 / 30) % 12; return `${h === 0 ? 12 : h}시 방향`; }
// 조준: 깃발 줄에서 왼쪽/오른쪽 몇 도 · 몇 m
export function aimWords(rel, lateral) {
  if (rel == null || Math.abs(rel) < 0.75) return '깃발을 바로 보고 치세요';
  const side = rel > 0 ? '오른쪽' : '왼쪽';
  return lateral && Math.abs(lateral) >= 1 ? `깃발보다 ${side}으로 ${deg(rel)}, 깃발 ${side} ${m(lateral)} 지점을 보고 치세요` : `깃발보다 ${side}으로 ${deg(rel)} 비켜서 보고 치세요`;
}
// 바람 (샷 기준): along + = 뒷바람, cross + = 왼쪽에서 불어 오른쪽으로 밂
export function windWords(along, cross) {
  const sp = Math.hypot(along || 0, cross || 0);
  if (sp < 1) return '';
  const a = Math.abs(along), c = Math.abs(cross), fmt = v => `초속 ${(Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '')}미터`;
  if (a >= c * 1.7) return `${along > 0 ? '뒷바람' : '맞바람'} ${fmt(sp)}`;
  if (c >= a * 1.7) return `${cross > 0 ? '왼쪽' : '오른쪽'}에서 부는 바람 ${fmt(sp)}`;
  return `${along > 0 ? '뒤' : '앞'} ${cross > 0 ? '왼쪽' : '오른쪽'}에서 부는 바람 ${fmt(sp)}`;
}

// ---------- 안내 문장 ----------
// 홀 도착: "3번 홀, 파 4, 380미터, 핸디캡 5. 깃발까지 352미터. 지난번 평균 5.5타, 티샷이 오른쪽으로 자주 갔어요"
export function holeIntro({ name, par, len, hd, toPin, hist, memo, level = 'detail' }) {
  const out = [`${name}, 파 ${par}${len ? `, ${m(len)}` : ''}${hd && level === 'detail' ? `, 핸디캡 ${hd}` : ''}`];
  if (toPin != null && toPin < 700) out.push(`깃발까지 ${m(toPin)}`);
  if (level === 'detail' && hist) out.push(hist);
  if (memo) out.push(`메모: ${memo}`);
  return out.join('. ') + '.';
}

// 치기 전: 거리 · 고저차 · 바람 · 체감 · 클럽 · 스윙 크기 · 조준 · 위험
//  { D, front, back, elev, along, cross, plays, temp, club, swing, power, rel, lateral, carry, rest, hazards:[{name, front, carry, side}], pBad, kind }
export function shotCue(o, level = 'detail') {
  if (o.kind === 'putt') {
    return level === 'detail' ? `그린 위예요. 홀까지 ${m(o.D)}${o.elev != null && Math.abs(o.elev) >= 0.03 ? `, ${o.elev > 0 ? '오르막' : '내리막'} ${Math.round(Math.abs(o.elev) * 100)}센티` : ''}. 퍼팅 계산은 그린 읽기 화면에서 들을 수 있어요.` : `그린 위예요. 홀까지 ${m(o.D)}.`;
  }
  if (level !== 'detail') return `깃발까지 ${m(o.D)}. ${o.club}${ro(o.club)} ${o.swing}. ${aimWords(o.rel, null)}.`;
  const s = [`깃발까지 ${m(o.D)}`];
  if (o.front != null && o.back != null) s[0] += `, 그린 앞 ${m(o.front)}, 뒤 ${m(o.back)}`;
  const env = [];
  if (o.elev != null && Math.abs(o.elev) >= 1) env.push(`${o.elev > 0 ? '오르막' : '내리막'} ${m(o.elev)}`);
  const w = windWords(o.along, o.cross); if (w) env.push(w);
  if (o.temp != null && Math.abs(o.temp) >= 2) env.push(o.temp > 0 ? '추워서 덜 날아가요' : '더워서 더 날아가요');
  if (env.length) s.push(env.join(', '));
  if (o.plays != null && Math.abs(o.plays - o.D) >= 2) s.push(`그래서 ${m(o.plays)}처럼 쳐야 해요`);
  s.push(`${o.club}, ${o.swing}${o.power && o.power < 95 ? `, 힘은 ${o.power}퍼센트` : ''}`);
  if (o.carry != null && o.rest != null && o.rest > 15) s.push(`공중으로 ${m(o.carry)} 날아가고 깃발까지 ${m(o.rest)} 남아요`);
  s.push(aimWords(o.rel, o.lateral));
  for (const z of (o.hazards || []).slice(0, 2)) s.push(z.carry != null ? `${z.name} 앞까지 ${m(z.front)}, 넘기려면 ${m(z.carry)}` : `${z.side} ${z.name} 조심`);
  if (o.pBad != null && o.pBad >= 0.15) s.push(`위험한 곳에 갈 확률 ${Math.round(o.pBad * 100)}퍼센트`);
  return s.join('. ') + '.';
}

// 공 찾으러 걸을 때: 정해 둔 거리를 지날 때만 (150·100·75·50·30·20·10·5m)
export const WALK_MARKS = [150, 100, 75, 50, 30, 20, 10, 5];
export function walkCue(prev, cur, rel = null) {
  if (cur == null) return null;
  if (cur <= 4 && (prev == null || prev > 4)) return '거의 다 왔어요. 주변을 둘러보세요.';
  const mark = WALK_MARKS.find(k => cur <= k && (prev == null || prev > k));
  if (mark == null) return null;
  return `공까지 ${m(cur)}${rel != null ? `, ${clock(rel)}` : ''}.`;
}

// 친 뒤 결과: "7번 아이언, 138미터 날아갔어요. 오른쪽으로 6미터. 평소보다 4미터 짧아요"
export function resultCue({ club, total, lateral, usual, estimated }) {
  const s = [`${club}, ${m(total)}${estimated ? '쯤 갔을 거예요' : ' 날아갔어요'}`];
  if (lateral != null && Math.abs(lateral) >= 3) s.push(`${lateral > 0 ? '오른쪽' : '왼쪽'}으로 ${m(lateral)}`);
  if (usual && !estimated) { const d = total - usual; if (Math.abs(d) >= 4) s.push(`평소보다 ${m(d)} ${d > 0 ? '길어요' : '짧아요'}`); }
  return s.join('. ') + '.';
}

// ---------- 말하기 ----------
let rateOf = () => 1, enabled = () => false;
export function configureVoice({ rate, on }) { if (rate) rateOf = rate; if (on) enabled = on; }
let lastKey = '', lastAt = 0;
// key: 같은 안내 되풀이 막기 (gapMs 안에 같은 key면 안 말함) · force: 음성 안내가 꺼져 있어도 (버튼으로 들을 때)
export async function say(text, { force = false, key = null, gapMs = 8000, flush = true } = {}) {
  if (!text || (!enabled() && !force)) return false;
  const now = Date.now();
  if (key && key === lastKey && now - lastAt < gapMs) return false;
  lastKey = key || ''; lastAt = now;
  const p = A();
  if (native() && p) { try { await p.speak({ text, rate: rateOf(), flush }); return true; } catch { /* 엔진 준비 전 → 웹으로 */ } }
  try {
    if (!('speechSynthesis' in window)) return false;
    if (flush) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 1.02 * rateOf();
    speechSynthesis.speak(u); return true;
  } catch { return false; }
}
export function stopVoice() { try { A()?.stop(); } catch {} try { speechSynthesis.cancel(); } catch {} }

// ---------- 이어폰 ----------
export const ROUTE_WORD = { bluetooth: '블루투스 이어폰', wired: '유선 이어폰', usb: 'USB 이어폰', speaker: '휴대폰 스피커' };
export async function audioRoute() { try { return (await A()?.route()) || null; } catch { return null; } }
export async function onAudio({ route, button }) {
  const p = A(); if (!p) return;
  if (route) await p.addListener('route', route);
  if (button) await p.addListener('button', button);
}
export async function earButtons(on) { try { await A()?.buttons({ on }); } catch {} }
export async function openBluetooth() { try { return await A()?.openBluetooth(); } catch { return { ok: false }; } }
