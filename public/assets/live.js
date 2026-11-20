'use strict';

// Player flow: intro -> GO (start) -> running stopwatch -> STOP (stop) -> rate -> done.
// The in-progress run is kept in localStorage so a refresh or accidental lock doesn't lose the timer.

const $ = (id) => document.getElementById(id);
const RUN_KEY = 'escapeai-run';
const SECTIONS = ['pick', 'intro', 'running', 'rate', 'done'];

let challenges = [];
let challenge = null;
let run = null; // { id, challengeId, clientStart, stage: 'running' | 'rate', elapsedMs }
let selectedRating = null;
let tick = null;

function show(name) {
  for (const s of SECTIONS) $(s).classList.toggle('hidden', s !== name);
  window.scrollTo(0, 0);
}

function fmt(ms) {
  const totalTenths = Math.floor(ms / 100);
  const tenths = totalTenths % 10;
  const totalSec = Math.floor(totalTenths / 10);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenths}`;
}

function saveRun() {
  if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
  else localStorage.removeItem(RUN_KEY);
}

function loadRun() {
  try {
    return JSON.parse(localStorage.getItem(RUN_KEY));
  } catch {
    return null;
  }
}

function listItems(ul, items) {
  ul.replaceChildren(...items.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
}

// ----- views -----

function showPick() {
  const box = $('pickList');
  box.replaceChildren();
  for (const c of challenges) {
    const a = document.createElement('a');
    a.className = 'btn';
    a.style.cssText = 'display:block;margin-bottom:0.6rem;text-align:left;';
    a.href = `?c=${encodeURIComponent(c.id)}`;
    a.textContent = c.title;
    box.append(a);
  }
  if (!challenges.length) box.textContent = 'No challenges available yet.';
  show('pick');
}

function showIntro() {
  $('introMeta').textContent = [`Difficulty ${['', 'easy', 'medium', 'hard'][challenge.difficulty]}`, `about ${challenge.estimatedMinutes} min`, challenge.category].filter(Boolean).join(' · ');
  $('introTitle').textContent = challenge.title;
  $('introLocation').textContent = challenge.location || '';
  $('introDescription').textContent = challenge.description || '';
  listItems($('introMaterials'), challenge.materials);
  $('introError').textContent = '';
  $('goBtn').disabled = false;
  show('intro');
}

function showRunning() {
  $('runTitle').textContent = challenge.title;
  listItems($('runSteps'), challenge.instructions);
  listItems($('runMaterials'), challenge.materials);
  $('runMaterialsBox').classList.toggle('hidden', !challenge.materials.length);
  renderHints();
  $('stopBtn').disabled = false;
  show('running');
  startClock();
}

function startClock() {
  stopClock();
  const update = () => { $('clock').textContent = fmt(Date.now() - run.clientStart); };
  update();
  tick = setInterval(update, 100);
}

function stopClock() {
  clearInterval(tick);
  tick = null;
}

function renderHints() {
  const total = challenge.hintCount;
  const used = run.hints;
  listItems($('runHints'), used.map((h) => h.text));
  const allUsed = used.length >= total;
  $('hintBtn').classList.toggle('hidden', total === 0);
  $('hintBtn').disabled = allUsed;
  $('hintBtn').textContent = allUsed ? 'No more hints' : 'Need a hint?';
  $('hintInfo').textContent = `${used.length} of ${total} hints used`;
}

// Hints unlock one at a time, in order. The server records each reveal on the run.
async function takeHint() {
  $('hintBtn').disabled = true;
  try {
    const hint = await post(`/api/attempts/${run.id}/hints`, { level: run.hints.length + 1 });
    run.hints.push({ level: hint.level, text: hint.text });
    saveRun();
  } catch (err) {
    alert(`Could not get hint: ${err.message}`);
  }
  renderHints();
}

function showRate() {
  stopClock();
  selectedRating = null;
  document.querySelectorAll('#rateGrid button').forEach((b) => b.classList.remove('selected'));
  $('submitRating').disabled = true;
  $('comment').value = '';
  $('rateError').textContent = '';
  $('rateTime').textContent = fmt(run.elapsedMs);
  show('rate');
}

// ----- actions -----

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function go() {
  $('goBtn').disabled = true;
  try {
    const started = await post('/api/attempts', { challengeId: challenge.id });
    run = { id: started.id, challengeId: challenge.id, clientStart: Date.now(), stage: 'running', elapsedMs: null, hints: [] };
    saveRun();
    showRunning();
  } catch (err) {
    $('introError').textContent = `Could not start: ${err.message}`;
    $('goBtn').disabled = false;
  }
}

async function stop() {
  $('stopBtn').disabled = true;
  const elapsedMs = Date.now() - run.clientStart;
  try {
    await post(`/api/attempts/${run.id}/stop`);
    run.stage = 'rate';
    run.elapsedMs = elapsedMs;
    saveRun();
    showRate();
  } catch (err) {
    // Timer keeps running; pressing STOP again retries.
    $('stopBtn').disabled = false;
    alert(`Could not stop the timer (${err.message}). Press STOP again.`);
  }
}

async function submitRating() {
  $('submitRating').disabled = true;
  try {
    await post(`/api/attempts/${run.id}/rating`, {
      enjoyment: selectedRating,
      comment: $('comment').value,
    });
  } catch (err) {
    // 409 "Already rated" means an earlier submit went through; treat as success.
    if (!/Already rated/.test(err.message)) {
      $('rateError').textContent = `Could not save: ${err.message}`;
      $('submitRating').disabled = false;
      return;
    }
  }
  run = null;
  saveRun();
  show('done');
}

// ----- events -----

$('goBtn').addEventListener('click', go);
$('stopBtn').addEventListener('click', stop);
$('hintBtn').addEventListener('click', takeHint);
$('submitRating').addEventListener('click', submitRating);

document.querySelectorAll('#rateGrid button').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedRating = Number(btn.dataset.value);
    document.querySelectorAll('#rateGrid button').forEach((b) => b.classList.toggle('selected', b === btn));
    $('submitRating').disabled = false;
  });
});

$('againBtn').addEventListener('click', () => {
  if (challenges.length && challenge) showIntro();
  else showPick();
});

// ----- boot -----

async function boot() {
  const res = await fetch('/api/challenges');
  if (!res.ok) throw new Error(`server answered ${res.status} for /api/challenges`);
  challenges = await res.json();
  const requestedId = new URLSearchParams(location.search).get('c');

  // A run in progress takes priority so a refresh resumes the timer.
  const saved = loadRun();
  if (saved) {
    const savedChallenge = challenges.find((c) => c.id === saved.challengeId);
    if (savedChallenge) {
      challenge = savedChallenge;
      run = saved;
      return saved.stage === 'rate' ? showRate() : showRunning();
    }
    run = null;
    saveRun();
  }

  challenge = challenges.find((c) => c.id === requestedId) ?? null;
  if (challenge) showIntro();
  else showPick();
}

boot().catch((err) => {
  $('pickList').textContent = `Could not load challenges: ${err.message}. Open this page from the EscapeAI server, not a static file server.`;
  show('pick');
});
