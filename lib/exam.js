// 클리닉 시험: 여러 작품의 확정된 클리닉 문항을 묶고, OMR 답을 채점하고, 학부모 코멘트를 만든다.
import { getProject, getSettings, updateExam, getExam, newId } from './store.js';
import { callJSON } from './claude.js';
import { genreOf, GENRES } from './genres.js';
import { gradeExam, weakSkills } from '../public/examStats.js';
import { COMMENTS_SCHEMA } from './schemas.js';

// 작품의 확정 클리닉 문항 → 시험 파트 (시험 당시 모습을 그대로 복사해 둔다: 나중에 작품 문항을 고쳐도 채점이 흔들리지 않게)
export async function makePart(projectId, { count, questionIds } = {}) {
  const p = await getProject(projectId);
  if (!p) throw new Error('작품을 찾을 수 없습니다.');
  const set = p.sets?.clinic;
  const accepted = (set?.questions || []).filter((q) => q.decision === 'accepted');
  if (!accepted.length) throw new Error(`「${p.title}」에 확정된 클리닉 문항이 없습니다. 작품의 생성·검수 탭에서 먼저 확정하세요.`);
  let picked = questionIds?.length
    ? questionIds.map((id) => accepted.find((q) => q.id === id)).filter(Boolean)
    : accepted.slice(0, Math.max(1, Number(count) || 10));
  if (!picked.length) picked = accepted.slice(0, 10);
  const genre = genreOf(p);
  return {
    id: newId('pt_'),
    projectId: p.id,
    title: p.title,
    author: p.author || '',
    genre,
    label: genre === '문법' ? `문법 · ${p.title}` : `${p.author ? p.author + ' 「' + p.title + '」' : '「' + p.title + '」'}`,
    passage: set.markedPoem || p.poem || '',
    available: accepted.length,
    questions: picked.map((q) => ({
      id: q.id, type: q.type, skill: q.skill || '', focus: q.focus || '', difficulty: q.difficulty,
      stem: q.stem, extraPassage: q.extraPassage, bogi: q.bogi, choices: q.choices, answer: q.answer, explanation: q.explanation,
    })),
    snapshotAt: new Date().toISOString(),
  };
}

const DEFAULT_VOICE = `학원 국어 선생님이 학부모님께 보내는 문자 말투입니다.
- 차분하고 따뜻한 존댓말(~습니다, ~해요 섞어 씀). 과장된 칭찬이나 느낌표 남발은 하지 않습니다.
- 학생은 성을 뺀 이름으로 부릅니다 (예: 홍길동 → "길동이는", 김하나 → "하나는").
- 구체적으로 씁니다: "문학이 약해요" 대신 "시에서 화자의 태도를 묻는 문제를 자주 놓쳤어요".`;

function studentBrief(exam, g, s) {
  const weak = weakSkills(s, g.classAvg);
  const qs = g.questions;
  const wrong = s.wrong.map((no) => {
    const q = qs[no - 1];
    return `  - ${no}번 [${exam.parts[q.partIndex].label} / ${q.skill}] ${q.focus || q.type}`;
  });
  return `## ${s.name} (id: ${s.id})
- 점수: ${s.score}/${s.total}
- 파트별: ${s.parts.map((p) => `${exam.parts[p.key].label} ${p.correct}/${p.total}`).join(', ')}
- 능력별: ${s.skills.map((k) => `${k.skill} ${k.correct}/${k.total}`).join(', ')}
- 보완이 필요한 능력: ${weak.length ? weak.map((k) => k.skill).join(', ') : '(뚜렷한 약점 없음)'}
- 틀린 문항:
${wrong.join('\n') || '  (없음)'}`;
}

export async function draftComments(examId, studentIds, progress) {
  const exam = await getExam(examId);
  const settings = await getSettings();
  const g = gradeExam(exam);
  const targets = g.students.filter((s) => s.graded && (!studentIds?.length || studentIds.includes(s.id)));
  if (!targets.length) throw new Error('채점된 학생이 없습니다. 먼저 OMR 답을 입력하세요.');
  const voice = settings.teacherVoice?.trim()
    ? `다음은 선생님이 평소 학부모님께 보낸 글입니다. 이 말투·길이·호칭·마무리 인사 습관을 그대로 따라 쓰세요:\n---\n${settings.teacherVoice.trim()}\n---`
    : DEFAULT_VOICE;
  const system = `당신은 ${settings.academyName || '국어 학원'} 국어 선생님을 대신해 클리닉 시험 결과를 학부모님께 알리는 짧은 코멘트를 씁니다.
${voice}

코멘트 규칙:
- 학생마다 3~4문장, 공백 포함 150~250자.
- 순서: 잘한 점 한 가지(실제로 맞힌 파트·능력에서) → 부족한 능력을 학부모가 알아듣는 말로 구체적으로 → 이번 주에 할 보완 학습 한두 가지(구체적인 활동) → 짧은 마무리.
- 점수 숫자와 문항 번호는 쓰지 않습니다(성적표에 따로 있습니다). 다른 학생·반 평균과 비교하지 않습니다.
- 약점이 뚜렷하지 않은 학생은 지금 잘하는 점을 짚고, 한 단계 높은 학습(고난도 <보기> 문제, 작품 간 비교 등)을 권합니다.
- 반드시 지정된 JSON 스키마로 한국어로 답합니다.`;
  const context = `# 시험: ${exam.title}${exam.date ? ` (${exam.date})` : ''}
# 구성
${exam.parts.map((p, i) => `- ${i + 1}파트: ${p.label} (${GENRES[p.genre]?.label || p.genre}, ${p.questions.length}문항)`).join('\n')}`;

  const batches = [];
  for (let i = 0; i < targets.length; i += 8) batches.push(targets.slice(i, i + 8));
  let done = 0;
  progress(0, targets.length, '코멘트 쓰는 중…');
  for (const batch of batches) {
    const r = await callJSON({
      kind: 'comments', input: { students: batch },
      system, context,
      task: `아래 학생들의 결과를 보고 학생별 코멘트를 쓰세요. id 는 그대로 돌려주세요.\n\n${batch.map((s) => studentBrief(exam, g, s)).join('\n\n')}`,
      schema: COMMENTS_SCHEMA,
      effort: 'medium',
    });
    await updateExam(examId, (e) => {
      for (const c of r.comments || []) {
        const st = e.students.find((x) => x.id === c.id);
        if (st && c.comment) { st.comment = c.comment.trim(); st.commentDraftAt = new Date().toISOString(); }
      }
    });
    done += batch.length;
    progress(done, targets.length, `코멘트 쓰는 중… (${done}/${targets.length})`);
  }
  return { count: done };
}
