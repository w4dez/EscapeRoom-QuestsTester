#!/usr/bin/env node
'use strict';

// EscapeAI prototype server. No dependencies: Node built-ins only.
// Host routing:  admin.<domain> -> teacher editor, live.<domain> -> phone player, otherwise -> public dashboard.
// Local testing: http://localhost:3000/admin, /live, /

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'escape-admin';
const LIVE_URL = process.env.LIVE_URL || `http://localhost:${PORT}/live`;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE_NAME = 'ea_admin';

if (!process.env.ADMIN_PASSWORD) {
  console.warn('WARNING: ADMIN_PASSWORD not set, using the insecure default. Set it before going live.');
}

const PAGES = { admin: 'admin.html', live: 'live.html', dashboard: 'index.html' };
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- storage (JSON file, rewritten atomically on every change) ----------

function seedDb() {
  return {
    challenges: [
      {
        id: 'c-lab-drawer',
        title: 'The Locked Lab Drawer',
        location: 'Room 204, Chemistry',
        category: 'Chemistry',
        difficulty: 2,
        estimatedMinutes: 10,
        description: 'A drawer is sealed with a 4-digit code. The clues are hidden on the periodic table posters.',
        instructions: [
          'Find the 4 posters on the back wall.',
          'Each poster has one element highlighted in red.',
          'Convert the atomic numbers of those elements into digits, in poster order.',
          'Enter the 4-digit code on the drawer lock.',
        ],
        materials: ['Periodic table posters', 'Pen and paper'],
        hints: [
          'Have you checked what the highlighted numbers on the posters stand for?',
          'Each highlighted element is identified by its atomic number. Read the posters left to right.',
          'The code is 4 digits: the atomic numbers of the highlighted elements, in poster order.',
        ],
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'c-caesar',
        title: "Caesar's Message",
        location: 'Room 110, Library',
        category: 'English',
        difficulty: 1,
        estimatedMinutes: 8,
        description: 'An envelope contains a message encrypted with a Caesar cipher. Decode it to get the password for the next envelope.',
        instructions: [
          'Use the cipher wheel printout to decode the message.',
          'Shift each letter back by 3 positions.',
          'The decoded word is the password for the next envelope.',
        ],
        materials: ['Cipher wheel printout', 'Sealed envelope'],
        hints: [
          'Have you tried shifting the letters back through the alphabet?',
          'Each letter moves back 3 places: A becomes X, B becomes Y, C becomes Z.',
          'Decode "KHOOR" by shifting every letter back 3. Your password is the decoded word.',
        ],
        updatedAt: new Date().toISOString(),
      },
    ],
    attempts: [],
  };
}

function loadDb() {
  if (!fs.existsSync(DATA_FILE)) {
    const seeded = seedDb();
    writeDb(seeded);
    return seeded;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeDb(data) {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

let db = loadDb();
const adminTokens = new Set();

// ---------- validation ----------

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const cleanStr = (v, max) => String(v ?? '').trim().slice(0, max);
const cleanList = (v) => {
  const items = Array.isArray(v) ? v : String(v ?? '').split('\n');
  return items.map((s) => cleanStr(s, 300)).filter(Boolean).slice(0, 50);
};

function cleanChallenge(input, id) {
  const title = cleanStr(input.title, 120);
  if (!title) throw new HttpError(400, 'Title is required');
  return {
    id,
    title,
    location: cleanStr(input.location, 120),
    category: cleanStr(input.category, 60),
    difficulty: clampInt(input.difficulty, 1, 3, 2),
    estimatedMinutes: clampInt(input.estimatedMinutes, 1, 240, 10),
    description: cleanStr(input.description, 2000),
    instructions: cleanList(input.instructions),
    materials: cleanList(input.materials),
    hints: cleanList(input.hints),
    updatedAt: new Date().toISOString(),
  };
}

// Hint text is only sent once a player reveals it, so public responses never include it.
function publicChallenge(c) {
  const { hints, ...rest } = c;
  return { ...rest, hintCount: hints.length };
}

// ---------- stats ----------

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

function statsFor(challengeId) {
  const all = db.attempts.filter((a) => a.challengeId === challengeId);
  const done = all.filter((a) => a.durationMs != null);
  const rated = done.filter((a) => a.rating != null);
  const seconds = done.map((a) => a.durationMs / 1000);
  return {
    attempts: all.length,
    completed: done.length,
    avgSeconds: round1(avg(seconds)),
    bestSeconds: seconds.length ? round1(Math.min(...seconds)) : null,
    avgHints: round1(avg(done.map((a) => (a.hintsUsed ?? []).length))),
    avgEnjoyment: round1(avg(rated.map((a) => a.rating.enjoyment))),
    ratings: rated.length,
  };
}

function allStats() {
  return Object.fromEntries(db.challenges.map((c) => [c.id, statsFor(c.id)]));
}

// ---------- auth ----------

function passwordOk(candidate) {
  // Compare fixed-length hashes so timingSafeEqual never throws on length mismatch.
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(candidate), h(ADMIN_PASSWORD));
}

function tokenFromCookie(req) {
  const match = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${COOKIE_NAME}=([0-9a-f]+)`));
  return match ? match[1] : null;
}

function requireAdmin(req) {
  const token = tokenFromCookie(req);
  if (!token || !adminTokens.has(token)) throw new HttpError(401, 'Log in as a teacher first');
}

// ---------- http helpers ----------

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

function resolveApp(req, url) {
  const sub = (req.headers.host || '').split(':')[0].split('.')[0];
  if (sub === 'admin') return 'admin';
  if (sub === 'live') return 'live';
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return 'admin';
  if (url.pathname === '/live' || url.pathname.startsWith('/live/')) return 'live';
  return 'dashboard';
}

// ---------- api ----------

async function handleApi(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  if (method === 'GET' && p === '/api/config') {
    return sendJson(res, 200, { liveUrl: LIVE_URL });
  }

  if (method === 'GET' && p === '/api/challenges') {
    return sendJson(res, 200, db.challenges.map(publicChallenge));
  }

  // Teacher-only: full challenges including hint text
  if (method === 'GET' && p === '/api/admin/challenges') {
    requireAdmin(req);
    return sendJson(res, 200, db.challenges);
  }

  if (method === 'GET' && p === '/api/stats') {
    return sendJson(res, 200, allStats());
  }

  // Teacher auth
  if (method === 'POST' && p === '/api/login') {
    const body = await readJson(req);
    if (!passwordOk(body.password ?? '')) throw new HttpError(401, 'Wrong password');
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.add(token);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
    });
  }

  if (method === 'POST' && p === '/api/logout') {
    const token = tokenFromCookie(req);
    if (token) adminTokens.delete(token);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
    });
  }

  if (method === 'GET' && p === '/api/admin/session') {
    const token = tokenFromCookie(req);
    return sendJson(res, 200, { authed: Boolean(token && adminTokens.has(token)) });
  }

  // Teacher-only challenge editing
  if (method === 'POST' && p === '/api/challenges') {
    requireAdmin(req);
    const challenge = cleanChallenge(await readJson(req), crypto.randomUUID().slice(0, 8));
    db.challenges.push(challenge);
    writeDb(db);
    return sendJson(res, 201, challenge);
  }

  const challengeMatch = p.match(/^\/api\/challenges\/([\w-]+)$/);
  if (challengeMatch) {
    const id = challengeMatch[1];
    const index = db.challenges.findIndex((c) => c.id === id);

    if (method === 'GET') {
      if (index === -1) throw new HttpError(404, 'Challenge not found');
      return sendJson(res, 200, publicChallenge(db.challenges[index]));
    }

    requireAdmin(req);
    if (index === -1) throw new HttpError(404, 'Challenge not found');

    if (method === 'PUT') {
      const challenge = cleanChallenge(await readJson(req), id);
      db.challenges[index] = challenge;
      writeDb(db);
      return sendJson(res, 200, challenge);
    }

    if (method === 'DELETE') {
      db.challenges.splice(index, 1);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }
  }

  // Player flow: start -> stop -> rate
  if (method === 'POST' && p === '/api/attempts') {
    const body = await readJson(req);
    if (!db.challenges.some((c) => c.id === body.challengeId)) {
      throw new HttpError(404, 'Challenge not found');
    }
    const attempt = {
      id: crypto.randomUUID(),
      challengeId: body.challengeId,
      startedAt: Date.now(),
      stoppedAt: null,
      durationMs: null,
      rating: null,
      hintsUsed: [],
    };
    db.attempts.push(attempt);
    writeDb(db);
    return sendJson(res, 201, { id: attempt.id, startedAt: attempt.startedAt });
  }

  const attemptMatch = p.match(/^\/api\/attempts\/([\w-]+)\/(stop|rating|hints)$/);
  if (method === 'POST' && attemptMatch) {
    const [, id, action] = attemptMatch;
    const attempt = db.attempts.find((a) => a.id === id);
    if (!attempt) throw new HttpError(404, 'Attempt not found');

    if (action === 'stop') {
      if (attempt.stoppedAt == null) {
        attempt.stoppedAt = Date.now();
        attempt.durationMs = attempt.stoppedAt - attempt.startedAt;
        writeDb(db);
      }
      return sendJson(res, 200, { durationMs: attempt.durationMs });
    }

    if (action === 'hints') {
      if (attempt.stoppedAt != null) throw new HttpError(409, 'Run already stopped');
      const challenge = db.challenges.find((c) => c.id === attempt.challengeId);
      if (!challenge) throw new HttpError(404, 'Challenge not found');
      const body = await readJson(req);
      const level = clampInt(body.level, 1, 99, NaN);
      if (!Number.isFinite(level)) throw new HttpError(400, 'Hint level required');
      const used = attempt.hintsUsed;
      // Hints are taken in order. Re-requesting an already revealed hint just returns it again.
      if (level > used.length + 1) throw new HttpError(409, 'Take earlier hints first');
      if (level > challenge.hints.length) throw new HttpError(404, 'No such hint');
      if (level === used.length + 1) {
        used.push({ level, atMs: Date.now() - attempt.startedAt });
        writeDb(db);
      }
      return sendJson(res, 200, { level, text: challenge.hints[level - 1], hintsUsed: used.length });
    }

    // action === 'rating'
    if (attempt.stoppedAt == null) throw new HttpError(409, 'Stop the timer before rating');
    if (attempt.rating) throw new HttpError(409, 'Already rated');
    const body = await readJson(req);
    const enjoyment = clampInt(body.enjoyment, 1, 5, NaN);
    if (!Number.isFinite(enjoyment)) throw new HttpError(400, 'Enjoyment must be 1-5');
    attempt.rating = { enjoyment, comment: cleanStr(body.comment, 500) };
    writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Unknown API route');
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    if (url.pathname.startsWith('/assets/')) {
      const file = path.normalize(path.join(PUBLIC_DIR, url.pathname));
      if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Forbidden');
      return serveFile(res, file);
    }

    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
    return serveFile(res, path.join(PUBLIC_DIR, PAGES[resolveApp(req, url)]));
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    return sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`EscapeAI listening on http://localhost:${PORT}`);
  console.log(`  dashboard: /      admin: /admin (or admin.<domain>)      live: /live?c=<id> (or live.<domain>)`);
});
