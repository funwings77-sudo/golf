// Google Play 업로드용 AAB 빌드: npm run release:aab
// 1) 업로드 키 확인 → 2) 엔진 테스트 → 3) 버전 증가(APK와 같은 번호 체계) → 4) www 생성·cap sync
// 5) Play 판 표시(dist: 'play' → 앱 안 APK 업데이트 안내 끔) → 6) bundleRelease → 7) release/에 복사·서명 확인 → 커밋(푸시 안 함)
//  업로드 키: ~/.android/pinpoint-upload.properties (PINPOINT_UPLOAD_PROPS로 변경). 저장소에 올리지 말 것.
import { execSync } from 'node:child_process';
import { readFile, writeFile, copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { androidEnv } from './android-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = await androidEnv(root);
const step = (n, msg) => console.log(`\n[${n}/7] ${msg}`);
const run = (cmd, cwd = root) => execSync(cmd, { cwd, env, stdio: 'inherit' });

step(1, '업로드 키 확인');
const propsPath = env.PINPOINT_UPLOAD_PROPS || join(homedir(), '.android', 'pinpoint-upload.properties');
if (!existsSync(propsPath)) throw new Error(`업로드 키 설정이 없습니다: ${propsPath}`);
const props = Object.fromEntries((await readFile(propsPath, 'utf8')).split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (!existsSync(props.storeFile)) throw new Error(`키스토어 파일이 없습니다: ${props.storeFile}`);
console.log('키스토어:', props.storeFile, '· 별칭', props.keyAlias);

step(2, '엔진 테스트');
run('npm test');

step(3, '앱 버전 증가');
const gradlePath = join(root, 'android', 'app', 'build.gradle');
let gradle = await readFile(gradlePath, 'utf8');
const code = +gradle.match(/versionCode (\d+)/)[1] + 1;
const name = `1.0.${code - 1}`;
gradle = gradle.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "${name}"`);
await writeFile(gradlePath, gradle);
const appver = dist => `// 앱(APK) 버전 — scripts/release-apk.mjs가 빌드할 때마다 자동으로 바꿉니다\nexport const APP_VERSION = { name: '${name}', code: ${code}${dist ? `, dist: '${dist}'` : ''} };\n`;
await writeFile(join(root, 'js', 'core', 'appver.js'), appver());
console.log(`versionCode ${code}, versionName ${name}`);

step(4, '웹 자산 → Android 동기화');
run('npm run android:sync');

step(5, 'Play 판 표시 (앱 안 APK 업데이트 안내 끔)');
await writeFile(join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'js', 'core', 'appver.js'), appver('play'));

step(6, 'Gradle 빌드 (bundleRelease, 업로드 키 서명)');
run(`"${join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}" bundleRelease`, join(root, 'android'));

step(7, 'release/ 에 복사 · 서명 확인 · 커밋');
const built = join(root, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
await mkdir(join(root, 'release'), { recursive: true });
const target = join(root, 'release', `pinpoint-caddie-${name}.aab`);
await copyFile(built, target);
console.log(`${target}  ${((await stat(target)).size / 1048576).toFixed(1)}MB`);
const keytool = env.JAVA_HOME ? join(env.JAVA_HOME, 'bin', 'keytool') : 'keytool';
const cert = execSync(`"${keytool}" -printcert -jarfile "${target}"`, { env, encoding: 'utf8' });
const sha256 = cert.match(/SHA256:\s*([0-9A-F:]+)/)?.[1];
if (!sha256) throw new Error('AAB 서명을 확인하지 못했습니다');
if (/CN=Android Debug/.test(cert)) throw new Error('디버그 키로 서명되었습니다 — 업로드 키 설정을 확인하세요');
console.log('업로드 키 SHA-256:', sha256);
run(`git add android/app/build.gradle js/core/appver.js`);
run(`git commit -q -m "Play AAB ${name} (versionCode ${code})"`);
console.log(`\n완료: Play Console → 테스트 및 출시 → 내부 테스트 → 새 버전 만들기 → ${target} 업로드`);
