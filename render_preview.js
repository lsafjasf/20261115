// 离屏预览：复用 AuroraCore 纯函数光栅化一帧，输出 preview.png 供视觉检查。
const zlib = require("zlib");
const fs = require("fs");
const core = require("./aurora.js");

const W = 960, H = 540;
const params = Object.assign({}, core.DEFAULTS, { time: 0.2 });
const seed = Number(process.argv[2]) || params.seedA;
const outFile = process.argv[3] || "preview.png";

// 像素缓冲 RGBA
const px = new Float64Array(W * H * 3);

function put(x, y, r, g, b, a) {
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
}

function add(x, y, r, g, b, a) { // "lighter" 叠加
  const i = (y * W + x) * 3;
  px[i] = Math.min(255, px[i] + r * a);
  px[i + 1] = Math.min(255, px[i + 1] + g * a);
  px[i + 2] = Math.min(255, px[i + 2] + b * a);
}

// 天空渐变
for (let y = 0; y < H; y++) {
  const t = y / H;
  const r = 2 + 11 * t, g = 3 + 26 * t, b = 10 + 41 * t;
  for (let x = 0; x < W; x++) put(x, y, r, g, b, 1);
}

// 星点
const rand = core.mulberry32(seed ^ 0x9e3779b9);
for (let i = 0; i < 200; i++) {
  const x = Math.floor(rand() * W), y = Math.floor(rand() * H * 0.72);
  put(x, y, 255, 255, 255, 0.4 + 0.5 * rand());
}

// hsl -> rgb
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x2 = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x2, 0];
  else if (hp < 2) [r, g, b] = [x2, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x2];
  else if (hp < 4) [r, g, b] = [0, x2, c];
  else if (hp < 5) [r, g, b] = [x2, 0, c];
  else [r, g, b] = [c, 0, x2];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// 三层极光
for (let bnd = 0; bnd < core.BAND_COUNT; bnd++) {
  for (let x = 0; x < W; x += 2) {
    const s = core.bandShape(bnd, x / W, params, seed);
    const yTop = Math.max(0, Math.floor(s.top * H));
    const yBot = Math.min(H - 1, Math.ceil(s.bottom * H));
    const hue = 145 + (params.coolShift / 100) * 95 + bnd * (10 + params.coolShift * 0.12);
    const sat = 90 - (params.coolShift / 100) * 15;
    const a = s.intensity * (0.9 - bnd * 0.14);
    for (let y = yTop; y <= yBot; y++) {
      const t = (y - yTop) / Math.max(1, yBot - yTop);
      let la;
      if (t < 0.35) la = a * (t / 0.35);
      else if (t < 0.75) la = a * (1 - (t - 0.35) / 0.4 * 0.55);
      else la = a * 0.45 * (1 - (t - 0.75) / 0.25);
      const [r, g, bb] = hsl(hue, sat, 55);
      add(x, y, r, g, bb, la);
      add(x + 1, y, r, g, bb, la);
    }
  }
}

// 山脊两层
const layers = [
  { seed: seed + 501, base: H * 0.86, amp: H * 0.16, c: [16, 26, 44] },
  { seed: seed + 907, base: H * 0.97, amp: H * 0.2, c: [7, 12, 22] },
];
for (const L of layers) {
  const fbm = core.makeFbm(L.seed, 4);
  for (let x = 0; x < W; x++) {
    const ry = L.base - fbm((x / W) * 3.1 + L.seed * 0.001) * L.amp;
    for (let y = Math.floor(ry); y < H; y++) put(x, y, L.c[0], L.c[1], L.c[2], 1);
  }
}

// 雾：降饱和 + 灰雾带
const f = params.fog / 100;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const gray = (px[i] + px[i + 1] + px[i + 2]) / 3;
    const k = f * 0.55;
    px[i] += (gray - px[i]) * k;
    px[i + 1] += (gray - px[i + 1]) * k;
    px[i + 2] += (gray - px[i + 2]) * k;
    if (y > H * 0.68) {
      const fa = f * 0.18 * ((y - H * 0.68) / (H * 0.32));
      put(x, y, 168, 178, 190, fa);
    }
  }
}

// PNG 编码
function crc32(buf) {
  let c, table = crc32.t;
  if (!table) {
    table = crc32.t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0;
  for (let x = 0; x < W; x++) {
    const si = (y * W + x) * 3, di = y * (1 + W * 3) + 1 + x * 3;
    raw[di] = Math.round(px[si]);
    raw[di + 1] = Math.round(px[si + 1]);
    raw[di + 2] = Math.round(px[si + 2]);
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(outFile, png);
console.log(outFile + " written", W + "x" + H);
