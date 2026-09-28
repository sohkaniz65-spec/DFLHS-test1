// 연습 모드(MOCK_CLAUDE=1): API 없이 화면 흐름과 인쇄 디자인을 확인하기 위한 가짜 응답.
const MARKS = ['㉠', '㉡', '㉢', '㉣', '㉤'];
const TYPES = ['내용 이해', '시어의 의미', '화자의 태도', '표현상 특징', '시상 전개', '<보기> 감상', '시대적 맥락', '작품 비교'];

function poemLines(project) {
  return (project?.poem || '').split('\n').filter((l) => l.trim());
}

function markPoem(poem) {
  if (!poem?.trim()) return '';
  let k = 0;
  return poem.split('\n').map((line, i) => {
    if (line.trim() && i % 4 === 1 && k < MARKS.length) return `${MARKS[k++]}<u>${line.trim()}</u>`;
    return line;
  }).join('\n');
}

function fakeQuestion(i, item = {}) {
  const answer = item.answerSlot || ((i % 5) + 1);
  const withBogi = i % 4 === 2;
  return {
    type: item.type || TYPES[i % TYPES.length],
    difficulty: item.difficulty || ['하', '중', '상'][i % 3],
    stem: withBogi
      ? '<보기>를 참고하여 윗글을 감상한 내용으로 적절하지 않은 것은?'
      : ['윗글에 대한 이해로 가장 적절한 것은?', '㉠에 대한 설명으로 가장 적절한 것은?', '윗글의 표현상 특징으로 적절하지 않은 것은?'][i % 3],
    extraPassage: '',
    bogi: withBogi ? '(연습 모드) 이 작품은 식민지 현실 속에서 지식인이 느끼는 부끄러움과 자기 성찰을 형상화하고 있다. 화자는 현실에 대한 무력감을 넘어 내면의 화해를 통해 새로운 다짐에 이른다.' : '',
    choices: [1, 2, 3, 4, 5].map((n) => `(연습 모드) ${n}번 선지 예시 문장입니다. 실제 생성 시에는 필기 기준에 맞는 선지가 들어갑니다.`),
    answer,
    explanation: `정답 해설: (연습 모드) ${answer}번이 정답인 이유가 여기에 들어갑니다.\n① 오답 풀이 예시\n② 오답 풀이 예시\n③ 오답 풀이 예시\n④ 오답 풀이 예시\n⑤ 오답 풀이 예시`,
    basisPoints: item.basisPoints || [],
  };
}

export function mockResponse(kind, input = {}) {
  switch (kind) {
    case 'notes': {
      const text = (input.entries || []).map((e) => e.rawText).join('\n');
      const sentences = text.split(/[\n.。]+/).map((s) => s.trim()).filter((s) => s.length > 3);
      return {
        points: sentences.map((s, i) => ({
          target: s.split(/[은는이가:]/)[0].slice(0, 20) || '작품 전체',
          interpretation: s,
          examPoint: /중요|시험|별표|★/.test(s) || i === 0,
          sourceQuote: s,
        })),
        sttFixes: [{ heard: '(연습 모드 예시) 육첩 반', corrected: '육첩방' }],
        ambiguities: sentences.length ? [{ text: sentences[0], question: '(연습 모드) 이 부분이 선생님 해석이 맞는지 확인해 주세요.' }] : [],
      };
    }
    case 'transcribe':
      return { text: '(연습 모드) 이미지에서 읽은 글자가 여기에 들어갑니다.', unreadable: [] };
    case 'poem':
      return { found: false, title: input.project?.title || '', author: input.project?.author || '', poem: '', note: '(연습 모드) 실제 모드에서는 자료에서 원문을 찾아 옵니다.' };
    case 'lesson': {
      const lines = poemLines(input.project);
      const teacher = input.docKind === 'teacher';
      const sections = [
        { heading: '작품 개관', kind: 'overview', items: [
          { label: '갈래', text: '자유시, 서정시' },
          { label: '성격', text: teacher ? '성찰적, 고백적, 저항적' : '{{성찰적}}, 고백적, 저항적' },
          { label: '주제', text: '어두운 시대 현실 속에서의 {{자기 성찰}}과 극복 의지' },
        ] },
        { heading: teacher ? '시구별 해설' : '원문 읽기 도움', kind: 'lines', items: (lines.length ? lines.slice(0, 8) : ['(원문 미입력)']).map((l) => ({ label: l, text: '(연습 모드) 이 시구에 대한 {{핵심 해석}}이 들어갑니다. (필기 N1)' })) },
      ];
      if (teacher) {
        sections.splice(1, 0, { heading: '수업 흐름', kind: 'flow', items: [
          { label: '도입 5분', text: '시인의 생애와 창작 배경 소개' },
          { label: '전개 30분', text: '연별 읽기와 시어 풀이, 필기 포인트 확인' },
          { label: '정리 10분', text: '핵심 정리와 확인 문제' },
        ] });
        sections.push({ heading: '내신 포인트', kind: 'points', items: [{ label: '★', text: '(연습 모드) 시험 포인트 예시' }] });
        sections.push({ heading: '판서 계획', kind: 'board', items: [{ label: '', text: '현실 인식 → 부끄러움 → 성찰 → 다짐' }] });
      } else {
        sections.push({ heading: '확인 문제', kind: 'check', items: [
          { label: '화자는 현실에 순응하는 태도를 보인다. (O / X)', text: 'X — 성찰을 통해 극복 의지를 보인다.' },
          { label: '이 시의 주제는 ________ 이다.', text: '자기 성찰과 극복 의지' },
        ] });
      }
      return { title: `「${input.project?.title || '작품'}」 ${teacher ? '교사용' : '학생용'} 교안`, subtitle: '(연습 모드 예시)', sections };
    }
    case 'verifyDoc':
      return { issues: [] };
    case 'blueprint': {
      const n = input.count || 10;
      return {
        markedPoem: markPoem(input.project?.poem),
        items: Array.from({ length: n }, (_, i) => ({
          type: TYPES[i % TYPES.length],
          focus: `(연습 모드) ${i + 1}번 문항이 묻는 내용`,
          difficulty: ['하', '중', '상'][i % 3],
          useExtraPassage: false,
          basisPoints: [],
        })),
      };
    }
    case 'questions':
      return { questions: (input.items || []).map((it, i) => fakeQuestion(i, it)) };
    case 'verify':
      return {
        results: (input.questions || []).map((q, i) => {
          const conflict = i % 7 === 3;
          const del = i % 11 === 5;
          const empty = { type: '', difficulty: '중', stem: '', extraPassage: '', bogi: '', choices: [], answer: 0, explanation: '', basisPoints: [] };
          return {
            qid: q.id,
            status: del ? 'delete' : conflict ? 'conflict' : i % 2 ? 'unrelated' : 'consistent',
            reason: del
              ? '(연습 모드) 필기와 정면으로 다른 해석을 묻고 있어 삭제를 권합니다.'
              : conflict
                ? '(연습 모드) 3번 선지를 오답으로 처리했지만, 필기에서는 이 해석을 옳다고 가르쳤습니다.'
                : '(연습 모드) 필기 기준과 일치합니다.',
            conflictPoints: conflict || del ? ['N1'] : [],
            qualityIssue: '',
            hasProposal: conflict,
            proposal: conflict ? { ...q, stem: q.stem + ' (필기에 맞게 수정됨)', explanation: '정답 해설: (연습 모드) 필기 기준에 맞춘 해설' } : empty,
          };
        }),
      };
    default:
      throw new Error('mock: unknown kind ' + kind);
  }
}
