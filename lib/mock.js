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
    case 'teacher': {
      const lines = poemLines(input.project);
      return {
        overview: [
          { label: '갈래', text: '(연습 모드) 자유시, 서정시' },
          { label: '성격', text: '(연습 모드) 자료에서 모은 성격' },
          { label: '주제', text: '(연습 모드) 자료에서 모은 주제' },
        ],
        lines: lines.map((l, i) => ({ lineNo: i + 1, notes: i % 2 ? [] : [
          { phrase: l.split(' ')[0] || '', tag: '시어', text: `(연습 모드) ${i + 1}행 시어 풀이` },
          { phrase: '', tag: '표현', text: '(연습 모드) 함축 의미·표현법' },
        ] })),
        general: [{ label: '시상 전개', text: '(연습 모드) 연별 흐름 정리' }, { label: '내신 빈출', text: '(연습 모드) 자주 나오는 포인트' }],
        schoolPlacement: (input.project?.notes?.points || []).map((pt) => ({ pointId: pt.id, lineNo: 0 })),
        excluded: [{ text: '(연습 모드) 필기와 어긋나 뺀 자료 해석 예시', reason: '(연습 모드) 학교 필기와 다른 해석', conflictPoints: (input.project?.notes?.points || []).slice(0, 1).map((p) => p.id) }],
      };
    }
    case 'blueprint': {
      const n = input.count || 10;
      return {
        markedPoem: markPoem(input.project?.poem),
        items: Array.from({ length: n }, (_, i) => ({
          type: TYPES[i % TYPES.length],
          skill: ['작품 내용 이해', '시어·시구의 의미', '화자의 정서·태도', '표현상 특징', '시상 전개', '외적 준거 감상', '작품 간 비교'][i % 7],
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
    case 'comments':
      return {
        comments: (input.students || []).map((s) => ({
          id: s.id,
          comment: `(연습 모드) ${s.name} 학생은 이번 클리닉에서 ${s.score}문항을 맞혔습니다. ${s.skills.slice().sort((a, b) => a.rate - b.rate)[0]?.skill || '작품 이해'} 문제를 더 연습하면 좋겠습니다. 이번 주에는 틀린 문항의 해설을 다시 읽고 비슷한 유형을 풀어 보겠습니다.`,
        })),
      };
    default:
      throw new Error('mock: unknown kind ' + kind);
  }
}
