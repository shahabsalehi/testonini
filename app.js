import { renderPdf } from './pdf.js';

/* ---------- State ---------- */
const LS_TEST = 'testonini.test';
const LS_ATTEMPT_PREFIX = 'testonini.attempt.';

let test = null;      // the working test object; the setup screen may replace this with a subset view
let attempt = null; // { testHash, startedAt, answers, flags, current, submitted }
const tabId = Math.random().toString(36).slice(2, 10);

function $(sel) { return document.querySelector(sel); }
function show(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('#' + screenId).classList.add('active');
}

/* DOM helpers — untrusted strings never reach innerHTML */
function el(tag, attrs = {}, text = null) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'checked' || k === 'selected' || k === 'disabled') n[k] = !!v;
    else if (v != null) n.setAttribute(k, String(v));
  }
  if (text != null) n.textContent = text;
  return n;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/* Stable attempt identity: SHA-256 of the full canonical test. */
async function hashOf(obj) {
  const s = JSON.stringify(obj);
  if (window.crypto && crypto.subtle && window.isSecureContext) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }
  let h1 = 5381, h2 = 52711; // two independent 32-bit FNV-ish lanes as a weak fallback
  for (let i = 0; i < s.length; i++) {
    h1 = ((h1 << 5) + h1 + s.charCodeAt(i)) | 0;
    h2 = ((h2 << 7) + h2 ^ s.charCodeAt(i)) | 0;
  }
  return 'd' + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/* ---------- Validator (mirrors server.validate_test — keep in sync) ---------- */
const VALID_TYPES = ['single_choice', 'multiple_choice', 'true_false', 'text_input', 'matching', 'long_text'];

function validateTest(t) {
  const errors = [];
  if (!t || typeof t !== 'object' || !Array.isArray(t.questions) || !t.questions.length) {
    return ['Test JSON must be an object with a non-empty "questions" array.'];
  }
  const nums = new Set(), ids = new Set();
  const hasAnyAnswer = t.questions.some(q =>
    q.correctAnswer || (Array.isArray(q.acceptedAnswers) && q.acceptedAnswers.length) ||
    (Array.isArray(q.prompts) && q.prompts.some(p => p.correctAnswer)));
  for (const q of t.questions) {
    const label = Number.isInteger(q.number) ? 'Q' + q.number : (typeof q.id === 'string' ? q.id : '(no id)');
    if (!Number.isInteger(q.number)) errors.push(label + ': "number" must be an integer');
    else if (nums.has(q.number)) errors.push('Q' + q.number + ': duplicate question number');
    else nums.add(q.number);
    if (!VALID_TYPES.includes(q.type)) errors.push(label + (q.type ? ': unknown type "' + q.type + '"' : ': missing "type"'));
    if (typeof q.id === 'string' && q.id) {
      if (ids.has(q.id)) errors.push(label + ': duplicate id "' + q.id + '"');
      ids.add(q.id);
    }
    const subs = Array.isArray(q.prompts) ? q.prompts : null;
    const hasSubs = !!(subs && subs.length);
    if (!q.prompt && !hasSubs) errors.push(label + ': missing "prompt"');
    if (hasSubs) {
      if (hasAnyAnswer) subs.forEach((p, i) => { if (!p || !p.correctAnswer) errors.push(label + ' item ' + (i + 1) + ': missing correctAnswer'); });
      if (!Array.isArray(q.matchOptions) || !q.matchOptions.length) errors.push(label + ': matchOptions required');
    } else if (hasAnyAnswer && ['single_choice', 'multiple_choice', 'true_false', 'matching'].includes(q.type) && q.correctAnswer == null) {
      errors.push(label + ': objective question missing "correctAnswer"');
    }
    if (hasAnyAnswer && q.type === 'text_input' && (!Array.isArray(q.acceptedAnswers) || !q.acceptedAnswers.length)) {
      errors.push(label + ': text_input requires "acceptedAnswers" array');
    }
    if (['single_choice', 'multiple_choice', 'true_false'].includes(q.type)) {
      if (!Array.isArray(q.options) || !q.options.length) {
        errors.push(label + ': options required');
      } else {
        const seen = new Set();
        for (const o of q.options) {
          if (!o || typeof o.id !== 'string' || !o.id) { errors.push(label + ': option missing "id"'); continue; }
          if (seen.has(o.id)) errors.push(label + ': duplicate option "' + o.id + '"');
          seen.add(o.id);
        }
      }
    }
    if (q.points != null && (typeof q.points !== 'number' || q.points < 0)) {
      errors.push(label + ': "points" must be a non-negative number');
    }
  }
  if (t.timeLimitSeconds != null && (typeof t.timeLimitSeconds !== 'number' || t.timeLimitSeconds <= 0)) {
    errors.push('"timeLimitSeconds" must be a positive number');
  }
  if (Array.isArray(t.questions) && t.questions.length && !ids.size) {
    // no ids at all: auto-assign stable synthetic ids so answers/flags keys are unique
    t.questions.forEach((q, i) => { if (typeof q.id !== 'string' || !q.id) q.id = 'q' + (i + 1); });
  }
  return errors;
}

/* ---------- Attempt persistence ---------- */
function saveAttempt() {
  if (!attempt || !test) return;
  try {
    attempt.rev = (attempt.rev || 0) + 1;
    attempt.lastTab = tabId;
    localStorage.setItem(LS_ATTEMPT_PREFIX + attempt.testHash, JSON.stringify(attempt));
  } catch (e) {
    let w = document.getElementById('storage-warning');
    if (!w) {
      w = el('div', { id: 'storage-warning', style: 'text-align:center;padding:8px;color:#dc2626' });
      document.body.appendChild(w);
    }
    w.textContent = 'Warning: could not persist answers (' + (e.name || 'storage error') + '). Progress may be lost on reload.';
  }
}

function loadAttempt(hash) {
  try {
    const raw = localStorage.getItem(LS_ATTEMPT_PREFIX + hash);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/* ---------- Home ---------- */
function renderHome() {
  show('home-screen');
  const stored = localStorage.getItem(LS_TEST);
  const resumeBox = $('#resume-box');
  if (stored) {
    let t = null;
    try { t = JSON.parse(stored); } catch { /* fall through */ }
    if (t && Array.isArray(t.questions)) {
      hashOf({ title: t.title, questions: t.questions }).then(h => {
        const prev = loadAttempt(h);
        $('#btn-continue').style.display = prev && !prev.submitted ? '' : 'none';
        $('#btn-restart').style.display = prev && prev.submitted ? '' : 'none';
        $('#stored-test-name').textContent = t.title + ' (' + t.questions.length + ' questions)';
        resumeBox.style.display = 'flex';
      });
      return;
    }
  }
  resumeBox.style.display = 'none';
}

/* Poll tests/ for a newly saved matching test — single awaited chain, timeout, cancel */
let polling = null;

function cancelPoll() { if (polling) polling.cancel = true; }

function pollForSavedTest(pdfName) {
  cancelPoll();
  const wanted = pdfName.replace(/\.(pdf|docx|doc|rtf|odt|epub|csv|xlsx)$/i, '.json');
  if (wanted === pdfName) return;
  const state = { cancel: false };
  polling = state;
  const deadline = Date.now() + 10 * 60 * 1000;
  const tick = async () => {
    if (state.cancel || polling !== state) return;
    if (Date.now() > deadline) {
      if (polling === state) { setStatus('', '', null); setStatus('Stopped waiting for the AI to save the test (10 min). Import it manually if it appears later.', 'ocr'); polling = null; }
      return;
    }
    try {
      const r = await fetch('/tests/' + encodeURIComponent(wanted), { cache: 'no-store' });
      if (r.ok && !state.cancel && polling === state) {
        const t = await r.json();
        if (t && Array.isArray(t.questions)) {
          polling = null;
          const p = document.createElement('p');
          p.appendChild(document.createTextNode('Your AI saved "' + wanted + '" (' + t.questions.length + ' questions). Starting the exam…'));
          setStatus('', 'ok', p);
          setTimeout(() => importJson(JSON.stringify(t)), 600);
          return;
        }
      }
    } catch { /* transient error: keep polling */ }
    if (!state.cancel && polling === state) setTimeout(tick, 2500);
  };
  tick();
}

function importJson(text) {
  let t;
  try { t = JSON.parse(text); } catch (e) {
    $('#home-error').textContent = 'Invalid JSON: ' + e.message;
    return;
  }
  const errs = validateTest(t);
  if (errs.length) {
    const box = $('#home-error');
    clear(box);
    box.appendChild(document.createTextNode('Validation failed:'));
    errs.forEach(e => box.appendChild(el('div', {}, '• ' + e)));
    return;
  }
  $('#home-error').textContent = '';
  cancelPoll();
  importTest(t, text);
}

async function importTest(t, rawText) {
  t._hash = await hashOf({ title: t.title, questions: t.questions });
  test = t;
  try { localStorage.setItem(LS_TEST, rawText || JSON.stringify(t)); } catch { /* non-fatal */ }
  const prev = loadAttempt(t._hash);
  if (prev && !prev.submitted) {
    attempt = prev;
    startExam(false);            // resume: skip setup, restore exactly where you left off
  } else {
    showSetup();                 // fresh attempt: user configures timer + question set
  }
}

/* ---------- Pre-exam setup screen ---------- */
let setupSel = null; // { minutes: number|null, included: Set<number> (index) }

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + (s ? ':' + String(s).padStart(2, '0') + ' min' : ' min');
}

function showSetup() {
  $('#setup-test-name').textContent = test.title + ' — ' + test.questions.length + ' questions';
  $('#setup-default-time').textContent = timeLimitStr(test.timeLimitSeconds);
  // timer radios state
  const radios = document.querySelectorAll('input[name="timermode"]');
  radios.forEach(r => r.checked = r.value === 'default');
  $('#custom-time-row').style.display = 'none';
  // question checkboxes
  const box = $('#setup-questions');
  clear(box);
  setupSel = { minutes: null, included: new Set(test.questions.map((_, i) => i)) };
  test.questions.forEach((q, i) => {
    const lbl = el('label', { class: 'setup-qrow' });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = true;
    cb.addEventListener('change', () => {
      cb.checked ? setupSel.included.add(i) : setupSel.included.delete(i);
      updateRangeBtns();
    });
    lbl.appendChild(cb);
    const t = el('span', {}, '');
    t.appendChild(el('strong', {}, 'Q' + q.number + ' '));
    t.appendChild(document.createTextNode(shortText(q)));
    lbl.appendChild(t);
    box.appendChild(lbl);
  });
  // range quick-select buttons
  const rangesDiv = $('#setup-ranges');
  clear(rangesDiv);
  const mk = (label, fn) => {
    const b = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, label);
    b.addEventListener('click', () => { fn(); refreshChecks(); updateRangeBtns(); });
    return b;
  };
  rangesDiv.appendChild(mk('All', () => test.questions.forEach((_, i) => setupSel.included.add(i))));
  rangesDiv.appendChild(mk('None', () => setupSel.included.clear()));
  // block buttons: chunks of 10 questions (e.g. Q1-10, Q11-20 …) = the "chapter division" use case
  const chunk = 10;
  for (let s = 0; s < test.questions.length; s += chunk) {
    const e = Math.min(s + chunk - 1, test.questions.length - 1);
    rangesDiv.appendChild(mk('Q' + test.questions[s].number + '\u2013' + test.questions[e].number, () => {
      for (let k = s; k <= e; k++) setupSel.included.add(k);
    }));
  }
  $('#setup-error').textContent = '';
  document.querySelectorAll('input[name="timermode"]').forEach(r => {
    r.onchange = () => { $('#custom-time-row').style.display = r.value === 'custom' && r.checked ? '' : 'none'; };
  });
  show('setup-screen');
}

function timeLimitStr(sec) {
  if (sec == null) return '60 min (default)';
  return fmtTime(sec);
}

function shortText(q) {
  const s = (q.prompt || (q.prompts && q.prompts[0] && q.prompts[0].text) || '').slice(0, 64);
  return s + (s.length > 60 ? '…' : '');
}

function refreshChecks() {
  document.querySelectorAll('#setup-questions input[type=checkbox]').forEach((cb, i) => {
    cb.checked = setupSel.included.has(i);
  });
}

function updateRangeBtns() { /* visual only; nothing to do — the Start calculation handles it */ }

function startFromSetup() {
  const mode = document.querySelector('input[name="timermode"]:checked').value;
  let seconds = test.timeLimitSeconds;
  if (mode === 'none') seconds = null;
  else if (mode === 'custom') {
    const m = parseInt($('#setup-minutes').value, 10);
    if (!m || m < 1 || m > 600) { $('#setup-error').textContent = 'Enter a duration between 1 and 600 minutes.'; return; }
    seconds = m * 60;
  }
  if (!setupSel.included.size) { $('#setup-error').textContent = 'Select at least one question.'; return; }
  $('#setup-error').textContent = '';
  // attempt-scoped view: rebuild the working test (hash extended with the chosen numbers so each
  // configuration has its own attempt/resume slot)
  const chosen = test.questions.filter((_, i) => setupSel.included.has(i));
  test = {
    title: test.title + (chosen.length < test.questions.length
      ? ' (' + chosen.length + ' of ' + test.questions.length + ' questions)' : ''),
    timeLimitSeconds: seconds,
    sourcePdf: test.sourcePdf,
    questions: chosen
  };
  hashOf({ title: test.title, questions: test.questions }).then(h => {
    test._hash = h;
    beginAttempt();
  });
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
  if (hasPdf) {
    // sourcePdf is a bare filename inside user pdfs/; normalize any legacy/foreign value
    const name = String(test.sourcePdf).split(/[\\/]/).pop();
    renderPdf($('#pdfViewer'), '/pdfs/' + encodeURIComponent(name));
  }
  renderFooterNav();
  renderCurrent(resetRender);
  startTimer();
}

function startTimer() {
  clearInterval(timerHandle);
  const limit = Math.max(30, Number(test.timeLimitSeconds) || 3600) * 1000;
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
    else chip.classList.remove('low');
    const s = Math.ceil(remain / 1000);
    chip.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
}

function isAnswered(q) {
  if (Array.isArray(q.prompts)) {
    if (!q.prompts.length) return false;
    return q.prompts.every(p => { const v = attempt.answers[q.id + ':' + p.id]; return v != null && v !== ''; });
  }
  const a = attempt.answers[q.id];
  return a != null && a !== '' && !(Array.isArray(a) && a.length === 0);
}

function renderFooterNav() {
  const pal = $('#question-palette');
  clear(pal);
  test.questions.forEach((q, i) => {
    const b = el('button', { class: 'palette-btn', type: 'button' }, String(q.number));
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

function renderCurrent() {
  const q = test.questions[attempt.current];
  const box = $('#question-box');
  $('#btn-prev').disabled = attempt.current === 0;
  $('#btn-next').disabled = attempt.current === test.questions.length - 1;
  $('#btn-flag').classList.toggle('flag-active', !!attempt.flags[q.id]);
  $('#btn-flag').textContent = attempt.flags[q.id] ? '⚑ Flagged' : '⚑ Flag';

  const card = el('div', { class: 'question-card' });
  card.appendChild(el('div', { class: 'question-number' }, 'Question ' + q.number));
  if (q.instruction) card.appendChild(el('div', { class: 'question-instruction' }, q.instruction));
  if (q.prompt) card.appendChild(el('p', { class: 'question-prompt' }, q.prompt));
  const body = el('div', { class: 'question-body' });
  card.appendChild(body);
  clear(box);
  box.appendChild(card);

  const setAnswer = (key, val) => { attempt.answers[key] = val; updatePalette(); saveAttempt(); };
  const optRow = (input, idText, text) => {
    const row = el('label', { class: 'option-row' });
    row.appendChild(input);
    row.appendChild(el('span', { class: 'option-id' }, idText + '.'));
    row.appendChild(el('span', {}, text == null ? '' : text));
    return row;
  };

  if (q.type === 'single_choice' || q.type === 'true_false') {
    q.options.forEach(o => {
      const input = el('input', { type: 'radio', name: 'radio-' + q.number });
      input.checked = attempt.answers[q.id] === o.id;
      input.addEventListener('change', () => setAnswer(q.id, o.id));
      body.appendChild(optRow(input, o.id, o.text));
    });
  } else if (q.type === 'multiple_choice') {
    const sel = new Set(Array.isArray(attempt.answers[q.id]) ? attempt.answers[q.id] : []);
    q.options.forEach(o => {
      const input = el('input', { type: 'checkbox' });
      input.checked = sel.has(o.id);
      input.addEventListener('change', ev => {
        ev.target.checked ? sel.add(o.id) : sel.delete(o.id);
        setAnswer(q.id, [...sel]);
      });
      body.appendChild(optRow(input, o.id, o.text));
    });
  } else if (q.type === 'text_input') {
    const input = el('input', { class: 'text-input', type: 'text' });
    input.value = attempt.answers[q.id] || '';
    input.addEventListener('input', () => setAnswer(q.id, input.value));
    body.appendChild(input);
  } else if (q.type === 'matching') {
    (q.prompts || []).forEach(p => {
      const row = el('div', { class: 'match-row' });
      row.appendChild(el('span', { class: 'option-id' }, p.id + '.'));
      row.appendChild(el('span', { style: 'flex:1' }, p.text == null ? '' : p.text));
      const seln = el('select');
      seln.appendChild(el('option', { value: '' }, '—'));
      (q.matchOptions || []).forEach(o => {
        const opt = el('option', { value: o.id }, o.id + ' — ' + (o.text == null ? '' : o.text));
        if (attempt.answers[q.id + ':' + p.id] === o.id) opt.selected = true;
        seln.appendChild(opt);
      });
      seln.addEventListener('change', ev => setAnswer(q.id + ':' + p.id, ev.target.value));
      row.appendChild(seln);
      body.appendChild(row);
    });
  } else if (q.type === 'long_text') {
    const wrap = el('div', { class: 'writing-area' });
    const ta = el('textarea');
    const wc = el('span', { class: 'word-count' });
    const count = () => {
      const n = (ta.value.trim().match(/\S+/g) || []).length;
      wc.textContent = n + ' words';
      wc.classList.toggle('ok', n > 0 && (!q.minWords || n >= q.minWords) && (!q.maxWords || n <= q.maxWords));
    };
    ta.value = attempt.answers[q.id] || '';
    ta.addEventListener('input', () => { setAnswer(q.id, ta.value); count(); });
    count();
    wrap.appendChild(ta);
    wrap.appendChild(wc);
    body.appendChild(wrap);
  }
}

$('#btn-prev').addEventListener('click', () => { if (attempt && attempt.current > 0) { attempt.current--; go(); } });
$('#btn-next').addEventListener('click', () => { if (attempt && attempt.current < test.questions.length - 1) { attempt.current++; go(); } });
$('#btn-flag').addEventListener('click', () => {
  if (!attempt) return;
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
const pt = q => (typeof q.points === 'number' && q.points > 0) ? q.points : 0;

function scoreQuestion(q) {
  if (q.type === 'long_text') return { correct: null, given: attempt.answers[q.id] || '' };
  if (Array.isArray(q.prompts)) {
    if (!q.prompts.some(p => p.correctAnswer)) return { correct: null, given: q.prompts.map(p => attempt.answers[q.id + ':' + p.id] || '—').join(', ') };
    const wrong = q.prompts.filter(p => attempt.answers[q.id + ':' + p.id] !== p.correctAnswer);
    return { correct: wrong.length === 0, given: q.prompts.map(p => attempt.answers[q.id + ':' + p.id] || '—').join(', ') };
  }
  const given = attempt.answers[q.id];
  if (q.type === 'text_input') {
    if (!Array.isArray(q.acceptedAnswers) || !q.acceptedAnswers.length) return { correct: null, given: given || '' };
    const ok = given != null && q.acceptedAnswers.some(a => norm(a) === norm(given));
    return { correct: ok, given: given || '' };
  }
  if (q.correctAnswer == null) return { correct: null, given: given || '' };
  const correctSet = new Set([].concat(q.correctAnswer));
  const givenSet = new Set(Array.isArray(given) ? given : (given != null && given !== '' ? [given] : []));
  if (givenSet.size === 0) return { correct: false, given: '' };  // an answer key exists but nothing was answered → wrong
  if (givenSet.size !== correctSet.size) return { correct: false, given: [...givenSet].join(', ') };
  for (const g of givenSet) if (!correctSet.has(g)) return { correct: false, given: [...givenSet].join(', ') };
  return { correct: true, given: [...givenSet].join(', ') };
}

function submitExam() {
  if (attempt.submitted) return;
  clearInterval(timerHandle);
  attempt.submitted = true;
  saveAttempt();
  const results = test.questions.map(q => ({ q, ...scoreQuestion(q) }));
  const total = results.reduce((s, r) => s + pt(r.q), 0);
  const earned = results.filter(r => r.correct === true).reduce((s, r) => s + pt(r.q), 0);
  const manualCount = results.filter(r => r.correct === null).length;
  $('#results-score').textContent =
    earned + ' / ' + total + (manualCount ? ' (+ ' + manualCount + ' to mark manually)' : '');

  const list = $('#results-list');
  clear(list);
  results.forEach(({ q, correct, given }) => {
    const correctText = Array.isArray(q.prompts) ? q.prompts.map(p => p.correctAnswer == null ? '?' : p.correctAnswer).join(', ')
      : q.type === 'long_text' ? '(self-marked)'
      : q.correctAnswer != null ? [].concat(q.correctAnswer).join(', ') : '';
    const verdict = correct === null ? '·' : correct ? '✓' : '✗';
    const row = el('div', { class: 'result-row ' + (correct === null ? '' : correct ? 'correct' : 'incorrect') });
    row.appendChild(el('span', { class: 'verdict' }, verdict));
    const body = el('span', { style: 'flex:1' });
    body.appendChild(el('strong', {}, 'Q' + q.number + '. '));
    body.appendChild(document.createTextNode(q.prompt || ''));
    const small = el('small');
    small.appendChild(document.createTextNode('Your answer: ' + (given || '—')));
    if (correct === false && correctText) small.appendChild(document.createTextNode(' · Correct: ' + correctText));
    body.appendChild(small);
    row.appendChild(body);
    list.appendChild(row);
  });

  const btn = el('button', { class: 'btn btn-primary', type: 'button' }, '⤓ Download results PDF');
  btn.addEventListener('click', () => {
    const payload = {
      title: test.title,
      score: earned + ' / ' + total + (manualCount ? ' (+ ' + manualCount + ' manual-check items)' : ''),
      rows: results.map(({ q, correct, given }) => ({
        number: q.number,
        given: given || '—',
        correctAnswer: (Array.isArray(q.prompts) ? q.prompts.map(p => p.correctAnswer == null ? '?' : p.correctAnswer).join(', ')
          : q.type === 'long_text' ? '—'
          : q.correctAnswer != null ? [].concat(q.correctAnswer).join(', ') : '?'),
        verdict: correct === null ? 'MANUAL CHECK' : correct ? 'RIGHT' : 'WRONG'
      }))
    };
    fetch('/export-results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(b => {
        const a = el('a', { href: URL.createObjectURL(b) });
        a.download = (test.title || 'results').replace(/[^\w -]/g, '') + '-results.pdf';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
  const raw = localStorage.getItem(LS_TEST);
  if (raw) importJson(raw);
});
$('#btn-review-results').addEventListener('click', () => { cancelPoll(); renderHome(); });

/* ---------- PDF intake ---------- */
const $status = $('#intake-status');

function setStatus(text, cls, node) {
  clear($status);
  if (node) $status.appendChild(node);
  else if (text) $status.appendChild(document.createTextNode(text));
  $status.className = 'intake-status' + (cls ? ' ' + cls : '');
  $status.style.display = 'block';
}

async function intakeFile(file) {
  const p0 = document.createElement('p');
  p0.appendChild(el('strong', {}, file.name));
  p0.appendChild(document.createTextNode(' — uploading… text files convert instantly; scans may take ~20s to OCR.'));
  setStatus('', '', p0);
  const fd = new FormData();
  fd.append('file', file);
  let res;
  try {
    res = await fetch('/upload-doc', { method: 'POST', body: fd });
  } catch (e) {
    setStatus('Upload failed: ' + e.message + ' — is the server running?', 'err');
    return;
  }
  if (!res.ok) {
    const txt = await res.text();
    setStatus('Intake failed (' + res.status + '): ' + txt, 'err');
    return;
  }
  let d;
  try { d = await res.json(); } catch { setStatus('Intake returned invalid data.', 'err'); return; }
  if (d.status === 'text') {
    const p = document.createElement('p');
    p.appendChild(el('strong', {}, d.file));
    p.appendChild(document.createTextNode(' — text extracted (' + d.markdown.length + ' chars). Ask your AI to build the test from it using the prompt above. When it saves, the exam starts here automatically.'));
    setStatus('', 'ok', p);
    pollForSavedTest(d.file);
  } else if (d.status === 'scanned-ocr') {
    const p = document.createElement('p');
    p.appendChild(el('strong', {}, d.file));
    p.appendChild(document.createTextNode(' — scanned PDF, OCR-d locally (' + d.pageCount + ' pages). Ask your AI using the prompt above; it can read the original pages at '));
    p.appendChild(el('a', { href: d.servesAt, target: '_blank', rel: 'noopener' }, 'the document link'));
    p.appendChild(document.createTextNode(' for better fidelity. When it saves, the exam starts here automatically.'));
    setStatus('', 'ocr', p);
    pollForSavedTest(d.file);
  } else {
    setStatus('Could not parse: ' + (d.error || 'unknown error'), 'err');
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
/* ---------- Copy buttons (moved inline script here so a CSP without unsafe-inline is possible) ---------- */
function bindCopy(btnId, elId) {
  document.getElementById(btnId).addEventListener('click', () => {
    const node = document.getElementById(elId);
    if (!node) return;
    const text = node.value !== undefined ? node.value : node.textContent;
    const done = () => {
      const b = document.getElementById(btnId);
      b.textContent = 'Copied ✓';
      setTimeout(() => { b.textContent = 'Copy'; }, 1500);
    };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { window.prompt('Copy manually:', text); }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done).catch(fallback);
    else fallback();
  });
}
bindCopy('btn-copy-mcp', 'mcp-url');
bindCopy('btn-copy-prompt', 'mcp-prompt');

$('#btn-setup-start').addEventListener('click', startFromSetup);
$('#btn-setup-cancel').addEventListener('click', () => renderHome());
