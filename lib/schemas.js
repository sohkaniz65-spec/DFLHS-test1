// Claude 응답 JSON 스키마 (structured outputs). 모든 object 는 additionalProperties:false + required 전부.
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const str = { type: 'string' };
const bool = { type: 'boolean' };
const int = { type: 'integer' };
const arr = (items) => ({ type: 'array', items });

export const NOTES_SCHEMA = obj({
  points: arr(obj({
    target: str,          // 시어·구절·연 또는 "작품 전체"
    interpretation: str,  // 선생님 해석 (그대로)
    examPoint: bool,      // 선생님이 시험 포인트로 강조했는가
    sourceQuote: str,     // 근거가 된 입력 문장
  })),
  sttFixes: arr(obj({ heard: str, corrected: str })),
  ambiguities: arr(obj({ text: str, question: str })),
});

export const TRANSCRIBE_SCHEMA = obj({
  text: str,
  unreadable: arr(str),
});

export const POEM_SCHEMA = obj({
  found: bool,
  title: str,
  author: str,
  poem: str,
  note: str,
});

const lessonItem = obj({ label: str, text: str });
export const LESSON_SCHEMA = obj({
  title: str,
  subtitle: str,
  sections: arr(obj({
    heading: str,
    kind: { type: 'string', enum: ['overview', 'poem', 'flow', 'lines', 'points', 'board', 'questions', 'summary', 'check', 'other'] },
    items: arr(lessonItem),
  })),
});

export const BLUEPRINT_SCHEMA = obj({
  markedPoem: str,
  items: arr(obj({
    type: str,
    focus: str,
    difficulty: { type: 'string', enum: ['하', '중', '상'] },
    useExtraPassage: bool,
    basisPoints: arr(str),
  })),
});

export const QUESTION_PROPS = {
  type: str,
  difficulty: { type: 'string', enum: ['하', '중', '상'] },
  stem: str,
  extraPassage: str,
  bogi: str,
  choices: arr(str),
  answer: int,
  explanation: str,
  basisPoints: arr(str),
};
export const QUESTION_SCHEMA = obj(QUESTION_PROPS);

export const QUESTIONS_SCHEMA = obj({ questions: arr(QUESTION_SCHEMA) });

export const VERIFY_SCHEMA = obj({
  results: arr(obj({
    qid: str,
    status: { type: 'string', enum: ['consistent', 'unrelated', 'conflict', 'delete'] },
    reason: str,
    conflictPoints: arr(str),
    qualityIssue: str,
    hasProposal: bool,
    proposal: QUESTION_SCHEMA,
  })),
});

export const VERIFY_DOC_SCHEMA = obj({
  issues: arr(obj({
    itemId: str,
    problem: str,
    suggestion: str,
    conflictPoints: arr(str),
  })),
});
