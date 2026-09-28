import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import CFB from 'cfb';
import JSZip from 'jszip';
import { extractHwp, decodeParaText } from '../lib/extract/hwp.js';
import { extractHwpx } from '../lib/extract/hwpx.js';
import { extractText } from '../lib/extract/index.js';

function record(tag, payload) {
  const h = Buffer.alloc(4);
  h.writeUInt32LE((tag & 0x3ff) | ((payload.length & 0xfff) << 20));
  return Buffer.concat([h, payload]);
}
const PARA_TEXT = 67;
const utf16 = (s) => Buffer.from(s, 'utf16le');

function makeHwp(paragraphs, { compressed = true } = {}) {
  const cfb = CFB.utils.cfb_new();
  const header = Buffer.alloc(256);
  header.write('HWP Document File', 0, 'latin1');
  header.writeUInt32LE(0x05000300, 32);
  header.writeUInt32LE(compressed ? 1 : 0, 36);
  let body = Buffer.concat(paragraphs.map((p) => Buffer.concat([record(66, Buffer.alloc(22)), record(PARA_TEXT, p)])));
  if (compressed) body = zlib.deflateRawSync(body);
  CFB.utils.cfb_add(cfb, 'FileHeader', header);
  CFB.utils.cfb_add(cfb, 'BodyText/Section0', body);
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }));
}

test('HWP 본문 문단을 순서대로 읽는다 (압축)', () => {
  const buf = makeHwp([utf16('창밖에 밤비가 속살거려\r'), utf16('육첩방은 남의 나라,\r')]);
  const { text } = extractHwp(buf);
  assert.equal(text, '창밖에 밤비가 속살거려\n육첩방은 남의 나라,');
});

test('HWP 비압축 문서도 읽는다', () => {
  const { text } = extractHwp(makeHwp([utf16('시인이란 슬픈 천명인 줄 알면서도\r')], { compressed: false }));
  assert.equal(text, '시인이란 슬픈 천명인 줄 알면서도');
});

test('HWP 확장 제어문자(8 WCHAR)는 건너뛰고 탭은 살린다', () => {
  const ctrl = (code) => { const b = Buffer.alloc(16); b.writeUInt16LE(code, 0); b.writeUInt16LE(code, 14); return b; };
  const buf = Buffer.concat([utf16('가'), ctrl(11), utf16('나'), ctrl(9), utf16('다'), utf16('\r')]);
  assert.equal(decodeParaText(buf), '가나\t다');
});

test('HWPX 문단 텍스트와 엔티티를 읽는다', async () => {
  const zip = new JSZip();
  zip.file('Contents/section0.xml', '<hs:sec xmlns:hp="x"><hp:p><hp:run><hp:t>땀내와 사랑내 &amp; 포근히</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>보내 주신<hp:tab/>학비 봉투</hp:t></hp:run></hp:p></hs:sec>');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const { text } = await extractHwpx(buf);
  assert.equal(text, '땀내와 사랑내 & 포근히\n보내 주신\t학비 봉투');
});

test('이미지는 스캔 상태로 분류된다', async () => {
  const r = await extractText(Buffer.from([0xff, 0xd8]), 'note.jpg');
  assert.equal(r.status, 'scan');
});

test('망가진 파일은 오류로 표시되고 멈추지 않는다', async () => {
  const r = await extractText(Buffer.from('not a hwp'), 'broken.hwp');
  assert.equal(r.status, 'error');
});
