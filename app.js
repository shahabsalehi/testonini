import { renderPdf } from './pdf.js';

/* ---------- State ---------- */
const LS_TEST = 'testonini.test';
const LS_ATTEMPT_PREFIX = 'testonini.attempt.';

let test = null;
let attempt = null; // { testHash, startedAt, answers: {qid: value}, flags: {qid: true}, current: index, submitted: bool }

function $(sel) { return document.querySelector(sel); }
function show(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('#' + screenId).classList.add('active');
}

function hashOf(obj) {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
}

/* ---------- Validator (shared contract with server.py MCP tool) ---------- */
function validateTest(t) {
  const errors = [];
  const nums = new Set();
  if (!t || typeof t !== 'object' || !Array.isArray(t.questions) || !t.questions.length) {
    return ['Test JSON must be an object with a non-empty "questions" array.'];
  }
  // A test with NO answers anywhere is a manual-marking test: answer checks skipped.
  // Mixed (some answered, some not) stays an error.
  const hasAnyAnswer = t.questions.some(q =>
    q.correctAnswer || Array.isArray(q.acceptedAnswers) ||
    (Array.isArray(q.prompts) && q.prompts.some(p => p.correctAnswer)));
  for (const q of t.questions) {
    const label = q.number != null ? 'Q' + q.number : q.id || '(no id)';
    if (q.number == null) errors.push(label + ': missing "number"');
    else {
      if (nums.has(q.number)) errors.push(label + ': duplicate question number');
      nums.add(q.number);
    }
    if (!q.type) errors.push(label + ': missing "type"');
    const hasSubs = Array.isArray(q.prompts) && q.prompts.length > 0;
    if (hasSubs) {
      if (hasAnyAnswer) q.prompts.forEach((p, i) => { if (!p.correctAnswer) errors.push(label + ' item ' + (i + 1) + ': missing correctAnswer'); });
      if (!Array.isArray(q.matchOptions) || !q.matchOptions.length) errors.push(label + ': matchOptions required for matching type');
    } else if (hasAnyAnswer && ['single_choice', 'multiple_choice', 'true_false', 'matching'].includes(q.type) && !q.correctAnswer) {
      errors.push(label + ': objective question missing "correctAnswer"');
    }
    if (hasAnyAnswer && q.type === 'text_input' && (!Array.isArray(q.acceptedAnswers) || !q.acceptedAnswers.length)) {
      errors.push(label + ': text_input requires "acceptedAnswers" array');
    }
    if (['single_choice', 'multiple_choice', 'true_false'].includes(q.type)) {
      if (!Array.isArray(q.options) || !q.options.length) {
        errors.push(label + ': options required');
      } else {
        const ids = q.options.map(o => o.id);
        [...ids].sort().forEach((id, i, a) => { if (i && a[i] === a[i - 1]) errors.push(label + ': duplicate option "' + id + '"'); });
      }
    }
  }
  return errors;
}

/* ---------- Attempt persistence ---------- */
function loadAttempt(hash) {
  const raw = localStorage.getItem(LS_ATTEMPT_PREFIX + hash);
  return raw ? JSON.parse(raw) : null;
}
function saveAttempt() {
  if (attempt && test) {
    localStorage.setItem(LS_ATTEMPT_PREFIX + attempt.testHash, JSON.stringify(attempt));
  }
}

/* ---------- Home ---------- */
function renderHome() {
  show('home-screen');
  const stored = localStorage.getItem(LS_TEST);
  const resumeBox = $('#resume-box');
  if (stored) {
    try {
      const t = JSON.parse(stored);
      resumeBox.style.display = 'flex';
      $('#stored-test-name').textContent = '📋 ' + t.title + ' (' + t.questions.length + ' questions)';
      const h = hashOf({ title: t.title, q: t.questions.map(q => q.number + ':' + (q.prompt || '') + ':' + q.type) });
      const prev = loadAttempt(h);
      $('#btn-continue').style.display = prev && !prev.submitted ? '' : 'none';
      $('#btn-restart').style.display = prev && prev.submitted ? '' : 'none';
    } catch { $('#stored-test-name').textContent = 'A stored test exists but could not be parsed.'; }
  } else {
    resumeBox.style.display = 'none';
  }
}

/* Poll tests/ for a newly saved matching test while intake status shows a file */
let pollTimer = null;
function pollForSavedTest(pdfName) {
  clearInterval(pollTimer);
  const wanted = pdfName.replace(/\.pdf$/i, '.json');
  pollTimer = setInterval(async () => {
    try {
      const r = await fetch('/tests/' + wanted);
      if (!r.ok) return;
      const t = await r.json();
      if (!t || !Array.isArray(t.questions)) return;
      clearInterval(pollTimer);
      setStatus('✅ Your AI saved <strong>' + wanted + '</strong> (' + t.questions.length +
        ' questions). Starting the exam…', 'ok');
      setTimeout(() => importJson(JSON.stringify(t)), 800);
    } catch { /* keep polling */ }
  }, 2500);
}

function importJson(text) {
  let t;
  try { t = JSON.parse(text); } catch (e) {
    $('#home-error').textContent = 'Invalid JSON: ' + e.message;
    return;
  }
  const errs = validateTest(t);
  if (errs.length) {
    $('#home-error').innerHTML = 'Validation failed:<br>' + errs.map(e => '• ' + esc(e)).join('<br>');
    return;
  }
  $('#home-error').textContent = '';
  t._hash = hashOf({ title: t.title, q: t.questions.map(q => q.number + ':' + (q.prompt || '') + ':' + q.type) });
  test = t;
  localStorage.setItem(LS_TEST, text);
  const prev = loadAttempt(t._hash);
  if (prev && !prev.submitted) {
    attempt = prev;
    startExam(false);
  } else {
    beginAttempt();
  }
}

function beginAttempt() {
  attempt = { testHash: test._hash, startedAt: Date.now(), answers: {}, flags: {}, current: 0, submitted: false };
  saveAttempt();
  startExam(true);
}

/* ---------- Exam shell ---------- */
let timerHandle = null;

function startExam(resetRender) {
  show('exam-screen');
  $('#exam-title').textContent = test.title;
  const hasPdf = !!test.sourcePdf;
  $('#pane-pdf').style.display = hasPdf ? '' : 'none';
  $('#pane-questions').style.width = hasPdf ? '' : '100%';
  if (hasPdf) renderPdf($('#pdfViewer'), test.sourcePdf);
  renderFooterNav();
  renderCurrent(resetRender);
  startTimer();
}

function startTimer() {
  clearInterval(timerHandle);
  const limit = (test.timeLimitSeconds || 3600) * 1000;
  updateTimer();
  timerHandle = setInterval(updateTimer, 1000);
  function updateTimer() {
    const remain = limit - (Date.now() - attempt.startedAt);
    const chip = $('#timer');
    if (remain <= 0) {
      chip.textContent = '0:00';
      chip.classList.add('low');
      clearInterval(timerHandle);
      submitExam();
      return;
    }
    if (remain < 5 * 60 * 1000) chip.classList.add('low');
    const s = Math.floor(remain / 1000);
    chip.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
}

function isAnswered(q) {
  const a = attempt.answers[q.id];
  if (Array.isArray(q.prompts)) return q.prompts.every(p => attempt.answers[q.id + ':' + p.id] != null && attempt.answers[q.id + ':' + p.id] !== '');
  return a != null && a !== '' && !(Array.isArray(a) && a.length === 0);
}

function renderFooterNav() {
  const pal = $('#question-palette');
  pal.innerHTML = '';
  test.questions.forEach((q, i) => {
    const b = document.createElement('button');
    b.className = 'palette-btn';
    b.textContent = q.number;
    if (isAnswered(q)) b.classList.add('answered');
    if (attempt.flags[q.id]) b.classList.add('flagged');
    if (i === attempt.current) b.classList.add('current');
    b.addEventListener('click', () => { attempt.current = i; go(); });
    pal.appendChild(b);
  });
}

function updatePalette() {
  const pal = $('#question-palette');
  test.questions.forEach((q, i) => {
    const b = pal.children[i];
    if (!b) return;
    b.classList.toggle('answered', isAnswered(q));
    b.classList.toggle('flagged', !!attempt.flags[q.id]);
    b.classList.toggle('current', i === attempt.current);
  });
}

function go() {
  renderFooterNav();
  renderCurrent();
  saveAttempt();
}
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

function renderCurrent() {
  const q = test.questions[attempt.current];
  const box = $('#question-box');
  $('#btn-prev').disabled = attempt.current === 0;
  $('#btn-next').disabled = attempt.current === test.questions.length - 1;
  $('#btn-flag').classList.toggle('flag-active', !!attempt.flags[q.id]);
  $('#btn-flag').textContent = (attempt.flags[q.id] ? '⚑ Flagged' : '⚑ Flag');

  let html = '<div class="question-card">';
  html += '<div class="question-number">Question ' + q.number + '</div>';
  if (q.instruction) html += '<div class="question-instruction">' + esc(q.instruction) + '</div>';
  if (q.prompt) html += '<p class="question-prompt">' + esc(q.prompt) + '</p>';
  html += '<div class="question-body"></div></div>';
  box.innerHTML = html;
  const body = box.querySelector('.question-body');

  const setAnswer = (key, val) => { attempt.answers[key] = val; updatePalette(); saveAttempt(); };

  if (q.type === 'single_choice' || q.type === 'true_false') {
    q.options.forEach(o => {
      const row = document.createElement('label');
      row.className = 'option-row';
      row.innerHTML = '<input type="radio" name="' + q.id + '"' + (attempt.answers[q.id] === o.id ? ' checked' : '') + '>' +
        '<span class="option-id">' + esc(o.id) + '.</span><span>' + esc(o.text) + '</span>';
      row.querySelector('input').addEventListener('change', () => setAnswer(q.id, o.id));
      body.appendChild(row);
    });
  } else if (q.type === 'multiple_choice') {
    const sel = new Set(attempt.answers[q.id] || []);
    q.options.forEach(o => {
      const row = document.createElement('label');
      row.className = 'option-row';
      row.innerHTML = '<input type="checkbox"' + (sel.has(o.id) ? ' checked' : '') + '>' +
        '<span class="option-id">' + esc(o.id) + '.</span><span>' + esc(o.text) + '</span>';
      row.querySelector('input').addEventListener('change', ev => {
        ev.target.checked ? sel.add(o.id) : sel.delete(o.id);
        setAnswer(q.id, [...sel]);
      });
      body.appendChild(row);
    });
  } else if (q.type === 'text_input') {
    const input = document.createElement('input');
    input.className = 'text-input';
    input.value = attempt.answers[q.id] || '';
    input.addEventListener('input', () => setAnswer(q.id, input.value));
    body.appendChild(input);
  } else if (q.type === 'matching') {
    q.prompts.forEach(p => {
      const row = document.createElement('div');
      row.className = 'match-row';
      const opts = q.matchOptions.map(o => '<option value="' + esc(o.id) + '"' + (attempt.answers[q.id + ':' + p.id] === o.id ? ' selected' : '') + '>' + esc(o.id) + ' — ' + esc(o.text) + '</option>').join('');
      row.innerHTML = '<span class="option-id">' + esc(p.id) + '.</span><span style="flex:1">' + esc(p.text) + '</span>' +
        '<select><option value="">—</option>' + opts + '</select>';
      row.querySelector('select').addEventListener('change', ev => setAnswer(q.id + ':' + p.id, ev.target.value));
      body.appendChild(row);
    });
  } else if (q.type === 'long_text') {
    const wrap = document.createElement('div');
    wrap.className = 'writing-area';
    wrap.innerHTML = '<textarea></textarea><span class="word-count"></span>';
    const ta = wrap.querySelector('textarea');
    const wc = wrap.querySelector('.word-count');
    const count = () => {
      const n = (ta.value.trim().match(/\S+/g) || []).length;
      wc.textContent = n + ' words';
      const ok = (!q.minWords || n >= q.minWords) && (!q.maxWords || n <= q.maxWords);
      wc.classList.toggle('ok', ok && n > 0);
    };
    ta.value = attempt.answers[q.id] || '';
    ta.addEventListener('input', () => { setAnswer(q.id, ta.value); count(); });
    count();
    body.appendChild(wrap);
  }
}

$('#btn-prev').addEventListener('click', () => { attempt.current--; go(); });
$('#btn-next').addEventListener('click', () => { attempt.current++; go(); });
$('#btn-flag').addEventListener('click', () => {
  const q = test.questions[attempt.current];
  attempt.flags[q.id] = !attempt.flags[q.id];
  $('#btn-flag').classList.toggle('flag-active', !!attempt.flags[q.id]);
  $('#btn-flag').textContent = attempt.flags[q.id] ? '⚑ Flagged' : '⚑ Flag';
  updatePalette();
  saveAttempt();
});

/* ---------- Review + submit ---------- */
$('#btn-finish').addEventListener('click', () => {
  const answered = test.questions.filter(isAnswered).length;
  const flagged = Object.keys(attempt.flags).filter(k => attempt.flags[k]).length;
  $('#review-answered').textContent = answered;
  $('#review-unanswered').textContent = test.questions.length - answered;
  $('#review-flagged').textContent = flagged;
  show('review-screen');
});

$('#btn-back-to-exam').addEventListener('click', () => show('exam-screen'));
$('#btn-submit').addEventListener('click', submitExam);

/* ---------- Scoring ---------- */
function norm(s) { return String(s).trim().toLowerCase().replace(/\s+/g, ' '); }

function scoreQuestion(q) {
  if (q.type === 'long_text') return { correct: null, given: attempt.answers[q.id] || '' };
  if (Array.isArray(q.prompts)) { // matching
    if (!q.prompts.some(p => p.correctAnswer)) return { correct: null, given: q.prompts.map(p => attempt.answers[q.id + ':' + p.id] || '—').join(', ') };
    const wrong = q.prompts.filter(p => attempt.answers[q.id + ':' + p.id] !== p.correctAnswer);
    return { correct: wrong.length === 0, given: q.prompts.map(p => attempt.answers[q.id + ':' + p.id] || '—').join(', ') };
  }
  const given = attempt.answers[q.id];
  if (q.type === 'text_input') {
    if (!Array.isArray(q.acceptedAnswers)) return { correct: null, given: given || '' }; // no answer key: manual check
    const ok = given != null && q.acceptedAnswers.some(a => norm(a) === norm(given));
    return { correct: ok, given: given || '' };
  }
  if (q.correctAnswer == null) return { correct: null, given: given || '' }; // no answer key
  const correctSet = new Set([].concat(q.correctAnswer));
  const givenSet = new Set([].concat(given || []));
  if (givenSet.size !== correctSet.size) return { correct: false, given: [...givenSet].join(', ') };
  for (const g of givenSet) if (!correctSet.has(g)) return { correct: false, given: [...givenSet].join(', ') };
  return { correct: true, given: [...givenSet].join(', ') };
}

function submitExam() {
  if (attempt.submitted) return;
  clearInterval(timerHandle);
  attempt.submitted = true;
  saveAttempt();
  const total = test.questions.filter(q => q.points > 0).reduce((s, q) => s + q.points, 0);
  const results = test.questions.map(q => ({ q, ...scoreQuestion(q) }));
  const earned = results.filter(r => r.correct === true).reduce((s, r) => s + r.q.points, 0);
  $('#results-score').textContent = earned + ' / ' + total;

  const list = $('#results-list');
  list.innerHTML = '';
  results.forEach(({ q, correct, given }) => {
    const row = document.createElement('div');
    const correctText = Array.isArray(q.prompts) ? q.prompts.map(p => p.correctAnswer).join(', ')
      : q.type === 'long_text' ? '(self-marked)'
      : [].concat(q.correctAnswer).join(', ');
    const verdict = correct === null ? 'manual' : correct ? '✓' : '✗';
    row.className = 'result-row ' + (correct === null ? '' : correct ? 'correct' : 'incorrect');
    row.dataset.verdict = verdict;
    row.innerHTML = '<span class="verdict">' + verdict + '</span>' +
      '<span style="flex:1"><strong>Q' + q.number + '.</strong> ' + esc(q.prompt || '') +
      '<br><small>Your answer: ' + esc(given || '—') +
      (correct === false ? ' · Correct: ' + esc(correctText) : '') + '</small></span>';
    list.appendChild(row);
  });
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary';
  btn.textContent = '⤓ Download results PDF';
  btn.addEventListener('click', () => {
    const payload = {
      title: test.title,
      score: $('#results-score').textContent + ' (scored automatically)' +
        (results.some(r => r.correct === null) ? ' + manual-check items below' : ''),
      rows: results.map(({ q, correct, given }) => ({
        number: q.number,
        given: given || '—',
        correctAnswer: (Array.isArray(q.prompts) ? q.prompts.map(p => p.correctAnswer || '?').join(', ')
          : q.type === 'long_text' ? '—'
          : q.correctAnswer != null ? [].concat(q.correctAnswer).join(', ') : '?'),
        verdict: correct === null ? 'MANUAL CHECK' : correct ? 'RIGHT' : 'WRONG'
      }))
    };
    fetch('/export-results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(b => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = (test.title || 'results').replace(/[^\w -]/g, '') + '-results.pdf';
        a.click();
      })
      .catch(e => alert('PDF export failed: ' + e.message));
  });
  $('#results-panel-actions').replaceChildren(btn);
  show('results-screen');
}


/* ---------- Wire-up ---------- */
$('#file-import').addEventListener('change', ev => {
  const f = ev.target.files[0];
  if (!f) return;
  f.text().then(importJson);
});
$('#btn-continue').addEventListener('click', () => {
  const raw = localStorage.getItem(LS_TEST);
  if (raw) importJson(raw);
});
$('#btn-restart').addEventListener('click', () => {
  if (test) beginAttempt();
});
$('#btn-review-results').addEventListener('click', renderHome);

/* ---------- PDF intake (Step 1 + 2 pipeline) ---------- */
const $status = $('#intake-status');

function setStatus(html, cls) {
  $status.innerHTML = html;
  $status.className = 'intake-status' + (cls ? ' ' + cls : '');
  $status.style.display = 'block';
}

async function intakeFile(file) {
  setStatus('⏳ Uploading <strong>' + esc(file.name) + '</strong>… — text-based files convert instantly; scans take ~20s for OCR.');
  const fd = new FormData();
  fd.append('file', file);
  let res;
  try {
    res = await fetch('/upload-doc', { method: 'POST', body: fd });
  } catch (e) {
    setStatus('✗ Upload failed: ' + esc(e.message) + ' — is the server running?', 'err');
    return;
  }
  if (!res.ok) {
    const txt = await res.text();
    setStatus('✗ Intake failed (' + res.status + '): ' + esc(txt), 'err');
    return;
  }
  const d = await res.json();
  if (d.status === 'text') {
    setStatus('✓ <strong>' + esc(d.file) + '</strong> — text extracted (' + d.markdown.length + ' chars). ' +
      'Your AI can build the test from it: paste the prompt from "Ask your AI" (right) into your AI. ' +
      'When it finishes (save_test), the exam starts here automatically.', 'ok');
    pollForSavedTest(d.file);
  } else if (d.status === 'scanned-ocr') {
    setStatus('✓ <strong>' + esc(d.file) + '</strong> — scanned PDF, OCR-d locally (' + d.pageCount + ' pages, ' +
      Object.keys(d.ocrTextByPage).length + ' readable). Paste the "Ask your AI" prompt (right) into your AI: ' +
      'it will use the OCR text, and can read the original pages at ' +
      '<a href="' + d.servesAt + '" target="_blank" rel="noopener">this link</a> for better fidelity. ' +
      'When it calls save_test, the exam starts here automatically.', 'ocr');
    pollForSavedTest(d.file);
  } else {
    setStatus('✗ Could not parse: ' + esc(d.error || 'unknown error'), 'err');
  }
}

$('#file-pdf').addEventListener('change', ev => {
  const f = ev.target.files[0];
  if (f) intakeFile(f);
});

const dz = $('#drop-zone');
['dragover', 'dragenter'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
dz.addEventListener('drop', e => {
  const f = e.dataTransfer.files[0];
  if (f) intakeFile(f);
});

renderHome();