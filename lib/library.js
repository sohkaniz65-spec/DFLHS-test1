// 자료실: 업로드한 파일과 등록한 로컬 폴더(OneDrive 동기화 폴더 등)를 읽어 텍스트로 보관한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  LIB_FILES_DIR, LIB_TEXT_DIR, getLibrary, updateLibrary, writeLibraryText, newId,
} from './store.js';
import { extractText, isSupported, IMAGE_EXT } from './extract/index.js';
import { transcribeImage } from './pipeline.js';

const MAX_BYTES = 400 * 1024 * 1024; // 자습서 PDF 는 수백 MB 인 경우가 있다

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' };

function entryFromExtract(base, r) {
  return {
    ...base,
    status: r.status,
    chars: r.text.length,
    warnings: r.warnings,
    extractedAt: new Date().toISOString(),
  };
}

export async function addUploadedFile(tmpPath, originalName, relPath) {
  const ext = path.extname(originalName).toLowerCase();
  const id = newId('f_');
  const stored = path.join(LIB_FILES_DIR, id + ext);
  await fs.rename(tmpPath, stored).catch(async () => {
    await fs.copyFile(tmpPath, stored);
    await fs.rm(tmpPath, { force: true });
  });
  const buf = await fs.readFile(stored);
  const r = await extractText(buf, originalName);
  await writeLibraryText(id, r.text);
  const entry = entryFromExtract({
    id, name: originalName, relPath: relPath || originalName, ext, size: buf.length,
    source: 'upload', storedPath: stored, addedAt: new Date().toISOString(),
  }, r);
  await updateLibrary((lib) => {
    // 같은 경로로 다시 올리면 교체
    const old = lib.files.filter((f) => f.source === 'upload' && f.relPath === entry.relPath);
    lib.files = lib.files.filter((f) => !old.includes(f));
    for (const o of old) fs.rm(o.storedPath, { force: true }).catch(() => {});
    lib.files.push(entry);
  });
  return entry;
}

const PERMISSION_HINT = '맥의 보안 설정이 막고 있을 수 있습니다. 시스템 설정 → 개인정보 보호 및 보안 → "전체 디스크 접근 권한"에서 "터미널"을 켜고, 검은 창을 닫았다가 start.command 를 다시 실행하세요.';

// stats: { dirs, files, errors: [경로...] }
async function walk(dir, out = [], onCount = () => {}, stats = { dirs: 0, files: 0, errors: [] }, skipImages = false) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
    stats.dirs++;
  } catch (err) {
    stats.errors.push(`${dir} (${err.code || err.message})`);
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
    const full = path.join(dir, e.name);
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (!isDir && !isFile) {
      // 클라우드 전용 파일·바로 가기 등은 종류를 따로 확인해야 한다
      const st = await fs.stat(full).catch(() => null);
      isDir = Boolean(st?.isDirectory());
      isFile = Boolean(st?.isFile());
    }
    if (isDir) await walk(full, out, onCount, stats, skipImages);
    else if (isFile) {
      stats.files++;
      if (!isSupported(e.name)) continue;
      if (skipImages && IMAGE_EXT.includes(path.extname(e.name).toLowerCase())) continue;
      out.push(full);
      if (out.length % 1000 === 0) onCount(out.length, stats.dirs);
    }
  }
  return out;
}

/**
 * 등록된 폴더의 "파일 목록"만 만든다. 파일 내용은 읽지 않는다.
 * (OneDrive 500GB 전체를 내려받지 않기 위해: 내용은 작품별로 고른 파일만 extractFiles 로 읽는다)
 */
export async function scanFolder(root, progress = () => {}) {
  const abs = path.resolve(root);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('폴더를 찾을 수 없습니다: ' + abs);
  progress(0, 0, '파일 목록을 만드는 중… (파일 수가 많으면 몇 분 걸립니다)');
  const stats = { dirs: 0, files: 0, errors: [] };
  // 사진(JPG·PNG)은 목록에서 뺀다: 수가 많고, 필기 사진은 학교 필기 탭에서 따로 다룬다
  const files = await walk(abs, [], (n, d) => progress(0, 0, `파일 목록을 만드는 중… 자료 ${n.toLocaleString()}개 (폴더 ${d.toLocaleString()}개 확인)`), stats, true);
  if (!stats.dirs) throw new Error(`폴더를 열 수 없습니다. ${PERMISSION_HINT}`);
  if (!files.length) {
    throw new Error(`폴더는 열렸지만 HWP·PDF 등 자료 파일을 찾지 못했습니다. (하위 폴더 ${stats.dirs - 1}개, 전체 파일 ${stats.files}개, 못 연 폴더 ${stats.errors.length}개) `
      + (stats.errors.length || stats.dirs <= 1 ? PERMISSION_HINT : 'OneDrive 앱이 파일 목록을 아직 받는 중일 수 있으니 잠시 뒤 목록 새로고침을 눌러 보세요.'));
  }
  progress(files.length, files.length, `목록 저장 중… 자료 ${files.length.toLocaleString()}개`);
  const lib = await getLibrary();
  const known = new Map(lib.files.filter((f) => f.source === 'folder').map((f) => [f.absPath, f]));
  // 파일마다 정보를 따로 묻지 않는다(수십만 개면 오래 걸림). 크기·수정일은 읽을 때 확인한다.
  const results = files.map((full) => known.get(full) || {
    id: newId('f_'), name: path.basename(full), relPath: path.join(path.basename(abs), path.relative(abs, full)),
    ext: path.extname(full).toLowerCase(), size: 0, mtimeMs: 0,
    source: 'folder', root: abs, absPath: full, status: 'indexed', chars: 0, warnings: [],
    addedAt: new Date().toISOString(),
  });
  await updateLibrary((cur) => {
    const keepOthers = cur.files.filter((f) => !(f.source === 'folder' && f.root === abs));
    const alive = new Set(results.map((r) => r.id));
    for (const f of cur.files) {
      if (f.source === 'folder' && f.root === abs && !alive.has(f.id)) {
        fs.rm(path.join(LIB_TEXT_DIR, f.id + '.txt'), { force: true }).catch(() => {});
      }
    }
    cur.files = [...keepOthers, ...results];
  });
  return { total: files.length, dirs: stats.dirs, skippedDirs: stats.errors.length };
}

/** 고른 파일만 내용을 읽는다 (OneDrive 에서는 이때 그 파일만 내려받아진다). */
export async function extractFiles(ids, progress = () => {}) {
  const lib = await getLibrary();
  const byId = new Map(lib.files.map((f) => [f.id, f]));
  const targets = [];
  for (const id of ids) {
    const f = byId.get(id);
    if (!f || f.source !== 'folder') continue;
    const st = await fs.stat(f.absPath).catch(() => null);
    // 아직 안 읽었거나, 읽은 뒤에 파일이 바뀌었으면 (다시) 읽는다
    if (f.status === 'indexed' || (st && (st.mtimeMs !== f.mtimeMs || st.size !== f.size))) {
      targets.push({ ...f, size: st?.size ?? f.size, mtimeMs: st?.mtimeMs ?? f.mtimeMs });
    }
  }
  const updates = new Map();
  for (const [i, f] of targets.entries()) {
    progress(i, targets.length, `읽는 중 (${i + 1}/${targets.length}) ${f.name}`);
    let r;
    if (f.size > MAX_BYTES) {
      r = { status: 'error', text: '', warnings: [`파일이 너무 큽니다 (${Math.round(f.size / 1048576)}MB). 필요한 쪽만 PDF로 나눠 올려 주세요.`] };
    } else {
      const buf = await fs.readFile(f.absPath).catch((err) => err);
      r = buf instanceof Error
        ? { status: 'error', text: '', warnings: ['파일을 읽지 못했습니다: ' + buf.message] }
        : await extractText(buf, f.absPath);
    }
    await writeLibraryText(f.id, r.text);
    updates.set(f.id, { status: r.status, chars: r.text.length, warnings: r.warnings, size: f.size, mtimeMs: f.mtimeMs, extractedAt: new Date().toISOString() });
  }
  if (updates.size) {
    await updateLibrary((cur) => {
      for (const f of cur.files) if (updates.has(f.id)) Object.assign(f, updates.get(f.id));
    });
  }
  progress(targets.length, targets.length, '완료');
  return { read: targets.length };
}

export async function removeFolderFiles(root) {
  const abs = path.resolve(root);
  await updateLibrary((cur) => {
    for (const f of cur.files) {
      if (f.source === 'folder' && f.root === abs) fs.rm(path.join(LIB_TEXT_DIR, f.id + '.txt'), { force: true }).catch(() => {});
    }
    cur.files = cur.files.filter((f) => !(f.source === 'folder' && f.root === abs));
  });
}

export async function deleteLibraryFile(id) {
  await updateLibrary((cur) => {
    const f = cur.files.find((x) => x.id === id);
    if (!f) return;
    if (f.source === 'upload') fs.rm(f.storedPath, { force: true }).catch(() => {});
    fs.rm(path.join(LIB_TEXT_DIR, id + '.txt'), { force: true }).catch(() => {});
    cur.files = cur.files.filter((x) => x.id !== id);
  });
}

export async function readOriginal(entry) {
  return fs.readFile(entry.source === 'upload' ? entry.storedPath : entry.absPath);
}

/** 스캔본·이미지를 Claude로 판독해 자료실 텍스트로 저장 */
export async function ocrLibraryFile(id) {
  const lib = await getLibrary();
  const f = lib.files.find((x) => x.id === id);
  if (!f) throw new Error('파일을 찾을 수 없습니다.');
  const media = MEDIA[f.ext];
  if (!media) throw new Error('이미지나 PDF만 판독할 수 있습니다.');
  const buf = await readOriginal(f);
  if (buf.length > 30 * 1024 * 1024) throw new Error('30MB 이하 파일만 판독할 수 있습니다. PDF를 나눠서 올려 주세요.');
  const r = await transcribeImage(buf, media);
  const text = r.text + (r.unreadable.length ? `\n\n[판독불가 위치]\n- ${r.unreadable.join('\n- ')}` : '');
  await writeLibraryText(id, text);
  await updateLibrary((cur) => {
    const x = cur.files.find((y) => y.id === id);
    if (x) Object.assign(x, { status: 'ok', ocr: true, chars: text.length, warnings: ['Claude로 판독한 텍스트입니다. 오독이 있을 수 있습니다.'] });
  });
  return { chars: text.length };
}

export { IMAGE_EXT };
