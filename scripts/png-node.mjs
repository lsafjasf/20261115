import { deflateSync, inflateSync } from "node:zlib";

const signature = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10,
]);

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[n] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

export function encodePNG(width, height, pixels) {
  if (!width || !height || pixels.length !== width * height * 4) {
    throw new Error("encodePNG received invalid RGBA dimensions.");
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4)
      .copy(raw, row + 1);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilter(raw, width, height) {
  const stride = width * 4;
  const output = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y += 1) {
    const inputRow = y * (stride + 1);
    const outputRow = y * stride;
    const filter = raw[inputRow];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[inputRow + 1 + x];
      const left = x >= 4 ? output[outputRow + x - 4] : 0;
      const up = y > 0 ? output[outputRow - stride + x] : 0;
      const upperLeft =
        y > 0 && x >= 4 ? output[outputRow - stride + x - 4] : 0;
      let restored = value;
      if (filter === 1) restored = value + left;
      if (filter === 2) restored = value + up;
      if (filter === 3) restored = value + Math.floor((left + up) / 2);
      if (filter === 4) restored = value + paeth(left, up, upperLeft);
      output[outputRow + x] = restored & 0xff;
    }
  }
  return output;
}

export function decodePNG(buffer) {
  if (!Buffer.from(buffer).subarray(0, 8).equals(signature)) {
    throw new Error("Not a PNG file.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    }
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error("Only 8-bit RGBA PNG files are supported in tests.");
  }
  const raw = inflateSync(Buffer.concat(idat));
  return {
    width,
    height,
    pixels: unfilter(raw, width, height),
  };
}
