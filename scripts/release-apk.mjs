// APK 재빌드 + GitHub Pages 업로드를 한 번에: npm run release:apk [-- --no-push]
// 1) 엔진 테스트 → 2) 버전 자동 증가 → 3) www 생성·cap sync → 4) Gradle 빌드
// 5) pinpoint-caddie.apk 교체 → 6) 커밋·푸시 → 7) Pages에서 같은 파일이 받아지는지 확인
import { execSync } from 'node:child_process';
import { readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { androidEnv } from './android-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const push = !process.argv.includes('--no-push');
const PAGES_URL = 'https://funwings77-sudo.github.io/golf/pinpoint-caddie.apk';
const env = await androidEnv(root); // JDK·SDK 자동 탐색 (환경변수 → 기본 설치 경로)

const step = (n, msg) => console.log(`\n[${n}/7] ${msg}`);
const run = (cmd, cwd = root) => execSync(cmd, { cwd, env, stdio: 'inherit' });
const out = cmd => execSync(cmd, { cwd: root, env, encoding: 'utf8' }).trim();
const sha = buf => createHash('sha256').update(buf).digest('hex');

// 다른 작업 중인 변경이 섞여 커밋되지 않도록, APK·버전 파일만 커밋한다.
// 단, 웹 코드에 커밋 안 된 변경이 있으면 APK와 저장소 내용이 어긋나므로 먼저 알린다.
const dirty = out('git status --porcelain').split('\n').filter(Boolean)
  .filter(l => !/pinpoint-caddie\.apk$|apk\.json$|releases\.json$|android\/app\/build\.gradle$/.test(l));
if (dirty.length && push) {
  console.warn('⚠ 커밋되지 않은 변경이 있습니다 (APK에는 포함되지만 커밋되지 않음):\n  ' + dirty.join('\n  '));
}

step(1, '엔진 테스트');
run('npm test');

step(2, '앱 버전 증가');
const gradlePath = join(root, 'android', 'app', 'build.gradle');
let gradle = await readFile(gradlePath, 'utf8');
const code = +gradle.match(/versionCode (\d+)/)[1] + 1;
const name = `1.0.${code - 1}`;
gradle = gradle.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "${name}"`);
await writeFile(gradlePath, gradle);
console.log(`versionCode ${code}, versionName ${name}`);
// 앱 안에서 새 버전을 알 수 있게 내 버전을 기록
await writeFile(join(root, 'js', 'core', 'appver.js'), `// 앱(APK) 버전 — scripts/release-apk.mjs가 빌드할 때마다 자동으로 바꿉니다\nexport const APP_VERSION = { name: '${name}', code: ${code} };\n`);

step(3, '웹 자산 → Android 동기화');
run('npm run android:sync');

step(4, 'Gradle 빌드 (assembleDebug)');
run(`"${join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}" assembleDebug`, join(root, 'android'));

step(5, 'pinpoint-caddie.apk 교체');
const built = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const target = join(root, 'pinpoint-caddie.apk');
await copyFile(built, target);
const hash = sha(await readFile(target));
const bytes = (await stat(target)).size;
console.log(`${(bytes / 1048576).toFixed(1)}MB  sha256 ${hash.slice(0, 16)}…`);
// 다운로드 페이지(download.html)가 읽는 버전 정보
const appId = JSON.parse(await readFile(join(root, 'capacitor.config.json'), 'utf8')).appId;
await writeFile(join(root, 'apk.json'), JSON.stringify({
  packageId: appId, versionName: name, versionCode: code, bytes, sha256: hash, builtAt: new Date().toISOString(),
}, null, 2) + '\n');

if (!push) { console.log('\n--no-push: 커밋·업로드 생략. 완료.'); process.exit(0); }

step(6, 'GitHub 릴리스(버전별 다운로드) · 커밋 · 푸시');
run('git push'); // 릴리스 태그가 가리킬 커밋을 먼저 GitHub에 올림 (안 하면 릴리스 등록 실패)
// 버전별 다운로드: 이전 릴리스 이후 변경 내용을 노트로 GitHub Releases에 올리고 releases.json 갱신
try {
  const R = await import('./releases.mjs');
  const prev = R.loadReleases().releases.sort((a, b) => b.code - a.code)[0];
  const notes = R.notesSince(prev ? `v${prev.version}` : null);
  R.publishRelease({ version: name, code, apkPath: target, notes: notes.length ? notes : ['안정성 개선'] });
  console.log(`릴리스 v${name} 등록 · 노트 ${notes.length}줄`);
} catch (e) { console.warn('⚠ GitHub 릴리스 등록 실패(최신 다운로드는 계속 제공): ' + e.message); }
run('git add pinpoint-caddie.apk apk.json releases.json android/app/build.gradle js/core/appver.js');
const who = out('git config user.name') ? '' : '-c user.name="PinPoint" -c user.email="noreply@users.noreply.github.com" ';
run(`git ${who}commit -q -m "Android APK ${name} (versionCode ${code})"`);
run('git push');

step(7, 'GitHub Pages 반영 확인 (최대 6분)');
const deadline = Date.now() + 6 * 60_000;
for (;;) {
  try {
    const r = await fetch(`${PAGES_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (r.ok && sha(Buffer.from(await r.arrayBuffer())) === hash) {
      console.log(`✅ 다운로드 확인 완료: ${PAGES_URL}  (버전 ${name})`);
      break;
    }
  } catch {}
  if (Date.now() > deadline) {
    console.log(`⏳ 아직 이전 파일이 제공 중입니다. 몇 분 뒤 다시 받아 보세요: ${PAGES_URL}`);
    break;
  }
  process.stdout.write('.');
  await new Promise(r => setTimeout(r, 10_000));
}
