/* Sanity-checks a built FirFall.apk: the entries the app needs must be there,
 * the bundled HTML must match the source, and the dex must contain the
 * Activity the manifest points at. A zip that signs cleanly can still be
 * missing the part that makes the app work. */
import { readFileSync, statSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APK = join(HERE, "..", "dist", "FirFall.apk");
const buf = readFileSync(APK);

/* ---- locate the central directory ---- */
let eocd = -1;
for (let i = buf.length - 22; i >= 0; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) { console.error("no end-of-central-directory record"); process.exit(1); }

const count = buf.readUInt16LE(eocd + 10);
let p = buf.readUInt32LE(eocd + 16);
const entries = [];
for (let i = 0; i < count; i++) {
  if (buf.readUInt32LE(p) !== 0x02014b50) { console.error("bad central header at " + p); process.exit(1); }
  const method = buf.readUInt16LE(p + 10);
  const compSize = buf.readUInt32LE(p + 20);
  const uncompSize = buf.readUInt32LE(p + 24);
  const nameLen = buf.readUInt16LE(p + 28);
  const extraLen = buf.readUInt16LE(p + 30);
  const commentLen = buf.readUInt16LE(p + 32);
  const localOff = buf.readUInt32LE(p + 42);
  const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
  entries.push({ name, method, compSize, uncompSize, localOff });
  p += 46 + nameLen + extraLen + commentLen;
}

function readEntry(e) {
  const lo = e.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error("bad local header for " + e.name);
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  return e.method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
}

const results = [];
const check = (label, ok, detail) => {
  results.push({ label, ok, detail });
  console.log((ok ? "  ok   " : "  FAIL ") + label + (detail ? "   " + detail : ""));
};

console.log("entries: " + entries.length);
for (const e of entries) console.log("   " + e.name + "  (" + e.uncompSize + " bytes" + (e.method === 0 ? ", stored" : ", deflated") + ")");

console.log("\nrequired entries");
const byName = new Map(entries.map(e => [e.name, e]));
check("AndroidManifest.xml present", byName.has("AndroidManifest.xml"));
check("classes.dex present", byName.has("classes.dex"));
check("resources.arsc present", byName.has("resources.arsc"));
check("assets/index.html present", byName.has("assets/index.html"));
// The page loads its logo with a RELATIVE src, which under file:///android_asset/
// means assets/logo.png. If it is not bundled the app silently falls back to the
// SVG flame on every launch - the bug this check exists to stop repeating.
check("assets/logo.png present", byName.has("assets/logo.png"));
// AndroidManifest.xml first, then the resources, then the dex, which is the
// order aapt2 produces and the order the installer expects.
check("AndroidManifest.xml is the first entry", entries[0].name === "AndroidManifest.xml",
  "first is " + entries[0].name);
check("resources.arsc precedes classes.dex",
  entries.findIndex(e => e.name === "resources.arsc") < entries.findIndex(e => e.name === "classes.dex"));
check("resources.arsc stored (not deflated)",
  byName.has("resources.arsc") ? byName.get("resources.arsc").method === 0 : false);
check("no META-INF duplicates", new Set(entries.map(e => e.name)).size === entries.length);
check("signature blocks present", entries.some(e => /^META-INF\/.*\.(RSA|SF|MF)$/.test(e.name)),
  entries.filter(e => e.name.startsWith("META-INF/")).map(e => e.name).join(", "));

console.log("\nalignment");
// zipalign pads stored entries so they start on a 4-byte boundary, which is
// what lets Android mmap resources.arsc instead of copying it.
{
  const e = byName.get("resources.arsc");
  if (e) {
    const lo = e.localOff;
    const nameLen = buf.readUInt16LE(lo + 26);
    const extraLen = buf.readUInt16LE(lo + 28);
    const dataStart = lo + 30 + nameLen + extraLen;
    check("resources.arsc data is 4-byte aligned", dataStart % 4 === 0,
      "starts at byte " + dataStart + " (" + (dataStart % 4) + " mod 4)");
  }
}

console.log("\nlauncher icons");
for (const d of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
  check("mipmap-" + d, byName.has("res/mipmap-" + d + "-v4/ic_launcher.png"));
}
check("round icon", byName.has("res/mipmap-xxxhdpi-v4/ic_launcher_round.png"));

console.log("\ncontent");
if (byName.has("assets/index.html")) {
  const packed = readEntry(byName.get("assets/index.html"));
  const source = readFileSync(join(HERE, "assets", "index.html"));
  check("bundled HTML matches source byte for byte", packed.equals(source),
    packed.length + " vs " + source.length + " bytes");
  const html = packed.toString("utf8");
  check("HTML points at the live API", html.includes("firfall-auth.b8golddude.workers.dev"));
  // An absolute src cannot resolve under file://, and an onerror attribute whose
  // SVG fallback contains double quotes is a SyntaxError. Both shipped here.
  check("logo src is relative", /<img src="logo\.png/.test(html) || html.includes('"logo.png"'),
    "expected a bare relative logo.png, not /mobile/logo.png");
  // The feed thumbnail's own onerror="this.style.display='none'" is fine - it
  // holds no quotes. The logo's is not: its SVG fallback has double quotes in
  // it, which truncated the attribute and made the whole script a SyntaxError.
  const logoLine = html.split("\n").find(l => /alt="FirFall"/.test(l)) || "";
  check("logo fallback is assigned, not an onerror attribute",
    !!logoLine && !/\bonerror=/.test(logoLine) && /logoSrc/.test(logoLine),
    logoLine.trim().slice(0, 120));
  check("HTML has the bottom nav", html.includes('id="nav"'));
  check("HTML has no sample/fake video ids",
    !/vcard\("?sample/i.test(html));
  check("no literal markup leaked into textContent assignments",
    !/\.textContent\s*=\s*['"][^'"]*</.test(html));
}

if (byName.has("classes.dex")) {
  const dex = readEntry(byName.get("classes.dex"));
  check("dex magic", dex.toString("latin1", 0, 4) === "dex\n", dex.toString("latin1", 0, 8).replace(/\n/g, "\\n"));
  const asText = dex.toString("latin1");
  check("dex contains MainActivity", asText.includes("MainActivity"));
  check("dex contains the package path", asText.includes("dev/firfall/mobile"));
  check("dex is not empty", dex.length > 1000, dex.length + " bytes");
}

console.log("\nsize");
console.log("  apk  " + (statSync(APK).size / 1024).toFixed(1) + " KB");

const failed = results.filter(r => !r.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
process.exit(failed.length ? 1 : 0);
