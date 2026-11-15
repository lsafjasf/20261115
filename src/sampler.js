// Pure per-pixel sampling utilities.
// Every output pixel is mapped back to the source bitmap individually;
// the whole source canvas is never transformed or scaled as a single draw.

function makeImageData(size) {
  if (typeof ImageData !== 'undefined') {
    return new ImageData(size, size);
  }
  // Node (without DOM globals): plain object with the same data/width/height shape.
  return { data: new Uint8ClampedArray(size * size * 4), width: size, height: size };
}

export function clampInt(v, max) {
  if (v < 0) return 0;
  if (v > max) return max;
  return v;
}

function readPixel(src, sx, sy) {
  const w = src.width;
  const h = src.height;
  const x = clampInt(sx, w - 1);
  const y = clampInt(sy, h - 1);
  const idx = (y * w + x) * 4;
  return [
    src.data[idx],
    src.data[idx + 1],
    src.data[idx + 2],
    src.data[idx + 3],
  ];
}

function nearest(src, sx, sy) {
  return readPixel(src, Math.round(sx), Math.round(sy));
}

function bilinear(src, sx, sy) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = sx - x0;
  const ty = sy - y0;
  const p00 = readPixel(src, x0, y0);
  const p10 = readPixel(src, x0 + 1, y0);
  const p01 = readPixel(src, x0, y0 + 1);
  const p11 = readPixel(src, x0 + 1, y0 + 1);
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = p00[c] * (1 - tx) + p10[c] * tx;
    const bottom = p01[c] * (1 - tx) + p11[c] * tx;
    out[c] = Math.round(top * (1 - ty) + bottom * ty);
  }
  return out;
}

// Render a circular lens into a square ImageData (size x size).
// opts: { center: {x,y} in source pixels, zoom, mode: 'nearest'|'smooth' }
export function renderLens(srcImageData, size, opts) {
  const { center, zoom, mode } = opts;
  const out = makeImageData(size);
  const dst = out.data;
  const radius = size / 2;
  const sample = mode === 'smooth' ? bilinear : nearest;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px + 0.5 - radius;
      const dy = py + 0.5 - radius;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue; // outside the circular mask

      // Each output pixel individually maps back into source space.
      const sx = center.x + dx / zoom;
      const sy = center.y + dy / zoom;
      const [r, g, b, a] = sample(srcImageData, sx, sy);

      const o = (py * size + px) * 4;
      // Anti-alias the circle rim over a 1px band.
      const edge = radius - dist;
      const cover = edge >= 1 ? 1 : clampInt(Math.round(edge * 255), 255) / 255;
      dst[o] = r;
      dst[o + 1] = g;
      dst[o + 2] = b;
      dst[o + 3] = Math.round(a * cover);
    }
  }
  return out;
}

// Shared pure sampler for callers that only need pixel values.
export function samplePixel(srcImageData, sx, sy, mode) {
  return (mode === 'smooth' ? bilinear : nearest)(srcImageData, sx, sy);
}
