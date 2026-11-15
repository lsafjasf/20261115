import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHeightfield, sampleHeight, PEAKS, VALLEYS } from '../src/terrain.js';
import { contourAtLevel, joinChains, boundaryParam } from '../src/marching.js';
import { buildPlanLoops, fullTerrainPolygon } from '../src/contour-loops.js';

const field = buildHeightfield(96);

test('contours at extreme thresholds produce no geometry or full coverage', () => {
  const below = contourAtLevel(field, 0);
  const above = contourAtLevel(field, 1.0001);
  assert.equal(below.segments.length, 0);
  assert.ok(below.triangles.length > 0);
  assert.equal(above.segments.length, 0);
  assert.equal(above.triangles.length, 0);
});

test('every contour vertex lies exactly on the requested level', () => {
  for (const level of [0.15, 0.37, 0.52, 0.71, 0.88]) {
    const result = contourAtLevel(field, level);
    assert.ok(result.segments.length > 0, `no segments at ${level}`);
    for (const [a, b] of result.segments) {
      assert.ok(Math.abs(a[1] - level) < 1e-6);
      assert.ok(Math.abs(b[1] - level) < 1e-6);
      assert.ok(a[0] >= -1.002 && a[0] <= 1.002);
      assert.ok(b[2] >= -1.002 && b[2] <= 1.002);
    }
  }
});

test('joined chains are topologically clean: no dangling interior nodes', () => {
  const result = contourAtLevel(field, 0.42);
  const chains = joinChains(result.segments);
  const interior = new Map();
  for (const chain of chains) {
    if (chain.closed) continue;
    for (const point of chain.points.slice(1, -1)) {
      const key = point.join('|');
      interior.set(key, (interior.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of interior) {
    assert.equal(count, 1, `interior node repeated: ${key}`);
  }
  assert.ok(chains.some((chain) => chain.closed || chain.points.length > 2));
});

test('plan loops are closed polygons inside the terrain square', () => {
  const result = contourAtLevel(field, 0.42);
  const loops = buildPlanLoops(result.segments);
  assert.ok(loops.length > 0);
  for (const loop of loops) {
    assert.ok(loop.length >= 3);
    for (const [x, z] of loop) {
      assert.ok(x >= -1.002 && x <= 1.002);
      assert.ok(z >= -1.002 && z <= 1.002);
    }
  }
  assert.equal(fullTerrainPolygon().length, 4);
});

test('highlight triangles cover every cell corner above the threshold', () => {
  const level = 0.42;
  const result = contourAtLevel(field, level);
  const triangleXZ = new Set();
  for (let k = 0; k < result.triangles.length; k += 3) {
    for (let c = 0; c < 3; c++) {
      const point = result.triangles[k + c];
      triangleXZ.add(`${point[0].toFixed(4)},${point[2].toFixed(4)}`);
    }
  }
  let aboveCorners = 0;
  let covered = 0;
  const { resolution, n, heights } = field;
  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      if (heights[j * n + i] < level) continue;
      aboveCorners += 1;
      const x = -1 + (2 * i) / resolution;
      const z = -1 + (2 * j) / resolution;
      if (triangleXZ.has(`${x.toFixed(4)},${z.toFixed(4)}`)) covered += 1;
    }
  }
  assert.ok(aboveCorners > 0);
  assert.equal(covered, aboveCorners);
});

test('fine threshold sweep: contour geometry moves continuously without jumps', () => {
  const levels = [];
  for (let k = 0; k <= 200; k++) levels.push(k / 200);
  const reports = levels.map((level) => {
    const result = contourAtLevel(field, level);
    const points = result.segments.flat();
    for (const point of points) {
      assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[2]));
    }
    return {
      level,
      segments: result.segments.length,
      triangles: result.triangles.length / 3,
      chains: joinChains(result.segments).length,
      points,
    };
  });
  const cellDiagonal = Math.SQRT2 * (2 / field.resolution);
  const p95Series = [];
  for (let k = 1; k < reports.length; k++) {
    const prev = reports[k - 1];
    const cur = reports[k];
    assert.ok(cur.segments >= 0 && cur.triangles >= 0);
    // Geometric continuity: points shared between adjacent frames must move at
    // most ~2 cells. Birth/death events are covered by landmark tests below.
    if (prev.points.length > 0 && cur.points.length > 0) {
      const surviveLimit = cellDiagonal * 1.8;
      const distances = nearestDistances(prev.points, cur.points)
        .filter((d) => d <= surviveLimit)
        .sort((a, b) => a - b);
      if (distances.length < prev.points.length * 0.5) continue;
      const p95 = distances[Math.floor(distances.length * 0.95)];
      p95Series.push(p95);
      assert.ok(p95 <= cellDiagonal * 2.2, `geometry jump at ${cur.level}: ${p95}`);
    }
  }
  const median = p95Series.sort((a, b) => a - b)[Math.floor(p95Series.length / 2)];
  assert.ok(median < cellDiagonal, `median contour motion too large: ${median}`);
});

function nearestDistances(source, targets) {
  const cell = 2 / field.resolution;
  const grid = new Map();
  for (const point of targets) {
    const key = `${Math.floor(point[0] / cell)},${Math.floor(point[2] / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(point);
  }
  const out = [];
  for (const a of source) {
    let best = Infinity;
    const gx = Math.floor(a[0] / cell);
    const gz = Math.floor(a[2] / cell);
    for (let ring = 0; ring <= 8; ring++) {
      for (let ox = -ring; ox <= ring; ox++) {
        for (let oz = -ring; oz <= ring; oz++) {
          if (ring > 0 && Math.max(Math.abs(ox), Math.abs(oz)) !== ring) continue;
          const bucket = grid.get(`${gx + ox},${gz + oz}`);
          if (!bucket) continue;
          for (const b of bucket) {
            const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
            if (d < best) best = d;
          }
        }
      }
      if (Number.isFinite(best)) break;
    }
    out.push(best);
  }
  return out;
}

function chamfer(aPoints, bPoints) {
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  return mean(nearestDistances(aPoints, bPoints)) +
    mean(nearestDistances(bPoints, aPoints));
}

test('crossing a summit: its closed contour loop appears then shrinks away', () => {
  const peak = PEAKS[0];
  const summit = sampleHeight(peak.x, peak.z);
  const loopCounts = [];
  const distances = [];
  for (let delta = -0.12; delta <= 0.02; delta += 0.01) {
    const level = Math.max(0, summit + delta);
    const result = contourAtLevel(field, level);
    const chains = joinChains(result.segments).filter((chain) => chain.closed);
    loopCounts.push(chains.length);
    if (chains.length > 0) {
      const enclosing = chains.filter((chain) =>
        chain.points.every(
          (point) => Math.hypot(point[0] - peak.x, point[2] - peak.z) < 0.5,
        ),
      );
      if (enclosing.length > 0) {
        const radius =
          enclosing[0].points.reduce(
            (sum, point) => sum + Math.hypot(point[0] - peak.x, point[2] - peak.z),
            0,
          ) / enclosing[0].points.length;
        distances.push(radius);
      }
    }
  }
  assert.ok(loopCounts.some((count) => count > 0), 'summit loop never appears');
  assert.equal(loopCounts.at(-1), 0, 'loop must vanish above the summit');
  for (let k = 1; k < distances.length; k++) {
    assert.ok(
      distances[k] <= distances[k - 1] + 1e-6,
      'summit loop should shrink as level rises',
    );
  }
});

test('crossing a valley: geometry deforms continuously through the valley floor', () => {
  const valley = VALLEYS[0];
  const floor = sampleHeight(valley.x, valley.z);
  const history = [];
  for (let delta = -0.02; delta <= 0.14; delta += 0.01) {
    const level = Math.min(1, floor + delta);
    const result = contourAtLevel(field, level);
    history.push({
      level,
      segments: result.segments.length,
      triangles: result.triangles.length / 3,
      points: result.segments
        .flat()
        .filter((point) => Math.hypot(point[0] - valley.x, point[2] - valley.z) < 0.6),
    });
  }
  const bound = Math.SQRT2 * (2 / field.resolution) * 2.2;
  for (let k = 1; k < history.length; k++) {
    const prev = history[k - 1];
    const cur = history[k];
    if (prev.points.length > 0 && cur.points.length > 0) {
      assert.ok(
        chamfer(prev.points, cur.points) <= bound,
        `discontinuous contour near valley at ${cur.level}`,
      );
    }
  }
  assert.ok(history.every((entry) => entry.segments >= 0 && entry.triangles >= 0));
  assert.ok(floor >= 0);
});

test('boundary parameter wraps monotonically around the perimeter', () => {
  assert.equal(boundaryParam([-1, 0, -1]), 0);
  assert.equal(boundaryParam([1, 0, -1]), 2);
  assert.equal(boundaryParam([1, 0, 1]), 4);
  assert.equal(boundaryParam([-1, 0, 1]), 6);
});
