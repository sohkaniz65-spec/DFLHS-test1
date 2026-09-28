import { esc, rich, CIRCLED, liveQuestions, splitPoem, teacherView } from './shared.js';

const params = new URLSearchParams(location.search);
const projectId = params.get('project');
const docKind = params.get('doc');
const draft = params.get('draft') === '1';
const $doc = document.getElementById('doc');

const DOC_NAMES = {
  teacher: '교사용 교안', student: '학생용 교안',
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

// 학생용: 시 전문 + 넓은 행간 (수업 중 필기용). 생성 과정 없이 원문만으로 만든다.
function renderStudent(p, settings) {
  const gap = { normal: 9, wide: 14, wider: 20 }[params.get('gap') || 'wide'] || 14;
  const lines = splitPoem(p.poem);
  if (!lines.length) throw new Error('작품 원문이 비어 있습니다. 작품·자료 탭에서 원문을 저장하세요.');
  return `
    ${masthead(p, settings, 'student', '학생용', [['이름', ''], ['반 / 번호', '']])}
    <div class="stu-poem" style="--gap:${gap}mm">
      <div class="stu-title">${esc(p.title)}<span class="author">${esc(p.author || '')}</span></div>
      ${lines.map((l) => `${l.stanzaBreak ? '<div class="stu-stanza"></div>' : ''}<div class="stu-line"><span class="ln">${l.lineNo}</span><span class="tx">${rich(l.text, 'plain')}</span></div>`).join('')}
    </div>
    <div class="foot-note"><span>${esc(settings.academyName || '')}</span><span>${esc(p.title)} · 학생용 교안</span></div>`;
}

// 교사용: 시구 옆에 자료(자습서) 필기 + 학교 필기(빨간색)
function renderTeacher(p, settings) {
  const v = teacherView(p);
  const school = (s) => `<li class="sc">${s.examPoint ? '<b>★</b> ' : ''}${s.showTarget ? `<b>‘${esc(s.target)}’</b> ` : ''}${esc(s.text)}</li>`;
  const mat = (n) => `<li>${rich(n.text)}</li>`;
  return `
    ${masthead(p, settings, 'teacher', '교사용')}
    <div class="legend"><span><i class="k-sc"></i>학교 필기</span><span><i class="k-mt"></i>자습서·자료 정리</span></div>
    ${v.overview.length ? `<section class="sec"><div class="sec-h"><span class="no">01</span><h2>작품 개관</h2></div>
      <div class="dl">${v.overview.map((o) => `<div>${esc(o.label)}</div><div>${rich(o.text)}</div>`).join('')}</div></section>` : ''}
    <section class="sec"><div class="sec-h"><span class="no">02</span><h2>시구별 필기</h2></div>
      <div class="tp">${v.rows.map((r) => `${r.stanzaBreak ? '<div class="tp-stanza"></div>' : ''}
        <div class="tp-row"><div class="tp-line"><span class="ln">${r.lineNo}</span>${esc(r.text)}</div>
          <ul class="tp-notes">${r.school.map(school).join('')}${r.material.map(mat).join('')}</ul></div>`).join('')}</div>
    </section>
    ${v.schoolGeneral.length || v.general.length ? `<section class="sec"><div class="sec-h"><span class="no">03</span><h2>작품 전체</h2></div>
      <ul class="tp-notes wide">${v.schoolGeneral.map(school).join('')}${v.general.map((g) => `<li>${g.label ? `<b>${esc(g.label)}</b> ` : ''}${rich(g.text)}</li>`).join('')}</ul></section>` : ''}
    <div class="foot-note"><span>${esc(settings.academyName || '')}</span><span>${esc(p.title)} · 교사용 교안</span></div>`;
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
  else if (docKind === 'teacher') html = renderTeacher(p, settings);
  else if (docKind === 'student') html = renderStudent(p, settings);
  else throw new Error('알 수 없는 문서 종류');
  $doc.innerHTML = (draft ? '<div class="draft-mark">검수 전 초안</div>' : '') + html;

  const compact = document.getElementById('tbCompact');
  compact.onchange = () => document.body.classList.toggle('compact', compact.checked);
  if (docKind === 'student') {
    compact.parentElement.outerHTML = `<label>행간 <select id="tbGap"><option value="normal">보통</option><option value="wide">넓게</option><option value="wider">아주 넓게</option></select></label>`;
    const gapSel = document.getElementById('tbGap');
    gapSel.value = params.get('gap') || 'wide';
    gapSel.onchange = () => { params.set('gap', gapSel.value); location.search = params.toString(); };
  }
  await document.fonts.ready;
  window.__PRINT_READY = true;
}

main().catch((err) => {
  $doc.innerHTML = `<p style="color:#b3261e">인쇄 화면을 만들지 못했습니다: ${esc(err.message)}</p>`;
  window.__PRINT_READY = true;
});
