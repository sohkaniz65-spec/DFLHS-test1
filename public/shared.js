// 화면과 인쇄 페이지가 함께 쓰는 서식 도우미.
export const CIRCLED = ['①', '②', '③', '④', '⑤'];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 안전한 서식 변환: HTML 은 모두 이스케이프한 뒤 <u>…</u> 만 되살리고,
 * {{정답}} 빈칸 표시는 mode 에 따라 빈칸/정답 강조/그냥 글자로 바꾼다.
 * mode: 'answer'(정답 강조) | 'blank'(빈칸) | 'plain'
 */
export function rich(s, mode = 'answer') {
  let h = esc(s).replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>');
  h = h.replace(/\{\{([^{}]+)\}\}/g, (m, inner) => {
    if (mode === 'blank') {
      const w = Math.max(4, Math.min(16, [...inner].length * 1.6));
      return `<span class="blank-line" style="min-width:${w}em"></span>`;
    }
    if (mode === 'plain') return inner;
    return `<span class="blank">${inner}</span>`;
  });
  // 열리고 닫히지 않은 <u> 정리
  const open = (h.match(/<u>/g) || []).length;
  const close = (h.match(/<\/u>/g) || []).length;
  if (open > close) h += '</u>'.repeat(open - close);
  return h;
}

export const STATUS_LABEL = {
  consistent: ['필기 일치', 'ok'],
  unrelated: ['필기 무관·충돌 없음', 'info'],
  conflict: ['필기 충돌', 'warn'],
  delete: ['삭제 권고', 'bad'],
  unchecked: ['검수 안 됨', 'bad'],
};

export const DECISION_LABEL = {
  accepted: ['확정', 'ok'],
  pending: ['검수 필요', 'warn'],
  deleted: ['삭제됨', 'bad'],
};

// 확정 문항(삭제 제외) — 출력 순서
export function liveQuestions(set) {
  return (set?.questions || []).filter((q) => q.decision !== 'deleted');
}

// ---------------- 교사용 교안 합치기 ----------------
const normText = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

/** 원문을 줄 단위로 나누고, 연이 바뀌는 줄을 표시한다. 줄 번호는 빈 줄을 뺀 1부터. */
export function splitPoem(poem) {
  const out = [];
  let stanzaBreak = false;
  for (const raw of String(poem || '').split('\n')) {
    const text = raw.trim();
    if (!text) { stanzaBreak = out.length > 0; continue; }
    out.push({ lineNo: out.length + 1, text, stanzaBreak });
    stanzaBreak = false;
  }
  return out;
}

/** 학교 필기 항목이 어느 줄에 대한 것인지: 원문에서 직접 찾고, 못 찾으면 Claude 가 정한 줄, 그래도 없으면 0(작품 전체). */
function placeSchoolPoint(pt, lines, placement) {
  const t = normText(pt.target);
  if (t.length >= 2) {
    const hit = lines.find((l) => {
      const n = normText(l.text);
      return n.includes(t) || (n.length >= 4 && t.includes(n));
    });
    if (hit) return hit.lineNo;
  }
  const c = Number(placement?.[pt.id]);
  return c >= 1 && c <= lines.length ? c : 0;
}

/**
 * 교사용 교안 화면·인쇄용 데이터: 자료 필기(material) + 학교 필기(school, 원문 그대로).
 * 학교 필기는 매번 현재 필기 기준에서 다시 붙이므로 필기를 고치면 바로 반영된다.
 */
export function teacherView(project) {
  const doc = project.docs?.teacher;
  if (!doc) return null;
  const lines = splitPoem(doc.poemSnapshot || project.poem);
  const c = doc.content;
  const rows = lines.map((l) => ({
    ...l,
    material: (c.lines.find((x) => x.lineNo === l.lineNo)?.notes || []).filter((n) => !n.deleted),
    school: [],
  }));
  const schoolGeneral = [];
  for (const pt of project.notes?.points || []) {
    const lineNo = placeSchoolPoint(pt, lines, c.schoolPlacement);
    const row = rows.find((r) => r.lineNo === lineNo);
    const whole = row && normText(pt.target) === normText(row.text);
    const item = { id: pt.id, examPoint: pt.examPoint, target: pt.target, text: pt.interpretation, showTarget: !whole };
    if (row) row.school.push(item);
    else schoolGeneral.push(item);
  }
  return {
    rows,
    overview: c.overview.filter((n) => !n.deleted),
    general: c.general.filter((n) => !n.deleted),
    schoolGeneral,
    excluded: doc.excluded || [],
  };
}
