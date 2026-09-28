import { esc, rich, CIRCLED, liveQuestions } from './shared.js';

const params = new URLSearchParams(location.search);
const projectId = params.get('project');
const docKind = params.get('doc');
const draft = params.get('draft') === '1';
const $doc = document.getElementById('doc');

const DOC_NAMES = {
  teacher: '교사용 교안', student: '학생용 교안', 'student-key': '학생용 교안 (정답본)',
  clinic: '클리닉 테스트', 'clinic-answers': '클리닉 테스트 정답·해설',
  homework: '과제물', 'homework-answers': '과제물 정답·해설',
};

function tint(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `rgb(${r}, ${g}, ${b})`;
}

function masthead(p, settings, kind, badgeText, idbox) {
  const kicker = [settings.academyName, DOC_NAMES[kind]].filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join('');
  const meta = [p.author, [p.school, p.grade].filter(Boolean).join(' '), p.examNote].filter(Boolean).map(esc).join('  ·  ');
  return `<header class="masthead">
    <div><div class="kicker">${kicker}</div>
      <h1>${esc(p.title)}${badgeText ? `<small>${esc(badgeText)}</small>` : ''}</h1>
      <div class="meta">${meta}${settings.teacherName ? `  ·  ${esc(settings.teacherName)}` : ''}</div></div>
    ${idbox ? `<div class="idbox">${idbox.map(([k, v]) => `<div>${esc(k)}</div><div>${v}</div>`).join('')}</div>` : ''}
  </header>`;
}

function poemBox(p, text) {
  const body = (text || p.poem || '').trim();
  if (!body) return '';
  const stanzas = body.split(/\n\s*\n/);
  const lines = body.split('\n').filter((l) => l.trim()).length;
  return `<div class="poem-box">
    <div class="poem-title">${esc(p.title)}<span class="author">${esc(p.author || '')}</span></div>
    <div class="poem ${lines > 14 ? '' : 'one'}">${stanzas.map((s) => `<span class="stanza">${rich(s.trim())}</span>`).join('')}</div>
  </div>`;
}

function questionItem(q, no) {
  return `<div class="qi">
    <div class="stem"><span class="num">${no}.</span><span>${rich(q.stem)}</span></div>
    ${q.extraPassage ? `<div class="box extra">${rich(q.extraPassage)}</div>` : ''}
    ${q.bogi ? `<div class="box bogi"><span class="lbl">&lt;보기&gt;</span>${rich(q.bogi)}</div>` : ''}
    <ol>${q.choices.map((c, i) => `<li><span>${CIRCLED[i]}</span><span>${rich(c)}</span></li>`).join('')}</ol>
  </div>`;
}

function renderTest(p, settings, setKey) {
  const set = p.sets[setKey];
  const qs = liveQuestions(set).filter((q) => draft || q.decision === 'accepted');
  const sectionSize = setKey === 'homework' ? 25 : qs.length;
  const sections = [];
  for (let i = 0; i < qs.length; i += sectionSize) sections.push(qs.slice(i, i + sectionSize).map((q, j) => [q, i + j + 1]));
  const hasPoem = Boolean((set.markedPoem || p.poem || '').trim());
  return `
    ${masthead(p, settings, setKey, `${qs.length}문항`, [['이름', ''], ['반 / 번호', ''], ['점수', `<span style="float:right">/ ${qs.length}</span>`]])}
    <div class="instructions"><span>※ 모든 문항은 <b>5지선다형</b>입니다.</span><span>※ 정답 하나를 골라 번호에 ○ 하세요.</span></div>
    ${sections.map((sec, si) => {
      const from = sec[0][1];
      const to = sec[sec.length - 1][1];
      return `<section ${si ? 'style="break-before:page"' : ''}>
        ${hasPoem ? `<div class="passage-head"><span class="range">${from}~${to}</span>다음 시를 읽고 물음에 답하시오.</div>${poemBox(p, set.markedPoem)}` : ''}
        <div class="qcols">${sec.map(([q, n]) => questionItem(q, n)).join('')}</div>
      </section>`;
    }).join('')}
    <div class="foot-note"><span>${esc(settings.academyName || '')}</span><span>${esc(p.title)} · ${esc(DOC_NAMES[setKey])}</span></div>`;
}

function renderAnswers(p, settings, setKey) {
  const set = p.sets[setKey];
  const qs = liveQuestions(set).filter((q) => draft || q.decision === 'accepted');
  const rows = [];
  for (let i = 0; i < qs.length; i += 10) rows.push(qs.slice(i, i + 10).map((q, j) => [q, i + j + 1]));
  return `
    ${masthead(p, settings, setKey + '-answers', '정답·해설')}
    <div class="h2">빠른 정답</div>
    <table class="quick">${rows.map((r) => `<tr>${r.map(([, n]) => `<th>${n}</th>`).join('')}${'<th></th>'.repeat(10 - r.length)}</tr>
      <tr>${r.map(([q]) => `<td>${CIRCLED[q.answer - 1] || '?'}</td>`).join('')}${'<td></td>'.repeat(10 - r.length)}</tr>`).join('')}</table>
    <div class="h2">해설</div>
    <div class="expl">${qs.map((q, i) => `<div class="ex">
      <div class="top"><span class="n">${i + 1}</span><span class="a">${q.answer >= 1 && q.answer <= 5 ? q.answer : '?'}</span><span class="t">${esc(q.type)} · ${esc(q.difficulty)}</span></div>
      <div class="body">${rich(q.explanation)}</div></div>`).join('')}</div>`;
}

function renderLesson(p, settings, kind) {
  const srcKind = kind === 'student-key' ? 'student' : kind;
  const doc = p.docs[srcKind];
  const c = doc.content;
  const mode = kind === 'student' ? 'blank' : 'answer';
  const student = srcKind === 'student';
  // 학생용에서는 "(필기 N3)" 같은 근거 표시를 뺀다
  const clean = (s) => (student ? String(s ?? '').replace(/\s*\(필기\s*N\d+(?:\s*[,·]\s*N\d+)*\)/g, '') : s);
  const r = (s) => rich(clean(s), mode);
  let no = 0;
  const sec = (s) => {
    no++;
    let body;
    switch (s.kind) {
      case 'overview':
        body = `<div class="dl">${s.items.map((it) => `<div>${r(it.label)}</div><div>${r(it.text)}</div>`).join('')}</div>`;
        break;
      case 'flow':
        body = `<div class="flow">${s.items.map((it) => `<div class="st"><b>${r(it.label)}</b><div>${r(it.text)}</div></div>`).join('')}</div>`;
        break;
      case 'lines':
      case 'poem':
        body = `<table class="lines">${s.items.map((it) => `<tr><td class="src">${r(it.label)}</td><td>${r(it.text)}</td>${student ? '<td class="memo"></td>' : ''}</tr>`).join('')}</table>`;
        break;
      case 'board':
        body = `<div class="board">${s.items.map((it) => `${it.label ? `<div class="bl">${r(it.label)}</div>` : ''}<div>${r(it.text)}</div>`).join('')}</div>`;
        break;
      case 'questions':
        body = s.items.map((it) => `<div class="qa"><div class="qq">${r(it.label)}</div><div class="aa">${r(it.text)}</div></div>`).join('');
        break;
      case 'check':
        body = `<div class="check">${s.items.map((it, i) => `<div class="ci"><span class="cn">${i + 1}</span><div>${r(it.label)}${kind !== 'student' ? `<div class="ans">정답: ${r(it.text)}</div>` : ''}</div></div>`).join('')}</div>`;
        break;
      case 'summary':
        body = `<div class="summary plist">${s.items.map((it) => `<div class="pi"><span class="pl">${r(it.label)}</span><span>${r(it.text)}</span></div>`).join('')}</div>`;
        break;
      default:
        body = `<div class="plist">${s.items.map((it) => `<div class="pi"><span class="pl">${r(it.label)}</span><span>${r(it.text)}</span></div>`).join('')}</div>`;
    }
    return `<section class="sec"><div class="sec-h"><span class="no">${String(no).padStart(2, '0')}</span><h2>${esc(s.heading)}</h2></div>${body}</section>`;
  };
  const checks = student && kind === 'student' ? c.sections.filter((s) => s.kind === 'check') : [];
  return `
    ${masthead(p, settings, kind, student ? '학생용' : '교사용', student ? [['이름', ''], ['반 / 번호', '']] : null)}
    ${c.subtitle ? `<div class="instructions"><span>${esc(c.subtitle)}</span></div>` : ''}
    ${poemBox(p)}
    ${c.sections.filter((s) => s.kind !== 'poem' || !p.poem).map(sec).join('')}
    ${checks.length ? `<section class="answer-key"><div class="sec-h"><span class="no">✓</span><h2>확인 문제 정답</h2></div>
      <div class="check">${checks.flatMap((s) => s.items).map((it, i) => `<div class="ci"><span class="cn">${i + 1}</span><div>${rich(clean(it.text), 'answer')}</div></div>`).join('')}</div></section>` : ''}
    <div class="foot-note"><span>${esc(settings.academyName || '')}</span><span>${esc(p.title)} · ${esc(DOC_NAMES[kind])}</span></div>`;
}

async function main() {
  const [p, settings] = await Promise.all([
    fetch('/api/projects/' + projectId).then((r) => r.json()),
    fetch('/api/settings').then((r) => r.json()),
  ]);
  if (p.error) throw new Error(p.error);
  document.title = `${p.title} - ${DOC_NAMES[docKind] || docKind}`;
  document.getElementById('tbTitle').textContent = document.title + (draft ? ' (검수 전 초안)' : '');
  const acc = /^#[0-9a-f]{6}$/i.test(settings.accent) ? settings.accent : '#1f4e79';
  document.documentElement.style.setProperty('--acc', acc);
  document.documentElement.style.setProperty('--acc-2', tint(acc, 0.9));
  const pageStyle = document.createElement('style');
  pageStyle.textContent = `@page { @bottom-left { content: "${(settings.academyName || '').replace(/["\\]/g, '')}"; font-family: 'Pretendard Variable', sans-serif; font-size: 8pt; color: #8b8e96; } }`;
  document.head.appendChild(pageStyle);

  let html;
  if (docKind === 'clinic' || docKind === 'homework') html = renderTest(p, settings, docKind);
  else if (docKind === 'clinic-answers' || docKind === 'homework-answers') html = renderAnswers(p, settings, docKind.replace('-answers', ''));
  else if (['teacher', 'student', 'student-key'].includes(docKind)) html = renderLesson(p, settings, docKind);
  else throw new Error('알 수 없는 문서 종류');
  $doc.innerHTML = (draft ? '<div class="draft-mark">검수 전 초안</div>' : '') + html;

  const compact = document.getElementById('tbCompact');
  compact.onchange = () => document.body.classList.toggle('compact', compact.checked);
  await document.fonts.ready;
  window.__PRINT_READY = true;
}

main().catch((err) => {
  $doc.innerHTML = `<p style="color:#b3261e">인쇄 화면을 만들지 못했습니다: ${esc(err.message)}</p>`;
  window.__PRINT_READY = true;
});
