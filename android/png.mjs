/* Minimal PNG decode and encode, plus a bilinear resize.
 *
 * Used to turn the hand-made Logo.png into the sizes the app and the site need.
 * The launcher icons are raster rather than vector drawables because vector
 * launcher icons are only reliably supported from API 26 and this app's minSdk
 * is 24, so the image has to be rasterised here and encoded by hand.
 *
 * Enough of the PNG spec to read what a real encoder produces: 8-bit,
 * non-interlaced, colour types 2 (RGB) and 6 (RGBA), all five scanline filters.
 */
import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @returns {{width:number,height:number,data:Uint8Array}} RGBA, 4 bytes per pixel. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("not a PNG");
  let o = 8;
  let width = 0, height = 0, depth = 0, colorType = 0;
  const idat = [];
  let palette = null, trns = null;

  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      if (body[12] !== 0) throw new Error("interlaced PNG is not supported");
    } else if (type === "PLTE") palette = Buffer.from(body);
    else if (type === "tRNS") trns = Buffer.from(body);
    else if (type === "IDAT") idat.push(Buffer.from(body));
    else if (type === "IEND") break;
    o += 12 + len;
  }
  if (depth !== 8) throw new Error("only 8-bit PNGs are supported, got " + depth + "-bit");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error("unsupported colour type " + colorType);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  let prev = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error("unknown scanline filter " + filter);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      if (colorType === 6) {
        out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = line[s + 3];
      } else if (colorType === 2) {
        out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = 255;
      } else if (colorType === 0) {
        out[d] = out[d + 1] = out[d + 2] = line[s]; out[d + 3] = 255;
      } else if (colorType === 4) {
        out[d] = out[d + 1] = out[d + 2] = line[s]; out[d + 3] = line[s + 1];
      } else {
        const p = line[s] * 3;
        out[d] = palette[p]; out[d + 1] = palette[p + 1]; out[d + 2] = palette[p + 2];
        out[d + 3] = trns && line[s] < trns.length ? trns[line[s]] : 255;
      }
    }
    prev.set(line);
  }
  return { width, height, data: out };
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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA pixels in, PNG bytes out. Always colour type 6. */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filtering
  ihdr[12] = 0;   // no interlace

  // Filter 1 (Sub) on every scanline. On artwork with large flat areas it
  // compresses slightly better than filter 0 and costs nothing extra.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 1;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? rgba[y * stride + i - 4] : 0;
      raw[o + 1 + i] = (rgba[y * stride + i] - left) & 255;
    }
  }
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/**
 * Bilinear resize. Good enough for logos, which are smooth shapes, and far
 * simpler than a proper resampler.
 */
export function resize(src, srcW, srcH, dstW, dstH) {
  const out = new Uint8Array(dstW * dstH * 4);
  const sx = srcW / dstW, sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const fy = Math.min(srcH - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(srcH - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < dstW; x++) {
      const fx = Math.min(srcW - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(srcW - 1, x0 + 1), wx = fx - x0;
      const d = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * srcW + x0) * 4 + c], p01 = src[(y0 * srcW + x1) * 4 + c];
        const p10 = src[(y1 * srcW + x0) * 4 + c], p11 = src[(y1 * srcW + x1) * 4 + c];
        out[d + c] = Math.round((p00 * (1 - wx) + p01 * wx) * (1 - wy) + (p10 * (1 - wx) + p11 * wx) * wy);
      }
    }
  }
  return out;
}

/**
 * Composites `src` over a solid background. The logo is transparent, and a
 * transparent launcher icon looks broken on some launchers, so the app marks
 * get an opaque plate behind the artwork.
 */
export function flatten(rgba, w, h, bg) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    out[i * 4]     = Math.round(rgba[i * 4] * a + bg[0] * (1 - a));
    out[i * 4 + 1] = Math.round(rgba[i * 4 + 1] * a + bg[1] * (1 - a));
    out[i * 4 + 2] = Math.round(rgba[i * 4 + 2] * a + bg[2] * (1 - a));
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Scales `src` to fit inside a square of `size`, centred, on `bg`. Used for the
 * launcher icons, which must be square even though the logo is not.
 */
export function fitSquare(src, srcW, srcH, size, bg) {
  const k = Math.min(size / srcW, size / srcH) * 0.94;
  const w = Math.max(1, Math.round(srcW * k));
  const h = Math.max(1, Math.round(srcH * k));
  const scaled = resize(src, srcW, srcH, w, h);
  const out = new Uint8Array(size * size * 4);
  const ox = Math.round((size - w) / 2), oy = Math.round((size - h) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = (y * size + x) * 4;
      out[d] = bg[0]; out[d + 1] = bg[1]; out[d + 2] = bg[2]; out[d + 3] = 255;
      const sx = x - ox, sy = y - oy;
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
        const s = (sy * w + sx) * 4, a = scaled[s + 3] / 255;
        out[d]     = Math.round(scaled[s]     * a + bg[0] * (1 - a));
        out[d + 1] = Math.round(scaled[s + 1] * a + bg[1] * (1 - a));
        out[d + 2] = Math.round(scaled[s + 2] * a + bg[2] * (1 - a));
      }
    }
  }
  return out;
}

/** Trims fully transparent margins so the artwork fills its box. */
export function trim(rgba, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { data: rgba, width: w, height: h };
  minX = Math.max(0, minX - 2); minY = Math.max(0, minY - 2);
  maxX = Math.min(w - 1, maxX + 2); maxY = Math.min(h - 1, maxY + 2);
  const nw = maxX - minX + 1, nh = maxY - minY + 1;
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const s = ((y + minY) * w + (x + minX)) * 4, d = (y * nw + x) * 4;
      out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
    }
  }
  return { data: out, width: nw, height: nh };
}
