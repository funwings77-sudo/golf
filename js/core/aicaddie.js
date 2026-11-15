// AI 캐디 (Gemini): 계산은 PinPoint 엔진, 말은 AI — AI가 만든 숫자는 하나도 그대로 믿지 않음
//  ① 엔진이 계산한 사실(FACTS)만 AI에 보냄 (좌표·이름 없음)
//  ② AI 응답(JSON)의 모든 숫자·클럽·힘·조준을 FACTS와 대조 (verify)
//  ③ 틀린 숫자가 있으면 고쳐 달라고 1번 더 요청 → 그래도 틀리면 엔진 답만 보여 줌
import { generateJSON } from './gemini.js';
import { RULES } from './rules.js';

// ---------- 검증 ----------
export function factNumbers(obj, out = []) {
  if (obj == null) return out;
  if (typeof obj === 'number' && isFinite(obj)) out.push(obj, Math.abs(obj));
  else if (typeof obj === 'string') { for (const m of obj.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(Math.abs(+m[0])); }
  else if (Array.isArray(obj)) obj.forEach(v => factNumbers(v, out));
  else if (typeof obj === 'object') Object.values(obj).forEach(v => factNumbers(v, out));
  return out;
}
const near = (x, set, tol = 1) => set.some(v => Math.abs(x - v) <= tol);
const TOL = { '%': 1, '퍼센트': 1, '°': 0.2, '도': 0.2, 'cm': 2 };
// 숫자 앞뒤 말로 어떤 값인지 알아내서 그 값과 맞는지 확인 (예: "깃발까지 199m" → 깃발 거리와 비교)
const ANCHORS = [
  [/(깃발|핀|홀컵|홀)까지|남(아|은|는)/, f => [f.distances?.to_pin_m, f.distances?.plays_like_m, f.engine?.remaining_m, ...(f.accuracy?.range_m || [])]],
  [/체감|플레이즈/, f => [f.distances?.plays_like_m]],
  [/그린\s*앞/, f => [f.distances?.to_green_front_m]],
  [/그린\s*뒤/, f => [f.distances?.to_green_back_m]],
  [/넘기|건너/, f => (f.hazards || []).map(z => z.carry_m)],
  [/(벙커|물|OB|숲|해저드)[^0-9]{0,6}앞/, f => (f.hazards || []).map(z => z.front_m)],
  [/비거리|날아|보내/, f => [f.engine?.carry_m, ...(f.my_bag || []).map(c => c.carry_m)]],
  [/바람|풍속/, f => [f.weather?.wind_ms, Math.abs(f.weather?.headwind_ms ?? NaN), Math.abs(f.weather?.crosswind_from_right_ms ?? NaN)]],
  [/높이|오르막|내리막|고저/, f => [Math.abs(f.distances?.pin_elevation_m ?? NaN)]],
];
// 글 속 숫자 검사: 단위가 붙은 숫자와 10보다 큰 숫자는 FACTS 값과 ±1 안에서 맞아야 함
export function badNumbers(text, set, facts = null) {
  const bad = [], t = String(text || '');
  for (const m of t.matchAll(/(-?\d+(?:\.\d+)?)\s*(m(?![a-z])|미터|야드|yd|%|퍼센트|°|도|타|cm|초|분|벌타|클럽)?/g)) {
    const x = Math.abs(+m[1]), unit = m[2] || '';
    if (!unit && x <= 10) continue;                       // 1번, 2타 같은 작은 수
    if (/^(타|분|초|벌타|클럽)$/.test(unit) && x <= 10) continue;
    const tol = TOL[unit] ?? 1;
    if (facts && /^(m|미터)$/.test(unit)) {
      const ctx = t.slice(Math.max(0, m.index - 14), m.index) + '|' + t.slice(m.index + m[0].length, m.index + m[0].length + 6);
      const an = ANCHORS.find(([re]) => re.test(ctx));
      if (an) { const vals = an[1](facts).filter(v => v != null && isFinite(v)); if (!near(x, vals, tol)) bad.push(m[0].trim()); continue; }
    }
    if (!near(x, set, tol)) bad.push(m[0].trim());
  }
  return bad;
}
export function verifyCaddie(r, facts) {
  const set = factNumbers(facts), problems = [];
  const texts = [r.answer, ...(r.cautions || [])];
  for (const t of texts) for (const b of badNumbers(t, set, facts)) problems.push(`근거 없는 숫자 "${b}"`);
  const e = facts.engine || {}, bag = (facts.my_bag || []).map(c => c.id);
  if (r.club && !bag.includes(r.club) && r.club !== 'PT') problems.push(`내 가방에 없는 클럽 "${r.club}"`);
  const altIds = (e.alternatives || []).map(a => a.club);
  if (r.club && e.club && r.club !== e.club && !altIds.includes(r.club)) problems.push(`엔진 추천(${e.club})과 다른 클럽 "${r.club}"`);
  if (r.power != null && e.power != null && r.club === e.club && Math.abs(r.power - e.power) > 5) problems.push(`힘 ${r.power}%는 엔진 계산(${e.power}%)과 달라요`);
  if (r.aim_deg != null && e.aim_deg != null && Math.abs(r.aim_deg - e.aim_deg) > 1.5) problems.push(`조준 ${r.aim_deg}°는 엔진 계산(${e.aim_deg}°)과 달라요`);
  if (!String(r.answer || '').trim()) problems.push('빈 답');
  return problems;
}

// ---------- 프롬프트 ----------
const CADDIE_SYS = `너는 골프 앱 PinPoint의 AI 캐디야. 한국어 존댓말로, 초등학생도 알아듣게 짧게(2~3문장) 말해.
반드시 지킬 것:
1) 숫자(거리·힘·각도·높이)는 FACTS JSON에 있는 값만 그대로 써. 새로 계산하거나 짐작한 숫자는 절대 쓰지 마. 숫자가 필요 없으면 쓰지 않아도 돼.
2) 클럽·힘·조준은 FACTS.engine 추천을 기본으로 해. 다른 방법을 말하려면 FACTS.engine.alternatives 안에서만 고르고 이유를 말해. club 칸에는 실제로 권하는 클럽 id를 넣어.
3) power, aim_deg 칸은 engine 값을 그대로 넣어 (다른 클럽을 권하면 power는 비워 둬).
4) FACTS에 없는 정보(공 상태, 그린 빠르기 등)는 모른다고 말하거나 사진이 있을 때만 사진에서 읽어.
5) 위험(OB·물·벙커)이 있으면 cautions에 짧게 적어. 안전 경보(낙뢰·폭염)가 있으면 맨 먼저 말해.
6) accuracy 정보(핀 기준·오차)가 'mid' 이하면 거리가 틀릴 수 있다는 점을 짧게 알려 줘.
7) 사진이 있으면 공이 놓인 상태를 lie 칸에 골라.
8) 방향은 engine.aim_words 표현을 그대로 쓰고, 바람은 weather.along·cross 말과 along_ms·cross_ms 값을 써. 음수(-) 숫자는 말하지 마.
9) 조준 이유는 engine.aim_reason에 있는 것만 말해 (바람 때문이라고 지어내지 마).`;
const CADDIE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING', description: '2~3문장 한국어 답' },
    club: { type: 'STRING', description: '권하는 클럽 id (FACTS.my_bag의 id). 해당 없으면 빈 문자열' },
    power: { type: 'NUMBER', nullable: true }, aim_deg: { type: 'NUMBER', nullable: true },
    lie: { type: 'STRING', enum: ['unknown', 'tee', 'fairway', 'rough', 'deep_rough', 'bunker', 'fringe', 'green', 'bare', 'divot', 'trees', 'slope'] },
    cautions: { type: 'ARRAY', items: { type: 'STRING' } },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
  },
  required: ['answer', 'club', 'lie', 'cautions', 'confidence'],
};
export const LIE_KO = { unknown: '', tee: '티', fairway: '페어웨이', rough: '러프', deep_rough: '깊은 러프', bunker: '벙커', fringe: '그린 주변', green: '그린', bare: '맨땅', divot: '디봇 자국', trees: '나무 아래', slope: '경사면' };
const LIE_NOTE = { rough: '러프에서는 공이 덜 날아갈 수 있어요. 한 클럽 길게 생각해 보세요.', deep_rough: '깊은 러프예요. 무리하지 말고 페어웨이로 꺼내는 게 안전해요.', bunker: '벙커예요. 클럽이 모래에 닿지 않게 조심하세요 (닿으면 벌타).', bare: '맨땅이에요. 공을 먼저 깨끗하게 맞히세요.', divot: '디봇 자국 안이에요. 공을 오른발 쪽에 두고 눌러 치세요.', trees: '나무 아래예요. 낮게 굴려 빠져나오는 게 안전해요.', slope: '경사면이에요. 몸을 경사에 맞추고 균형을 지키세요.' };

// 엔진만으로 만든 답 (AI가 틀릴 때·키가 없을 때)
export function engineAnswer(f) {
  const e = f.engine;
  if (!e?.club) return `깃발까지 ${f.distances?.to_pin_m ?? '—'}m예요.`;
  const dir = !e.aim_deg ? '깃발 쪽으로 똑바로' : `깃발보다 ${e.aim_deg > 0 ? '오른쪽' : '왼쪽'}으로 ${Math.abs(e.aim_deg)}°`;
  return `${e.club_name}로 힘 ${e.power}%, ${dir} 보고 쳐요. ${e.carry_m}m 날아가면 깃발까지 ${e.remaining_m}m 남아요.`;
}

export async function askCaddie(facts, question, imageParts = []) {
  const userText = `FACTS = ${JSON.stringify(facts)}\n\n질문: ${question}`;
  let { data, model } = await generateJSON({ system: CADDIE_SYS, parts: [{ text: userText }, ...imageParts], schema: CADDIE_SCHEMA, temperature: 0.2 });
  let problems = verifyCaddie(data, facts), retried = false;
  if (problems.length) {
    retried = true;
    const fix = await generateJSON({ system: CADDIE_SYS, parts: [{ text: userText + `\n\n이전 답에 문제가 있었어: ${problems.join(' / ')}. FACTS에 있는 숫자만 써서 다시 답해.` }, ...imageParts], schema: CADDIE_SCHEMA, temperature: 0 });
    data = fix.data; problems = verifyCaddie(data, facts);
  }
  const ok = !problems.length;
  return {
    ok, model, retried, problems,
    answer: ok ? data.answer : engineAnswer(facts),
    cautions: ok ? (data.cautions || []).slice(0, 3) : [],
    club: ok ? data.club : facts.engine?.club, confidence: data.confidence, lie: data.lie || 'unknown',
    lieNote: LIE_NOTE[data.lie] || '',
  };
}

// ---------- 라운드 분석 ----------
const REVIEW_SYS = `너는 골프 코치야. FACTS(내 라운드 통계)만 보고 한국어 존댓말로 쉽게 분석해.
숫자는 FACTS에 있는 값만 그대로 써. 새 통계를 계산하거나 짐작하지 마. 자료가 부족하면 부족하다고 말해.
drills에는 다음 라운드 전에 할 연습 2개를 구체적인 목표와 함께 적어.`;
const REVIEW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' }, strengths: { type: 'ARRAY', items: { type: 'STRING' } }, weaknesses: { type: 'ARRAY', items: { type: 'STRING' } },
    drills: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, how: { type: 'STRING' }, goal: { type: 'STRING' } }, required: ['title', 'how', 'goal'] } },
  },
  required: ['summary', 'strengths', 'weaknesses', 'drills'],
};
export async function reviewRounds(facts) {
  const set = factNumbers(facts), check = d => [d.summary, ...(d.strengths || []), ...(d.weaknesses || [])].flatMap(t => badNumbers(t, set));
  const parts = [{ text: `FACTS = ${JSON.stringify(facts)}` }];
  let { data, model } = await generateJSON({ system: REVIEW_SYS, parts, schema: REVIEW_SCHEMA, temperature: 0.3, maxTokens: 1500 });
  let bad = check(data);
  if (bad.length) { ({ data } = await generateJSON({ system: REVIEW_SYS, parts: [{ text: parts[0].text + `\n\n이전 답의 근거 없는 숫자: ${bad.join(', ')}. FACTS 숫자만 써서 다시.` }], schema: REVIEW_SCHEMA, temperature: 0, maxTokens: 1500 })); bad = check(data); }
  return { ok: !bad.length, bad, model, ...data, drills: (data.drills || []).slice(0, 2) };
}

// ---------- 규칙 질문 (PinPoint 규칙 요약에 근거) ----------
const RULE_SYS = `너는 골프 규칙 도우미야. RULES(2023 골프 규칙 요약) 안의 내용만 근거로 한국어 존댓말로 쉽게 답해.
RULES에 없는 상황이면 needs_referee를 true로 하고 "경기위원·공식 규칙서 확인"을 권해. 벌타 수와 규칙 번호는 RULES에 있는 값만 써.`;
const RULE_SCHEMA = {
  type: 'OBJECT',
  properties: { answer: { type: 'STRING' }, rule_ids: { type: 'ARRAY', items: { type: 'STRING' } }, penalty_strokes: { type: 'NUMBER', nullable: true }, needs_referee: { type: 'BOOLEAN' }, confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] } },
  required: ['answer', 'rule_ids', 'needs_referee', 'confidence'],
};
export async function askRule(question, imageParts = []) {
  const facts = RULES.map(r => ({ id: r.id, title: r.title, rule: r.rule, penalty: r.penalty, alt: r.altLabel, steps: r.steps }));
  const { data, model } = await generateJSON({ system: RULE_SYS, parts: [{ text: `RULES = ${JSON.stringify(facts)}\n\n질문: ${question}` }, ...imageParts], schema: RULE_SCHEMA, temperature: 0.1 });
  const ids = new Set(RULES.map(r => r.id)), set = factNumbers(facts), problems = [];
  const cited = (data.rule_ids || []).filter(x => ids.has(x));
  if ((data.rule_ids || []).length !== cited.length) problems.push('없는 규칙 항목 인용');
  for (const b of badNumbers(data.answer, set)) problems.push(`근거 없는 숫자 "${b}"`);
  if (data.penalty_strokes != null && !cited.some(id => { const r = RULES.find(x => x.id === id); return r.penalty === data.penalty_strokes || r.altPenalty === data.penalty_strokes; })) problems.push('벌타 수가 규칙 요약과 달라요');
  return { ok: !problems.length, problems, model, ...data, rules: cited.map(id => RULES.find(r => r.id === id)) };
}
