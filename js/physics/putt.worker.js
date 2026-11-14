// 퍼팅 역문제 계산을 UI 스레드 밖에서 실행 (긴 퍼트 ~1초)
import { optimizePutt, buildSurface } from './putt.js';

self.onmessage = e => {
  const { id, spec, mu, ball, hole, skill } = e.data;
  try {
    const surf = buildSurface(spec);
    const r = optimizePutt(surf, mu, ball, hole, skill, { bounds: surf.bounds || null });
    self.postMessage({ id, ok: true, r });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
