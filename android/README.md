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

Both paths run the same upload as the website client: `/api/uploads/start`
with `kind=ember`, 6 MB chunks with resume offsets, then `/api/uploads/complete`
with a JPEG thumbnail drawn onto a 9:16 canvas. The worker re-checks the
reported duration server-side, so the 60 second cap holds even if a client
lies.

Front and back cameras are supported; the front preview is mirrored while
framing and un-mirrored in review. If camera permission is denied the record
option says so and the gallery picker still works.

## What the app does not do

Full-length video uploads still go through the website, where the 250 MB
limit and the moderation scan apply to the big files. Embers are capped at
60 seconds precisely so a phone can handle them end to end.

Watch history is stored on the device. The API has no history endpoint, and
adding a server table for it was not worth it.
