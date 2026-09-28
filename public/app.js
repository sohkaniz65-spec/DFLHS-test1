import { esc, rich, CIRCLED, STATUS_LABEL, DECISION_LABEL, liveQuestions } from './shared.js';

const $app = document.getElementById('app');
const state = { status: null, projects: [], project: null, jobs: new Map(), search: null, sub: {} };

// ---------------- 공통 도우미 ----------------
async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, err ? 6000 : 2800);
}

function modal(title, html) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modal').hidden = false;
}
document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal' || e.target.closest('[data-close]')) document.getElementById('modal').hidden = true;
});

const badge = ([label, cls]) => `<span class="badge ${cls}">${esc(label)}</span>`;
const fmtDate = (s) => (s ? new Date(s).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

async function run(btn, fn) {
  const b = btn instanceof Element ? btn : null;
  if (b) { b.disabled = true; b.dataset.label = b.innerHTML; b.innerHTML = '처리 중…'; }
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (b && b.isConnected) { b.disabled = false; b.innerHTML = b.dataset.label; }
  }
}

// 백그라운드 작업 추적
function trackJob(jobId, key, onDone) {
  const tick = async () => {
    try {
      const job = await api('/api/jobs/' + jobId);
      state.jobs.set(key, job);
      updateJobViews();
      if (job.status === 'running') return setTimeout(tick, 1500);
      state.jobs.delete(key);
      if (job.status === 'error') toast(`${job.label} 실패: ${job.error}`, true);
      else toast(`${job.label} 완료`);
      await onDone?.(job);
    } catch (err) {
      state.jobs.delete(key);
      toast(err.message, true);
    }
  };
  tick();
}

function jobBar(key) {
  const job = state.jobs.get(key);
  if (!job) return '';
  const pct = job.progress.total ? Math.round((job.progress.done / job.progress.total) * 100) : 5;
  return `<div class="jobbar" data-job="${esc(key)}"><div class="progress"><i style="width:${pct}%"></i></div><div class="small muted">${esc(job.progress.message)}</div></div>`;
}

function updateJobViews() {
  document.querySelectorAll('[data-jobslot]').forEach((el) => {
    el.innerHTML = jobBar(el.dataset.jobslot);
  });
  document.querySelectorAll('[data-needidle]').forEach((el) => {
    el.disabled = state.jobs.has(el.dataset.needidle) || el.hasAttribute('data-off');
  });
}

async function reloadProject() {
  if (!state.project) return;
  state.project = await api('/api/projects/' + state.project.id);
  render();
}

// ---------------- 라우팅 ----------------
window.addEventListener('hashchange', render);

async function boot() {
  state.status = await api('/api/status');
  const s = state.status;
  document.getElementById('apiBadge').innerHTML = s.mock
    ? '<span class="dot warn"></span>연습 모드 (가짜 데이터)'
    : s.hasKey
      ? `<span class="dot"></span>${esc(s.model)} 연결됨`
      : '<span class="dot bad"></span>API 키 없음 (.env 확인)';
  await render();
}

async function refreshSideProjects(activeId) {
  state.projects = await api('/api/projects');
  document.getElementById('sideProjects').innerHTML = state.projects.length
    ? `<div class="cap">작품</div>${state.projects.map((p) => `<a href="#/p/${p.id}/info" class="${p.id === activeId ? 'on' : ''}">${esc(p.title)}<small>${esc([p.author, p.school].filter(Boolean).join(' · '))}</small></a>`).join('')}`
    : '';
}

async function render() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const [route, id, tab, sub] = parts;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (route || 'home')));
  try {
    await refreshSideProjects(route === 'p' ? id : null);
    if (route === 'library') return renderLibrary();
    if (route === 'settings') return renderSettings();
    if (route === 'p' && id) {
      if (!state.project || state.project.id !== id) {
        state.project = await api('/api/projects/' + id);
        state.search = null;
        for (const j of state.project.jobs || []) {
          if (j.status === 'running' && !state.jobs.has(j.kind)) trackJob(j.id, j.kind, reloadProject);
        }
      }
      return renderProject(tab || 'info', sub);
    }
    return renderHome();
  } catch (err) {
    $app.innerHTML = `<div class="callout bad">${esc(err.message)}</div>`;
  }
}

// ---------------- 홈 ----------------
function renderHome() {
  const s = state.status;
  $app.innerHTML = `
    <div class="page-head"><div><h1>작품 목록</h1><div class="sub">작품 하나당 교사용·학생용 교안, 클리닉 30문항, 과제 100문항을 만듭니다.</div></div></div>
    ${s.mock ? '<div class="callout warn"><b>연습 모드</b>입니다. Claude를 부르지 않고 가짜 데이터로 화면과 인쇄 디자인만 확인할 수 있습니다.</div>' : ''}
    ${!s.mock && !s.hasKey ? '<div class="callout bad"><b>API 키가 없습니다.</b> 프로그램 폴더의 <span class="kbd">.env</span> 파일에 <span class="kbd">ANTHROPIC_API_KEY</span>를 넣고 다시 실행하세요.</div>' : ''}
    <div class="grid2">
      <div class="card">
        <h2>새 작품 시작</h2>
        <form id="newProject" class="stack">
          <div><label class="f">작품 제목 *</label><input name="title" placeholder="예: 쉽게 씌어진 시" required></div>
          <div class="fields">
            <div><label class="f">작가</label><input name="author" placeholder="윤동주"></div>
            <div><label class="f">학교</label><input name="school" placeholder="○○고"></div>
            <div><label class="f">학년</label><input name="grade" placeholder="2학년"></div>
          </div>
          <div><label class="f">시험 범위·메모 (선택)</label><input name="examNote" placeholder="예: 2학기 중간고사, 문학 교과서 3단원"></div>
          <div class="row end"><button class="btn">작품 만들기</button></div>
        </form>
      </div>
      <div class="card">
        <h2>진행 순서</h2>
        <ol class="small" style="padding-left:18px;margin:0;line-height:1.9">
          <li><b>자료실</b>에 OneDrive 폴더를 연결하거나 파일을 올립니다. (HWP·PDF·스캔본)</li>
          <li><b>작품·자료</b>: 관련 자료를 자동으로 찾아 고르고, 작품 원문을 확인합니다.</li>
          <li><b>학교 필기</b>: 선생님 필기를 음성으로 입력하면 항목별로 정리해 줍니다. 검토 후 <b>확정</b>합니다.</li>
          <li><b>생성</b>: 교안 2종과 문항 130개를 만들고, 필기 기준으로 자동 검수합니다.</li>
          <li><b>검수</b>: 필기와 어긋난 문항을 수정안 적용·삭제·직접 수정합니다.</li>
          <li><b>출력</b>: 인쇄용 PDF로 저장합니다.</li>
        </ol>
      </div>
    </div>
    <div class="card">
      <h2>작품</h2>
      ${state.projects.length ? `<table class="t"><thead><tr><th>제목</th><th>작가</th><th>학교</th><th>최근 수정</th><th></th></tr></thead><tbody>
        ${state.projects.map((p) => `<tr><td><a href="#/p/${p.id}/info"><b>${esc(p.title)}</b></a></td><td>${esc(p.author)}</td><td>${esc(p.school)}</td><td class="muted">${fmtDate(p.updatedAt)}</td>
        <td style="text-align:right"><button class="btn bad sm" data-del="${p.id}">삭제</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">아직 작품이 없습니다.</div>'}
    </div>`;

  document.getElementById('newProject').onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    run(e.submitter, async () => {
      const p = await api('/api/projects', { method: 'POST', body });
      state.project = null;
      location.hash = `#/p/${p.id}/info`;
    });
  };
  $app.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    if (!confirm('이 작품과 생성된 자료를 모두 삭제할까요? (자료실 파일은 지워지지 않습니다)')) return;
    run(b, async () => { await api('/api/projects/' + b.dataset.del, { method: 'DELETE' }); render(); });
  }));
}

// ---------------- 설정 ----------------
async function renderSettings() {
  const s = await api('/api/settings');
  $app.innerHTML = `
    <div class="page-head"><div><h1>설정</h1><div class="sub">인쇄물 머리글에 들어갈 정보입니다.</div></div></div>
    <div class="card"><form id="settingsForm" class="stack">
      <div class="fields">
        <div><label class="f">학원(브랜드) 이름</label><input name="academyName" value="${esc(s.academyName)}" placeholder="예: ○○국어"></div>
        <div><label class="f">강사 이름</label><input name="teacherName" value="${esc(s.teacherName)}"></div>
        <div><label class="f">대표 색상</label><input name="accent" type="color" value="${esc(s.accent)}" style="height:40px;padding:4px"></div>
      </div>
      <div class="row end"><button class="btn">저장</button></div>
    </form></div>
    <div class="card"><h3>API 연결</h3>
      <p class="small">모델: <b>${esc(state.status.model)}</b> · 생각 깊이(effort): <b>${esc(state.status.effort)}</b> ${state.status.mock ? '· <span class="badge warn">연습 모드</span>' : ''}</p>
      <p class="small muted">모델·깊이·API 키는 프로그램 폴더의 <span class="kbd">.env</span> 파일에서 바꿉니다. 바꾼 뒤에는 프로그램을 다시 실행하세요.</p>
    </div>`;
  document.getElementById('settingsForm').onsubmit = (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      await api('/api/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      toast('저장했습니다');
    });
  };
}

// ---------------- 자료실 ----------------
const FILE_STATUS = {
  ok: ['읽음', 'ok'],
  scan: ['스캔본·이미지', 'warn'],
  empty: ['내용 없음', ''],
  error: ['오류', 'bad'],
};

async function renderLibrary() {
  const lib = await api('/api/library');
  const filter = state.sub.libFilter || '';
  const files = lib.files
    .filter((f) => !filter || (f.relPath || f.name).toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (a.relPath || a.name).localeCompare(b.relPath || b.name, 'ko'));
  const counts = lib.files.reduce((m, f) => ((m[f.status] = (m[f.status] || 0) + 1), m), {});

  $app.innerHTML = `
    <div class="page-head"><div><h1>자료실</h1><div class="sub">여기 모인 자료에서 작품별 관련 자료를 자동으로 찾습니다. 모든 자료는 이 컴퓨터에만 저장됩니다.</div></div></div>
    <div class="grid2">
      <div class="card">
        <div class="card-head"><h3>① OneDrive 폴더 연결 (권장)</h3></div>
        <p class="small">공유받은 OneDrive 폴더를 이 컴퓨터에 동기화해 두면, 그 폴더 경로만 등록해서 통째로 읽습니다. 새 파일이 생기면 <b>다시 읽기</b>만 누르면 됩니다.</p>
        <details class="small"><summary>폴더 경로 찾는 법</summary>
          <ol style="padding-left:18px">
            <li>웹 OneDrive → <b>공유됨</b> → 공유받은 폴더 → <b>내 파일에 바로 가기 추가</b></li>
            <li>PC의 OneDrive 폴더에 그 폴더가 나타납니다.</li>
            <li>파일 탐색기에서 그 폴더를 열고 주소창을 클릭해 경로를 복사합니다. 예: <span class="kbd">C:\\Users\\이름\\OneDrive\\국어자료</span></li>
          </ol>
        </details>
        <form id="folderForm" class="row" style="margin-top:8px">
          <input name="path" placeholder="C:\\Users\\...\\OneDrive\\공유폴더" style="flex:1;min-width:220px">
          <button class="btn">연결</button>
        </form>
        <div data-jobslot="scan" style="margin-top:6px"></div>
        ${lib.folders.length ? `<div class="stack" style="margin-top:12px">${lib.folders.map((f) => `
          <div class="row"><span class="kbd" style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(f)}</span>
          <button class="btn bad sm" data-unfolder="${esc(f)}">연결 해제</button></div>`).join('')}
          <div class="row end"><button class="btn ghost sm" id="rescan" data-needidle="scan">모든 폴더 다시 읽기</button></div></div>` : ''}
      </div>
      <div class="card">
        <div class="card-head"><h3>② 파일 직접 올리기</h3></div>
        <div class="drop" id="drop">
          <p><b>파일이나 폴더를 여기에 끌어 놓으세요</b></p>
          <p class="small muted">HWP · HWPX · PDF · 이미지(JPG/PNG) · TXT</p>
          <div class="row" style="justify-content:center;margin-top:8px">
            <label class="btn ghost sm">파일 선택<input type="file" id="pickFiles" multiple hidden accept=".hwp,.hwpx,.pdf,.txt,.md,.jpg,.jpeg,.png,.webp"></label>
            <label class="btn ghost sm">폴더 선택<input type="file" id="pickDir" webkitdirectory hidden></label>
          </div>
        </div>
        <div id="uploadMsg" class="small muted" style="margin-top:8px"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head">
        <h3>자료 ${lib.files.length}개 <span class="small muted">· 읽음 ${counts.ok || 0} · 스캔본 ${counts.scan || 0} · 오류 ${counts.error || 0}</span></h3>
        <input id="libFilter" placeholder="파일 이름 검색" value="${esc(filter)}" style="max-width:240px">
      </div>
      ${counts.scan ? '<div class="callout warn small">스캔본은 글자 정보가 없어 검색되지 않습니다. 중요한 자료만 <b>Claude로 읽기</b>를 누르세요. (장당 API 비용이 듭니다)</div>' : ''}
      ${files.length ? `<table class="t"><thead><tr><th>파일</th><th>상태</th><th>글자 수</th><th></th></tr></thead><tbody>
        ${files.map((f) => `<tr>
          <td><b>${esc(f.name)}</b><div class="small muted">${esc(f.relPath || '')}</div>${(f.warnings || []).map((w) => `<div class="small" style="color:var(--warn)">${esc(w)}</div>`).join('')}</td>
          <td>${badge(FILE_STATUS[f.status] || [f.status, ''])}${f.ocr ? ' <span class="badge info">Claude 판독</span>' : ''}</td>
          <td class="muted">${(f.chars || 0).toLocaleString()}</td>
          <td style="text-align:right;white-space:nowrap">
            <div data-jobslot="ocr:${f.id}"></div>
            ${f.status === 'scan' || f.ocr ? `<button class="btn ghost sm" data-ocr="${f.id}" data-needidle="ocr:${f.id}">${f.ocr ? '다시 판독' : 'Claude로 읽기'}</button>` : ''}
            ${f.status === 'ok' ? `<button class="btn ghost sm" data-view="${f.id}">보기</button>` : ''}
            ${f.source === 'upload' ? `<button class="btn bad sm" data-delfile="${f.id}">삭제</button>` : ''}
          </td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">자료가 없습니다.</div>'}
    </div>`;

  const doUpload = async (fileList) => {
    const files = [...fileList].filter((f) => /\.(hwp|hwpx|pdf|txt|md|jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) return toast('올릴 수 있는 파일이 없습니다', true);
    const msg = document.getElementById('uploadMsg');
    for (let i = 0; i < files.length; i += 20) {
      const fd = new FormData();
      for (const f of files.slice(i, i + 20)) {
        fd.append('files', f);
        fd.append('relPaths', f.webkitRelativePath || f.relPath || f.name);
      }
      msg.textContent = `올리는 중… ${Math.min(i + 20, files.length)}/${files.length}`;
      await api('/api/library/upload', { method: 'POST', body: fd });
    }
    toast(`${files.length}개 파일을 읽었습니다`);
    renderLibrary();
  };
  document.getElementById('pickFiles').onchange = (e) => run(null, () => doUpload(e.target.files));
  document.getElementById('pickDir').onchange = (e) => run(null, () => doUpload(e.target.files));
  const drop = document.getElementById('drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const files = await filesFromDrop(e.dataTransfer);
    run(null, () => doUpload(files));
  };

  document.getElementById('folderForm').onsubmit = (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      const r = await api('/api/library/folders', { method: 'POST', body: { path: new FormData(e.target).get('path') } });
      trackJob(r.jobId, 'scan', renderLibrary);
      renderLibrary();
    });
  };
  const rescan = document.getElementById('rescan');
  if (rescan) rescan.onclick = () => run(rescan, async () => {
    const r = await api('/api/library/folders/rescan', { method: 'POST' });
    trackJob(r.jobId, 'scan', renderLibrary);
  });
  $app.querySelectorAll('[data-unfolder]').forEach((b) => (b.onclick = () => {
    if (!confirm('이 폴더 연결을 해제할까요? (원본 파일은 지워지지 않습니다)')) return;
    run(b, async () => { await api('/api/library/folders', { method: 'DELETE', body: { path: b.dataset.unfolder } }); renderLibrary(); });
  }));
  $app.querySelectorAll('[data-delfile]').forEach((b) => (b.onclick = () => run(b, async () => {
    await api('/api/library/' + b.dataset.delfile, { method: 'DELETE' });
    renderLibrary();
  })));
  $app.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => run(b, async () => {
    const { text } = await api(`/api/library/${b.dataset.view}/text`);
    modal('추출된 텍스트', `<div class="pre small">${esc(text)}</div>`);
  })));
  $app.querySelectorAll('[data-ocr]').forEach((b) => (b.onclick = () => run(b, async () => {
    const r = await api(`/api/library/${b.dataset.ocr}/ocr`, { method: 'POST' });
    trackJob(r.jobId, 'ocr:' + b.dataset.ocr, renderLibrary);
  })));
  const lf = document.getElementById('libFilter');
  lf.oninput = () => { state.sub.libFilter = lf.value; clearTimeout(lf.t); lf.t = setTimeout(async () => { await renderLibrary(); const el = document.getElementById('libFilter'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); };
  updateJobViews();
}

async function filesFromDrop(dt) {
  const out = [];
  const walk = (entry, prefix) => new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((f) => { f.relPath = prefix + f.name; out.push(f); resolve(); }, resolve);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = () => reader.readEntries(async (ents) => {
        if (!ents.length) return resolve();
        for (const e of ents) await walk(e, prefix + entry.name + '/');
        readAll();
      }, resolve);
      readAll();
    } else resolve();
  });
  const items = [...(dt.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!items.length) return [...dt.files];
  for (const e of items) await walk(e, '');
  return out;
}

// ---------------- 작품 화면 ----------------
const TABS = [
  ['info', '작품·자료'], ['notes', '학교 필기'], ['generate', '생성'], ['review', '검수'], ['export', '출력'],
];

function renderProject(tab, sub) {
  const p = state.project;
  const head = `
    <div class="page-head">
      <div><h1>${esc(p.title)}</h1><div class="sub">${esc([p.author, p.school, p.grade].filter(Boolean).join(' · ') || '작가·학교 미입력')}
        · 필기 기준 <b>v${p.notes.version}</b> (${p.notes.points.length}항목)</div></div>
    </div>
    <div class="tabs">${TABS.map(([k, l], i) => `<a href="#/p/${p.id}/${k}" class="${k === tab ? 'on' : ''}"><span class="n">${i + 1}</span>${l}</a>`).join('')}</div>`;
  const body = { info: viewInfo, notes: viewNotes, generate: viewGenerate, review: viewReview, export: viewExport }[tab] || viewInfo;
  $app.innerHTML = head + '<div id="tabBody"></div>';
  body(document.getElementById('tabBody'), sub);
  updateJobViews();
}

// ----- ① 작품·자료 -----
function viewInfo(el) {
  const p = state.project;
  const sel = p.materials.selected;
  const selChars = sel.reduce((s, m) => s + m.text.length, 0);
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>작품 정보</h2></div>
      <form id="infoForm" class="stack">
        <div class="fields">
          <div><label class="f">제목</label><input name="title" value="${esc(p.title)}"></div>
          <div><label class="f">작가</label><input name="author" value="${esc(p.author)}"></div>
          <div><label class="f">학교</label><input name="school" value="${esc(p.school)}"></div>
          <div><label class="f">학년</label><input name="grade" value="${esc(p.grade)}"></div>
        </div>
        <div><label class="f">다른 표기 (쉼표로 구분, 자료 검색에 사용)</label><input name="aliases" value="${esc((p.aliases || []).join(', '))}"></div>
        <div><label class="f">시험 범위·메모</label><input name="examNote" value="${esc(p.examNote)}"></div>
        <div class="row end"><button class="btn ghost">정보 저장</button></div>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h2>작품 원문</h2>
        <div class="row"><button class="btn ghost sm" id="extractPoem">자료에서 원문 찾기 (Claude)</button><button class="btn sm" id="savePoem">원문 저장</button></div></div>
      <p class="small muted">시험지·교안에 그대로 인쇄되고, 문항이 원문에 없는 시구를 인용하는지 검사하는 기준이 됩니다. 연 사이는 빈 줄로 띄우세요.</p>
      <textarea id="poem" class="poem-pre" style="min-height:260px">${esc(p.poem)}</textarea>
      <div id="poemNote" class="small" style="margin-top:6px"></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>관련 자료</h2>
        <div class="row"><span class="small muted">선택됨 ${sel.length}조각 · ${selChars.toLocaleString()}자</span><button class="btn sm" id="doSearch">자료실에서 찾기</button></div></div>
      ${selChars > 150000 ? '<div class="callout warn small">선택한 자료가 많습니다(15만 자 초과). 생성 비용과 시간이 커지니 꼭 필요한 자료만 남기세요.</div>' : ''}
      <div id="searchBox">${state.search ? '' : sel.length ? selectedList(sel) : '<div class="empty">아직 선택된 자료가 없습니다. <b>자료실에서 찾기</b>를 누르세요.</div>'}</div>
    </div>`;

  el.querySelector('#infoForm').onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.aliases = body.aliases.split(',').map((s) => s.trim()).filter(Boolean);
    run(e.submitter, async () => {
      state.project = { ...(await api('/api/projects/' + p.id, { method: 'PATCH', body })), jobs: p.jobs };
      toast('저장했습니다');
      render();
    });
  };
  el.querySelector('#savePoem').onclick = (e) => run(e.target, async () => {
    state.project = { ...(await api('/api/projects/' + p.id, { method: 'PATCH', body: { poem: el.querySelector('#poem').value } })), jobs: p.jobs };
    toast('원문을 저장했습니다');
  });
  el.querySelector('#extractPoem').onclick = (e) => run(e.target, async () => {
    const r = await api(`/api/projects/${p.id}/poem/extract`, { method: 'POST' });
    const note = el.querySelector('#poemNote');
    if (r.found && r.poem) {
      el.querySelector('#poem').value = r.poem;
      note.innerHTML = `<span class="badge warn">확인 필요</span> 자료에서 찾은 원문을 넣었습니다. 교과서와 한 글자씩 대조한 뒤 <b>원문 저장</b>을 누르세요. ${esc(r.note)}`;
    } else {
      note.innerHTML = `<span class="badge bad">못 찾음</span> ${esc(r.note || '자료에서 원문 전체를 찾지 못했습니다. 직접 붙여 넣어 주세요.')}`;
    }
  });
  el.querySelector('#doSearch').onclick = (e) => run(e.target, async () => {
    const r = await api(`/api/projects/${p.id}/search`, { method: 'POST' });
    state.search = r.results;
    renderSearch(el.querySelector('#searchBox'));
  });
  if (state.search) renderSearch(el.querySelector('#searchBox'));
}

function selectedList(sel) {
  const byFile = new Map();
  for (const m of sel) {
    if (!byFile.has(m.fileId)) byFile.set(m.fileId, { name: m.relPath || m.fileName, n: 0, chars: 0 });
    const f = byFile.get(m.fileId);
    f.n++;
    f.chars += m.text.length;
  }
  return `<table class="t"><tbody>${[...byFile.values()].map((f) => `<tr><td>${esc(f.name)}</td><td class="muted">${f.n}조각 · ${f.chars.toLocaleString()}자</td></tr>`).join('')}</tbody></table>`;
}

function renderSearch(box) {
  const p = state.project;
  const results = state.search || [];
  const selectedKey = new Set(p.materials.selected.map((m) => m.fileId + ':' + m.chunkIndex));
  const hadSelection = p.materials.selected.length > 0;
  if (!results.length) {
    box.innerHTML = '<div class="empty">관련 자료를 찾지 못했습니다. 자료실에 파일이 있는지, 제목·다른 표기가 맞는지 확인하세요.</div>';
    return;
  }
  box.innerHTML = `
    <p class="small">파일 이름에 작품명이 있으면 파일 전체를, 아니면 작품명·원문 구절이 나오는 부분과 그 앞뒤를 골랐습니다. 필요 없는 것은 체크를 끄세요.</p>
    ${results.map((r) => `
      <div class="card flat" style="padding:12px 14px">
        <div class="row"><label class="row" style="flex:1"><input type="checkbox" data-file="${r.fileId}" ${r.chunks.some((c) => (hadSelection ? selectedKey.has(r.fileId + ':' + c.index) : true)) ? 'checked' : ''}>
          <b>${esc(r.name)}</b> ${r.fileHit ? '<span class="badge acc">파일명 일치</span>' : ''} <span class="small muted">${esc(r.relPath)}</span></label>
          <span class="small muted">${r.chunks.length}조각</span></div>
        <details><summary>조각 보기·고르기</summary>
          ${r.chunks.map((c) => `<label class="row small" style="align-items:flex-start;margin:6px 0">
            <input type="checkbox" data-chunk="${r.fileId}:${c.index}" ${(hadSelection ? selectedKey.has(r.fileId + ':' + c.index) : true) ? 'checked' : ''}>
            <span class="pre" style="flex:1;max-height:140px;overflow:auto;background:#f8f7f3;border-radius:6px;padding:6px 8px">${esc(c.text)}</span></label>`).join('')}
        </details>
      </div>`).join('')}
    <div class="row end"><button class="btn" id="saveSel">선택한 자료 저장</button></div>`;

  box.querySelectorAll('[data-file]').forEach((cb) => (cb.onchange = () => {
    box.querySelectorAll(`[data-chunk^="${cb.dataset.file}:"]`).forEach((c) => { c.checked = cb.checked; });
  }));
  box.querySelector('#saveSel').onclick = (e) => run(e.target, async () => {
    const selected = [];
    for (const r of results) {
      for (const c of r.chunks) {
        if (box.querySelector(`[data-chunk="${r.fileId}:${c.index}"]`).checked) {
          selected.push({ fileId: r.fileId, fileName: r.name, relPath: r.relPath, chunkIndex: c.index, text: c.text });
        }
      }
    }
    state.project = { ...(await api(`/api/projects/${p.id}/materials`, { method: 'PUT', body: { selected } })), jobs: p.jobs };
    state.search = null;
    toast(`자료 ${selected.length}조각을 저장했습니다`);
    render();
  });
}

// ----- ② 학교 필기 -----
function viewNotes(el) {
  const p = state.project;
  const n = p.notes;
  const draft = n.draft;
  const unstructured = n.entries.filter((e) => !e.structured);
  el.innerHTML = `
    <div class="callout"><b>학교 필기 기준</b>은 모든 교안과 문항의 정답 판정 기준입니다. 이 기준과 어긋나는 해석을 정답으로 삼는 문항은 자동 검수에서 걸러져 <b>검수</b> 탭에 올라옵니다.</div>

    <div class="grid2">
      <div class="card">
        <h2>필기 입력</h2>
        <p class="small muted">학생들이 보낸 필기 사진을 보면서 음성으로 받아 적으세요. 오타가 있어도 됩니다. 원문과 문맥을 보고 바로잡은 뒤, 바로잡은 내용을 따로 보여 줍니다.</p>
        <form id="entryForm" class="stack">
          <div class="fields">
            <div><label class="f">이름표</label><input name="label" placeholder="예: 3주차 · 2반 김○○ 사진"></div>
            <div><label class="f">날짜</label><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
          </div>
          <div><label class="f">필기 내용 (음성 입력)</label><textarea name="rawText" id="rawText" style="min-height:200px" placeholder="예) 1연 창밖에 밤비가 속살거려 → 어두운 현실, 화자의 불안. 육첩방은 남의 나라 별표 시험 나옴 → 일본 유학 중 이질감, 구속된 현실…"></textarea></div>
          <div class="row">
            <label class="btn ghost sm" title="사진을 Claude가 먼저 읽어 초안을 만들어 줍니다. 손글씨는 틀릴 수 있으니 꼭 고쳐 주세요.">사진으로 초안 받기<input type="file" id="noteImg" accept="image/*,.pdf" hidden></label>
            <span id="imgMsg" class="small muted"></span>
            <span class="spacer"></span>
            <button class="btn">입력 저장</button>
          </div>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>입력 목록</h2>
          <button class="btn sm" id="structure" data-needidle="notes" ${unstructured.length ? '' : 'data-off disabled'}>새 입력 ${unstructured.length}개 정리하기</button></div>
        <div data-jobslot="notes"></div>
        ${n.entries.length ? n.entries.slice().reverse().map((e) => `
          <div class="card flat" style="padding:10px 12px;margin-bottom:8px">
            <div class="row"><b>${esc(e.label || '필기')}</b><span class="small muted">${esc(e.date)}</span>
              ${e.structured ? '<span class="badge ok">정리됨</span>' : '<span class="badge warn">미정리</span>'}
              <span class="spacer"></span>
              <button class="btn ghost sm" data-editentry="${e.id}">수정</button>
              <button class="btn bad sm" data-delentry="${e.id}">삭제</button></div>
            <div class="small pre" style="margin-top:6px;max-height:110px;overflow:auto">${esc(e.rawText)}</div>
          </div>`).join('') : '<div class="empty">아직 입력이 없습니다.</div>'}
      </div>
    </div>

    ${draft ? draftPanel(draft) : ''}

    <div class="card">
      <div class="card-head"><h2>확정된 필기 기준 <span class="badge acc">v${n.version}</span></h2>
        <div class="row"><button class="btn ghost sm" id="addPoint">항목 추가</button><button class="btn sm" id="savePoints">변경 저장</button></div></div>
      <p class="small muted">직접 고치거나 지울 수 있습니다. 저장하면 버전이 올라가고, 이미 만든 문항은 <b>재검수</b>가 필요하다고 표시됩니다.</p>
      <table class="t" id="pointsTable"><thead><tr><th style="width:56px">ID</th><th style="width:22%">대상 (시어·구절)</th><th>선생님 해석</th><th style="width:70px">★시험</th><th style="width:60px"></th></tr></thead>
      <tbody>${n.points.map((pt) => pointRow(pt)).join('')}</tbody></table>
      ${n.points.length ? '' : '<div class="empty">확정된 필기가 없습니다. 입력 → 정리하기 → 검토 후 확정하세요.</div>'}
    </div>`;

  el.querySelector('#entryForm').onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    run(e.submitter, async () => {
      state.project = { ...(await api(`/api/projects/${p.id}/notes/entries`, { method: 'POST', body })), jobs: p.jobs };
      toast('필기를 저장했습니다. 다 입력했으면 "정리하기"를 누르세요.');
      render();
    });
  };
  el.querySelector('#noteImg').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const msg = el.querySelector('#imgMsg');
    msg.textContent = 'Claude가 사진을 읽는 중… (30초~1분)';
    run(null, async () => {
      const fd = new FormData();
      fd.append('image', file);
      const r = await api(`/api/projects/${p.id}/notes/transcribe`, { method: 'POST', body: fd });
      const ta = el.querySelector('#rawText');
      ta.value = (ta.value ? ta.value + '\n\n' : '') + r.text;
      msg.innerHTML = `<span class="badge warn">확인 필요</span> 사진 판독 초안을 넣었습니다. 손글씨는 틀릴 수 있으니 꼭 고친 뒤 저장하세요.${r.unreadable.length ? ` 판독불가 ${r.unreadable.length}곳` : ''}`;
    }).finally(() => { e.target.value = ''; });
  };
  const st = el.querySelector('#structure');
  st.onclick = () => run(st, async () => {
    const r = await api(`/api/projects/${p.id}/notes/structure`, { method: 'POST', body: { entryIds: unstructured.map((x) => x.id) } });
    trackJob(r.jobId, 'notes', reloadProject);
    updateJobViews();
  });
  el.querySelectorAll('[data-delentry]').forEach((b) => (b.onclick = () => {
    if (!confirm('이 필기 입력을 삭제할까요? (이미 확정된 필기 기준 항목은 그대로 남습니다)')) return;
    run(b, async () => { state.project = { ...(await api(`/api/projects/${p.id}/notes/entries/${b.dataset.delentry}`, { method: 'DELETE' })), jobs: p.jobs }; render(); });
  }));
  el.querySelectorAll('[data-editentry]').forEach((b) => (b.onclick = () => {
    const e = n.entries.find((x) => x.id === b.dataset.editentry);
    modal('필기 입력 수정', `<form id="editEntry" class="stack">
      <div class="fields"><div><label class="f">이름표</label><input name="label" value="${esc(e.label)}"></div><div><label class="f">날짜</label><input name="date" type="date" value="${esc(e.date)}"></div></div>
      <textarea name="rawText" style="min-height:300px">${esc(e.rawText)}</textarea>
      <label class="row small"><input type="checkbox" name="restructure" checked> 저장 후 "미정리"로 되돌리기 (다시 정리하기 대상)</label>
      <div class="row end"><button class="btn">저장</button></div></form>`);
    document.getElementById('editEntry').onsubmit = (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target));
      run(ev.submitter, async () => {
        const body = { label: fd.label, date: fd.date, rawText: fd.rawText };
        if (fd.restructure) body.structured = false;
        const proj = await api(`/api/projects/${p.id}/notes/entries/${e.id}`, { method: 'PUT', body });
        state.project = { ...proj, jobs: p.jobs };
        document.getElementById('modal').hidden = true;
        render();
      });
    };
  }));

  if (draft) bindDraft(el, draft);

  const table = el.querySelector('#pointsTable tbody');
  el.querySelector('#addPoint').onclick = () => {
    table.insertAdjacentHTML('beforeend', pointRow({ id: '', target: '', interpretation: '', examPoint: false }));
    bindPointRows(table);
  };
  bindPointRows(table);
  el.querySelector('#savePoints').onclick = (e) => {
    if (!confirm('필기 기준을 저장하면 버전이 올라가고, 이미 만든 자료는 재검수가 필요해집니다. 저장할까요?')) return;
    run(e.target, async () => {
      const points = [...table.querySelectorAll('tr')].map((tr) => {
        const old = n.points.find((x) => x.id === tr.dataset.id) || {};
        return {
          ...old,
          id: tr.dataset.id || '',
          target: tr.querySelector('[data-k=target]').value,
          interpretation: tr.querySelector('[data-k=interpretation]').value,
          examPoint: tr.querySelector('[data-k=examPoint]').checked,
        };
      }).filter((x) => x.target.trim() || x.interpretation.trim());
      state.project = { ...(await api(`/api/projects/${p.id}/notes/points`, { method: 'PUT', body: { points } })), jobs: p.jobs };
      toast('필기 기준을 저장했습니다');
      render();
    });
  };
}

function pointRow(pt) {
  return `<tr data-id="${esc(pt.id)}">
    <td><b>${esc(pt.id || '새')}</b></td>
    <td><textarea data-k="target" rows="2" style="min-height:54px">${esc(pt.target)}</textarea></td>
    <td><textarea data-k="interpretation" rows="2" style="min-height:54px">${esc(pt.interpretation)}</textarea>
      ${pt.sourceQuote ? `<div class="small muted" title="근거 입력">“${esc(pt.sourceQuote)}”${pt.source ? ` · ${esc(pt.source)}` : ''}</div>` : ''}</td>
    <td style="text-align:center"><input type="checkbox" data-k="examPoint" ${pt.examPoint ? 'checked' : ''}></td>
    <td><button class="btn bad sm" data-rmrow>삭제</button></td></tr>`;
}
function bindPointRows(tbody) {
  tbody.querySelectorAll('[data-rmrow]').forEach((b) => (b.onclick = () => b.closest('tr').remove()));
}

function draftPanel(d) {
  return `
    <div class="card" style="border-color:#f0c983;box-shadow:0 0 0 3px #fdf1de">
      <div class="card-head"><h2>정리 초안 — 검토 후 확정하세요</h2>
        <div class="row"><button class="btn bad sm" id="discardDraft">초안 버리기</button><button class="btn ok" id="confirmDraft">필기 기준에 추가 (확정)</button></div></div>
      ${d.sttFixes.length ? `<div class="callout small"><b>음성 입력 오타를 이렇게 바로잡았습니다</b> — 틀렸으면 아래 표에서 직접 고치세요.<br>${d.sttFixes.map((f) => `<span class="badge">${esc(f.heard)} → ${esc(f.corrected)}</span>`).join(' ')}</div>` : ''}
      ${d.ambiguities.length ? `<div class="callout warn small"><b>확인이 필요한 부분</b><ul style="margin:6px 0 0;padding-left:18px">${d.ambiguities.map((a) => `<li>“${esc(a.text)}” — ${esc(a.question)}</li>`).join('')}</ul></div>` : ''}
      <table class="t" id="draftTable"><thead><tr><th style="width:22%">대상</th><th>선생님 해석</th><th style="width:70px">★시험</th><th style="width:60px"></th></tr></thead><tbody>
      ${d.points.map((pt) => `<tr data-temp="${pt.tempId}">
        <td><textarea data-k="target" rows="2">${esc(pt.target)}</textarea></td>
        <td><textarea data-k="interpretation" rows="2">${esc(pt.interpretation)}</textarea><div class="small muted">근거: “${esc(pt.sourceQuote)}”</div></td>
        <td style="text-align:center"><input type="checkbox" data-k="examPoint" ${pt.examPoint ? 'checked' : ''}></td>
        <td><button class="btn bad sm" data-rmrow>빼기</button></td></tr>`).join('')}
      </tbody></table>
    </div>`;
}

function bindDraft(el, d) {
  const p = state.project;
  const tbody = el.querySelector('#draftTable tbody');
  bindPointRows(tbody);
  el.querySelector('#discardDraft').onclick = (e) => {
    if (!confirm('정리 초안을 버릴까요?')) return;
    run(e.target, async () => { state.project = { ...(await api(`/api/projects/${p.id}/notes/discard-draft`, { method: 'POST' })), jobs: p.jobs }; render(); });
  };
  el.querySelector('#confirmDraft').onclick = (e) => run(e.target, async () => {
    const points = [...tbody.querySelectorAll('tr')].map((tr) => {
      const src = d.points.find((x) => x.tempId === tr.dataset.temp) || {};
      return {
        target: tr.querySelector('[data-k=target]').value,
        interpretation: tr.querySelector('[data-k=interpretation]').value,
        examPoint: tr.querySelector('[data-k=examPoint]').checked,
        sourceQuote: src.sourceQuote,
        source: src.source,
      };
    });
    state.project = { ...(await api(`/api/projects/${p.id}/notes/confirm`, { method: 'POST', body: { points } })), jobs: p.jobs };
    toast(`필기 기준 v${state.project.notes.version} 으로 확정했습니다`);
    render();
  });
}

// ----- ③ 생성 -----
const OUTPUTS = [
  { key: 'teacher', kind: 'doc', title: '교사용 교안', big: '교사용', desc: '작품 개관 · 수업 흐름 · 시구별 해설 · 내신 포인트 · 판서 · 발문' },
  { key: 'student', kind: 'doc', title: '학생용 교안', big: '학생용', desc: '빈칸 채우기형 개관·해석 · 필기 여백 · 확인 문제' },
  { key: 'clinic', kind: 'set', title: '클리닉 테스트', big: '30문항', desc: '5지선다 객관식 · 정답·해설 포함 · 작품 단독/복합 지문' },
  { key: 'homework', kind: 'set', title: '과제물', big: '100문항', desc: '5지선다 객관식 · 정답·해설 포함 · 클리닉과 겹치지 않게' },
];

function outputState(p, o) {
  const obj = o.kind === 'doc' ? p.docs[o.key] : p.sets[o.key];
  if (!obj) return { made: false };
  const stale = (obj.verifiedNotesVersion ?? 0) < p.notes.version;
  if (o.kind === 'doc') {
    const pending = obj.issues.filter((i) => i.decision === 'pending').length;
    return { made: true, stale, pending, at: obj.generatedAt };
  }
  const qs = obj.questions;
  return {
    made: true, stale, at: obj.generatedAt,
    pending: qs.filter((q) => q.decision === 'pending').length,
    live: qs.filter((q) => q.decision !== 'deleted').length,
    target: obj.target,
  };
}

function viewGenerate(el) {
  const p = state.project;
  const noNotes = !p.notes.points.length;
  el.innerHTML = `
    ${noNotes ? '<div class="callout warn"><b>아직 학교 필기가 없습니다.</b> 지금 생성하면 교과서·EBS 등 일반적인 해석으로 먼저 만듭니다. 나중에 <a href="#/p/' + p.id + '/notes">학교 필기</a>를 입력하고 확정하면, 여기에 <b>새 필기로 재검수</b> 버튼이 생깁니다. 그 버튼을 누르면 필기와 어긋나는 문항이 검수 탭에 올라옵니다.</div>' : ''}
    ${!p.poem?.trim() ? '<div class="callout warn">작품 원문이 비어 있습니다. <a href="#/p/' + p.id + '/info">작품·자료</a>에서 원문을 넣어야 시험지에 작품이 인쇄되고 인용 검사도 됩니다.</div>' : ''}
    ${!p.materials.selected.length ? '<div class="callout warn">선택된 참고 자료가 없습니다. 자료 없이도 만들 수 있지만, 자료가 있으면 내용이 더 풍부해집니다.</div>' : ''}
    <div class="grid4">
      ${OUTPUTS.map((o) => {
        const s = outputState(p, o);
        const key = 'gen:' + o.key;
        const vkey = 'verify:' + o.key;
        return `<div class="card gen-card">
          <div class="row"><h3 style="margin:0">${o.title}</h3><span class="spacer"></span>
            ${s.made ? (s.stale ? '<span class="badge warn">필기 변경됨 · 재검수 필요</span>' : '<span class="badge ok">생성됨</span>') : '<span class="badge">미생성</span>'}</div>
          <div class="big">${o.big}</div>
          <div class="desc">${o.desc}</div>
          ${s.made ? `<div class="small muted">${fmtDate(s.at)} 생성${o.kind === 'set' ? ` · 살아있는 문항 ${s.live}/${s.target}` : ''}${s.pending ? ` · <b style="color:var(--warn)">검수 필요 ${s.pending}</b>` : ''}</div>` : ''}
          <div data-jobslot="${key}"></div><div data-jobslot="${vkey}"></div>
          <div class="row">
            <button class="btn" data-gen="${o.key}" data-needidle="${key}">${s.made ? '다시 생성' : '생성'}</button>
            ${s.made && s.stale ? `<button class="btn warn" data-reverify="${o.key}" data-needidle="${vkey}">새 필기로 재검수</button>` : ''}
            ${s.made ? `<a class="btn ghost" href="#/p/${p.id}/review/${o.key}">검수하러 가기</a>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="card flat small muted">
      생성은 백그라운드에서 진행되니 다른 탭을 봐도 됩니다. 4가지를 한꺼번에 눌러도 됩니다.<br>
      문항은 <b>출제 설계 → 10문항씩 작성 → 필기 기준으로 한 문항씩 검수</b> 순서로 만들어집니다. 정답 번호는 1~5번이 고르게 나오도록 미리 배정됩니다.<br>
      예상 비용(대략): 작품 1개에 4종 전체 생성 시 수천~1만 원대 [확인 필요]. 자료 양과 모델 설정에 따라 달라집니다.
    </div>`;

  el.querySelectorAll('[data-gen]').forEach((b) => (b.onclick = () => {
    const o = OUTPUTS.find((x) => x.key === b.dataset.gen);
    if (outputState(p, o).made && !confirm(`${o.title}을(를) 다시 만들면 지금 내용과 검수 결과가 모두 바뀝니다. 계속할까요?`)) return;
    if (noNotes && !confirm('학교 필기 없이 일반적인 해석으로 먼저 만듭니다.\n나중에 필기를 확정한 뒤 "새 필기로 재검수"를 누르면 필기와 어긋나는 문항을 걸러낼 수 있습니다.\n\n계속할까요?')) return;
    run(b, async () => {
      const r = await api(`/api/projects/${p.id}/generate/${o.key}`, { method: 'POST', body: { allowWithoutNotes: noNotes } });
      trackJob(r.jobId, 'gen:' + o.key, reloadProject);
      updateJobViews();
    });
  }));
  el.querySelectorAll('[data-reverify]').forEach((b) => (b.onclick = () => run(b, async () => {
    const r = await api(`/api/projects/${p.id}/reverify/${b.dataset.reverify}`, { method: 'POST' });
    trackJob(r.jobId, 'verify:' + b.dataset.reverify, reloadProject);
    updateJobViews();
  })));
}

// ----- ④ 검수 -----
function viewReview(el, sub) {
  const p = state.project;
  const made = OUTPUTS.filter((o) => outputState(p, o).made);
  if (!made.length) {
    el.innerHTML = `<div class="empty">아직 생성된 자료가 없습니다. <a href="#/p/${p.id}/generate">생성</a> 탭에서 먼저 만드세요.</div>`;
    return;
  }
  const cur = made.find((o) => o.key === sub) || made.find((o) => outputState(p, o).pending) || made[0];
  el.innerHTML = `
    <div class="subtabs">${made.map((o) => {
      const s = outputState(p, o);
      return `<a href="#/p/${p.id}/review/${o.key}" class="${o.key === cur.key ? 'on' : ''}">${o.title}${s.pending ? ` · ${s.pending}` : ''}</a>`;
    }).join('')}</div>
    <div id="reviewBody"></div>`;
  const body = el.querySelector('#reviewBody');
  if (cur.kind === 'set') reviewSet(body, cur);
  else reviewDoc(body, cur);
}

function pointText(id) {
  const pt = state.project.notes.points.find((x) => x.id === id);
  return pt ? `<span class="pt"><b>${esc(pt.id)}</b> ${esc(pt.target)} → ${esc(pt.interpretation)}</span>` : `<span class="pt"><b>${esc(id)}</b> (삭제된 항목)</span>`;
}

function questionHTML(q, { showAnswer = true } = {}) {
  return `
    <div class="q-stem">${rich(q.stem)}</div>
    ${q.extraPassage ? `<div class="q-box">${rich(q.extraPassage)}</div>` : ''}
    ${q.bogi ? `<div class="q-box"><span class="lbl">&lt;보 기&gt;</span>${rich(q.bogi)}</div>` : ''}
    <ol class="q-choices">${q.choices.map((c, i) => `<li class="${showAnswer && q.answer === i + 1 ? 'ans' : ''}"><span class="no">${CIRCLED[i]}</span><span>${rich(c)}</span></li>`).join('')}</ol>
    <details><summary>정답 ${CIRCLED[q.answer - 1] || '?'} · 해설 보기</summary><div class="q-exp">${esc(q.explanation)}</div></details>`;
}

function reviewSet(el, o) {
  const p = state.project;
  const set = p.sets[o.key];
  const s = outputState(p, o);
  const filter = state.sub['filter:' + o.key] || (s.pending ? 'pending' : 'all');
  const qs = set.questions;
  const counts = {
    accepted: qs.filter((q) => q.decision === 'accepted').length,
    pending: s.pending,
    deleted: qs.filter((q) => q.decision === 'deleted').length,
  };
  const shown = qs.filter((q) => filter === 'all' || q.decision === filter);
  const liveIndex = new Map(liveQuestions(set).map((q, i) => [q.id, i + 1]));
  const clean = qs.filter((q) => q.decision === 'pending' && ['consistent', 'unrelated'].includes(q.verify?.status) && !q.verify?.qualityIssue).length;

  el.innerHTML = `
    ${s.stale ? `<div class="callout warn">필기 기준이 v${set.verifiedNotesVersion} → v${p.notes.version} 으로 바뀌었습니다. <button class="btn warn sm" data-reverify="${o.key}" data-needidle="verify:${o.key}">새 필기로 전체 재검수</button><div data-jobslot="verify:${o.key}"></div></div>` : ''}
    <div class="row" style="margin-bottom:14px">
      <div class="stat ok"><b>${counts.accepted}</b><span>확정</span></div>
      <div class="stat warn"><b>${counts.pending}</b><span>검수 필요</span></div>
      <div class="stat bad"><b>${counts.deleted}</b><span>삭제</span></div>
      <div class="stat"><b>${s.live}/${s.target}</b><span>출력될 문항</span></div>
      <span class="spacer"></span>
      <div class="stack" style="text-align:right">
        ${s.live < s.target ? `<button class="btn" data-refill="${o.key}" data-needidle="refill:${o.key}">부족한 ${s.target - s.live}문항 새로 채우기</button>` : ''}
        ${clean ? `<button class="btn ghost sm" id="acceptClean">문제없는 ${clean}문항 한꺼번에 확정</button>` : ''}
      </div>
    </div>
    <div data-jobslot="refill:${o.key}"></div>
    <div class="subtabs">
      ${[['pending', `검수 필요 ${counts.pending}`], ['all', `전체 ${qs.length}`], ['accepted', `확정 ${counts.accepted}`], ['deleted', `삭제 ${counts.deleted}`]]
        .map(([k, l]) => `<a href="javascript:void 0" data-filter="${k}" class="${filter === k ? 'on' : ''}">${l}</a>`).join('')}
    </div>
    <details class="card flat" style="padding:10px 14px"><summary>시험지에 인쇄될 작품 (기호 표시본) 보기·수정</summary>
      <p class="small muted">문항에서 ㉠, ㉡ 등으로 가리키는 부분입니다. 원문 글자는 바꾸지 말고 기호와 &lt;u&gt;밑줄&lt;/u&gt; 표시만 고치세요.</p>
      <textarea id="markedPoem" class="poem-pre" style="min-height:220px">${esc(set.markedPoem)}</textarea>
      <div class="row end"><button class="btn sm" id="saveMarked">저장</button></div>
    </details>
    ${shown.length ? shown.map((q) => questionCard(q, liveIndex.get(q.id))).join('') : '<div class="empty">해당하는 문항이 없습니다.</div>'}`;

  el.querySelectorAll('[data-filter]').forEach((a) => (a.onclick = () => { state.sub['filter:' + o.key] = a.dataset.filter; render(); }));
  const ac = el.querySelector('#acceptClean');
  if (ac) ac.onclick = () => run(ac, async () => {
    state.project = { ...(await api(`/api/projects/${p.id}/sets/${o.key}/accept-all-clean`, { method: 'POST' })), jobs: p.jobs };
    render();
  });
  el.querySelector('#saveMarked').onclick = (e) => run(e.target, async () => {
    state.project = { ...(await api(`/api/projects/${p.id}/sets/${o.key}/marked-poem`, { method: 'PUT', body: { markedPoem: el.querySelector('#markedPoem').value } })), jobs: p.jobs };
    toast('저장했습니다');
  });
  el.querySelectorAll('[data-refill]').forEach((b) => (b.onclick = () => run(b, async () => {
    const r = await api(`/api/projects/${p.id}/refill/${o.key}`, { method: 'POST' });
    trackJob(r.jobId, 'refill:' + o.key, reloadProject);
    updateJobViews();
  })));
  el.querySelectorAll('[data-reverify]').forEach((b) => (b.onclick = () => run(b, async () => {
    const r = await api(`/api/projects/${p.id}/reverify/${o.key}`, { method: 'POST' });
    trackJob(r.jobId, 'verify:' + o.key, reloadProject);
    updateJobViews();
  })));
  el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => run(b, async () => {
    state.project = { ...(await api(`/api/projects/${p.id}/sets/${o.key}/questions/${b.dataset.q}/decision`, { method: 'POST', body: { action: b.dataset.act } })), jobs: p.jobs };
    render();
  })));
  el.querySelectorAll('[data-editq]').forEach((b) => (b.onclick = () => editQuestion(o.key, qs.find((q) => q.id === b.dataset.editq))));
}

function questionCard(q, liveNo) {
  const v = q.verify || { status: 'unchecked' };
  const st = STATUS_LABEL[v.status] || [v.status, ''];
  const proposal = v.proposal && q.decision === 'pending' && !q.appliedProposal;
  const hasFlag = v.status !== 'consistent' && v.status !== 'unrelated' || v.qualityIssue;
  return `
    <div class="q ${q.decision}">
      <div class="q-head">
        <span class="q-num">${liveNo ? liveNo + '.' : '—'}</span>
        ${badge(DECISION_LABEL[q.decision])} ${badge(st)}
        <span class="badge">${esc(q.type)}</span><span class="badge">난이도 ${esc(q.difficulty)}</span>
        ${q.appliedProposal ? '<span class="badge info">수정안 적용됨</span>' : ''}${q.edited ? '<span class="badge info">직접 수정</span>' : ''}${q.origin === 'refill' ? '<span class="badge acc">보충 문항</span>' : ''}
        <span class="spacer"></span>
        ${(q.basisPoints || []).map((id) => `<span class="badge acc" title="${esc(state.project.notes.points.find((x) => x.id === id)?.interpretation || '')}">${esc(id)}</span>`).join(' ')}
      </div>
      <div class="q-body ${proposal ? '' : 'single'}">
        <div class="q-col">${proposal ? '<div class="cap">원래 문항</div>' : ''}${questionHTML(q)}</div>
        ${proposal ? `<div class="q-col diff-new"><div class="cap">필기에 맞춘 수정안</div>${questionHTML(v.proposal)}</div>` : ''}
      </div>
      ${hasFlag || v.reason ? `<div class="q-verify ${v.status}">
        <b>검수 의견</b> ${esc(v.reason)}
        ${v.qualityIssue ? `<div style="color:var(--bad);margin-top:4px"><b>품질 문제</b> ${esc(v.qualityIssue)}</div>` : ''}
        ${v.conflictPoints?.length ? `<div class="pts">${v.conflictPoints.map(pointText).join('')}</div>` : ''}
      </div>` : ''}
      <div class="q-actions">
        ${q.decision === 'deleted'
          ? `<button class="btn ghost sm" data-act="restore" data-q="${q.id}">되살리기</button>`
          : `${proposal ? `<button class="btn ok sm" data-act="apply-proposal" data-q="${q.id}">수정안 적용</button>` : ''}
             ${q.decision === 'pending' ? `<button class="btn ghost sm" data-act="accept" data-q="${q.id}">${proposal ? '원래 문항 유지' : '이대로 확정'}</button>` : ''}
             <button class="btn ghost sm" data-editq="${q.id}">직접 수정</button>
             <button class="btn bad sm" data-act="delete" data-q="${q.id}">삭제</button>`}
      </div>
    </div>`;
}

function editQuestion(setKey, q) {
  const p = state.project;
  modal('문항 직접 수정', `<form id="qForm" class="stack">
    <div class="fields"><div><label class="f">유형</label><input name="type" value="${esc(q.type)}"></div>
      <div><label class="f">난이도</label><select name="difficulty">${['하', '중', '상'].map((d) => `<option ${d === q.difficulty ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div><label class="f">정답</label><select name="answer">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === q.answer ? 'selected' : ''}>${CIRCLED[n - 1]}</option>`).join('')}</select></div></div>
    <div><label class="f">발문</label><textarea name="stem" rows="2" style="min-height:50px">${esc(q.stem)}</textarea></div>
    <div><label class="f">추가 지문 (다른 작품·비평문, 없으면 비움)</label><textarea name="extraPassage" rows="2">${esc(q.extraPassage)}</textarea></div>
    <div><label class="f">&lt;보기&gt; (없으면 비움)</label><textarea name="bogi" rows="3">${esc(q.bogi)}</textarea></div>
    ${q.choices.concat(['', '', '', '', '']).slice(0, 5).map((c, i) => `<div><label class="f">선지 ${CIRCLED[i]}</label><textarea name="c${i}" rows="2" style="min-height:44px">${esc(c)}</textarea></div>`).join('')}
    <div><label class="f">해설</label><textarea name="explanation" style="min-height:150px">${esc(q.explanation)}</textarea></div>
    <p class="small muted">밑줄은 &lt;u&gt;…&lt;/u&gt; 로 표시합니다.</p>
    <div class="row end"><button class="btn ghost" value="save">저장</button><button class="btn" value="reverify">저장 후 필기 기준으로 재검수</button></div>
  </form>`);
  document.getElementById('qForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const body = {
      type: fd.type, difficulty: fd.difficulty, answer: Number(fd.answer), stem: fd.stem, extraPassage: fd.extraPassage, bogi: fd.bogi,
      choices: [0, 1, 2, 3, 4].map((i) => fd['c' + i]), explanation: fd.explanation, reverify: e.submitter.value === 'reverify',
    };
    run(e.submitter, async () => {
      state.project = { ...(await api(`/api/projects/${p.id}/sets/${setKey}/questions/${q.id}`, { method: 'PUT', body })), jobs: p.jobs };
      document.getElementById('modal').hidden = true;
      toast(body.reverify ? '저장하고 재검수했습니다' : '저장했습니다');
      render();
    });
  };
}

function reviewDoc(el, o) {
  const p = state.project;
  const doc = p.docs[o.key];
  const s = outputState(p, o);
  const issuesByItem = new Map();
  for (const is of doc.issues) {
    if (!issuesByItem.has(is.itemId)) issuesByItem.set(is.itemId, []);
    issuesByItem.get(is.itemId).push(is);
  }
  el.innerHTML = `
    ${s.stale ? `<div class="callout warn">필기 기준이 바뀌었습니다. <button class="btn warn sm" data-reverify="${o.key}" data-needidle="verify:${o.key}">새 필기로 재검수</button><div data-jobslot="verify:${o.key}"></div></div>` : ''}
    ${doc.issues.length ? `<div class="card" style="border-color:#f0c983">
      <h3>필기 기준과 어긋난 부분 ${s.pending ? `<span class="badge warn">${s.pending}개 남음</span>` : '<span class="badge ok">모두 처리</span>'}</h3>
      ${doc.issues.map((is) => {
        const item = doc.content.sections.flatMap((x) => x.items).find((it) => it.id === is.itemId);
        return `<div class="card flat" style="padding:10px 12px;${is.decision !== 'pending' ? 'opacity:.6' : ''}">
          <div class="row"><b>${esc(item?.label || is.itemId)}</b> ${is.decision === 'applied' ? '<span class="badge ok">수정 적용</span>' : is.decision === 'ignored' ? '<span class="badge">무시함</span>' : '<span class="badge warn">검수 필요</span>'}</div>
          <div class="small" style="margin:6px 0"><b>문제</b> ${esc(is.problem)}</div>
          ${is.conflictPoints.map(pointText).join('')}
          <div class="grid2 small" style="margin-top:8px">
            <div><div class="muted">현재</div><div class="pre">${rich(is.decision === 'applied' ? is.before : item?.text || '')}</div></div>
            <div class="diff-new" style="padding:4px 6px;border-radius:6px"><div class="muted">수정안</div><div class="pre">${rich(is.suggestion)}</div></div>
          </div>
          <div class="row end" style="margin-top:6px">
            ${is.decision === 'pending' ? `<button class="btn ok sm" data-issue="${is.id}" data-a="apply">수정안 적용</button><button class="btn ghost sm" data-issue="${is.id}" data-a="ignore">무시 (현재 유지)</button>` : `<button class="btn ghost sm" data-issue="${is.id}" data-a="restore">되돌리기</button>`}
          </div></div>`;
      }).join('')}
    </div>` : '<div class="callout ok">필기 기준과 어긋난 부분이 발견되지 않았습니다. 그래도 한 번 훑어보세요.</div>'}
    <div class="card">
      <h2>${esc(doc.content.title)}</h2><p class="muted">${esc(doc.content.subtitle)}</p>
      ${o.key === 'student' ? '<p class="small muted">{{ }} 로 감싼 말은 인쇄할 때 빈칸이 됩니다. (여기서는 파란 밑줄로 보입니다)</p>' : ''}
      ${doc.content.sections.map((sec) => `<div class="doc-sec"><h3>${esc(sec.heading)}</h3>
        ${sec.items.map((it) => `<div class="doc-item ${issuesByItem.get(it.id)?.some((x) => x.decision === 'pending') ? 'flag' : ''}">
          <div class="lab">${rich(it.label)}</div><div class="txt">${rich(it.text)}</div>
          <button class="btn ghost sm" data-edititem="${it.id}">수정</button></div>`).join('')}</div>`).join('')}
    </div>`;

  el.querySelectorAll('[data-issue]').forEach((b) => (b.onclick = () => run(b, async () => {
    state.project = { ...(await api(`/api/projects/${p.id}/docs/${o.key}/issues/${b.dataset.issue}`, { method: 'POST', body: { action: b.dataset.a } })), jobs: p.jobs };
    render();
  })));
  el.querySelectorAll('[data-reverify]').forEach((b) => (b.onclick = () => run(b, async () => {
    const r = await api(`/api/projects/${p.id}/reverify/${o.key}`, { method: 'POST' });
    trackJob(r.jobId, 'verify:' + o.key, reloadProject);
    updateJobViews();
  })));
  el.querySelectorAll('[data-edititem]').forEach((b) => (b.onclick = () => {
    const it = doc.content.sections.flatMap((x) => x.items).find((x) => x.id === b.dataset.edititem);
    modal('교안 항목 수정', `<form id="itemForm" class="stack">
      <div><label class="f">제목(라벨)</label><input name="label" value="${esc(it.label)}"></div>
      <div><label class="f">내용 — 빈칸은 {{정답}}, 밑줄은 &lt;u&gt;…&lt;/u&gt;</label><textarea name="text" style="min-height:220px">${esc(it.text)}</textarea></div>
      <div class="row end"><button class="btn">저장</button></div></form>`);
    document.getElementById('itemForm').onsubmit = (e) => {
      e.preventDefault();
      run(e.submitter, async () => {
        state.project = { ...(await api(`/api/projects/${p.id}/docs/${o.key}/items/${it.id}`, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) })), jobs: p.jobs };
        document.getElementById('modal').hidden = true;
        render();
      });
    };
  }));
}

// ----- ⑤ 출력 -----
function viewExport(el) {
  const p = state.project;
  const rows = [
    { doc: 'teacher', src: 'teacher', title: '교사용 교안' },
    { doc: 'student', src: 'student', title: '학생용 교안 (빈칸)' },
    { doc: 'student-key', src: 'student', title: '학생용 교안 — 정답 채운 본' },
    { doc: 'clinic', src: 'clinic', title: '클리닉 테스트 — 문제지' },
    { doc: 'clinic-answers', src: 'clinic', title: '클리닉 테스트 — 정답·해설' },
    { doc: 'homework', src: 'homework', title: '과제물 100 — 문제지' },
    { doc: 'homework-answers', src: 'homework', title: '과제물 100 — 정답·해설' },
  ];
  el.innerHTML = `
    <div class="callout">미리보기 창에서 <b>인쇄</b> 또는 <b>PDF로 저장</b>을 누르면 A4 인쇄용 PDF가 됩니다. (크롬·엣지 권장, 인쇄 설정에서 <b>배경 그래픽</b> 켜기)</div>
    <div class="card"><table class="t"><thead><tr><th>결과물</th><th>상태</th><th></th></tr></thead><tbody>
    ${rows.map((r) => {
      const o = OUTPUTS.find((x) => x.key === r.src);
      const s = outputState(p, o);
      let status;
      let ready = s.made;
      if (!s.made) status = '<span class="badge">미생성</span>';
      else if (s.pending) { status = `<span class="badge warn">검수 필요 ${s.pending}개 남음</span>`; ready = false; }
      else if (s.stale) status = '<span class="badge warn">필기 변경 후 재검수 안 함</span>';
      else status = `<span class="badge ok">출력 가능</span>${o.kind === 'set' && s.live !== s.target ? ` <span class="badge warn">${s.live}/${s.target}문항</span>` : ''}`;
      const url = `/print.html?project=${p.id}&doc=${r.doc}`;
      return `<tr><td><b>${r.title}</b></td><td>${status}</td><td style="text-align:right;white-space:nowrap">
        ${ready ? `<a class="btn ghost sm" href="${url}" target="_blank">미리보기·인쇄</a> <a class="btn sm" href="/api/projects/${p.id}/pdf/${r.doc}" data-pdf>PDF 바로 저장</a>`
          : s.made ? `<a class="btn ghost sm" href="#/p/${p.id}/review/${r.src}">검수 마치기</a> <a class="btn ghost sm" href="${url}&draft=1" target="_blank" title="검수 전 초안 (워터마크)">초안 미리보기</a>` : ''}
      </td></tr>`;
    }).join('')}
    </tbody></table></div>
    <p class="small muted">"PDF 바로 저장"이 안 되면 미리보기 창에서 인쇄 → 대상 "PDF로 저장"을 쓰세요.</p>`;
  el.querySelectorAll('[data-pdf]').forEach((a) => (a.onclick = async (e) => {
    e.preventDefault();
    a.textContent = '만드는 중…';
    try {
      const res = await fetch(a.href);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'PDF 생성 실패');
      const blob = await res.blob();
      const name = decodeURIComponent((res.headers.get('content-disposition') || '').split("''")[1] || 'output.pdf');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      toast(err.message, true);
    } finally {
      a.textContent = 'PDF 바로 저장';
    }
  }));
}

boot();
