'use strict';

const $ = (id) => document.getElementById(id);
let challenges = [];
let selectedId = null; // null = creating a new challenge
let liveUrl = '';

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) showLogin();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showLogin() {
  $('editor').classList.add('hidden');
  $('logout').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('password').focus();
}

function showEditor() {
  $('login').classList.add('hidden');
  $('logout').classList.remove('hidden');
  $('editor').classList.remove('hidden');
}

// ----- list -----

function renderList() {
  const list = $('list');
  list.replaceChildren();
  for (const c of challenges) {
    const btn = document.createElement('button');
    btn.className = 'item' + (c.id === selectedId ? ' active' : '');
    btn.textContent = c.title;
    const small = document.createElement('small');
    small.textContent = [c.location, c.category].filter(Boolean).join(' · ') || 'No location yet';
    btn.appendChild(small);
    btn.addEventListener('click', () => select(c.id));
    list.appendChild(btn);
  }
  if (!challenges.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No challenges yet.';
    list.appendChild(p);
  }
}

async function loadChallenges() {
  challenges = await api('GET', '/api/admin/challenges');
  renderList();
}

// ----- form -----

const lines = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean);

function fillForm(c) {
  $('formTitle').textContent = c ? c.title : 'New challenge';
  $('title').value = c?.title ?? '';
  $('location').value = c?.location ?? '';
  $('category').value = c?.category ?? '';
  $('difficulty').value = String(c?.difficulty ?? 2);
  $('estimatedMinutes').value = c?.estimatedMinutes ?? 10;
  $('description').value = c?.description ?? '';
  $('instructions').value = (c?.instructions ?? []).join('\n');
  $('materials').value = (c?.materials ?? []).join('\n');
  $('hints').value = (c?.hints ?? []).join('\n');
  $('deleteBtn').classList.toggle('hidden', !c);
  $('formError').textContent = '';
  $('saveStatus').textContent = '';
}

function readForm() {
  return {
    title: $('title').value,
    location: $('location').value,
    category: $('category').value,
    difficulty: $('difficulty').value,
    estimatedMinutes: $('estimatedMinutes').value,
    description: $('description').value,
    instructions: lines($('instructions').value),
    materials: lines($('materials').value),
    hints: lines($('hints').value),
  };
}

function select(id) {
  selectedId = id;
  const c = challenges.find((x) => x.id === id) ?? null;
  fillForm(c);
  renderList();
  showQr(c);
}

// ----- QR -----

function showQr(c) {
  if (!c) {
    $('qrCard').classList.add('hidden');
    return;
  }
  const url = `${liveUrl}?c=${encodeURIComponent(c.id)}`;
  $('qrCard').classList.remove('hidden');
  $('liveLink').href = url;
  $('liveLink').textContent = url;
  if (window.QRCode) {
    QRCode.toCanvas($('qrCanvas'), url, { width: 220, margin: 1 }, (err) => {
      if (!err) $('qrDownload').href = $('qrCanvas').toDataURL('image/png');
    });
  } else {
    $('liveLink').insertAdjacentText('afterend', ' (QR library failed to load: check internet access)');
  }
}

// ----- events -----

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    await api('POST', '/api/login', { password: $('password').value });
    $('password').value = '';
    await start();
  } catch (err) {
    $('loginError').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  showLogin();
});

$('newBtn').addEventListener('click', () => select(null));

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('formError').textContent = '';
  $('saveStatus').textContent = 'Saving…';
  try {
    const body = readForm();
    const saved = selectedId
      ? await api('PUT', `/api/challenges/${selectedId}`, body)
      : await api('POST', '/api/challenges', body);
    selectedId = saved.id;
    await loadChallenges();
    fillForm(saved);
    showQr(saved);
    renderList();
    $('saveStatus').textContent = 'Saved';
  } catch (err) {
    $('saveStatus').textContent = '';
    $('formError').textContent = err.message;
  }
});

$('deleteBtn').addEventListener('click', async () => {
  if (!selectedId || !confirm('Delete this challenge? Its stats will stay in the database but it will disappear from the dashboard.')) return;
  try {
    await api('DELETE', `/api/challenges/${selectedId}`);
    selectedId = null;
    await loadChallenges();
    fillForm(null);
    showQr(null);
  } catch (err) {
    $('formError').textContent = err.message;
  }
});

// ----- boot -----

async function start() {
  const session = await api('GET', '/api/admin/session');
  if (!session.authed) return showLogin();
  liveUrl = (await api('GET', '/api/config')).liveUrl;
  showEditor();
  await loadChallenges();
  fillForm(null);
}

start();
