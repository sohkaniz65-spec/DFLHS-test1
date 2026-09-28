// 로컬 JSON 파일 저장소. 모든 데이터는 ./data 아래에만 저장된다.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const LIB_DIR = path.join(DATA_DIR, 'library');
export const LIB_FILES_DIR = path.join(LIB_DIR, 'files');
export const LIB_TEXT_DIR = path.join(LIB_DIR, 'text');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const UPLOAD_TMP_DIR = path.join(DATA_DIR, 'tmp');

export async function ensureDirs() {
  for (const d of [DATA_DIR, LIB_DIR, LIB_FILES_DIR, LIB_TEXT_DIR, PROJECTS_DIR, UPLOAD_TMP_DIR]) {
    await fs.mkdir(d, { recursive: true });
  }
}

export function newId(prefix = '') {
  return prefix + crypto.randomBytes(6).toString('hex');
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJSON(file, value) {
  const tmp = file + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

// 같은 파일에 대한 읽기-수정-쓰기를 직렬화한다 (생성 작업이 병렬로 돌기 때문).
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

// ---------- 설정 ----------
const SETTINGS_FILE = () => path.join(DATA_DIR, 'settings.json');
export const DEFAULT_SETTINGS = {
  academyName: '',
  teacherName: '',
  accent: '#1f4e79',
  folders: [],
};

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await readJSON(SETTINGS_FILE(), {})) };
}

export function updateSettings(fn) {
  return withLock('settings', async () => {
    const cur = await getSettings();
    const next = (await fn(cur)) || cur;
    await writeJSON(SETTINGS_FILE(), next);
    return next;
  });
}

// ---------- 자료실 ----------
const LIB_INDEX = () => path.join(LIB_DIR, 'index.json');

export async function getLibrary() {
  return readJSON(LIB_INDEX(), { files: [] });
}

export function updateLibrary(fn) {
  return withLock('library', async () => {
    const cur = await getLibrary();
    const next = (await fn(cur)) || cur;
    await writeJSON(LIB_INDEX(), next);
    return next;
  });
}

export async function readLibraryText(fileId) {
  try {
    return await fs.readFile(path.join(LIB_TEXT_DIR, fileId + '.txt'), 'utf8');
  } catch {
    return '';
  }
}

export async function writeLibraryText(fileId, text) {
  await fs.writeFile(path.join(LIB_TEXT_DIR, fileId + '.txt'), text, 'utf8');
}

// ---------- 작품 프로젝트 ----------
const projectFile = (id) => {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error('잘못된 프로젝트 ID');
  return path.join(PROJECTS_DIR, id + '.json');
};

export async function listProjects() {
  const names = await fs.readdir(PROJECTS_DIR).catch(() => []);
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const p = await readJSON(path.join(PROJECTS_DIR, n), null);
    if (p) out.push({ id: p.id, title: p.title, author: p.author, school: p.school, updatedAt: p.updatedAt });
  }
  return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function getProject(id) {
  return readJSON(projectFile(id), null);
}

export function saveNewProject(project) {
  return withLock('p:' + project.id, () => writeJSON(projectFile(project.id), project).then(() => project));
}

export function updateProject(id, fn) {
  return withLock('p:' + id, async () => {
    const cur = await getProject(id);
    if (!cur) throw new Error('프로젝트를 찾을 수 없습니다: ' + id);
    const next = (await fn(cur)) || cur;
    next.updatedAt = new Date().toISOString();
    await writeJSON(projectFile(id), next);
    return next;
  });
}

export async function deleteProject(id) {
  await fs.rm(projectFile(id), { force: true });
}
