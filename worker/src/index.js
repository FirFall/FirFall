// FirFall auth — Cloudflare Worker + D1 (hides your home IP, runs on Cloudflare edge).
// Deploy: see worker/wrangler.toml + worker/schema.sql
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Content-Type': 'application/json'
    };
    if (req.method === 'OPTIONS') return new Response('{}', { headers: cors });

    async function hashPw(pw, salt) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
      return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    try {
      // Name filter: reserved names + profanity substrings (mirrored in backend/server.js + app.js)
      const BLOCKED_EXACT = new Set(['admin','administrator','root','system','support','help','firfall','official','moderator','mod','owner','staff','abuse','security','null','undefined']);
      const BLOCKED_PARTS = ['fuck','shit','bitch','dick','porn','nazi','kill','rape','hitler'];
      function nameAllowed(name) {
        if (BLOCKED_EXACT.has(name)) return false;
        return !BLOCKED_PARTS.some(w => name.includes(w));
      }
      if (req.method === 'POST' && url.pathname === '/api/register') {
        const { username, password } = await req.json();
        const u = String(username || '').trim().toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(u)) return json(400, { error: 'Username 3-20: a-z 0-9 _' });
        if (!nameAllowed(u)) return json(400, { error: 'That username is not allowed.' });
        if (!password || password.length < 4) return json(400, { error: 'Password min 4 chars.' });
        const salt = crypto.randomUUID();
        const ph = await hashPw(password, salt);
        try {
          const r = await env.DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)')
            .bind(u, ph, salt, new Date().toISOString()).run();
          const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
          await env.DB.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)')
            .bind(token, r.meta.last_row_id, new Date().toISOString()).run();
          return json(200, { username: u, token });
        } catch { return json(400, { error: 'Username taken.' }); }
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const { username, password } = await req.json();
        const u = String(username || '').trim().toLowerCase();
        const row = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(u).first();
        if (!row || (await hashPw(password, row.salt)) !== row.pass_hash)
          return json(401, { error: 'Wrong username/password.' });
        const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
        await env.DB.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)')
          .bind(token, row.id, new Date().toISOString()).run();
        return json(200, { username: row.username, token });
      }
      if (req.method === 'GET' && url.pathname === '/api/count') {
        const row = await env.DB.prepare('SELECT COUNT(*) c FROM users').first();
        return json(200, { users: row.c });
      }
      return json(404, { error: 'not found' });
    } catch { return json(500, { error: 'server error' }); }

    function json(code, obj) { return new Response(JSON.stringify(obj), { status: code, headers: cors }); }
  }
};
