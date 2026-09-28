// 생성·검수 파이프라인과 백그라운드 작업 관리.
import { callJSON, imageBlock, pdfBlock } from './claude.js';
import { getProject, updateProject, newId } from './store.js';
import {
  SYSTEM, buildContext, notesTask, TRANSCRIBE_TASK, TRANSCRIBE_DOC_TASK, poemTask, teacherTask, poemLines,
  blueprintTask, markedPoemInstruction, questionsTask, verifyTask,
} from './prompts.js';
import {
  NOTES_SCHEMA, TRANSCRIBE_SCHEMA, POEM_SCHEMA, TEACHER_SCHEMA, BLUEPRINT_SCHEMA,
  QUESTIONS_SCHEMA, VERIFY_SCHEMA,
} from './schemas.js';

export const SET_DEFS = {
  clinic: { label: '클리닉 테스트', count: 30, extraRatio: 0.2 },
  homework: { label: '과제물', count: 100, extraRatio: 0.15 },
};
// 학생용 교안은 원문만으로 바로 인쇄하므로 생성 단계가 없다.
export const DOC_DEFS = {
  teacher: { label: '교사용 교안' },
};

const GEN_BATCH = 10;
const VERIFY_BATCH = 10;
const CONCURRENCY = 3;

// ---------------- 작업(Job) 관리 ----------------
const jobs = new Map();

export function startJob(projectId, kind, label, fn) {
  const running = [...jobs.values()].find((j) => j.projectId === projectId && j.kind === kind && j.status === 'running');
  if (running) return running;
  const job = {
    id: newId('job_'), projectId, kind, label, status: 'running',
    progress: { done: 0, total: 0, message: '시작하는 중…' },
    startedAt: new Date().toISOString(), error: null, result: null,
  };
  jobs.set(job.id, job);
  const progress = (done, total, message) => Object.assign(job.progress, { done, total, message });
  fn(progress)
    .then((result) => {
      job.status = 'done';
      job.result = result ?? null;
      job.progress.message = '완료';
    })
    .catch((err) => {
      job.status = 'error';
      job.error = String(err.message || err);
      console.error(`[job ${kind}]`, err);
    })
    .finally(() => { job.finishedAt = new Date().toISOString(); });
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function listJobs(projectId) {
  return [...jobs.values()].filter((j) => j.projectId === projectId).slice(-20);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function loadProject(id) {
  const p = await getProject(id);
  if (!p) throw new Error('프로젝트를 찾을 수 없습니다.');
  return p;
}

// ---------------- 필기 ----------------
export async function structureNotes(projectId, entryIds) {
  const p = await loadProject(projectId);
  const entries = (p.notes?.entries || []).filter((e) => !entryIds?.length || entryIds.includes(e.id));
  if (!entries.length) throw new Error('정리할 필기 입력이 없습니다.');
  const r = await callJSON({
    kind: 'notes',
    input: { entries, project: p },
    system: SYSTEM,
    context: buildContext(p, { includeNotes: false, includeMaterials: false }),
    task: notesTask(entries, p.notes?.points || []),
    schema: NOTES_SCHEMA,
  });
  const draft = {
    createdAt: new Date().toISOString(),
    entryIds: entries.map((e) => e.id),
    points: r.points.map((pt) => ({ ...pt, tempId: newId('d_'), source: entries.length === 1 ? entries[0].label : '' })),
    sttFixes: r.sttFixes,
    ambiguities: r.ambiguities,
  };
  await updateProject(projectId, (proj) => { proj.notes.draft = draft; });
  return draft;
}

export async function transcribeImage(buffer, mediaType) {
  const block = mediaType === 'application/pdf' ? pdfBlock(buffer) : imageBlock(buffer, mediaType);
  return callJSON({
    kind: 'transcribe',
    system: SYSTEM,
    attachments: [block],
    task: mediaType === 'application/pdf' ? TRANSCRIBE_DOC_TASK : TRANSCRIBE_TASK,
    schema: TRANSCRIBE_SCHEMA,
  });
}

export async function extractPoem(projectId) {
  const p = await loadProject(projectId);
  if (!p.materials?.selected?.length) throw new Error('먼저 관련 자료를 찾아 선택해 주세요.');
  return callJSON({
    kind: 'poem',
    input: { project: p },
    system: SYSTEM,
    context: buildContext(p, { includeNotes: false }),
    task: poemTask(p),
    schema: POEM_SCHEMA,
  });
}

// ---------------- 교안 ----------------
export async function generateTeacher(projectId, progress) {
  const p = await loadProject(projectId);
  if (!p.poem?.trim()) throw new Error('작품 원문을 먼저 넣어 주세요. 교사용 교안은 원문 한 줄 한 줄에 필기를 답니다.');
  const lines = poemLines(p.poem);
  progress(0, 1, '자료를 읽고 시구별 필기를 만드는 중… (1~3분)');
  const r = await callJSON({
    kind: 'teacher', input: { project: p },
    system: SYSTEM, context: buildContext(p), task: teacherTask(p), schema: TEACHER_SCHEMA,
  });
  const note = (text) => ({ id: newId('n_'), text });
  const placement = {};
  for (const sp of r.schoolPlacement) placement[sp.pointId] = sp.lineNo;
  const byLine = new Map();
  for (const l of r.lines) {
    if (l.lineNo < 1 || l.lineNo > lines.length) continue;
    if (!byLine.has(l.lineNo)) byLine.set(l.lineNo, []);
    byLine.get(l.lineNo).push(...l.notes.filter((t) => t.trim()).map(note));
  }
  await updateProject(projectId, (proj) => {
    proj.docs.teacher = {
      generatedAt: new Date().toISOString(),
      verifiedNotesVersion: proj.notes.version,
      poemSnapshot: proj.poem,
      content: {
        overview: r.overview.map((o) => ({ id: newId('n_'), label: o.label, text: o.text })),
        lines: [...byLine.entries()].map(([lineNo, notes]) => ({ lineNo, notes })),
        general: r.general.map((o) => ({ id: newId('n_'), label: o.label, text: o.text })),
        schoolPlacement: placement,
      },
      excluded: r.excluded.map((x) => ({ id: newId('x_'), ...x, decision: 'excluded' })),
    };
  });
  progress(1, 1, '완료');
}

// ---------------- 문항 ----------------
const MARK_RE = /[㉠-㉭ⓐ-ⓩ]|<\/?u>/g;
const compact = (s) => (s || '').replace(MARK_RE, '').replace(/\s/g, '');

export function validMarkedPoem(marked, poem) {
  if (!poem?.trim()) return '';
  if (marked && compact(marked) === compact(poem)) return marked;
  return poem; // 원문이 바뀌었으면 기호 없이 원문 사용
}

function answerSlots(n) {
  const slots = Array.from({ length: n }, (_, i) => (i % 5) + 1);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

function cleanQuestion(q) {
  const choices = (q.choices || []).map((c) => String(c).replace(/^\s*[①②③④⑤]\s*/, '').trim());
  const issues = [];
  if (choices.length !== 5) issues.push(`선지가 ${choices.length}개입니다`);
  const answer = Number(q.answer);
  if (!(answer >= 1 && answer <= 5)) issues.push('정답 번호가 1~5가 아닙니다');
  return {
    type: q.type || '',
    difficulty: q.difficulty || '중',
    stem: q.stem || '',
    extraPassage: q.extraPassage || '',
    bogi: q.bogi || '',
    choices,
    answer,
    explanation: q.explanation || '',
    basisPoints: q.basisPoints || [],
    formatIssue: issues.join(', '),
  };
}

function stemsOf(set) {
  return (set?.questions || []).filter((q) => q.decision !== 'deleted').map((q) => `[${q.type}] ${q.stem.slice(0, 80)}`);
}

async function buildQuestions(p, context, { setKind, count, markedPoem, avoidStems, progress, progressBase, progressTotal }) {
  const def = SET_DEFS[setKind];
  const bp = await callJSON({
    kind: 'blueprint', input: { count, project: p },
    system: SYSTEM, context,
    task: blueprintTask({
      setLabel: def.label, count, extraRatio: def.extraRatio, avoidStems,
      markedPoemHint: markedPoemInstruction(markedPoem),
    }),
    schema: BLUEPRINT_SCHEMA,
  });
  const finalPoem = markedPoem || validMarkedPoem(bp.markedPoem, p.poem);
  const items = bp.items.slice(0, count);
  const slots = answerSlots(items.length);
  items.forEach((it, i) => { it.answerSlot = slots[i]; });

  let done = 0;
  progress(progressBase, progressTotal, `문항 작성 중… (0/${items.length})`);
  const batches = chunk(items, GEN_BATCH);
  const generated = await mapLimit(batches, CONCURRENCY, async (batch) => {
    const r = await callJSON({
      kind: 'questions', input: { items: batch },
      system: SYSTEM, context,
      task: questionsTask({ items: batch, markedPoem: finalPoem, avoidStems }),
      schema: QUESTIONS_SCHEMA,
    });
    done += batch.length;
    progress(progressBase + done, progressTotal, `문항 작성 중… (${done}/${items.length})`);
    return r.questions.slice(0, batch.length).map((q) => ({
      id: newId('q_'),
      ...cleanQuestion(q),
      createdAt: new Date().toISOString(),
    }));
  });
  return { markedPoem: finalPoem, questions: generated.flat() };
}

async function verifyQuestions(context, questions, markedPoem, onBatchDone) {
  const byId = new Map();
  await mapLimit(chunk(questions, VERIFY_BATCH), CONCURRENCY, async (batch) => {
    const r = await callJSON({
      kind: 'verify', input: { questions: batch },
      system: SYSTEM, context, task: verifyTask(batch, markedPoem), schema: VERIFY_SCHEMA,
    });
    for (const res of r.results) byId.set(res.qid, res);
    onBatchDone?.(batch.length);
  });
  return byId;
}

function applyVerify(q, res, notesVersion) {
  if (!res) {
    q.verify = { status: 'unchecked', reason: '검수 결과를 받지 못했습니다. 재검수를 눌러 주세요.', conflictPoints: [], qualityIssue: '', proposal: null, notesVersion };
    q.decision = 'pending';
    return q;
  }
  const proposal = res.hasProposal ? cleanQuestion(res.proposal) : null;
  const qualityIssue = [res.qualityIssue, q.formatIssue].filter(Boolean).join(' / ');
  q.verify = {
    status: res.status,
    reason: res.reason,
    conflictPoints: res.conflictPoints || [],
    qualityIssue,
    proposal,
    notesVersion,
    checkedAt: new Date().toISOString(),
  };
  const ok = (res.status === 'consistent' || res.status === 'unrelated') && !qualityIssue;
  if (q.decision !== 'deleted') q.decision = ok ? 'accepted' : 'pending';
  return q;
}

export async function generateSet(projectId, setKind, progress) {
  const p = await loadProject(projectId);
  const def = SET_DEFS[setKind];
  const context = buildContext(p);
  const avoid = setKind === 'homework' ? stemsOf(p.sets?.clinic) : [];
  const total = def.count * 2 + 1;
  progress(0, total, '출제 설계 중…');
  const { markedPoem, questions } = await buildQuestions(p, context, {
    setKind, count: def.count, markedPoem: '', avoidStems: avoid, progress, progressBase: 1, progressTotal: total,
  });
  let checked = 0;
  progress(1 + def.count, total, '필기 기준으로 검수 중…');
  const results = await verifyQuestions(context, questions, markedPoem, (n) => {
    checked += n;
    progress(1 + def.count + checked, total, `필기 기준으로 검수 중… (${checked}/${questions.length})`);
  });
  questions.forEach((q) => applyVerify(q, results.get(q.id), p.notes.version));
  await updateProject(projectId, (proj) => {
    proj.sets[setKind] = {
      generatedAt: new Date().toISOString(),
      target: def.count,
      markedPoem,
      verifiedNotesVersion: proj.notes.version,
      questions,
    };
  });
  progress(total, total, '완료');
}

// 삭제된 문항 수만큼 새로 만들어 채운다
export async function refillSet(projectId, setKind, progress) {
  const p = await loadProject(projectId);
  const set = p.sets?.[setKind];
  if (!set) throw new Error('먼저 문항을 생성하세요.');
  const alive = set.questions.filter((q) => q.decision !== 'deleted').length;
  const need = set.target - alive;
  if (need <= 0) return { added: 0 };
  const context = buildContext(p);
  const avoid = [...stemsOf(set), ...(setKind === 'homework' ? stemsOf(p.sets?.clinic) : [])];
  const total = need * 2 + 1;
  progress(0, total, `부족한 ${need}문항 설계 중…`);
  const { questions } = await buildQuestions(p, context, {
    setKind, count: need, markedPoem: set.markedPoem, avoidStems: avoid, progress, progressBase: 1, progressTotal: total,
  });
  let checked = 0;
  const results = await verifyQuestions(context, questions, set.markedPoem, (n) => {
    checked += n;
    progress(1 + need + checked, total, `새 문항 검수 중… (${checked}/${questions.length})`);
  });
  questions.forEach((q) => { q.origin = 'refill'; applyVerify(q, results.get(q.id), p.notes.version); });
  await updateProject(projectId, (proj) => {
    proj.sets[setKind].questions.push(...questions);
  });
  progress(total, total, '완료');
  return { added: questions.length };
}

// 필기 기준이 바뀌었을 때 전체 재검수
export async function reverifySet(projectId, setKind, progress) {
  const p = await loadProject(projectId);
  const set = p.sets?.[setKind];
  if (!set) throw new Error('먼저 문항을 생성하세요.');
  const targets = set.questions.filter((q) => q.decision !== 'deleted');
  let checked = 0;
  progress(0, targets.length, '필기 기준으로 다시 검수 중…');
  const results = await verifyQuestions(buildContext(p), targets, set.markedPoem, (n) => {
    checked += n;
    progress(checked, targets.length, `다시 검수 중… (${checked}/${targets.length})`);
  });
  await updateProject(projectId, (proj) => {
    const s = proj.sets[setKind];
    for (const q of s.questions) {
      if (q.decision === 'deleted') continue;
      if (results.has(q.id)) {
        q.formatIssue = cleanQuestion(q).formatIssue;
        applyVerify(q, results.get(q.id), proj.notes.version);
      }
    }
    s.verifiedNotesVersion = proj.notes.version;
  });
  progress(targets.length, targets.length, '완료');
}

// 한 문항만 다시 검수 (직접 수정 후)
export async function reverifyOne(projectId, setKind, qid) {
  const p = await loadProject(projectId);
  const set = p.sets?.[setKind];
  const q = set?.questions.find((x) => x.id === qid);
  if (!q) throw new Error('문항을 찾을 수 없습니다.');
  const results = await verifyQuestions(buildContext(p), [q], set.markedPoem);
  return updateProject(projectId, (proj) => {
    const target = proj.sets[setKind].questions.find((x) => x.id === qid);
    target.formatIssue = cleanQuestion(target).formatIssue;
    applyVerify(target, results.get(qid), proj.notes.version);
  });
}

export { cleanQuestion };
