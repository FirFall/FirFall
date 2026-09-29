// FirFall backend — Cloudflare Worker + D1 + Supabase Storage (free tier, no card).
// Auth, video upload w/ moderation, playback via signed URLs, comments w/ filter.
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_KEY (wrangler secret put). Bucket 'videos' PRIVATE.
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
    const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: cors });

    async function hashPw(pw, salt) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
      return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ---- Content filters (word-boundary matched, Scunthorpe-safe) ----
    const BLOCKED_EXACT = new Set(['admin','administrator','root','system','support','help','firfall','official','moderator','mod','owner','staff','abuse','security','null','undefined']);
    const PROFANITY = ['fuck','shit','bitch','dick','asshole','bastard','whore','slut','cunt','faggot','retard'];
    const NSFW = ['porn','pornhub','xvideos','xxx','hentai','onlyfans','escort','camgirl','nude','naked','sex video','erotic'];
    const GORE = ['gore','beheading','decapitat','dismember','snuff','mutilat','guro'];
    const SEVERE = ['child porn','childporn','preteen','loli','shota','bestiality','zoophilia','necrophilia','cp video','rape'];
    const hit = (text, words) => {
      const t = ' ' + String(text || '').toLowerCase() + ' ';
      return words.some(w => w.includes(' ')
        ? t.includes(' ' + w + ' ') || t.includes(w)
        : new RegExp('[^a-z0-9]' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^a-z0-9]').test(t));
    };
    // -> 'clean' | 'profanity' | 'nsfw' | 'gore' | 'severe'
    function scanText(...parts) {
      const text = parts.join(' \n ');
      if (hit(text, SEVERE)) return 'severe';
      if (hit(text, GORE)) return 'gore';
      if (hit(text, NSFW)) return 'nsfw';
      if (hit(text, PROFANITY)) return 'profanity';
      return 'clean';
    }
    function nameAllowed(name) {
      if (BLOCKED_EXACT.has(name)) return false;
      return scanText(name) === 'clean';
    }

    async function authedUser() {
      const h = req.headers.get('Authorization') || '';
      const m = h.match(/^Bearer (.+)$/);
      if (!m) return null;
      const row = await env.DB.prepare(
        'SELECT u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?'
      ).bind(m[1]).first();
      return row ? row.username : null;
    }

    // ---- Supabase Storage (private bucket 'videos') ----
    const supaKey = () => env.SUPABASE_SERVICE_KEY || '';
    const supaBase = () => (env.SUPABASE_URL || '').replace(/\/$/, '');
    const storageConfigured = () => !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
    async function supaPut(path, body, contentType) {
      const r = await fetch(supaBase() + '/storage/v1/object/videos/' + path, {
        method: 'PUT',
        headers: { apikey: supaKey(), Authorization: 'Bearer ' + supaKey(), 'Content-Type': contentType, 'x-upsert': 'true' },
        body
      });
      if (!r.ok) throw new Error('storage put failed: ' + r.status);
    }
    async function supaDelete(paths) {
      await fetch(supaBase() + '/storage/v1/object/videos', {
        method: 'DELETE',
        headers: { apikey: supaKey(), Authorization: 'Bearer ' + supaKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify(paths)
      });
    }
    // Signed playback URL (clean videos only — flagged keys are never signed)
    async function supaSign(path, expiresIn) {
      const r = await fetch(supaBase() + '/storage/v1/object/sign/videos/' + path, {
        method: 'POST',
        headers: { apikey: supaKey(), Authorization: 'Bearer ' + supaKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn })
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j.signedURL ? supaBase() + j.signedURL : null;
    }

    const MAX_VIDEO_BYTES = 100_000_000; // Workers request limit
    const STORAGE_QUOTA_BYTES = 900_000_000; // stay under Supabase free 1GB
    const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'];
    const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv'];

    try {
      // ---------- Auth (unchanged behavior) ----------
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

      // ---------- Video upload (multipart: file, thumb?, title, description, scan) ----------
      if (req.method === 'POST' && url.pathname === '/api/videos/upload') {
        const user = await authedUser();
        if (!user) return json(401, { error: 'Sign in to upload.' });
        if (!storageConfigured()) return json(500, { error: 'Video storage not configured.' });
        const form = await req.formData();
        const file = form.get('file');
        const title = String(form.get('title') || '').trim();
        const desc = String(form.get('description') || '').trim();
        const clientScan = String(form.get('scan') || 'skipped');
        if (!(file instanceof File) || file.size === 0) return json(400, { error: 'No video file.' });
        if (!VIDEO_MIMES.includes(file.type)) return json(400, { error: 'Only MP4/WebM/MOV/MKV.' });
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (!VIDEO_EXTS.includes(ext)) return json(400, { error: 'Bad file extension.' });
        if (file.size > MAX_VIDEO_BYTES) return json(400, { error: 'Max 100MB per upload (test version).' });
        if (title.length < 1 || title.length > 100) return json(400, { error: 'Title 1-100 chars.' });
        if (desc.length > 2000) return json(400, { error: 'Description max 2000 chars.' });
        if (clientScan === 'blocked') return json(400, { error: 'Blocked: on-device scan flagged this video as explicit.' });
        const verdict = scanText(title, desc, file.name);
        if (verdict === 'severe') return json(400, { error: 'Blocked: prohibited content. Uploads like this get accounts banned.' });
        const used = (await env.DB.prepare('SELECT COALESCE(SUM(size),0) s FROM videos').first()).s;
        if (used + file.size > STORAGE_QUOTA_BYTES) return json(400, { error: 'Site storage full (free tier). Try a smaller file.' });
        const id = crypto.randomUUID().slice(0, 12);
        const key = 'v/' + id + '.' + ext;
        const status = verdict === 'clean' ? 'clean' : 'flagged';
        // Held-for-review content never touches storage: reject the bytes now.
        if (status !== 'clean') {
          await env.DB.prepare(
            'INSERT INTO videos(id,owner,title,description,r2_key,thumb_key,mime,size,status,flag_reason,scan,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
          ).bind(id, user, title, desc, '', null, file.type, file.size, status, 'auto-filter: ' + verdict, clientScan, new Date().toISOString()).run();
          return json(202, { id, status, message: 'Held for review: auto-filter matched (' + verdict + '). File discarded.' });
        }
        await supaPut(key, file.stream(), file.type);
        let thumbKey = null;
        const thumb = form.get('thumb');
        if (thumb instanceof File && thumb.size > 0 && thumb.size < 5_000_000 && thumb.type.startsWith('image/')) {
          thumbKey = 't/' + id + '.jpg';
          try { await supaPut(thumbKey, thumb.stream(), 'image/jpeg'); } catch { thumbKey = null; }
        }
        await env.DB.prepare(
          'INSERT INTO videos(id,owner,title,description,r2_key,thumb_key,mime,size,status,flag_reason,scan,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(id, user, title, desc, key, thumbKey, file.type, file.size, 'clean', null, clientScan, new Date().toISOString()).run();
        return json(200, { id, status: 'clean', message: 'Uploaded.' });
      }

      // ---------- Video listing (clean only) ----------
      if (req.method === 'GET' && url.pathname === '/api/videos') {
        const owner = url.searchParams.get('owner');
        const rows = owner
          ? (await env.DB.prepare("SELECT id,owner,title,description,mime,size,created_at FROM videos WHERE status='clean' AND owner=? ORDER BY created_at DESC LIMIT 50").bind(owner.toLowerCase()).all()).results
          : (await env.DB.prepare("SELECT id,owner,title,description,mime,size,created_at FROM videos WHERE status='clean' ORDER BY created_at DESC LIMIT 50").all()).results;
        return json(200, { videos: rows });
      }
      if (req.method === 'GET' && url.pathname === '/api/video') {
        const row = await env.DB.prepare("SELECT id,owner,title,description,mime,size,created_at FROM videos WHERE id=? AND status='clean'").bind(url.searchParams.get('id')).first();
        if (!row) return json(404, { error: 'Video not found.' });
        return json(200, { video: row });
      }

      // ---------- Playback redirect (clean only, signed, 1h) ----------
      if (req.method === 'GET' && url.pathname.startsWith('/v/')) {
        const id = url.pathname.slice(3);
        const row = await env.DB.prepare("SELECT r2_key FROM videos WHERE id=? AND status='clean'").bind(id).first();
        if (!row || !row.r2_key || !storageConfigured()) return new Response('Not found', { status: 404 });
        const signed = await supaSign(row.r2_key, 3600);
        if (!signed) return new Response('Not found', { status: 404 });
        return Response.redirect(signed, 302);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/t/')) {
        const id = url.pathname.slice(3);
        const row = await env.DB.prepare("SELECT thumb_key FROM videos WHERE id=? AND status='clean'").bind(id).first();
        if (!row || !row.thumb_key || !storageConfigured()) return new Response('Not found', { status: 404 });
        const signed = await supaSign(row.thumb_key, 86400);
        if (!signed) return new Response('Not found', { status: 404 });
        return Response.redirect(signed, 302);
      }

      // ---------- Comments (filter enforced) ----------
      if (req.method === 'GET' && url.pathname === '/api/comments') {
        const vid = url.searchParams.get('video');
        const rows = (await env.DB.prepare("SELECT user,text,created_at FROM comments WHERE video_id=? AND status='clean' ORDER BY id DESC LIMIT 50").bind(vid).all()).results;
        return json(200, { comments: rows });
      }
      if (req.method === 'POST' && url.pathname === '/api/comments') {
        const user = await authedUser();
        if (!user) return json(401, { error: 'Sign in to comment.' });
        const { video_id, text } = await req.json();
        const t = String(text || '').trim();
        if (!t || t.length > 500) return json(400, { error: 'Comment 1-500 chars.' });
        const vid = await env.DB.prepare("SELECT id FROM videos WHERE id=? AND status='clean'").bind(video_id).first();
        if (!vid) return json(404, { error: 'Video not found.' });
        const verdict = scanText(t);
        if (verdict === 'severe') return json(400, { error: 'Blocked: prohibited content. This was logged.' });
        if (verdict !== 'clean') return json(400, { error: 'Blocked by comment filter (' + verdict + '). Keep it clean.' });
        const recent = await env.DB.prepare("SELECT created_at FROM comments WHERE user=? ORDER BY id DESC LIMIT 1").bind(user).first();
        if (recent && Date.now() - new Date(recent.created_at).getTime() < 5000)
          return json(429, { error: 'Slow down — 5s between comments.' });
        await env.DB.prepare("INSERT INTO comments(video_id,user,text,status,created_at) VALUES(?,?,?,'clean',?)")
          .bind(video_id, user, t, new Date().toISOString()).run();
        return json(200, { ok: true });
      }

      // ---------- Owner delete (removes bytes too) ----------
      if (req.method === 'POST' && url.pathname === '/api/video/delete') {
        const user = await authedUser();
        if (!user) return json(401, { error: 'Sign in.' });
        const { id } = await req.json();
        const row = await env.DB.prepare('SELECT r2_key,thumb_key,owner FROM videos WHERE id=?').bind(id).first();
        if (!row || row.owner !== user) return json(404, { error: 'Video not found.' });
        const paths = [row.r2_key, row.thumb_key].filter(Boolean);
        if (paths.length && storageConfigured()) { try { await supaDelete(paths); } catch {} }
        await env.DB.prepare('DELETE FROM comments WHERE video_id=?').bind(id).run();
        await env.DB.prepare('DELETE FROM videos WHERE id=?').bind(id).run();
        return json(200, { ok: true });
      }

      return json(404, { error: 'not found' });
    } catch (e) { return json(500, { error: 'server error' }); }
  }
};
