import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  ensureDirs, getSettings, updateSettings, getLibrary, readLibraryText, listProjects, getProject,
  saveNewProject, updateProject, deleteProject, newId, UPLOAD_TMP_DIR,
} from './lib/store.js';
import { addUploadedFile, scanFolder, removeFolderFiles, deleteLibraryFile, ocrLibraryFile } from './lib/library.js';
import { searchLibrary, suggestAliases } from './lib/search.js';
import {
  SET_DEFS, DOC_DEFS, startJob, getJob, listJobs, structureNotes, transcribeImage, extractPoem,
  generateLesson, reverifyLesson, generateSet, refillSet, reverifySet, reverifyOne, cleanQuestion,
} from './lib/pipeline.js';
import { apiStatus } from './lib/claude.js';
import { renderPdf } from './lib/pdfExport.js';

await ensureDirs();

const app = express();
const PORT = Number(process.env.PORT || 4173);
const upload = multer({ dest: UPLOAD_TMP_DIR, limits: { fileSize: 60 * 1024 * 1024 } });

app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));
// 글꼴은 설치된 패키지에서 바로 제공 (인터넷 없이도 인쇄 디자인 유지)
app.use('/fonts/pretendard', express.static('node_modules/pretendard/dist/web/variable'));
app.use('/fonts/noto-serif-kr', express.static('node_modules/@fontsource/noto-serif-kr'));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error(err);
  res.status(err.status || 500).json({ error: String(err.message || err) });
});
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// multer 는 파일명을 latin1 로 해석하므로 한글 파일명을 되돌린다
const fixName = (n) => Buffer.from(n, 'latin1').toString('utf8');

// ---------- 상태·설정 ----------
app.get('/api/status', wrap(async (req, res) => {
  res.json({ ...apiStatus(), sets: SET_DEFS, docs: DOC_DEFS });
}));

app.get('/api/settings', wrap(async (req, res) => res.json(await getSettings())));
app.put('/api/settings', wrap(async (req, res) => {
  const { academyName, teacherName, accent } = req.body;
  res.json(await updateSettings((s) => ({ ...s, academyName: academyName ?? s.academyName, teacherName: teacherName ?? s.teacherName, accent: accent ?? s.accent })));
}));

// ---------- 자료실 ----------
app.get('/api/library', wrap(async (req, res) => {
  const [lib, settings] = await Promise.all([getLibrary(), getSettings()]);
  res.json({ files: lib.files, folders: settings.folders });
}));

app.get('/api/library/:id/text', wrap(async (req, res) => {
  res.json({ text: await readLibraryText(req.params.id) });
}));

app.post('/api/library/upload', upload.array('files', 500), wrap(async (req, res) => {
  const relPaths = [].concat(req.body.relPaths || []);
  const out = [];
  for (const [i, f] of (req.files || []).entries()) {
    const name = fixName(f.originalname);
    const rel = relPaths[i] || name;
    out.push(await addUploadedFile(f.path, path.basename(name), rel));
  }
  res.json({ added: out });
}));

app.delete('/api/library/:id', wrap(async (req, res) => {
  await deleteLibraryFile(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/library/:id/ocr', wrap(async (req, res) => {
  const job = startJob('library', 'ocr:' + req.params.id, '스캔본 판독', async (progress) => {
    progress(0, 1, 'Claude가 읽는 중…');
    return ocrLibraryFile(req.params.id);
  });
  res.json({ jobId: job.id });
}));

app.post('/api/library/folders', wrap(async (req, res) => {
  const folder = String(req.body.path || '').trim();
  if (!folder) throw bad('폴더 경로를 입력하세요.');
  const abs = path.resolve(folder);
  const st = await fs.stat(abs).catch(() => null);
  if (!st?.isDirectory()) throw bad('이 컴퓨터에서 폴더를 찾을 수 없습니다: ' + abs);
  await updateSettings((s) => ({ ...s, folders: [...new Set([...s.folders, abs])] }));
  const job = startJob('library', 'scan:' + abs, '폴더 읽기', (progress) => scanFolder(abs, progress));
  res.json({ jobId: job.id, path: abs });
}));

app.post('/api/library/folders/rescan', wrap(async (req, res) => {
  const { folders } = await getSettings();
  const job = startJob('library', 'scan:all', '폴더 다시 읽기', async (progress) => {
    for (const [i, f] of folders.entries()) {
      await scanFolder(f, (d, t, m) => progress(i, folders.length, `${path.basename(f)} (${d}/${t}) ${m}`));
    }
    return { folders: folders.length };
  });
  res.json({ jobId: job.id });
}));

app.delete('/api/library/folders', wrap(async (req, res) => {
  const abs = path.resolve(String(req.body.path || ''));
  await updateSettings((s) => ({ ...s, folders: s.folders.filter((f) => f !== abs) }));
  await removeFolderFiles(abs);
  res.json({ ok: true });
}));

// ---------- 작업 상태 ----------
app.get('/api/jobs/:id', wrap(async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: '작업을 찾을 수 없습니다 (서버가 재시작되었을 수 있습니다).' });
  res.json(job);
}));

// ---------- 작품 프로젝트 ----------
app.get('/api/projects', wrap(async (req, res) => res.json(await listProjects())));

app.post('/api/projects', wrap(async (req, res) => {
  const { title, author = '', school = '', grade = '', examNote = '' } = req.body;
  if (!title?.trim()) throw bad('작품 제목을 입력하세요.');
  const aliases = req.body.aliases?.length ? req.body.aliases : suggestAliases(title.trim());
  const now = new Date().toISOString();
  const project = {
    id: newId('p_'), title: title.trim(), author, school, grade, examNote, aliases, poem: '',
    createdAt: now, updatedAt: now,
    materials: { selected: [], lastSearchAt: null },
    notes: { entries: [], points: [], version: 0, draft: null, confirmedAt: null },
    docs: {}, sets: {},
  };
  res.json(await saveNewProject(project));
}));

app.get('/api/projects/:id', wrap(async (req, res) => {
  const p = await getProject(req.params.id);
  if (!p) return res.status(404).json({ error: '없는 프로젝트입니다.' });
  res.json({ ...p, jobs: listJobs(p.id) });
}));

app.patch('/api/projects/:id', wrap(async (req, res) => {
  const allowed = ['title', 'author', 'school', 'grade', 'examNote', 'aliases', 'poem'];
  res.json(await updateProject(req.params.id, (p) => {
    for (const k of allowed) if (k in req.body) p[k] = req.body[k];
  }));
}));

app.delete('/api/projects/:id', wrap(async (req, res) => {
  await deleteProject(req.params.id);
  res.json({ ok: true });
}));

// 자료 찾기 / 선택
app.post('/api/projects/:id/search', wrap(async (req, res) => {
  const p = await getProject(req.params.id);
  res.json({ results: await searchLibrary(p) });
}));

app.put('/api/projects/:id/materials', wrap(async (req, res) => {
  const selected = (req.body.selected || []).map((m) => ({
    fileId: m.fileId, fileName: m.fileName, relPath: m.relPath, chunkIndex: m.chunkIndex, text: m.text,
  }));
  res.json(await updateProject(req.params.id, (p) => {
    p.materials = { selected, lastSearchAt: new Date().toISOString() };
  }));
}));

app.post('/api/projects/:id/poem/extract', wrap(async (req, res) => {
  res.json(await extractPoem(req.params.id));
}));

// ---------- 필기 ----------
app.post('/api/projects/:id/notes/entries', wrap(async (req, res) => {
  const { label = '', date = '', rawText = '' } = req.body;
  if (!rawText.trim()) throw bad('필기 내용을 입력하세요.');
  res.json(await updateProject(req.params.id, (p) => {
    p.notes.entries.push({ id: newId('e_'), label, date, rawText, createdAt: new Date().toISOString(), structured: false });
  }));
}));

app.put('/api/projects/:id/notes/entries/:eid', wrap(async (req, res) => {
  res.json(await updateProject(req.params.id, (p) => {
    const e = p.notes.entries.find((x) => x.id === req.params.eid);
    if (!e) throw bad('필기 입력을 찾을 수 없습니다.');
    for (const k of ['label', 'date', 'rawText']) if (k in req.body) e[k] = req.body[k];
    if ('structured' in req.body) e.structured = Boolean(req.body.structured);
  }));
}));

app.delete('/api/projects/:id/notes/entries/:eid', wrap(async (req, res) => {
  res.json(await updateProject(req.params.id, (p) => {
    p.notes.entries = p.notes.entries.filter((x) => x.id !== req.params.eid);
  }));
}));

app.post('/api/projects/:id/notes/transcribe', upload.single('image'), wrap(async (req, res) => {
  if (!req.file) throw bad('이미지를 올려 주세요.');
  const buf = await fs.readFile(req.file.path);
  await fs.rm(req.file.path, { force: true });
  const media = req.file.mimetype === 'application/pdf' ? 'application/pdf' : req.file.mimetype;
  if (!/^image\/(jpeg|png|webp|gif)$|^application\/pdf$/.test(media)) throw bad('JPG·PNG·WEBP·PDF만 가능합니다.');
  res.json(await transcribeImage(buf, media));
}));

app.post('/api/projects/:id/notes/structure', wrap(async (req, res) => {
  const job = startJob(req.params.id, 'notes', '필기 정리', async (progress) => {
    progress(0, 1, 'Claude가 필기를 항목별로 정리하는 중…');
    await structureNotes(req.params.id, req.body.entryIds);
    progress(1, 1, '완료');
  });
  res.json({ jobId: job.id });
}));

// 초안을 검토한 뒤 확정: 초안 항목을 필기 기준에 추가하고 버전을 올린다
app.post('/api/projects/:id/notes/confirm', wrap(async (req, res) => {
  const accepted = req.body.points || [];
  res.json(await updateProject(req.params.id, (p) => {
    let n = p.notes.points.reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0);
    for (const pt of accepted) {
      if (!pt.target?.trim() && !pt.interpretation?.trim()) continue;
      p.notes.points.push({
        id: 'N' + ++n, target: pt.target || '', interpretation: pt.interpretation || '', examPoint: !!pt.examPoint,
        sourceQuote: pt.sourceQuote || '', source: pt.source || '', memo: pt.memo || '', addedAt: new Date().toISOString(),
      });
    }
    const draftEntries = new Set(p.notes.draft?.entryIds || []);
    for (const e of p.notes.entries) if (draftEntries.has(e.id)) e.structured = true;
    p.notes.draft = null;
    p.notes.version += 1;
    p.notes.confirmedAt = new Date().toISOString();
  }));
}));

app.post('/api/projects/:id/notes/discard-draft', wrap(async (req, res) => {
  res.json(await updateProject(req.params.id, (p) => { p.notes.draft = null; }));
}));

// 확정된 필기 항목 직접 편집 (추가·수정·삭제 모두 버전 +1)
app.put('/api/projects/:id/notes/points', wrap(async (req, res) => {
  const points = req.body.points || [];
  res.json(await updateProject(req.params.id, (p) => {
    let n = p.notes.points.reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0);
    p.notes.points = points.map((pt) => ({
      id: pt.id || 'N' + ++n, target: pt.target || '', interpretation: pt.interpretation || '', examPoint: !!pt.examPoint,
      sourceQuote: pt.sourceQuote || '', source: pt.source || '', memo: pt.memo || '', addedAt: pt.addedAt || new Date().toISOString(),
    }));
    p.notes.version += 1;
    p.notes.confirmedAt = new Date().toISOString();
  }));
}));

// ---------- 생성 ----------
function needNotes(p) {
  if (!p.notes.points.length) throw bad('학교 필기 기준을 먼저 확정해 주세요. (필기 없이 만들면 필기와 어긋나는 문항을 걸러낼 수 없습니다)');
}

app.post('/api/projects/:id/generate/:what', wrap(async (req, res) => {
  const { id, what } = req.params;
  const p = await getProject(id);
  if (!p) throw bad('없는 프로젝트입니다.');
  if (!req.body.allowWithoutNotes) needNotes(p);
  let job;
  if (DOC_DEFS[what]) job = startJob(id, 'gen:' + what, DOC_DEFS[what].label + ' 생성', (pr) => generateLesson(id, what, pr));
  else if (SET_DEFS[what]) job = startJob(id, 'gen:' + what, SET_DEFS[what].label + ' 생성', (pr) => generateSet(id, what, pr));
  else throw bad('알 수 없는 생성 종류: ' + what);
  res.json({ jobId: job.id });
}));

app.post('/api/projects/:id/reverify/:what', wrap(async (req, res) => {
  const { id, what } = req.params;
  let job;
  if (DOC_DEFS[what]) job = startJob(id, 'verify:' + what, DOC_DEFS[what].label + ' 재검수', (pr) => reverifyLesson(id, what, pr));
  else if (SET_DEFS[what]) job = startJob(id, 'verify:' + what, SET_DEFS[what].label + ' 재검수', (pr) => reverifySet(id, what, pr));
  else throw bad('알 수 없는 종류: ' + what);
  res.json({ jobId: job.id });
}));

app.post('/api/projects/:id/refill/:set', wrap(async (req, res) => {
  const { id, set } = req.params;
  if (!SET_DEFS[set]) throw bad('알 수 없는 문항 세트');
  const job = startJob(id, 'refill:' + set, SET_DEFS[set].label + ' 채우기', (pr) => refillSet(id, set, pr));
  res.json({ jobId: job.id });
}));

// ---------- 검수 ----------
app.post('/api/projects/:id/sets/:set/questions/:qid/decision', wrap(async (req, res) => {
  const { id, set, qid } = req.params;
  const { action } = req.body; // accept | apply-proposal | delete | restore
  res.json(await updateProject(id, (p) => {
    const q = p.sets[set]?.questions.find((x) => x.id === qid);
    if (!q) throw bad('문항을 찾을 수 없습니다.');
    if (action === 'accept') q.decision = 'accepted';
    else if (action === 'delete') q.decision = 'deleted';
    else if (action === 'restore') q.decision = 'pending';
    else if (action === 'apply-proposal') {
      if (!q.verify?.proposal) throw bad('수정안이 없습니다.');
      q.original = { ...cleanQuestion(q) };
      Object.assign(q, cleanQuestion(q.verify.proposal));
      q.decision = 'accepted';
      q.appliedProposal = true;
    } else throw bad('알 수 없는 동작');
    q.decidedAt = new Date().toISOString();
  }));
}));

app.put('/api/projects/:id/sets/:set/questions/:qid', wrap(async (req, res) => {
  const { id, set, qid } = req.params;
  const p = await updateProject(id, (proj) => {
    const q = proj.sets[set]?.questions.find((x) => x.id === qid);
    if (!q) throw bad('문항을 찾을 수 없습니다.');
    if (!q.original) q.original = { ...cleanQuestion(q) };
    Object.assign(q, cleanQuestion({ ...q, ...req.body }));
    q.edited = true;
    q.decision = 'accepted';
  });
  if (req.body.reverify) return res.json(await reverifyOne(id, set, qid));
  res.json(p);
}));

app.post('/api/projects/:id/sets/:set/accept-all-clean', wrap(async (req, res) => {
  res.json(await updateProject(req.params.id, (p) => {
    for (const q of p.sets[req.params.set]?.questions || []) {
      if (q.decision === 'pending' && ['consistent', 'unrelated'].includes(q.verify?.status) && !q.verify?.qualityIssue) q.decision = 'accepted';
    }
  }));
}));

app.put('/api/projects/:id/sets/:set/marked-poem', wrap(async (req, res) => {
  res.json(await updateProject(req.params.id, (p) => {
    if (!p.sets[req.params.set]) throw bad('먼저 문항을 생성하세요.');
    p.sets[req.params.set].markedPoem = String(req.body.markedPoem || '');
  }));
}));

// 교안 항목 수정 / 대조 이슈 처리
app.put('/api/projects/:id/docs/:doc/items/:itemId', wrap(async (req, res) => {
  const { id, doc, itemId } = req.params;
  res.json(await updateProject(id, (p) => {
    const d = p.docs[doc];
    const item = d?.content.sections.flatMap((s) => s.items).find((it) => it.id === itemId);
    if (!item) throw bad('교안 항목을 찾을 수 없습니다.');
    if ('label' in req.body) item.label = req.body.label;
    if ('text' in req.body) item.text = req.body.text;
    item.edited = true;
  }));
}));

app.post('/api/projects/:id/docs/:doc/issues/:issueId', wrap(async (req, res) => {
  const { id, doc, issueId } = req.params;
  const { action } = req.body; // apply | ignore | restore
  res.json(await updateProject(id, (p) => {
    const d = p.docs[doc];
    const issue = d?.issues.find((x) => x.id === issueId);
    if (!issue) throw bad('검수 항목을 찾을 수 없습니다.');
    if (action === 'apply') {
      const item = d.content.sections.flatMap((s) => s.items).find((it) => it.id === issue.itemId);
      if (item) {
        issue.before = item.text;
        item.text = issue.suggestion;
      }
      issue.decision = 'applied';
    } else if (action === 'ignore') issue.decision = 'ignored';
    else if (action === 'restore') issue.decision = 'pending';
    else throw bad('알 수 없는 동작');
  }));
}));

// ---------- PDF ----------
app.get('/api/projects/:id/pdf/:doc', wrap(async (req, res) => {
  const { id, doc } = req.params;
  const p = await getProject(id);
  if (!p) throw bad('없는 프로젝트입니다.');
  const url = `http://127.0.0.1:${PORT}/print.html?project=${encodeURIComponent(id)}&doc=${encodeURIComponent(doc)}`;
  const pdf = await renderPdf(url);
  const names = {
    teacher: '교사용교안', student: '학생용교안', 'student-key': '학생용교안_정답본', clinic: '클리닉테스트', 'clinic-answers': '클리닉정답해설',
    homework: '과제물100', 'homework-answers': '과제물정답해설',
  };
  const filename = `${p.title}_${names[doc] || doc}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.end(pdf);
}));

app.listen(PORT, '127.0.0.1', () => {
  const st = apiStatus();
  console.log(`\n  문학 수업자료 스튜디오 → http://localhost:${PORT}`);
  console.log(`  모델: ${st.model} (effort ${st.effort})${st.mock ? '  ※ 연습 모드(가짜 데이터)' : ''}`);
  if (!st.mock && !st.hasKey) console.log('  ⚠ ANTHROPIC_API_KEY 가 없습니다. .env 파일을 확인하세요.');
  console.log('');
});
