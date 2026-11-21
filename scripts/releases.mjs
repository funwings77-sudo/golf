// 버전별 APK: GitHub Releases에 올리고 releases.json(다운로드 페이지가 읽는 목록)을 갱신
//   import { publishRelease } from './releases.mjs'  ← release-apk.mjs에서 사용
//   node scripts/releases.mjs backfill <dir>         ← 과거 버전 일괄 등록 (pinpoint-caddie-<버전>.apk)
//   node scripts/releases.mjs notes <버전> "줄1" "줄2" ← 이미 올린 버전의 노트 고치기 (GitHub 릴리스 + releases.json)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'funwings77-sudo/golf';
const FILE = join(root, 'releases.json');

export function ghPath() {
  for (const p of ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe']) { try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return p; } catch {} }
  throw new Error('GitHub CLI(gh)가 없습니다. 설치 후 gh auth login 하세요');
}
const gh = (args, opts = {}) => execFileSync(ghPath(), args, { cwd: root, encoding: 'utf8', ...opts });

export function loadReleases() { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { format: 'pinpoint-releases', version: 1, repo: REPO, releases: [] }; }
export function saveReleases(r) {
  r.releases.sort((a, b) => b.code - a.code);
  r.latest = r.releases[0]?.version || null; r.updatedAt = new Date().toISOString();
  writeFileSync(FILE, JSON.stringify(r, null, 1) + '\n');
}

// GitHub 릴리스 본문
const relBody = (version, code, notes, sha256) => [`PinPoint AI 캐디 Android ${version} (versionCode ${code})`, '', ...notes.map(n => `- ${n}`), '', `SHA-256: \`${sha256}\``].join('\n');
export const hasKorean = notes => notes.length > 0 && notes.every(n => /[가-힣]/.test(n));

// 📝 사용자에게 보여 줄 한국어 노트 (release-apk.mjs): ① --notes "줄" (여러 번) ② release-notes.md의 '- ' 줄
export const NOTES_FILE = join(root, 'release-notes.md');
export const NOTES_TEMPLATE = "# 다음 APK 릴리스 노트 (한국어)\n# 사용자에게 보이는 변경 내용을 한 줄에 하나씩 '- '로 적으면 npm run release:apk가 씁니다. 릴리스 뒤 비워집니다.\n";
export function pendingNotes(argv = process.argv) {
  const cli = []; for (let i = 0; i < argv.length; i++) if (argv[i] === '--notes' && argv[i + 1]) cli.push(...argv[++i].split('|').map(s => s.trim()).filter(Boolean));
  if (cli.length) return { notes: cli, from: '--notes' };
  if (existsSync(NOTES_FILE)) {
    const f = readFileSync(NOTES_FILE, 'utf8').split(/\r?\n/).filter(l => /^\s*-\s+\S/.test(l)).map(l => l.replace(/^\s*-\s+/, '').trim());
    if (f.length) return { notes: f, from: 'release-notes.md' };
  }
  return { notes: [], from: null };
}

// 이미 올린 버전의 노트 바꾸기
export function setNotes(version, notes) {
  const r = loadReleases(), rel = r.releases.find(x => x.version === version);
  if (!rel) throw new Error(`releases.json에 ${version}이 없습니다`);
  rel.notes = notes; saveReleases(r);
  gh(['release', 'edit', `v${version}`, '-R', REPO, '--notes', relBody(version, rel.code, notes, rel.sha256)]);
  return rel;
}

export function publishRelease({ version, code, apkPath, notes = [], date = new Date().toISOString(), commit = 'main' }) {
  const tag = `v${version}`, name = `pinpoint-caddie-${version}.apk`;
  commit = execFileSync('git', ['rev-parse', commit], { cwd: root, encoding: 'utf8' }).trim(); // GitHub API는 전체 SHA 필요
  const buf = readFileSync(apkPath), sha256 = createHash('sha256').update(buf).digest('hex');
  const body = [`PinPoint AI 캐디 Android ${version} (versionCode ${code})`, '', ...notes.map(n => `- ${n}`), '', `SHA-256: \`${sha256}\``].join('\n');
  const tmp = join(dirname(apkPath), name);
  if (basename(apkPath) !== name) writeFileSync(tmp, buf);
  let exists = true; try { gh(['release', 'view', tag, '-R', REPO], { stdio: 'ignore' }); } catch { exists = false; }
  if (exists) gh(['release', 'upload', tag, tmp, '--clobber', '-R', REPO]);
  else gh(['release', 'create', tag, tmp, '-R', REPO, '--target', commit, '--title', `PinPoint ${version}`, '--notes', body]);
  const r = loadReleases();
  r.releases = r.releases.filter(x => x.version !== version);
  r.releases.push({ version, code, date, bytes: statSync(apkPath).size, sha256, url: `https://github.com/${REPO}/releases/download/${tag}/${name}`, page: `https://github.com/${REPO}/releases/tag/${tag}`, notes });
  saveReleases(r);
  return r;
}

// 마지막 릴리스 태그 이후의 기능 커밋 제목 → 변경 내용
export function notesSince(prevTag) {
  let range = 'HEAD';
  try { if (prevTag) { execFileSync('git', ['rev-parse', prevTag], { cwd: root, stdio: 'ignore' }); range = `${prevTag}..HEAD`; } } catch {}
  return execFileSync('git', ['log', '--format=%s', range], { cwd: root, encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(s => s && !/^Android APK \d/.test(s)).slice(0, 8);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv[2] === 'notes') {
  const [, , , version, ...notes] = process.argv;
  if (!version || !notes.length) { console.error('사용법: node scripts/releases.mjs notes <버전> "줄1" "줄2"'); process.exit(1); }
  setNotes(version, notes); console.log(`v${version} 노트 ${notes.length}줄로 바꿈`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv[2] === 'backfill') {
  const dir = process.argv[3];
  const HIST = [
    { version: '1.0.0', code: 1, commit: 'c67f2ba', date: '2026-11-14T18:13:34+09:00', notes: ['첫 Android 앱: 거리(GPS·핀·플레이즈라이크) · 라이 경사 · 그린 리딩 · 퍼팅 계산 · 티샷 공략 · 분실구 안내', '스코어·내기 정산, 룰·구제 도우미, 낙뢰·폭염 경보, 오프라인 지도'] },
    { version: '1.0.1', code: 2, commit: '7750113', date: '2026-11-14T22:29:05+09:00', notes: ['골프장 관리자 연동: 공식 코스 설치·업데이트', '오늘의 핀·그린 스피드 자동 적용, 골프장 공지 경보 바', '골프장 제출용 라운드 리포트(비식별)'] },
    { version: '1.0.2', code: 3, commit: 'a672369', date: '2026-11-15T00:50:20+09:00', notes: ['쉬운 플레이: 골프장 → 코스 → 거리·클럽·힘·방향 → 친 공 위치', '2D · 3D 지형 · 4D(공 비행·플라이오버) · AR 카메라 보기', '27·36홀 골프장 코스 선택'] },
    { version: '1.0.3', code: 4, commit: '675a7a5', date: '2026-11-15T00:56:16+09:00', notes: ['3D 지형 위에 정밀 측량 그린맵(경사·등고선) 겹치기', 'AR 🩺 점검(센서·나침반·GPS 상태와 예상 오차)', '추천 카드에 비거리 학습 상태 표시'] },
    { version: '1.0.4', code: 5, commit: '7c8a100', date: '2026-11-15T01:34:20+09:00', notes: ['전국 골프장 209곳 검색·정보(KGBA 회원사 DB)', '스코어카드 공식 코스 19곳(파·핸디캡·티별 거리·공략)', '지도에서 그린 위치 한 번 지정'] },
    { version: '1.0.5', code: 6, commit: '27d78e3', date: '2026-11-15T09:17:47+09:00', notes: ['최신 코드로 다시 빌드 (앱 기능은 1.0.4와 같음)'] },
  ];
  for (const h of HIST) { publishRelease({ ...h, apkPath: join(dir, `pinpoint-caddie-${h.version}.apk`) }); console.log('등록', h.version); }
}
