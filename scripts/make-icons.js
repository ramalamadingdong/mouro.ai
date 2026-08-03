#!/usr/bin/env node
/**
 * Generate every app icon from code, so they can be regenerated after a palette
 * change instead of being opaque binaries nobody can edit.
 *
 *   node scripts/make-icons.js
 *
 * The mark is the board itself: a felt field inside a gold-inlaid frame, with
 * two rows of alternating cream/maroon points meeting in the middle. It stays
 * legible at 32px, which is the only real constraint on an app icon.
 *
 * Deliberately dependency-free — PNG is a container around a zlib stream, and
 * Node ships zlib. Adding sharp/canvas to build four static files would be a
 * poor trade.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FELT = [0x12, 0x36, 0x2a];
const DEEP = [0x0d, 0x27, 0x1e];
const GOLD = [0xd4, 0xaf, 0x37];
const CREAM = [0xf5, 0xf0, 0xe1];
const MAROON = [0x7c, 0x2d, 0x3a];

/** Minimal PNG encoder: RGBA8, no interlacing, one IDAT. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
  return c ^ -1;
}

/** Is (px, py) inside the triangle (ax,ay)-(bx,by)-(cx,cy)? */
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Render the mark at `size`, supersampled 3x3 so the diagonal triangle edges
 * are not a staircase.
 */
function render(size, { round = false } = {}) {
  const SS = 3;
  const n = size * SS;
  const acc = new Float64Array(size * size * 3);
  const alpha = new Float64Array(size * size);

  const frame = n * 0.06; // outer felt margin
  const inlay = n * 0.028; // gold frame thickness
  const boardX0 = frame;
  const boardY0 = frame;
  const boardX1 = n - frame;
  const boardY1 = n - frame;
  const innerX0 = boardX0 + inlay;
  const innerY0 = boardY0 + inlay;
  const innerX1 = boardX1 - inlay;
  const innerY1 = boardY1 - inlay;
  const midY = (innerY0 + innerY1) / 2;
  const cols = 6;
  const colW = (innerX1 - innerX0) / cols;
  const triH = (midY - innerY0) * 0.86;
  const radius = round ? n * 0.5 : 0;

  for (let sy = 0; sy < n; sy++) {
    for (let sx = 0; sx < n; sx++) {
      let colour = null;
      let inside = true;

      if (round) {
        const dx = sx + 0.5 - n / 2;
        const dy = sy + 0.5 - n / 2;
        inside = dx * dx + dy * dy <= radius * radius;
      }

      if (inside) {
        colour = DEEP;
        if (sx >= boardX0 && sx < boardX1 && sy >= boardY0 && sy < boardY1) colour = GOLD;
        if (sx >= innerX0 && sx < innerX1 && sy >= innerY0 && sy < innerY1) {
          colour = FELT;
          const col = Math.floor((sx - innerX0) / colW);
          const cx = innerX0 + col * colW;
          const centre = cx + colW / 2;
          // Top row points DOWN toward the middle; bottom row points UP.
          if (
            inTriangle(sx + 0.5, sy + 0.5, cx + 1, innerY0, cx + colW - 1, innerY0, centre, innerY0 + triH)
          ) {
            colour = col % 2 === 0 ? CREAM : MAROON;
          } else if (
            inTriangle(sx + 0.5, sy + 0.5, cx + 1, innerY1, cx + colW - 1, innerY1, centre, innerY1 - triH)
          ) {
            colour = col % 2 === 0 ? MAROON : CREAM;
          }
        }
      }

      const px = Math.floor(sx / SS);
      const py = Math.floor(sy / SS);
      const idx = py * size + px;
      if (colour) {
        acc[idx * 3] += colour[0];
        acc[idx * 3 + 1] += colour[1];
        acc[idx * 3 + 2] += colour[2];
        alpha[idx] += 1;
      }
    }
  }

  const rgba = Buffer.alloc(size * size * 4);
  const samples = SS * SS;
  for (let i = 0; i < size * size; i++) {
    const a = alpha[i];
    if (a === 0) continue;
    rgba[i * 4] = Math.round(acc[i * 3] / a);
    rgba[i * 4 + 1] = Math.round(acc[i * 3 + 1] / a);
    rgba[i * 4 + 2] = Math.round(acc[i * 3 + 2] / a);
    rgba[i * 4 + 3] = Math.round((a / samples) * 255);
  }
  return encodePng(size, size, rgba);
}

const root = path.join(__dirname, '..');
const targets = [
  ['assets/images/icon.png', 1024, {}],
  ['assets/images/adaptive-icon.png', 1024, {}],
  ['assets/images/splash-icon.png', 512, {}],
  ['assets/images/favicon.png', 64, {}],
  ['public/icons/icon-192.png', 192, {}],
  ['public/icons/icon-512.png', 512, {}],
  ['public/icons/apple-touch-icon.png', 180, {}],
];

for (const [rel, size, opts] of targets) {
  const out = path.join(root, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, render(size, opts));
  console.log(`wrote ${rel} (${size}x${size})`);
}
