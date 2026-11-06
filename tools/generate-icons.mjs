// Generate Veil toolbar icons (16/32/128 PNG) with no image deps.
// A flat solid dark rounded tile with the Veil mark in solid gold:
// a simple "V" of two strokes meeting at a solid node, with a small
// veil arc over the top. No gradients, no glow.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const outDir = fileURLToPath(new URL("../dist/icons/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const GOLD = hex("#C9A24B"), BG = hex("#0b0d11");

// Distance from point (px,py) to the segment a->b.
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function pixel(x, y, N) {
  // Rounded-rect tile mask.
  const cx = N / 2, cy = N / 2, hw = N / 2 - 0.5, hh = N / 2 - 0.5, r = N * 0.24;
  const qx = Math.abs(x - cx) - (hw - r), qy = Math.abs(y - cy) - (hh - r);
  const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  const tileA = clamp(0.5 - d, 0, 1);
  if (tileA <= 0) return [0, 0, 0, 0];

  // Flat dark tile.
  let col = [BG[0], BG[1], BG[2]];

  // The "V": two strokes from the top corners down to a solid node.
  const nodeX = N * 0.50, nodeY = N * 0.68;
  const lX = N * 0.30, lY = N * 0.37;
  const rX = N * 0.70, rY = N * 0.37;
  const strokeHalf = Math.max(1.0, N * 0.055);
  const dV = Math.min(
    segDist(x, y, lX, lY, nodeX, nodeY),
    segDist(x, y, rX, rY, nodeX, nodeY),
  );
  let markA = clamp(strokeHalf - dV + 0.5, 0, 1);

  // Solid node where the two strokes meet.
  const nodeR = N * 0.085;
  markA = Math.max(markA, clamp(nodeR - Math.hypot(x - nodeX, y - nodeY) + 0.5, 0, 1));

  // Small veil arc draped over the top.
  const acx = N * 0.50, acy = N * 0.62, aR = N * 0.30, aHalf = Math.max(0.9, N * 0.045);
  if (y < acy - aR * 0.55) {
    const dArc = Math.hypot(x - acx, y - acy);
    markA = Math.max(markA, clamp(aHalf - Math.abs(dArc - aR) + 0.5, 0, 1));
  }

  if (markA > 0) col = [lerp(col[0], GOLD[0], markA), lerp(col[1], GOLD[1], markA), lerp(col[2], GOLD[2], markA)];

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
