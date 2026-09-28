// 자료실에서 작품과 관련된 부분을 찾는다 (키워드 기반, API 비용 없음).
import { getLibrary, readLibraryText } from './store.js';

export function norm(s) {
  // 맥 파일 이름은 한글이 자모로 풀린 형태(NFD)일 때가 많아 NFC 로 모아서 비교한다
  return (s || '').normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

// 자주 헷갈리는 표기 변형 (예: 씌어진 ↔ 쓰여진)
const VARIANTS = [
  ['씌어진', '쓰여진'],
  ['씌어진', '쓰인'],
];

export function suggestAliases(title) {
  const out = new Set();
  for (const [a, b] of VARIANTS) {
    if (title.includes(a)) out.add(title.replace(a, b));
    if (title.includes(b)) out.add(title.replace(b, a));
  }
  out.delete(title);
  return [...out];
}

export function chunkText(text, size = 1400) {
  const paras = text.split(/\n{2,}|\n(?=\[\d+쪽\])/);
  const chunks = [];
  let buf = '';
  const push = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = '';
  };
  for (const p of paras) {
    if (p.length > size) {
      push();
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
      continue;
    }
    if (buf.length + p.length > size) push();
    buf += (buf ? '\n\n' : '') + p;
  }
  push();
  return chunks.map((text, index) => ({ index, text }));
}

export function queryTerms(project) {
  const terms = [];
  const add = (t, w, kind) => {
    const n = norm(t);
    if (n.length >= 2 && !terms.some((x) => x.n === n)) terms.push({ t, n, w, kind });
  };
  add(project.title, 6, 'title');
  for (const a of project.aliases || []) add(a, 6, 'title');
  add(project.author, 2, 'author');
  // 본문에서 특징적인 구절(8자 이상)을 검색어로 사용
  const lines = (project.poem || '').split('\n').map((l) => l.trim()).filter((l) => norm(l).length >= 8);
  for (const l of lines.slice(0, 40)) add(l, 3, 'line');
  return terms;
}

function scoreText(nText, terms) {
  let score = 0;
  const hits = new Set();
  for (const term of terms) {
    let idx = nText.indexOf(term.n);
    let count = 0;
    while (idx !== -1 && count < 20) {
      count++;
      idx = nText.indexOf(term.n, idx + term.n.length);
    }
    if (count) {
      score += term.w * Math.min(count, 5);
      hits.add(term.kind);
    }
  }
  // 작가 이름만 걸린 건 약하게 (같은 작가의 다른 작품일 수 있음)
  if (hits.size === 1 && hits.has('author')) score = Math.min(score, 2);
  return { score, hits: [...hits] };
}

/**
 * 1) 파일·폴더 이름에 작품명(또는 다른 표기)이 들어간 파일 → 후보 (읽기 전이어도 나옴)
 * 2) 이미 읽어 둔 파일 중 본문에 작품명·원문 구절이 나오는 파일 → 관련 부분만
 * 3) 이름에 작가만 들어간 파일 → 참고 후보 (기본 선택 안 함)
 */
export async function searchLibrary(project) {
  const lib = await getLibrary();
  const terms = queryTerms(project);
  const titleTerms = terms.filter((t) => t.kind === 'title');
  const authorTerm = terms.find((t) => t.kind === 'author');
  const results = [];
  for (const f of lib.files) {
    const nName = norm(f.relPath || f.name);
    const fileHit = titleTerms.some((t) => nName.includes(t.n));
    const authorHit = !fileHit && authorTerm && nName.includes(authorTerm.n);
    const base = {
      fileId: f.id, name: f.name, relPath: f.relPath, ext: f.ext, size: f.size, status: f.status, ocr: !!f.ocr,
      fileHit, tier: fileHit ? 'title' : authorHit ? 'author' : 'content',
    };
    if (f.status !== 'ok') {
      // 아직 안 읽은 파일·스캔본: 이름이 맞을 때만 후보로
      if (fileHit || authorHit) results.push({ ...base, score: fileHit ? 30 : 3, chunks: [] });
      continue;
    }
    const text = await readLibraryText(f.id);
    if (!text) continue;
    const chunks = chunkText(text);
    const scored = chunks.map((c) => ({ ...c, ...scoreText(norm(c.text), terms) }));
    const strong = scored.filter((c) => c.score >= 6);
    if (!fileHit && !authorHit && !strong.length) continue;

    // 관련 조각 + 앞뒤 한 조각씩 (해설이 이어지는 경우가 많음).
    // 이름이 맞아도 큰 파일(자습서 등)은 관련 부분만 고른다.
    const keep = new Set();
    const whole = fileHit && text.length <= 40000;
    if (whole) scored.forEach((c) => keep.add(c.index));
    for (const c of strong) {
      keep.add(c.index);
      if (c.index > 0) keep.add(c.index - 1);
      if (c.index < scored.length - 1) keep.add(c.index + 1);
    }
    if (!keep.size && fileHit) scored.slice(0, 10).forEach((c) => keep.add(c.index));
    const picked = scored.filter((c) => keep.has(c.index));
    if (!picked.length) continue;
    const total = picked.reduce((sum, c) => sum + c.score, 0) + (fileHit ? 30 : 0);
    results.push({
      ...base,
      tier: fileHit ? 'title' : strong.length ? 'content' : 'author',
      score: total,
      chunks: picked.map((c) => ({ index: c.index, score: c.score, text: c.text })),
    });
  }
  const order = { title: 0, content: 1, author: 2 };
  return results.sort((a, b) => order[a.tier] - order[b.tier] || b.score - a.score).slice(0, 300);
}
