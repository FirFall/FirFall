// FirFall auth backend — zero dependencies, unlimited SQLite storage.
// Run: node backend/server.js  (API on http://localhost:3001)
const http = require('http');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const PORT = 3001;
const db = new DatabaseSync(path.join(__dirname, 'users.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);`);

function hashPw(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString('hex');
}
function send(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(b);
}
function body(req) {
  return new Promise((res, rej) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { res(d ? JSON.parse(d) : {}); } catch { rej(new Error('bad json')); } });
    req.on('error', rej);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, {});
  // Name filter: reserved names + profanity substrings (mirrored in worker/src/index.js + app.js)
  const BLOCKED_EXACT = new Set(['admin','administrator','root','system','support','help','firfall','official','moderator','mod','owner','staff','abuse','security','null','undefined']);
  const BLOCKED_PARTS = ['fuck','shit','bitch','dick','porn','nazi','kill','rape','hitler'];
  const nameAllowed = (name) => !BLOCKED_EXACT.has(name) && !BLOCKED_PARTS.some(w => name.includes(w));
  try {
    if (req.method === 'POST' && req.url === '/api/register') {
      const { username, password } = await body(req);
      const u = String(username || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(u)) return send(res, 400, { error: 'Username 3-20 chars: a-z 0-9 _' });
      if (!nameAllowed(u)) return send(res, 400, { error: 'That username is not allowed.' });
      if (!password || password.length < 4) return send(res, 400, { error: 'Password min 4 chars.' });
      const salt = crypto.randomBytes(16).toString('hex');
      try {
        const r = db.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)')
          .run(u, hashPw(password, salt), salt, new Date().toISOString());
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, Number(r.lastInsertRowid), new Date().toISOString());
        return send(res, 200, { username: u, token });
      } catch { return send(res, 400, { error: 'Username taken.' }); }
    }
    if (req.method === 'POST' && req.url === '/api/login') {
      const { username, password } = await body(req);
      const u = String(username || '').trim().toLowerCase();
      const row = db.prepare('SELECT * FROM users WHERE username=?').get(u);
      if (!row || hashPw(password, row.salt) !== row.pass_hash) return send(res, 401, { error: 'Wrong username/password.' });
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, row.id, new Date().toISOString());
      return send(res, 200, { username: row.username, token });
    }
    if (req.method === 'GET' && req.url === '/api/count') {
      const row = db.prepare('SELECT COUNT(*) c FROM users').get();
      return send(res, 200, { users: row.c, limit: 'unlimited (SQLite file)' });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) { return send(res, 500, { error: 'server error' }); }
});

server.listen(PORT, () => console.log(`FirFall auth: http://localhost:${PORT} — SQLite users.db (unlimited)`));
