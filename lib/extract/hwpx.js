// HWPX (한글 개방형 XML, zip) 본문 텍스트 추출.
import JSZip from 'jszip';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export function sectionXmlToText(xml) {
  const lines = [];
  // 문단 단위로 자른다 (접두사는 보통 hp: 이지만 고정하지 않음)
  const paraRe = /<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/g;
  let m;
  while ((m = paraRe.exec(xml))) {
    const body = m[1];
    let line = '';
    const tRe = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t\b[^>]*\/>/g;
    let t;
    while ((t = tRe.exec(body))) {
      if (t[1] === undefined) continue;
      line += decodeEntities(
        t[1]
          .replace(/<(?:\w+:)?tab\b[^>]*\/>/g, '\t')
          .replace(/<(?:\w+:)?lineBreak\b[^>]*\/>/g, '\n')
          .replace(/<[^>]+>/g, ''),
      );
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export async function extractHwpx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sections = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/i)[1]) - Number(b.match(/(\d+)\.xml$/i)[1]));
  if (!sections.length) throw new Error('HWPX 안에서 본문(section) 파일을 찾지 못했습니다.');
  const parts = [];
  for (const name of sections) parts.push(sectionXmlToText(await zip.file(name).async('string')));
  return { text: parts.join('\n'), warnings: [] };
}
