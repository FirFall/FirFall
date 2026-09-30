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
        // The mute button has to be ON the clip, not at the edge of the window.
        // Measured against the stage box, because that is the requirement.
        var mute = document.getElementById("shortMute");
        var topBar = document.querySelector(".short-top");
        if (mute && st) {
          var mr = mute.getBoundingClientRect(), sr = st.getBoundingClientRect();
          var br = topBar ? topBar.getBoundingClientRect() : null;
          rec("muteInside", (mr.left >= sr.left - 1 && mr.right <= sr.right + 1) ? "yes" : "no");
          rec("muteTop", Math.round(mr.top - sr.top));
          rec("muteRightGap", Math.round(sr.right - mr.right));
          // And the bar must not be the full page width on a wide window.
          rec("barVsStage", (br && st) ? Math.round(br.width - sr.width) : -1);
          // Full-height bar that is still clickable would eat taps on the clip.
          rec("barTaps", (topBar && br) ? getComputedStyle(topBar).pointerEvents : "none");
          rec("btnTaps", mute ? getComputedStyle(mute).pointerEvents : "none");
        }
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
                // Account deletion: a button on your own channel, and a screen
                // that says what happens and when. The optional reason box is
                // the part that is easy to lose in a redesign - without it the
                // request stays anonymous to the admin, which is worse.
                rec("delButton", document.getElementById("chDeleteBtn") ? "yes" : "no");
                rec("delModal", document.getElementById("delModal") ? "yes" : "no");
                rec("delHasReason", document.getElementById("delReason") ? "yes" : "no");
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

/* The update gate is the one part of the app that can make itself unusable,
   so it gets driven rather than parsed: a fake Android bridge and a fake
   /api/app-version are injected BEFORE the page's own script runs (a stub added
   at the end of the body would arrive after the check has already decided), and
   then the gate is opened and its button pressed.

   Both directions are driven, because only one of them is a bug you can ship:
   an old build must lock, and a current build must NOT - a false positive locks
   every installed copy of the app out of its own account. */
function androidStub(version, versionCode, remoteVersion, remoteCode) {
  return `<script>
window.__opened = "";
window.Android = {
  appVersion: function(){ return ${JSON.stringify(version)}; },
  appVersionCode: function(){ return ${versionCode}; },
  openInBrowser: function(u){ window.__opened = String(u || ""); },
  keepAwake: function(){}, hasCamPerms: function(){ return true; },
  openAppSettings: function(){}, toast: function(){}
};
(function(){
  var real = window.fetch;
  window.fetch = function(u){
    u = String(u && u.url ? u.url : u);
    if (u.indexOf("/api/app-version") >= 0) {
      return Promise.resolve({ ok: true, json: function(){
        return Promise.resolve({ version: ${JSON.stringify(remoteVersion)},
                                 versionCode: ${remoteCode},
                                 url: "https://firfall.b8golddude.workers.dev/FirFall.apk" });
      } });
    }
    return real.apply(window, arguments);
  };
})();
</script>`;
}

const UPDATE_DRIVE = `<script>
setTimeout(function(){
  var box = document.createElement("div");
  box.id = "driveOut"; box.style.display = "none";
  document.body.appendChild(box);
  function rec(k, v){ box.textContent += k + "=" + v + ";"; }
  try{
    var u = document.getElementById("upd");
    rec("updOn", u.classList.contains("on") ? "yes" : "no");
    rec("updText", ((document.getElementById("updSub").textContent) || "").replace(/\\s+/g, " ").trim().slice(0, 40));
    rec("updVer", ((document.getElementById("updVer").textContent) || "").replace(/\\s+/g, " ").trim());
    // Above the ban screen, which is the only other full-bleed overlay.
    rec("updAbove", parseInt(getComputedStyle(u).zIndex, 10) >
        parseInt(getComputedStyle(document.getElementById("ban")).zIndex, 10) ? "yes" : "no");
    rec("updButtons", u.querySelectorAll("button").length);
    // The one thing the gate must never do: offer a way past it.
    rec("updDismiss", u.querySelectorAll(".close, .bgl, [data-close], #updX").length);
    document.getElementById("updGo").click();
    rec("updOpened", String(window.__opened).replace("https://firfall.b8golddude.workers.dev", ""));
  }catch(e){ rec("updError", e.message); }
}, 2000);
</script>`;

/* Switching cameras failed on every real phone with "an app is using camera".
   The cause is a timing fact that no amount of reading the code reveals: after
   track.stop() the device is still open for a moment, and a getUserMedia issued
   in that window comes back NotReadableError. So this drives the flip against a
   fake getUserMedia that behaves the way Android does - it refuses the first two
   requests after the switch, then hands the camera over.

   What is checked is that the app waited and retried the SAME rung, rather than
   treating "busy" as "this rung is wrong" and walking down the ladder. Walking
   the ladder ends at a different wrong answer: "No camera available", on a
   phone whose camera was never broken. The recorded constraint per call is
   what proves which of the two happened. */
const CAM_DRIVE = `<script>
(function(){
  var calls = [];
  // Nothing is holding the camera before the first open, so that request goes
  // straight through. Busy only ever appears AFTER a release - that is the
  // whole phenomenon being reproduced.
  var busyLeft = 0;
  function fakeStream(facing, id){
    return {
      getVideoTracks: function(){
        return [{ getSettings: function(){ return { facingMode: facing, deviceId: id }; },
                  stop: function(){}, readyState: "live" }];
      },
      getTracks: function(){ return this.getVideoTracks(); }
    };
  }
  function facingOf(cons){
    var v = cons && cons.video;
    if (typeof v === "boolean") return "any";
    var fm = v && v.facingMode;
    if (!fm) return "none";
    if (fm.exact) return "exact:" + fm.exact;
    if (fm.ideal) return "ideal:" + fm.ideal;
    return "none";
  }
  navigator.mediaDevices.getUserMedia = function(cons){
    calls.push(facingOf(cons));
    if (busyLeft > 0) {
      busyLeft--;
      var e = new Error("device busy");
      e.name = "NotReadableError";
      return Promise.reject(e);
    }
    var want = (cons && cons.video && cons.video.facingMode &&
                (cons.video.facingMode.exact || cons.video.facingMode.ideal)) || "";
    return Promise.resolve(fakeStream(want === "user" ? "user" : "environment",
                                      "dev-" + calls.length));
  };
  // The ladder must not be able to fail into a sheet: if it does, camFail()
  // opens one and we want that visible as a failure, not swallowed.
  window.__camFail = "";
  var realFail = camFail;
  window.camFail = function(reason){ window.__camFail = reason; };

  var box = document.createElement("div");
  box.id = "driveOut"; box.style.display = "none";
  document.body.appendChild(box);
  function rec(k, v){ box.textContent += k + "=" + v + ";"; }

  // srcObject is a typed property: Chrome throws a TypeError if it is handed
  // anything other than a real MediaStream. That throw happens inside the
  // ladder's own .then, so its .catch catches it and reads it as a device
  // failure - which made the fake drive every rung and report "No camera
  // available" while the code under test was behaving perfectly. Replacing it
  // with a plain writable property means the fake stream can be assigned, and
  // what the camera preview looks like is irrelevant here.
  var vEl = document.getElementById("camVideo");
  if (vEl) Object.defineProperty(vEl, "srcObject", { value: null, writable: true, configurable: true });

  // Open on the back camera, exactly as recording an ember does.
  camFacing = "environment";
  startCam(camFacing);
  setTimeout(function(){
    try{
      rec("openCalls", calls.length);
      rec("openStream", camStream ? "yes" : "no");
      rec("openFacing", window.camFacingOf(camStream) || "NONE");

      // Now flip, with the device still closing from the release above.
      busyLeft = 2;
      calls = [];
      document.getElementById("camSwitch").click();
      // Generous: the release wait plus two growing retries is well over 2s of
      // real time, and virtual time makes it cheap.
      setTimeout(function(){
        try{
          rec("flipCalls", calls.length);
          rec("flipStream", camStream ? "yes" : "no");
          rec("flipFacing", window.camFacingOf(camStream) || "NONE");
          rec("camFail", window.__camFail || "none");
          // The whole point: every call during the flip asks for the same
          // camera, so "busy" was retried rather than walked past.
          rec("flipSameRung", new Set(calls).size === 1 ? "yes" : "no");
          rec("flipWanted", calls[0] || "none");
          // A second flip straight after the first must not leave two ladders
          // competing for one device.
          busyLeft = 0;
          calls = [];
          document.getElementById("camSwitch").click();
          document.getElementById("camSwitch").click();
          setTimeout(function(){
            try{
              rec("doubleFlipStream", camStream ? "yes" : "no");
              rec("doubleFlipCalls", calls.length);
              rec("doubleFlipFail", window.__camFail || "none");
              // Flipping mid-take must refuse rather than yank the tracks out
              // from under a live recorder and post a truncated clip.
              var before = calls.length;
              window.camRec = { state: "recording", stop: function(){ window.camRec = null; } };
              document.getElementById("camSwitch").click();
              rec("recordingRefused", calls.length === before ? "yes" : "no");
              window.camRec = null;
            }catch(e){ rec("doubleError", e.message); }
          }, 3000);
        }catch(e){ rec("flipError", e.message); }
      }, 4000);
    }catch(e){ rec("openError", e.message); }
  }, 1500);
})();
</script>`;

/* Appeals used to be admin-only while the report queue was open to mods, so a
   mod reviewing reports had no way to answer an appeal - and an appeal is
   exactly a report about a ban. Both halves are checked here because either one
   alone leaves the queue useless: the route admitting staff is what lets a mod
   answer one, and the mod view rendering the inbox is what puts it in front of
   them. A check on the word "appeal" alone would pass against either bug. */
function checkAppealsForMods() {
  const w = readFileSync(join(ROOT, "worker/src/index.js"), "utf8");
  const js = readFileSync(join(ROOT, "public/app.js"), "utf8");
  const bad = [];
  for (const [route, method] of [["/api/admin/appeals", "GET"], ["/api/admin/appeal", "POST"]]) {
    const at = w.indexOf(`url.pathname === "${route}"`);
    if (at < 0) { bad.push(route + " route not found"); continue; }
    // req.method is written BEFORE url.pathname on the same line, so the line
    // has to be taken from its start, not from the pathname match onwards.
    const lineStart = w.lastIndexOf("\n", at) + 1;
    const line = w.slice(lineStart, w.indexOf("\n", at));
    if (!line.includes(`req.method === "${method}"`)) bad.push(route + " is not a " + method + " route");
    // The gate is the handful of lines after the route match, before the body.
    // Generous on purpose: the reason a route is gated the way it is sits in a
    // comment above the check, and a window sized to the code would fail every
    // time somebody explains themselves properly.
    const gate = w.slice(at, at + 900);
    if (/role\s*!==\s*"admin"|role\s*===\s*"admin"/.test(gate)) bad.push(route + " is still admin-only");
    if (!/isStaff\(/.test(gate)) bad.push(route + " does not gate on isStaff");
  }
  // The mod branch of renderAdmin returns early with the report queue only.
  const modBranch = /if \(isMod\(\) && !isAdmin\(\)\) \{[\s\S]*?\n  \}/.exec(js);
  if (!modBranch) bad.push("could not find the mod branch of renderAdmin");
  else if (!/adminAppealsInbox\(\)/.test(modBranch[0])) bad.push("the mod queue does not render the appeals inbox");
  // ...and the admin path must still have it, or this moved the problem.
  if (!/adminAppealsInbox\(\)/.test(js)) bad.push("adminAppealsInbox is never called");
  if (bad.length) {
    console.log("  FAIL  appeals  " + bad.join("; "));
    return false;
  }
  console.log("  ok    appeals  mods can read and answer appeals, and the inbox renders in their queue");
  return true;
}

/* The Embers mute button is the only control for sound on a clip, so it has to
   sit on the clip. The bar used to span the whole overlay while the video is a
   centred 9:16 column, which put mute at the window edge on any wide screen -
   far from the picture it silences, and easy to miss entirely. Checked against
   the stage's own box rather than the viewport, because "near the top right of
   the video" is the actual requirement. */
function checkShortsTopOverlaysVideo() {
  const css = readFileSync(join(ROOT, "public/styles.css"), "utf8");
  const bad = [];
  const block = /\.short-top\{[^}]*\}/.exec(css);
  if (!block) { console.log("  FAIL  mute     .short-top not found"); return false; }
  const rule = block[0];
  // Stretching across the page is the bug: it must not be left/right:0 wide.
  if (/left:\s*0/.test(rule) && /right:\s*0/.test(rule)) bad.push(".short-top still spans the whole page");
  if (!/aspect-ratio:\s*9\/16/.test(rule)) bad.push(".short-top does not take the stage's 9:16 shape");
  if (!/transform:translateX\(-50%\)/.test(rule)) bad.push(".short-top is not centred over the video");
  if (!/height:\s*100%/.test(rule)) bad.push(".short-top is not full height");
  // Full height plus clickable would eat every tap on the clip.
  if (!/pointer-events:\s*none/.test(rule)) bad.push(".short-top would swallow taps on the video");
  if (!/\.short-top>\*\{pointer-events:auto\}/.test(css)) bad.push("the buttons inside .short-top are not clickable");
  // The stage rule the mirror above is copied from, so a change to one and not
  // the other is caught here rather than by eye on a wide monitor.
  const stage = /\.short-stage\{[^}]*\}/.exec(css);
  if (!stage || !/aspect-ratio:\s*9\/16/.test(stage[0])) bad.push(".short-stage is no longer 9:16");
  if (bad.length) {
    console.log("  FAIL  mute     " + bad.join("; "));
    return false;
  }
  console.log("  ok    mute     the Embers top bar tracks the 9:16 video, not the page");
  return true;
}

/* A camera that stays busy for ever is the case the busy-retry counter exists
   for, and it is a regression that has already shipped once: the counter was
   reset at the top of attempt(), so it never rose past 1, and a phone that
   always answered "busy" was retried on the same rung for ever - no camera and
   no error message, which reads to a user as "the camera is broken".

   So this drives a device that is busy EVERY time, with a ceiling on how many
   times it may be asked. What matters is that the ladder gives up and says so
   rather than spinning: a bounded number of calls, then a reported failure. */
const CAM_BUSY_DRIVE = `<script>
(function(){
  var calls = 0;
  function fakeStream(facing){
    return {
      getVideoTracks: function(){
        return [{ getSettings: function(){ return { facingMode: facing, deviceId: "dev" }; },
                  stop: function(){}, readyState: "live" }];
      },
      getAudioTracks: function(){
        return [{ getSettings: function(){ return {}; }, stop: function(){}, readyState: "live", enabled: true }];
      },
      getTracks: function(){ return this.getVideoTracks().concat(this.getAudioTracks()); }
    };
  }
  // Always busy. This is the device that broke it.
  navigator.mediaDevices.getUserMedia = function(){
    calls++;
    var e = new Error("device busy");
    e.name = "NotReadableError";
    return Promise.reject(e);
  };
  window.__camFail = "";
  window.camFail = function(reason){ window.__camFail = reason; };

  var vEl = document.getElementById("camVideo");
  if (vEl) Object.defineProperty(vEl, "srcObject", { value: null, writable: true, configurable: true });

  var box = document.createElement("div");
  box.id = "driveOut"; box.style.display = "none";
  document.body.appendChild(box);
  function rec(k, v){ box.textContent += k + "=" + v + ";"; }

  camFacing = "environment";
  startCam(camFacing);
  // Generous: 5 rungs x (1 first try + 3 busy retries) with waits of
  // 500/1000/1500ms each is well over 20s of scheduled time, and this has to
  // outlast all of it or the ladder is caught mid-walk and looks like it hung.
  setTimeout(function(){
    try{
      rec("busyCalls", calls);
      rec("busyFail", window.__camFail || "none");
      rec("busyStream", camStream ? "yes" : "no");
      rec("micMeterExists", document.getElementById("camMic") ? "yes" : "no");
      // The meter must have been torn down with the stream, not left polling.
      rec("micIv", window.camMicIv ? "running" : "stopped");
    }catch(e){ rec("busyError", e.message); }
  }, 45000);
})();
</script>`;

/* The mic meter, driven against a stream that HAS an audio track and against
   one that has none. The second case is the reason this is checked: the meter
   was built by wrapping the track in a fresh MediaStream, which throws on some
   WebView builds, the throw was swallowed, and the meter reported "no mic" on
   a phone with a perfectly good microphone. Silently wrong is worse than
   absent, because a user who believes the mic is dead stops recording.

   So: with a track, the meter must build an analyser and move when sound
   arrives; with no track it must say "no mic" and mean it. */
const MIC_DRIVE = (withAudio) => `<script>
(function(){
  var phase = 0;
  function tr(kind, facing){
    return { getSettings: function(){ return kind === "video" ? { facingMode: facing, deviceId: "d1" } : {}; },
             stop: function(){}, readyState: "live", enabled: true };
  }
  function stream(facing){
    return { getVideoTracks: function(){ return [tr("video", facing)]; },
             getAudioTracks: function(){ return ${withAudio ? "[tr('audio')]" : "[]"}; },
             getTracks: function(){ return this.getVideoTracks().concat(this.getAudioTracks()); } };
  }
  navigator.mediaDevices.getUserMedia = function(cons){
    var v = cons && cons.video, fm = v && v.facingMode;
    var want = (fm && (fm.exact || fm.ideal)) || "environment";
    return Promise.resolve(stream(want === "user" ? "user" : "environment"));
  };
  var vEl = document.getElementById("camVideo");
  Object.defineProperty(vEl, "srcObject", { value: null, writable: true, configurable: true });
  window.AudioContext = function(){
    this.state = "running";
    this.createMediaStreamSource = function(){ return { connect: function(){} }; };
    this.createAnalyser = function(){
      return { fftSize: 512, smoothingTimeConstant: 0.6,
               getByteTimeDomainData: function(buf){
                 var amp = phase < 3 ? 0 : 0.30;
                 for (var i = 0; i < buf.length; i++)
                   buf[i] = 128 + Math.round(Math.sin(phase + i / 9) * amp * 127);
               } };
    };
    this.resume = function(){};
  };
  var box = document.createElement("div");
  box.id = "driveOut"; box.style.display = "none";
  document.body.appendChild(box);
  function rec(k, v){ box.textContent += k + "=" + v + ";"; }

  camFacing = "environment";
  document.getElementById("camWrap").classList.add("on");
  startCam(camFacing);
  setTimeout(function(){
    try{
      var m = document.getElementById("camMic");
      var b = m.getBoundingClientRect();
      rec("pillOnScreen", (b.width > 20 && b.left >= -1 && b.right <= window.innerWidth + 1) ? "yes" : "no");
      rec("audioTracks", camStream ? camStream.getAudioTracks().length : -1);
      rec("analyser", camAnalyser ? "yes" : "no");
      rec("labelIdle", document.getElementById("camMicTxt").textContent);
      // Recording with sound arriving: the bar has to actually move.
      camRec = { state: "recording", stop: function(){} };
      camStart = Date.now() - 3000;
      camMicHeard = false;
      setInterval(function(){ phase++; }, 100);
      setTimeout(function(){
        rec("labelRec", document.getElementById("camMicTxt").textContent);
        rec("classRec", m.className);
        rec("heard", camMicHeard ? "yes" : "no");
        rec("fill", document.getElementById("camMicFill").style.width);
        var w = parseFloat(document.getElementById("camMicFill").style.width) || 0;
        rec("moved", w > 10 ? "yes" : "no");
      }, 2500);
    }catch(e){ rec("micError", e.message); }
  }, 1500);
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
    // The same page again, with a driver appended. Both live under /mobile/ so
    // the relative logo src resolves exactly as it does in the browser.
    if (page === "mobile/index.html") writeFileSync(join(OUT, "mobile", "drive.html"), html.replace("</body>", DRIVE + "</body>"));
    if (page === "mobile/index.html") writeFileSync(join(OUT, "mobile", "camera.html"), html.replace("</body>", CAM_DRIVE + "</body>"));
    if (page === "mobile/index.html") writeFileSync(join(OUT, "mobile", "camera-busy.html"), html.replace("</body>", CAM_BUSY_DRIVE + "</body>"));
    if (page === "mobile/index.html") writeFileSync(join(OUT, "mobile", "mic.html"), html.replace("</body>", MIC_DRIVE(true) + "</body>"));
    if (page === "mobile/index.html") writeFileSync(join(OUT, "mobile", "mic-none.html"), html.replace("</body>", MIC_DRIVE(false) + "</body>"));
    // Same page, but pretending to be the app: one copy one version behind, one
    // copy already current. The stub goes in right after the trap so it exists
    // before the page's script runs.
    if (page === "mobile/index.html") {
      const behind = html.replace("</head>", androidStub("1.0", 1, "1.1", 2) + "</head>");
      writeFileSync(join(OUT, "mobile", "update-old.html"), behind.replace("</body>", UPDATE_DRIVE + "</body>"));
      const current = html.replace("</head>", androidStub("1.1", 2, "1.1", 2) + "</head>");
      writeFileSync(join(OUT, "mobile", "update-new.html"), current.replace("</body>", UPDATE_DRIVE + "</body>"));
    }
    if (page === "index.html") writeFileSync(join(OUT, "drive-desktop.html"), html.replace("</body>", DRIVE_DESKTOP + "</body>"));
    writeFileSync(dest, html);
  }
  // The pages pull /styles.css, /app.js and the logo; serve the real ones.
  for (const f of readdirSync(join(ROOT, "public"))) {
    const p = join(ROOT, "public", f);
    if (statSync(p).isFile() && f !== "index.html") {
      let buf = readFileSync(p);
      // download.html is loaded as a page in its own right, so it needs the
      // trap the two shells get. Copied verbatim, its real <title> is read as
      // the smoke report and a thrown error on that page is invisible.
      if (/\.html$/i.test(f)) {
        const t = buf.toString("utf8");
        buf = Buffer.from(t.includes("<meta charset")
          ? t.replace(/(<meta charset="utf-8"[^>]*>)/i, "$1" + TRAP)
          : t.replace(/<head>/i, "<head>" + TRAP));
      }
      writeFileSync(join(OUT, f), buf);
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
      // Long enough for the slowest driven page: the always-busy camera ladder
      // schedules 5 rungs x 3 retries of 500-1500ms before it gives up, and a
      // budget that expires mid-walk reports a hang that is not there.
      "--virtual-time-budget=" + (path.includes("camera-busy") ? 60000 : 12000),
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
  if (!checkAppealsForMods()) failed = true;
  if (!checkShortsTopOverlaysVideo()) failed = true;
  prepare();
  // download.html talks to the API for the current version; offline here, which
  // is the branch where it must still leave a usable link on the page.
  for (const path of ["/", "/mobile/", "/download.html"]) {
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
    if (path === "/download.html" && r.dom) {
      // With the API unreachable the page must fall back to a real APK link
      // rather than sitting there with href="#", which is the difference
      // between an offline visitor and a broken one.
      const btn = /<a class="btn" id="dlBtn" href="([^"]*)"/.exec(r.dom);
      if (!btn || btn[1] === "#") { failed = true; console.log("        download button has no APK link"); }
      else console.log("        download page falls back to " + btn[1]);
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

  // The camera flip, against a device that is still closing from the release.
  const cam = await load("/mobile/camera.html");
  const cm = cam.dom && /<div id="driveOut"[^>]*>([\s\S]*?)<\/div>/i.exec(cam.dom);
  if (!cm) { failed = true; console.log("  FAIL  camera  the camera driver never reported"); }
  else {
    const r = {};
    for (const kv of cm[1].split(";")) { const i = kv.indexOf("="); if (i > 0) r[kv.slice(0, i)] = kv.slice(i + 1); }
    const want = {
      // Opening must not be delayed by the release wait - there is nothing to
      // release, so the first call goes straight through.
      openCalls: "1", openStream: "yes", openFacing: "environment",
      // The flip: the device refuses twice, the app waits and retries the same
      // rung, and ends up on the front camera with a stream.
      flipCalls: "3", flipStream: "yes", flipFacing: "user",
      flipSameRung: "yes", flipWanted: "exact:user",
      camFail: "none",
      doubleFlipStream: "yes", doubleFlipFail: "none",
      recordingRefused: "yes"
    };
    for (const [k, v] of Object.entries(want)) {
      if (r[k] !== v) { failed = true; console.log(`  FAIL  camera  ${k} was "${r[k]}", expected "${v}"`); }
    }
    for (const k of ["openError", "flipError", "doubleError"]) if (r[k]) { failed = true; console.log(`  FAIL  camera  threw: ${r[k]}`); }
    console.log(`  ${failed ? "FAIL" : "ok  "}  camera  flip waits for the release and retries the same rung (${r.flipCalls} calls, still on "${r.flipFacing}")`);
  }

  // A camera that is busy every single time must be given up on, not retried for
  // ever. This is the regression that shipped once already.
  const busy = await load("/mobile/camera-busy.html");
  const bm = busy.dom && /<div id="driveOut"[^>]*>([\s\S]*?)<\/div>/i.exec(busy.dom);
  if (!bm) { failed = true; console.log("  FAIL  cam-busy  the driver never reported"); }
  else {
    const r = {};
    for (const kv of bm[1].split(";")) { const i = kv.indexOf("="); if (i > 0) r[kv.slice(0, i)] = kv.slice(i + 1); }
    if (r.busyError) { failed = true; console.log(`  FAIL  cam-busy  threw: ${r.busyError}`); }
    // 5 rungs x 4 tries (first + 3 busy retries) = 20. Anything above that is
    // the infinite retry, which is the bug.
    const n = Number(r.busyCalls);
    if (!(n > 0 && n <= 20)) { failed = true; console.log(`  FAIL  cam-busy  asked the busy camera ${r.busyCalls} times (max 20)`); }
    if (r.busyFail === "none") { failed = true; console.log("  FAIL  cam-busy  never reported a failure after exhausting the ladder"); }
    if (r.busyStream !== "no") { failed = true; console.log(`  FAIL  cam-busy  kept a stream from a camera that never opened (${r.busyStream})`); }
    if (r.micIv !== "stopped") { failed = true; console.log(`  FAIL  cam-busy  the mic meter is still polling after the stream died (${r.micIv})`); }
    console.log(`  ${failed ? "FAIL" : "ok  "}  cam-busy  a permanently busy camera gives up after ${r.busyCalls} tries and says so (${r.busyFail})`);
  }

  // The mic meter: with a track and without one. Both directions matter, because
  // the failure mode is a meter that confidently lies in either direction.
  for (const [path, want] of [
    ["/mobile/mic.html", { pillOnScreen: "yes", audioTracks: "1", analyser: "yes", labelIdle: "mic",
      labelRec: "mic", classRec: "live", heard: "yes", moved: "yes" }],
    ["/mobile/mic-none.html", { pillOnScreen: "yes", audioTracks: "0", analyser: "no", labelIdle: "no mic" }]
  ]) {
    const mic = await load(path);
    const mm = mic.dom && /<div id="driveOut"[^>]*>([\s\S]*?)<\/div>/i.exec(mic.dom);
    if (!mm) { failed = true; console.log(`  FAIL  mic      ${path} never reported`); continue; }
    const r = {};
    for (const kv of mm[1].split(";")) { const i = kv.indexOf("="); if (i > 0) r[kv.slice(0, i)] = kv.slice(i + 1); }
    if (r.micError) { failed = true; console.log(`  FAIL  mic      ${path} threw: ${r.micError}`); continue; }
    for (const [k, v] of Object.entries(want)) {
      if (r[k] !== v) { failed = true; console.log(`  FAIL  mic      ${path} ${k} was "${r[k]}", expected "${v}"`); }
    }
    if (want.analyser === "yes")
      console.log(`  ${failed ? "FAIL" : "ok  "}  mic      level meter runs off the captured track and moves with sound (${r.fill})`);
    else
      console.log(`  ${failed ? "FAIL" : "ok  "}  mic      a stream with no audio track honestly says "no mic"`);
  }

  // The update gate, driven both ways round.
  for (const [path, want] of [
    ["/mobile/update-old.html", { updOn: "yes", updAbove: "yes", updDismiss: "0", updButtons: "2",
      updOpened: "/FirFall.apk", updVer: "You have 1.0 \u00b7 current is 1.1" }],
    ["/mobile/update-new.html", { updOn: "no" }]
  ]) {
    const u = await load(path);
    const um = u.dom && /<div id="driveOut"[^>]*>([\s\S]*?)<\/div>/i.exec(u.dom);
    if (!um) { failed = true; console.log(`  FAIL  update  ${path} never reported`); continue; }
    const r = {};
    for (const kv of um[1].split(";")) { const i = kv.indexOf("="); if (i > 0) r[kv.slice(0, i)] = kv.slice(i + 1); }
    if (r.updError) { failed = true; console.log(`  FAIL  update  ${path} threw: ${r.updError}`); continue; }
    for (const [k, v] of Object.entries(want)) {
      if (r[k] !== v) { failed = true; console.log(`  FAIL  update  ${path} ${k} was "${r[k]}", expected "${v}"`); }
    }
    if (r.updOn === "yes") {
      // Tapping Update has to reach the system, not this WebView: an .apk
      // cannot be installed from inside one.
      if (r.updOpened !== "/FirFall.apk") { failed = true; console.log(`  FAIL  update  ${path} Update opened "${r.updOpened}"`); }
      console.log(`  ok    update  an out-of-date build locks the app (${r.updVer}) and Update hands the APK to the system`);
    } else {
      console.log("  ok    update  a current build is left alone");
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
        muteInside: "yes", barVsStage: "0", barTaps: "none", btnTaps: "auto",
        sideBySide: "no", stageNarrower: "yes",
        studioView: "yes", studioBrand: "FirFall Studio", studioFlame: "yes",
        entryCards: "3", cardCustomise: "yes", cardVideos: "yes", navStudio: "yes",
        aboutField: "yes",
        btnAboutSave: "yes", kindTabs: "2", visibilityFilter: "yes",
        anRange: "yes", anChart: "yes", anRetention: "yes",
        cropperDefined: "yes", bannerAspect: "6", avatarAspect: "1",
        btnOpenStudio: "yes",
        // The bar carries Studio plus the one control that is not a setting and
        // deliberately does not live in Studio: deleting the account.
        chOwnBarButtons: "1", chOwnBarLinks: "1",
        delButton: "yes", delModal: "yes", delHasReason: "yes",
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
