import { esc, rich, CIRCLED, STATUS_LABEL, DECISION_LABEL, liveQuestions, teacherView } from './shared.js';
import { GENRES, SKILLS } from './genres.js';
import { gradeExam, weakSkills, answerString, examQuestions } from './examStats.js';

const genreOf = (p) => (GENRES[p?.genre] ? p.genre : '시');
const G = (p) => GENRES[genreOf(p)];
const genreSelect = (cur = '시') => `<select name="genre">${Object.entries(GENRES).map(([k, g]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select>`;

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

function renderLoginBar() {
  const s = state.status;
  const bar = document.getElementById('loginBar');
  if (s.mock || s.backend === 'api' || !s.cli || s.loggedIn) {
    bar.innerHTML = '';
    return;
  }
  const lg = state.login || {};
  bar.innerHTML = `<div class="callout bad" style="margin-bottom:20px">
    <div class="row"><b>Claude 로그인이 필요합니다.</b><span>Max 구독 계정으로 한 번만 로그인하면 됩니다.</span><span class="spacer"></span>
      <button class="btn sm" id="loginStart">${lg.started ? '로그인 다시 시작' : 'Claude 로그인'}</button></div>
    ${lg.started ? `<ol class="small" style="margin:10px 0 0;padding-left:18px;line-height:1.9">
      <li>${lg.url ? `<a href="${esc(lg.url)}" target="_blank"><b>여기를 눌러 로그인 페이지 열기</b></a> (이미 새 탭이 열렸으면 그 탭에서 진행)` : '브라우저에 로그인 페이지가 열렸는지 확인하세요.'}</li>
      <li>Max 계정으로 로그인하고 <b>승인(Authorize)</b>을 누릅니다.</li>
      <li>승인 뒤 화면에 <b>코드</b>가 나오면 복사해서 아래에 붙여넣고 <b>완료</b>를 누르세요. 코드 없이 "완료" 화면이 나왔으면 잠시 기다리면 자동으로 바뀝니다.</li>
    </ol>
    <form id="loginCode" class="row" style="margin-top:8px"><input name="code" placeholder="인증 코드 붙여넣기" style="flex:1;min-width:220px"><button class="btn sm">완료</button></form>` : ''}
  </div>`;
  bar.querySelector('#loginStart').onclick = (e) => run(e.target, async () => {
    const r = await api('/api/claude/login', { method: 'POST' });
    state.login = { started: true, url: r.url };
    if (r.url) window.open(r.url, '_blank');
    renderLoginBar();
    pollLogin();
  });
  const f = bar.querySelector('#loginCode');
  if (f) f.onsubmit = (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      await api('/api/claude/login/code', { method: 'POST', body: { code: new FormData(f).get('code') } });
      toast('코드를 보냈습니다. 확인 중…');
      pollLogin();
    });
  };
}

function pollLogin() {
  clearTimeout(pollLogin.t);
  let n = 0;
  const tick = async () => {
    state.status = await api('/api/status?force=1');
    if (state.status.loggedIn) {
      state.login = null;
      toast('Claude 로그인 완료! 이제 생성할 수 있습니다.');
      updateStatusBadge();
      renderLoginBar();
      render();
      return;
    }
    if (++n < 100) pollLogin.t = setTimeout(tick, 3000);
  };
  pollLogin.t = setTimeout(tick, 3000);
}

function updateStatusBadge() {
  const s = state.status;
  document.getElementById('apiBadge').innerHTML = s.mock
    ? '<span class="dot warn"></span>연습 모드 (가짜 데이터)'
    : !s.ready
      ? `<span class="dot bad"></span>${s.backend === 'api' ? 'API 키 없음 (.env 확인)' : !s.cli ? 'Claude Code 없음' : 'Claude 로그인 필요'}`
      : s.backend === 'api'
        ? `<span class="dot"></span>API 키 · ${esc(s.model)}`
        : `<span class="dot"></span>Claude 구독으로 연결 · ${esc(s.model)}`;
}

async function boot() {
  state.status = await api('/api/status');
  updateStatusBadge();
  renderLoginBar();
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
    if (route === 'exams') return id ? renderExam(id, tab || 'build') : renderExams();
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
    <div class="page-head"><div><h1>작품 목록</h1><div class="sub">작품(시·소설·비문학 지문·문법 단원) 하나당 교사용·학생용 교안, 클리닉·과제 문항을 만듭니다. 여러 작품의 클리닉 문항을 묶어 <b>클리닉 시험</b>으로 채점·성적표까지 냅니다.</div></div></div>
    ${s.mock ? '<div class="callout warn"><b>연습 모드</b>입니다. Claude를 부르지 않고 가짜 데이터로 화면과 인쇄 디자인만 확인할 수 있습니다.</div>' : ''}
    ${!s.mock && s.backend !== 'api' ? '<div class="callout small">Claude <b>Max 구독</b>으로 생성합니다 (추가 요금 없음, 구독 사용 한도를 함께 씀). 처음 한 번은 화면 위쪽의 <b>Claude 로그인</b> 버튼으로 로그인해 두세요.</div>' : ''}
    ${!s.mock && !s.ready ? `<div class="callout bad">${s.backend === 'api' ? '<b>API 키가 없습니다.</b> <span class="kbd">.env</span> 파일에 <span class="kbd">ANTHROPIC_API_KEY</span>를 넣고 다시 실행하세요.' : (!s.cli ? '<b>Claude Code를 찾지 못했습니다.</b> 검은 창을 닫고 <span class="kbd">start.command</span>를 다시 실행하세요.' : '<b>Claude 로그인이 필요합니다.</b> 위의 <b>Claude 로그인</b> 버튼을 누르세요.')}</div>` : ''}
    <div class="grid2">
      <div class="card">
        <h2>새 작품 시작</h2>
        <form id="newProject" class="stack">
          <div class="fields">
            <div style="flex:0 0 150px"><label class="f">갈래</label>${genreSelect()}</div>
            <div style="flex:1"><label class="f">제목 *</label><input name="title" placeholder="예: 쉽게 씌어진 시 / 수난이대 / 품사" required></div>
          </div>
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
    <div class="page-head"><div><h1>설정</h1><div class="sub">인쇄물 머리글과 학부모 코멘트 말투입니다.</div></div></div>
    <div class="card"><form id="settingsForm" class="stack">
      <div class="fields">
        <div><label class="f">학원(브랜드) 이름</label><input name="academyName" value="${esc(s.academyName)}" placeholder="예: ○○국어"></div>
        <div><label class="f">강사 이름</label><input name="teacherName" value="${esc(s.teacherName)}"></div>
        <div><label class="f">머리말 꼬리표</label><input name="chip" value="${esc(s.chip || '')}" placeholder="가리온문학"></div>
        <div><label class="f">대표 색상</label><input name="accent" type="color" value="${esc(s.accent)}" style="height:40px;padding:4px"></div>
      </div>
      <div><label class="f">학부모 코멘트 말투 예시 <span class="muted">(평소 학부모님께 보내는 문자·카톡 2~5개를 그대로 붙여 넣으세요. 비워 두면 기본 말투: 차분하고 따뜻한 존댓말)</span></label>
        <textarea name="teacherVoice" style="min-height:140px" placeholder="예) 어머님 안녕하세요, ○○국어 △△△입니다. 이번 주 클리닉에서 길동이는 …">${esc(s.teacherVoice || '')}</textarea></div>
      <div class="row end"><button class="btn">저장</button></div>
    </form></div>
    <div class="card"><h3>API 연결</h3>
      <p class="small">연결 방식: <b>${state.status.backend === 'api' ? 'API 키' : 'Claude 구독 (Claude Code 로그인)'}</b> · 모델: <b>${esc(state.status.model)}</b> · 생각 깊이: <b>${esc(state.status.effort)}</b> ${state.status.mock ? '· <span class="badge warn">연습 모드</span>' : ''}</p>
      <p class="small muted">로그인이 풀리면 화면 위쪽에 <b>Claude 로그인</b> 버튼이 나타납니다. 연결 방식·모델은 <span class="kbd">.env</span> 파일에서 바꿉니다.</p>
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
  indexed: ['목록만 (아직 안 읽음)', ''],
  scan: ['스캔본·이미지', 'warn'],
  empty: ['내용 없음', ''],
  error: ['오류', 'bad'],
};

async function renderLibrary() {
  const filter = state.sub.libFilter || '';
  const lib = await api('/api/library?q=' + encodeURIComponent(filter));
  const files = lib.files.sort((a, b) => (a.relPath || a.name).localeCompare(b.relPath || b.name, 'ko'));
  const counts = lib.counts;

  $app.innerHTML = `
    <div class="page-head"><div><h1>자료실</h1><div class="sub">폴더를 연결하면 <b>파일 이름 목록만</b> 만들어 둡니다. 내용은 작품별로 고른 파일만 읽으므로 수백 GB 폴더도 괜찮습니다.</div></div></div>
    <div class="grid2">
      <div class="card">
        <div class="card-head"><h3>① OneDrive 폴더 연결 (권장)</h3></div>
        <p class="small">공유받은 OneDrive 폴더를 이 컴퓨터에 동기화한 뒤 그 폴더 경로를 넣으세요. 파일을 내려받지 않고 이름 목록만 만듭니다. 새 파일이 생기면 <b>목록 새로고침</b>을 누르세요.</p>
        <details class="small"><summary>폴더 경로 찾는 법 (맥)</summary>
          <ol style="padding-left:18px">
            <li>웹 OneDrive → <b>공유됨</b> → 원장님이 공유한 폴더 → <b>내 파일에 바로 가기 추가</b></li>
            <li>맥의 OneDrive 앱이 켜져 있으면 Finder 왼쪽 <b>OneDrive</b> 아래에 그 폴더가 나타납니다. (파일은 필요할 때만 내려받음 상태로 두세요)</li>
            <li>Finder에서 그 폴더를 <b>우클릭 → Option 키를 누른 채 "경로 이름 복사"</b>를 누르고 아래에 붙여 넣습니다.<br>보통 <span class="kbd">/Users/이름/Library/CloudStorage/OneDrive-…/폴더명</span> 모양입니다.</li>
          </ol>
        </details>
        <form id="folderForm" class="row" style="margin-top:8px">
          <input name="path" placeholder="/Users/이름/Library/CloudStorage/OneDrive-…/폴더" style="flex:1;min-width:220px">
          <button class="btn">연결</button>
        </form>
        <div data-jobslot="scan" style="margin-top:6px"></div>
        ${lib.folders.length ? `<div class="stack" style="margin-top:12px">${lib.folders.map((f) => `
          <div class="row"><span class="kbd" style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(f.path)}</span><span class="small muted">${f.count.toLocaleString()}개</span>
          <button class="btn bad sm" data-unfolder="${esc(f.path)}">연결 해제</button></div>`).join('')}
          <div class="row end"><button class="btn ghost sm" id="rescan" data-needidle="scan">목록 새로고침</button></div></div>` : ''}
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
        <h3>자료 ${lib.total.toLocaleString()}개 <span class="small muted">· 목록만 ${(counts.indexed || 0).toLocaleString()} · 읽음 ${counts.ok || 0} · 스캔본 ${counts.scan || 0} · 오류 ${counts.error || 0}</span></h3>
        <input id="libFilter" placeholder="파일·폴더 이름 검색 (예: 쉽게 씌어진)" value="${esc(filter)}" style="max-width:280px">
      </div>
      <div class="row small muted" style="margin-bottom:8px">${filter ? `"${esc(filter)}" 검색 결과 ${lib.matched.toLocaleString()}개${lib.matched > lib.shown ? ` 중 ${lib.shown}개만 표시` : ''}` : '직접 올린 파일과 읽어 둔 파일만 보여 줍니다. 폴더 파일은 이름으로 검색하세요.'}
        ${lib.matchedUnread ? `<span class="spacer"></span><button class="btn sm" id="readQuery" data-needidle="extract">안 읽은 ${lib.matchedUnread.toLocaleString()}개 모두 읽어 두기</button>` : ''}</div>
      <div data-jobslot="extract"></div>
      ${!filter ? '<div class="callout small"><b>자습서 팁</b> — 자습서처럼 파일 이름에 작품명이 없는 자료는 한 번 읽어 둬야 작품 검색에 걸립니다. 위 검색칸에 <b>자습서</b>(또는 해당 폴더 이름)를 넣고 <b>모두 읽어 두기</b>를 한 번 눌러 두세요. 이후에는 매주 작품 이름만 넣으면 그 안에서 해당 작품 부분만 찾아옵니다. (OneDrive에서는 읽는 파일만 내려받으므로 저장 공간을 확인하세요)</div>' : ''}
      ${counts.scan ? '<div class="callout warn small">스캔본은 글자 정보가 없어 검색되지 않습니다. 중요한 자료만 <b>Claude로 읽기</b>를 누르세요. (장당 API 비용이 듭니다)</div>' : ''}
      ${files.length ? `<table class="t"><thead><tr><th>파일</th><th>상태</th><th>글자 수</th><th></th></tr></thead><tbody>
        ${files.map((f) => `<tr>
          <td><b>${esc(f.name)}</b><div class="small muted">${esc(f.relPath || '')}</div>${(f.warnings || []).map((w) => `<div class="small" style="color:var(--warn)">${esc(w)}</div>`).join('')}</td>
          <td>${badge(FILE_STATUS[f.status] || [f.status, ''])}${f.ocr ? ' <span class="badge info">Claude 판독</span>' : ''}</td>
          <td class="muted">${(f.chars || 0).toLocaleString()}</td>
          <td style="text-align:right;white-space:nowrap">
            <div data-jobslot="ocr:${f.id}"></div>
            ${f.status === 'scan' || f.ocr ? `<button class="btn ghost sm" data-ocr="${f.id}" data-needidle="ocr:${f.id}">${f.ocr ? '다시 판독' : 'Claude로 읽기'}</button>` : ''}
            ${f.status === 'indexed' ? `<button class="btn ghost sm" data-extract="${f.id}">읽기</button>` : ''}
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
  const rq = document.getElementById('readQuery');
  if (rq) rq.onclick = () => {
    if (!confirm(`"${filter}" 검색에 걸린 안 읽은 파일 ${lib.matchedUnread}개를 모두 읽습니다. 파일이 많으면 오래 걸릴 수 있습니다. 계속할까요?`)) return;
    run(rq, async () => {
      const r = await api('/api/library/extract-query', { method: 'POST', body: { q: filter } });
      trackJob(r.jobId, 'extract', renderLibrary);
      updateJobViews();
    });
  };
  $app.querySelectorAll('[data-extract]').forEach((b) => (b.onclick = () => run(b, async () => {
    const r = await api('/api/library/extract', { method: 'POST', body: { ids: [b.dataset.extract] } });
    trackJob(r.jobId, 'extract', renderLibrary);
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
          <div style="flex:0 0 150px"><label class="f">갈래</label>${genreSelect(genreOf(p))}</div>
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
      <div class="card-head"><h2>${G(p).text}</h2>
        <div class="row"><button class="btn ghost sm" id="extractPoem">자료에서 ${genreOf(p) === '문법' ? '내용 모으기' : '원문 찾기'} (Claude)</button><button class="btn sm" id="savePoem">저장</button></div></div>
      <p class="small muted">${genreOf(p) === '문법' ? '교사용 교안의 뼈대가 되고, 문항이 단원 내용에서 벗어나지 않는지 검사하는 기준이 됩니다. 시험지에는 싣지 않습니다.' : '시험지·교안에 그대로 인쇄되고, 문항이 원문에 없는 구절을 인용하는지 검사하는 기준이 됩니다.'} ${G(p).textHint}</p>
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

const TIER_LABEL = { title: ['이름에 작품명', 'acc'], content: ['본문에 작품 언급', 'info'], author: ['이름에 작가만', ''] };

function renderSearch(box) {
  const p = state.project;
  const results = state.search || [];
  const selectedKey = new Set(p.materials.selected.map((m) => m.fileId + ':' + m.chunkIndex));
  const hadSelection = p.materials.selected.length > 0;
  if (!results.length) {
    box.innerHTML = '<div class="empty">관련 파일을 찾지 못했습니다. 자료실에 폴더를 연결했는지, 제목·다른 표기가 맞는지 확인하세요.</div>';
    return;
  }
  const unread = results.filter((r) => r.status === 'indexed');
  const readable = results.filter((r) => r.chunks.length);
  const scans = results.filter((r) => r.status === 'scan');
  box.innerHTML = `
    ${unread.length ? `<div class="card flat" style="padding:12px 14px;border-color:#f0c983">
      <div class="row"><b>아직 안 읽은 파일 ${unread.length}개</b><span class="small muted">— 이름으로 찾은 파일입니다. 읽을 파일을 체크하고 읽기를 누르세요. (OneDrive에서는 이때 그 파일만 내려받습니다)</span></div>
      <div style="max-height:320px;overflow:auto;margin:8px 0">${unread.map((r) => `<label class="row small" style="margin:3px 0">
        <input type="checkbox" data-read="${r.fileId}" ${r.tier === 'title' ? 'checked' : ''}> ${badge(TIER_LABEL[r.tier])}
        <b>${esc(r.name)}</b><span class="muted">${esc(r.relPath)} ${r.size ? ` · ${(r.size / 1048576).toFixed(1)}MB` : ""}</span></label>`).join('')}</div>
      <div data-jobslot="extract"></div>
      <div class="row end"><button class="btn sm" id="readSel" data-needidle="extract">체크한 파일 읽기</button></div></div>` : ''}
    ${scans.length ? `<div class="callout warn small">스캔본(글자 없는 PDF·사진) ${scans.length}개: ${scans.map((r) => esc(r.name)).join(', ')} — 필요하면 자료실에서 <b>Claude로 읽기</b>를 누르세요.</div>` : ''}
    ${readable.length ? `<p class="small">읽은 파일에서 작품과 관련된 부분만 골랐습니다. 작은 파일은 전체를, 자습서처럼 큰 파일은 작품이 나오는 쪽과 그 앞뒤만 넣었습니다. 필요 없는 것은 체크를 끄세요.</p>
    ${readable.map((r) => `
      <div class="card flat" style="padding:12px 14px">
        <div class="row"><label class="row" style="flex:1"><input type="checkbox" data-file="${r.fileId}" ${r.chunks.some((c) => (hadSelection ? selectedKey.has(r.fileId + ':' + c.index) : r.tier !== 'author')) ? 'checked' : ''}>
          <b>${esc(r.name)}</b> ${badge(TIER_LABEL[r.tier])} <span class="small muted">${esc(r.relPath)}</span></label>
          <span class="small muted">${r.chunks.length}조각 · ${r.chunks.reduce((n, c) => n + c.text.length, 0).toLocaleString()}자</span></div>
        <details><summary>조각 보기·고르기</summary>
          ${r.chunks.map((c) => `<label class="row small" style="align-items:flex-start;margin:6px 0">
            <input type="checkbox" data-chunk="${r.fileId}:${c.index}" ${(hadSelection ? selectedKey.has(r.fileId + ':' + c.index) : r.tier !== 'author') ? 'checked' : ''}>
            <span class="pre" style="flex:1;max-height:140px;overflow:auto;background:#f8f7f3;border-radius:6px;padding:6px 8px">${esc(c.text)}</span></label>`).join('')}
        </details>
      </div>`).join('')}
    <div class="row end"><button class="btn" id="saveSel">선택한 자료 저장</button></div>` : ''}`;

  const readBtn = box.querySelector('#readSel');
  if (readBtn) readBtn.onclick = () => run(readBtn, async () => {
    const ids = [...box.querySelectorAll('[data-read]:checked')].map((c) => c.dataset.read);
    if (!ids.length) throw new Error('읽을 파일을 체크하세요.');
    const r = await api('/api/library/extract', { method: 'POST', body: { ids } });
    trackJob(r.jobId, 'extract', async () => {
      state.search = (await api(`/api/projects/${p.id}/search`, { method: 'POST' })).results;
      render();
    });
    updateJobViews();
  });
  box.querySelectorAll('[data-file]').forEach((cb) => (cb.onchange = () => {
    box.querySelectorAll(`[data-chunk^="${cb.dataset.file}:"]`).forEach((c) => { c.checked = cb.checked; });
  }));
  const save = box.querySelector('#saveSel');
  if (save) save.onclick = (e) => run(e.target, async () => {
    const selected = [];
    for (const r of readable) {
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
  { key: 'teacher', kind: 'doc', title: '교사용 교안', big: '교사용', desc: '자습서·자료 해석을 행·단락마다 응축한 필기 + 학교 필기(빨간색). 필기와 어긋나는 자료 해석은 자동으로 빠짐' },
  { key: 'student', kind: 'poem', title: '학생용 교안', big: '학생용', desc: '원문 전체 + 넓은 행간 (수업하면서 채우는 용도). 원문만 있으면 바로 출력' },
  { key: 'clinic', kind: 'set', title: '클리닉 테스트', count: 30, desc: '5지선다 · 정답·해설 · 문항마다 측정 능력 표시 (클리닉 시험 성적표에 쓰임)' },
  { key: 'homework', kind: 'set', title: '과제물', count: 100, desc: '5지선다 객관식 · 정답·해설 포함 · 클리닉과 겹치지 않게' },
];
const setCount = (p, o) => Number(p.setCounts?.[o.key]) || o.count;

function outputState(p, o) {
  if (o.kind === 'poem') return { made: Boolean(p.poem?.trim()), stale: false, pending: 0 };
  const obj = o.kind === 'doc' ? p.docs[o.key] : p.sets[o.key];
  if (!obj) return { made: false };
  const stale = (obj.verifiedNotesVersion ?? 0) < p.notes.version;
  if (o.kind === 'doc') {
    return { made: true, stale, pending: 0, at: obj.generatedAt, excluded: (obj.excluded || []).filter((x) => x.decision === 'excluded').length };
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
    ${noNotes ? '<div class="callout warn"><b>아직 학교 필기가 없습니다.</b> 지금 만들면 자료(자습서) 해석만으로 먼저 만듭니다. 나중에 <a href="#/p/' + p.id + '/notes">학교 필기</a>를 확정하면 교사용 교안에 빨간색으로 바로 실리고, <b>새 필기 반영</b> 버튼으로 필기와 어긋나는 자료 해석·문항을 걸러낼 수 있습니다.</div>' : ''}
    ${!p.poem?.trim() ? '<div class="callout warn">원문이 비어 있습니다. <a href="#/p/' + p.id + '/info">작품·자료</a>에서 원문을 넣어야 시험지에 지문이 인쇄되고 인용 검사도 됩니다.</div>' : ''}
    ${!p.materials.selected.length ? '<div class="callout warn">선택된 참고 자료가 없습니다. 자료 없이도 만들 수 있지만, 자료가 있으면 내용이 더 풍부해집니다.</div>' : ''}
    <div class="grid4">
      ${OUTPUTS.map((o) => {
        const s = outputState(p, o);
        const key = 'gen:' + o.key;
        const vkey = 'verify:' + o.key;
        if (o.kind === 'poem') {
          return `<div class="card gen-card">
            <div class="row"><h3 style="margin:0">${o.title}</h3><span class="spacer"></span>${s.made ? '<span class="badge ok">바로 출력 가능</span>' : '<span class="badge warn">원문 필요</span>'}</div>
            <div class="big">${o.big}</div><div class="desc">${o.desc}</div>
            <div class="row">${s.made ? `<a class="btn" href="/print.html?project=${p.id}&doc=student" target="_blank">미리보기·인쇄</a>` : `<a class="btn ghost" href="#/p/${p.id}/info">원문 넣으러 가기</a>`}</div>
          </div>`;
        }
        return `<div class="card gen-card">
          <div class="row"><h3 style="margin:0">${o.title}</h3><span class="spacer"></span>
            ${s.made ? (s.stale ? '<span class="badge warn">필기 변경됨 · 재검수 필요</span>' : '<span class="badge ok">생성됨</span>') : '<span class="badge">미생성</span>'}</div>
          <div class="big">${o.kind === 'set' ? `<input type="number" class="count-in" data-count="${o.key}" min="1" max="150" value="${setCount(p, o)}" title="만들 문항 수 (바꾸면 바로 저장)">문항` : o.big}</div>
          <div class="desc">${o.desc}</div>
          ${s.made ? `<div class="small muted">${fmtDate(s.at)} 생성${o.kind === 'set' ? ` · 살아있는 문항 ${s.live}/${s.target}` : ''}${s.excluded ? ` · 필기와 어긋나 뺀 자료 해석 ${s.excluded}개` : ''}${o.kind === 'doc' && s.stale ? ' · <b style="color:var(--warn)">필기가 바뀌었습니다. 다시 생성하면 새 필기로 자료 해석을 다시 거릅니다 (학교 필기 자체는 이미 반영됨)</b>' : ''}${s.pending ? ` · <b style="color:var(--warn)">검수 필요 ${s.pending}</b>` : ''}</div>` : ''}
          <div data-jobslot="${key}"></div><div data-jobslot="${vkey}"></div>
          <div class="row">
            ${o.key === 'teacher' && !p.poem?.trim()
              ? `<a class="btn ghost" href="#/p/${p.id}/info">먼저 원문 넣기</a>`
              : `<button class="btn" data-gen="${o.key}" data-needidle="${key}">${s.made ? '다시 생성' : '생성'}</button>`}
            ${s.made && s.stale && o.kind === 'set' ? `<button class="btn warn" data-reverify="${o.key}" data-needidle="${vkey}">새 필기로 재검수</button>` : ''}
            ${s.made ? `<a class="btn ghost" href="#/p/${p.id}/review/${o.key}">${o.kind === 'doc' ? '확인·수정' : '검수하러 가기'}</a>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="card flat small muted">
      생성은 백그라운드에서 진행되니 다른 탭을 봐도 됩니다. 여러 개를 한꺼번에 눌러도 됩니다.<br>
      문항은 <b>출제 설계 → 10문항씩 작성 → 필기 기준으로 한 문항씩 검수</b> 순서로 만들어집니다. 정답 번호는 1~5번이 고르게 나오도록 미리 배정됩니다.<br>
      비용은 선택한 자료 양에 비례합니다. 자습서 조각을 필요한 것만 남길수록 싸고 빠릅니다.
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
  el.querySelectorAll('[data-count]').forEach((inp) => (inp.onchange = async () => {
    const n = Math.max(1, Math.min(150, Number(inp.value) || 0));
    inp.value = n;
    state.project = { ...(await api('/api/projects/' + p.id, { method: 'PATCH', body: { setCounts: { [inp.dataset.count]: n } } })), jobs: p.jobs };
    toast(`다음 생성부터 ${n}문항으로 만듭니다`);
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
  const made = OUTPUTS.filter((o) => o.kind !== 'poem' && outputState(p, o).made);
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
  else reviewTeacher(body);
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

function skillSummary(qs) {
  const m = new Map();
  for (const q of qs) m.set(q.skill || '미지정', (m.get(q.skill || '미지정') || 0) + 1);
  if (!m.size) return '';
  return `<div class="card flat small" style="padding:10px 14px"><b>측정 능력 분포</b> <span class="muted">(성적표에서 능력별 정답률로 묶입니다. 문항 머리의 목록에서 바꿀 수 있습니다)</span><br>
    ${[...m].map(([k, n]) => `<span class="badge ${k === '미지정' ? 'warn' : ''}">${esc(k)} ${n}</span>`).join(' ')}</div>`;
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
    ${skillSummary(liveQuestions(set))}
    ${shown.length ? shown.map((q) => questionCard(q, liveIndex.get(q.id))).join('') : '<div class="empty">해당하는 문항이 없습니다.</div>'}`;

  el.querySelectorAll('[data-skill]').forEach((sel) => (sel.onchange = () => run(sel, async () => {
    state.project = { ...(await api(`/api/projects/${p.id}/sets/${o.key}/questions/${sel.dataset.skill}/skill`, { method: 'PUT', body: { skill: sel.value } })), jobs: p.jobs };
    toast('측정 능력을 바꿨습니다');
  })));

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
        <select class="skill-sel" data-skill="${q.id}" title="이 문항이 측정하는 능력 (클리닉 성적표의 능력별 분석에 쓰임)">${[...new Set([...(SKILLS[genreOf(state.project)] || []), q.skill].filter(Boolean))].map((k) => `<option ${k === q.skill ? 'selected' : ''}>${esc(k)}</option>`).join('')}${q.skill ? '' : '<option selected value="">측정 능력 미지정</option>'}</select>
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

function reviewTeacher(el) {
  const p = state.project;
  const v = teacherView(p);
  const doc = p.docs.teacher;
  const stale = (doc.verifiedNotesVersion ?? 0) < p.notes.version;
  const excluded = v.excluded;
  const matNote = (n) => `<li class="mt"><span>${n.tag ? `<span class="badge acc">${esc(n.tag)}</span> ` : ''}${n.phrase ? `<b>‘${esc(n.phrase)}’</b> ` : ''}${rich(n.text)}</span> <span class="ops"><button class="btn ghost sm" data-editnote="${n.id}">수정</button><button class="btn bad sm" data-delnote="${n.id}">삭제</button></span></li>`;
  const schoolNote = (s) => `<li class="sc">${s.examPoint ? '★ ' : ''}${s.showTarget ? `<b>‘${esc(s.target)}’</b> ` : ''}${esc(s.text)} <span class="badge bad">${esc(s.id)}</span></li>`;
  el.innerHTML = `
    <div class="callout small"><b style="color:#c62828">빨간색</b>은 학교 필기(확정본 원문 그대로), 검은색은 자습서·자료에서 모은 해석입니다. 학교 필기를 고치려면 <a href="#/p/${p.id}/notes">학교 필기</a> 탭에서 고치면 바로 반영됩니다.</div>
    ${stale ? `<div class="callout warn">필기 기준이 v${doc.verifiedNotesVersion} → v${p.notes.version} 으로 바뀌었습니다. 빨간 필기는 이미 반영됐고, <b>생성</b> 탭에서 교사용 교안을 다시 만들면 새 필기와 어긋나는 자료 해석이 걸러집니다.</div>` : ''}
    ${excluded.length ? `<div class="card" style="border-color:#f0c983">
      <h3>학교 필기와 어긋나서 뺀 자료 해석 ${excluded.length}개</h3>
      <p class="small muted">교안에는 실리지 않았습니다. 필요한 것만 <b>되살리기</b>를 누르면 "작품 전체" 칸에 실립니다.</p>
      ${excluded.map((x) => `<div class="card flat" style="padding:10px 12px;${x.decision === 'restored' ? 'opacity:.6' : ''}">
        <div class="pre small">${rich(x.text)}</div>
        <div class="small" style="margin:4px 0;color:var(--warn)"><b>뺀 이유</b> ${esc(x.reason)}</div>
        ${x.conflictPoints.map(pointText).join('')}
        <div class="row end" style="margin-top:6px">${x.decision === 'restored'
          ? `<span class="badge ok">되살림</span><button class="btn ghost sm" data-x="${x.id}" data-a="exclude">다시 빼기</button>`
          : `<button class="btn ghost sm" data-x="${x.id}" data-a="restore">되살리기</button>`}</div></div>`).join('')}
    </div>` : ''}
    <div class="card">
      <h3>작품 개관</h3>
      <ul class="tv">${v.overview.map((o) => `<li class="mt"><span><b>${esc(o.label)}</b> ${rich(o.text)}</span> <span class="ops"><button class="btn ghost sm" data-editnote="${o.id}">수정</button><button class="btn bad sm" data-delnote="${o.id}">삭제</button></span></li>`).join('')}</ul>
    </div>
    <div class="card">
      <h3>시구별 필기</h3>
      ${v.rows.map((r) => `${r.stanzaBreak ? '<hr class="stz">' : ''}<div class="tv-row"><div class="tv-line"><span class="muted small">${r.lineNo}</span> ${esc(r.text)}</div>
        <ul class="tv">${r.school.map(schoolNote).join('')}${r.material.map(matNote).join('')}${!r.school.length && !r.material.length ? '<li class="muted small">필기 없음</li>' : ''}</ul></div>`).join('')}
    </div>
    <div class="card">
      <h3>작품 전체</h3>
      <ul class="tv">${v.schoolGeneral.map(schoolNote).join('')}${v.general.map((g) => `<li class="mt"><span>${g.label ? `<b>${esc(g.label)}</b> ` : ''}${rich(g.text)}</span> <span class="ops"><button class="btn ghost sm" data-editnote="${g.id}">수정</button><button class="btn bad sm" data-delnote="${g.id}">삭제</button></span></li>`).join('')}</ul>
    </div>
    <div class="row end"><a class="btn" href="/print.html?project=${p.id}&doc=teacher" target="_blank">교사용 교안 미리보기·인쇄</a></div>`;

  const allNotes = [...doc.content.overview, ...doc.content.general, ...doc.content.lines.flatMap((l) => l.notes)];
  el.querySelectorAll('[data-delnote]').forEach((b) => (b.onclick = () => run(b, async () => {
    state.project = { ...(await api(`/api/projects/${p.id}/docs/teacher/notes/${b.dataset.delnote}`, { method: 'PUT', body: { deleted: true } })), jobs: p.jobs };
    render();
  })));
  el.querySelectorAll('[data-editnote]').forEach((b) => (b.onclick = () => {
    const n = allNotes.find((x) => x.id === b.dataset.editnote);
    modal('필기 수정', `<form id="noteForm" class="stack">
      ${'label' in n ? `<div><label class="f">제목</label><input name="label" value="${esc(n.label)}"></div>` : ''}
      <div><label class="f">내용</label><textarea name="text" style="min-height:140px">${esc(n.text)}</textarea></div>
      <div class="row end"><button class="btn">저장</button></div></form>`);
    document.getElementById('noteForm').onsubmit = (e) => {
      e.preventDefault();
      run(e.submitter, async () => {
        state.project = { ...(await api(`/api/projects/${p.id}/docs/teacher/notes/${n.id}`, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) })), jobs: p.jobs };
        document.getElementById('modal').hidden = true;
        render();
      });
    };
  }));
  el.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => run(b, async () => {
    state.project = { ...(await api(`/api/projects/${p.id}/docs/teacher/excluded/${b.dataset.x}`, { method: 'POST', body: { action: b.dataset.a } })), jobs: p.jobs };
    render();
  })));
}

// ----- ⑤ 출력 -----
function viewExport(el) {
  const p = state.project;
  const rows = [
    { doc: 'teacher', src: 'teacher', title: '교사용 교안' },
    { doc: 'student', src: 'student', title: '학생용 교안 (시 전문 + 넓은 행간)' },
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

// ---------------- 클리닉 시험 (묶음 시험 · OMR 채점 · 학부모 성적표) ----------------

async function renderExams() {
  const [exams, projects] = [await api('/api/exams'), state.projects];
  $app.innerHTML = `
    <div class="page-head"><div><h1>클리닉 시험·성적표</h1>
      <div class="sub">여러 작품의 확정된 클리닉 문항을 묶어 한 장의 시험지를 만들고(예: 1~10 윤동주 · 11~20 백석 · 21~30 문법), OMR 답을 넣으면 자동 채점하고 학부모 발송용 성적표를 만듭니다.</div></div></div>
    <div class="grid2">
      <div class="card"><h2>새 클리닉 시험</h2>
        <form id="newExam" class="stack">
          <div><label class="f">시험 이름 *</label><input name="title" required placeholder="예: 10월 1주차 클리닉"></div>
          <div class="fields">
            <div><label class="f">날짜</label><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
            <div><label class="f">반</label><input name="className" placeholder="예: 고2 ○○고반"></div>
          </div>
          <div class="row end"><button class="btn">만들기</button></div>
        </form></div>
      <div class="card"><h2>순서</h2>
        <ol class="small" style="padding-left:18px;margin:0;line-height:1.9">
          <li>각 작품의 <b>생성 → 클리닉 테스트</b>에서 문항을 만들고 <b>검수·확정</b>합니다. (문항 수는 생성 카드에서 10문항 등으로 바꿀 수 있어요)</li>
          <li>여기서 시험을 만들고 <b>구성</b> 탭에서 작품을 순서대로 추가합니다.</li>
          <li><b>시험지</b>를 인쇄해 시험을 봅니다.</li>
          <li><b>채점</b> 탭에 OMR 결과(또는 엑셀 복사)를 붙여 넣습니다.</li>
          <li><b>성적표</b> 탭에서 코멘트를 만들고 고친 뒤 PDF로 저장해 보냅니다.</li>
        </ol></div>
    </div>
    <div class="card"><h2>시험 목록</h2>
      ${exams.length ? `<table class="t"><thead><tr><th>시험</th><th>날짜</th><th>반</th><th>파트</th><th>학생</th><th></th></tr></thead><tbody>
      ${exams.map((e) => `<tr><td><a href="#/exams/${e.id}"><b>${esc(e.title)}</b></a></td><td>${esc(e.date)}</td><td>${esc(e.className)}</td><td>${e.parts}</td><td>${e.students}</td>
        <td style="text-align:right"><button class="btn bad sm" data-delexam="${e.id}">삭제</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">아직 시험이 없습니다.</div>'}
    </div>`;
  document.getElementById('newExam').onsubmit = (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      const ex = await api('/api/exams', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      location.hash = `#/exams/${ex.id}`;
    });
  };
  $app.querySelectorAll('[data-delexam]').forEach((b) => (b.onclick = () => {
    if (!confirm('이 시험과 채점 결과·코멘트를 모두 삭제할까요?')) return;
    run(b, async () => { await api('/api/exams/' + b.dataset.delexam, { method: 'DELETE' }); render(); });
  }));
  void projects;
}

const EXAM_TABS = [['build', '① 구성'], ['paper', '② 시험지'], ['grade', '③ 채점 (OMR)'], ['report', '④ 성적표']];

async function renderExam(id, tab) {
  if (!state.exam || state.exam.id !== id) {
    state.exam = await api('/api/exams/' + id);
    state.sub.pasteResult = null;
    for (const j of state.exam.jobs || []) if (j.status === 'running' && !state.jobs.has('comments')) trackJob(j.id, 'comments', reloadExam);
  }
  const e = state.exam;
  const n = examQuestions(e).length;
  $app.innerHTML = `
    <div class="page-head"><div><h1>${esc(e.title)}</h1><div class="sub">${esc([e.date, e.className, `${e.parts.length}파트 · ${n}문항 · 학생 ${e.students.length}명`].filter(Boolean).join(' · '))}</div></div>
      <a class="btn ghost sm" href="#/exams">← 시험 목록</a></div>
    <div class="tabs">${EXAM_TABS.map(([k, l]) => `<a href="#/exams/${e.id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="tabBody"></div>`;
  const body = document.getElementById('tabBody');
  ({ build: examBuild, paper: examPaper, grade: examGrade, report: examReport }[tab] || examBuild)(body);
  updateJobViews();
}

async function reloadExam() {
  if (!state.exam) return;
  state.exam = await api('/api/exams/' + state.exam.id);
  render();
}

async function examCall(btn, path, opts) {
  return run(btn, async () => {
    const r = await api(`/api/exams/${state.exam.id}${path}`, opts);
    state.exam = r;
    render();
    return r;
  });
}

function examBuild(el) {
  const e = state.exam;
  const projects = state.projects;
  let start = 1;
  const graded = e.students.some((s) => (s.answers || []).some((a) => a != null));
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>시험 정보</h2></div>
      <form id="examInfo" class="fields">
        <div><label class="f">시험 이름</label><input name="title" value="${esc(e.title)}"></div>
        <div><label class="f">날짜</label><input name="date" type="date" value="${esc(e.date)}"></div>
        <div><label class="f">반</label><input name="className" value="${esc(e.className)}"></div>
        <div style="align-self:end"><button class="btn ghost">저장</button></div>
      </form>
    </div>
    ${graded ? '<div class="callout warn small">이미 채점한 학생이 있습니다. 파트를 바꾸면 같은 문항의 답은 새 번호로 옮겨지고, 새로 들어온 문항은 무응답이 됩니다.</div>' : ''}
    <div class="card">
      <div class="card-head"><h2>파트 (문항 번호 순서)</h2></div>
      ${e.parts.length ? e.parts.map((p, i) => {
        const from = start;
        start += p.questions.length;
        const skills = {};
        p.questions.forEach((q) => { skills[q.skill || '미지정'] = (skills[q.skill || '미지정'] || 0) + 1; });
        return `<div class="part-row">
          <div class="part-range">${from}~${start - 1}번</div>
          <div class="part-main"><b>${esc(p.label)}</b> <span class="badge">${esc(GENRES[p.genre]?.label || p.genre)}</span>
            <div class="small muted">확정 문항 ${p.available}개 중 ${p.questions.length}개 · 측정 능력: ${Object.entries(skills).map(([k, c]) => `${esc(k)} ${c}`).join(', ')}</div></div>
          <div class="row">
            <label class="small">문항 수 <input type="number" min="1" max="${p.available}" value="${p.questions.length}" data-pcount="${p.id}" style="width:64px"></label>
            <button class="btn ghost sm" data-pick="${p.id}">문항 고르기</button>
            <button class="btn ghost sm" data-refresh="${p.id}" title="작품에서 문항을 고쳤다면 눌러서 새로 불러오세요">새로 불러오기</button>
            <button class="btn ghost sm" data-move="${p.id}" data-dir="-1" ${i ? '' : 'disabled'}>▲</button>
            <button class="btn ghost sm" data-move="${p.id}" data-dir="1" ${i < e.parts.length - 1 ? '' : 'disabled'}>▼</button>
            <button class="btn bad sm" data-delpart="${p.id}">빼기</button>
          </div></div>`;
      }).join('') : '<div class="empty">아직 파트가 없습니다. 아래에서 작품을 추가하세요.</div>'}
      <form id="addPart" class="row" style="margin-top:14px">
        <select name="projectId" required style="flex:1">
          <option value="">작품 고르기 (확정된 클리닉 문항 수)</option>
          ${projects.map((p) => `<option value="${p.id}" ${p.clinicAccepted ? '' : 'disabled'}>[${esc(GENRES[p.genre]?.label || '시')}] ${esc(p.title)}${p.author ? ' · ' + esc(p.author) : ''} — ${p.clinicAccepted ? `확정 ${p.clinicAccepted}문항` : '확정 문항 없음'}</option>`).join('')}
        </select>
        <label class="small">문항 수 <input name="count" type="number" min="1" max="150" value="10" style="width:64px"></label>
        <button class="btn">파트 추가</button>
      </form>
      <p class="small muted" style="margin-top:8px">파트를 추가하면 그 순간의 문항을 복사해 둡니다. 작품 쪽 문항을 나중에 고쳤다면 <b>새로 불러오기</b>를 누르세요.</p>
    </div>`;
  el.querySelector('#examInfo').onsubmit = (ev) => {
    ev.preventDefault();
    examCall(ev.submitter, '', { method: 'PATCH', body: Object.fromEntries(new FormData(ev.target)) }).then((r) => r && toast('저장했습니다'));
  };
  el.querySelector('#addPart').onsubmit = (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target));
    examCall(ev.submitter, '/parts', { method: 'POST', body: { projectId: body.projectId, count: Number(body.count) } });
  };
  el.querySelectorAll('[data-pcount]').forEach((inp) => (inp.onchange = () => examCall(inp, `/parts/${inp.dataset.pcount}`, { method: 'PUT', body: { count: Number(inp.value) } })));
  el.querySelectorAll('[data-refresh]').forEach((b) => (b.onclick = () => {
    const p = e.parts.find((x) => x.id === b.dataset.refresh);
    examCall(b, `/parts/${p.id}`, { method: 'PUT', body: { questionIds: p.questions.map((q) => q.id) } }).then((r) => r && toast('작품의 최신 문항으로 바꿨습니다'));
  }));
  el.querySelectorAll('[data-move]').forEach((b) => (b.onclick = () => examCall(b, `/parts/${b.dataset.move}`, { method: 'PUT', body: { move: Number(b.dataset.dir) } })));
  el.querySelectorAll('[data-delpart]').forEach((b) => (b.onclick = () => {
    if (!confirm('이 파트를 시험에서 뺄까요? (작품 문항은 그대로 남습니다)')) return;
    examCall(b, `/parts/${b.dataset.delpart}`, { method: 'DELETE' });
  }));
  el.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => run(b, async () => {
    const part = e.parts.find((x) => x.id === b.dataset.pick);
    const proj = await api('/api/projects/' + part.projectId);
    const acc = (proj.sets?.clinic?.questions || []).filter((q) => q.decision === 'accepted');
    const chosen = new Set(part.questions.map((q) => q.id));
    modal(`${part.label} — 시험에 넣을 문항`, `
      <p class="small muted">체크한 문항이 체크 순서가 아니라 <b>원래 순서대로</b> 들어갑니다.</p>
      <div class="stack">${acc.map((q, i) => `<label class="pick-row"><input type="checkbox" value="${q.id}" ${chosen.has(q.id) ? 'checked' : ''}>
        <span><b>${i + 1}.</b> ${rich(q.stem, 'plain')} <span class="badge">${esc(q.skill || '미지정')}</span> <span class="badge">${esc(q.difficulty)}</span></span></label>`).join('')}</div>
      <div class="row end" style="margin-top:12px"><span class="small muted" id="pickCount"></span><button class="btn" id="pickSave">적용</button></div>`);
    const box = document.getElementById('modalBody');
    const count = () => { document.getElementById('pickCount').textContent = `${box.querySelectorAll('input:checked').length}문항 선택`; };
    box.querySelectorAll('input').forEach((i) => (i.onchange = count));
    count();
    document.getElementById('pickSave').onclick = (ev) => {
      const ids = [...box.querySelectorAll('input:checked')].map((i) => i.value);
      if (!ids.length) return toast('한 문항 이상 고르세요', true);
      document.getElementById('modal').hidden = true;
      examCall(ev.target, `/parts/${part.id}`, { method: 'PUT', body: { questionIds: ids } });
    };
  })));
}

function examPaper(el) {
  const e = state.exam;
  const docs = [
    ['exam', '시험지', '파트별 지문 + 문항 (번호가 이어짐)'],
    ['exam-answers', '정답·해설', '빠른 정답표 + 문항별 해설 · 측정 능력 표시'],
  ];
  el.innerHTML = e.parts.length ? `<div class="grid2">${docs.map(([k, t, d]) => `<div class="card">
      <h3>${t}</h3><p class="small muted">${d}</p>
      <div class="row"><a class="btn" href="/print.html?exam=${e.id}&doc=${k}" target="_blank">미리보기·인쇄</a><a class="btn ghost" href="/api/exams/${e.id}/pdf/${k}">PDF 저장</a></div></div>`).join('')}</div>`
    : '<div class="empty">먼저 <b>① 구성</b>에서 파트를 추가하세요.</div>';
}

function examGrade(el) {
  const e = state.exam;
  const g = gradeExam(e);
  const res = state.sub.pasteResult;
  el.innerHTML = !g.n ? '<div class="empty">먼저 <b>① 구성</b>에서 파트를 추가하세요.</div>' : `
    <div class="card">
      <div class="card-head"><h2>OMR 답 붙여 넣기</h2></div>
      <p class="small">한 줄에 한 학생. <b>이름 뒤에 답 ${g.n}개</b>를 적습니다. 띄어쓰기는 상관없고, 안 쓴 답은 <span class="kbd">0</span> 이나 <span class="kbd">-</span> 로 적으세요. 엑셀에서 (이름, 1번, 2번, …) 칸을 그대로 복사해 붙여도 됩니다. 같은 이름이 있으면 답을 덮어씁니다.</p>
      <textarea id="omrPaste" style="min-height:140px;font-family:ui-monospace,monospace" placeholder="홍길동 13524 21453 32145 ...\n김하나 1352421453321450..."></textarea>
      <div class="row end" style="margin-top:8px"><button class="btn" id="omrGo">채점하기</button></div>
      ${res ? `<div class="callout ${res.short.length ? 'warn' : 'ok'} small">${res.added}명 추가, ${res.updated}명 갱신.${res.short.length ? ` 답이 ${g.n}개보다 적은 학생: <b>${res.short.map(esc).join(', ')}</b> (빈 칸은 오답 처리됩니다)` : ''}</div>` : ''}
    </div>
    <div class="card">
      <div class="card-head"><h2>채점 결과</h2><span class="small muted">반 평균 ${g.classAvg.score ?? '-'} / ${g.n} · 최고 ${g.classAvg.max ?? '-'} · 최저 ${g.classAvg.min ?? '-'}</span></div>
      <div style="overflow-x:auto"><table class="t grade-t"><thead><tr><th>이름</th><th>점수</th><th>답 (고치면 바로 다시 채점)</th><th></th></tr></thead><tbody>
      ${g.students.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${s.graded ? `<b>${s.score}</b> / ${s.total}` : '<span class="muted">미입력</span>'}</td>
        <td><input class="ans-in" data-ans="${s.id}" value="${esc(answerString(s.answers))}"><div class="ox">${s.graded ? s.correct.map((c, i) => `<span class="${c ? 'o' : 'x'}" title="${i + 1}번 ${esc(g.questions[i].skill)}">${c ? 'O' : 'X'}</span>`).join('') : ''}</div></td>
        <td><button class="btn bad sm" data-delst="${s.id}">삭제</button></td></tr>`).join('')}
      </tbody></table></div>
      <form id="addSt" class="row" style="margin-top:10px"><input name="name" placeholder="학생 이름 추가" style="max-width:200px"><button class="btn ghost sm">추가</button></form>
    </div>
    ${g.gradedCount ? `<div class="card"><div class="card-head"><h2>문항 분석</h2><span class="small muted">정답률이 낮은 문항은 다음 수업에서 다시 다루세요</span></div>
      <table class="t"><thead><tr><th>번호</th><th>파트</th><th>측정 능력</th><th>정답</th><th>정답률</th><th>선택 분포 ①②③④⑤ 무응답</th></tr></thead><tbody>
      ${g.questions.map((q) => `<tr class="${q.rate < 50 ? 'low' : ''}"><td>${q.no}</td><td class="small">${esc(e.parts[q.partIndex].label)}</td><td class="small">${esc(q.skill)}</td><td>${CIRCLED[q.answer - 1] || '?'}</td>
        <td><div class="minibar" title="${q.rate}%"><i style="width:${q.rate}%"></i></div> ${q.rate}%</td>
        <td class="small">${q.dist.map((c, i) => `<span class="${i === q.answer - 1 ? 'dist-ok' : c ? 'dist-bad' : 'muted'}">${c}</span>`).join(' · ')}</td></tr>`).join('')}
      </tbody></table></div>` : ''}`;
  if (!g.n) return;
  el.querySelector('#omrGo').onclick = (ev) => {
    const text = el.querySelector('#omrPaste').value;
    if (!text.trim()) return toast('붙여 넣은 내용이 없습니다', true);
    examCall(ev.target, '/students/paste', { method: 'POST', body: { text } }).then((r) => { if (r) { state.sub.pasteResult = r.pasteResult; render(); } });
  };
  el.querySelectorAll('[data-ans]').forEach((inp) => (inp.onchange = () => examCall(inp, `/students/${inp.dataset.ans}`, { method: 'PUT', body: { answers: inp.value } })));
  el.querySelectorAll('[data-delst]').forEach((b) => (b.onclick = () => {
    if (!confirm('이 학생을 지울까요?')) return;
    examCall(b, `/students/${b.dataset.delst}`, { method: 'DELETE' });
  }));
  el.querySelector('#addSt').onsubmit = (ev) => {
    ev.preventDefault();
    examCall(ev.submitter, '/students', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) });
  };
}

function examReport(el) {
  const e = state.exam;
  const g = gradeExam(e);
  const graded = g.students.filter((s) => s.graded);
  const missing = graded.filter((s) => !s.comment).length;
  el.innerHTML = !graded.length ? '<div class="empty">먼저 <b>③ 채점</b>에서 학생 답을 넣으세요.</div>' : `
    <div class="card">
      <div class="row"><div><h2 style="margin:0">학부모 발송용 성적표</h2><div class="small muted">학생마다 A4 한 장: 점수 · 파트별/능력별 정답률(반 평균 표시) · 문항별 O/X · 보완할 능력 · 선생님 코멘트</div></div>
        <span class="spacer"></span>
        <button class="btn" id="draftAll" data-needidle="comments">${missing === graded.length ? '코멘트 만들기 (Claude)' : `코멘트 없는 ${missing}명만 만들기`}</button>
        ${missing < graded.length ? '<button class="btn ghost" id="redoAll" data-needidle="comments">전체 다시 만들기</button>' : ''}
        <a class="btn ghost" href="/print.html?exam=${e.id}&doc=report" target="_blank">전체 미리보기</a>
        <a class="btn ghost" href="/api/exams/${e.id}/pdf/report">전체 PDF</a>
        <a class="btn ghost" href="/api/exams/${e.id}/csv">엑셀(CSV)</a>
      </div>
      <div data-jobslot="comments"></div>
      <p class="small muted" style="margin:8px 0 0">코멘트 말투는 <a href="#/settings">설정</a>의 <b>학부모 코멘트 말투 예시</b>를 따릅니다. 비워 두면 기본 말투(차분하고 따뜻한 존댓말)로 씁니다.</p>
    </div>
    ${graded.map((s) => {
      const weak = weakSkills(s, g.classAvg);
      return `<div class="card rep-card">
        <div class="row"><h3 style="margin:0">${esc(s.name)}</h3><span class="badge acc">${s.score} / ${s.total}</span>
          ${weak.length ? `<span class="small">보완: ${weak.map((k) => `<span class="badge warn">${esc(k.skill)} ${k.rate}%</span>`).join(' ')}</span>` : '<span class="badge ok">뚜렷한 약점 없음</span>'}
          <span class="spacer"></span>
          <a class="btn ghost sm" href="/print.html?exam=${e.id}&doc=report&student=${s.id}" target="_blank">미리보기</a>
          <a class="btn ghost sm" href="/api/exams/${e.id}/pdf/report?student=${s.id}">PDF</a></div>
        <div class="rep-bars">${s.parts.map((p, i) => bar(p.title, p.rate, g.classAvg.parts[i])).join('')}</div>
        <label class="f" style="margin-top:8px">선생님의 코멘트</label>
        <textarea data-comment="${s.id}" style="min-height:90px" placeholder="코멘트 만들기를 누르거나 직접 쓰세요">${esc(s.comment)}</textarea>
        <div class="row end"><button class="btn ghost sm" data-redo="${s.id}" data-needidle="comments">이 학생만 다시 만들기</button><button class="btn sm" data-savec="${s.id}">코멘트 저장</button></div>
      </div>`;
    }).join('')}`;
  if (!graded.length) return;
  const draft = (btn, ids) => run(btn, async () => {
    const r = await api(`/api/exams/${e.id}/comments`, { method: 'POST', body: { studentIds: ids } });
    trackJob(r.jobId, 'comments', reloadExam);
    updateJobViews();
  });
  el.querySelector('#draftAll').onclick = (ev) => draft(ev.target, missing === graded.length ? [] : graded.filter((s) => !s.comment).map((s) => s.id));
  const redo = el.querySelector('#redoAll');
  if (redo) redo.onclick = (ev) => { if (confirm('직접 고친 코멘트도 모두 새로 씁니다. 계속할까요?')) draft(ev.target, []); };
  el.querySelectorAll('[data-redo]').forEach((b) => (b.onclick = () => draft(b, [b.dataset.redo])));
  el.querySelectorAll('[data-savec]').forEach((b) => (b.onclick = () => {
    const v = el.querySelector(`[data-comment="${b.dataset.savec}"]`).value;
    examCall(b, `/students/${b.dataset.savec}`, { method: 'PUT', body: { comment: v } }).then((r) => r && toast('저장했습니다'));
  }));
}

// 단일 막대 + 반 평균 눈금 (값은 글자로 함께 표시)
function bar(label, value, avg) {
  return `<div class="hbar" title="${esc(label)}: ${value ?? '-'}% (반 평균 ${avg ?? '-'}%)">
    <span class="hb-l">${esc(label)}</span>
    <span class="hb-track"><i style="width:${value || 0}%"></i>${avg != null ? `<b class="hb-avg" style="left:${avg}%"></b>` : ''}</span>
    <span class="hb-v">${value ?? '-'}%</span></div>`;
}
