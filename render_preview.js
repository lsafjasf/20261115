// Renders the stitched comparison image to PNG using only core.js + zlib,
// so the visual result (both colormaps, off-center dividers) can be inspected
// without a browser. Output goes to artifacts/.
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const C = require('./core.js');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const W = 900;
const H = 640;
const specs = C.generateAll(12345);

for (const cmap of ['viridis', 'jet']) {
  const scale = C.makeColorScale(0, 1.6, cmap);
  // Off-center dividers, as after a user drag.
  const { pixels } = C.renderAll(specs, scale, W, H, W * 0.62, H * 0.42);
  // Draw divider lines the same way the page does.
  const dx = Math.round(W * 0.62);
  const dy = Math.round(H * 0.42);
  for (let x = 0; x < W; x++) {
    const i = (dy * W + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
  }
  for (let y = 0; y < H; y++) {
    const i = (y * W + dx) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
  }
  const png = encodePng(W, H, pixels);
  const file = 'artifacts/preview_' + cmap + '.png';
  fs.writeFileSync(file, png);
  console.log('wrote ' + file + ' (' + png.length + ' bytes)');
}
