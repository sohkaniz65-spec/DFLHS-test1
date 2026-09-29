import { ALL_SKILLS } from './genres.js';
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

// 교사용 교안: 자료(자습서) 해석만 Claude 가 만든다. 학교 필기는 코드가 그대로 붙인다.
export const TEACHER_SCHEMA = obj({
  overview: arr(obj({ label: str, text: str })),
  lines: arr(obj({
    lineNo: int,
    notes: arr(obj({ phrase: str, tag: { type: 'string', enum: ['구절', '시어', '표현', '화자', '상징', '인물', '서술', '개념', '구조', '근거', '예시', '어휘', '예문', '비교', '예외', '출제'] }, text: str })),
  })),
  general: arr(obj({ label: str, text: str })),
  schoolPlacement: arr(obj({ pointId: str, lineNo: int })),
  excluded: arr(obj({ text: str, reason: str, conflictPoints: arr(str) })),
});

export const BLUEPRINT_SCHEMA = obj({
  markedPoem: str,
  items: arr(obj({
    type: str,
    skill: { type: 'string', enum: ALL_SKILLS },
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

// 학부모 코멘트
export const COMMENTS_SCHEMA = obj({
  comments: arr(obj({ id: str, comment: str })),
});
