// Google Gemini API 연결 (브라우저 → generativelanguage.googleapis.com 직접 호출)
//  · API 키는 이 휴대폰에만 저장 (공개 사이트에 키를 넣으면 누구나 훔쳐 쓸 수 있으므로 사용자 본인 키 사용)
//  · 구조화 출력(JSON 스키마) · 낮은 temperature · 시간 제한 · 자동 재시도 · 모델 자동 선택
const API = 'https://generativelanguage.googleapis.com/v1beta';
const K_KEY = 'pinpoint.geminiKey', K_MODEL = 'pinpoint.geminiModel', K_USE = 'pinpoint.geminiUsage';

const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
export const getKey = () => ls.get(K_KEY) || '';
export const setKey = k => ls.set(K_KEY, (k || '').trim() || null);
export const getModel = () => ls.get(K_MODEL) || '';
export const setModel = m => ls.set(K_MODEL, m || null);
export const hasKey = () => /^[A-Za-z0-9_\-]{20,}$/.test(getKey());

export class GeminiError extends Error {
  constructor(code, msg, retry = false) { super(msg); this.code = code; this.retry = retry; }
}
// 사용자에게 보여 줄 쉬운 설명
function explain(status, body) {
  const reason = body?.error?.details?.find?.(d => d.reason)?.reason || body?.error?.status || '';
  const m = body?.error?.message || '';
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(reason + m)) return new GeminiError('key', 'API 키가 올바르지 않아요. 설정에서 키를 다시 넣어 주세요');
  if (status === 400) return new GeminiError('bad', '요청 형식 오류: ' + m.slice(0, 120));
  if (status === 401 || status === 403) return new GeminiError('perm', 'API 키에 권한이 없어요 (Generative Language API 사용 설정 확인)');
  if (status === 404) return new GeminiError('model', '선택한 AI 모델을 찾을 수 없어요. 설정에서 [연결 시험]을 다시 눌러 주세요');
  if (status === 429) return new GeminiError('quota', '잠시 사용량이 많아요. 조금 뒤 다시 시도해 주세요', true);
  if (status >= 500) return new GeminiError('server', 'Google AI 서버가 잠시 불안정해요', true);
  return new GeminiError('http', `오류 ${status}: ${m.slice(0, 100)}`);
}

async function req(path, { method = 'GET', body, timeout = 25000, key = getKey() } = {}) {
  if (!navigator.onLine) throw new GeminiError('offline', '인터넷에 연결되어 있지 않아요');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(API + path, { method, signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw explain(r.status, j);
    return j;
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if (e.name === 'AbortError') throw new GeminiError('timeout', '응답이 너무 늦어요 (신호가 약한 곳일 수 있어요)', true);
    throw new GeminiError('net', '연결 실패: ' + e.message, true);
  } finally { clearTimeout(t); }
}

// 사용 가능한 모델 중 빠르고 안정적인 'flash' 계열 최신 정식판을 자동 선택
export function pickModel(models) {
  const ok = models.filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini-/.test(n) && !/(tts|image|live|audio|embed|thinking|learnlm|aqa|robotics|computer)/i.test(n));
  const ver = n => +(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || 0);
  const score = n => ver(n) * 100 + (/flash/.test(n) ? 20 : /pro/.test(n) ? 5 : 0) - (/lite/.test(n) ? 8 : 0) - (/(preview|exp)/.test(n) ? 1000 : 0) - (/-\d{3}$/.test(n) ? 1 : 0);
  return ok.sort((a, b) => score(b) - score(a))[0] || null;
}
export async function testConnection(key = getKey()) {
  const j = await req('/models?pageSize=200', { key, timeout: 15000 });
  const model = pickModel(j.models || []);
  if (!model) throw new GeminiError('model', '이 키로 쓸 수 있는 Gemini 모델이 없어요');
  return { model, count: (j.models || []).length };
}

// 생성: system 지시 + 사용자 내용(글·사진) → JSON (스키마 강제)
export async function generateJSON({ system, parts, schema, temperature = 0.2, maxTokens = 1024 }) {
  if (!hasKey()) throw new GeminiError('nokey', 'Gemini API 키가 없어요. ☰ → 설정 → AI 캐디에서 넣어 주세요');
  let model = getModel();
  if (!model) { model = (await testConnection()).model; setModel(model); }
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, topP: 0.8, maxOutputTokens: maxTokens, responseMimeType: 'application/json', responseSchema: schema },
  };
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const j = await req(`/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', body });
      const c = j.candidates?.[0];
      if (!c) throw new GeminiError('blocked', j.promptFeedback?.blockReason ? 'AI가 이 질문에 답하지 않았어요 (' + j.promptFeedback.blockReason + ')' : 'AI 응답이 비어 있어요');
      if (c.finishReason && !['STOP', 'MAX_TOKENS'].includes(c.finishReason)) throw new GeminiError('blocked', 'AI가 답을 멈췄어요 (' + c.finishReason + ')');
      const text = (c.content?.parts || []).map(p => p.text || '').join('');
      let data; try { data = JSON.parse(text); } catch { throw new GeminiError('parse', 'AI 응답 형식이 올바르지 않아요', true); }
      usage(j.usageMetadata);
      return { data, model };
    } catch (e) {
      last = e;
      if (e.code === 'model' && i === 0) { setModel(''); model = (await testConnection()).model; setModel(model); continue; }
      if (!e.retry) throw e;
      await new Promise(r => setTimeout(r, 800 * 3 ** i));
    }
  }
  throw last;
}
function usage(u) {
  if (!u) return;
  try { const d = JSON.parse(ls.get(K_USE) || '{}'), day = new Date().toISOString().slice(0, 10); if (d.day !== day) { d.day = day; d.n = 0; d.tok = 0; } d.n++; d.tok += u.totalTokenCount || 0; ls.set(K_USE, JSON.stringify(d)); } catch {}
}
export function usageToday() { try { const d = JSON.parse(ls.get(K_USE) || '{}'); return d.day === new Date().toISOString().slice(0, 10) ? d : { n: 0, tok: 0 }; } catch { return { n: 0, tok: 0 }; } }

// 사진 → base64 JPEG (긴 변 1024px로 줄여 전송량·속도 개선)
export async function imagePart(file, max = 1024) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const data = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
  return { inline_data: { mime_type: 'image/jpeg', data } };
}
