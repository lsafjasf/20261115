// Node tests for core.js: unified color scale, colormap switching sync,
// divider-boundary isolation, and param (de)serialization.
'use strict';

const assert = require('assert');
const C = require('./core.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

const SEED = 12345;
const specs = C.generateAll(SEED);
const W = 120;
const H = 90;
const DX = 55;
const DY = 40;

function render(cmap, vmin, vmax) {
  const scale = C.makeColorScale(vmin, vmax, cmap);
  return C.renderAll(specs, scale, W, H, DX, DY);
}

function quadrantSlice(pixels, rect) {
  const rows = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    const start = (y * W + rect.x) * 4;
    rows.push(Buffer.from(pixels.buffer, pixels.byteOffset + start, rect.width * 4));
  }
  return Buffer.concat(rows);
}

test('generates four distinct spectrograms with finite values', () => {
  assert.strictEqual(specs.length, 4);
  const titles = new Set(specs.map((s) => s.title));
  assert.strictEqual(titles.size, 4);
  for (const s of specs) {
    assert.strictEqual(s.data.length, s.width * s.height);
    for (const v of s.data) assert.ok(Number.isFinite(v));
  }
  const a = specs[0].data;
  const b = specs[1].data;
  assert.ok(a.some((v, i) => v !== b[i]), 'spectrograms must differ');
});

test('both colormaps produce valid RGB across [0,1]', () => {
  for (const name of ['viridis', 'jet']) {
    const cmap = C.COLORMAPS[name];
    for (let i = 0; i <= 100; i++) {
      const rgb = cmap(i / 100);
      for (const ch of rgb) {
        assert.ok(ch >= 0 && ch <= 255, name + ' channel out of range');
      }
    }
  }
  // The two colormaps must actually be different mappings.
  const v = C.COLORMAPS.viridis(0.5);
  const j = C.COLORMAPS.jet(0.5);
  assert.ok(Math.abs(v[0] - j[0]) + Math.abs(v[1] - j[1]) + Math.abs(v[2] - j[2]) > 30);
});

test('unified scale maps equal values to equal colors in every quadrant', () => {
  // A constant-value spec rendered into each quadrant must give the identical
  // color everywhere: the scale is shared, so no per-subplot normalization.
  const constant = { data: new Float32Array(16 * 16).fill(0.8), width: 16, height: 16, title: 'k' };
  const scale = C.makeColorScale(0, 1.6, 'viridis');
  const rendered = C.renderAll([constant, constant, constant, constant], scale, W, H, DX, DY);
  const expected = scale(0.8).map(Math.round);
  for (const rect of rendered.rects) {
    const i = ((rect.y + 2) * W + rect.x + 2) * 4;
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(rendered.pixels[i + c] - expected[c]) <= 1, 'quadrant color mismatch');
    }
  }
});

test('switching colormap updates ALL four subplots', () => {
  const a = render('viridis', 0, 1.6);
  const b = render('jet', 0, 1.6);
  assert.deepStrictEqual(a.rects, b.rects);
  for (const rect of a.rects) {
    const qa = quadrantSlice(a.pixels, rect);
    const qb = quadrantSlice(b.pixels, rect);
    assert.ok(!qa.equals(qb), 'subplot at ' + rect.x + ',' + rect.y + ' did not update');
  }
});

test('changing vmin/vmax updates ALL four subplots', () => {
  const a = render('viridis', 0, 1.6);
  const b = render('viridis', 0.2, 1.2);
  for (const rect of a.rects) {
    const qa = quadrantSlice(a.pixels, rect);
    const qb = quadrantSlice(b.pixels, rect);
    assert.ok(!qa.equals(qb), 'subplot at ' + rect.x + ',' + rect.y + ' did not update');
  }
});

test('divider boundaries isolate subplots (no cross-divider bleeding)', () => {
  const scale = C.makeColorScale(0, 1.6, 'viridis');
  const rendered = C.renderAll(specs, scale, W, H, DX, DY);
  // Re-render each quadrant alone into its own buffer and compare exactly.
  for (let q = 0; q < 4; q++) {
    const rect = rendered.rects[q];
    const solo = new Uint8ClampedArray(rect.width * rect.height * 4);
    C.renderSubplot(specs[q], scale, solo, rect.width, { x: 0, y: 0, width: rect.width, height: rect.height });
    const stitched = quadrantSlice(rendered.pixels, rect);
    assert.ok(Buffer.from(solo.buffer).equals(stitched), 'quadrant ' + q + ' differs when stitched');
  }
  // Pixels adjacent to the divider belong to their own subplot and are opaque
  // (no blended/undefined band at the seam).
  const seamLeft = ((DY + 2) * W + (DX - 1)) * 4;
  const seamRight = ((DY + 2) * W + DX) * 4;
  for (const idx of [seamLeft, seamRight]) {
    assert.strictEqual(rendered.pixels[idx + 3], 255, 'seam pixel must be opaque');
  }
});

test('hover readout returns one finite value per subplot', () => {
  const values = C.valuesAt(specs, 0.37, 0.62);
  assert.strictEqual(values.length, 4);
  values.forEach((v) => assert.ok(Number.isFinite(v)));
});

test('params JSON round-trips and rejects invalid input', () => {
  const p = C.defaultParams();
  p.colormap = 'jet';
  p.vmin = -0.2;
  p.vmax = 2.5;
  p.dividerX = 0.3;
  p.dividerY = 0.7;
  const back = C.parseParams(C.serializeParams(p));
  assert.deepStrictEqual(back, p);
  assert.throws(() => C.parseParams('{"colormap":"nope","vmin":0,"vmax":1,"dividerX":0.5,"dividerY":0.5}'));
  assert.throws(() => C.parseParams('{"colormap":"jet","vmin":2,"vmax":1,"dividerX":0.5,"dividerY":0.5}'));
  assert.throws(() => C.parseParams('{"colormap":"jet","vmin":0,"vmax":1,"dividerX":1.5,"dividerY":0.5}'));
});

test('regeneration with same seed is deterministic', () => {
  const again = C.generateAll(SEED);
  for (let i = 0; i < 4; i++) {
    assert.deepStrictEqual(Array.from(again[i].data.slice(0, 64)), Array.from(specs[i].data.slice(0, 64)));
  }
});

console.log('\n' + passed + ' tests passed');
