// PDF 텍스트 레이어 추출. 스캔본(글자가 이미지)이면 거의 빈 텍스트가 나온다 → 'scan' 상태로 표시.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extractPdf(buffer) {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let s = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      s += item.str;
      if (item.hasEOL) s += '\n';
    }
    pages.push(s.trim());
    page.cleanup();
  }
  const numPages = doc.numPages;
  await doc.destroy();
  const text = pages.map((p, i) => `[${i + 1}쪽]\n${p}`).join('\n\n');
  const realChars = pages.join('').replace(/\s/g, '').length;
  // 쪽당 평균 30자 미만이면 스캔본으로 본다
  const looksScanned = realChars < Math.max(30, numPages * 30);
  return { text: looksScanned ? '' : text, numPages, looksScanned, warnings: [] };
}
