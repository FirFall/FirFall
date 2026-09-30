var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var index_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    const poison = await env.DB.prepare("SELECT 1 FROM poison_bans WHERE ip=?").bind(ip).first();
    if (poison) return new Response("Your IP is poison-banned. Access denied.", { status: 403 });
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Content-Type": "application/json"
    };
    if (req.method === "OPTIONS") return new Response("{}", { headers: cors });
    const json = /* @__PURE__ */ __name((code, obj) => new Response(JSON.stringify(obj), { status: code, headers: cors }), "json");
    async function hashPw(pw, salt) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 1e5, hash: "SHA-256" }, key, 256);
      return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    __name(hashPw, "hashPw");
    const BLOCKED_EXACT = /* @__PURE__ */ new Set(["admin", "administrator", "root", "system", "support", "help", "firfall", "official", "moderator", "mod", "owner", "staff", "abuse", "security", "null", "undefined"]);
    const PROFANITY = ["fuck", "shit", "bitch", "dick", "asshole", "bastard", "whore", "slut", "cunt", "faggot", "retard"];
    const NSFW = ["porn", "pornhub", "xvideos", "xxx", "hentai", "onlyfans", "escort", "camgirl", "nude", "naked", "sex video", "erotic"];
    const GORE = ["gore", "beheading", "decapitat", "dismember", "snuff", "mutilat", "guro"];
    const RACISM = ["nigger", "nigga", "kike", "chink", "spic", "raghead", "towelhead", "gook", "coon", "darkie", "paki", "camel jockey", "sand nigger", "white power", "kkk"];
    const EXTREMISM = ["isis", "al qaeda", "al-qaeda", "boko haram", "heil hitler", "1488", "taliban"];
    const SEVERE = ["child porn", "childporn", "preteen", "loli", "shota", "bestiality", "zoophilia", "necrophilia", "cp video", "rape"];
    const hit = /* @__PURE__ */ __name((text, words) => {
      const t = " " + String(text || "").toLowerCase() + " ";
      return words.some((w) => w.includes(" ") ? t.includes(" " + w + " ") || t.includes(w) : new RegExp("[^a-z0-9]" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^a-z0-9]").test(t));
    }, "hit");
    function scanText(...parts) {
      const text = parts.join(" \n ");
      if (hit(text, SEVERE)) return "severe";
      if (hit(text, RACISM)) return "racism";
      if (hit(text, EXTREMISM)) return "extremism";
      if (hit(text, GORE)) return "gore";
      if (hit(text, NSFW)) return "nsfw";
      if (hit(text, PROFANITY)) return "profanity";
      return "clean";
    }
    __name(scanText, "scanText");
    function nameAllowed(name) {
      if (BLOCKED_EXACT.has(name)) return false;
      return scanText(name) === "clean";
    }
    __name(nameAllowed, "nameAllowed");
    async function authedUser() {
      const h = req.headers.get("Authorization") || "";
      const m = h.match(/^Bearer (.+)$/);
      const tok = m ? m[1] : url.searchParams.get("token");
      if (!tok) return null;
      const row = await env.DB.prepare(
        "SELECT u.username,u.role,u.banned FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?"
      ).bind(tok).first();
      if (!row) return null;
      if (row.banned) return null;
      return { username: row.username, role: row.role };
    }
    __name(authedUser, "authedUser");
    const storageConfigured = /* @__PURE__ */ __name(() => !!(env.B2_KEY_ID && env.B2_APP_KEY && env.B2_BUCKET), "storageConfigured");
    async function sha1hex(buf) {
      const d = await crypto.subtle.digest("SHA-1", buf);
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    __name(sha1hex, "sha1hex");
    async function b2auth() {
      const now = Date.now();
      const c = globalThis.__b2;
      if (c && c.exp > now + 6e4) return c;
      const cred = btoa(env.B2_KEY_ID + ":" + env.B2_APP_KEY);
      const r = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
        headers: { Authorization: "Basic " + cred }
      });
      if (!r.ok) throw new Error("b2 auth " + r.status);
      const j = await r.json();
      let bucketId = j.allowed && j.allowed.bucketId || null;
      if (!bucketId && env.B2_BUCKET) {
        const lb = await fetch(j.apiUrl + "/b2api/v2/b2_list_buckets", {
          method: "POST",
          headers: { Authorization: j.authorizationToken, "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: j.accountId })
        });
        if (!lb.ok) throw new Error("b2 buckets " + lb.status);
        const bj = await lb.json();
        const b = (bj.buckets || []).find((x) => x.bucketName === env.B2_BUCKET);
        if (!b) throw new Error("b2 bucket not found");
        bucketId = b.bucketId;
      }
      const auth = { token: j.authorizationToken, apiUrl: j.apiUrl, downloadUrl: j.downloadUrl, accountId: j.accountId, bucketId, exp: now + 20 * 3600 * 1e3 };
      globalThis.__b2 = auth;
      return auth;
    }
async function b2call(op, body, retryAuth = true) {
  const a = await b2auth();
  const callOnce = /* @__PURE__ */ __name(async (tok, api) => {
    const r = await fetch(api + "/b2api/v2/" + op, {
      method: "POST",
      headers: { Authorization: tok, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      const err = new Error(op + " " + r.status + " " + detail.slice(0, 200));
      err['status'] = r.status;
      throw err;
    }
    return await r.json();
  }, "callOnce");
  try {
    return await callOnce(a.token, a.apiUrl);
  } catch (e) {
    if (e['status'] === 401 && retryAuth) {
      globalThis.__b2 = null;
      const a2 = await b2auth();
      return await callOnce(a2.token, a2.apiUrl);
    }
    throw e;
  }
}
    __name(b2call, "b2call");
    async function b2freshPartUrl(fileId) {
      const j = await b2call("b2_get_upload_part_url", { fileId });
      return { uploadUrl: j.uploadUrl, token: j.authorizationToken };
    }
    __name(b2freshPartUrl, "b2freshPartUrl");
    async function b2SmallPut(name, bytes, mime) {
      const a = await b2auth();
      const u = await b2call("b2_get_upload_url", { bucketId: a.bucketId });
      const hex = await sha1hex(bytes);
      const encName = String(name).split("/").map(encodeURIComponent).join("/");
      const r = await fetch(u.uploadUrl, {
        method: "POST",
        headers: {
          Authorization: u.authorizationToken,
          "X-Bz-File-Name": encName,
          "Content-Type": mime,
          "Content-Length": String(bytes.byteLength),
          "X-Bz-Content-Sha1": hex
        },
        body: bytes
      });
      if (!r.ok) throw new Error("b2 put " + r.status);
      return await r.json();
    }
    __name(b2SmallPut, "b2SmallPut");
    async function b2Delete(name, fileId) {
      if (!fileId) return;
      try {
        await b2call("b2_delete_file_version", { fileName: name, fileId });
      } catch {
      }
    }
    __name(b2Delete, "b2Delete");
    async function b2PlayUrl(name, seconds) {
      const a = await b2auth();
      const j = await b2call(
        "b2_get_download_authorization",
        { bucketId: a.bucketId, fileNamePrefix: name, validDurationInSeconds: seconds }
      );
      return a.downloadUrl + "/file/" + env.B2_BUCKET + "/" + name + "?Authorization=" + j.authorizationToken;
    }
    __name(b2PlayUrl, "b2PlayUrl");
    const MAX_VIDEO_BYTES = 25e7;
    const CHUNK_BYTES = 6e6;
    const STORAGE_QUOTA_BYTES = 9e9;
    const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"];
    const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv"];
    try {
      if (req.method === "GET" && url.pathname === "/api/admin/users") {
        const user = await authedUser();
        if (!user || user.role !== "admin") return json(403, { error: "Admin only." });
        const rows = (await env.DB.prepare("SELECT id,username,role,banned,about,created_at,last_ip FROM users ORDER BY created_at DESC").all()).results;
        return json(200, { users: rows });
      }
      if (req.method === "POST" && url.pathname === "/api/admin/user") {
        const user = await authedUser();
        if (!user || user.role !== "admin") return json(403, { error: "Admin only." });
        const { target, role, ban } = await req.json();
        const updates = [];
        const vals = [];
        if (role !== void 0) {
          updates.push("role=?");
          vals.push(role);
        }
        if (ban !== void 0) {
          updates.push("banned=?");
          vals.push(ban ? 1 : 0);
        }
        if (!updates.length) return json(400, { error: "No updates provided." });
        vals.push(target);
        await env.DB.prepare("UPDATE users SET " + updates.join(",") + " WHERE username=?").bind(...vals).run();
        return json(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/admin/promote") {
        const user = await authedUser();
        if (!user || user.role !== "admin") return json(403, { error: "Admin only." });
        const { target } = await req.json();
        await env.DB.prepare("UPDATE users SET role=? WHERE username=?").bind("mod", target).run();
        return json(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/admin/setup") {
        const body = await req.json().catch(() => ({}));
        const key = String(body.key || "");
        if (!env.SETUP_KEY || key !== env.SETUP_KEY) return json(403, { error: "Bad or missing setup key." });
        const name = String(body.username || "test").trim().toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(name)) return json(400, { error: "Username must be 3-20 of a-z 0-9 _" });
        const password = String(body.password || "");
        if (password.length < 4) return json(400, { error: "Password min 4 chars." });
        const salt = crypto.randomUUID();
        const ph = await hashPw(password, salt);
        const existing = await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(name).first();
        if (existing) {
          await env.DB.prepare("UPDATE users SET pass_hash=?, salt=?, role='admin', banned=0 WHERE id=?").bind(ph, salt, existing.id).run();
          return json(200, { ok: true, username: name, role: "admin", action: "password reset + promoted" });
        }
        await env.DB.prepare("INSERT INTO users(username,pass_hash,salt,role,banned,created_at,last_ip) VALUES(?,?,?,'admin',0,?,?)").bind(name, ph, salt, (/* @__PURE__ */ new Date()).toISOString(), ip).run();
        return json(200, { ok: true, username: name, role: "admin", action: "created" });
      }
      if (req.method === "POST" && url.pathname === "/api/register") {
        const { username, password } = await req.json();
        const u = String(username || "").trim().toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(u)) return json(400, { error: "Username 3-20: a-z 0-9 _" });
        if (!nameAllowed(u)) return json(400, { error: "That username is not allowed." });
        if (!password || password.length < 4) return json(400, { error: "Password min 4 chars." });
        const salt = crypto.randomUUID();
        const ph = await hashPw(password, salt);
        try {
          const r = await env.DB.prepare("INSERT INTO users(username,pass_hash,salt,created_at,last_ip) VALUES(?,?,?,?,?)").bind(u, ph, salt, (/* @__PURE__ */ new Date()).toISOString(), ip).run();
          const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
          await env.DB.prepare("INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)").bind(token, r.meta.last_row_id, (/* @__PURE__ */ new Date()).toISOString()).run();
          return json(200, { username: u, token, role: "user" });
        } catch {
          return json(400, { error: "Username taken." });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/login") {
        const { username, password } = await req.json();
        const u = String(username || "").trim().toLowerCase();
        const row = await env.DB.prepare("SELECT * FROM users WHERE username=?").bind(u).first();
        if (!row || await hashPw(password, row.salt) !== row.pass_hash)
          return json(401, { error: "Wrong username/password." });
        const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
        await env.DB.prepare("INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)").bind(token, row.id, (/* @__PURE__ */ new Date()).toISOString()).run();
        await env.DB.prepare("UPDATE users SET last_ip=? WHERE username=?").bind(ip, u).run();
        return json(200, { username: row.username, token, role: row.role || "user" });
      }
      if (req.method === "GET" && url.pathname === "/api/count") {
        const row = await env.DB.prepare("SELECT COUNT(*) c FROM users").first();
        return json(200, { users: row.c });
      }
      async function b2UploadPart(fileId, uploadUrl, partToken, partNum, bytes) {
        const hex = await sha1hex(bytes);
        const send = /* @__PURE__ */ __name(async (u, tok) => fetch(u, {
          method: "POST",
          headers: {
            Authorization: tok,
            "X-Bz-Part-Number": String(partNum),
            "Content-Length": String(bytes.byteLength),
            "X-Bz-Content-Sha1": hex
          },
          body: bytes
        }), "send");
        let r = await send(uploadUrl, partToken);
        if (!r.ok && (r.status === 401 || r.status === 503)) {
          const fresh = await b2freshPartUrl(fileId).catch(() => null);
          if (fresh) {
            await env.DB.prepare("UPDATE uploads SET b2_upload_url=?, b2_part_token=? WHERE b2_file_id=?").bind(fresh.uploadUrl, fresh.token, fileId).run();
            r = await send(fresh.uploadUrl, fresh.token);
          }
        }
        if (!r.ok) throw new Error("b2 part " + r.status);
        const j = await r.json();
        return j.contentSha1 || hex;
      }
      __name(b2UploadPart, "b2UploadPart");
      if (req.method === "POST" && url.pathname === "/api/uploads/start") {
        try {
          const user = await authedUser();
          if (!user) {
            return json(401, { error: "Sign in to upload." });
          }
          let body;
          try {
            body = await req.json();
          } catch (e) {
            return json(400, { error: "Invalid JSON body: " + e.message });
          }
          const { filename, mime, size, title, description, duration, visibility, scan } = body;
          const t = String(title || "").trim(), d = String(description || "").trim();
          if (!VIDEO_MIMES.includes(mime)) return json(400, { error: "Only MP4/WebM/MOV/MKV." });
          const ext = (String(filename || "").split(".").pop() || "").toLowerCase();
          if (!VIDEO_EXTS.includes(ext)) return json(400, { error: "Bad file extension." });
          if (!size || size <= 0 || size > MAX_VIDEO_BYTES) return json(400, { error: "Max 250MB per upload." });
          if (t.length < 1 || t.length > 100) return json(400, { error: "Title 1-100 chars." });
          if (d.length > 2e3) return json(400, { error: "Description max 2000 chars." });
          if (scan === "blocked") return json(400, { error: "Blocked: on-device scan flagged this video as explicit." });
          const verdict = scanText(t, d, filename);
          if (verdict === "severe" || verdict === "racism" || verdict === "extremism")
            return json(400, { error: "Blocked: prohibited content (" + verdict + "). Uploads like this get accounts banned." });
          if (!storageConfigured()) return json(500, { error: "B2 Storage not configured: Check B2_KEY_ID, B2_APP_KEY, and B2_BUCKET secrets." });
          let used = 0;
          try {
            const uRes = await env.DB.prepare("SELECT COALESCE(SUM(size),0) s FROM videos").first();
            used = uRes ? uRes.s : 0;
          } catch (e) {
            console.error("Quota check crash:", e);
          }
          if (used + size > STORAGE_QUOTA_BYTES) return json(400, { error: "Site storage full (free tier). Try a smaller file." });
          const id = crypto.randomUUID().slice(0, 12);
          const key = "v/" + id + "." + ext;
          const dur = Math.max(0, Math.min(36e3, parseFloat(duration) || 0));
          const vis = ["public", "unlisted", "private"].includes(visibility) ? visibility : "public";
          const simple = size <= CHUNK_BYTES;
          let fileId = "PENDING-SMALL", partUrl = { uploadUrl: "", token: "" };
          if (!simple) {
            try {
              const a = await b2auth();
              const st = await b2call("b2_start_large_file", { bucketId: a.bucketId, fileName: key, contentType: mime });
              fileId = st.fileId;
              partUrl = await b2freshPartUrl(fileId);
            } catch (e) {
              return json(500, { error: "B2 Start Large File failed: " + e.message });
            }
          }
          try {
            await env.DB.prepare(
              "INSERT INTO uploads(id,owner,title,description,storage_key,mime,size,duration,visibility,b2_file_id,b2_upload_url,b2_part_token,part_num,parts_json,uploaded,scan,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            ).bind(
              String(id),
              user.username,
              String(t),
              String(d),
              String(key),
              String(mime),
              Number(size),
              Number(dur),
              String(vis),
              String(fileId),
              String(partUrl.uploadUrl || ""),
              String(partUrl.token || ""),
              0,
              "[]",
              0,
              String(scan || "skipped"),
              (/* @__PURE__ */ new Date()).toISOString()
            ).run();
          } catch (e) {
            return json(500, { error: "D1 Insert Upload failed: " + e.message });
          }
          return json(200, { sessionId: id, chunkSize: CHUNK_BYTES });
        } catch (e) {
          console.error("UPLOAD_START_FATAL:", e);
          return json(500, { error: "Upload Start Fatal Error: " + e.message });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/uploads/chunk") {
        const userObj = await authedUser();
        if (!userObj) return json(401, { error: "Sign in to upload." });
        const username = userObj.username;
        const form = await req.formData();
        const sessionId = String(form.get("sessionId") || "");
        const off = parseInt(String(form.get("off") || "0"), 10) || 0;
        const chunk = form.get("chunk");
        const up = await env.DB.prepare("SELECT * FROM uploads WHERE id=?").bind(sessionId).first();
        if (!up) return json(404, { error: "Upload session not found." });
        if (up.owner !== username) return json(404, { error: "Upload session not found." });
        if (off < up.uploaded) return json(200, { uploaded: up.uploaded, size: up.size });
        if (off > up.uploaded) return json(400, { error: "Out of order — restart the upload." });
        if (!(chunk instanceof File) || chunk.size === 0 || chunk.size > CHUNK_BYTES + 1024)
          return json(400, { error: "Bad chunk." });
        if (up.uploaded + chunk.size > up.size) return json(400, { error: "Chunk overflow." });
        if (up.b2_file_id === "PENDING-SMALL") {
          if (off !== 0 || chunk.size !== up.size)
            return json(400, { error: "Out of order — restart the upload." });
          try {
            const bytes = await chunk.arrayBuffer();
            const put = await b2SmallPut(up.storage_key, bytes, up.mime);
            await env.DB.prepare("UPDATE uploads SET uploaded=?, b2_file_id=? WHERE id=?").bind(chunk.size, put.fileId, sessionId).run();
            return json(200, { uploaded: chunk.size, size: up.size });
          } catch (e) {
            console.error("b2 small put failed:", String(e && e.message || e));
            return json(500, { error: "Chunk failed (" + String(e && e.message || "storage") + ") — retrying resumes automatically." });
          }
        }
        const partNum = up.part_num + 1;
        let partSha;
        try {
          const bytes = await chunk.arrayBuffer();
          partSha = await b2UploadPart(up.b2_file_id, up.b2_upload_url, up.b2_part_token, partNum, bytes);
        } catch (e) {
          console.error("b2 part failed:", String(e && e.message || e));
          return json(500, { error: "Chunk failed (" + String(e && e.message || "storage") + ") — retrying resumes automatically." });
        }
        const parts = JSON.parse(up.parts_json || "[]");
        parts.push(partSha);
        const uploaded = up.uploaded + chunk.size;
        await env.DB.prepare("UPDATE uploads SET uploaded=?, part_num=?, parts_json=? WHERE id=?").bind(uploaded, partNum, JSON.stringify(parts), sessionId).run();
        return json(200, { uploaded, size: up.size });
      }
      if (req.method === "POST" && url.pathname === "/api/uploads/complete") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in to upload." });
        const form = await req.formData().catch(() => null);
        let body = {};
        if (form) body = { sessionId: String(form.get("sessionId") || ""), thumb: form.get("thumb") };
        else try {
          body = await req.json();
        } catch {
        }
        const up = await env.DB.prepare("SELECT * FROM uploads WHERE id=?").bind(body.sessionId).first();
        if (!up || up.owner !== user.username) return json(404, { error: "Upload session not found." });
        if (up.uploaded < up.size) return json(400, { error: "Upload incomplete — missing bytes." });
        const verdict = scanText(up.title, up.description, up.storage_key);
        const cancel = /* @__PURE__ */ __name(async () => {
          try {
            await b2call("b2_cancel_large_file", { fileId: up.b2_file_id });
          } catch {
          }
        }, "cancel");
        const finalize = /* @__PURE__ */ __name(async (status, flagReason, thumbKey2, thumbId2, fileId) => {
          if (status !== "clean") {
            await cancel();
          }
          await env.DB.prepare(
            "INSERT INTO videos(id,owner,title,description,r2_key,file_id,thumb_key,thumb_id,mime,size,duration,visibility,status,flag_reason,scan,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
          ).bind(
            up.id,
            user.username,
            up.title,
            up.description,
            status === "clean" ? up.storage_key : "",
            fileId || null,
            thumbKey2,
            thumbId2 || null,
            up.mime,
            up.size,
            up.duration,
            up.visibility,
            status,
            flagReason,
            up.scan,
            (/* @__PURE__ */ new Date()).toISOString()
          ).run();
          await env.DB.prepare("DELETE FROM uploads WHERE id=?").bind(up.id).run();
          if (status === "clean" && (up.visibility === "public" || up.visibility === "unlisted")) {
            try {
              const subs = (await env.DB.prepare("SELECT subscriber FROM subscriptions WHERE channel=? AND notify='all'").bind(user.username).all()).results;
              const now = (/* @__PURE__ */ new Date()).toISOString();
              for (const s of subs)
                await env.DB.prepare("INSERT INTO notifications(username,video_id,created_at) VALUES(?,?,?)").bind(s.subscriber, up.id, now).run();
            } catch {
            }
          }
        }, "finalize");
        if (verdict === "nsfw" || verdict === "gore") {
          await finalize("flagged", "auto-filter: " + verdict, null, null, null);
          return json(202, { id: up.id, status: "flagged", message: "Held for review: auto-filter matched (" + verdict + "). File discarded." });
        }
        if (up.part_num > 0) {
          try {
            await b2call("b2_finish_large_file", { fileId: up.b2_file_id, partSha1Array: JSON.parse(up.parts_json || "[]") });
          } catch (e) {
            console.error("b2 finish failed:", String(e && e.message || e));
            await cancel();
            await env.DB.prepare("DELETE FROM uploads WHERE id=?").bind(up.id).run();
            return json(500, { error: "Storage assemble failed (" + String(e && e.message || "unknown") + ") — try again." });
          }
        } else if (!up.b2_file_id || up.b2_file_id === "PENDING-SMALL") {
          return json(400, { error: "Upload incomplete — missing bytes." });
        }
        let thumbKey = null, thumbId = null;
        const thumb = body.thumb;
        if (thumb instanceof File && thumb.size > 0 && thumb.size < 5e6 && thumb.type.startsWith("image/")) {
          thumbKey = "t/" + up.id + ".jpg";
          try {
            const tb = await thumb.arrayBuffer();
            const put = await b2SmallPut(thumbKey, tb, "image/jpeg");
            thumbId = put.fileId;
          } catch {
            thumbKey = null;
          }
        }
        if (thumbKey && env.AI) {
          try {
            const buf = await thumb.arrayBuffer();
            const labels = await env.AI.run("@cf/microsoft/resnet-50", { image: [...new Uint8Array(buf)] });
            const risky = ["bikini", "maillot", "brassiere", "miniskirt", "nudity"];
            const top = (Array.isArray(labels) ? labels : []).slice(0, 3);
            if (top.some((l) => l.score > 0.5 && risky.some((r) => String(l.label || "").toLowerCase().includes(r)))) {
              try {
                await b2Delete(up.storage_key, up.b2_file_id);
              } catch {
              }
              if (thumbId) {
                try {
                  await b2Delete(thumbKey, thumbId);
                } catch {
                }
              }
              await finalize("flagged", "auto-vision: explicit thumbnail", null, null, null);
              return json(202, { id: up.id, status: "flagged", message: "Held for review: thumbnail failed the explicit-content check. File discarded." });
            }
          } catch {
          }
        }
        await finalize("clean", null, thumbKey, thumbId, up.b2_file_id);
        return json(200, { id: up.id, status: "clean", message: "Uploaded." });
      }
      if (req.method === "POST" && url.pathname === "/api/uploads/abort") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in." });
        const { sessionId } = await req.json();
        const up = await env.DB.prepare("SELECT * FROM uploads WHERE id=?").bind(sessionId).first();
        if (up && up.owner === user.username) {
          try {
            if (!up.b2_file_id || up.b2_file_id === "PENDING-SMALL") {
            } else if (up.part_num > 0) await b2call("b2_cancel_large_file", { fileId: up.b2_file_id });
            else await b2Delete(up.storage_key, up.b2_file_id);
          } catch {
          }
          await env.DB.prepare("DELETE FROM uploads WHERE id=?").bind(sessionId).run();
        }
        return json(200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/videos") {
        const owner = url.searchParams.get("owner");
        const requester = await authedUser();
        const vis = /* @__PURE__ */ __name((o) => requester && o && requester.username === o.toLowerCase() ? "status='clean' AND visibility IN ('public','unlisted','private')" : "status='clean' AND visibility='public'", "vis");
        try {
          const rows = owner ? (await env.DB.prepare("SELECT id,owner,title,description,mime,size,views,duration,visibility,created_at FROM videos WHERE " + vis(owner) + " AND owner=? ORDER BY created_at DESC LIMIT 50").bind(owner.toLowerCase()).all()).results : (await env.DB.prepare("SELECT id,owner,title,description,mime,size,views,duration,visibility,created_at FROM videos WHERE status='clean' AND visibility='public' ORDER BY created_at DESC LIMIT 50").all()).results;
          return json(200, { videos: rows || [] });
        } catch (e) {
          console.error("Video list error:", e);
          return json(500, { error: "Videos unavailable" });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/video") {
        try {
          const row = await env.DB.prepare("SELECT id,owner,title,description,mime,size,views,duration,visibility,created_at FROM videos WHERE id=? AND status='clean'").bind(url.searchParams.get("id")).first();
          if (!row) return json(404, { error: "Video not found." });
          if (row.visibility === "private") {
            const u2 = await authedUser();
            if (!u2 || u2.username !== row.owner) return json(404, { error: "Video not found." });
          }
          const likesRes = await env.DB.prepare("SELECT COUNT(*) as c FROM video_likes WHERE video_id=? AND kind='like'").bind(row.id).first();
          const likes = likesRes ? likesRes.c : 0;
          let reaction = "none";
          const u = await authedUser();
          if (u) {
            const mine = await env.DB.prepare("SELECT kind FROM video_likes WHERE video_id=? AND username=?").bind(row.id, u.username).first();
            if (mine) reaction = mine.kind;
          }
          return json(200, { video: row, likes, reaction });
        } catch (e) {
          console.error("Video detail error:", e);
          return json(500, { error: "Video unavailable" });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/user") {
        try {
          const name = String(url.searchParams.get("u") || "").toLowerCase();
          const row = await env.DB.prepare("SELECT username,created_at FROM users WHERE username=?").bind(name).first();
          if (!row) return json(404, { error: "Channel not found." });
          const nvRes = await env.DB.prepare("SELECT COUNT(*) as c FROM videos WHERE owner=? AND status='clean'").bind(name).first();
          const nv = nvRes ? nvRes.c : 0;
          return json(200, { user: { username: row.username, joined: row.created_at, videos: nv } });
        } catch (e) {
          console.error("User lookup error:", e);
          return json(500, { error: "User unavailable" });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/video/view") {
        const { id } = await req.json();
        await env.DB.prepare("UPDATE videos SET views=views+1 WHERE id=? AND status='clean'").bind(id).run();
        return json(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/video/react") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in to react." });
        const { id, kind } = await req.json();
        try {
          const vid = await env.DB.prepare("SELECT id FROM videos WHERE id=? AND status='clean'").bind(id).first();
          if (!vid) return json(404, { error: "Video not found." });
          if (kind === "none") await env.DB.prepare("DELETE FROM video_likes WHERE video_id=? AND username=?").bind(id, user.username).run();
          else if (kind === "like" || kind === "dislike") await env.DB.prepare(
            "INSERT INTO video_likes(video_id,username,kind,created_at) VALUES(?,?,?,?) ON CONFLICT(video_id,username) DO UPDATE SET kind=excluded.kind"
          ).bind(id, user.username, kind, (/* @__PURE__ */ new Date()).toISOString()).run();
          else return json(400, { error: "Bad reaction." });
          const lRes = await env.DB.prepare("SELECT COUNT(*) as c FROM video_likes WHERE video_id=? AND kind='like'").bind(id).first();
          const likes = lRes ? lRes.c : 0;
          const dRes = await env.DB.prepare("SELECT COUNT(*) as c FROM video_likes WHERE video_id=? AND kind='dislike'").bind(id).first();
          const dislikes = dRes ? dRes.c : 0;
          const mine = await env.DB.prepare("SELECT kind FROM video_likes WHERE video_id=? AND username=?").bind(id, user.username).first();
          return json(200, { likes, dislikes, reaction: mine ? mine.kind : "none" });
        } catch (e) {
          console.error("React error:", e);
          return json(500, { error: "Reaction failed" });
        }
      }
      if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/subscribe") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in to subscribe." });
        const q = req.method === "GET" ? Object.fromEntries(url.searchParams) : await req.json().catch(() => ({}));
        const channel = String(q.channel || "").trim().toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(channel)) return json(400, { error: "Bad channel." });
        if (channel === user.username) return json(400, { error: "That is your own channel." });
        try {
          const exists = await env.DB.prepare("SELECT username FROM users WHERE username=?").bind(channel).first();
          if (!exists) return json(404, { error: "Channel not found." });
          const action = String(q.action || "toggle");
          const row = await env.DB.prepare("SELECT notify FROM subscriptions WHERE channel=? AND subscriber=?").bind(channel, user.username).first();
          let subscribed = !!row;
          if (action === "sub") subscribed = true;
          else if (action === "unsub") subscribed = false;
          else if (q.notify === "all" || q.notify === "none") {
            if (!row) return json(400, { error: "Not subscribed." });
            await env.DB.prepare("UPDATE subscriptions SET notify=? WHERE channel=? AND subscriber=?").bind(q.notify, channel, user.username).run();
          } else subscribed = !subscribed;
          if (subscribed && !row)
            await env.DB.prepare("INSERT INTO subscriptions(channel,subscriber,notify,created_at) VALUES(?,?,'all',?)").bind(channel, user.username, (/* @__PURE__ */ new Date()).toISOString()).run();
          if (!subscribed && row)
            await env.DB.prepare("DELETE FROM subscriptions WHERE channel=? AND subscriber=?").bind(channel, user.username).run();
          const st = subscribed ? await env.DB.prepare("SELECT notify FROM subscriptions WHERE channel=? AND subscriber=?").bind(channel, user.username).first() : null;
          const nRes = await env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE channel=?").bind(channel).first();
          const n = nRes ? nRes.c : 0;
          return json(200, { subscribed, notify: st ? st.notify : "none", subscribers: n });
        } catch (e) {
          console.error("Subscribe error:", e);
          return json(500, { error: "Subscription failed" });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/substatus") {
        const channel = String(url.searchParams.get("channel") || "").toLowerCase();
        const user = await authedUser();
        try {
          const nRes = await env.DB.prepare("SELECT COUNT(*) c FROM subscriptions WHERE channel=?").bind(channel).first();
          const n = nRes ? nRes.c : 0;
          if (!user) return json(200, { subscribed: false, notify: "none", subscribers: n, own: false });
          const row = await env.DB.prepare("SELECT notify FROM subscriptions WHERE channel=? AND subscriber=?").bind(channel, user.username).first();
          return json(200, { subscribed: !!row, notify: row ? row.notify : "none", subscribers: n, own: channel === user.username });
        } catch (e) {
          console.error("Substatus crash:", e);
          return json(200, { subscribed: false, notify: "none", subscribers: 0, own: false, error: "temp" });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/subscriptions") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in." });
        try {
          const rows = (await env.DB.prepare("SELECT channel,notify FROM subscriptions WHERE subscriber=? ORDER BY channel").bind(user.username).all()).results;
          return json(200, { subscriptions: rows || [] });
        } catch (e) {
          console.error("Subscriptions list crash:", e);
          return json(200, { subscriptions: [] });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/channel") {
        try {
          const name = String(url.searchParams.get("u") || "").toLowerCase();
          const row = await env.DB.prepare("SELECT username,about,banner_key,avatar_key,created_at FROM users WHERE username=?").bind(name).first();
          if (!row) return json(404, { error: "Channel not found." });
          const nvRes = await env.DB.prepare("SELECT COUNT(*) as c FROM videos WHERE owner=? AND status='clean'").bind(name).first();
          const nv = nvRes ? nvRes.c : 0;
          const vRes = await env.DB.prepare("SELECT COALESCE(SUM(views),0) as s FROM videos WHERE owner=? AND status='clean'").bind(name).first();
          const views = vRes ? vRes.s : 0;
          const sRes = await env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE channel=?").bind(name).first();
          const subs = sRes ? sRes.c : 0;
          return json(200, { channel: {
            username: row.username,
            joined: row.created_at,
            videos: nv,
            views,
            subscribers: subs,
            about: row.about || "",
            banner: row.banner_key ? "/art/" + name + "/banner" : null,
            avatar: row.avatar_key ? "/art/" + name + "/avatar" : null
          } });
        } catch (e) {
          console.error("Channel fetch error:", e);
          return json(500, { error: "Channel unavailable" });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/channel/edit") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in." });
        const form = await req.formData().catch(() => null);
        let about = null, banner = null, avatar = null;
        if (form) {
          const ab = form.get("about");
          about = ab == null ? null : String(ab).slice(0, 1e3);
          const bf = form.get("banner"), af = form.get("avatar");
          if (bf instanceof File && bf.size > 0) banner = bf;
          if (af instanceof File && af.size > 0) avatar = af;
        } else {
          try {
            const j = await req.json();
            about = j.about == null ? null : String(j.about).slice(0, 1e3);
          } catch {
          }
        }
        if (!storageConfigured() && (banner || avatar)) return json(500, { error: "Video storage not configured." });
        const sets = [], vals = [];
        if (about !== null) {
          sets.push("about=?");
          vals.push(about);
        }
        for (const [file, kind] of [[banner, "banner"], [avatar, "avatar"]]) {
          if (!(file instanceof File)) continue;
          if (file.size > 5e6 || !file.type.startsWith("image/")) return json(400, { error: kind + " must be an image under 5MB." });
          const buf = await file.arrayBuffer();
          await b2SmallPut("a/" + user.username + "/" + kind + ".jpg", buf, "image/jpeg");
          sets.push(kind + "_key=?");
          vals.push("a/" + user.username + "/" + kind + ".jpg");
        }
        if (!sets.length) return json(400, { error: "Nothing to update." });
        vals.push(user.username);
        await env.DB.prepare("UPDATE users SET " + sets.join(",") + " WHERE username=?").bind(...vals).run();
        return json(200, { ok: true });
      }
      if (req.method === "GET" && url.pathname.startsWith("/art/")) {
        const parts = url.pathname.slice(5).split("/");
        const uname = (parts[0] || "").toLowerCase(), kind = parts[1];
        if (!["banner", "avatar"].includes(kind)) return new Response("Not found", { status: 404 });
        const row = await env.DB.prepare("SELECT " + (kind === "banner" ? "banner_key" : "avatar_key") + " AS k FROM users WHERE username=?").bind(uname).first();
        if (!row || !row.k || !storageConfigured()) return new Response("Not found", { status: 404 });
        try {
          const play = await b2PlayUrl(row.k, 86400);
          return Response.redirect(play, 302);
        } catch {
          return new Response("Not found", { status: 404 });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/notifications") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in." });
        try {
          let notifications = [];
          let unread = 0;
          const nRes = await env.DB.prepare(
            "SELECT id, video_id, created_at, read FROM notifications WHERE username=? ORDER BY id DESC LIMIT 30"
          ).bind(user.username).all();
          if (nRes && nRes.results) {
            notifications = nRes.results;
            if (notifications.length > 0) {
              const videoIds = notifications.map((n) => n.video_id).filter((id) => !!id);
              if (videoIds.length > 0) {
                const placeholders = videoIds.map(() => "?").join(",");
                const vRes = await env.DB.prepare(
                  `SELECT id, title, owner FROM videos WHERE id IN (${placeholders})`
                ).bind(...videoIds).all();
                const videoMap = {};
                if (vRes && vRes.results) {
                  vRes.results.forEach((v) => {
                    if (v && v.id) videoMap[v.id] = { title: v.title, owner: v.owner };
                  });
                }
                notifications.forEach((n) => {
                  const v = videoMap[n.video_id] || { title: "Deleted Video", owner: "unknown" };
                  n.title = v.title || "Unknown Title";
                  n.owner = v.owner || "unknown";
                });
              }
            }
          }
          const uRes = await env.DB.prepare("SELECT COUNT(*) as c FROM notifications WHERE username=? AND read=0").bind(user.username).first();
          unread = uRes && uRes.c !== void 0 ? uRes.c : 0;
          return json(200, { notifications, unread });
        } catch (e) {
          console.error("CRITICAL_NOTIF_ERROR:", e);
          return json(200, { notifications: [], unread: 0, warning: "temporary unavailable" });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/notifications/read") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in." });
        const { ids } = await req.json().catch(() => ({}));
        if (Array.isArray(ids) && ids.length)
          await env.DB.prepare("UPDATE notifications SET read=1 WHERE username=? AND id IN (" + ids.map(() => "?").join(",") + ")").bind(user.username, ...ids.map(Number).filter((n) => n > 0)).run();
        else
          await env.DB.prepare("UPDATE notifications SET read=1 WHERE username=?").bind(user.username).run();
        return json(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/admin/update") {
        const user = await authedUser();
        if (!user || (await env.DB.prepare("SELECT role FROM users WHERE username=?").bind(user.username).first()).role !== "admin")
          return json(403, { error: "Admin only." });
        const { target, role, banned, poison: poison2 } = await req.json();
        if (!target) return json(400, { error: "Target required." });
        const sets = [];
        const vals = [];
        if (role !== void 0) {
          sets.push("role=?");
          vals.push(role);
        }
        if (banned !== void 0) {
          sets.push("banned=?");
          vals.push(banned ? 1 : 0);
        }
        if (poison2 === true) {
          const userRow = await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(target).first();
          if (userRow) {
            const uip = await env.DB.prepare("SELECT last_ip FROM users WHERE id=?").bind(userRow.id).first();
            if (uip && uip.last_ip) {
              await env.DB.prepare("INSERT OR REPLACE INTO poison_bans(ip,created_at) VALUES(?,?)").bind(uip.last_ip, (/* @__PURE__ */ new Date()).toISOString()).run();
            }
          }
        }
        if (!sets.length && poison2 !== true) return json(400, { error: "Nothing to update." });
        vals.push(target);
        if (sets.length) await env.DB.prepare("UPDATE users SET " + sets.join(",") + " WHERE username=?").bind(...vals).run();
        return json(200, { ok: true });
      }
      if (req.method === "GET" && url.pathname.startsWith("/v/")) {
        const id = url.pathname.slice(3);
        const row = await env.DB.prepare("SELECT r2_key,owner,visibility FROM videos WHERE id=? AND status='clean'").bind(id).first();
        if (!row || !row.r2_key || !storageConfigured()) return new Response("Not found", { status: 404 });
        if (row.visibility === "private") {
          const u = await authedUser();
          if (!u || u.username !== row.owner) return new Response("Not found", { status: 404 });
        }
        try {
          const play = await b2PlayUrl(row.r2_key, 3600);
          return Response.redirect(play, 302);
        } catch {
          return new Response("Not found", { status: 404 });
        }
      }
      if (req.method === "GET" && url.pathname.startsWith("/t/")) {
        const id = url.pathname.slice(3);
        const row = await env.DB.prepare("SELECT thumb_key,owner,visibility FROM videos WHERE id=? AND status='clean'").bind(id).first();
        if (!row || !row.thumb_key || !storageConfigured()) return new Response("Not found", { status: 404 });
        if (row.visibility === "private") {
          const u = await authedUser();
          if (!u || u.username !== row.owner) return new Response("Not found", { status: 404 });
        }
        try {
          const play = await b2PlayUrl(row.thumb_key, 86400);
          return Response.redirect(play, 302);
        } catch {
          return new Response("Not found", { status: 404 });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/comments") {
        try {
          const vid = url.searchParams.get("video");
          const res = await env.DB.prepare("SELECT user,text,created_at FROM comments WHERE video_id=? AND status='clean' ORDER BY id DESC LIMIT 50").bind(vid).all();
          const rows = res && res.results ? res.results : [];
          return json(200, { comments: rows });
        } catch (e) {
          console.error("Comments fetch error:", e);
          return json(500, { error: "Comments unavailable" });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/comments") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in to comment." });
        const { video_id, text } = await req.json();
        const t = String(text || "").trim();
        if (!t || t.length > 500) return json(400, { error: "Comment 1-500 chars." });
        const vid = await env.DB.prepare("SELECT id FROM videos WHERE id=? AND status='clean'").bind(video_id).first();
        if (!vid) return json(404, { error: "Video not found." });
        const verdict = scanText(t);
        if (verdict === "severe") return json(400, { error: "Blocked: prohibited content. This was logged." });
        if (verdict !== "clean") return json(400, { error: "Blocked by comment filter (" + verdict + "). Keep it clean." });
        const recent = await env.DB.prepare("SELECT created_at FROM comments WHERE user=? ORDER BY id DESC LIMIT 1").bind(user.username).first();
        if (recent && Date.now() - new Date(recent.created_at).getTime() < 5e3)
          return json(429, { error: "Slow down — 5s between comments." });
        await env.DB.prepare("INSERT INTO comments(video_id,user,text,status,created_at) VALUES(?,?,?,'clean',?)").bind(video_id, user.username, t, (/* @__PURE__ */ new Date()).toISOString()).run();
        return json(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/video/delete") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in." });
        const { id } = await req.json();
        const row = await env.DB.prepare("SELECT r2_key,file_id,thumb_key,thumb_id,owner FROM videos WHERE id=?").bind(id).first();
        if (!row || row.owner !== user.username) return json(404, { error: "Video not found." });
        if (storageConfigured()) {
          await b2Delete(row.r2_key, row.file_id);
          if (row.thumb_key) await b2Delete(row.thumb_key, row.thumb_id);
        }
        await env.DB.prepare("DELETE FROM comments WHERE video_id=?").bind(id).run();
        await env.DB.prepare("DELETE FROM videos WHERE id=?").bind(id).run();
        return json(200, { ok: true });
      }
      return json(404, { error: "not found" });
    } catch (e) {
      console.error("TOP_LEVEL_WORKER_ERROR:", e);
      return new Response(JSON.stringify({ error: "critical server error: " + e.message }), {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        }
      });
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map