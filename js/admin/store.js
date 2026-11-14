// 관리자 데이터 저장소
//  · 연결됨: GitHub API로 원격(정본)을 읽고, 커밋으로 발행
//  · 미연결: GitHub Pages의 공개 data/를 읽기 전용으로 표시
//  · 편집 중인 코스는 이 기기에 임시저장(draft) → 발행 시 원격과 비교
import { GitHub, ConflictError, toJSONText, gitBlobSha } from './github.js';
import * as M from './model.js';

const LS = 'pinpoint.admin.';
const lsGet = (k, d) => { try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(LS + k) : localStorage.setItem(LS + k, JSON.stringify(v)); return true; } catch (e) { console.warn('저장 실패', k, e); return false; } };

function defaultConf() {
  const host = location.hostname, seg = location.pathname.split('/').filter(Boolean)[0];
  if (host.endsWith('.github.io')) return { owner: host.split('.')[0], repo: seg && !seg.endsWith('.html') ? seg : host, branch: 'main' };
  return { owner: 'funwings77-sudo', repo: 'golf', branch: 'main' };
}

const listeners = new Set();
export const Store = {
  conf: { ...defaultConf(), ...lsGet('conf', {}) },
  gh: null, user: null, connected: false, connError: null, repoInfo: null,
  catalog: null, catalogSha: undefined,
  notices: null, noticesSha: undefined,
  courses: new Map(),   // id → { data, sha }
  pins: new Map(),      // id → { data, sha }

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit() { listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); },

  get token() { try { return sessionStorage.getItem(LS + 'token') || localStorage.getItem(LS + 'token') || ''; } catch { return ''; } },
  get remembered() { try { return !!localStorage.getItem(LS + 'token'); } catch { return false; } },

  async init() {
    if (this.token) { try { await this.connect(this.token, this.remembered, this.conf); } catch (e) { this.connError = e.message; } }
    this.emit();
  },
  async connect(token, remember, conf = this.conf) {
    const gh = new GitHub({ ...conf, token: token.trim() });
    const info = await gh.verify();
    this.gh = gh; this.user = info.user; this.repoInfo = info.repo; this.connected = true; this.connError = null;
    this.conf = { owner: conf.owner, repo: conf.repo, branch: conf.branch }; lsSet('conf', this.conf);
    try {
      sessionStorage.setItem(LS + 'token', token.trim());
      if (remember) localStorage.setItem(LS + 'token', token.trim()); else localStorage.removeItem(LS + 'token');
    } catch {}
    this.resetCache(); this.emit();
    return info;
  },
  disconnect() {
    try { sessionStorage.removeItem(LS + 'token'); localStorage.removeItem(LS + 'token'); } catch {}
    this.gh = null; this.user = null; this.connected = false; this.repoInfo = null; this.resetCache(); this.emit();
  },
  resetCache() { this.catalog = null; this.catalogSha = undefined; this.notices = null; this.noticesSha = undefined; this.courses.clear(); this.pins.clear(); },
  // 공개 API(토큰 없이): 커밋 이력 등 읽기 전용 조회용
  publicGH() { return this.gh || new GitHub({ ...this.conf }); },

  async read(path) {
    if (this.gh) { const f = await this.gh.getFile(path); return f ? { json: f.json, sha: f.sha } : { json: null, sha: null }; }
    const res = await fetch(new URL(path, location.href).href + '?t=' + Date.now(), { cache: 'no-store' });
    if (res.status === 404) return { json: null, sha: undefined };
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return { json: await res.json(), sha: undefined };
  },
  async loadCatalog(force = false) {
    if (this.catalog && !force) return this.catalog;
    const r = await this.read('data/catalog.json');
    this.catalog = r.json || { format: M.DATA_FORMATS.catalog, version: 1, courses: [] }; this.catalogSha = r.sha;
    return this.catalog;
  },
  async loadNotices(force = false) {
    if (this.notices && !force) return this.notices;
    const r = await this.read('data/notices.json');
    this.notices = r.json || M.noticesFile([]); this.noticesSha = r.sha;
    return this.notices;
  },
  async loadCourse(id, force = false) {
    if (this.courses.has(id) && !force) return this.courses.get(id);
    const r = await this.read(M.coursePath(id));
    const v = { data: r.json?.course || null, sha: r.sha };
    this.courses.set(id, v); return v;
  },
  async loadPins(id, force = false) {
    if (this.pins.has(id) && !force) return this.pins.get(id);
    const r = await this.read(M.pinsPath(id));
    const v = { data: r.json || null, sha: r.sha }; this.pins.set(id, v); return v;
  },

  // ---------- 임시저장 ----------
  draft(id) { return lsGet('draft.' + id, null); },
  saveDraft(id, course, baseRev) { const ok = lsSet('draft.' + id, { course, baseRev, savedAt: Date.now() }); if (!ok) throw new Error('브라우저 저장 공간이 부족합니다 (그린 격자가 너무 큰지 확인)'); },
  dropDraft(id) { lsSet('draft.' + id, null); },
  draftIds() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(LS + 'draft.')) out.push(k.slice((LS + 'draft.').length)); } } catch {}
    return out;
  },
  // 편집 대상: 임시저장이 있으면 그것, 없으면 원격 발행본 사본
  async working(id) {
    const remote = await this.loadCourse(id);
    const d = this.draft(id);
    if (d) return { course: d.course, remote: remote.data, dirty: true, savedAt: d.savedAt, baseRev: d.baseRev };
    return { course: remote.data ? M.clone(remote.data) : null, remote: remote.data, dirty: false };
  },

  // ---------- 발행 ----------
  requireConn() { if (!this.gh) throw new Error('발행하려면 먼저 GitHub에 연결하세요 (연결 설정)'); },
  async publishCourse(course, message) {
    this.requireConn();
    const v = M.validateCourse(course); if (!v.ok) throw new Error(`검증 오류 ${v.errors.length}건을 먼저 고치세요`);
    await this.loadCatalog(); const prev = await this.loadCourse(course.id);
    const out = { ...M.stripForPublish(course), rev: (prev.data?.rev || 0) + 1, updatedAt: new Date().toISOString() };
    const catalog = M.upsertCatalog(this.catalog, M.catalogEntry(out));
    const files = { [M.coursePath(course.id)]: toJSONText(M.courseFile(out)), 'data/catalog.json': toJSONText(catalog) };
    const res = await this.gh.commit(files, message || `[admin] 코스 발행: ${out.name} rev ${out.rev}`, { [M.coursePath(course.id)]: prev.sha ?? null, 'data/catalog.json': this.catalogSha ?? null });
    this.courses.set(course.id, { data: out, sha: await gitBlobSha(files[M.coursePath(course.id)]) });
    this.catalog = catalog; this.catalogSha = await gitBlobSha(files['data/catalog.json']);
    this.dropDraft(course.id); this.emit();
    return { ...res, rev: out.rev };
  },
  async unpublishCourse(id) {
    this.requireConn();
    await this.loadCatalog(); const prev = await this.loadCourse(id, true), pins = await this.loadPins(id, true);
    const catalog = M.removeFromCatalog(this.catalog, id);
    const files = { [M.coursePath(id)]: null, [M.pinsPath(id)]: null, 'data/catalog.json': toJSONText(catalog) };
    const res = await this.gh.commit(files, `[admin] 코스 비공개(삭제): ${id}`, { [M.coursePath(id)]: prev.sha ?? null, [M.pinsPath(id)]: pins.sha ?? null, 'data/catalog.json': this.catalogSha ?? null });
    this.courses.delete(id); this.pins.delete(id); this.catalog = catalog; this.catalogSha = await gitBlobSha(files['data/catalog.json']);
    this.emit(); return res;
  },
  async publishPins(courseId, pinsData) {
    this.requireConn();
    const prev = await this.loadPins(courseId);
    const path = M.pinsPath(courseId), text = toJSONText(pinsData);
    const res = await this.gh.commit({ [path]: text }, `[admin] 오늘의 핀: ${courseId} ${pinsData.date} (스팀프 ${pinsData.stimp})`, { [path]: prev.sha ?? null });
    this.pins.set(courseId, { data: pinsData, sha: await gitBlobSha(text) }); this.emit();
    return res;
  },
  async publishNotices(items, message) {
    this.requireConn();
    await this.loadNotices();
    const data = M.noticesFile(items), text = toJSONText(data);
    const res = await this.gh.commit({ 'data/notices.json': text }, message || `[admin] 공지 갱신 (${items.length}건)`, { 'data/notices.json': this.noticesSha ?? null });
    this.notices = data; this.noticesSha = await gitBlobSha(text); this.emit();
    return res;
  },

  // ---------- 라운드 리포트 (이 기기에만 보관) ----------
  reports() { return lsGet('reports', []); },
  addReports(list) {
    const cur = this.reports(), keys = new Set(cur.map(M.reportKey));
    let added = 0, dup = 0; const bad = [];
    for (const r of list) {
      const err = M.validateReport(r); if (err) { bad.push(err); continue; }
      const k = M.reportKey(r); if (keys.has(k)) { dup++; continue; }
      keys.add(k); cur.push(r); added++;
    }
    cur.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    if (!lsSet('reports', cur.slice(0, 3000))) throw new Error('브라우저 저장 공간이 부족합니다. 오래된 리포트를 삭제하세요');
    return { added, dup, bad };
  },
  clearReports(filter = null) { lsSet('reports', filter ? this.reports().filter(r => !filter(r)) : []); },
};
export { ConflictError };
