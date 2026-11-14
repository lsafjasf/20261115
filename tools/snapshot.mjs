// tools/snapshot.mjs — 无浏览器渲染岛屿快照 PNG，用于视觉验证
import zlib from 'node:zlib';
import fs from 'node:fs';
import { Island, marchingSquares } from '../terrain.js';

const S = 800;

function encodePNG(px, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const chunk = (type, data) => {
    const buf = Buffer.alloc(12 + data.length);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4);
    data.copy(buf, 8);
    let crc = 0xffffffff;
    for (let i = 4; i < 8 + data.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    buf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
    return buf;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function makeCanvas() {
  const px = Buffer.alloc(S * S * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const o = (y * S + x) * 4;
    if (a >= 255) {
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    } else {
      const t = a / 255;
      px[o] = r * t + px[o] * (1 - t);
      px[o + 1] = g * t + px[o + 1] * (1 - t);
      px[o + 2] = b * t + px[o + 2] * (1 - t);
      px[o + 3] = 255;
    }
  };
  const disc = (cx, cy, rad, r, g, b, a = 255) => {
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
      for (let x = Math.floor(cx - rad); x <= cx + rad; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) set(x, y, r, g, b, a);
  };
  const line = (x0, y0, x1, y1, wdt, r, g, b, a = 255) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), wdt / 2, r, g, b, a);
    }
  };
  return { px, set, disc, line };
}
function render(island, file) {
  const { px, set, disc, line } = makeCanvas();
  const n = island.n;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const h = island.sampleHeight(x / S, y / S);
      let r, g, b;
      if (h <= 0) {
        const d = Math.min(1, -h * 2.2);
        r = 26 + 20 * (1 - d); g = 78 + 40 * (1 - d); b = 122 + 40 * (1 - d);
      } else if (h < 0.06) {
        r = 224; g = 205; b = 150;
      } else if (h < 0.3) {
        const t = (h - 0.06) / 0.24;
        r = 150 - 40 * t; g = 178 - 30 * t; b = 110 - 30 * t;
      } else {
        const t = Math.min(1, (h - 0.3) / 0.5);
        r = 120 + 60 * t; g = 140 - 30 * t; b = 95 - 20 * t;
      }
      set(x, y, r | 0, g | 0, b | 0);
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ci = Math.min(n - 1, Math.floor((x / S) * n));
      const cj = Math.min(n - 1, Math.floor((y / S) * n));
      if (island.wetlandMask[cj * n + ci]) set(x, y, 46, 125, 110, 110);
    }
  }
  for (let lv = 1; lv <= 8; lv++)
    for (const s of marchingSquares(island.h, n, lv / 10))
      line(s[0] * S, s[1] * S, s[2] * S, s[3] * S, 1, 60, 50, 30, 90);
  for (const s of marchingSquares(island.h, n, 0))
    line(s[0] * S, s[1] * S, s[2] * S, s[3] * S, 2, 32, 49, 61);
  for (const path of island.rivers)
    for (let k = 1; k < path.length; k++)
      line(((path[k - 1] % n) + 0.5) / n * S, (((path[k - 1] / n) | 0) + 0.5) / n * S,
        ((path[k] % n) + 0.5) / n * S, (((path[k] / n) | 0) + 0.5) / n * S, 3, 63, 167, 245);
  for (const v of island.villages) {
    disc(v.x * S, v.y * S, 6, 192, 57, 43);
    disc(v.x * S, v.y * S, 3, 255, 255, 255);
  }
  for (const cp of island.getControlPoints()) disc(cp.x * S, cp.y * S, 5, 255, 214, 64);
  fs.writeFileSync(file, encodePNG(px, S, S));
  console.log('written', file);
}

fs.mkdirSync('artifacts', { recursive: true });
for (const seed of [20261114, 887123]) {
  const island = new Island(seed);
  render(island, `artifacts/island-${seed}-before.png`);
  const cps = island.getControlPoints();
  let inward = cps[0];
  for (const cp of cps) if (cp.r > inward.r) inward = cp;
  island.applyBoundaryEdit(inward.index, Math.max(0.12, inward.r * 0.55));
  render(island, `artifacts/island-${seed}-edited.png`);
}
