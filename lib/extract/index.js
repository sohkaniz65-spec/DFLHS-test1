import path from 'node:path';
import { extractHwp } from './hwp.js';
import { extractHwpx } from './hwpx.js';
import { extractPdf } from './pdf.js';

export const SUPPORTED_EXT = ['.hwp', '.hwpx', '.pdf', '.txt', '.md', '.jpg', '.jpeg', '.png', '.webp', '.gif'];
export const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

export function isSupported(name) {
  return SUPPORTED_EXT.includes(path.extname(name).toLowerCase());
}

/**
 * 파일 버퍼에서 텍스트를 뽑는다.
 * 반환 status: 'ok' | 'scan'(스캔본·이미지: Claude로 판독 필요) | 'empty' | 'error'
 */
export async function extractText(buffer, name) {
  const ext = path.extname(name).toLowerCase();
  try {
    if (IMAGE_EXT.includes(ext)) {
      return { status: 'scan', text: '', warnings: ['이미지 파일입니다. 필요하면 "Claude로 읽기"를 눌러 글자로 옮기세요.'] };
    }
    let r;
    if (ext === '.hwp') r = extractHwp(buffer);
    else if (ext === '.hwpx') r = await extractHwpx(buffer);
    else if (ext === '.pdf') {
      r = await extractPdf(buffer);
      if (r.looksScanned) {
        return { status: 'scan', text: '', warnings: ['글자 정보가 없는 스캔 PDF입니다. 필요하면 "Claude로 읽기"를 누르세요.'] };
      }
    } else if (ext === '.txt' || ext === '.md') r = { text: buffer.toString('utf8'), warnings: [] };
    else return { status: 'error', text: '', warnings: ['지원하지 않는 형식: ' + ext] };

    const text = normalize(r.text);
    return { status: text.trim() ? 'ok' : 'empty', text, warnings: r.warnings || [] };
  } catch (err) {
    return { status: 'error', text: '', warnings: [String(err.message || err)] };
  }
}

export function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n');
}
