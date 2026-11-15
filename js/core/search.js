// 골프장 이름 검색: 띄어쓰기·대소문자·기호를 무시하고, 한글 이름을 로마자로도 찾음
//  예) "남 서울", "남서울CC", "Namseoul", "nam seoul" → "남서울"
const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

// 국어의 로마자 표기법(단순화): 남서울 → namseoul, 레이크사이드 → reikeusaideu
export function romanize(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) { out += ch; continue; }
    const cho = Math.floor(c / 588), jung = Math.floor((c % 588) / 28), jong = c % 28;
    out += (out === '' && cho === 5 ? 'r' : CHO[cho]) + JUNG[jung] + JONG[jong];
  }
  return out;
}
// 비교용 정리: 공백·기호 제거, 소문자, 흔한 꼬리말(CC·컨트리클럽·골프클럽 등) 제거
const TAIL = /(countryclub|golfclub|golfresort|golfandresort|golfcourse|cc|gc|컨트리클럽|골프클럽|골프리조트|골프장|골프앤리조트|리조트|cc)$/;
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFC').replace(/[\s·.,()\-_'"&~/]/g, '').replace(/^the/, '').replace(TAIL, '');
}
// q가 name(또는 추가 필드)에 맞는지: 한글/영문/로마자 어느 쪽으로 쳐도 됨
export function matches(q, ...fields) {
  const nq = norm(q); if (!nq) return true;
  const rq = romanize(nq);
  return fields.some(f => {
    if (!f) return false;
    const nf = norm(f), rf = romanize(nf);
    return nf.includes(nq) || rf.includes(nq) || rf.includes(rq) || (/^[a-z0-9]+$/.test(nq) && rf.replace(/[^a-z0-9]/g, '').includes(nq));
  });
}
