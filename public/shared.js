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
