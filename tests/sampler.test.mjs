import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLens, samplePixel } from '../src/sampler.js';

// 6x6 checkerboard of 3x3 blocks with increasing red level per column.
function makeFixture() {
  const w = 6;
  const h = 6;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const block = (Math.floor(x / 3) + Math.floor(y / 3)) % 2;
      data[i] = block ? 200 : 40;
      data[i + 1] = x * 30;
      data[i + 2] = y * 30;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const src = makeFixture();

test('nearest sampling returns exact source pixel values', () => {
  const [r, g, b, a] = samplePixel(src, 1.2, 2.4, 'nearest');
  const idx = (2 * 6 + 1) * 4;
  assert.equal(r, src.data[idx]);
  assert.equal(g, src.data[idx + 1]);
  assert.equal(b, src.data[idx + 2]);
  assert.equal(a, 255);
});

test('bilinear sampling interpolates channel values between pixels', () => {
  // Exactly halfway between (0,0) red=40 and (1,0) red=40 (same column block,
  // same red) -> red stays; green changes from 0 to 30 -> 15.
  const [, g] = samplePixel(src, 0.5, 0, 'smooth');
  assert.equal(g, 15);
});

test('nearest vs smooth differ on a fractional coordinate', () => {
  const n = samplePixel(src, 0.5, 0, 'nearest');
  const s = samplePixel(src, 0.5, 0, 'smooth');
  assert.notDeepEqual(n, s);
});

test('lens is circular: corners transparent, center opaque', () => {
  const size = 32;
  const frame = renderLens(src, size, {
    center: { x: 3, y: 3 },
    zoom: 4,
    mode: 'nearest',
  });
  const corner = (0 * size + 0) * 4 + 3;
  const center = ((size / 2) * size + size / 2) * 4 + 3;
  assert.equal(frame.data[corner], 0);
  assert.equal(frame.data[center], 255);
});

test('zoom changes while the same source point stays at lens center', () => {
  const size = 32;
  const center = { x: 2.7, y: 3.1 };
  const low = renderLens(src, size, { center, zoom: 2, mode: 'nearest' });
  const high = renderLens(src, size, { center, zoom: 8, mode: 'nearest' });
  const c = size / 2;
  const idx = (c * size + c) * 4;
  // Central pixel maps to round(center) in both cases, so it is identical.
  assert.deepEqual(
    [low.data[idx], low.data[idx + 1], low.data[idx + 2]],
    [high.data[idx], high.data[idx + 1], high.data[idx + 2]],
  );
  // A pixel away from the center samples a different (closer) source region
  // at higher zoom, proving magnification varies around the fixed anchor.
  const off = (c * size + (c + 8)) * 4;
  const moved =
    low.data[off] !== high.data[off] ||
    low.data[off + 1] !== high.data[off + 1];
  assert.ok(moved, 'off-center pixels must change with zoom');
});

test('out-of-range source coordinates clamp instead of overflowing', () => {
  const [r] = samplePixel(src, 99, 99, 'nearest');
  const edgeIdx = (5 * 6 + 5) * 4;
  assert.equal(r, src.data[edgeIdx]);
});
