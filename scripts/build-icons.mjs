// Renders the Hermes triangle brand glyph as PNG icons for the extension
// toolbar action and Chrome's extensions page. Pure Node (zlib + fs) so
// there's no native image dependency to install. Run manually whenever the
// icon shape changes:
//
//   node scripts/build-icons.mjs
//
// Output: public/icons/icon-{16,32,48,128}.png (transparent background,
// white triangle, 4×4 anti-aliased supersampling).

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'icons');
mkdirSync(OUT_DIR, { recursive: true });

const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;
const FG = [245, 245, 245];   // near-white glyph
const BG = [18, 18, 18];      // near-black tile (lab(7% 0 0))
const TILE_PADDING = 0.14;    // ~14 % inner padding around the glyph
const TILE_RADIUS = 0.22;     // corner radius as a fraction of size

// The Hermes brand glyph: two stacked parallelograms forming an "H"-style
// monogram. Coordinates are in the source SVG's 18×19 viewBox so the rest
// of the rasteriser can map fractions of the canvas onto these points.
const VIEW_W = 18;
const VIEW_H = 19;
const POLYGONS = [
  // Lower glyph — exact vertex order from the SVG path (the H-commands
  // step the cursor along the bottom edge to the left wall before going
  // up; dropping those nodes was producing a rounded blob instead of the
  // sharp tail tip).
  [
    [3.65786, 18.9999],
    [0.0349086, 18.9999],
    [0,        18.9999],
    [4.6864,   10.725],
    [16.4108,  10.725],
    [13.3178,  16.1864],
    [9.66796,  16.1864],
    [11.6176,  12.7438],
    [7.20091,  12.7438],
    [3.65786,  18.9999],
  ],
  // Upper glyph — mirror image, with the matching tail extending to x=18.
  [
    [14.3421,  0],
    [17.9651,  0],
    [18,       0],
    [13.3136,  8.2749],
    [1.58924,  8.2749],
    [4.68223,  2.8135],
    [8.33204,  2.8135],
    [6.38241,  6.25605],
    [10.7991,  6.25605],
    [14.3421,  0],
  ],
];

// Even-odd point-in-polygon test (handles concave shapes correctly).
function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

// Distance from point (px, py) to a rounded-square boundary inscribed in a
// (0..size, 0..size) box with the given corner radius. Negative inside,
// positive outside; used for anti-aliased edges + alpha mask of the tile.
function roundedSquareSdf(px, py, size, radius) {
  const cx = size / 2;
  const cy = size / 2;
  const dx = Math.abs(px - cx) - (size / 2 - radius);
  const dy = Math.abs(py - cy) - (size / 2 - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  const outside = Math.sqrt(ax * ax + ay * ay);
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - radius;
}

function buildPixels(size) {
  const ss = size * SUPERSAMPLE;
  const radius = ss * TILE_RADIUS;
  const padPx = ss * TILE_PADDING;
  const inner = ss - padPx * 2;

  // The glyph's natural aspect ratio inside its 18×19 viewBox is < 1, so
  // scaling by inner / max(VIEW_W, VIEW_H) ensures both axes stay inside
  // the padding box while preserving proportions.
  const scale = inner / Math.max(VIEW_W, VIEW_H);
  const offsetX = (ss - VIEW_W * scale) / 2;
  const offsetY = (ss - VIEW_H * scale) / 2;

  const pixels = Buffer.alloc(size * size * 4);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bgCovered = 0;
      let fgCovered = 0;
      for (let dy = 0; dy < SUPERSAMPLE; dy += 1) {
        for (let dx = 0; dx < SUPERSAMPLE; dx += 1) {
          const sxp = x * SUPERSAMPLE + dx + 0.5;
          const syp = y * SUPERSAMPLE + dy + 0.5;
          // Tile mask (rounded square).
          if (roundedSquareSdf(sxp, syp, ss, radius) <= 0) {
            bgCovered += 1;
            // Glyph mask, mapped back into the SVG viewBox space.
            const vx = (sxp - offsetX) / scale;
            const vy = (syp - offsetY) / scale;
            for (const poly of POLYGONS) {
              if (pointInPolygon(vx, vy, poly)) {
                fgCovered += 1;
                break;
              }
            }
          }
        }
      }
      const bgA = bgCovered / n;
      const fgA = fgCovered / n;
      // Composite: glyph (white) over tile (dark) over transparent.
      const r = BG[0] * (1 - fgA) + FG[0] * fgA;
      const g = BG[1] * (1 - fgA) + FG[1] * fgA;
      const b = BG[2] * (1 - fgA) + FG[2] * fgA;
      const i = (y * size + x) * 4;
      pixels[i + 0] = Math.round(r);
      pixels[i + 1] = Math.round(g);
      pixels[i + 2] = Math.round(b);
      pixels[i + 3] = Math.round(bgA * 255);
    }
  }
  return pixels;
}

// Tiny PNG encoder (RGBA8, no interlace).
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    crc32.table = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(pixels, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type (RGBA)
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Add filter byte (0 = None) at the start of every scanline.
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of SIZES) {
  const pixels = buildPixels(size);
  const png = encodePng(pixels, size);
  const out = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}
