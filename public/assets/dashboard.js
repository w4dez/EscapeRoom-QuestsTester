'use strict';

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else node.textContent = v;
  }
  for (const child of children) node.append(child);
  return node;
}

const fmtSeconds = (s) => {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  const rest = (s % 60).toFixed(1).padStart(4, '0');
  return m ? `${m}m ${rest}s` : `${rest}s`;
};

const stars = (n) => (n == null ? '—' : `${'★'.repeat(Math.round(n))}${'☆'.repeat(5 - Math.round(n))} ${n.toFixed(1)}`);
const difficultyLabel = (d) => ['', 'Easy', 'Medium', 'Hard'][d] ?? '';

function renderOverview(challenges, stats) {
  const tbody = $('overview');
  tbody.replaceChildren();
  for (const c of challenges) {
    const s = stats[c.id] ?? {};
    tbody.append(el('tr', {},
      el('td', { }, c.title),
      el('td', {}, c.location || '—'),
      el('td', {}, difficultyLabel(c.difficulty)),
      el('td', {}, String(s.attempts ?? 0)),
      el('td', {}, String(s.completed ?? 0)),
      el('td', {}, s.avgHints == null ? '—' : s.avgHints.toFixed(1)),
      el('td', {}, fmtSeconds(s.bestSeconds)),
      el('td', {}, fmtSeconds(s.avgSeconds)),
      el('td', { class: 'stars' }, stars(s.avgEnjoyment)),
    ));
  }
  if (!challenges.length) {
    tbody.append(el('tr', {}, el('td', { class: 'muted' }, 'No challenges yet.')));
  }
}

function renderCards(challenges, stats) {
  const wrap = $('cards');
  wrap.replaceChildren();
  for (const c of challenges) {
    const s = stats[c.id] ?? {};
    const card = el('div', { class: 'card' },
      el('h3', {}, c.title),
      el('p', { class: 'muted' }, [c.location, c.category].filter(Boolean).join(' · ')),
      el('p', {}, c.description || ''),
      el('p', {},
        el('span', { class: 'pill' }, difficultyLabel(c.difficulty)),
        el('span', { class: 'pill' }, `~${c.estimatedMinutes} min`),
      ),
      el('div', { class: 'stat-row' },
        stat(s.attempts ?? 0, 'attempts'),
        stat(fmtSeconds(s.bestSeconds), 'best'),
        stat(fmtSeconds(s.avgSeconds), 'average'),
        stat(s.avgHints == null ? '—' : s.avgHints.toFixed(1), 'hints used'),
        stat(s.avgEnjoyment == null ? '—' : s.avgEnjoyment.toFixed(1), `enjoyment (${s.ratings ?? 0})`),
      ),
    );
    wrap.append(card);
  }
}

function stat(value, label) {
  return el('div', { class: 'stat' }, el('b', {}, String(value)), el('span', {}, label));
}

async function refresh() {
  try {
    const [challenges, stats] = await Promise.all([
      fetch('/api/challenges').then((r) => r.json()),
      fetch('/api/stats').then((r) => r.json()),
    ]);
    renderOverview(challenges, stats);
    renderCards(challenges, stats);
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch {
    $('updated').textContent = 'Connection lost, retrying…';
  }
}

refresh();
setInterval(refresh, 15000);
