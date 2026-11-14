// 코스 DB (KGBA 회원사 209곳): golf_courses.sql / .db 가져오기 → 골프장 검색 → 스코어카드 확인 → 공식 코스 초안
import { $, $$, esc, toast, sheet } from '../../ui.js';
import { Store } from '../store.js';
import * as K from '../kgba.js';
import * as M from '../model.js';
import { go } from '../main.js';
import { fmtDT, readonlyNote } from '../common.js';

const KEY = 'pinpoint.admin.kgba';
let mem = null; // localStorage에 못 넣을 만큼 크면 메모리에만
function loadDB() { if (mem) return mem; try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function saveDB(d) { mem = null; try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { mem = d; toast('저장 공간 부족 — 이 탭을 닫으면 다시 불러와야 합니다', 4000); } }

let st = { q: '', sido: '', status: '완료' };
export default {
  mount(el) {
    const render = () => {
      const db = loadDB();
      el.innerHTML = `<div class="a-head"><div class="grow"><h1>📚 코스 DB (KGBA 회원사)</h1><p class="sub">대한민국 골프장 코스 DB(<code>golf_courses.sql</code> 또는 <code>golf_courses.db</code>)에서 골프장 정보와 홀별 스코어카드(파·핸디캡·티별 거리·공략)를 가져와 공식 코스 초안을 만듭니다. 이 DB에는 GPS 좌표가 없으므로 위치는 코스 편집기에서 <b>OSM 자동 가져오기</b>나 위성지도로 지정합니다.</p></div>
        <div class="a-actions"><button class="btn primary" id="load">📥 DB 파일 불러오기</button><input type="file" id="file" accept=".sql,.db,.sqlite,.sqlite3,.txt" hidden>${db ? '<button class="btn" id="clr">비우기</button>' : ''}</div></div>
        ${readonlyNote()}
        ${!db ? `<div class="card empty-card"><b>DB를 불러오세요</b><p>README에 있는 <code>golf_courses.sql</code>(SQL 덤프) 또는 <code>golf_courses.db</code>(SQLite)를 선택하면 됩니다.<br>파일은 이 브라우저 안에서만 읽고 어디에도 올리지 않습니다.</p></div>` : body(db)}`;
      $('#load').onclick = () => $('#file').click();
      $('#file').onchange = async e => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        toast(`${f.name} 읽는 중…`, 8000);
        try {
          const buf = await f.arrayBuffer();
          const tables = K.isSQLiteBytes(buf) ? await K.readSQLiteFile(buf) : K.parseSQLDump(new TextDecoder().decode(buf));
          const n = K.normalizeKGBA(tables);
          saveDB({ fileName: f.name, loadedAt: new Date().toISOString(), clubs: n.clubs, holeRows: n.holeRows });
          toast(`골프장 ${n.clubs.length}곳 · 홀 ${n.holeRows}행 불러옴`, 4000); render();
        } catch (err) { console.error(err); toast('불러오기 실패: ' + err.message, 6000); }
      };
      $('#clr')?.addEventListener('click', () => { try { localStorage.removeItem(KEY); } catch {} mem = null; render(); });
      if (!db) return;
      $('#q').oninput = e => { st.q = e.target.value; list(db); };
      $('#sido').onchange = e => { st.sido = e.target.value; list(db); };
      $('#status').onchange = e => { st.status = e.target.value; list(db); };
      list(db);
    };
    render();
  },
};

function body(db) {
  const by = s => db.clubs.filter(c => c.status === s).length;
  const sidos = [...new Set(db.clubs.map(c => c.sido).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const statuses = [...new Set(db.clubs.map(c => c.status))];
  return `<div class="kpis">
      <div class="kpi"><div class="v">${db.clubs.length}<small>곳</small></div><div class="l">골프장</div><div class="d">${esc(db.fileName)} · ${fmtDT(db.loadedAt)}</div></div>
      <div class="kpi"><div class="v">${by('완료')}<small>곳</small></div><div class="l">수집 완료 (홀 데이터 있음)</div></div>
      <div class="kpi"><div class="v">${db.holeRows}<small>행</small></div><div class="l">홀 데이터</div></div>
      <div class="kpi"><div class="v">${db.clubs.length - by('완료')}<small>곳</small></div><div class="l">접속불가·미수집</div></div>
    </div>
    <div class="card tight row" style="margin-top:12px"><input type="search" id="q" placeholder="골프장 이름 검색" value="${esc(st.q)}" style="max-width:260px">
      <select id="sido" class="sm" style="width:auto"><option value="">전체 지역</option>${sidos.map(s => `<option ${s === st.sido ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="status" class="sm" style="width:auto"><option value="">전체 상태</option>${statuses.map(s => `<option ${s === st.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select><span class="sub" id="cnt"></span></div>
    <div class="tblbox tall" style="margin-top:10px"><table class="a-tbl"><thead><tr><th>골프장</th><th>지역</th><th>상태</th><th class="num">총 홀</th><th class="num">수집 홀</th><th>코스(9홀 묶음)</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;
}

function list(db) {
  const q = st.q.trim();
  const rows = db.clubs.filter(c => (!q || c.name.includes(q)) && (!st.sido || c.sido === st.sido) && (!st.status || c.status === st.status));
  $('#cnt').textContent = `${rows.length}곳`;
  const published = new Set((Store.catalog?.courses || []).map(c => c.id));
  $('#rows').innerHTML = rows.map(c => `<tr><td><b>${esc(c.name)}</b>${published.has(K.suggestId(c)) ? ' <span class="badge">발행됨</span>' : Store.draft(K.suggestId(c)) ? ' <span class="badge warn">초안</span>' : ''}</td><td>${esc([c.sido, c.sigungu].filter(Boolean).join(' '))}</td>
    <td><span class="badge ${c.status === '완료' ? '' : c.status === '접속불가' ? 'err' : 'mute'}">${esc(c.status)}</span></td><td class="num">${c.totalHoles ?? '—'}</td><td class="num">${c.holeCount}${c.totalHoles && c.totalHoles !== c.holeCount && c.holeCount ? ' <span class="badge warn">불일치</span>' : ''}</td>
    <td>${c.nines.map(n => `${esc(n.name)}(${n.holes.length})`).join(' · ') || '—'}</td><td><button class="btn small ${c.holeCount ? 'primary' : ''}" data-open="${c.id}">${c.holeCount ? '보기' : '정보'}</button></td></tr>`).join('') || '<tr><td colspan="7" class="sub">조건에 맞는 골프장이 없습니다</td></tr>';
  $$('[data-open]').forEach(b => b.onclick = () => detail(db.clubs.find(c => c.id === +b.dataset.open)));
}

function detail(club) {
  const r = club.raw, id = K.suggestId(club);
  const info = [['운영', r.operation_type], ['개장', r.opened_year], ['코스 구성', r.course_layout], ['파(18홀)', r.par_18], ['전장(야드)', r.length_yards], ['페어웨이 잔디', r.fairway_grass], ['그린 잔디', r.green_grass], ['설계', r.architect], ['그린피 주중/주말', [r.greenfee_weekday, r.greenfee_weekend].filter(Boolean).join(' / ')], ['카트비 · 캐디피', [r.cart_fee, r.caddie_fee].filter(Boolean).join(' · ')], ['예약', r.reservation], ['난이도', r.difficulty], ['전화', r.phone], ['주소', r.address], ['홈페이지', r.homepage], ['확인일', r.checked_date]].filter(([, v]) => v != null && v !== '');
  sheet({
    title: `${club.name} · ${club.status}`,
    body: `<div style="max-height:62vh;overflow:auto">${info.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b style="text-align:right">${esc(String(v))}</b></div>`).join('')}
      ${r.features ? `<p class="sub" style="white-space:pre-wrap">특징·메모: ${esc(r.features)}</p>` : ''}
      ${club.nines.map(n => `<h3>${esc(n.name)} 코스</h3><div class="tblbox"><table class="a-tbl"><thead><tr><th>홀</th><th class="num">파</th><th class="num">HDCP</th><th class="num">백</th><th class="num">블루</th><th class="num">화이트</th><th class="num">레드</th><th>단위</th><th>공략</th></tr></thead><tbody>
        ${n.holes.map(h => `<tr><td>${esc(h.hole_no)}</td><td class="num">${esc(h.par ?? '')}</td><td class="num">${esc(h.handicap ?? '')}</td><td class="num">${esc(h.tee_back ?? '')}</td><td class="num">${esc(h.tee_champion_blue ?? '')}</td><td class="num">${esc(h.tee_regular_white ?? '')}</td><td class="num">${esc(h.tee_lady_red ?? '')}</td><td>${esc(h.distance_unit ?? '')}</td><td class="sub">${esc([h.strategy, h.hazards, h.green_notes, h.note].filter(Boolean).join(' · ').slice(0, 90))}</td></tr>`).join('')}</tbody></table></div>`).join('')}
      ${club.nines.length ? `<h3>공식 코스 초안 만들기</h3>
        ${club.nines.length > 1 ? `<p class="sub" style="margin:0">포함할 코스 (27·36홀 골프장은 앱에서 라운드 시작 때 전반·후반 코스를 고릅니다)</p><div class="row" style="margin:6px 0">${club.nines.map(n => `<label class="row" style="gap:4px"><input type="checkbox" data-nine="${esc(n.name)}" checked> ${esc(n.name)}</label>`).join('')}</div>` : ''}
        <label class="f"><span>코스 ID (영문 소문자·숫자·하이픈)</span><input type="text" id="cid" value="${esc(id)}"></label>` : '<p class="sub">홀 데이터가 아직 수집되지 않아 초안을 만들 수 없습니다.</p>'}
      <p class="sub">출처: ${esc(r.sources || '—')}</p></div>`,
    actions: [{ label: '닫기' }, ...(club.nines.length ? [{
      label: '초안 만들기 → 편집기', kind: 'primary', onClick: card => {
        try {
          const nines = $$('[data-nine]', card).filter(x => x.checked).map(x => x.dataset.nine);
          const cid = $('#cid', card).value.trim().toLowerCase();
          if (Store.draft(cid) || (Store.catalog?.courses || []).some(c => c.id === cid)) { toast('이미 있는 코스 ID입니다. 다른 ID를 쓰거나 기존 코스를 편집하세요'); return false; }
          const { course, warnings } = K.clubToCourse(club, { id: cid, nines: club.nines.length > 1 ? nines : null });
          Store.saveDraft(cid, course, 0);
          toast(`초안 생성 (${course.holes.length}홀)${warnings.length ? ' · 확인 ' + warnings.length + '건: ' + warnings[0] : ''} — 이제 OSM 가져오기로 위치를 채우세요`, 6000);
          go('course/' + encodeURIComponent(cid));
        } catch (e) { toast(e.message, 5000); return false; }
      },
    }] : [])],
  });
}
