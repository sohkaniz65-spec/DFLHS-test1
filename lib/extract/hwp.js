// HWP 5.0 (바이너리 .hwp) 본문 텍스트 추출.
// 구조: OLE 복합 파일 → FileHeader(압축 여부) → BodyText/SectionN (raw deflate) → 레코드 → PARA_TEXT(태그 67)
import CFB from 'cfb';
import zlib from 'node:zlib';

const HWPTAG_PARA_TEXT = 0x10 + 51; // 67

function streamsByPath(cfb) {
  const map = new Map();
  cfb.FullPaths.forEach((p, i) => {
    const entry = cfb.FileIndex[i];
    if (entry && entry.type === 2) map.set(p.replace(/^[^/]*\//, ''), entry.content);
  });
  return map;
}

function toBuffer(content) {
  return Buffer.isBuffer(content) ? content : Buffer.from(content);
}

// 제어 문자: 1 WCHAR 짜리(char형)가 아니면 8 WCHAR(16바이트) 를 차지한다.
const CHAR_CONTROLS = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);

export function decodeParaText(buf) {
  let out = '';
  for (let i = 0; i + 1 < buf.length; ) {
    const c = buf.readUInt16LE(i);
    if (c >= 32) {
      out += String.fromCharCode(c);
      i += 2;
      continue;
    }
    if (CHAR_CONTROLS.has(c)) {
      if (c === 10) out += '\n';
      else if (c === 30 || c === 31) out += ' ';
      i += 2;
    } else {
      if (c === 9) out += '\t';
      i += 16;
    }
  }
  return out;
}

export function parseSectionRecords(data) {
  const paras = [];
  let off = 0;
  while (off + 4 <= data.length) {
    const header = data.readUInt32LE(off);
    off += 4;
    const tag = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;
    if (size === 0xfff) {
      if (off + 4 > data.length) break;
      size = data.readUInt32LE(off);
      off += 4;
    }
    if (off + size > data.length) break;
    if (tag === HWPTAG_PARA_TEXT) {
      paras.push(decodeParaText(data.subarray(off, off + size)));
    }
    off += size;
  }
  return paras;
}

export function extractHwp(buffer) {
  const cfb = CFB.read(buffer, { type: 'buffer' });
  const streams = streamsByPath(cfb);
  const header = streams.get('FileHeader');
  if (!header) throw new Error('HWP 5.0 형식이 아닙니다 (FileHeader 없음). 한글에서 다른 이름으로 저장 → .hwp 또는 .hwpx 로 다시 저장해 보세요.');
  const hbuf = toBuffer(header);
  const sig = hbuf.subarray(0, 17).toString('latin1');
  if (sig !== 'HWP Document File') throw new Error('HWP 서명이 올바르지 않습니다.');
  const props = hbuf.readUInt32LE(36);
  const compressed = (props & 1) === 1;
  const encrypted = (props & 2) === 2;
  const distribution = (props & 4) === 4;

  const warnings = [];
  if (encrypted) throw new Error('암호가 걸린 HWP 파일입니다. 한글에서 암호를 해제한 뒤 다시 올려 주세요.');

  const sectionNames = [...streams.keys()]
    .filter((k) => /^BodyText\/Section\d+$/.test(k))
    .sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]));

  const paragraphs = [];
  if (!distribution) {
    for (const name of sectionNames) {
      let data = toBuffer(streams.get(name));
      if (compressed) data = zlib.inflateRawSync(data);
      paragraphs.push(...parseSectionRecords(data));
    }
  }

  let text = paragraphs.map((p) => p.replace(/\s+$/u, '')).join('\n');
  if (!text.trim()) {
    // 배포용 문서 등 본문을 못 읽으면 미리보기 텍스트라도 사용
    const prv = streams.get('PrvText');
    if (prv) {
      text = toBuffer(prv).toString('utf16le');
      warnings.push(distribution
        ? '배포용(읽기 전용) HWP라 미리보기 텍스트 일부만 읽었습니다. 한글에서 PDF로 저장해 올리면 전체를 읽을 수 있습니다.'
        : '본문을 읽지 못해 미리보기 텍스트 일부만 사용했습니다.');
    }
  }
  return { text, warnings };
}
