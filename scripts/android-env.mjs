// Android 빌드 환경: JDK·SDK를 환경변수 → Windows 기본 설치 경로 순으로 찾아 local.properties에 기록
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export async function androidEnv(root) {
  const env = { ...process.env };
  if (!env.ANDROID_HOME) env.ANDROID_HOME = env.ANDROID_SDK_ROOT;
  if (!env.ANDROID_HOME) {
    const sdk = [env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Android', 'Sdk'), join(homedir(), 'android-sdk'), join(homedir(), 'Android', 'Sdk')].find(p => p && existsSync(p));
    if (sdk) env.ANDROID_HOME = sdk;
  }
  if (!env.JAVA_HOME) {
    const jdk = ['C:\\Program Files\\Microsoft\\jdk-17.0.19.10-hotspot', 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.19.10-hotspot'].find(existsSync);
    if (jdk) env.JAVA_HOME = jdk;
  }
  if (!env.ANDROID_HOME) throw new Error('Android SDK를 찾지 못했습니다. ANDROID_HOME 환경변수를 설정하세요');
  // Gradle용 SDK 경로: properties 파일에서 '\'는 이스케이프 문자라 반드시 '/'로 적는다
  await writeFile(join(root, 'android', 'local.properties'), `sdk.dir=${env.ANDROID_HOME.replace(/\\/g, '/')}\n`);
  return env;
}
