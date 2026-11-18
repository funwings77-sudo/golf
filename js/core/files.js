// 파일 내보내기: 앱(APK)에서는 파일로 쓰고 휴대폰 공유 창(카톡·드라이브·메일)으로, 웹에서는 공유 또는 다운로드
//  안드로이드 WebView는 웹 공유·blob 다운로드를 지원하지 않아 그냥 두면 아무 일도 안 일어남 → Capacitor 파일·공유 플러그인 사용
export const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.();

export async function saveFile(name, text, mime = 'application/json', title = name) {
  const P = window.Capacitor?.Plugins;
  if (isNativeApp() && P?.Filesystem && P?.Share) {
    const w = await P.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
    try { await P.Share.share({ title, url: w.uri, dialogTitle: title }); }
    catch (e) { if (!/cancel/i.test(String(e?.message || e))) throw e; return { ok: false, how: 'cancel' }; }
    return { ok: true, how: 'share' };
  }
  const file = new File([text], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return { ok: true, how: 'share' }; }
    catch (e) { if (e?.name === 'AbortError') return { ok: false, how: 'cancel' }; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return { ok: true, how: 'download' };
}

// 파일 고르기 → 글자로 읽기 (백업 복원 등)
export function pickTextFile(accept = '.json,application/json') {
  return new Promise((res, rej) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept;
    inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return res(null); try { res(await f.text()); } catch (e) { rej(e); } };
    inp.click();
  });
}
