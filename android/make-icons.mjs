#!/usr/bin/env node
/*
 * Generates the FirFall launcher icons as real PNGs.
 *
 * A vector drawable would be tidier, but launcher icons from vectors are only
 * reliably supported from API 26, and this app supports 24. So the icons are
 * drawn pixel by pixel and encoded here, which keeps the APK free of any
 * binary artwork that has to be maintained by hand.
 *
 * The mark is a flame, the same shape the app uses in its top bar. It was
 * previously a red rounded rectangle with a white play triangle, which is the
 * YouTube logo. The points below are the FLAME list from assets/index.html,
 * kept in a 24x24 box to match the SVG viewBox; scale() maps them into the
 * 108-unit space the icon is drawn in.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RES = join(HERE, "res");

const BG = [0x0f, 0x0f, 0x0f];
const RED = [0xff, 0x00, 0x00];
const ORANGE = [0xff, 0x6a, 0x00];

/* Pull the flame straight out of the app so the icon and the top bar cannot
   drift apart. Fails loudly if the name is renamed, rather than silently
   falling back to a different shape. */
function flameFromApp() {
  const html = readFileSync(join(HERE, "assets", "index.html"), "utf8");
  const m = html.match(/var FLAME = (\[[\s\S]*?\]);/);
  if (!m) throw new Error("could not find the FLAME polygon in assets/index.html");
  const pts = JSON.parse(m[1].replace(/(\d)\s+(\d)/g, '$1,$2'));
  if (pts.length < 3) throw new Error("FLAME needs at least 3 points, got " + pts.length);
  return pts;
}
const FLAME = flameFromApp();

/* ---- minimal PNG encoder ---- */
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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** pixels: Uint8Array of size*size*4 RGBA. */
function encodePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  // Each scanline is prefixed with its filter type; 0 means "none".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy
      ? pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
      : Buffer.from(pixels.subarray(y * size * 4, (y + 1) * size * 4)).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---- drawing ---- */

/**
 * Winding number for a closed polygon, 0 outside and 1 inside. The flame is a
 * flat silhouette with no smooth edges to solve for, so a point test plus the
 * existing 3x3 supersampling gives clean antialiased edges without the
 * complexity of a real polygon distance field.
 */
function insidePoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > py) !== (yj > py)) {
      const xInt = xi + ((py - yi) / (yj - yi)) * (xj - xi);
      if (px < xInt) inside = !inside;
    }
  }
  return inside;
}

/** Coverage from a signed distance, one pixel of feathering. */
function cover(d) { return Math.max(0, Math.min(1, 0.5 - d)); }

function drawIcon(size, { round }) {
  const px = Buffer.alloc(size * size * 4);
  const S = size;

  // The flame is authored in a 24x24 box. Scale it to fill most of the icon
  // with a margin, mapping the 24-unit box onto the 108-unit design space.
  const FLAME_SCALE = 3.05;
  const FLAME_OFF = (108 - 24 * FLAME_SCALE) / 2;
  const flame = FLAME.map(([x, y]) => [(FLAME_OFF + x * FLAME_SCALE) * (S / 108),
                                       (FLAME_OFF + y * FLAME_SCALE) * (S / 108)]);
  // Small ember below the flame: the "fall" in FirFall. Drawn as a distance
  // test, which is exact and needs no polygon.
  const embX = (FLAME_OFF + 19.4 * FLAME_SCALE) * (S / 108);
  const embY = (FLAME_OFF + 22.4 * FLAME_SCALE) * (S / 108);
  const embR = 1.5 * FLAME_SCALE * (S / 108);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // 3x3 supersample so the edges do not look like a staircase.
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const fx = x + (sx + 0.5) / 3;
          const fy = y + (sy + 0.5) / 3;
          let col = BG, alpha = 1;

          const inRound = round
            ? Math.hypot(fx - S / 2, fy - S / 2) - (S / 2 - 0.5)
            : -1;
          if (round && inRound > 0) {
            alpha = 1 - cover(inRound);
          }

          if (insidePoly(fx, fy, flame)) col = RED;
          if (Math.hypot(fx - embX, fy - embY) < embR) col = ORANGE;

          r += col[0] * alpha; g += col[1] * alpha; b += col[2] * alpha; a += alpha;
        }
      }
      const n = 9;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(S, px);
}

// Legacy launcher densities. Adaptive icons cover 26+, but these keep 24-25
// looking right, and give any OEM launcher a dense icon to pick up.
const DENSITIES = [
  ["mdpi", 48], ["hdpi", 72], ["xhdpi", 96], ["xxhdpi", 144], ["xxxhdpi", 192]
];

for (const [name, size] of DENSITIES) {
  const dir = join(RES, "mipmap-" + name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ic_launcher.png"), drawIcon(size, { round: false }));
  writeFileSync(join(dir, "ic_launcher_round.png"), drawIcon(size, { round: true }));
  console.log("mipmap-" + name + "/ic_launcher.png  " + size + "x" + size);
}

// Play Store listing icon.
mkdirSync(join(RES, "..", "..", "dist"), { recursive: true });
writeFileSync(join(HERE, "..", "dist", "icon-512.png"), drawIcon(512, { round: false }));
console.log("dist/icon-512.png  512x512");
