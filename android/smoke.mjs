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

/* An error trap proves nothing about behaviour. Two bugs that shipped here were
   invisible to it: the Embers button did nothing because go() bailed on a tab
   name missing from TABS, and the logo never loaded because its src was an
   absolute /mobile/... path that cannot resolve under file:// in the APK. Both
   are correct JavaScript that does the wrong thing, so this drives the real DOM
   after boot - presses the button, reads the router's own state back out, and
   checks the image actually decoded - and reports the result in the DOM. */
/* Comment threading is the one code path that only runs when a video has a
   reply on it, and no fixture has one - the API is unreachable here and the
   production videos have no replies. So the renderer is handed a canned thread
   through a fetch stub scoped to the comment call: two top-level comments and
   one reply under the first. This is the bug that took the whole list down -
   pushing the first top-level comment onto an undefined bucket threw, and the
   catch turned it into a silent "Could not load comments." The check is that
   every line of the thread is on screen afterwards. */
const THREAD_CHECK = `
setTimeout(function(){
  var box = document.getElementById("driveOut");
  if (!box) return;
  function rec2(k, v){ box.textContent += k + "=" + v + ";"; }
  var SYNTH = { comments: [
    { id: 1, user: "ada", text: "root one", created_at: "2026-09-30T10:00:00.000Z", parent_id: null, reply_to: null, hearts: 0, owner_hearted: 0 },
    { id: 2, user: "bob", text: "root two", created_at: "2026-09-30T10:01:00.000Z", parent_id: null, reply_to: null, hearts: 0, owner_hearted: 0 },
    { id: 3, user: "cleo", text: "reply to one", created_at: "2026-09-30T10:02:00.000Z", parent_id: 1, reply_to: "ada", hearts: 0, owner_hearted: 0 }
  ]};
  var real = window.fetch;
  window.fetch = function(u){
    u = String(u && u.url ? u.url : u);
    if (u.indexOf("/api/comments?") >= 0) {
      return Promise.resolve({ ok: true, json: function(){ return Promise.resolve(SYNTH); } });
    }
    return real.apply(window, arguments);
  };
  var scratch = document.createElement("div");
  document.body.appendChild(scratch);
  try {
    loadComments("synthetic", scratch);
    setTimeout(function(){
      window.fetch = real;
      var txt = scratch.textContent || "";
      rec2("ctRoots", scratch.querySelectorAll(".comment:not(.reply)").length);
      rec2("ctReplies", scratch.querySelectorAll(".comment.reply").length);
      rec2("ctAll", ["root one", "root two", "reply to one"].every(function(s){ return txt.indexOf(s) >= 0; }) ? "yes" : "no");
      scratch.remove();
    }, 700);
  } catch(e){ window.fetch = real; rec2("ctError", e.message); }
}, 5000);`;

const DRIVE = `<script>
(function(){
  // play() rejects on a clip that has no media, so the real thing cannot be
  // observed here. Stub it to set a flag instead, which makes "is more than
  // one clip playing" a question with a definite answer.
  var P = HTMLMediaElement.prototype;
  P.play = function(){ this.__playing = true; return Promise.resolve(); };
  P.pause = function(){ this.__playing = false; };
  function out(){
    var d = document.createElement("div");
    d.id = "driveOut";
    return d;
  }
  var box = out();
  box.style.display = "none";
  document.body.appendChild(box);
  function rec(k, v){ box.textContent += k + "=" + v + ";"; }
  setTimeout(function(){
    try{
      var mark = document.getElementById("brandMark");
      var img = mark && mark.querySelector("img");
      rec("logoSrc", img ? img.getAttribute("src") : "NONE");
      rec("logoAbsolute", img && /^\\//.test(img.getAttribute("src") || "") ? "yes" : "no");
      rec("logoDecoded", img && img.naturalWidth > 0 ? "yes" : "no");
      rec("logoFallback", mark && mark.querySelector("svg") ? "yes" : "no");
      var n = document.querySelector('[data-tab="embers"]');
      rec("navFound", n ? "yes" : "no");
      if (n) n.click();
      setTimeout(function(){
        try{
          // The Shorts panel: it is the whole point of the Embers tab, so it
          // is opened and checked here rather than left to a manual tap.
          openShorts([{ id: "a1", title: "One", owner: "ada", kind: "ember" },
                      { id: "a2", title: "Two", owner: "bob", kind: "ember" }], "a1");
          setTimeout(function(){
            try{
              var sh = document.getElementById("shorts");
              var tr = document.getElementById("shortsTrack");
              rec("shortsOpen", sh.classList.contains("on") ? "yes" : "no");
              rec("slides", tr.querySelectorAll(".short").length);
              rec("railButtons", tr.querySelector(".short-rail").querySelectorAll("button").length);
              rec("snapY", getComputedStyle(tr).scrollSnapType.indexOf("y") >= 0 ? "yes" : "no");
              rec("stageRatio", getComputedStyle(tr.querySelector(".short-stage")).getPropertyValue("aspect-ratio"));
              rec("objectFit", getComputedStyle(tr.querySelector(".short-stage video")).objectFit);
              closeShorts();
              rec("shortsClosed", sh.classList.contains("on") ? "no" : "yes");
              rec("leftBehind", tr.children.length);
              // Only ever one clip playing: activate two in a row and count.
              openShorts([{ id: "b1", title: "One", owner: "ada", kind: "ember" },
                          { id: "b2", title: "Two", owner: "bob", kind: "ember" }], "b1");
              setTimeout(function(){
                try{
                  var sl = tr.querySelectorAll(".short");
                  window.shortActivate(sl[0]);
                  window.shortActivate(sl[1]);
                  var playing = 0;
                  sl.forEach(function(s){ if (s.querySelector("video").__playing) playing++; });
                  rec("simultaneous", playing);
                  // Comments open a UI over the player, not another page.
                  window.shortComments(sl[1]);
                  rec("commentUI", document.getElementById("scList") ? "yes" : "no");
                  rec("commentCount", document.querySelectorAll("#scList .comment").length);
                  rec("agoHours", window.ago(new Date(Date.now() - 2.4 * 3600 * 1000).toISOString()));
                  rec("agoDays", window.ago(new Date(Date.now() - 3 * 86400 * 1000).toISOString()));
                  closeShorts(); closeSheet();
                }catch(e){ rec("playError", e.message); }
              }, 400);
            }catch(e){ rec("shortsLateError", e.message); }
          }, 500);
        }catch(e){ rec("shortsError", e.message); }
      }, 700);
      setTimeout(function(){
        try{
          rec("curTab", window.curTab || "UNDEFINED");
          var f = document.getElementById("feed");
          rec("feedVisible", f && !f.classList.contains("hidden") ? "yes" : "no");
          rec("feedVertical", f && f.classList.contains("vgrid") ? "yes" : "no");
          rec("feedText", ((f && f.textContent) || "").replace(/\\s+/g, " ").trim().slice(0, 60));
          rec("chipsHidden", document.getElementById("chips").classList.contains("hidden") ? "yes" : "no");
          // The pull-to-refresh strip. #ptr shipped with no class, so every
          // .ptr rule matched nothing, the arrow's svg had no size at all and
          // drew a screen-tall arrow behind the whole page on every screen.
          // Nothing caught it: the id existed, the ids guard passed, and a
          // missing class is invisible to a check that only counts ids.
          var ptr = document.getElementById("ptr");
          rec("ptrClass", ptr ? ptr.className : "MISSING");
          rec("ptrH", ptr ? Math.round(ptr.getBoundingClientRect().height) : -1);
          rec("ptrArrowW", ptr && ptr.querySelector("svg") ? Math.round(ptr.querySelector("svg").getBoundingClientRect().width) : -1);
        }catch(e){ rec("lateError", e.message); }
      }, 1000);
    }catch(e){ rec("earlyError", e.message); }
  }, 1800);
})();
${THREAD_CHECK}
</script>`;

/* The desktop site has its own copy of the Shorts panel, in app.js, so it gets
   its own driver. The check that matters is the same one: does openShorts()
   build a real panel, and does closeShorts() leave nothing behind. */
const DRIVE_DESKTOP = `<script>
var P = HTMLMediaElement.prototype;
P.play = function(){ this.__playing = true; return Promise.resolve(); };
P.pause = function(){ this.__playing = false; };
setTimeout(function(){
  var box = document.createElement("div");
  box.id = "driveOut"; box.style.display = "none";
  document.body.appendChild(box);
  function rec(k, v){ box.textContent += k + "=" + v + ";"; }
  try{
    openShorts([{ id: "d1", title: "One", owner: "ada", kind: "ember" },
                { id: "d2", title: "Two", owner: "bob", kind: "ember" }], "d1");
    setTimeout(function(){
      try{
        var sh = document.getElementById("shorts");
        var tr = document.getElementById("shortsTrack");
        var st = tr.querySelector(".short-stage");
        rec("shortsOpen", sh.classList.contains("on") ? "yes" : "no");
        rec("slides", tr.querySelectorAll(".short").length);
        rec("railButtons", tr.querySelector(".short-rail").querySelectorAll("button").length);
        rec("snapX", getComputedStyle(tr).scrollSnapType.indexOf("x") >= 0 ? "yes" : "no");
        rec("stageRatio", getComputedStyle(st).getPropertyValue("aspect-ratio"));
        rec("objectFit", getComputedStyle(st.querySelector("video")).objectFit);
        rec("muteLabel", document.getElementById("shortMute").children.length > 0 ? "yes" : "no");
        // One clip per page: the second slide must start at or past the edge of
        // the track. Sizing slides to their content put two 9:16 stages side by
        // side on a desktop, which is the bug this guards against.
        var first = tr.querySelector(".short"), second = tr.querySelectorAll(".short")[1];
        rec("sideBySide", (first && second && second.offsetLeft < tr.clientWidth - 1) ? "yes" : "no");
        var stW = first ? Math.round(first.querySelector(".short-stage").getBoundingClientRect().width) : 0;
        var trW = tr.clientWidth;
        rec("stageNarrower", stW > 0 && stW < trW ? "yes" : "no");
        closeShorts();
        rec("shortsClosed", sh.classList.contains("on") ? "no" : "yes");
        rec("leftBehind", tr.children.length);
        openShorts([{ id: "e1", title: "One", owner: "ada", kind: "ember" },
                    { id: "e2", title: "Two", owner: "bob", kind: "ember" }], "e1");
        setTimeout(function(){
          try{
            var sl = tr.querySelectorAll(".short");
            shortActivate(sl[0]); shortActivate(sl[1]);
            var playing = 0;
            sl.forEach(function(s){ if (s.querySelector("video").__playing) playing++; });
            rec("simultaneous", playing);
            openShortComments(shortsList[1]);
            rec("commentPanel", document.getElementById("shortsComments").classList.contains("on") ? "yes" : "no");
            rec("commentUI", document.getElementById("scList") ? "yes" : "no");
            rec("signinUI", document.getElementById("scSignin") ? "yes" : "no");
            rec("navEmbers", document.querySelector('[data-nav="embers"]') ? "yes" : "no");
            location.hash = "#/embers";
            rec("embersRoute", location.hash);
            closeShorts();
          }catch(e){ rec("playError", e.message); }
        }, 400);
        // FirFall Studio. me() reads localStorage on every call, so setting a
        // user here signs the page in enough to render the real pages; the API
        // is unreachable, which the render functions handle.
        setTimeout(function(){
          try{
            localStorage.setItem("firfall_user", "ada");
            localStorage.setItem("firfall_token", "stub");
            renderStudio();
            setTimeout(function(){
              try{
                rec("studioView", document.getElementById("studioView").classList.contains("hidden") ? "no" : "yes");
                rec("studioBrand", (document.querySelector(".fs-brand h1") || {}).textContent || "NONE");
                rec("studioFlame", document.querySelector(".fs-logo") ? "yes" : "no");
                rec("entryCards", document.querySelectorAll(".fs-card").length);
                rec("cardCustomise", document.getElementById("fsGoCustomise") ? "yes" : "no");
                rec("cardVideos", document.getElementById("fsGoVideos") ? "yes" : "no");
                rec("navStudio", document.querySelector('[data-nav="studio"]') ? "yes" : "no");
                studioCustomise();
                rec("aboutField", document.getElementById("fsAbout") ? "yes" : "no");
                rec("btnAboutSave", document.getElementById("fsAboutSave") ? "yes" : "no");
                // Change/Save/Remove are painted per image; with nothing staged
                // only Change (and Remove when something is set) should exist.
                rec("bannerChangeBtn", document.querySelector('#fsBannerBtns [data-a="change"]') ? "yes" : "no");
                rec("pictureChangeBtn", document.querySelector('#fsPicBtns [data-a="change"]') ? "yes" : "no");
                studioVideos();
                rec("kindTabs", document.querySelectorAll("#fsBody [data-kind]").length);
                rec("visibilityFilter", document.getElementById("fsFilter") ? "yes" : "no");
                studioAnalytics();
                rec("anRange", document.getElementById("fsDays") ? "yes" : "no");
                rec("anChart", document.getElementById("anChart") ? "yes" : "no");
                rec("anRetention", document.getElementById("anRet") ? "yes" : "no");
                // Channel art is cropped, not just replaced: both images are
                // shown with object-fit:cover, so without a cropper the browser
                // decides what to keep and keeps the middle.
                rec("cropperDefined", typeof openCropper === "function" ? "yes" : "no");
                rec("bannerAspect", (ART_SPEC && ART_SPEC.banner && ART_SPEC.banner.aspect) || 0);
                rec("avatarAspect", (ART_SPEC && ART_SPEC.avatar && ART_SPEC.avatar.aspect) || 0);
                rec("btnOpenStudio", document.querySelector('a[href="#/studio"].pill-btn') ? "yes" : "no");
                // The channel page used to carry its own row of edit buttons.
                // Editing lives in Studio now; the page is for watching.
                const ownBar = document.getElementById("chOwnBar");
                rec("chOwnBarButtons", ownBar ? ownBar.querySelectorAll("button").length : -1);
                rec("chOwnBarLinks", ownBar ? ownBar.querySelectorAll("a").length : -1);
                rec("chEditButtonsGone",
                  ["chBannerEdit", "chAvatarEdit", "chBannerRemove", "chAvatarRemove", "chAboutEdit"]
                    .some(i => document.getElementById(i)) ? "no" : "yes");
              }catch(e){ rec("studioLateError", e.message); }
            }, 800);
          }catch(e){ rec("studioError", e.message); }
        }, 1200);
      }catch(e){ rec("lateError", e.message); }
    }, 500);
  }catch(e){ rec("earlyError", e.message); }
}, 1800);
${THREAD_CHECK}
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
    // The same page again, with a driver appended. Both live under /mobile/ so
    // the relative logo src resolves exactly as it does in the browser.
    if (page === "mobile/index.html") writeFileSync(join(OUT, "mobile", "drive.html"), html.replace("</body>", DRIVE + "</body>"));
    if (page === "index.html") writeFileSync(join(OUT, "drive-desktop.html"), html.replace("</body>", DRIVE_DESKTOP + "</body>"));
    writeFileSync(dest, html);
  }
  // The pages pull /styles.css, /app.js and the logo; serve the real ones.
  for (const f of readdirSync(join(ROOT, "public"))) {
    const p = join(ROOT, "public", f);
    if (statSync(p).isFile() && f !== "index.html") {
      writeFileSync(join(OUT, f), readFileSync(p));
    }
  }
  // ...and the mobile page pulls logo.png from its OWN directory, which is the
  // whole point of the relative src: /mobile/logo.png on the site and
  // assets/logo.png beside index.html in the APK. Not copying these made the
  // logo 404 here, so the check for it would have been theatre.
  const mob = join(ROOT, "public", "mobile");
  mkdirSync(join(OUT, "mobile"), { recursive: true });
  for (const f of readdirSync(mob)) {
    const p = join(mob, f);
    if (statSync(p).isFile() && f !== "index.html") {
      writeFileSync(join(OUT, "mobile", f), readFileSync(p));
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
      "--virtual-time-budget=9000",
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

/* Embers are vertical clips with their own feed and their own tab. The API
   treats a missing kind filter as "both kinds", so a single unfiltered call
   anywhere puts vertical clips back in the normal grid - which is exactly how
   they got there. The one deliberate exception is the Watch later id lookup,
   which must resolve embers too because they open in the Shorts panel; it
   carries a comment saying so. Everything else has to say which kind it wants. */
/* The camera ladders. Two things here are easy to break and impossible to see:
   the back camera has to be the default (an ember is shot on the back camera,
   not the selfie one), and both ladders have to end in a rung that accepts
   whatever the device hands back. The rungs above it ask for a facing by name
   and throw away a stream that turns out to be the wrong camera, so without a
   final "any" rung a phone that ignores the request walks the whole ladder and
   reports "No camera available" while pointing a perfectly good lens at you. */
function checkCameraLadder() {
  const src = readFileSync(join(ROOT, "public/mobile/index.html"), "utf8");
  const bad = [];
  if (!/var camFacing = "environment"/.test(src)) bad.push("the back camera is not the default");
  for (const name of ["CAM_TRIES", "CAM_FLIP_TRIES"]) {
    const from = src.indexOf("var " + name + " = [");
    if (from < 0) { bad.push(name + " not found"); continue; }
    const to = src.indexOf("\n];", from);
    const block = src.slice(from, to < 0 ? from : to);
    if (!/any:\s*true/.test(block)) bad.push(name + " has no 'any' rung to fall back on");
  }
  if (bad.length) {
    console.log("  FAIL  camera  " + bad.join("; "));
    return false;
  }
  console.log("  ok    camera  back camera by default, both ladders end in an 'any' rung");
  return true;
}

function checkKindFilters() {
  const files = [["public/mobile/index.html", "/api/videos?"], ["public/app.js", "/api/videos?"]];
  let bad = 0;
  for (const [rel, needle] of files) {
    const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
    lines.forEach((l, i) => {
      if (!l.includes(needle)) return;
      if (l.includes("kind=")) return;
      // The exception, and it has to justify itself nearby.
      const near = lines.slice(Math.max(0, i - 6), i).join("\n");
      if (/NOT\s*\n?\s*kind=video|Deliberately NOT/.test(near)) return;
      bad++;
      console.log(`  FAIL  kind    ${rel}:${i + 1} fetches ${needle} with no kind filter`);
    });
  }
  if (bad) return false;
  console.log("  ok    kind    every video list asks for a kind; only the Watch later lookup is unfiltered");
  return true;
}

/* The mobile player is custom now. The native control bar is the thing that
   was unusable - a 3px scrubber under a fingertip - so its return has to be a
   failure, not a silent regression. The watch page needs live data to render,
   which this harness does not have, so this checks the markup it builds. */
function checkCustomPlayer() {
  const html = readFileSync(join(ROOT, "public", "mobile", "index.html"), "utf8");
  const need = [["custom control bar", 'id="pCtl"'], ["scrubber", 'id="pBar"'],
    ["buffer bar", 'id="pBuf"'], ["time readout", 'id="pTime"'], ["mute button", 'id="pMute"']];
  let ok = true;
  for (const [what, needle] of need) {
    if (!html.includes(needle)) { ok = false; console.log(`  FAIL  player  mobile page has no ${what} (${needle})`); }
  }
  if (/\scontrols\s+playsinline/.test(html)) {
    ok = false;
    console.log("  FAIL  player  the native controls attribute is back on the mobile <video>");
  }
  if (ok) console.log("  ok    player  custom controls present, native controls attribute gone");
  return ok;
}

/* Every getElementById('x') in app.js must have a matching id somewhere.
   Deleting markup is how a page picks up a handler for an element that no
   longer exists, which throws on load and takes the whole script with it -
   exactly what would have happened when the channel page lost its row of edit
   buttons. Ids built at runtime into innerHTML count, because those are
   legitimately created by the script that then looks them up. */
function checkDanglingIds() {
  const html = readFileSync(join(ROOT, "public", "index.html"), "utf8");
  const js = readFileSync(join(ROOT, "public", "app.js"), "utf8");
  const ids = new Set([
    ...[...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]),
    ...[...js.matchAll(/id="([A-Za-z0-9_]+)"/g)].map(m => m[1])
  ]);
  const used = new Set([...js.matchAll(/getElementById\(['"]([A-Za-z0-9_]+)['"]\)/g)].map(m => m[1]));
  const missing = [...used].filter(i => !ids.has(i));
  if (missing.length) {
    console.log("  FAIL  ids     app.js looks up ids that are neither in index.html nor built by app.js: " + missing.join(", "));
    return false;
  }
  console.log(`  ok    ids     all ${used.size} getElementById targets exist (markup or runtime-built)`);
  return true;
}

let failed = false;
server.listen(PORT, async () => {
  if (!checkKindFilters()) failed = true;
  if (!checkCustomPlayer()) failed = true;
  if (!checkDanglingIds()) failed = true;
  if (!checkCameraLadder()) failed = true;
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
  // Now drive the mobile page: press Embers, then read the router's own state
  // back out of the DOM. This is the only check that would have caught both
  // the dead nav button and the logo that never decoded.
  const d = await load("/mobile/drive.html");
  if (!d.dom) { failed = true; console.log("  FAIL  drive  " + d.title); }
  else {
    const m = /<div id="driveOut"[^>]*>([\s\S]*?)<\/div>/i.exec(d.dom);
    if (!m) { failed = true; console.log("  FAIL  drive  the driver never reported"); }
    else {
      const r = {};
      for (const kv of m[1].split(";")) { const i = kv.indexOf("="); if (i > 0) r[kv.slice(0, i)] = kv.slice(i + 1); }
      const want = {
        logoAbsolute: "no", logoDecoded: "yes", logoFallback: "no", navFound: "yes",
        curTab: "embers", feedVisible: "yes", feedVertical: "yes", chipsHidden: "yes",
        shortsOpen: "yes", slides: "2", railButtons: "4", snapY: "yes",
        stageRatio: "9/16", objectFit: "contain", shortsClosed: "yes", leftBehind: "0",
        simultaneous: "1", commentUI: "yes", agoHours: "2 hours ago", agoDays: "3 days ago",
        ctRoots: "2", ctReplies: "1", ctAll: "yes",
        ptrClass: "ptr", ptrH: "0", ptrArrowW: "20"
      };
      // getComputedStyle reports aspect-ratio as "9 / 16", spaces and all.
      if (r.stageRatio) r.stageRatio = r.stageRatio.replace(/\s+/g, "");
      for (const [k, v] of Object.entries(want)) {
        if (r[k] !== v) { failed = true; console.log(`  FAIL  drive  ${k} was "${r[k]}", expected "${v}"`); }
      }
      for (const k of ["earlyError", "lateError", "shortsError", "shortsLateError", "playError", "ctError"]) {
        if (r[k]) { failed = true; console.log(`  FAIL  drive  threw: ${r[k]}`); }
      }
      console.log(`  ${failed ? "FAIL" : "ok  "}  drive  embers button routes (tab=${r.curTab}, vertical=${r.feedVertical}), logo loaded (${r.logoSrc})`);
    }
  }

  // ...and the same again for the desktop copy of the panel.
  const dd = await load("/drive-desktop.html");
  if (!dd.dom) { failed = true; console.log("  FAIL  drive-desktop  " + dd.title); }
  else {
    const dm = /<div id="driveOut"[^>]*>([\s\S]*?)<\/div>/i.exec(dd.dom);
    if (!dm) { failed = true; console.log("  FAIL  drive-desktop  the driver never reported"); }
    else {
      const r = {};
      for (const kv of dm[1].split(";")) { const i = kv.indexOf("="); if (i > 0) r[kv.slice(0, i)] = kv.slice(i + 1); }
      if (r.stageRatio) r.stageRatio = r.stageRatio.replace(/\s+/g, "");
      const want = { shortsOpen: "yes", slides: "2", railButtons: "4", snapX: "yes",
        stageRatio: "9/16", objectFit: "contain", muteLabel: "yes", shortsClosed: "yes", leftBehind: "0",
        sideBySide: "no", stageNarrower: "yes",
        studioView: "yes", studioBrand: "FirFall Studio", studioFlame: "yes",
        entryCards: "3", cardCustomise: "yes", cardVideos: "yes", navStudio: "yes",
        aboutField: "yes",
        btnAboutSave: "yes", kindTabs: "2", visibilityFilter: "yes",
        anRange: "yes", anChart: "yes", anRetention: "yes",
        cropperDefined: "yes", bannerAspect: "6", avatarAspect: "1",
        btnOpenStudio: "yes", chOwnBarButtons: "0", chOwnBarLinks: "1",
        chEditButtonsGone: "yes",
        simultaneous: "1", commentPanel: "yes", commentUI: "yes", signinUI: "yes",
        navEmbers: "yes", embersRoute: "#/embers",
        ctRoots: "2", ctReplies: "1", ctAll: "yes" };
      for (const [k, v] of Object.entries(want)) {
        if (r[k] !== v) { failed = true; console.log(`  FAIL  drive-desktop  ${k} was "${r[k]}", expected "${v}"`); }
      }
      for (const k of ["earlyError", "lateError", "playError", "studioError", "studioLateError", "ctError"]) if (r[k]) { failed = true; console.log(`  FAIL  drive-desktop  threw: ${r[k]}`); }
      console.log(`  ${failed ? "FAIL" : "ok  "}  drive-desktop  shorts panel builds (${r.slides} slides, ${r.railButtons} rail buttons, snap-x)`);
    }
  }
  server.close();
  rmSync(OUT, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
});
