import { readFileSync } from "node:fs";
import { decodePng } from "./png.mjs";

const files = [
  ["res/mipmap-mdpi/ic_launcher.png", 48],
  ["res/mipmap-xxxhdpi/ic_launcher.png", 192],
  ["../dist/icon-512.png", 512],
  ["../public/logo.png", null],
  ["../public/mobile/logo.png", null]
];

for (const [path, expect] of files) {
  const im = decodePng(readFileSync(path));
  const at = (x, y) => {
    const i = (y * im.width + x) * 4;
    return [im.data[i], im.data[i + 1], im.data[i + 2], im.data[i + 3]];
  };
  let opaque = 0, ink = 0, transp = 0;
  for (let i = 0; i < im.width * im.height; i++) {
    const o = i * 4;
    if (im.data[o + 3] === 255) opaque++;
    else transp++;
    if (Math.abs(im.data[o] - 15) > 18 || Math.abs(im.data[o + 1] - 15) > 18 || Math.abs(im.data[o + 2] - 18) > 18) ink++;
  }
  const tot = im.width * im.height;
  console.log(path + "  " + im.width + "x" + im.height +
    (expect && im.width !== expect ? "  SIZE MISMATCH, expected " + expect : ""));
  console.log("   corners opaque " + (at(0, 0)[3] === 255 && at(im.width - 1, im.height - 1)[3] === 255) +
    "   opaque " + (100 * opaque / tot).toFixed(1) + "%" +
    "   transparent " + (100 * transp / tot).toFixed(1) + "%" +
    "   artwork " + (100 * ink / tot).toFixed(1) + "%");
  if (expect) console.log("   corner px " + at(0, 0).join(",") + "   centre px " + at(im.width >> 1, im.height >> 1).join(","));
}
