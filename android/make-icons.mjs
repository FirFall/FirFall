#!/usr/bin/env node
/*
 * Generates the FirFall launcher icons as real PNGs.
 *
 * A vector drawable would be tidier, but launcher icons from vectors are only
 * reliably supported from API 26, and this app supports 24. So the icons are
 * drawn pixel by pixel and encoded here, which keeps the APK free of any
 * binary artwork that has to be maintained by hand.
 *
 * The mark is the same shape the app uses in its top bar: a red rounded
 * rectangle with a white play triangle, on the FirFall near-black.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RES = join(HERE, "res");

const BG = [0x0f, 0x0f, 0x0f];
const RED = [0xff, 0x00, 0x00];
const WHITE = [0xff, 0xff, 0xff];

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

/** Signed distance to a rounded rectangle, for clean antialiased corners. */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Signed distance to a triangle, for a crisp but antialiased play mark. */
function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const e0 = [bx - ax, by - ay], e1 = [cx - bx, cy - by], e2 = [ax - cx, ay - cy];
  const v0 = [px - ax, py - ay], v1 = [px - bx, py - by], v2 = [px - cx, py - cy];
  const dot = (o, e) => o[0] * e[0] + o[1] * e[1];
  const edge = (o, e) => {
    const t = Math.max(0, Math.min(1, dot(o, e) / (e[0] * e[0] + e[1] * e[1])));
    const dx = o[0] - t * e[0], dy = o[1] - t * e[1];
    return dx * dx + dy * dy;
  };
  const d = Math.min(edge(v0, e0), edge(v1, e1), edge(v2, e2));
  // Only the inside of the triangle is opaque; outside reads as far away.
  const s = (e0[0] * e2[1] - e0[1] * e2[0]) < 0 ? -1 : 1;
  return s * Math.sqrt(d);
}

/** Coverage from a signed distance, one pixel of feathering. */
function cover(d) { return Math.max(0, Math.min(1, 0.5 - d)); }

function drawIcon(size, { round }) {
  const px = Buffer.alloc(size * size * 4);
  const S = size;

  // Geometry in a 108-unit design space, matching the vector icon.
  const u = S / 108;
  const boxCx = 54, boxCy = 54, boxHw = 32 * u, boxHh = 12 * u, boxR = 8 * u;
  // Play triangle.
  const tAx = 48 * u, tAy = 49 * u, tBx = 48 * u, tBy = 59 * u, tCx = 58 * u, tCy = 54 * u;

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

          const dBox = sdRoundRect(fx, fy, boxCx, boxCy, boxHw, boxHh, boxR);
          if (dBox < 0) col = RED;

          const dTri = sdTriangle(fx, fy, tAx, tAy, tBx, tBy, tCx, tCy);
          if (dTri < 0) col = WHITE;

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
