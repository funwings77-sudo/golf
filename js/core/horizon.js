// ⛰️ 능선(스카이라인)·앞 능선·가려짐: 내 눈에서 보이는 지형의 윤곽
//  방위마다(1°) 30m~10km를 2%씩 늘려 가며 '올려다보는 기울기' t = (땅 높이 − 곡률 낮아짐 − 눈높이) / 거리 를 구하고
//   · 가장 큰 t = 그 방향의 능선(하늘과 맞닿는 선)
//   · 새 최대가 되었다가 다시 낮아지는 곳 = 보이는 앞 능선 마루
//   · 거리 s의 점은 t(s) ≥ (s 앞까지의 최대 t) 일 때만 보임 → 거리선·지형 격자를 언덕 뒤에서 숨김
import { destination } from './geo.js';
import { curvDrop } from './arproj.js';

export const AZ_STEP = 1;
// 한 방위의 옆모습: ground(s) = 내 발밑 기준 땅 높이(m)
export function profile(ground, eye, { minS = 30, maxS = 10000, k = 1.02 } = {}) {
  const S = [], M = [], crest = [];
  let run = -Infinity, prevT = null, prevS = 0, rising = false;
  for (let s = minS; s <= maxS; s = s * k + 1) {
    const g = ground(s);
    if (!Number.isFinite(g)) { S.push(s); M.push(run); continue; }
    const t = (g - curvDrop(s) - eye) / s;
    if (t > run) { run = t; rising = true; }
    else if (rising && prevT != null && t < prevT) { crest.push({ s: prevS, t: prevT }); rising = false; } // 보이는 마루를 지나 내려감
    S.push(s); M.push(run); prevT = t; prevS = s;
  }
  // 능선 = 가장 높이 올려다보이는 곳
  let best = -1; for (let i = 0; i < M.length; i++) if (best < 0 || M[i] > M[best]) best = i;
  const sky = best >= 0 && Number.isFinite(M[best]) ? { s: S[best], t: M[best] } : null;
  // 마루 중 능선과 같은 것 · 너무 낮은 것(0.3% 미만으로 솟은 것) 빼기
  const crests = crest.filter(c => !sky || Math.abs(c.s - sky.s) > sky.s * 0.05);
  return { S: Float32Array.from(S), M: Float32Array.from(M), sky, crests };
}

// 거리 s의 점이 보이나: 올려다보는 기울기 t가 s 바로 앞까지의 최대보다 크거나 같으면
export function visibleIn(prof, s, t, tol = 0.0015) {
  if (!prof) return true;
  const S = prof.S; if (!S.length || s <= S[0]) return true;
  let lo = 0, hi = S.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m] < s * 0.985) lo = m; else hi = m - 1; }
  return t >= prof.M[lo] - tol;
}

// 360° 전체 (조금씩 나눠 계산해서 화면이 멈추지 않게) → { at(az) → 옆모습, ridges: [[{az, s, t}…]] }
export async function buildHorizon({ me, eye, hgt, maxS = 10000, chunk = 24, yieldFn = () => new Promise(r => setTimeout(r, 0)) }) {
  const profs = new Array(360 / AZ_STEP);
  for (let i = 0; i < profs.length; i++) {
    const az = i * AZ_STEP;
    profs[i] = profile(s => hgt(destination(me, az, s)), eye, { maxS });
    if (i % chunk === chunk - 1) await yieldFn();
  }
  return { me, eye, profs, at: az => profs[Math.round((((az % 360) + 360) % 360) / AZ_STEP) % profs.length], ridges: linkCrests(profs) };
}

// 옆 방위의 마루끼리 거리가 비슷하면(12% 안) 이어서 앞 능선 선으로
export function linkCrests(profs) {
  const lines = [], open = [];
  for (let i = 0; i <= profs.length; i++) {
    const az = (i % profs.length) * AZ_STEP, cs = profs[i % profs.length]?.crests || [];
    const used = new Set();
    for (const ln of open) {
      const last = ln.at(-1);
      let bi = -1, bd = Infinity;
      cs.forEach((c, j) => { if (used.has(j)) return; const d = Math.abs(c.s - last.s) / last.s; if (d < 0.12 && d < bd) { bd = d; bi = j; } });
      if (bi >= 0) { used.add(bi); ln.push({ az: i * AZ_STEP, s: cs[bi].s, t: cs[bi].t }); ln.alive = true; } else ln.alive = false;
    }
    for (let k = open.length - 1; k >= 0; k--) if (!open[k].alive) { if (open[k].length >= 3) lines.push(open[k]); open.splice(k, 1); }
    if (i < profs.length) cs.forEach((c, j) => { if (!used.has(j)) { const ln = [{ az, s: c.s, t: c.t }]; ln.alive = true; open.push(ln); } });
  }
  for (const ln of open) if (ln.length >= 3) lines.push(ln);
  return lines;
}
