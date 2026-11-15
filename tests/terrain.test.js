import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHeightfield,
  sampleHeight,
  heightBounds,
  PEAKS,
  VALLEYS,
} from '../src/terrain.js';

test('heightfield is deterministic and normalized to [0, 1]', () => {
  const a = buildHeightfield(48);
  const b = buildHeightfield(48);
  assert.deepEqual(Array.from(a.heights), Array.from(b.heights));
  let min = Infinity;
  let max = -Infinity;
  for (const h of a.heights) {
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  assert.equal(min, 0);
  assert.equal(max, 1);
  assert.equal(heightBounds().min, 0);
  assert.equal(heightBounds().max, 1);
});

test('each configured landmark has a matching real local extremum nearby', () => {
  const field = buildHeightfield(60);
  const extrema = [];
  for (let j = 1; j < field.n - 1; j++) {
    for (let i = 1; i < field.n - 1; i++) {
      const h = field.heights[j * field.n + i];
      const ring = [
        field.heights[j * field.n + i - 1],
        field.heights[j * field.n + i + 1],
        field.heights[(j - 1) * field.n + i],
        field.heights[(j + 1) * field.n + i],
      ];
      if (ring.every((value) => value < h)) extrema.push({ kind: 'peak', i, j, h });
      if (ring.every((value) => value > h)) extrema.push({ kind: 'valley', i, j, h });
    }
  }
  for (const peak of PEAKS) {
    const match = extrema.find((entry) => {
      if (entry.kind !== 'peak') return false;
      const x = -1 + (2 * entry.i) / field.resolution;
      const z = -1 + (2 * entry.j) / field.resolution;
      return Math.hypot(x - peak.x, z - peak.z) < 0.14;
    });
    assert.ok(match, `no local maximum near peak ${peak.x},${peak.z}`);
    assert.ok(match.h > 0.7);
  }
  for (const valley of VALLEYS) {
    const match = extrema.find((entry) => {
      if (entry.kind !== 'valley') return false;
      const x = -1 + (2 * entry.i) / field.resolution;
      const z = -1 + (2 * entry.j) / field.resolution;
      return Math.hypot(x - valley.x, z - valley.z) < 0.16;
    });
    assert.ok(match, `no local minimum near valley ${valley.x},${valley.z}`);
    assert.ok(match.h < 0.35);
  }
});

test('grid points cover the full world extent', () => {
  const field = buildHeightfield(10);
  assert.deepEqual(field.n, 11);
  const first = field.heights[0];
  assert.equal(typeof first, 'number');
});
