// 자료실: 업로드한 파일과 등록한 로컬 폴더(OneDrive 동기화 폴더 등)를 읽어 텍스트로 보관한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  LIB_FILES_DIR, LIB_TEXT_DIR, getLibrary, updateLibrary, writeLibraryText, newId,
} from './store.js';
import { extractText, isSupported, IMAGE_EXT } from './extract/index.js';
import { transcribeImage } from './pipeline.js';

const MAX_BYTES = 60 * 1024 * 1024;

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

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile() && isSupported(e.name)) out.push(full);
  }
  return out;
}

/** 등록된 폴더를 훑어 새로 생기거나 바뀐 파일만 다시 읽는다. */
export async function scanFolder(root, progress = () => {}) {
  const abs = path.resolve(root);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('폴더를 찾을 수 없습니다: ' + abs);
  const files = await walk(abs);
  const lib = await getLibrary();
  const known = new Map(lib.files.filter((f) => f.source === 'folder').map((f) => [f.absPath, f]));
  const results = [];
  let i = 0;
  for (const full of files) {
    i++;
    progress(i, files.length, path.relative(abs, full));
    const st = await fs.stat(full).catch(() => null);
    if (!st) continue;
    const prev = known.get(full);
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) {
      results.push(prev);
      continue;
    }
    const id = prev?.id || newId('f_');
    const base = {
      id, name: path.basename(full), relPath: path.join(path.basename(abs), path.relative(abs, full)),
      ext: path.extname(full).toLowerCase(), size: st.size, mtimeMs: st.mtimeMs,
      source: 'folder', root: abs, absPath: full, addedAt: prev?.addedAt || new Date().toISOString(),
    };
    if (st.size > MAX_BYTES) {
      results.push({ ...base, status: 'error', chars: 0, warnings: ['파일이 너무 큽니다 (60MB 초과)'] });
      continue;
    }
    // OneDrive "필요할 때 다운로드" 파일은 읽는 순간 내려받아진다
    const buf = await fs.readFile(full).catch((err) => err);
    if (buf instanceof Error) {
      results.push({ ...base, status: 'error', chars: 0, warnings: ['파일을 읽지 못했습니다: ' + buf.message] });
      continue;
    }
    const r = await extractText(buf, full);
    // 이전에 Claude로 판독해 둔 스캔본은 파일이 바뀌지 않는 한 유지된다 (위에서 skip)
    await writeLibraryText(id, r.text);
    results.push(entryFromExtract(base, r));
  }
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
  return { total: files.length };
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
