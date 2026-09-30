/*
 * Runtime smoke test. Parsing the file proves the JavaScript is syntactically
 * valid; it says nothing about what happens when a real browser runs it, and
 * a ReferenceError on load is invisible until someone opens the app. This
 * serves the site locally, loads each page in headless Chrome with an error
 * trap injected before the page's own scripts run, and reports anything that
 * was thrown.
 *
 * The trap is injected into a copy written to a temp directory, so the files
 * under public/ are never modified.
 *
 *   node android/smoke.mjs
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(tmpdir(), "firfall-smoke");
const PORT = 8137;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
].find((p) => existsSync(p));
if (!CHROME) { console.error("Chrome not found - cannot run the smoke test."); process.exit(2); }

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon"
};

/* Copied out with the trap inlined. The trap has to run before the page's own
   script, so it goes in <head> rather than at the end of the body. */
const TRAP = `<script>
(function(){
  var errs = [];
  window.__smoke = errs;
  window.addEventListener("error", function(e){
    errs.push("ERROR: " + (e.message || e.type) + " @ " + (e.filename||"").split("/").pop() + ":" + (e.lineno||0));
  }, true);
  window.addEventListener("unhandledrejection", function(e){
    var r = e.reason;
    errs.push("REJECTION: " + (r && r.message ? r.message : String(r)));
  });
  var ce = console.error;
  console.error = function(){
    errs.push("CONSOLE: " + Array.prototype.join.call(arguments, " "));
    ce.apply(console, arguments);
  };
  setTimeout(function(){
    document.title = "SMOKE[" + errs.length + "]" + errs.join(" ~ ");
  }, 2500);
})();
</script>`;

function prepare() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const page of ["index.html", "mobile/index.html"]) {
    const src = join(ROOT, "public", page);
    let html = readFileSync(src, "utf8");
    // The trap goes *after* the charset declaration, not straight after <head>.
    // Ahead of it, the browser starts decoding before it knows the encoding and
    // the non-ASCII characters in the page (ellipsis, emoji, the flame glyphs)
    // turn into mojibake that lands inside string literals - which surfaces as a
    // bogus "Invalid or unexpected token" pointing at the end of the script.
    html = html.includes("<meta charset")
      ? html.replace(/(<meta charset="utf-8"[^>]*>)/i, "$1" + TRAP)
      : html.replace(/<head>/i, "<head>" + TRAP);
    const dest = join(OUT, page);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, html);
  }
  // The pages pull /styles.css, /app.js and the logo; serve the real ones.
  for (const f of readdirSync(join(ROOT, "public"))) {
    const p = join(ROOT, "public", f);
    if (statSync(p).isFile() && f !== "index.html") {
      writeFileSync(join(OUT, f), readFileSync(p));
    }
  }
}

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = join(OUT, url === "/" ? "index.html" : url.replace(/^\/+/, ""));
  // A path ending in "/" is a directory request, not a file, so the usual
  // 404-on-a-directory rule would have thrown away /mobile/ entirely.
  if (url.endsWith("/") && existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" }); res.end("404 " + url); return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});

/* The pages call the live FirFall API on load. Under virtual time Chrome waits
   for those requests before it will advance its clock, so a slow or blocked
   network hangs the run rather than failing it. Mapping the API host to a
   closed port makes every call fail immediately instead. Those failures are
   environmental, so they are reported separately and never counted as code
   errors - a smoke test that fails because it is offline is useless. */
const API_HOST = "firfall-auth.b8golddude.workers.dev";
/* Two kinds of failure are the environment's, not the page's:
   - network calls to the live API, which is unreachable in this harness;
   - resource load errors, which the capture-phase window "error" listener also
     sees. Those arrive with no message and no line ("error @ :0") and say
     nothing about the JavaScript - a missing favicon or the logo, which the
     page falls back from in JavaScript, shows up here too. */
const OFFLINE = /Failed to fetch|NetworkError|Load failed|ERR_CONNECTION|fetch failed|status of 0|^ERROR: error @ :0$/i;

/* Async, not execFileSync: the page is served by this very process, so a
   synchronous wait would block the event loop and Chrome would sit there
   waiting for a server that cannot answer it. That deadlock looks exactly
   like a slow network, which is what it was mistaken for. */
function load(path) {
  const profile = join(tmpdir(), "firfall-smoke-" + process.pid);
  return new Promise((resolve) => {
    const args = [
      "--headless=new", "--disable-gpu", "--no-sandbox",
      "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      "--disable-background-networking", "--disable-sync", "--mute-audio",
      "--user-data-dir=" + profile,
      "--host-resolver-rules=MAP " + API_HOST + " 127.0.0.1:9",
      "--virtual-time-budget=6000",
      "--dump-dom", "http://localhost:" + PORT + path
    ];
    const child = spawn(CHROME, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, 60000);
    child.stdout.on("data", (c) => { out += c; });
    child.on("close", () => {
      clearTimeout(timer);
      if (killed && !out) {
        resolve({ title: "CHROME TIMED OUT with no output", dom: "", real: [], noise: 0 });
        return;
      }
      const m = /<title>([\s\S]*?)<\/title>/i.exec(out);
      const title = m ? m[1].trim() : "(no title - dom " + out.length + " bytes)";
      const listed = title.replace(/^SMOKE\[\d+\]/, "").split(" ~ ").filter(Boolean);
      resolve({
        title, dom: out,
        real: listed.filter((e) => !OFFLINE.test(e)),
        noise: listed.filter((e) => OFFLINE.test(e)).length
      });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ title: "CHROME ERROR: " + e.message, dom: "", real: [], noise: 0 });
    });
  });
}

let failed = false;
server.listen(PORT, async () => {
  prepare();
  for (const path of ["/", "/mobile/"]) {
    const r = await load(path);
    if (r.real && r.real.length) {
      failed = true;
      console.log(`  FAIL  ${path}  ${r.real.length} runtime error(s)`);
      r.real.slice(0, 8).forEach((e) => console.log("        " + e.slice(0, 220)));
    } else if (!r.dom) {
      failed = true;
      console.log(`  FAIL  ${path}  ${r.title}`);
    } else {
      console.log(`  ok    ${path}  no runtime errors` + (r.noise ? ` (${r.noise} offline API call(s) ignored)` : ""));
    }
    // A page that threw during boot never paints, so check for real content too.
    if (path === "/" && r.dom && !/id="grid"/.test(r.dom)) { failed = true; console.log("        desktop grid missing from DOM"); }
    if (path === "/mobile/" && r.dom) {
      if (!/id="nav"/.test(r.dom)) { failed = true; console.log("        mobile nav missing from DOM"); }
      // The Library button was removed from the bottom nav; make sure it
      // really is gone and the five remaining items are all still there.
      if (/data-tab="library"/.test(r.dom)) { failed = true; console.log("        library tab still in the nav"); }
      for (const tab of ["home", "embers", "create", "subs", "you"]) {
        if (!new RegExp('data-tab="' + tab + '"').test(r.dom)) { failed = true; console.log("        nav item missing: " + tab); }
      }
    }
  }
  server.close();
  rmSync(OUT, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
});
