// FirFall backend — Cloudflare Worker + D1 + Backblaze B2 (10GB free, no card).
// Auth, video upload w/ moderation, playback via B2 download auth, comments w/ filter.
// Secrets: B2_KEY_ID, B2_APP_KEY, B2_BUCKET (wrangler secret put). Bucket PRIVATE.
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
    const RACISM = ['nigger','nigga','kike','chink','spic','raghead','towelhead','gook','coon','darkie','paki','camel jockey','sand nigger','white power','kkk'];
    const EXTREMISM = ['isis','al qaeda','al-qaeda','boko haram','heil hitler','1488','taliban'];
    const SEVERE = ['child porn','childporn','preteen','loli','shota','bestiality','zoophilia','necrophilia','cp video','rape'];
    const hit = (text, words) => {
      const t = ' ' + String(text || '').toLowerCase() + ' ';
      return words.some(w => w.includes(' ')
        ? t.includes(' ' + w + ' ') || t.includes(w)
        : new RegExp('[^a-z0-9]' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^a-z0-9]').test(t));
    };
    // -> 'clean' | 'profanity' | 'nsfw' | 'gore' | 'racism' | 'extremism' | 'severe'
    function scanText(...parts) {
      const text = parts.join(' \n ');
      if (hit(text, SEVERE)) return 'severe';
      if (hit(text, RACISM)) return 'racism';
      if (hit(text, EXTREMISM)) return 'extremism';
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
      const tok = m ? m[1] : url.searchParams.get('token');
      if (!tok) return null;
      const row = await env.DB.prepare(
        'SELECT u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?'
      ).bind(tok).first();
      return row ? row.username : null;
    }

    // ---- Backblaze B2 (native API, private bucket, multipart for big files) ----
    const storageConfigured = () => !!(env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET);
    async function sha1hex(buf) {
      const d = await crypto.subtle.digest('SHA-1', buf);
      return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    async function b2auth() {
      const now = Date.now();
      const c = globalThis.__b2;
      if (c && c.exp > now + 60000) return c;
      const cred = btoa(env.B2_KEY_ID + ':' + env.B2_APP_KEY);
      const r = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
        headers: { Authorization: 'Basic ' + cred }
      });
      if (!r.ok) throw new Error('b2 auth ' + r.status);
      const j = await r.json();
      let bucketId = (j.allowed && j.allowed.bucketId) || null;
      if (!bucketId && env.B2_BUCKET) {
        const lb = await fetch(j.apiUrl + '/b2api/v2/b2_list_buckets', {
          method: 'POST', headers: { Authorization: j.authorizationToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: j.accountId })
        });
        if (!lb.ok) throw new Error('b2 buckets ' + lb.status);
        const bj = await lb.json();
        const b = (bj.buckets || []).find(x => x.bucketName === env.B2_BUCKET);
        if (!b) throw new Error('b2 bucket not found');
        bucketId = b.bucketId;
      }
      const auth = { token: j.authorizationToken, apiUrl: j.apiUrl, downloadUrl: j.downloadUrl, accountId: j.accountId, bucketId, exp: now + 20 * 3600 * 1000 };
      globalThis.__b2 = auth;
      return auth;
    }
    async function b2call(op, body, retryAuth = true) {
      const a = await b2auth();
      const callOnce = async (tok, api) => {
        const r = await fetch(api + '/b2api/v2/' + op, {
          method: 'POST', headers: { Authorization: tok, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!r.ok) {
          const detail = await r.text().catch(() => '');
          const err = new Error(op + ' ' + r.status + ' ' + detail.slice(0, 200));
          err.status = r.status;
          throw err;
        }
        return await r.json();
      };
      try {
        return await callOnce(a.token, a.apiUrl);
      } catch (e) {
        if (e.status === 401 && retryAuth) {
          globalThis.__b2 = null;
          const a2 = await b2auth();
          return await callOnce(a2.token, a2.apiUrl);
        }
        throw e;
      }
    }
    async function b2freshPartUrl(fileId) {
      const j = await b2call('b2_get_upload_part_url', { fileId });
      return { uploadUrl: j.uploadUrl, token: j.authorizationToken };
    }
    // Small-file PUT (thumbnails). Returns {fileId}.
    async function b2SmallPut(name, bytes, mime) {
      const a = await b2auth();
      const u = await b2call('b2_get_upload_url', { bucketId: a.bucketId });
      const hex = await sha1hex(bytes);
      const encName = String(name).split('/').map(encodeURIComponent).join('/');
      const r = await fetch(u.uploadUrl, {
        method: 'POST',
        headers: { Authorization: u.authorizationToken, 'X-Bz-File-Name': encName, 'Content-Type': mime,
          'Content-Length': String(bytes.byteLength), 'X-Bz-Content-Sha1': hex },
        body: bytes
      });
      if (!r.ok) throw new Error('b2 put ' + r.status);
      return await r.json();
    }
    async function b2Delete(name, fileId) {
      if (!fileId) return;
      try { await b2call('b2_delete_file_version', { fileName: name, fileId }); } catch {}
    }
    // Time-boxed download URL for a private object (playback / thumbs).
    async function b2PlayUrl(name, seconds) {
      const a = await b2auth();
      const j = await b2call('b2_get_download_authorization',
        { bucketId: a.bucketId, fileNamePrefix: name, validDurationInSeconds: seconds });
      return a.downloadUrl + '/file/' + env.B2_BUCKET + '/' + name + '?Authorization=' + j.authorizationToken;
    }

    const MAX_VIDEO_BYTES = 250_000_000; // 250MB via B2 large-file multipart (6MB parts)
    const CHUNK_BYTES = 6_000_000;
    const STORAGE_QUOTA_BYTES = 9_000_000_000; // stay under B2 free 10GB
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

      // ---------- Chunked upload via B2 large-file multipart (250MB cap, 6MB parts) ----------
      async function b2UploadPart(fileId, uploadUrl, partToken, partNum, bytes) {
        const hex = await sha1hex(bytes);
        const send = async (u, tok) => fetch(u, {
          method: 'POST',
          headers: { Authorization: tok, 'X-Bz-Part-Number': String(partNum),
            'Content-Length': String(bytes.byteLength), 'X-Bz-Content-Sha1': hex },
          body: bytes
        });
        let r = await send(uploadUrl, partToken);
        if (!r.ok && (r.status === 401 || r.status === 503)) {
          const fresh = await b2freshPartUrl(fileId).catch(() => null);
          if (fresh) {
            await env.DB.prepare('UPDATE uploads SET b2_upload_url=?, b2_part_token=? WHERE b2_file_id=?')
              .bind(fresh.uploadUrl, fresh.token, fileId).run();
            r = await send(fresh.uploadUrl, fresh.token);
          }
        }
        if (!r.ok) throw new Error('b2 part ' + r.status);
        const j = await r.json();
        return j.contentSha1 || hex;
      }
      if (req.method === 'POST' && url.pathname === '/api/uploads/start') {
        const user = await authedUser();
        if (!user) return json(401, { error: 'Sign in to upload.' });
        const { filename, mime, size, title, description, duration, visibility, scan } = await req.json();
        const t = String(title || '').trim(), d = String(description || '').trim();
        if (!VIDEO_MIMES.includes(mime)) return json(400, { error: 'Only MP4/WebM/MOV/MKV.' });
        const ext = (String(filename || '').split('.').pop() || '').toLowerCase();
        if (!VIDEO_EXTS.includes(ext)) return json(400, { error: 'Bad file extension.' });
        if (!size || size <= 0 || size > MAX_VIDEO_BYTES) return json(400, { error: 'Max 250MB per upload.' });
        if (t.length < 1 || t.length > 100) return json(400, { error: 'Title 1-100 chars.' });
        if (d.length > 2000) return json(400, { error: 'Description max 2000 chars.' });
        if (scan === 'blocked') return json(400, { error: 'Blocked: on-device scan flagged this video as explicit.' });
        // Text moderation runs BEFORE storage is touched — bad actors get no session.
        const verdict = scanText(t, d, filename);
        if (verdict === 'severe' || verdict === 'racism' || verdict === 'extremism')
          return json(400, { error: 'Blocked: prohibited content (' + verdict + '). Uploads like this get accounts banned.' });
        if (!storageConfigured()) return json(500, { error: 'Video storage not configured.' });
        const used = (await env.DB.prepare('SELECT COALESCE(SUM(size),0) s FROM videos').first()).s;
        if (used + size > STORAGE_QUOTA_BYTES) return json(400, { error: 'Site storage full (free tier). Try a smaller file.' });
        const id = crypto.randomUUID().slice(0, 12);
        const key = 'v/' + id + '.' + ext;
        const dur = Math.max(0, Math.min(36000, parseFloat(duration) || 0));
        const vis = ['public', 'unlisted', 'private'].includes(visibility) ? visibility : 'public';
        // B2 large files need >=2 parts: single-chunk files use simple upload instead.
        const simple = size <= CHUNK_BYTES;
        let fileId = 'PENDING-SMALL', partUrl = { uploadUrl: '', token: '' };
        if (!simple) {
          try {
            const a = await b2auth();
            const st = await b2call('b2_start_large_file', { bucketId: a.bucketId, fileName: key, contentType: mime });
            fileId = st.fileId;
            partUrl = await b2freshPartUrl(fileId);
          }
          catch (e) { console.error('b2 start failed:', String(e && e.message || e)); return json(500, { error: 'Storage unavailable (' + String(e && e.message || 'unknown') + ') — try again.' }); }
        }
        await env.DB.prepare(
          'INSERT INTO uploads(id,owner,title,description,storage_key,mime,size,duration,visibility,b2_file_id,b2_upload_url,b2_part_token,part_num,parts_json,uploaded,scan,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(id, user, t, d, key, mime, size, dur, vis, fileId, partUrl.uploadUrl, partUrl.token, 0, '[]', 0, String(scan || 'skipped'), new Date().toISOString()).run();
        // NSFW/gore verdicts are enforced at complete-time (bytes discarded, row flagged).
        return json(200, { sessionId: id, chunkSize: CHUNK_BYTES });
      }
      if (req.method === 'POST' && url.pathname === '/api/uploads/chunk') {
        const user = await authedUser();
        if (!user) return json(401, { error: 'Sign in to upload.' });
        const form = await req.formData();
        const sessionId = String(form.get('sessionId') || '');
        const off = parseInt(String(form.get('off') || '0'), 10) || 0;
        const chunk = form.get('chunk');
        const up = await env.DB.prepare('SELECT * FROM uploads WHERE id=?').bind(sessionId).first();
        if (!up || up.owner !== user) return json(404, { error: 'Upload session not found.' });
        // Idempotent: client may resend a part whose response was lost.
        if (off < up.uploaded) return json(200, { uploaded: up.uploaded, size: up.size });
        if (off > up.uploaded) return json(400, { error: 'Out of order — restart the upload.' });
        if (!(chunk instanceof File) || chunk.size === 0 || chunk.size > CHUNK_BYTES + 1024)
          return json(400, { error: 'Bad chunk.' });
        if (up.uploaded + chunk.size > up.size) return json(400, { error: 'Chunk overflow.' });
        // Single-part file: whole bytes go up in one simple PUT.
        if (up.b2_file_id === 'PENDING-SMALL') {
          if (off !== 0 || chunk.size !== up.size)
            return json(400, { error: 'Out of order — restart the upload.' });
          try {
            const bytes = await chunk.arrayBuffer();
            const put = await b2SmallPut(up.storage_key, bytes, up.mime);
            await env.DB.prepare('UPDATE uploads SET uploaded=?, b2_file_id=? WHERE id=?')
              .bind(chunk.size, put.fileId, sessionId).run();
            return json(200, { uploaded: chunk.size, size: up.size });
          } catch (e) { console.error('b2 small put failed:', String(e && e.message || e)); return json(500, { error: 'Chunk failed (' + String(e && e.message || 'storage') + ') — retrying resumes automatically.' }); }
        }
        const partNum = up.part_num + 1;
        let partSha;
        try {
          const bytes = await chunk.arrayBuffer();
          partSha = await b2UploadPart(up.b2_file_id, up.b2_upload_url, up.b2_part_token, partNum, bytes);
        }
        catch (e) { console.error('b2 part failed:', String(e && e.message || e)); return json(500, { error: 'Chunk failed (' + String(e && e.message || 'storage') + ') — retrying resumes automatically.' }); }
        const parts = JSON.parse(up.parts_json || '[]');
        parts.push(partSha);
        const uploaded = up.uploaded + chunk.size;
        await env.DB.prepare('UPDATE uploads SET uploaded=?, part_num=?, parts_json=? WHERE id=?')
          .bind(uploaded, partNum, JSON.stringify(parts), sessionId).run();
        return json(200, { uploaded, size: up.size });
      }
      if (req.method === 'POST' && url.pathname === '/api/uploads/complete') {
        const user = await authedUser();
        if (!user) return json(401, { error: 'Sign in to upload.' });
        const form = await req.formData().catch(() => null);
        let body = {};
        if (form) body = { sessionId: String(form.get('sessionId') || ''), thumb: form.get('thumb') };
        else try { body = await req.json(); } catch {}
        const up = await env.DB.prepare('SELECT * FROM uploads WHERE id=?').bind(body.sessionId).first();
        if (!up || up.owner !== user) return json(404, { error: 'Upload session not found.' });
        if (up.uploaded < up.size) return json(400, { error: 'Upload incomplete — missing bytes.' });
        const verdict = scanText(up.title, up.description, up.storage_key);
        const cancel = async () => { try { await b2call('b2_cancel_large_file', { fileId: up.b2_file_id }); } catch {} };
        const finalize = async (status, flagReason, thumbKey, thumbId, fileId) => {
          if (status !== 'clean') { await cancel(); }
          await env.DB.prepare(
            'INSERT INTO videos(id,owner,title,description,r2_key,file_id,thumb_key,thumb_id,mime,size,duration,visibility,status,flag_reason,scan,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
          ).bind(up.id, user, up.title, up.description, status === 'clean' ? up.storage_key : '', fileId || null, thumbKey,
            thumbId || null, up.mime, up.size, up.duration, up.visibility, status, flagReason, up.scan, new Date().toISOString()).run();
          await env.DB.prepare('DELETE FROM uploads WHERE id=?').bind(up.id).run();
        };
        if (verdict === 'nsfw' || verdict === 'gore') {
          await finalize('flagged', 'auto-filter: ' + verdict, null, null, null);
          return json(202, { id: up.id, status: 'flagged', message: 'Held for review: auto-filter matched (' + verdict + '). File discarded.' });
        }
        // Assemble parts into the final object (skipped for single-part simple uploads).
        if (up.part_num > 0) {
          try {
            await b2call('b2_finish_large_file', { fileId: up.b2_file_id, partSha1Array: JSON.parse(up.parts_json || '[]') });
          } catch (e) {
            console.error('b2 finish failed:', String(e && e.message || e));
            await cancel();
            await env.DB.prepare('DELETE FROM uploads WHERE id=?').bind(up.id).run();
            return json(500, { error: 'Storage assemble failed (' + String(e && e.message || 'unknown') + ') — try again.' });
          }
        } else if (!up.b2_file_id || up.b2_file_id === 'PENDING-SMALL') {
          return json(400, { error: 'Upload incomplete — missing bytes.' });
        }
        let thumbKey = null, thumbId = null;
        const thumb = body.thumb;
        if (thumb instanceof File && thumb.size > 0 && thumb.size < 5_000_000 && thumb.type.startsWith('image/')) {
          thumbKey = 't/' + up.id + '.jpg';
          try {
            const tb = await thumb.arrayBuffer();
            const put = await b2SmallPut(thumbKey, tb, 'image/jpeg');
            thumbId = put.fileId;
          } catch { thumbKey = null; }
        }
        if (thumbKey && env.AI) {
          try {
            const buf = await thumb.arrayBuffer();
            const labels = await env.AI.run('@cf/microsoft/resnet-50', { image: [...new Uint8Array(buf)] });
            const risky = ['bikini', 'maillot', 'brassiere', 'miniskirt', 'nudity'];
            const top = (Array.isArray(labels) ? labels : []).slice(0, 3);
            if (top.some(l => l.score > 0.5 && risky.some(r => String(l.label || '').toLowerCase().includes(r)))) {
              try { await b2Delete(up.storage_key, up.b2_file_id); } catch {}
              if (thumbId) { try { await b2Delete(thumbKey, thumbId); } catch {} }
              await finalize('flagged', 'auto-vision: explicit thumbnail', null, null, null);
              return json(202, { id: up.id, status: 'flagged', message: 'Held for review: thumbnail failed the explicit-content check. File discarded.' });
            }
          } catch { /* AI unavailable — text + client checks still apply */ }
        }
        await finalize('clean', null, thumbKey, thumbId, up.b2_file_id);
        return json(200, { id: up.id, status: 'clean', message: 'Uploaded.' });
      }
      if (req.method === 'POST' && url.pathname === '/api/uploads/abort') {
        const user = await authedUser();
        if (!user) return json(401, { error: 'Sign in.' });
        const { sessionId } = await req.json();
        const up = await env.DB.prepare('SELECT * FROM uploads WHERE id=?').bind(sessionId).first();
        if (up && up.owner === user) {
          try {
            if (!up.b2_file_id || up.b2_file_id === 'PENDING-SMALL') { /* nothing stored yet */ }
            else if (up.part_num > 0) await b2call('b2_cancel_large_file', { fileId: up.b2_file_id });
            else await b2Delete(up.storage_key, up.b2_file_id);
          } catch {}
          await env.DB.prepare('DELETE FROM uploads WHERE id=?').bind(sessionId).run();
        }
        return json(200, { ok: true });
      }

      // ---------- Video listing (public; owners also see own unlisted/private) ----------
      if (req.method === 'GET' && url.pathname === '/api/videos') {
        const owner = url.searchParams.get('owner');
        const requester = await authedUser();
        const vis = (o) => (requester && o && requester === o.toLowerCase())
          ? "status='clean' AND visibility IN ('public','unlisted','private')"
          : "status='clean' AND visibility='public'";
        const rows = owner
          ? (await env.DB.prepare("SELECT id,owner,title,description,mime,size,views,duration,visibility,created_at FROM videos WHERE " + vis(owner) + " AND owner=? ORDER BY created_at DESC LIMIT 50").bind(owner.toLowerCase()).all()).results
          : (await env.DB.prepare("SELECT id,owner,title,description,mime,size,views,duration,visibility,created_at FROM videos WHERE status='clean' AND visibility='public' ORDER BY created_at DESC LIMIT 50").all()).results;
        return json(200, { videos: rows });
      }
      if (req.method === 'GET' && url.pathname === '/api/video') {
        const row = await env.DB.prepare("SELECT id,owner,title,description,mime,size,views,duration,visibility,created_at FROM videos WHERE id=? AND status='clean'").bind(url.searchParams.get('id')).first();
        if (!row) return json(404, { error: 'Video not found.' });
        if (row.visibility === 'private') {
          const u = await authedUser();
          if (!u || u !== row.owner) return json(404, { error: 'Video not found.' });
        }
        const likes = (await env.DB.prepare("SELECT COUNT(*) c FROM video_likes WHERE video_id=? AND kind='like'").bind(row.id).first()).c;
        let reaction = 'none';
        const u = await authedUser();
        if (u) {
          const mine = await env.DB.prepare('SELECT kind FROM video_likes WHERE video_id=? AND username=?').bind(row.id, u).first();
          if (mine) reaction = mine.kind;
        }
        return json(200, { video: row, likes, reaction });
      }
      // ---------- Real channel lookup (unknown users 404 — no fake channels) ----------
      if (req.method === 'GET' && url.pathname === '/api/user') {
        const name = String(url.searchParams.get('u') || '').toLowerCase();
        const row = await env.DB.prepare('SELECT username,created_at FROM users WHERE username=?').bind(name).first();
        if (!row) return json(404, { error: 'Channel not found.' });
        const nv = (await env.DB.prepare("SELECT COUNT(*) c FROM videos WHERE owner=? AND status='clean'").bind(name).first()).c;
        return json(200, { user: { username: row.username, joined: row.created_at, videos: nv } });
      }
      // ---------- Views + likes ----------
      if (req.method === 'POST' && url.pathname === '/api/video/view') {
        const { id } = await req.json();
        await env.DB.prepare("UPDATE videos SET views=views+1 WHERE id=? AND status='clean'").bind(id).run();
        return json(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/video/react') {
        const user = await authedUser();
        if (!user) return json(401, { error: 'Sign in to react.' });
        const { id, kind } = await req.json();
        const vid = await env.DB.prepare("SELECT id FROM videos WHERE id=? AND status='clean'").bind(id).first();
        if (!vid) return json(404, { error: 'Video not found.' });
        if (kind === 'none') await env.DB.prepare('DELETE FROM video_likes WHERE video_id=? AND username=?').bind(id, user).run();
        else if (kind === 'like' || kind === 'dislike') await env.DB.prepare(
          'INSERT INTO video_likes(video_id,username,kind,created_at) VALUES(?,?,?,?) ON CONFLICT(video_id,username) DO UPDATE SET kind=excluded.kind'
        ).bind(id, user, kind, new Date().toISOString()).run();
        else return json(400, { error: 'Bad reaction.' });
        const likes = (await env.DB.prepare("SELECT COUNT(*) c FROM video_likes WHERE video_id=? AND kind='like'").bind(id).first()).c;
        const dislikes = (await env.DB.prepare("SELECT COUNT(*) c FROM video_likes WHERE video_id=? AND kind='dislike'").bind(id).first()).c;
        const mine = await env.DB.prepare('SELECT kind FROM video_likes WHERE video_id=? AND username=?').bind(id, user).first();
        return json(200, { likes, dislikes, reaction: mine ? mine.kind : 'none' });
      }

      // ---------- Playback redirect (clean only; private needs owner token) ----------
      if (req.method === 'GET' && url.pathname.startsWith('/v/')) {
        const id = url.pathname.slice(3);
        const row = await env.DB.prepare("SELECT r2_key,owner,visibility FROM videos WHERE id=? AND status='clean'").bind(id).first();
        if (!row || !row.r2_key || !storageConfigured()) return new Response('Not found', { status: 404 });
        if (row.visibility === 'private') {
          const u = await authedUser();
          if (!u || u !== row.owner) return new Response('Not found', { status: 404 });
        }
        try {
          const play = await b2PlayUrl(row.r2_key, 3600);
          return Response.redirect(play, 302);
        } catch { return new Response('Not found', { status: 404 }); }
      }
      if (req.method === 'GET' && url.pathname.startsWith('/t/')) {
        const id = url.pathname.slice(3);
        const row = await env.DB.prepare("SELECT thumb_key,owner,visibility FROM videos WHERE id=? AND status='clean'").bind(id).first();
        if (!row || !row.thumb_key || !storageConfigured()) return new Response('Not found', { status: 404 });
        if (row.visibility === 'private') {
          const u = await authedUser();
          if (!u || u !== row.owner) return new Response('Not found', { status: 404 });
        }
        try {
          const play = await b2PlayUrl(row.thumb_key, 86400);
          return Response.redirect(play, 302);
        } catch { return new Response('Not found', { status: 404 }); }
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
        const row = await env.DB.prepare('SELECT r2_key,file_id,thumb_key,thumb_id,owner FROM videos WHERE id=?').bind(id).first();
        if (!row || row.owner !== user) return json(404, { error: 'Video not found.' });
        if (storageConfigured()) {
          await b2Delete(row.r2_key, row.file_id);
          if (row.thumb_key) await b2Delete(row.thumb_key, row.thumb_id);
        }
        await env.DB.prepare('DELETE FROM comments WHERE video_id=?').bind(id).run();
        await env.DB.prepare('DELETE FROM videos WHERE id=?').bind(id).run();
        return json(200, { ok: true });
      }

      return json(404, { error: 'not found' });
    } catch (e) { console.error('worker error:', req.method, url.pathname, String(e && e.stack || e)); return json(500, { error: 'server error' }); }
  }
};
