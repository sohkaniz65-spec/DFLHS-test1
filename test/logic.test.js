import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, suggestAliases, queryTerms, norm } from '../lib/search.js';
import { validMarkedPoem, cleanQuestion } from '../lib/pipeline.js';
import { rich } from '../public/shared.js';

const POEM = '창밖에 밤비가 속살거려\n육첩방은 남의 나라,\n\n시인이란 슬픈 천명인 줄 알면서도';

test('표기 변형 별칭: 씌어진 ↔ 쓰여진', () => {
  assert.deepEqual(suggestAliases('쉽게 씌어진 시').sort(), ['쉽게 쓰여진 시', '쉽게 쓰인 시'].sort());
  assert.ok(suggestAliases('쉽게 쓰여진 시').includes('쉽게 씌어진 시'));
});

test('검색어에 제목·별칭·원문 구절이 들어간다', () => {
  const terms = queryTerms({ title: '쉽게 씌어진 시', aliases: ['쉽게 쓰여진 시'], author: '윤동주', poem: POEM });
  assert.ok(terms.some((t) => t.n === norm('쉽게 쓰여진 시')));
  assert.ok(terms.some((t) => t.kind === 'line' && t.n === norm('시인이란 슬픈 천명인 줄 알면서도')));
});

test('긴 텍스트를 조각으로 나눈다', () => {
  const chunks = chunkText('가'.repeat(3000) + '\n\n' + '나'.repeat(10));
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.map((c) => c.text).join('').replace(/\s/g, ''), '가'.repeat(3000) + '나'.repeat(10));
});

test('기호 표시본은 원문 글자가 같을 때만 쓴다', () => {
  const ok = POEM.replace('육첩방은 남의 나라,', '㉠<u>육첩방은 남의 나라,</u>');
  assert.equal(validMarkedPoem(ok, POEM), ok);
  const changed = POEM.replace('육첩방은', '다다미방은');
  assert.equal(validMarkedPoem(changed, POEM), POEM);
});

test('문항 정리: 선지 번호 제거, 형식 오류 표시', () => {
  const q = cleanQuestion({ stem: 's', choices: ['① 가', '② 나', '다', '라'], answer: 7 });
  assert.deepEqual(q.choices, ['가', '나', '다', '라']);
  assert.match(q.formatIssue, /선지가 4개/);
  assert.match(q.formatIssue, /정답 번호/);
});

test('서식: HTML 은 막고 <u> 와 빈칸만 살린다', () => {
  assert.equal(rich('<script>x</script><u>밑줄</u>'), '&lt;script&gt;x&lt;/script&gt;<u>밑줄</u>');
  assert.match(rich('주제는 {{성찰}}', 'blank'), /blank-line/);
  assert.equal(rich('주제는 {{성찰}}', 'plain'), '주제는 성찰');
  assert.equal(rich('<u>열림'), '<u>열림</u>');
});
