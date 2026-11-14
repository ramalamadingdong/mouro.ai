#!/usr/bin/env node
/**
 * Generates the PWA icon set and the favicon from one source of truth.
 *
 *   node scripts/make-icons.mjs
 *
 * Writes:
 *   public/icons/icon-192.png        192x192   manifest icon
 *   public/icons/icon-512.png        512x512   manifest icon / splash
 *   public/icons/apple-touch-icon.png 180x180  iOS home screen
 *   public/favicon.svg                         browser tab
 *
 * WHY A HAND-ROLLED RASTERISER. The project ships no image dependency (sharp,
 * canvas, resvg all pull native binaries) and Node has no bitmap API, so this
 * file draws the icon itself into an RGBA buffer and encodes PNG with the zlib
 * that is already in the standard library. That keeps the icons reproducible
 * from a clean checkout with zero install step, which is the whole point of
 * checking a generator in rather than three opaque binaries.
 *
 * WHY REGENERATE RATHER THAN EDIT THE PNGs. The geometry below is expressed in
 * FRACTIONS of the canvas, so every size is the same drawing and none of them
 * can drift from the others or from favicon.svg — which this script also emits
 * from the same constants.
 *
 * MASKABLE SAFE ZONE. Android may crop a maskable icon to any shape inside the
 * centre 80% circle (radius 0.4 x canvas from the centre). The die's furthest
 * point is ~0.327 x canvas from the centre — see SAFE_ZONE_CHECK below, which
 * fails the build rather than shipping a clipped icon.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');
const ICONS_DIR = join(PUBLIC_DIR, 'icons');

/* ── Palette ────────────────────────────────────────────────────────────────
 * Copied from src/theme/tokens.css. Not imported: that file is CSS consumed by
 * the browser, and parsing it here would buy nothing but a parser. If the theme
 * changes, change these three lines and re-run.
 */
const FELT = '#151828'; //  --felt          the dark table, full bleed
const ACCENT = '#f0a830'; // --accent        amber die body
const PIP = '#1a1206'; //    --text-on-accent  9.13:1 on --accent

/* ── Geometry, as fractions of the canvas edge ───────────────────────────────
 * Tuned at 48px, which is the smallest place a favicon actually gets read. A
 * bigger die is more legible but eats the maskable margin, so DIE_SIDE is the
 * one number worth re-checking if you touch anything here.
 */
const DIE_SIDE = 0.53; //    die edge length
const DIE_RADIUS = 0.115; // die corner rounding
const PIP_RADIUS = 0.046; // one pip
const PIP_OFFSET = 0.145; // pip centre distance from the die centre, per axis

/**
 * The five-face, drawn as offsets from the centre in fractions of the canvas.
 * Five rather than six: an odd face has a centre pip, which keeps the glyph
 * readable when it is 24 device pixels wide and the pips start to merge.
 */
const PIPS = [
  [-PIP_OFFSET, -PIP_OFFSET],
  [PIP_OFFSET, -PIP_OFFSET],
  [0, 0],
  [-PIP_OFFSET, PIP_OFFSET],
  [PIP_OFFSET, PIP_OFFSET],
];

/**
 * Furthest extent of the drawing from the canvas centre, as a fraction of the
 * edge. For a rounded box that is the corner-arc centre plus the corner radius.
 */
const DIE_EXTENT = Math.SQRT2 * (DIE_SIDE / 2 - DIE_RADIUS) + DIE_RADIUS;
const SAFE_ZONE_RADIUS = 0.4; // centre 80% circle, per the maskable icon spec

// Fail here rather than shipping an icon Android will crop into.
if (DIE_EXTENT > SAFE_ZONE_RADIUS) {
  throw new Error(
    `Die extends ${DIE_EXTENT.toFixed(3)} from centre but the maskable safe ` +
      `zone is ${SAFE_ZONE_RADIUS}. Reduce DIE_SIDE.`,
  );
}

/* ── Drawing ───────────────────────────────────────────────────────────────── */

/** '#rrggbb' → [r, g, b]. Throws rather than silently drawing black. */
function parseHex(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Signed distance from a point to a rounded box centred on the origin, in the
 * same units as the inputs. Negative inside. This is the standard formulation:
 * shrink the box by the corner radius, take the distance to that smaller box,
 * then subtract the radius back off.
 */
function sdRoundedBox(x, y, halfSide, radius) {
  const qx = Math.abs(x) - halfSide + radius;
  const qy = Math.abs(y) - halfSide + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

/**
 * Coverage of a pixel by a shape, from that shape's signed distance in PIXELS.
 *
 * This is the cheap analytic approximation of antialiasing: a pixel whose
 * centre sits exactly on the edge (d = 0) is half covered, and coverage ramps
 * linearly over the one pixel straddling the boundary. It is why this script
 * needs no supersampling pass — at these sizes the difference is invisible and
 * the edges come out clean at 48px, which brute-force nearest-neighbour would
 * not.
 */
function coverage(distanceInPixels) {
  return Math.min(Math.max(0.5 - distanceInPixels, 0), 1);
}

/**
 * Renders the icon at `size` x `size` into a fully opaque RGBA buffer.
 *
 * Opaque on purpose. A maskable icon is composited onto a background the OS
 * chooses, and a transparent one gets a white or black plate behind it that is
 * not the app's colour; iOS flattens alpha to black outright. Painting the felt
 * edge to edge means every platform gets the intended background.
 */
function renderIcon(size) {
  const felt = parseHex(FELT);
  const accent = parseHex(ACCENT);
  const pip = parseHex(PIP);

  const halfSide = (DIE_SIDE / 2) * size;
  const dieRadius = DIE_RADIUS * size;
  const pipRadius = PIP_RADIUS * size;
  const centre = size / 2;

  // Pip centres in pixels, precomputed so the inner loop is pure arithmetic.
  const pips = PIPS.map(([dx, dy]) => [dx * size, dy * size]);

  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Sample at the pixel CENTRE (+0.5), not its corner. Sampling the corner
      // shifts the whole drawing half a pixel up-left, which is visible as an
      // asymmetric border at 48px.
      const x = px + 0.5 - centre;
      const y = py + 0.5 - centre;

      let r = felt[0];
      let g = felt[1];
      let b = felt[2];

      // Die over felt.
      const dieCoverage = coverage(sdRoundedBox(x, y, halfSide, dieRadius));
      if (dieCoverage > 0) {
        r += (accent[0] - r) * dieCoverage;
        g += (accent[1] - g) * dieCoverage;
        b += (accent[2] - b) * dieCoverage;
      }

      // Pips over the die. Each pip is disjoint from the others, so compositing
      // them in sequence needs no coverage accumulation.
      for (const [cx, cy] of pips) {
        const pipCoverage = coverage(Math.hypot(x - cx, y - cy) - pipRadius);
        if (pipCoverage > 0) {
          r += (pip[0] - r) * pipCoverage;
          g += (pip[1] - g) * pipCoverage;
          b += (pip[2] - b) * pipCoverage;
        }
      }

      const i = (py * size + px) * 4;
      pixels[i] = Math.round(r);
      pixels[i + 1] = Math.round(g);
      pixels[i + 2] = Math.round(b);
      pixels[i + 3] = 255;
    }
  }

  return pixels;
}

/* ── PNG encoding ──────────────────────────────────────────────────────────── */

/** CRC-32 table (the polynomial PNG mandates), built once at module load. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  // >>> 0 because the running value is a signed 32-bit int and PNG wants the
  // unsigned reading of the same bits.
  return (c ^ -1) >>> 0;
}

/** One PNG chunk: length, type, data, CRC over type+data. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Encodes an RGBA buffer as a PNG.
 *
 * Every scanline is prefixed with filter type 0 (None). Real encoders pick a
 * per-line filter to help compression, but these icons are flat colour and
 * deflate already gets them under a few KB, so the extra machinery would be
 * unread code.
 */
function encodePng(pixels, size) {
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; //  bit depth
  ihdr[9] = 6; //  colour type 6 = truecolour with alpha
  ihdr[10] = 0; // compression: deflate (the only defined value)
  ihdr[11] = 0; // filter method 0 (the only defined value)
  ihdr[12] = 0; // interlace: none

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── favicon.svg ────────────────────────────────────────────────────────────
 * Emitted from the same constants as the PNGs so the tab icon and the installed
 * icon are the same drawing. A 64-unit viewBox keeps the numbers short and
 * readable in the output.
 */
function renderSvg() {
  const U = 64;
  const side = DIE_SIDE * U;
  const origin = (U - side) / 2;
  const round = (n) => Number(n.toFixed(2));

  const pips = PIPS.map(
    ([dx, dy]) =>
      `  <circle cx="${round(U / 2 + dx * U)}" cy="${round(U / 2 + dy * U)}" ` +
      `r="${round(PIP_RADIUS * U)}" fill="${PIP}" />`,
  ).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${U} ${U}" width="${U}" height="${U}" role="img" aria-label="Yahtzee">
  <title>Yahtzee</title>
  <rect width="${U}" height="${U}" fill="${FELT}" />
  <rect x="${round(origin)}" y="${round(origin)}" width="${round(side)}" height="${round(side)}" rx="${round(DIE_RADIUS * U)}" fill="${ACCENT}" />
${pips}
</svg>
`;
}

/* ── Emit ──────────────────────────────────────────────────────────────────── */

mkdirSync(ICONS_DIR, { recursive: true });

const OUTPUTS = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

for (const [name, size] of OUTPUTS) {
  const png = encodePng(renderIcon(size), size);
  const path = join(ICONS_DIR, name);
  writeFileSync(path, png);
  console.log(`  public/icons/${name}  ${size}x${size}  ${png.length} bytes`);
}

const svg = renderSvg();
writeFileSync(join(PUBLIC_DIR, 'favicon.svg'), svg);
console.log(`  public/favicon.svg  ${svg.length} bytes`);
console.log(
  `\n✓ Icons written. Maskable margin: die reaches ${DIE_EXTENT.toFixed(3)} of ` +
    `the canvas from centre, safe zone is ${SAFE_ZONE_RADIUS}.`,
);
