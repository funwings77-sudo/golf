// GitHub REST 클라이언트 (관리자 발행 = data/ 폴더 커밋)
//  · 토큰은 api.github.com으로만 전송됩니다.
//  · 여러 파일을 커밋 1개로 원자적으로 발행 (Git Data API)
//  · 낙관적 잠금: 편집을 시작할 때 본 파일 sha와 지금 원격 sha가 다르면 ConflictError
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}
export class ConflictError extends Error {
  constructor(paths) { super('다른 관리자가 먼저 수정했습니다: ' + paths.join(', ')); this.paths = paths; }
}

export function utf8ToB64(s) {
  const bytes = new TextEncoder().encode(s); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
// git blob sha1 ("blob <len>\0<content>") — 변경 없는 파일을 다시 커밋하지 않기 위해 사용
export async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text), head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length); all.set(head); all.set(body, head.length);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
export const toJSONText = o => JSON.stringify(o, null, 1) + '\n';

export class GitHub {
  constructor({ owner, repo, branch = 'main', token }) { Object.assign(this, { owner, repo, branch, token }); }
  get base() { return `${API}/repos/${this.owner}/${this.repo}`; }

  async req(url, { method = 'GET', body, raw = false } = {}) {
    const res = await fetch(url.startsWith('http') ? url : this.base + url, {
      method, cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (raw) return res;
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.message || res.statusText;
      const hint = res.status === 401 ? '토큰이 잘못되었거나 만료되었습니다' : res.status === 403 && /rate limit/i.test(msg) ? 'API 호출 한도 초과 — 잠시 후 다시 시도하세요' : res.status === 403 ? '토큰 권한이 부족합니다 (Contents: Read and write 필요)' : res.status === 404 ? '저장소·브랜치·파일을 찾을 수 없습니다 (비공개 저장소라면 토큰 권한 확인)' : '';
      throw new GitHubError(res.status, `GitHub ${res.status}: ${msg}${hint ? ' — ' + hint : ''}`, data);
    }
    return data;
  }

  async verify() {
    const r = await this.req('');
    if (!r.permissions?.push) throw new GitHubError(403, '이 토큰으로는 저장소에 쓸 수 없습니다 (Contents: Read and write 권한 필요)');
    const br = await this.req(`/branches/${encodeURIComponent(this.branch)}`);
    let user = null; try { user = await this.req(`${API}/user`); } catch {}
    return { repo: r, branch: br, user };
  }

  // 파일 읽기 (없으면 null). 1MB 넘는 파일은 blob API로 읽음
  async getFile(path, ref = this.branch) {
    let d;
    try { d = await this.req(`/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`); }
    catch (e) { if (e.status === 404) return null; throw e; }
    if (Array.isArray(d)) throw new GitHubError(400, `${path}는 폴더입니다`);
    let content = d.content;
    if (!content && d.size > 0) content = (await this.req(`/git/blobs/${d.sha}`)).content;
    const text = b64ToUtf8(content || '');
    let json = null; try { json = JSON.parse(text); } catch {}
    return { path, sha: d.sha, text, json, size: d.size };
  }
  async listDir(path) {
    try { return await this.req(`/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`); }
    catch (e) { if (e.status === 404) return []; throw e; }
  }

  // files: { 'data/x.json': '문자열' | null(삭제) }, expected: { path: sha | null(없어야 함) }
  async commit(files, message, expected = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await this.req(`/git/ref/heads/${encodeURIComponent(this.branch)}`);
      const head = ref.object.sha;
      const commit = await this.req(`/git/commits/${head}`);
      // 낙관적 잠금 확인 + 실제로 바뀐 파일만 추림
      const paths = [...new Set([...Object.keys(files), ...Object.keys(expected)])];
      const current = {};
      await Promise.all(paths.map(async p => {
        try { const d = await this.req(`/contents/${encPath(p)}?ref=${head}`); current[p] = Array.isArray(d) ? 'dir' : d.sha; }
        catch (e) { if (e.status === 404) current[p] = null; else throw e; }
      }));
      const conflicts = Object.entries(expected).filter(([p, sha]) => sha !== undefined && (current[p] ?? null) !== (sha ?? null)).map(([p]) => p);
      if (conflicts.length) throw new ConflictError(conflicts);
      const tree = [];
      for (const [p, content] of Object.entries(files)) {
        if (content === null) { if (current[p]) tree.push({ path: p, mode: '100644', type: 'blob', sha: null }); continue; }
        if (current[p] && current[p] === await gitBlobSha(content)) continue; // 동일 내용
        tree.push({ path: p, mode: '100644', type: 'blob', content });
      }
      if (!tree.length) return { sha: head, unchanged: true };
      const newTree = await this.req('/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree } });
      const newCommit = await this.req('/git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [head] } });
      try {
        await this.req(`/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: 'PATCH', body: { sha: newCommit.sha, force: false } });
        return { sha: newCommit.sha, files: tree.map(t => t.path), url: `https://github.com/${this.owner}/${this.repo}/commit/${newCommit.sha}` };
      } catch (e) {
        if (e.status === 422 && attempt < 2) continue; // 그사이 다른 커밋이 들어옴 → 최신 위에서 다시
        throw e;
      }
    }
    throw new GitHubError(409, '브랜치가 계속 바뀌어 커밋하지 못했습니다. 잠시 후 다시 시도하세요');
  }

  commits(path = 'data', n = 30) { return this.req(`/commits?sha=${encodeURIComponent(this.branch)}&path=${encodeURIComponent(path)}&per_page=${n}`); }
  async pages() { try { return await this.req('/pages'); } catch (e) { if (e.status === 404) return null; throw e; } }
  async latestPagesBuild() { try { return await this.req('/pages/builds/latest'); } catch (e) { if (e.status === 404) return null; throw e; } }
  async workflowRuns(n = 5) { try { return (await this.req(`/actions/runs?per_page=${n}`)).workflow_runs; } catch { return []; } }
}
