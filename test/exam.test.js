import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnswerString, parseOmrPaste, gradeExam, weakSkills } from '../public/examStats.js';

test('답 문자열: 띄어쓰기·무응답·동그라미 숫자', () => {
  assert.deepEqual(parseAnswerString('135 2-', 6), [1, 3, 5, 2, null, null]);
  assert.deepEqual(parseAnswerString('①⑤0', 3), [1, 5, null]);
});

test('OMR 붙여넣기: 공백형·번호 앞·엑셀 탭형·머리글', () => {
  const rows = parseOmrPaste('이름\t1\t2\t3\n홍길동 13 5\n3 김하나 2 4 1\n박철수\t1\t\t5', 3);
  assert.deepEqual(rows, [
    { name: '홍길동', answers: [1, 3, 5] },
    { name: '김하나', answers: [2, 4, 1] },
    { name: '박철수', answers: [1, null, 5] },
  ]);
});

test('채점: 파트·능력별 정답률, 반 평균, 약점', () => {
  const q = (answer, skill) => ({ id: Math.random() + '', answer, skill, stem: '', choices: [] });
  const exam = {
    parts: [
      { id: 'a', title: 'A', questions: [q(1, '표현상 특징'), q(2, '표현상 특징')] },
      { id: 'b', title: 'B', questions: [q(3, '문법 개념 이해'), q(4, '문법 개념 이해')] },
    ],
    students: [
      { id: 's1', name: '가', answers: [1, 2, 1, 1] },
      { id: 's2', name: '나', answers: [1, 2, 3, 4] },
      { id: 's3', name: '다', answers: [] },
    ],
  };
  const g = gradeExam(exam);
  assert.equal(g.n, 4);
  assert.equal(g.gradedCount, 2);
  assert.equal(g.students[0].score, 2);
  assert.deepEqual(g.students[0].parts.map((p) => p.rate), [100, 0]);
  assert.equal(g.classAvg.score, 3);
  assert.equal(g.questions[2].rate, 50);
  assert.deepEqual(g.questions[2].dist, [1, 0, 1, 0, 0, 0]);
  assert.deepEqual(weakSkills(g.students[0], g.classAvg).map((k) => k.skill), ['문법 개념 이해']);
  assert.equal(g.students[2].graded, false);
});
