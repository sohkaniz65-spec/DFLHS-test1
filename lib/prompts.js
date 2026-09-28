// 프롬프트. SYSTEM 은 모든 호출에서 동일하게 유지한다 (프롬프트 캐시 재사용).

export const SYSTEM = `당신은 한국 고등학교 내신 국어(문학) 전문 강사이자 출제 검토위원입니다. 학원 강사가 특정 학교 내신 대비 수업자료를 만드는 일을 돕습니다.

[최우선 원칙: 학교 필기 기준]
- "학교 필기 기준"은 해당 학교 선생님이 수업 시간에 가르친 해석입니다. 모든 해석·정답 판정의 최종 기준입니다.
- 필기 기준과 어긋나는 해석을 정답 근거로 쓰지 않습니다. 필기에서 옳다고 가르친 내용을 오답(틀린 선지)으로 만들지 않습니다.
- 필기에 없는 내용은 교과서·EBS 등에서 널리 통용되는 해석만 사용합니다. 해석이 갈리는 내용은 정답 판정의 근거로 쓰지 않습니다.
- 참고 자료와 필기가 충돌하면 필기를 따릅니다. 참고 자료는 사실 확인과 문제 소재로만 씁니다.

[작품 원문]
- 작품 원문을 임의로 고치거나 지어내지 않습니다. 제공된 원문에 없는 시구를 인용하지 않습니다.

[문항 작성 규칙]
- 모든 문항은 5지선다 객관식입니다. 서술형은 만들지 않습니다.
- 정답은 정확히 하나여야 하고, 오답 선지는 필기·원문에 비추어 명백히 틀린 이유가 있어야 합니다.
- 발문은 실제 내신 시험 문체를 따릅니다. (예: "윗글에 대한 이해로 가장 적절한 것은?", "<보기>를 참고하여 윗글을 감상한 내용으로 적절하지 않은 것은?")
- 해설은 학생이 혼자 읽고 이해할 수 있게 씁니다: 정답 근거 + 각 오답이 틀린 이유를 선지 번호별로.
- 표기: 밑줄은 <u>...</u>, 기호는 ㉠㉡㉢㉣㉤, ⓐⓑⓒⓓⓔ 를 사용합니다. 다른 HTML 태그는 쓰지 않습니다.

[출력]
- 반드시 지정된 JSON 스키마에 맞춰 한국어로 답합니다.`;

export function buildContext(project, { includeNotes = true, includeMaterials = true } = {}) {
  const parts = [];
  parts.push(`# 작품 정보
- 제목: ${project.title}
- 작가: ${project.author || '(미입력)'}
- 학교/학년: ${[project.school, project.grade].filter(Boolean).join(' ') || '(미입력)'}
- 시험 범위·메모: ${project.examNote || '(없음)'}`);

  parts.push(`# 작품 원문
${project.poem?.trim() || '(원문 미입력: 참고 자료에 있는 원문만 사용하고, 없으면 시구를 인용하지 말 것)'}`);

  if (includeNotes) {
    const points = project.notes?.points || [];
    parts.push(`# 학교 필기 기준 (확정본 v${project.notes?.version || 0}) — 최우선 기준
${points.length ? points.map(formatPoint).join('\n') : '(아직 확정된 필기 없음: 통용 해석만 사용)'}`);
  }

  if (includeMaterials) {
    const mats = project.materials?.selected || [];
    if (mats.length) {
      // 같은 파일의 조각은 묶어서 보여준다
      const byFile = new Map();
      for (const m of mats) {
        if (!byFile.has(m.fileId)) byFile.set(m.fileId, { name: m.relPath || m.fileName, chunks: [] });
        byFile.get(m.fileId).chunks.push(m);
      }
      let i = 0;
      const blocks = [...byFile.values()].map((f) => {
        i++;
        const body = f.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex).map((c) => c.text).join('\n…\n');
        return `## [자료${i}] ${f.name}\n${body}`;
      });
      parts.push(`# 참고 자료 (발췌)\n${blocks.join('\n\n')}`);
    } else {
      parts.push('# 참고 자료\n(선택된 자료 없음)');
    }
  }
  return parts.join('\n\n');
}

export function formatPoint(p) {
  return `[${p.id}] 대상: ${p.target} / 해석: ${p.interpretation}${p.examPoint ? ' / ★시험 포인트' : ''}${p.memo ? ` / 메모: ${p.memo}` : ''}`;
}

// ---------------- 필기 정리 ----------------
export function notesTask(entries, existingPoints) {
  return `아래는 학원 강사가 학생들이 찍어 온 학교 선생님 필기 사진을 보고 음성 입력(STT)으로 옮긴 내용입니다. STT 특성상 오타·띄어쓰기 오류·동음이의어 오인식이 있을 수 있습니다.

할 일:
1. 작품 원문과 문맥을 근거로 STT 오인식을 바로잡으세요 (예: 시어가 비슷한 발음의 다른 말로 적힌 경우). 바로잡은 것은 sttFixes 에 기록하세요.
2. 선생님이 가르친 해석을 "대상(시어·구절·연 또는 작품 전체) → 해석" 단위의 항목(points)으로 나누세요.
   - 선생님 필기에 있는 내용만 정리합니다. 당신의 해석을 덧붙이거나 보완하지 마세요.
   - "시험에 나온다/중요/별표" 같은 강조가 있으면 examPoint 를 true 로 하세요.
   - sourceQuote 에는 근거가 된 입력 문장을 (교정 후) 그대로 적으세요.
3. 뜻이 모호하거나 STT 오류인지 확신할 수 없는 부분은 ambiguities 에 넣고, 강사에게 확인할 질문을 쓰세요.
${existingPoints.length ? `\n이미 확정된 필기 항목이 있습니다. 이와 완전히 같은 내용은 다시 만들지 마세요:\n${existingPoints.map(formatPoint).join('\n')}\n` : ''}
# 이번에 입력된 필기 (STT)
${entries.map((e) => `## ${e.label || '필기'}${e.date ? ` (${e.date})` : ''}\n${e.rawText}`).join('\n\n')}`;
}

export const TRANSCRIBE_TASK = `첨부된 이미지는 학교 국어 수업 필기(교과서·프린트 위 손글씨 포함)입니다. 보이는 내용을 빠짐없이 글자로 옮기세요.
- 인쇄된 작품 원문과 손글씨 필기를 구분해, 손글씨는 해당 시구 옆에 "→ 필기:" 형태로 적으세요.
- 화살표·밑줄·별표 같은 표시는 [밑줄], [별표], [화살표: A→B] 처럼 괄호로 적으세요.
- 읽을 수 없는 부분은 추측하지 말고 [판독불가] 로 적고, unreadable 에 위치를 설명하세요.`;

export const TRANSCRIBE_DOC_TASK = `첨부된 문서(스캔본)의 내용을 빠짐없이 글자로 옮기세요. 쪽이 바뀌면 [N쪽] 을 적으세요. 읽을 수 없는 부분은 [판독불가] 로 적고 unreadable 에 위치를 설명하세요.`;

export function poemTask(project) {
  return `참고 자료에서 작품 「${project.title}」(${project.author || '작가 미상'})의 원문 전체를 찾아 그대로 옮기세요.
- 연 구분은 빈 줄로, 행 구분은 줄바꿈으로 표시하세요.
- 자료마다 표기가 다르면 교과서 수록본으로 보이는 표기를 따르고 note 에 차이를 적으세요.
- 자료에서 원문 전체를 찾지 못하면 found=false 로 하고 poem 은 빈 문자열로 두세요. 기억에 의존해 지어내지 마세요.`;
}

// ---------------- 교안 ----------------
export function lessonTask(kind, project) {
  const common = `작품 「${project.title}」 수업 교안을 만듭니다. 학교 필기 기준을 뼈대로 삼고, 필기 기준 항목과 일치하는 설명에는 문장 끝에 (필기 N번호) 를 붙이세요. 예: "… 성찰의 태도를 드러낸다. (필기 N3)"
- items 의 text 는 여러 줄이어도 됩니다. 줄바꿈으로 구분하세요.
- 섹션 kind 는 내용에 맞게 고르세요: overview(작품 개관), poem(원문·행별 풀이), flow(수업 흐름), lines(시구별 해설), points(내신 포인트), board(판서 계획), questions(발문·예상 질문), summary(핵심 정리), check(확인 문제), other.`;

  if (kind === 'teacher') {
    return `${common}

[교사용 교안] 강사가 수업하면서 보는 자료입니다. 다음을 모두 포함하세요.
1. 작품 개관: 갈래, 성격, 제재, 주제, 화자·상황, 시대적 배경, 표현상 특징 (label 에 항목명)
2. 수업 흐름: 도입-전개-정리, 단계별 예상 시간과 강사 멘트 요지 (label 에 "도입 5분" 형식)
3. 시구별 해설: 연/행 단위로 원문 시구(label) → 해설(text). 필기 기준을 우선 반영하고 시험 포인트는 앞에 ★ 표시
4. 내신 포인트: 이 학교 필기에서 시험에 나올 만한 것, 자주 틀리는 함정, 오답 선지로 자주 나오는 잘못된 해석
5. 판서 계획: 칠판에 쓸 구조도를 텍스트로
6. 발문: 학생에게 던질 질문과 기대 답변 (label=질문, text=기대 답변)
7. 핵심 정리: 한 장 요약. 학생용 교안의 빈칸 정답과 맞물리도록 핵심어를 {{ }} 로 감싸 표시 (예: {{부끄러움}})`;
  }
  return `${common}

[학생용 교안] 학생에게 나눠 주고 수업 중 채워 넣는 자료입니다. 인쇄해서 필기할 수 있게 구성하세요.
1. 작품 개관: 갈래·성격·제재·주제 등을 빈칸 채우기로 (핵심어는 {{정답}} 으로 감싸면 인쇄 시 빈칸이 됩니다)
2. 원문 읽기 도움: 연별로 원문 시구(label)와 그 옆에 채울 핵심 해석(text, 핵심어는 {{ }})
3. 내신 포인트 정리: 필기 기준 핵심 내용을 빈칸형으로
4. 확인 문제: O/X 5개 이상, 짧은 빈칸 문제 포함 (label=문제, text=정답과 한 줄 근거. 이 섹션 kind 는 check)
빈칸은 학생이 수업을 들으면 채울 수 있는 핵심어 위주로, 한 문장에 1~2개만 만드세요.`;
}

// ---------------- 문항 ----------------
export function blueprintTask({ setLabel, count, extraRatio, avoidStems, markedPoemHint }) {
  return `${setLabel} ${count}문항의 출제 설계표를 만드세요.
- 유형을 고르게 배분하세요: 내용 이해, 시어·시구의 의미, 화자의 정서·태도, 표현상 특징, 시상 전개, <보기> 외적 준거 감상, 작가·시대 맥락, 다른 작품과의 비교 등.
- 필기 기준의 ★시험 포인트는 반드시 여러 문항에서 다루세요. 각 문항이 근거로 삼을 필기 항목 ID 를 basisPoints 에 넣으세요 (없으면 빈 배열).
- 난이도 분포: 하 30% / 중 45% / 상 25% 정도.
- 다른 작품이나 비평문을 함께 제시하는 문항(useExtraPassage=true)은 전체의 약 ${Math.round(extraRatio * 100)}% 로 하되, 참고 자료에 실제로 있는 글만 쓸 수 있을 때만 true 로 하세요.
- focus 에는 그 문항이 묻는 구체적 내용을 한 줄로 쓰세요. 문항끼리 focus 가 겹치지 않게 하세요.
${markedPoemHint}
${avoidStems.length ? `\n다음 기존 문항과 겹치지 않게 하세요:\n${avoidStems.map((s) => '- ' + s).join('\n')}` : ''}`;
}

export function markedPoemInstruction(existing) {
  if (existing) {
    return `- markedPoem 은 다음 값을 그대로 돌려주세요 (이미 정해진 기호 표시본):\n${existing}`;
  }
  return `- markedPoem: 작품 원문에 문항에서 가리킬 기호를 넣은 "기호 표시본"을 만드세요. 원문 글자는 하나도 바꾸지 말고, 가리킬 시구 앞에 ㉠~㉤ 을 붙이고 해당 시구를 <u>…</u> 로 감싸세요. 필요하면 ⓐ~ⓔ 도 쓸 수 있습니다. 원문이 없으면 빈 문자열.`;
}

export function questionsTask({ items, markedPoem, avoidStems }) {
  return `아래 출제 설계에 따라 문항을 순서대로 ${items.length}개 만드세요.
- 윗글(작품)은 다음 "기호 표시본"으로 시험지에 인쇄됩니다. 기호(㉠ 등)는 여기에 있는 것만 쓰세요:
---
${markedPoem || '(원문 없음: 기호를 쓰지 말 것)'}
---
- 각 설계 항목에 "정답 번호"가 지정되어 있습니다. 그 번호가 정답이 되도록 선지를 배치하세요.
- choices 는 정확히 5개, 앞에 ①② 같은 번호를 붙이지 마세요.
- <보기>가 필요하면 bogi 에 내용만 쓰세요 (없으면 빈 문자열). 다른 작품·비평문은 extraPassage 에 쓰고 (없으면 빈 문자열), 참고 자료에 실제로 있는 글만 인용하세요.
- 해설(explanation)은 "정답 해설: …" 다음 줄부터 "① …" 처럼 선지별로 쓰세요.
- basisPoints 에 근거가 된 필기 항목 ID 를 넣으세요.
${avoidStems.length ? `- 다음 기존 문항과 같은 내용을 묻지 마세요:\n${avoidStems.map((s) => '  - ' + s).join('\n')}` : ''}

# 출제 설계
${items.map((it, i) => `${i + 1}. [${it.type} / 난이도 ${it.difficulty} / 정답 ${it.answerSlot}번${it.useExtraPassage ? ' / 추가 지문 사용' : ''}] ${it.focus}${it.basisPoints?.length ? ` (근거 필기: ${it.basisPoints.join(', ')})` : ''}`).join('\n')}`;
}

export function verifyTask(questions, markedPoem) {
  return `아래 문항들을 "학교 필기 기준"에 비추어 한 문항씩 검수하세요. 당신은 출제자가 아니라 까다로운 검토위원입니다.

판정(status):
- consistent: 정답·오답 판정이 필기 기준과 일치 (필기 항목이 직접 근거)
- unrelated: 필기에서 다루지 않은 내용이지만 통용 해석에 맞고 필기와 충돌하지 않음
- conflict: 정답 근거나 어떤 선지의 옳고 그름이 필기 기준과 어긋남 → 필기에 맞게 고친 문항을 proposal 에 쓰고 hasProposal=true
- delete: 고쳐도 필기와 맞출 수 없거나, 필기와 정면으로 다른 해석을 묻는 문항 → hasProposal=false

반드시 함께 확인할 것 (qualityIssue 에 기록, 문제 없으면 빈 문자열):
- 정답이 둘 이상이거나 정답이 없음, 지정된 정답 번호가 틀림
- 원문에 없는 시구 인용, 표시본에 없는 기호 사용
- 해설이 정답과 맞지 않음
품질 문제가 있고 고칠 수 있으면 status 를 conflict 로 하고 proposal 에 고친 문항을 쓰세요.

규칙:
- conflictPoints 에는 어긋나는 필기 항목 ID 를 넣으세요.
- reason 은 강사가 한눈에 이해하도록 1~3문장으로.
- hasProposal=false 일 때 proposal 은 모든 문자열을 빈 값, choices 는 빈 배열, answer 는 0 으로 채우세요.
- proposal 은 원래 문항의 유형·의도를 최대한 유지하고, 필요한 부분만 고치세요.
- qid 는 입력의 qid 를 그대로 쓰세요. 모든 문항에 대해 결과를 내세요.

# 시험지에 인쇄되는 작품 (기호 표시본)
${markedPoem || '(원문 없음)'}

# 검수할 문항
${JSON.stringify(questions.map(toVerifyShape), null, 1)}`;
}

function toVerifyShape(q) {
  return {
    qid: q.id,
    type: q.type,
    stem: q.stem,
    extraPassage: q.extraPassage,
    bogi: q.bogi,
    choices: q.choices,
    answer: q.answer,
    explanation: q.explanation,
    basisPoints: q.basisPoints,
  };
}

export function verifyDocTask(doc) {
  const lines = [];
  for (const s of doc.sections) {
    for (const it of s.items) lines.push(`(${it.id}) [${s.heading}] ${it.label ? it.label + ' — ' : ''}${it.text}`);
  }
  return `아래 교안의 각 항목을 "학교 필기 기준"과 대조하세요.
- 필기 기준과 어긋나는 해석, 필기에서 강조한 포인트를 틀리게 설명한 곳, 원문에 없는 시구 인용만 issues 로 보고하세요.
- 문체나 사소한 표현은 보고하지 마세요. 문제가 없으면 issues 는 빈 배열입니다.
- suggestion 에는 그 항목의 text 를 대체할 수정 문장 전체를 쓰세요 ({{ }} 빈칸 표시는 유지).
- itemId 는 괄호 안 ID 를 그대로 쓰세요.

# 교안 항목
${lines.join('\n')}`;
}
