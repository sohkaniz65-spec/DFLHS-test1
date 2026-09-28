// 인쇄용 페이지를 Chrome/Edge 로 열어 PDF 로 저장한다 (playwright-core 사용, 선택 기능).
import fs from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);

function findBrowser() {
  return CANDIDATES.find((p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  });
}

export async function renderPdf(url) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new Error('PDF 자동 저장 모듈이 없습니다. 인쇄 화면에서 "PDF로 저장"을 사용하세요.');
  }
  const executablePath = findBrowser();
  if (!executablePath) throw new Error('Chrome 또는 Edge 를 찾지 못했습니다. .env 의 CHROME_PATH 에 경로를 넣거나 인쇄 화면에서 "PDF로 저장"을 사용하세요.');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => window.__PRINT_READY === true, null, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}
