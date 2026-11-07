/**
 * Generates the PWA icons as PNGs without any image dependency: a minimal
 * PNG encoder (IHDR/IDAT/IEND + zlib) drawing the app motif — dark slate
 * background, orange trail-marker ring with crosshair ticks, white center
 * dot. Outputs:
 *
 *   public/icons/icon-192.png          (any)
 *   public/icons/icon-512.png          (any)
 *   public/icons/icon-maskable-512.png (maskable — features inside the safe zone)
 *
 * Run: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// CRC32 table (lazy singleton)
let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** PNG chunk: length + type + data + CRC32 */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Encode RGBA pixels (row-major, filter byte 0 per row) as PNG. */
function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Render the app motif into an RGBA buffer. */
function render(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const s = maskable ? 0.72 : 1; // maskable: features inside the 80% safe zone
  const bg = [15, 23, 42]; // slate-950
  const orange = [234, 88, 12]; // #ea580c
  const white = [255, 255, 255];
  const put = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x - size / 2) / (size * s) + 0.5;
      const v = (y - size / 2) / (size * s) + 0.5;
      const d = Math.hypot(u - 0.5, v - 0.5);
      put(x, y, bg);
      // orange trail-marker ring
      if (Math.abs(d - 0.3) < 0.045 * s) put(x, y, orange);
      // white center dot
      if (d < 0.055 * s) put(x, y, white);
      // crosshair ticks (N/S/E/W)
      const tickW = 0.02 * s;
      const near = (a) => Math.abs(a) < tickW;
      const inNorth = v < -0.3 && v > -0.42;
      const inSouth = v > 0.3 && v < 0.42;
      const inWest = u < -0.3 && u > -0.42;
      const inEast = u > 0.3 && u < 0.42;
      if ((near(u) && (inNorth || inSouth)) || (near(v) && (inWest || inEast))) {
        put(x, y, orange);
      }
    }
  }
  return px;
}

mkdirSync(outDir, { recursive: true });
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  const png = encodePng(size, render(size, maskable));
  writeFileSync(join(outDir, name), png);
  console.log(`wrote ${join(outDir, name)} (${(png.length / 1024).toFixed(1)} kB)`);
}
