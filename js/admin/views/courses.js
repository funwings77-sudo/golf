// 코스 관리: 목록 · 새 코스 · 앱 코스 파일 가져오기 · 내보내기 · 비공개
import { $, $$, esc, toast, sheet } from '../../ui.js';
import { Store } from '../store.js';
import * as M from '../model.js';
import { go } from '../main.js';
import { ago, download, readFiles, promptSheet, runPublish, readonlyNote } from '../common.js';

export default {
  async mount(el) {
    const render = async () => {
      const cat = await Store.loadCatalog();
      const drafts = Store.draftIds();
      const unpublished = drafts.filter(id => !cat.courses.some(c => c.id === id)).map(id => ({ id, d: Store.draft(id) })).filter(x => x.d);
      el.innerHTML = `<div class="a-head"><div class="grow"><h1>🗺️ 코스 관리</h1><p class="sub">홀 지오메트리(티·그린·해저드)와 사전 측량 그린맵을 발행합니다. 앱 사용자는 '공식 코스'에서 내려받습니다.</p></div>
        <div class="a-actions"><button class="btn primary" id="new">＋ 새 코스</button><button class="btn" id="imp">📥 코스 파일 가져오기</button><input type="file" id="impFile" accept=".json,application/json" hidden></div></div>
        ${readonlyNote()}
        ${unpublished.length ? `<h2>발행 전 코스 (임시저장)</h2>${unpublished.map(({ id, d }) => `<div class="card tight row"><div class="grow"><b>${esc(d.course.name)}</b> <span class="sub mono">${esc(id)}</span><br><span class="sub">${d.course.holes.length}홀 · ${ago(d.savedAt)} 저장 · 이 기기에만 있음</span></div><a class="btn small primary" href="#/course/${encodeURIComponent(id)}">이어서 편집</a><button class="btn small" data-dropdraft="${esc(id)}">삭제</button></div>`).join('')}` : ''}
        <h2>발행된 코스 ${cat.courses.length}개</h2>
        ${cat.courses.length ? `<div class="tblbox"><table class="a-tbl"><thead><tr><th>코스</th><th>지역</th><th class="num">홀</th><th class="num">파</th><th class="num">전장</th><th class="num">그린맵</th><th class="num">rev</th><th>최근 발행</th><th></th></tr></thead><tbody>
          ${cat.courses.map(c => `<tr><td><b>${esc(c.name)}</b>${drafts.includes(c.id) ? ' <span class="badge warn">발행 안 된 수정</span>' : ''}<br><span class="sub mono">${esc(c.id)}</span></td><td>${esc(c.region || '—')}</td>
            <td class="num">${c.holes}</td><td class="num">${c.par}</td><td class="num">${c.length ? c.length.toLocaleString() + 'm' : '—'}</td><td class="num">${c.greens || 0}/${c.holes}</td><td class="num">${c.rev}</td><td>${ago(c.updatedAt)}</td>
            <td style="white-space:nowrap"><a class="btn small primary" href="#/course/${encodeURIComponent(c.id)}">편집</a> <a class="btn small" href="#/greens/${encodeURIComponent(c.id)}">그린맵</a> <button class="btn small" data-more="${esc(c.id)}">⋯</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="card empty-card">발행된 코스가 없습니다. [새 코스]로 시작하거나 앱에서 만든 코스 파일을 가져오세요.</div>'}
        <div class="card" style="margin-top:16px"><b>데이터 흐름</b><p class="sub" style="margin:6px 0 0">관리자 편집 → 이 기기에 임시저장 → <b>검증</b>(누락·이상값) → <b>발행</b>(<code>data/courses/&lt;ID&gt;.json</code> + <code>data/catalog.json</code>을 커밋 1개로) → GitHub Pages 배포(1~2분) → 앱 '코스 관리 → 공식 코스'에서 설치·업데이트 알림. 핀 위치는 코스 파일이 아니라 <a href="#/pins">오늘의 핀</a>으로 매일 따로 발행합니다.</p></div>`;

      $('#new').onclick = async () => {
        const v = await promptSheet('새 코스', [
          { key: 'name', label: '코스 이름', placeholder: '예: 한라산 CC' },
          { key: 'id', label: '코스 ID (영문 소문자·숫자·하이픈, 발행 후 변경 불가)', placeholder: '예: hallasan-cc', help: '앱과 핀 파일이 이 ID로 연결됩니다' },
          { key: 'holes', label: '홀 수', type: 'select', value: '18', options: [['9', '9홀'], ['18', '18홀'], ['27', '27홀'], ['36', '36홀']] },
        ], '만들기');
        if (!v) return;
        const id = v.id.trim().toLowerCase();
        if (!M.COURSE_ID_RE.test(id)) return toast('코스 ID 형식이 올바르지 않습니다');
        if (cat.courses.some(c => c.id === id) || Store.draft(id)) return toast('이미 있는 코스 ID입니다');
        if (!v.name.trim()) return toast('코스 이름을 입력하세요');
        Store.saveDraft(id, M.newOfficialCourse({ id, name: v.name.trim(), holes: +v.holes }), 0);
        go('course/' + encodeURIComponent(id));
      };
      $('#imp').onclick = () => $('#impFile').click();
      $('#impFile').onchange = async e => {
        const [f] = await readFiles(e.target); e.target.value = ''; if (!f) return;
        let c;
        try { const j = JSON.parse(f.text); c = j.format === M.DATA_FORMATS.course ? j.course : j; if (!Array.isArray(c?.holes)) throw new Error('홀 목록이 없습니다'); }
        catch (err) { return toast('코스 파일이 아닙니다: ' + err.message); }
        const v = await promptSheet('코스 가져오기', [
          { key: 'name', label: '코스 이름', value: c.name || '' },
          { key: 'id', label: '코스 ID (영문 소문자·숫자·하이픈)', value: M.COURSE_ID_RE.test(c.id || '') ? c.id : '', placeholder: '예: hallasan-cc' },
        ], '가져오기');
        if (!v) return;
        const id = v.id.trim().toLowerCase();
        if (!M.COURSE_ID_RE.test(id)) return toast('코스 ID 형식이 올바르지 않습니다');
        const exists = cat.courses.some(x => x.id === id);
        const course = { ...M.newOfficialCourse({ id, name: v.name.trim() || c.name, holes: 0 }), ...M.clone(c), id, name: v.name.trim() || c.name };
        course.holes = course.holes.map(h => { const x = { halfWidth: 16, note: '', hdcp: null, ...h, hazards: (h.hazards || []).filter(z => M.HAZARD_TYPES.includes(z.type)) }; delete x.pin; return x; });
        delete course.demo; delete course.created;
        const prev = exists ? await Store.loadCourse(id) : null;
        Store.saveDraft(id, course, prev?.data?.rev || 0);
        toast(exists ? '기존 코스의 수정본(임시저장)으로 가져왔습니다 — 발행 전 변경 내용을 확인하세요' : '가져왔습니다 — 검증 후 발행하세요', 4000);
        go('course/' + encodeURIComponent(id));
      };
      $$('[data-dropdraft]').forEach(b => b.onclick = () => sheet({ title: '임시저장 삭제', body: '<p>발행하지 않은 이 코스를 이 기기에서 삭제할까요?</p>', actions: [{ label: '취소' }, { label: '삭제', kind: 'danger', onClick: () => { Store.dropDraft(b.dataset.dropdraft); render(); } }] }));
      $$('[data-more]').forEach(b => b.onclick = () => more(cat.courses.find(c => c.id === b.dataset.more), render));
    };
    await render();
  },
};

function more(entry, rerender) {
  sheet({
    title: entry.name, body: `<p class="sub mono">${esc(entry.id)} · rev ${entry.rev}</p>`,
    actions: [
      { label: '📤 내보내기 (JSON)', onClick: async () => { const { data } = await Store.loadCourse(entry.id); download(`${entry.id}.json`, JSON.stringify(M.courseFile(data), null, 1)); } },
      { label: '📍 오늘의 핀', onClick: () => go('pins/' + encodeURIComponent(entry.id)) },
      { label: '비공개(삭제)', kind: 'danger', onClick: () => unpublish(entry, rerender) },
    ],
  });
}

function unpublish(entry, rerender) {
  sheet({
    title: '코스 비공개',
    body: `<p><b>${esc(entry.name)}</b>의 코스 파일·핀 파일을 삭제하고 카탈로그에서 뺍니다. 이미 설치한 사용자의 앱에는 남아 있지만 업데이트·오늘의 핀을 더 받지 못합니다.</p><p class="sub">GitHub 커밋 이력으로 되살릴 수 있습니다.</p>
      <label class="f"><span>확인을 위해 코스 ID <b class="mono">${esc(entry.id)}</b>를 입력하세요</span><input type="text" id="cfm" autocomplete="off"></label>`,
    actions: [{ label: '취소' }, {
      label: '비공개', kind: 'danger', onClick: async card => {
        if ($('#cfm', card).value.trim() !== entry.id) { toast('코스 ID가 일치하지 않습니다'); return false; }
        const r = await runPublish('코스 비공개', () => Store.unpublishCourse(entry.id));
        if (r) rerender();
      },
    }],
  });
}
