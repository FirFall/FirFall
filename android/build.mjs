#!/usr/bin/env node
/*
 * Builds FirFall.apk without Gradle.
 *
 * Gradle plus the Android Gradle Plugin would pull in several hundred
 * megabytes of dependencies for what is ultimately one Activity and one HTML
 * file. The SDK build tools do the same job directly:
 *
 *   aapt2 link   - compile resources, produce base.apk
 *   javac        - compile MainActivity against android.jar
 *   d8           - dex the class files
 *   apksigner    - sign it with a local key
 *
 * The result is a normal, installable APK, with nothing to resolve on a
 * machine that has only the SDK and a JDK.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync, rmSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync, cpSync
} from "node:fs";
import { deflateRawSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!SDK) { console.error("Set ANDROID_HOME to the Android SDK."); process.exit(1); }

const BT = join(SDK, "build-tools", "35.0.0");
const ANDROID_JAR = join(SDK, "platforms", "android-35", "android.jar");
const AAPT2 = join(BT, "aapt2.exe");
const D8 = join(BT, "d8.bat");
const APKSIGNER = join(BT, "apksigner.bat");
const JAVA_HOME = process.env.JAVA_HOME || "C:\\Program Files\\Microsoft\\jdk-21.0.11.10-hotspot";
const KEYTOOL = join(JAVA_HOME, "bin", "keytool.exe");
const JAVAC = join(JAVA_HOME, "bin", "javac.exe");

const OUT = join(HERE, "build");
const DIST = join(HERE, "..", "dist");
const KEYSTORE = join(HERE, "firfall-release.jks");
const KEY_PASS = "firfall";

for (const p of [AAPT2, D8, APKSIGNER, ANDROID_JAR, JAVAC]) {
  if (!existsSync(p)) { console.error("Missing SDK/JDK piece: " + p); process.exit(1); }
}

function run(cmd, args) {
  console.log("  > " + (cmd.endsWith(".bat") || cmd.endsWith(".exe") ? cmd.split("\\").pop() : cmd) + " " + args.slice(0, 4).join(" ") + (args.length > 4 ? " ..." : ""));
  // Node cannot spawn a .bat directly on Windows; it has to go via the shell.
  // Arguments are passed through verbatim, so paths with spaces stay intact.
  if (cmd.endsWith(".bat")) {
    execFileSync(process.env.ComSpec || "cmd.exe", ["/c", cmd, ...args], { stdio: "inherit", cwd: HERE });
  } else {
    execFileSync(cmd, args, { stdio: "inherit", cwd: HERE });
  }
}

// ---- 1. clean -------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
for (const d of ["gen", "classes", "dex"]) mkdirSync(join(OUT, d), { recursive: true });
mkdirSync(DIST, { recursive: true });

// ---- 2. resources -> base.apk ---------------------------------------------
console.log("\n[1/5] aapt2: compiling resources");
run(AAPT2, ["compile", "--dir", join(HERE, "res"), "-o", join(OUT, "res.zip")]);

console.log("[2/5] aapt2: linking base.apk");
run(AAPT2, [
  "link",
  "-o", join(OUT, "base.apk"),
  "-I", ANDROID_JAR,
  "--manifest", join(HERE, "AndroidManifest.xml"),
  "-A", join(HERE, "assets"),
  "--java", join(OUT, "gen"),
  "--min-sdk-version", "24",
  "--target-sdk-version", "35",
  "--version-code", "5",
  "--version-name", "1.4",
  join(OUT, "res.zip")
]);

// ---- 3. java -> class -----------------------------------------------------
const sources = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith(".java")) sources.push(p);
  }
})(join(HERE, "java"));
if (!sources.length) { console.error("No java sources under android/java."); process.exit(1); }

console.log("[3/5] javac: " + sources.length + " source file(s)");
run(JAVAC, [
  "-encoding", "UTF-8",
  "-nowarn",
  "-classpath", ANDROID_JAR + ";" + join(OUT, "base.apk"),
  "-d", join(OUT, "classes"),
  ...sources
]);

// ---- 4. dex ---------------------------------------------------------------
console.log("[4/5] d8: dexing");
const classFiles = readdirSync(join(OUT, "classes"), { recursive: true })
  .filter(f => String(f).endsWith(".class"))
  .map(f => join(OUT, "classes", String(f)));
run(D8, ["--min-api", "24", "--output", join(OUT, "dex"), ...classFiles]);

// ---- 5. assemble + sign ---------------------------------------------------
console.log("[5/5] packaging and signing");

/*
 * Pack classes.dex and the HTML asset into the linked apk.
 *
 * The zip is written here rather than handed to Compress-Archive or jar.
 * Compress-Archive added directory entries and produced a file apk signing
 * rejected outright, and signing is unforgiving about a zip that is subtly
 * wrong. A zip is simple enough to write directly, which also keeps the entry
 * order under our control: resources.arsc has to come first, and it has to
 * be stored uncompressed because Android maps it straight out of the archive.
 */
/*
 * Stage the one thing aapt2 cannot know about: the compiled dex.
 *
 * assets/ is deliberately NOT staged here. aapt2's -A flag already folded it
 * into the linked apk, so copying it in again would put two entries called
 * assets/index.html in the archive and apk signing rejects duplicates.
 */
const STAGING = join(OUT, "staging");
rmSync(STAGING, { recursive: true, force: true });
mkdirSync(STAGING, { recursive: true });
cpSync(join(OUT, "dex", "classes.dex"), join(STAGING, "classes.dex"));

function collect(dir, base = "") {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const rel = base ? base + "/" + e : e;
    if (statSync(p).isDirectory()) out.push(...collect(p, rel));
    else out.push({ abs: p, rel });
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function writeZip(dest, entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const store = name === "resources.arsc";
    const body = store ? data : deflateRawSync(data, { level: 9 });
    const method = store ? 0 : 8;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0x21, 12);   // fixed timestamp keeps the build reproducible
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(body.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    locals.push(lfh, nameBuf, body);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0x21, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(body.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    // Unix mode 0644 in the high 16 bits. `<<` is a signed 32-bit operation in
    // JS, so the result has to be forced back to unsigned.
    cdh.writeUInt32LE(((0o100644 << 16) >>> 0), 38);
    cdh.writeUInt32LE(offset >>> 0, 42);
    central.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset >>> 0, 16);

  writeFileSync(dest, Buffer.concat([...locals, cdBuf, eocd]));
}

// Explode the linked apk so its resources and manifest can be re-packed
// alongside our additions.
const EXPLODE = join(OUT, "basex");
const BASE_ZIP = join(OUT, "base.zip");
rmSync(EXPLODE, { recursive: true, force: true });
mkdirSync(EXPLODE, { recursive: true });
// Expand-Archive refuses anything that is not named .zip, so the linked apk
// is unpacked through a copy with that extension.
cpSync(join(OUT, "base.apk"), BASE_ZIP);
execFileSync("powershell", ["-NoProfile", "-Command",
  `Expand-Archive -LiteralPath '${BASE_ZIP}' -DestinationPath '${EXPLODE}' -Force`
], { stdio: "inherit", cwd: HERE });
rmSync(BASE_ZIP, { force: true });

// aapt2 leaves *.meta sidecars and a stub META-INF in the linked apk. The
// meta files are build junk and the stub would collide with the signature
// apksigner is about to add.
const STALE = /^META-INF\//;
const merged = [
  ...collect(EXPLODE)
    .filter(f => !STALE.test(f.rel) && !f.rel.endsWith(".meta"))
    .map(f => ({ name: f.rel, data: readFileSync(f.abs) })),
  ...collect(STAGING).map(f => ({ name: f.rel, data: readFileSync(f.abs) }))
];

const unsigned = join(OUT, "unsigned.apk");
writeZip(unsigned, merged);
console.log("  packed unsigned.apk  (" + merged.length + " entries, " +
  (statSync(unsigned).size / 1024).toFixed(0) + " KB)");

// A key so the APK is signed and installable. Reused if present, so an
// upgrade install over an earlier build keeps working.
if (!existsSync(KEYSTORE)) {
  console.log("  creating signing key");
  run(KEYTOOL, [
    "-genkeypair", "-v",
    "-keystore", KEYSTORE,
    "-storepass", KEY_PASS, "-keypass", KEY_PASS,
    "-alias", "firfall",
    "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
    "-dname", "CN=FirFall, OU=Dev, O=FirFall, L=, ST=, C=US"
  ]);
}

/*
 * zipalign, then sign. This order matters: zipalign rewrites the archive's
 * entry offsets, and apksigner has to be the last thing to touch the file, or
 * the signature would be computed over a layout that then changes. Without
 * alignment Android can mmap resources.arsc directly, and the app installs
 * but is slow to open and throws on low-memory devices.
 */
const ZIPALIGN = join(BT, "zipalign.exe");
if (existsSync(ZIPALIGN)) {
  const aligned = join(OUT, "aligned.apk");
  rmSync(aligned, { force: true });
  run(ZIPALIGN, ["-f", "-p", "4", unsigned, aligned]);
  rmSync(unsigned, { force: true });
  cpSync(aligned, unsigned);
  console.log("  aligned to 4 bytes");
} else {
  console.log("  zipalign not found in build-tools; installing unaligned");
}

const signed = join(DIST, "FirFall.apk");
rmSync(signed, { force: true });

run(APKSIGNER, [
  "sign",
  "--ks", KEYSTORE,
  "--ks-pass", "pass:" + KEY_PASS,
  "--key-pass", "pass:" + KEY_PASS,
  "--ks-key-alias", "firfall",
  "--out", signed,
  unsigned
]);

console.log("\nverify:");
run(APKSIGNER, ["verify", "--verbose", "--print-certs", signed]);

// Re-check with the platform's own package parser as well. apksigner only
// knows about the signature; this confirms the manifest, the dex and the
// resources actually resolve the way Android will read them.
console.log("\nmanifest:");
const AAPT = join(BT, "aapt2.exe");
run(AAPT, ["dump", "packagename", signed]);
run(AAPT, ["dump", "badging", signed]);

const size = statSync(signed).size;
console.log("\nBuilt " + signed + "  (" + (size / 1024 / 1024).toFixed(2) + " MB)");
