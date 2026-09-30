var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// IP addresses are never stored or displayed in plaintext. Each IP is run through
// a keyed HMAC-SHA256, so the database only ever holds a one-way fingerprint. The
// key lives in the IP_HASH_KEY secret, which means a database dump cannot be
// reversed back into real addresses, and the poison-ban lookup keeps working
// because both sides of the comparison are hashed the same way.
async function hashIp(env, ip) {
  if (!ip || ip === "unknown") return "unknown";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.IP_HASH_KEY || "firfall-ip-fallback"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(ip)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashIp, "hashIp");

// Shown in the admin panel instead of an address: a short, stable fingerprint.
// Two accounts with the same fingerprint are on the same network, which is the
// only thing a moderator actually needs, and it discloses no address.
function ipFingerprint(stored) {
  if (!stored || stored === "unknown") return "-";
  if (!/^[0-9a-f]{64}$/.test(stored)) return "legacy (unhashed)";
  return stored.slice(0, 12) + "…";
}
__name(ipFingerprint, "ipFingerprint");

// Everything the ban screen needs about a ban, in one shape. The reason falls back
// to a generic line rather than null so the screen never renders a blank field,
// which would read as "banned for no stated reason" and invite a pointless appeal.
function banInfo(row) {
  const reason = row && row.ban_reason ? String(row.ban_reason).trim() : "";
  return {
    username: (row && row.username) || null,
    reason: reason || "Breaking the FirFall community rules.",
    bannedAt: (row && row.banned_at) || null,
    bannedBy: (row && row.banned_by) || "FirFall moderators",
    generic: !reason,
  };
}
__name(banInfo, "banInfo");

// Moderators and admins both get the report queue. The role value written by the
// panel was "mod" while the badge in the UI checked for "moderator", so the two
// never agreed and the mod badge could not have appeared. "mod" is canonical
// here and the badge was corrected to match.
function isStaff(role) {
  return role === "admin" || role === "mod";
}
__name(isStaff, "isStaff");

const REPORT_REASONS = /* @__PURE__ */ ["spam", "harassment", "hate", "sexual", "violence", "scam", "other"];
__name(REPORT_REASONS, "REPORT_REASONS");

// A network ban must never be able to lock out the person who can undo it. The
// poison check runs before all routing, so without this an admin who poisons a
// shared address (their own included) can never reach /api/admin/update again
// and the site is bricked until someone edits D1 by hand. Only consulted once a
// ban has actually matched, so the extra query costs nothing on normal traffic.
async function roleFromToken(env, req) {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer (.+)$/);
  const tok = m ? m[1] : null;
  if (!tok) return null;
  const row = await env.DB.prepare(
    "SELECT u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?"
  ).bind(tok).first();
  return row ? row.role : null;
}
__name(roleFromToken, "roleFromToken");

// src/index.js
var index_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    const ipHash = await hashIp(env, ip);
    const poison = await env.DB.prepare("SELECT 1 FROM poison_bans WHERE ip=?").bind(ipHash).first();
    if (poison) {
      // Two escape hatches, or a network ban becomes an unrecoverable brick:
      // an admin session already in hand, and the login endpoint itself. Without
      // the latter, poisoning your own address locks you out of the panel AND
      // blocks you from ever minting a token to undo it. Reaching /api/login
      // grants nothing, since every other route is still behind the wall.
      let bypass = url.pathname === "/api/login";
      if (!bypass) {
        try {
          bypass = (await roleFromToken(env, req)) === "admin";
        } catch {
        }
      }
      if (!bypass) return new Response(JSON.stringify({ error: "Your network is banned from this site." }), {
        status: 403,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
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
    const storageConfigured = /* @__PURE__ */ __name(() => !!(env.S3_KEY_ID && env.S3_APP_KEY && env.S3_BUCKET), "storageConfigured");
    const S3_ENDPOINT = "https://t3.storage.dev";
    const S3_HOST = "t3.storage.dev";
    const S3_REGION = "auto";
    const S3_SERVICE = "s3";
    const awsEnc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
    const encPath = (p) => String(p).split("/").map(awsEnc).join("/");
    const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
    async function sha256hex(buf) {
      const data = typeof buf === "string" ? new TextEncoder().encode(buf) : buf;
      return toHex(await crypto.subtle.digest("SHA-256", data));
    }
    async function hmacRaw(key, msg) {
      const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
    }
    async function s3SigningKey(secret, short) {
      let k = await hmacRaw(new TextEncoder().encode("AWS4" + secret), short);
      k = await hmacRaw(k, S3_REGION);
      k = await hmacRaw(k, S3_SERVICE);
      return await hmacRaw(k, "aws4_request");
    }
    function s3Qs(q) {
      const parts = [];
      for (const k of Object.keys(q)) {
        if (q[k] === undefined || q[k] === null) continue;
        parts.push(awsEnc(k) + "=" + awsEnc(String(q[k])));
      }
      return parts.sort().join("&");
    }
    async function s3Sign(method, path, query, options) {
      const o = options || {};
      const presign = !!o.presign;
      const iso = (/* @__PURE__ */ new Date()).toISOString();
      const stamp = iso.replace(/[:-]|\.\d{3}/g, "");
      const short = iso.slice(0, 10).replace(/-/g, "");
      const cred = env.S3_KEY_ID + "/" + short + "/" + S3_REGION + "/" + S3_SERVICE + "/aws4_request";
      const q = Object.assign({}, query || {});
      if (presign) {
        q["X-Amz-Algorithm"] = "AWS4-HMAC-SHA256";
        q["X-Amz-Credential"] = cred;
        q["X-Amz-Date"] = stamp;
        q["X-Amz-Expires"] = String(o.expires || 3600);
        q["X-Amz-SignedHeaders"] = "host";
      }
      const hasBody = o.body !== undefined && o.body !== null;
      const payloadHash = presign ? "UNSIGNED-PAYLOAD" : await sha256hex(hasBody ? o.body : new Uint8Array());
      const hdrs = Object.assign({ host: S3_HOST }, o.headers || {});
      if (!presign) {
        hdrs["X-Amz-Date"] = stamp;
        if (hasBody) hdrs["x-amz-content-sha256"] = payloadHash;
      }
      const names = Object.keys(hdrs).map((h) => h.toLowerCase()).sort();
      const canonicalHeaders = names.map((n) => {
        const orig = Object.keys(hdrs).find((h) => h.toLowerCase() === n);
        return n + ":" + String(hdrs[orig]).trim() + "\n";
      }).join("");
      const signedHeaders = names.join(";");
      const canonicalRequest = [method, encPath(path), s3Qs(q), canonicalHeaders, signedHeaders, payloadHash].join("\n");
      const scope = short + "/" + S3_REGION + "/" + S3_SERVICE + "/aws4_request";
      const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, await sha256hex(canonicalRequest)].join("\n");
      const sig = toHex(await hmacRaw(await s3SigningKey(env.S3_APP_KEY, short), stringToSign));
      const qs = s3Qs(q);
      const url = S3_ENDPOINT + path + (qs ? "?" + qs : "");
      if (presign) return url + (qs ? "&" : "?") + "X-Amz-Signature=" + sig;
      const out = {};
      for (const h of Object.keys(hdrs)) if (h.toLowerCase() !== "host") out[h] = hdrs[h];
      out["Authorization"] = "AWS4-HMAC-SHA256 Credential=" + cred + ", SignedHeaders=" + signedHeaders + ", Signature=" + sig;
      return { url, headers: out };
    }
    function s3KeyPath(key) {
      return "/" + env.S3_BUCKET + "/" + key;
    }
    function xmlTag(text, tag) {
      const m = String(text).match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
      return m ? m[1] : null;
    }
    async function s3Request(method, key, o) {
      const opts = o || {};
      const signed = await s3Sign(method, s3KeyPath(key), opts.query || {}, opts);
      const init = { method, headers: signed.headers };
      if (opts.body !== undefined && opts.body !== null) init.body = opts.body;
      return await fetch(signed.url, init);
    }
    async function s3CreateMultipart(key, mime) {
      const r = await s3Request("POST", key, { query: { uploads: "" }, headers: { "content-type": mime } });
      const text = await r.text();
      if (!r.ok) throw new Error("s3 create multipart " + r.status + " " + text.slice(0, 200));
      const id = xmlTag(text, "UploadId");
      if (!id) throw new Error("s3 create multipart returned no UploadId");
      return id;
    }
    async function s3UploadPart(key, uploadId, partNum, bytes) {
      const r = await s3Request("PUT", key, { query: { partNumber: String(partNum), uploadId }, body: bytes });
      if (!r.ok) throw new Error("s3 part " + r.status + " " + (await r.text().catch(() => "")).slice(0, 200));
      return r.headers.get("ETag") || "";
    }
    async function s3CompleteMultipart(key, uploadId, etags) {
      const xml = "<CompleteMultipartUpload>" + (etags || []).map((e, i) => "<Part><PartNumber>" + (i + 1) + "</PartNumber><ETag>" + e + "</ETag></Part>").join("") + "</CompleteMultipartUpload>";
      const r = await s3Request("POST", key, { query: { uploadId }, body: xml, headers: { "content-type": "application/xml" } });
      const text = await r.text();
      if (!r.ok) throw new Error("s3 complete " + r.status + " " + text.slice(0, 300));
      if (/<Error>/i.test(text)) throw new Error("s3 complete reported an error: " + text.slice(0, 300));
      return text;
    }
    async function s3AbortMultipart(key, uploadId) {
      if (!uploadId) return;
      try {
        await s3Request("DELETE", key, { query: { uploadId } });
      } catch {
      }
    }
    async function s3Put(key, bytes, mime) {
      const r = await s3Request("PUT", key, { body: bytes, headers: { "content-type": mime } });
      if (!r.ok) throw new Error("s3 put " + r.status + " " + (await r.text().catch(() => "")).slice(0, 200));
      return r.headers.get("ETag") || null;
    }
    async function s3Delete(key) {
      if (!key) return;
      try {
        await s3Request("DELETE", key);
      } catch {
      }
    }
    async function s3PresignGet(key, seconds) {
      return await s3Sign("GET", s3KeyPath(key), {}, { presign: true, expires: seconds || 3600 });
    }
    const MAX_VIDEO_BYTES = 25e7;
    const CHUNK_BYTES = 6e6;
    const STORAGE_QUOTA_BYTES = 4.5e9;
    // A phone gallery is full of formats a laptop never sees: 3GP from the
    // stock camera app, M4V and MPEG from older Androids, TS from screen
    // recorders, AVI and OGV from shareware encoders. Listing only the four
    // desktop formats meant a legitimate phone upload was refused at the door
    // with a message about MP4 while the file sat right there in the gallery.
    const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/3gpp", "video/x-m4v", "video/mp2t", "video/mpeg", "video/ogg", "video/x-msvideo", "video/x-flv", "video/3gpp2"];
    const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv", "3gp", "3gpp", "m4v", "ts", "mts", "m2ts", "avi", "ogv", "ogg", "mpg", "mpeg", "flv", "wmv", "3g2"];
    try {
      if (req.method === "GET" && url.pathname === "/api/admin/users") {
        const user = await authedUser();
        if (!user || user.role !== "admin") return json(403, { error: "Admin only." });
        const rows = (await env.DB.prepare("SELECT id,username,role,banned,about,created_at,last_ip FROM users ORDER BY created_at DESC").all()).results;
        for (const row of rows) row.last_ip = ipFingerprint(row.last_ip);
        return json(200, { users: rows });
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
        await env.DB.prepare("INSERT INTO users(username,pass_hash,salt,role,banned,created_at,last_ip) VALUES(?,?,?,'admin',0,?,?)").bind(name, ph, salt, (/* @__PURE__ */ new Date()).toISOString(), ipHash).run();
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
          const r = await env.DB.prepare("INSERT INTO users(username,pass_hash,salt,created_at,last_ip) VALUES(?,?,?,?,?)").bind(u, ph, salt, (/* @__PURE__ */ new Date()).toISOString(), ipHash).run();
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
        if (row.banned) {
          // Password was correct, so this is that person, not a guesser: safe to
          // reveal the ban. No session token is issued, which is what keeps a
          // banned account from acting on the site. They do get a single-purpose
          // appeal token, because refusing them a token would otherwise leave no
          // way to appeal at all.
          const appealToken = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
          await env.DB.prepare("INSERT INTO ban_tokens(token,username,created_at) VALUES(?,?,?)").bind(appealToken, row.username, (/* @__PURE__ */ new Date()).toISOString()).run();
          await env.DB.prepare("UPDATE users SET last_ip=? WHERE username=?").bind(ipHash, u).run();
          return json(403, { error: "Banned.", banned: true, ban: banInfo(row), appealToken });
        }
        const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
        await env.DB.prepare("INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)").bind(token, row.id, (/* @__PURE__ */ new Date()).toISOString()).run();
        await env.DB.prepare("UPDATE users SET last_ip=? WHERE username=?").bind(ipHash, u).run();
        return json(200, { username: row.username, token, role: row.role || "user" });
      }
      if (req.method === "GET" && url.pathname === "/api/me") {
        // Deliberately does not reuse authedUser(): that one returns null for a
        // banned account, which would make /api/me answer 401 and the client
        // conclude it was merely signed out. A ban has to be reported as a ban,
        // including to someone who was already signed in when it happened.
        const h2 = req.headers.get("Authorization") || "";
        const m2 = h2.match(/^Bearer (.+)$/);
        const tok2 = m2 ? m2[1] : url.searchParams.get("token");
        if (tok2) {
          const row2 = await env.DB.prepare("SELECT u.username,u.role,u.banned,u.ban_reason,u.banned_at,u.banned_by FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?").bind(tok2).first();
          if (row2) {
            if (row2.banned) return json(200, { username: row2.username, banned: true, ban: banInfo(row2) });
            return json(200, { username: row2.username, role: row2.role || "user" });
          }
        }
        return json(401, { error: "Not signed in." });
      }
      if (req.method === "POST" && url.pathname === "/api/appeal") {
        const { appealToken, message } = await req.json().catch(() => ({}));
        if (!appealToken) return json(400, { error: "Missing appeal token. Sign in again from the ban screen." });
        const holder = await env.DB.prepare("SELECT username FROM ban_tokens WHERE token=?").bind(String(appealToken)).first();
        if (!holder) return json(403, { error: "That appeal link is no longer valid. Sign in again to appeal." });
        const target = await env.DB.prepare("SELECT banned FROM users WHERE username=?").bind(holder.username).first();
        if (!target || !target.banned) return json(403, { error: "This account is not banned." });
        const existing = await env.DB.prepare("SELECT id FROM appeals WHERE username=? AND status='open'").bind(holder.username).first();
        if (existing) return json(409, { error: "You already have an appeal under review." });
        const text = String(message || "").trim().slice(0, 2000);
        if (text.length < 10) return json(400, { error: "Tell the moderators a bit more, at least 10 characters." });
        await env.DB.prepare("INSERT INTO appeals(username,message,status,created_at) VALUES(?,?,'open',?)").bind(holder.username, text, (/* @__PURE__ */ new Date()).toISOString()).run();
        // Single use: a resolved appeal should require a fresh sign-in to file again.
        await env.DB.prepare("DELETE FROM ban_tokens WHERE token=?").bind(String(appealToken)).run();
        return json(200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/appeal/status") {
        const { appealToken } = Object.fromEntries(url.searchParams);
        if (!appealToken) return json(400, { error: "Missing token." });
        const holder = await env.DB.prepare("SELECT username FROM ban_tokens WHERE token=?").bind(appealToken).first();
        const name = holder ? holder.username : null;
        if (!name) return json(200, { status: "none" });
        const row = await env.DB.prepare("SELECT status,reply FROM appeals WHERE username=? ORDER BY id DESC LIMIT 1").bind(name).first();
        if (!row) return json(200, { status: "none" });
        return json(200, { status: row.status, reply: row.reply || null });
      }
      if (req.method === "GET" && url.pathname === "/api/count") {
        const row = await env.DB.prepare("SELECT COUNT(*) c FROM users").first();
        return json(200, { users: row.c });
      }
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
          // Embers are the vertical clips recorded in the mobile app. They go
          // through exactly the same validation, quota and moderation scan as
          // any other upload; the only difference is which feed they appear in.
          const kind = body.kind === "ember" ? "ember" : "video";
          // Embers are short by definition. The client already stops the
          // recording at EMBER_MAX_SECONDS and refuses longer picks, but the
          // duration is typed by the client, so it is re-checked here: an
          // ordinary video pretending to be an ember would otherwise show up
          // stretched in the vertical feed. Real durations can round a hair
          // over the limit, hence the small tolerance.
          const EMBER_MAX_SECONDS = 60;
          const dur = Math.max(0, Math.min(36e3, parseFloat(duration) || 0));
          if (kind === "ember" && dur > EMBER_MAX_SECONDS + 1.5)
            return json(400, { error: "Embers are " + EMBER_MAX_SECONDS + " seconds or less. Trim the clip and try again." });
          const t = String(title || "").trim(), d = String(description || "").trim();
          if (!VIDEO_MIMES.includes(mime)) return json(400, { error: "That file is not a video this site accepts (" + mime + "). Try MP4, WebM, MOV, MKV, 3GP, M4V, TS, AVI or OGV." });
          // The extension is what the storage key and the content type are
          // built from, so it is taken from the file itself when it has one.
          const named = (String(filename || "").split(".").pop() || "").toLowerCase();
          const ext = VIDEO_EXTS.includes(named) ? named : (mime === "video/mp2t" ? "ts" : mime === "video/3gpp" ? "3gp" : mime === "video/x-m4v" ? "m4v" : mime === "video/ogg" ? "ogv" : mime === "video/x-msvideo" ? "avi" : mime === "video/mpeg" ? "mpg" : mime === "video/x-flv" ? "flv" : "mp4");
          if (!VIDEO_EXTS.includes(ext)) return json(400, { error: "Bad file extension." });
          if (!size || size <= 0 || size > MAX_VIDEO_BYTES) return json(400, { error: "Max 250MB per upload." });
          if (t.length < 1 || t.length > 100) return json(400, { error: "Title 1-100 chars." });
          if (d.length > 2e3) return json(400, { error: "Description max 2000 chars." });
          if (scan === "blocked") return json(400, { error: "Blocked: on-device scan flagged this video as explicit." });
          const verdict = scanText(t, d, filename);
          if (verdict === "severe" || verdict === "racism" || verdict === "extremism")
            return json(400, { error: "Blocked: prohibited content (" + verdict + "). Uploads like this get accounts banned." });
          if (!storageConfigured()) return json(500, { error: "Tigris storage not configured: check S3_KEY_ID, S3_APP_KEY, and S3_BUCKET secrets." });
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
          const vis = ["public", "unlisted", "private"].includes(visibility) ? visibility : "public";
          const simple = size <= CHUNK_BYTES;
          let fileId = "PENDING-SMALL";
          if (!simple) {
            try {
              fileId = await s3CreateMultipart(key, mime);
            } catch (e) {
              return json(500, { error: "Tigris could not start a multipart upload: " + e.message });
            }
          }
          try {
            await env.DB.prepare(
              "INSERT INTO uploads(id,owner,title,description,storage_key,mime,size,duration,visibility,b2_file_id,b2_upload_url,b2_part_token,part_num,parts_json,uploaded,scan,kind,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
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
              "",
              "",
              0,
              "[]",
              0,
              String(scan || "skipped"),
              String(kind),
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
        if (up.size <= CHUNK_BYTES) {
          if (off !== 0 || chunk.size !== up.size)
            return json(400, { error: "Out of order — restart the upload." });
          try {
            const bytes = await chunk.arrayBuffer();
            const etag = await s3Put(up.storage_key, bytes, up.mime);
            await env.DB.prepare("UPDATE uploads SET uploaded=?, b2_file_id=? WHERE id=?").bind(chunk.size, etag || "PENDING-SMALL", sessionId).run();
            return json(200, { uploaded: chunk.size, size: up.size });
          } catch (e) {
            console.error("tigris put failed:", String(e && e.message || e));
            return json(500, { error: "Chunk failed (" + String(e && e.message || "storage") + ") — retrying resumes automatically." });
          }
        }
        const partNum = up.part_num + 1;
        let partEtag;
        try {
          const bytes = await chunk.arrayBuffer();
          partEtag = await s3UploadPart(up.storage_key, up.b2_file_id, partNum, bytes);
        } catch (e) {
          console.error("tigris part failed:", String(e && e.message || e));
          return json(500, { error: "Chunk failed (" + String(e && e.message || "storage") + ") — retrying resumes automatically." });
        }
        const parts = JSON.parse(up.parts_json || "[]");
        parts.push(partEtag);
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
          if (up.part_num > 0) await s3AbortMultipart(up.storage_key, up.b2_file_id);
          else await s3Delete(up.storage_key);
        }, "cancel");
        const finalize = /* @__PURE__ */ __name(async (status, flagReason, thumbKey2, thumbId2, fileId) => {
          if (status !== "clean") {
            await cancel();
          }
          await env.DB.prepare(
            "INSERT INTO videos(id,owner,title,description,r2_key,file_id,thumb_key,thumb_id,mime,size,duration,visibility,status,flag_reason,scan,kind,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
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
            up.kind === "ember" ? "ember" : "video",
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
            await s3CompleteMultipart(up.storage_key, up.b2_file_id, JSON.parse(up.parts_json || "[]"));
          } catch (e) {
            console.error("tigris complete failed:", String(e && e.message || e));
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
            thumbId = await s3Put(thumbKey, tb, "image/jpeg");
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
              await s3Delete(up.storage_key);
              if (thumbId) {
                await s3Delete(thumbKey);
              }
              await finalize("flagged", "auto-vision: explicit thumbnail", null, null, null);
              return json(202, { id: up.id, status: "flagged", message: "Held for review: thumbnail failed the explicit-content check. File discarded." });
            }
          } catch {
          }
        }
        await finalize("clean", null, thumbKey, thumbId, null);
        return json(200, { id: up.id, status: "clean", message: "Uploaded." });
      }
      if (req.method === "POST" && url.pathname === "/api/uploads/abort") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in." });
        const { sessionId } = await req.json();
        const up = await env.DB.prepare("SELECT * FROM uploads WHERE id=?").bind(sessionId).first();
        if (up && up.owner === user.username) {
          if (up.b2_file_id && up.b2_file_id !== "PENDING-SMALL") {
            try {
              if (up.part_num > 0) await s3AbortMultipart(up.storage_key, up.b2_file_id);
              else await s3Delete(up.storage_key);
            } catch {
            }
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
          const SORTS = { new: "created_at DESC", old: "created_at ASC", popular: "views DESC, created_at DESC" };
          const sort = SORTS[url.searchParams.get("sort")] || SORTS.new;
          const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50));
          const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
          const COLS = "id,owner,title,description,mime,size,views,duration,visibility,created_at,kind";
          // kind=ember is an explicit filter; kind=video excludes embers so the
          // normal feed does not fill up with vertical clips. With no kind
          // parameter everything comes back, which is what the desktop site
          // and the older app calls expect.
          const KINDS = { video: " AND kind='video'", ember: " AND kind='ember'" };
          const kindSql = KINDS[url.searchParams.get("kind")] || "";
          const rows = owner ? (await env.DB.prepare("SELECT " + COLS + " FROM videos WHERE " + vis(owner) + " AND owner=?" + kindSql + " ORDER BY " + sort + " LIMIT ? OFFSET ?").bind(owner.toLowerCase(), limit, offset).all()).results : (await env.DB.prepare("SELECT " + COLS + " FROM videos WHERE status='clean' AND visibility='public'" + kindSql + " ORDER BY " + sort + " LIMIT ? OFFSET ?").bind(limit, offset).all()).results;
          const total = owner ? (await env.DB.prepare("SELECT COUNT(*) as c FROM videos WHERE " + vis(owner) + " AND owner=?" + kindSql).bind(owner.toLowerCase()).first()).c : (await env.DB.prepare("SELECT COUNT(*) as c FROM videos WHERE status='clean' AND visibility='public'" + kindSql).first()).c;
          return json(200, { videos: rows || [], total: total || 0 });
        } catch (e) {
          console.error("Video list error:", e);
          return json(500, { error: "Videos unavailable" });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/likes") {
        const u = await authedUser();
        if (!u) return json(401, { error: "Sign in to see liked videos" });
        try {
          const liked = await env.DB.prepare("SELECT v.id, v.owner, v.title, v.description, v.mime, v.size, v.views, v.duration, v.visibility, v.created_at FROM video_likes l JOIN videos v ON v.id = l.video_id WHERE l.username=? AND l.kind='like' AND v.status='clean' AND v.visibility IN ('public','unlisted') ORDER BY l.created_at DESC LIMIT 50").bind(u.username).all();
          return json(200, { videos: liked.results || [] });
        } catch (e) {
          console.error("Likes list error:", e);
          return json(500, { error: "Liked videos unavailable" });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/video") {
        try {
          // The owner's role is joined in so the UI can badge moderator
          // channels. Previously it read v.role, which this query never
          // returned, so the badge could never have shown for anyone.
          // v.kind is what lets the mobile player pick the vertical frame: an
          // ember must play in a 9:16 box even when the clip it was made from
          // was 16:9. Without it the client has to guess from the feed it was
          // opened from, and an ember opened from the home shelf plays sideways.
          const row = await env.DB.prepare("SELECT v.id,v.owner,v.title,v.description,v.mime,v.size,v.views,v.duration,v.visibility,v.created_at,v.kind,u.role AS owner_role FROM videos v JOIN users u ON u.username=v.owner WHERE v.id=? AND v.status='clean'").bind(url.searchParams.get("id")).first();
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
          const row = await env.DB.prepare("SELECT username,role,about,banner_key,avatar_key,created_at FROM users WHERE username=?").bind(name).first();
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
          await s3Put("a/" + user.username + "/" + kind + ".jpg", buf, "image/jpeg");
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
          const play = await s3PresignGet(row.k, 86400);
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
        const { target, role, banned, reason, poison: poison2 } = await req.json();
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
        // Stamp who banned and when, and carry the stated reason through to the
        // ban screen. Clearing the reason on unban stops a stale reason from being
        // shown to someone who has since been reinstated.
        if (banned === 1) {
          sets.push("banned_at=?", "banned_by=?");
          vals.push((/* @__PURE__ */ new Date()).toISOString(), user.username);
          if (typeof reason === "string" && reason.trim()) {
            sets.push("ban_reason=?");
            vals.push(reason.trim().slice(0, 300));
          }
        }
        if (banned === 0) {
          sets.push("ban_reason=NULL", "banned_at=NULL", "banned_by=NULL");
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
        // Lifting a ban must also lift the network ban, otherwise a poison ban is a
        // one-way door: the whole address stays locked out with no way back from
        // the panel. This is reachable now that last_ip is an irreversible hash.
        if (banned === 0 || poison2 === false) {
          const userRow = await env.DB.prepare("SELECT last_ip FROM users WHERE username=?").bind(target).first();
          if (userRow && userRow.last_ip) {
            await env.DB.prepare("DELETE FROM poison_bans WHERE ip=?").bind(userRow.last_ip).run();
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
          const play = await s3PresignGet(row.r2_key, 3600);
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
          const play = await s3PresignGet(row.thumb_key, 86400);
          return Response.redirect(play, 302);
        } catch {
          return new Response("Not found", { status: 404 });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/comments") {
        try {
          const vid = url.searchParams.get("video");
          // id is selected so the client can attach a report button to each
          // comment; status='clean' means a moderator-removed comment drops out
          // of this list without any extra filtering on the client.
          const res = await env.DB.prepare("SELECT id,user,text,created_at FROM comments WHERE video_id=? AND status='clean' ORDER BY id DESC LIMIT 50").bind(vid).all();
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
      if (req.method === "POST" && url.pathname === "/api/report") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in to report." });
        const { kind, id, reason, detail } = await req.json();
        if (kind !== "comment" && kind !== "video") return json(400, { error: "Can only report comments or videos." });
        if (!id) return json(400, { error: "Missing target." });
        const why = REPORT_REASONS.includes(reason) ? reason : "other";
        // Verify the target exists before accepting a report, otherwise anyone
        // could flood the queue with reports against ids that do not exist and
        // moderators would spend their time on phantom entries.
        if (kind === "video") {
          const v = await env.DB.prepare("SELECT owner FROM videos WHERE id=?").bind(String(id)).first();
          if (!v) return json(404, { error: "Video not found." });
          if (v.owner === user.username) return json(400, { error: "You cannot report your own video." });
        } else {
          const c = await env.DB.prepare("SELECT id,user FROM comments WHERE id=?").bind(String(id)).first();
          if (!c) return json(404, { error: "Comment not found." });
          if (c.user === user.username) return json(400, { error: "You cannot report your own comment." });
        }
        try {
          await env.DB.prepare("INSERT INTO reports(target_kind,target_id,reporter,reason,detail,status,created_at) VALUES(?,?,?,?,?,'open',?)").bind(kind, String(id), user.username, why, String(detail || "").slice(0, 500) || null, (/* @__PURE__ */ new Date()).toISOString()).run();
        } catch {
          return json(409, { error: "You already reported this." });
        }
        return json(200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/reports/mine") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in." });
        // Lets the client mark a report as already filed, and keeps an honest
        // reporter from being told they did nothing when it registered fine.
        const rows = (await env.DB.prepare("SELECT target_kind,target_id,status FROM reports WHERE reporter=?").bind(user.username).all()).results || [];
        return json(200, { reported: rows.map((r) => r.target_kind + ":" + r.target_id + ":" + r.status) });
      }
      if (req.method === "GET" && url.pathname === "/api/staff/reports") {
        const user = await authedUser();
        if (!isStaff(user && user.role)) return json(403, { error: "Moderators only." });
        const rows = (await env.DB.prepare(
          "SELECT id,target_kind,target_id,reporter,reason,detail,status,resolution,resolved_by,created_at,resolved_at FROM reports ORDER BY (status='open') DESC, id DESC LIMIT 200"
        ).all()).results || [];
        // Attach the reported content and its author so a moderator can judge
        // without cross-referencing three tables by hand.
        for (const r of rows) {
          if (r.target_kind === "comment") {
            const c = await env.DB.prepare("SELECT user,text FROM comments WHERE id=?").bind(r.target_id).first();
            r.subject = c ? { user: c.user, text: c.text, gone: false } : { gone: true };
            const v = await env.DB.prepare("SELECT id,title FROM videos WHERE id=(SELECT video_id FROM comments WHERE id=?)").bind(r.target_id).first();
            r.context = v ? { video: v.title } : null;
          } else {
            const v = await env.DB.prepare("SELECT owner,title FROM videos WHERE id=?").bind(r.target_id).first();
            r.subject = v ? { user: v.owner, text: v.title, gone: false } : { gone: true };
            r.context = null;
          }
        }
        const open = rows.filter((r) => r.status === "open").length;
        return json(200, { reports: rows, open });
      }
      if (req.method === "POST" && url.pathname === "/api/staff/report") {
        const user = await authedUser();
        if (!isStaff(user && user.role)) return json(403, { error: "Moderators only." });
        const { id, action, network } = await req.json();
        const row = await env.DB.prepare("SELECT * FROM reports WHERE id=?").bind(id).first();
        if (!row) return json(404, { error: "Report not found." });
        if (row.status !== "open") return json(409, { error: "Already handled." });
        const note = (/* @__PURE__ */ new Date()).toISOString();
        const resolve = async (resolution, victim) => {
          await env.DB.prepare("UPDATE reports SET status='resolved',resolution=?,resolved_by=?,resolved_at=? WHERE id=?").bind(resolution, user.username, note, id).run();
          if (victim && victim.action === "ban") {
            const vres = await env.DB.prepare("SELECT banned FROM users WHERE username=?").bind(victim.username).first();
            if (vres && !vres.banned) {
              await env.DB.prepare("UPDATE users SET banned=1,ban_reason=?,banned_at=?,banned_by=? WHERE username=?").bind(victim.reason || "Confirmed by a moderator report.", note, user.username, victim.username).run();
              const uip = await env.DB.prepare("SELECT last_ip FROM users WHERE username=?").bind(victim.username).first();
              if (victim.network && uip && uip.last_ip) await env.DB.prepare("INSERT OR REPLACE INTO poison_bans(ip,created_at) VALUES(?,?)").bind(uip.last_ip, note).run();
            }
          }
          return json(200, { ok: true, resolution });
        };
        if (action === "dismiss") return resolve("dismissed", null);
        if (action === "remove") {
          if (row.target_kind === "comment") {
            await env.DB.prepare("UPDATE comments SET status='removed' WHERE id=?").bind(row.target_id).run();
          } else {
            const v = await env.DB.prepare("SELECT r2_key,thumb_key FROM videos WHERE id=?").bind(row.target_id).first();
            if (v) {
              if (storageConfigured()) {
                try { await s3Delete(v.r2_key); if (v.thumb_key) await s3Delete(v.thumb_key); } catch (e) { console.error("Report removal storage error:", e); }
              }
              await env.DB.prepare("DELETE FROM videos WHERE id=?").bind(row.target_id).run();
            }
          }
          return resolve("content removed", null);
        }
        if (action === "ban") {
          if (row.target_kind === "comment") {
            const c = await env.DB.prepare("SELECT user FROM comments WHERE id=?").bind(row.target_id).first();
            return resolve("author banned", c ? { username: c.user, action: "ban", reason: "Confirmed by a moderator review of a reported comment." } : null);
          }
          const v = await env.DB.prepare("SELECT owner FROM videos WHERE id=?").bind(row.target_id).first();
          return resolve("author banned", v ? { username: v.owner, action: "ban", reason: "Confirmed by a moderator review of a reported video.", network: !!network } : null);
        }
        return json(400, { error: "Unknown action." });
      }
      if (req.method === "POST" && url.pathname === "/api/video/delete") {
        const user = await authedUser();
        if (!user) return json(401, { error: "Sign in." });
        const { id } = await req.json();
        const row = await env.DB.prepare("SELECT r2_key,file_id,thumb_key,thumb_id,owner FROM videos WHERE id=?").bind(id).first();
        if (!row || row.owner !== user.username) return json(404, { error: "Video not found." });
        if (storageConfigured()) {
          await s3Delete(row.r2_key);
          if (row.thumb_key) await s3Delete(row.thumb_key);
        }
        await env.DB.prepare("DELETE FROM comments WHERE video_id=?").bind(id).run();
        await env.DB.prepare("DELETE FROM videos WHERE id=?").bind(id).run();
        return json(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/admin/migrate-b2") {
        const user = await authedUser();
        if (!user || user.role !== "admin") return json(403, { error: "Admin only." });
        const { id } = await req.json();
        const row = await env.DB.prepare("SELECT id,r2_key,size,mime,thumb_key FROM videos WHERE id=? AND status='clean'").bind(id).first();
        if (!row || !row.r2_key) return json(404, { error: "Video not found." });
        if (!env.B2_KEY_ID || !env.B2_BUCKET) return json(500, { error: "B2 source credentials are gone; this video can no longer be copied." });
        const b2url = /* @__PURE__ */ __name(async (name) => {
          const cred = btoa(env.B2_KEY_ID + ":" + env.B2_APP_KEY);
          const ar = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", { headers: { Authorization: "Basic " + cred } });
          if (!ar.ok) throw new Error("b2 auth " + ar.status);
          const j = await ar.json();
          let bucketId = j.allowed && j.allowed.bucketId || null;
          if (!bucketId) {
            const lb = await fetch(j.apiUrl + "/b2api/v2/b2_list_buckets", { method: "POST", headers: { Authorization: j.authorizationToken, "Content-Type": "application/json" }, body: JSON.stringify({ accountId: j.accountId }) });
            const bj = await lb.json();
            const b = (bj.buckets || []).find((x) => x.bucketName === env.B2_BUCKET);
            if (!b) throw new Error("b2 bucket not found");
            bucketId = b.bucketId;
          }
          const dr = await fetch(j.apiUrl + "/b2api/v2/b2_get_download_authorization", { method: "POST", headers: { Authorization: j.authorizationToken, "Content-Type": "application/json" }, body: JSON.stringify({ bucketId, fileNamePrefix: name, validDurationInSeconds: 36e3 }) });
          const dj = await dr.json();
          if (!dr.ok) throw new Error("b2 download auth " + dr.status);
          return j.downloadUrl + "/file/" + env.B2_BUCKET + "/" + name + "?Authorization=" + dj.authorizationToken;
        }, "b2url");
        const copy = /* @__PURE__ */ __name(async (key, size, mime) => {
          const dl = await b2url(key);
          const head = await fetch(dl, { method: "HEAD" });
          const total = Number(head.headers.get("content-length")) || size;
          if (total <= CHUNK_BYTES) {
            const r = await fetch(dl);
            if (!r.ok) throw new Error("b2 get " + r.status);
            await s3Put(key, await r.arrayBuffer(), mime);
            return total;
          }
          const uploadId = await s3CreateMultipart(key, mime);
          const etags = [];
          let copied = 0;
          for (let off = 0, n = 1; off < total; off += CHUNK_BYTES, n++) {
            const end = Math.min(off + CHUNK_BYTES, total) - 1;
            const rr = await fetch(dl, { headers: { Range: "bytes=" + off + "-" + end } });
            if (!rr.ok) throw new Error("b2 range " + off + "-" + end + " -> " + rr.status);
            const buf = await rr.arrayBuffer();
            etags.push(await s3UploadPart(key, uploadId, n, buf));
            copied += buf.byteLength;
          }
          await s3CompleteMultipart(key, uploadId, etags);
          return copied;
        }, "copy");
        try {
          const copied = await copy(row.r2_key, Number(row.size) || 0, row.mime || "video/mp4");
          let thumb = "skipped";
          if (row.thumb_key) {
            try {
              await copy(row.thumb_key, 0, "image/jpeg");
              thumb = "copied";
            } catch (e) {
              thumb = "failed: " + e.message;
            }
          }
          return json(200, { ok: true, id: row.id, key: row.r2_key, bytes: copied, expected: Number(row.size) || 0, thumb });
        } catch (e) {
          console.error("B2 migration failed:", String(e && e.message || e));
          return json(500, { error: "Migration failed: " + String(e && e.message || e) });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/admin/hash-ips") {
        const user = await authedUser();
        if (!user || user.role !== "admin") return json(403, { error: "Admin only." });
        const all = (await env.DB.prepare("SELECT username,last_ip FROM users").all()).results || [];
        let converted = 0, already = 0;
        for (const row of all) {
          if (!row.last_ip || row.last_ip === "unknown") continue;
          if (/^[0-9a-f]{64}$/.test(row.last_ip)) { already++; continue; }
          const hashed = await hashIp(env, row.last_ip);
          await env.DB.prepare("UPDATE users SET last_ip=? WHERE username=?").bind(hashed, row.username).run();
          converted++;
        }
        const bans = (await env.DB.prepare("SELECT ip FROM poison_bans").all()).results || [];
        let bansConverted = 0;
        for (const b of bans) {
          if (!b.ip || b.ip === "unknown" || /^[0-9a-f]{64}$/.test(b.ip)) continue;
          await env.DB.prepare("UPDATE poison_bans SET ip=? WHERE ip=?").bind(await hashIp(env, b.ip), b.ip).run();
          bansConverted++;
        }
        return json(200, { ok: true, converted, alreadyHashed: already, poisonBansConverted: bansConverted });
      }
      if (req.method === "GET" && url.pathname === "/api/admin/appeals") {
        const user = await authedUser();
        if (!user || user.role !== "admin") return json(403, { error: "Admin only." });
        const list = (await env.DB.prepare("SELECT id,username,message,status,reply,created_at,resolved_at FROM appeals ORDER BY (status='open') DESC, id DESC LIMIT 100").all()).results || [];
        const open = list.filter((a) => a.status === "open").length;
        return json(200, { appeals: list, open });
      }
      if (req.method === "POST" && url.pathname === "/api/admin/appeal") {
        const user = await authedUser();
        if (!user || user.role !== "admin") return json(403, { error: "Admin only." });
        const { id, action, reply } = await req.json();
        const row = await env.DB.prepare("SELECT * FROM appeals WHERE id=?").bind(id).first();
        if (!row) return json(404, { error: "Appeal not found." });
        if (action === "uphold") {
          await env.DB.prepare("UPDATE appeals SET status='upheld',reply=?,resolved_at=? WHERE id=?").bind(String(reply || "").slice(0, 2000) || null, (/* @__PURE__ */ new Date()).toISOString(), id).run();
          return json(200, { ok: true });
        }
        if (action === "approve") {
          await env.DB.prepare("UPDATE appeals SET status='approved',reply=?,resolved_at=? WHERE id=?").bind(String(reply || "").slice(0, 2000) || null, (/* @__PURE__ */ new Date()).toISOString(), id).run();
          await env.DB.prepare("UPDATE users SET banned=0,ban_reason=NULL,banned_at=NULL,banned_by=NULL WHERE username=?").bind(row.username).run();
          const lastIp = await env.DB.prepare("SELECT last_ip FROM users WHERE username=?").bind(row.username).first();
          if (lastIp && lastIp.last_ip) await env.DB.prepare("DELETE FROM poison_bans WHERE ip=?").bind(lastIp.last_ip).run();
          return json(200, { ok: true, unbanned: row.username });
        }
        return json(400, { error: "Unknown action." });
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