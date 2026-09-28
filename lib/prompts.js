// 프롬프트. SYSTEM 은 모든 호출에서 동일하게 유지한다 (프롬프트 캐시 재사용).

export const SYSTEM = `당신은 한국 고등학교 내신 국어(문학) 전문 강사이자 출제 검토위원입니다. 학원 강사가 특정 학교 내신 대비 수업자료를 만드는 일을 돕습니다.

[최우선 원칙: 학교 필기 기준]
- "학교 필기 기준"은 해당 학교 선생님이 수업 시간에 가르친 해석입니다. 모든 해석·정답 판정의 최종 기준입니다.
- 필기 기준과 어긋나는 해석을 정답 근거로 쓰지 않습니다. 필기에서 옳다고 가르친 내용을 오답(틀린 선지)으로 만들지 않습니다.
- 필기에 없는 내용은 교과서·EBS 등에서 널리 통용되는 해석만 사용합니다. 해석이 갈리는 내용은 정답 판정의 근거로 쓰지 않습니다.
- 참고 자료와 필기가 충돌하면 필기를 따릅니다. 참고 자료는 사실 확인과 문제 소재로만 씁니다.

[작품 원문]
- 작품 원문을 임의로 고치거나 지어내지 않습니다. 제공된 원문에 없는 시구를 인용하지 않습니다.

[자료를 읽고 쓰는 원칙 — 가리온학원 편집 규칙]
- 여러 자료(교과서 본문, 지도서, 자습서, 해설서, 학교 기출 문항과 해설)를 읽고 하나의 흐름으로 새로 씁니다. 자료의 해설 문장을 그대로 베끼지 말고 새 문장으로 씁니다.
- 사실(작가 연보, 출전, 수록 교과서, 창작 연도, 기출 연도)은 자료에 있는 것만 씁니다. 자료에 없으면 쓰지 않습니다.
- 자료끼리 해석이 어긋나면(같은 구절을 정반대로 풀면) 학교 필기 기준 → 교과서·지도서 → 널리 통용되는 해석 순으로 따릅니다.
- 출처를 쓰지 않습니다: 기출 문항·풀이에 학교명·교재명·출판사를 적지 않습니다.
- 서지정보를 쓰지 않습니다: 원 자료의 저자·발행처·ISBN·가격·발행일 같은 자료 자체의 정보는 어디에도 싣지 않습니다.
- 학원명·브랜드는 본문에 쓰지 않습니다(인쇄물 꼬리말에만 들어갑니다).
- 번역·판본 차이 대조표는 만들지 않습니다.
- 기출 해설에서 확인된 내용은 풀이에 녹여 씁니다. 예: "'○○'를 △△로 본 선지가 옳은 선지로 출제", "'○○'를 □□로 본 것은 오답".
- 비교 감상에는 같은 작가의 다른 작품을 반드시 넣습니다(작자 미상이면 같은 갈래의 작품).

[문항 작성 규칙]
- 모든 문항은 5지선다 객관식입니다. 서술형은 만들지 않습니다.
- 정답은 정확히 하나여야 하고, 오답 선지는 필기·원문에 비추어 명백히 틀린 이유가 있어야 합니다.
- 발문은 실제 내신 시험 문체를 따릅니다. (예: "윗글에 대한 이해로 가장 적절한 것은?", "<보기>를 참고하여 윗글을 감상한 내용으로 적절하지 않은 것은?")
- 해설은 학생이 혼자 읽고 이해할 수 있게 "정답 근거 → [오답 풀이] ①…⑤" 순서로 씁니다. ㄱ·ㄴ·ㄷ형처럼 선지별 오답 설명이 어색한 문항은 오답 풀이를 생략해도 됩니다.
- 발문과 선지 사이에 딸린 글(비평문, 학생의 메모, 자료 설명 등)은 모두 <보기>로 싣습니다. 발문에 '조건'이 있으면 <조건>으로 봅니다.
- ㉠·ⓐ 같은 기호는 시험지에 인쇄되는 기호 표시본에 있는 것만 씁니다. 지문이 한 작품뿐이면 '(가)', '이 시', '위 작품'은 '윗글'로 통일합니다.
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
- 기준 본문: 교과서 본문 자료가 있으면 그 본문을 기준으로 삼고, 다른 자료의 같은 문장과 대조해 띄어쓰기를 바로잡으세요. 교과서 본문이 없으면 자료에 가장 많이 실린 판본을 따르고 note 에 그렇게 했다고 적으세요.
- 원문에 붙은 ㉠·ⓐ·[A] 같은 기호, 밑줄 표시, 문항 번호는 지우고 순수한 작품 본문만 옮기세요.
- 자료에서 원문 전체를 찾지 못하면 found=false 로 하고 poem 은 빈 문자열로 두세요. 기억에 의존해 지어내지 마세요.`;
}

// ---------------- 교안 ----------------
export function poemLines(poem) {
  return (poem || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

export function teacherTask(project) {
  const lines = poemLines(project.poem);
  return `강사가 수업 전에 교과서 위에 해 두는 "필기"를 대신 만듭니다. 참고 자료(자습서·해설서·프린트)에 흩어진 「${project.title}」 해석을 응축해, 시구마다 옆에 적어 둘 짧은 필기로 정리하세요.

규칙:
- 근거는 참고 자료입니다. 자료에 없는 해석은 교과서·EBS 등에서 널리 통용되는 것만 쓰세요. 지어내지 마세요.
- 여러 자료가 같은 말을 하면 한 번만, 가장 정확한 표현으로 쓰세요.
- 필기는 자습서의 '단락 풀이'처럼 씁니다. 시구당 1~5개, 한 항목 1~2줄.
  - phrase: 그 줄에서 풀이할 구절을 원문 그대로(글자·띄어쓰기까지 똑같이) 뽑으세요. 인쇄할 때 이 구절에 형광 밑줄과 ①② 번호가 붙습니다. 줄 전체에 대한 필기면 빈 문자열.
  - tag: 구절, 시어, 표현, 화자, 상징, 출제 중 하나. '출제'는 기출 선지와 직접 연결되는 풀이에 씁니다.
  - text: 풀이. 핵심어는 <b>…</b> 로 굵게 할 수 있습니다. 기출에서 옳은 선지·오답 선지로 나온 내용은 녹여 쓰세요.
- 학교 필기 기준은 따로 빨간색으로 그대로 인쇄됩니다. 같은 내용을 되풀이하지 마세요.
- 자료의 해석이 학교 필기 기준과 어긋나면 그 해석은 넣지 말고 excluded 에 옮기고, 어긋나는 필기 ID 와 이유를 적으세요. 애매하면 넣지 말고 excluded 로 보내세요.

출력:
- overview: 핵심 정리 (갈래, 성격, 제재, 주제(여러 진술이 있으면 함께), 화자·시적 상황, 어조, 시상 전개, 표현상 특징, 출전·창작 배경. label=항목명)
- lines: 아래 번호가 붙은 시구별 필기 (lineNo=줄 번호, 필기가 없는 줄은 빼도 됩니다)
- general: 작품 전체에 대한 필기. label 을 아래 이름 그대로 쓰세요(자료가 없는 항목은 빼세요).
  시상 전개 / 화자와 대상 / 표현상 특징 / 핵심 소재와 상징 / 기출 포인트 / 자주 나오는 함정 / 비교 감상(같은 작가의 다른 작품 포함) / 한 문장으로 기억하기
- schoolPlacement: 학교 필기 기준의 각 항목이 몇 번째 줄에 대한 것인지 (작품 전체에 대한 것이면 lineNo=0)
- excluded: 빼낸 자료 해석

# 줄 번호가 붙은 원문
${lines.length ? lines.map((l, i) => `[${i + 1}] ${l}`).join('\n') : '(원문 없음: lines 는 빈 배열로 두세요)'}`;
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
- 해설(explanation)은 첫 줄에 정답 근거를 쓰고, 다음 줄에 "[오답 풀이]", 그 아래 "① …" 처럼 선지별로 쓰세요. 학교명·교재명과 필기 항목 ID(N1 등)는 해설에 쓰지 마세요(학생에게 나가는 해설입니다). 근거 필기 ID 는 basisPoints 에만 넣으세요.
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
