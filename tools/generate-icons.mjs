// Generate Unlink toolbar icons (16/32/128 PNG) with no image deps.
// A rounded brand-gradient tile with a broken ring (un-link) mark.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const outDir = fileURLToPath(new URL("../dist/icons/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const A = hex("#44e59a"), B = hex("#179469"), RING = hex("#eafff5"), BG = hex("#0d1117");

function pixel(x, y, N) {
  const cx = N / 2, cy = N / 2, hw = N / 2 - 0.5, hh = N / 2 - 0.5, r = N * 0.24;
  const qx = Math.abs(x - cx) - (hw - r), qy = Math.abs(y - cy) - (hh - r);
  const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  const tileA = clamp(0.5 - d, 0, 1);
  if (tileA <= 0) return [0, 0, 0, 0];

  const t = clamp((x + y) / (2 * N), 0, 1);
  let col = [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];

  // broken ring
  const dist = Math.hypot(x - cx, y - cy);
  const ringR = N * 0.265, w = Math.max(1.2, N * 0.085);
  const band = 1 - clamp((Math.abs(dist - ringR) - w) / 1.2 + 1, 0, 1);
  let ang = Math.atan2(y - cy, x - cx); // gap at lower-right (~45°)
  const inGap = Math.abs(ang - Math.PI / 4) < 0.62;
  const ringA = inGap ? 0 : band;
  if (ringA > 0) col = [lerp(col[0], RING[0], ringA), lerp(col[1], RING[1], ringA), lerp(col[2], RING[2], ringA)];

  // two dots capping the broken ends
  for (const a of [Math.PI / 4 - 0.62, Math.PI / 4 + 0.62]) {
    const dx = cx + Math.cos(a) * ringR, dy = cy + Math.sin(a) * ringR;
    const dd = Math.hypot(x - dx, y - dy);
    const dotA = clamp((w * 0.95 - dd), 0, 1);
    if (dotA > 0) col = [lerp(col[0], RING[0], dotA), lerp(col[1], RING[1], dotA), lerp(col[2], RING[2], dotA)];
  }
  return [col[0], col[1], col[2], 255 * tileA];
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(N) {
  const raw = Buffer.alloc((N * 4 + 1) * N);
  let o = 0;
  for (let y = 0; y < N; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < N; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, N);
      raw[o++] = clamp(Math.round(r), 0, 255);
      raw[o++] = clamp(Math.round(g), 0, 255);
      raw[o++] = clamp(Math.round(b), 0, 255);
      raw[o++] = clamp(Math.round(a), 0, 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

for (const N of [16, 32, 128]) writeFileSync(outDir + `icon-${N}.png`, png(N));
console.log("icons:", [16, 32, 128].map((n) => `icon-${n}.png`).join(", "));
