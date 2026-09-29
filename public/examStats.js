// 클리닉 시험 채점·통계. 화면·인쇄·서버(코멘트 생성)가 같은 계산을 쓴다.

// 시험의 전체 문항을 번호 순서로 편다 (파트 순서대로 1번부터)
export function examQuestions(exam) {
  const out = [];
  (exam.parts || []).forEach((part, pi) => {
    for (const q of part.questions || []) {
      out.push({ no: out.length + 1, partIndex: pi, partTitle: part.title, skill: q.skill || '미지정', answer: q.answer, q });
    }
  });
  return out;
}

const BLANK = /^[0xX.\-_·?*]$/;

/** "13524 21453" 같은 답 문자열 → [1,3,5,2,4,2,...]. 0·-·. 등은 무응답(null). */
export function parseAnswerString(str, n) {
  const chars = [...String(str || '').replace(/[\s,|/]/g, '')];
  const out = chars.map((c) => {
    const d = '①②③④⑤'.indexOf(c) + 1 || Number(c);
    return d >= 1 && d <= 5 ? d : null;
  });
  if (n == null) return out;
  return Array.from({ length: n }, (_, i) => out[i] ?? null);
}

export function answerString(answers) {
  return (answers || []).map((a) => (a >= 1 && a <= 5 ? a : '-')).join('').replace(/(.{5})(?=.)/g, '$1 ');
}

const hasName = (s) => /[가-힣A-Za-z]/.test(s);

/**
 * OMR 결과·엑셀에서 복사한 내용을 학생별 답으로 바꾼다.
 * 한 줄에 한 학생: "홍길동 13524 21453 ..." / "3 홍길동 1 3 5 2 4 ..." / 엑셀(탭으로 구분된 칸)
 */
export function parseOmrPaste(text, n) {
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    let name = '';
    let answers;
    if (line.includes('\t')) {
      const cells = line.split('\t').map((c) => c.trim());
      const ni = cells.findIndex(hasName);
      if (ni < 0) continue;
      name = cells[ni];
      const rest = cells.slice(ni + 1);
      answers = rest.length === 1
        ? parseAnswerString(rest[0], n)
        : Array.from({ length: n }, (_, i) => parseAnswerString(rest[i] || '', 1)[0]);
    } else {
      const tokens = line.trim().split(/\s+/);
      const ni = tokens.findIndex(hasName);
      if (ni < 0) continue;
      name = tokens[ni];
      answers = parseAnswerString(tokens.slice(ni + 1).join(''), n);
    }
    if (/^(이름|성명|name)$/i.test(name)) continue; // 머리글 줄
    rows.push({ name, answers });
  }
  return rows;
}

const rate = (c, t) => (t ? Math.round((c / t) * 1000) / 10 : null);

/** 채점 결과: 학생별 점수·파트별·능력별 정답률, 문항별 정답률·선택 분포, 반 평균 */
export function gradeExam(exam) {
  const qs = examQuestions(exam);
  const n = qs.length;
  const parts = (exam.parts || []).map((p) => p.title);
  const skills = [...new Set(qs.map((q) => q.skill))];

  const students = (exam.students || []).map((st) => {
    const answers = Array.from({ length: n }, (_, i) => st.answers?.[i] ?? null);
    const graded = answers.some((a) => a != null);
    const correct = qs.map((q, i) => answers[i] != null && answers[i] === q.answer);
    const tally = (keyOf, keys) => keys.map((k) => {
      const idx = qs.map((q, i) => (keyOf(q) === k ? i : -1)).filter((i) => i >= 0);
      const c = idx.filter((i) => correct[i]).length;
      return { key: k, correct: c, total: idx.length, rate: rate(c, idx.length) };
    });
    const score = correct.filter(Boolean).length;
    return {
      id: st.id, name: st.name, comment: st.comment || '', graded, answers, correct,
      score, total: n, rate: rate(score, n),
      parts: tally((q) => q.partIndex, parts.map((_, i) => i)).map((x) => ({ ...x, title: parts[x.key] })),
      skills: tally((q) => q.skill, skills).map((x) => ({ ...x, skill: x.key })),
      wrong: qs.filter((q, i) => !correct[i]).map((q) => q.no),
    };
  });

  const graded = students.filter((s) => s.graded);
  const avg = (vals) => (vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null);
  const questions = qs.map((q, i) => {
    const dist = [0, 0, 0, 0, 0, 0]; // 1~5, 무응답
    for (const s of graded) dist[s.answers[i] ? s.answers[i] - 1 : 5]++;
    const c = graded.filter((s) => s.correct[i]).length;
    return { no: q.no, partIndex: q.partIndex, skill: q.skill, answer: q.answer, rate: rate(c, graded.length), dist, type: q.q.type, focus: q.q.focus || '', stem: q.q.stem };
  });
  const scores = graded.map((s) => s.score).sort((a, b) => b - a);
  return {
    n, parts, skills, students, questions,
    gradedCount: graded.length,
    classAvg: {
      score: avg(graded.map((s) => s.score)),
      rate: avg(graded.map((s) => s.rate)),
      parts: parts.map((_, pi) => avg(graded.map((s) => s.parts[pi].rate).filter((r) => r != null))),
      skills: Object.fromEntries(skills.map((k, si) => [k, avg(graded.map((s) => s.skills[si].rate).filter((r) => r != null))])),
      max: scores[0] ?? null,
      min: scores[scores.length - 1] ?? null,
    },
  };
}

/** 보완이 필요한 능력: 정답률 70% 미만이거나 반 평균보다 15%p 이상 낮은 것 (낮은 순) */
export function weakSkills(student, classAvg) {
  return student.skills
    .filter((s) => s.total && (s.rate < 70 || (classAvg.skills[s.skill] != null && s.rate <= classAvg.skills[s.skill] - 15)))
    .sort((a, b) => a.rate - b.rate);
}
