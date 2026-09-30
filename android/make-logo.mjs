/* Builds every logo asset from the hand-made master at ~/Downloads/Logo.png.
 *
 * One master in, all sizes out, so the launcher icon, the in-app mark, the
 * website header and the favicon can never drift apart the way separately
 * hand-drawn ones do.
 *
 * Outputs:
 *   res/mipmap-DENSITY/ic_launcher.png  square launcher icons, all densities
 *   dist/icon-512.png                    Play Store listing icon
 *   ../public/logo.png                   website header, trimmed
 *   ../public/logo-192.png + favicon    browser icons
 *   ../public/mobile/logo.png            in-app mark, small enough to inline
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, resize, fitSquare, trim } from "./png.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RES = join(HERE, "res");
const PUB = join(HERE, "..", "public");
const DIST = join(HERE, "..", "dist");

// The FirFall near-black, so transparent parts of the logo sit on the app's
// own background rather than on white.
const BG = [0x0f, 0x0f, 0x0f];

const MASTER = process.argv[2] || join(process.env.USERPROFILE || process.env.HOME, "Downloads", "Logo.png");
if (!existsSync(MASTER)) {
  console.error("logo master not found: " + MASTER);
  console.error("pass the path as the first argument");
  process.exit(1);
}

console.log("master: " + MASTER);
const src = decodePng(readFileSync(MASTER));
console.log("decoded: " + src.width + "x" + src.height + ", RGBA");

// Trim the transparent border first so every derived size is sized by the
// artwork itself rather than by whatever margins the master happened to have.
const t = trim(src.data, src.width, src.height);
console.log("trimmed to " + t.width + "x" + t.height);
const art = t.data, artW = t.width, artH = t.height;

function writeAt(path, w, h, rgba) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(w, h, rgba));
  const kb = (Buffer.byteLength(encodePng(w, h, rgba)) / 1024).toFixed(1);
  console.log("  " + path.replace(/^.*Default Project\\/, "") + "  " + w + "x" + h + "  " + kb + " KB");
}

// ---- launcher icons ----
// Square, opaque, artwork inset. Legacy densities so API 24-25 launchers and
// OEM dock pick-ups have something dense to use; adaptive icons would need a
// vector or an extra foreground layer, and minSdk is 24.
const DENSITIES = [["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]];
console.log("\nlauncher icons:");
for (const [name, size] of DENSITIES) {
  const px = fitSquare(art, artW, artH, size, BG);
  writeAt(join(RES, "mipmap-" + name, "ic_launcher.png"), size, size, px);
  // The round variant differs only by the launcher clipping to a circle, so the
  // same opaque square is correct for both.
  copyFileSync(join(RES, "mipmap-" + name, "ic_launcher.png"), join(RES, "mipmap-" + name, "ic_launcher_round.png"));
}

// ---- listing + website ----
console.log("\nlisting and website:");
writeAt(join(DIST, "icon-512.png"), 512, 512, fitSquare(art, artW, artH, 512, BG));

// Website header: keeps transparency, no background plate, so it sits on the
// site's own dark background.
const LOGO_H = 320;
const logoW = Math.round(LOGO_H * (artW / artH));
const webLogo = resize(art, artW, artH, logoW, LOGO_H);
writeAt(join(PUB, "logo.png"), logoW, LOGO_H, webLogo);

for (const size of [192, 512]) {
  const s = Math.round(size * (artH / artW));
  writeAt(join(PUB, "logo-" + size + ".png"), size, s, resize(art, artW, artH, size, s));
}
// favicon.ico wants 16/32/48 PNGs inside a container, but every browser that
// still matters accepts a PNG named favicon.ico, and a real ICO writer is more
// code than the favicon is worth.
const favH = Math.round(64 * (artH / artW));
writeAt(join(PUB, "favicon.ico"), 64, favH, resize(art, artW, artH, 64, favH));

// ---- in-app mark ----
// Served from the site so the APK does not carry it twice; 96px tall is ample
// for a 24-40px slot and keeps the payload small.
console.log("\nin-app mark:");
const APP_H = 96;
const appW = Math.round(APP_H * (artW / artH));
writeAt(join(PUB, "mobile", "logo.png"), appW, APP_H, resize(art, artW, artH, appW, APP_H));

console.log("\ndone.");
