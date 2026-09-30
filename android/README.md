# FirFall for Android

A native Android app for FirFall. It has the YouTube Android app's shape:
top bar with the logo, search and your avatar; a chips row; a video feed; and
a five-item bottom nav.

The whole interface is one self-contained HTML file in
[`assets/index.html`](assets/index.html), served inside a WebView. It talks to
the same live FirFall API the website uses, so there is no second backend and
no separate copy of anyone's content.

## Why a WebView

The obvious alternative is Jetpack Compose. That would be a much larger codebase
for a UI that is already written once for the web, and it would need Gradle
plus the Android Gradle Plugin resolved on every machine that builds it. The
WebView shell is one Activity and one HTML file.

The cost is real and worth stating: this is a wrapped web app, not a native
one. It cannot do things like a proper system share sheet without the small
JavaScript bridge, it is one rendering engine, and Play Store reviewers are
allowed to be unhappy about very thin web wrappers. If FirFall grows features
that genuinely need native code, the Activity and the API layer are the parts
that would stay.

The HTML is deliberately built to be a good mobile web page on its own, not
just a payload for the APK. The same file is published at
`firfall.b8golddude.workers.dev/mobile/` so it can be tried in a browser and
reviewed before anything is built.

## Building

You need a JDK (21 works) and the Android SDK with `platforms;android-35`,
`build-tools;35.0.0` and `platform-tools`.

There is no Gradle wrapper here, and that is on purpose.
[`build.mjs`](build.mjs) calls the SDK tools directly:

| step | tool | what it does |
| --- | --- | --- |
| 1 | `aapt2 compile` / `link` | resources and manifest into an apk |
| 2 | `javac` | `MainActivity` against `android.jar` |
| 3 | `d8` | class files into `classes.dex` |
| 4 | hand-written zip | merge dex into the linked apk |
| 5 | `zipalign` | 4-byte alignment for `resources.arsc` |
| 6 | `apksigner` | sign |

The zip is written in code rather than handed to `Compress-Archive` because
that produced an archive `apksigner` rejected, and because entry order matters:
`AndroidManifest.xml` first, `resources.arsc` stored uncompressed so Android
can mmap it.

```sh
cd android
export ANDROID_HOME=/path/to/android-sdk     # or ANDROID_SDK_ROOT
export JAVA_HOME=/path/to/jdk
node build.mjs                                # -> dist/FirFall.apk
node check-apk.mjs                            # verifies the result
```

`make-icons.mjs` regenerates the launcher PNGs if the mark ever changes.

## The signing key

`build.mjs` creates `firfall-release.jks` on first run if it is missing, and
reuses it afterwards so that a rebuild can be installed over an earlier build.

**Back this file up.** Android only accepts an update to an installed app when
it is signed with the same key. Lose it and the only way to ship a new version
is for everyone to uninstall first. It is a self-signed development key with
the password in `build.mjs`; it is not a Play Store upload key and should not
be treated as one.

It is excluded from git for the usual reasons, which means a fresh clone will
mint a new one and produce an APK that will not upgrade an installed copy.

## API notes

Two things about the FirFall API are easy to get wrong from a client:

- **Media URLs take the token in the query string, not as a Bearer header.**
  `GET /v/<id>?token=...` and `GET /t/<id>?token=...` are media fetches, so
  they cannot carry an `Authorization` header the way the JSON endpoints do.
- **A ban arrives as `403` with `banned: true`**, not a `401`. The password is
  checked before the ban is reported, so a wrong password cannot be used to
  find out whether an account exists. `GET /api/me` reports a ban the same way
  instead of failing.

## The ban screen

A ban is a full-screen takeover, not a toast or an empty state. It cannot be
dismissed, and the app underneath is not reachable. It states the account, the
reason, who reviewed it and when, and offers the appeal form inline.

The appeal token is only ever issued on a *rejected* login, and `GET /api/me`
does not return one. So a person who was signed in when they were banned has no
token: the form asks for their password to prove the account is theirs, and the
`403` carries the token they need. Someone banned at the sign-in sheet already
has one and skips that step.

## Embers: recording and uploading

The Create tab opens an in-app flow, no trip to the website needed:

- **Record with camera** — `getUserMedia` + `MediaRecorder` from the page,
  made possible by the shell's `onPermissionRequest` override. Recording
  stops itself at 60 seconds, or earlier on a second tap of the shutter.
  There is a review screen (Retake / Post ember) before anything uploads.
- **From gallery** — a hidden `<input type=file>` forwarded to the system
  document picker by `onShowFileChooser`. The clip's real duration is probed
  with a throwaway `<video>` element and anything over 60s is refused.

Both paths then ask for a name before a single byte goes anywhere: a title
box, an optional description, and a `Post ember` button. Leave the title
empty and it is called `<your channel>'s Ember`. Nothing is uploaded until
you press it, and `Discard this ember` throws the recording away.

Both paths run the same upload as the website client: `/api/uploads/start`
with `kind=ember`, 6 MB chunks with resume offsets, then `/api/uploads/complete`
with a JPEG thumbnail drawn onto a 9:16 canvas. The worker re-checks the
reported duration server-side, so the 60 second cap holds even if a client
lies.

Front and back cameras are supported; the front preview is mirrored while
framing and un-mirrored in review. If camera permission is denied the record
option says so and the gallery picker still works.

### Why the flip button needed its own ladder

The flip did nothing on a real phone. The cause was `facingMode: { ideal: f }`:
`ideal` is a hint, not a request, and Android's WebView routinely answers an
`{ ideal: "environment" }` request with the **front** camera. The screen never
changed, and the toast cheerfully said "Back camera" over a picture of the
front one — which reads exactly like a dead button.

Two changes, and both are needed:

- `CAM_FLIP_TRIES` leads with `facingMode: { exact: f }`. `exact` names the
  camera or fails with `OverconstrainedError`, so a device with no back camera
  is told the truth instead of quietly returning the wrong one. The `ideal`
  rungs remain underneath for WebViews that reject `exact` outright.
- `camMatches()` **verifies what came back** — `getSettings().facingMode`, or
  `deviceId` identity when the device reports that but not facingMode — and
  discards any stream that is not the camera that was asked for. Asking for
  something is not the same as getting it.

The toast moved into `startCam`'s success path (`announce`), so it can only
ever name the camera actually on screen. If every rung is exhausted the
selection reverts, the previously working camera is restored, and the user is
told "This phone would not switch cameras" rather than being left staring at an
unchanged preview.

Recording is unaffected by the flip fix: `stopCamStream()` runs before every
re-open, so the old track is always released before the new one is requested.

## Landscape clips

An ember is meant to be vertical, but a 16:9 clip picked from the gallery is
accepted rather than refused. A browser cannot re-encode video — there is no
codec library in this project and it is not going to grow one — so the shape is
corrected on the way out instead of in the file:

- the thumbnail is drawn **cover** onto a 9:16 canvas, so the stored poster is
  a vertical crop of the middle of the frame;
- the Embers tab is a three-across grid of 9:16 cards;
- the watch page gives an ember a 9:16 player box with `object-fit:contain`,
  so a landscape ember plays whole inside the vertical frame — letterboxed on
  black — instead of being cropped or stretched. `v.kind` is what tells the
  player to do this, which is why `/api/video` selects it.

If a genuine re-encode is ever wanted, it belongs in the worker, not here.

## The player

The watch page uses custom controls rather than the browser's. On a phone the
native ones are close to unusable: a 3px scrubber under a fingertip, buttons
laid out for a mouse, and on Android a palette of its own floating over the
page.

- Thumb-sized play/pause, mute and speed, plus a time readout.
- A scrubber with a **24px hit area** around a 3px line, dragged with pointer
  events rather than a touch handler plus a mouse handler — a touch device
  fires both, so every drag would otherwise seek twice.
- Controls auto-hide after 3.2s; any tap brings them back.
- A single tap only shows or hides the controls. It no longer pauses, because
  a stray tap should not stop a clip mid-sentence. Play/pause is the button,
  or double-tap to seek ±10s as before.
- Buffered bar, and "Buffering" in the time readout while stalled.

`android/smoke.mjs` fails if the native `controls` attribute comes back or any
of the custom controls goes missing.

## Watch statistics

Retention in Studio is only as good as the progress reports, and the player is
the only place that knows how far someone got. Both clients report from their
player:

- The **peak** position is sent, never the current one, so dragging to the end
  does not report the whole clip as watched.
- Reports are throttled to one every 15 seconds, and `/api/video/progress`
  deliberately does **not** touch `videos.views` — a view is counted once when
  the page opens, a progress report every fifteen seconds, and conflating them
  would inflate the number a hundredfold.
- The `viewer` is a random id generated in localStorage. Not an account, not an
  IP hash: most viewers are signed out, and the difference between "how long
  did people watch" and "here is who watched" is the whole point.
- The server clamps reported watch time to the clip's own duration, so a
  client claiming 4000s on a 30s video cannot push retention over 100% and
  poison every average on the page.

The `video_stats` table is created on first use by the worker rather than by a
migration step — `CREATE TABLE IF NOT EXISTS` is idempotent, so a deploy is
never blocked on somebody remembering to run a migration against production.
`schema.sql` still declares it so a fresh database has it from the start.

## Shorts

Tapping an ember opens the full-screen vertical player rather than the
landscape watch page. Every route to an ember goes there — the Embers tab, the
history list, a link — because `loadWatch` bounces anything with
`kind === "ember"` straight into it.

- The track is a plain `scroll-snap-type: y mandatory` column, so the swipe,
  the snap and the momentum come from the platform rather than from hand-rolled
  touch maths. An `IntersectionObserver` picks the current slide and plays it;
  the others pause.
- Slides are built on open and torn down on close, so no page ever holds fifty
  paused video elements.
- Tap to pause, with a play glyph as the only cue — a panel with no visible
  controls has to say something when it stops.
- Clips start muted. A browser will not autoplay sound before a user gesture,
  and a panel that sits silent because `play()` was rejected is worse than one
  that starts quiet behind an unmute button.
- The right-hand rail is like / dislike / comments / share. Like and dislike hit
  `/api/video/react` and tapping the active one clears it. Comments have no room
  in a full-screen panel, so that button opens the ordinary watch page — and
  sets a one-shot `watchPlain` flag, because otherwise `loadWatch` would bounce
  the ember straight back into here.
- The Android back button closes the panel; `window.FirFall.onBack` checks it
  first, above the sheet and above the pushed-screen logic.

The desktop site has its own copy of the same panel in `app.js`, running
sideways — a desktop window has no column to scroll, so the arrow keys page it
and `Esc` closes. `android/smoke.mjs` drives both panels and checks they build,
snap, sit at 9:16 with `object-fit: contain`, and leave nothing behind on
close.

## What the app does not do

Full-length video uploads still go through the website, where the 250 MB
limit and the moderation scan apply to the big files. Embers are capped at
60 seconds precisely so a phone can handle them end to end.

Watch history is stored on the device. The API has no history endpoint, and
adding a server table for it was not worth it.
