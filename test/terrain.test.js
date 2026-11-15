import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PARAMS,
  HEIGHT_SCALE,
  analyzeTerrain,
  generateTerrain,
  gridToWorld,
  sampleHeight,
  worldToGrid,
} from "../src/terrain.js";

test("same seed and parameters produce a deterministic height field", () => {
  const first = generateTerrain(DEFAULT_PARAMS, 96);
  const second = generateTerrain({ ...DEFAULT_PARAMS }, 96);
  assert.deepEqual(Array.from(first.heights), Array.from(second.heights));
  assert.equal(first.heights.length, 96 * 96);
});

test("ember-42 and tidal-ridge generate measurably different geography", () => {
  const a = generateTerrain({ ...DEFAULT_PARAMS, seed: "ember-42" }, 128);
  const b = generateTerrain({ ...DEFAULT_PARAMS, seed: "tidal-ridge" }, 128);
  const statsA = analyzeTerrain(a.heights, a.grid, a.params.seaLevel);
  const statsB = analyzeTerrain(b.heights, b.grid, b.params.seaLevel);
  let totalDifference = 0;
  let maxDifference = 0;
  for (let index = 0; index < a.heights.length; index += 1) {
    const difference = Math.abs(a.heights[index] - b.heights[index]);
    totalDifference += difference;
    maxDifference = Math.max(maxDifference, difference);
  }
  assert.ok(totalDifference / a.heights.length > 0.02);
  assert.ok(maxDifference > 0.08);
  assert.notEqual(statsA.peakElevation.toFixed(2), statsB.peakElevation.toFixed(2));
  assert.notEqual(statsA.landPercent.toFixed(3), statsB.landPercent.toFixed(3));
});

test("erosion strength changes the height field and lowers the peak", () => {
  const smooth = generateTerrain({ ...DEFAULT_PARAMS, erosion: 0 }, 96);
  const eroded = generateTerrain({ ...DEFAULT_PARAMS, erosion: 0.85 }, 96);
  const statsSmooth = analyzeTerrain(smooth.heights, smooth.grid, smooth.params.seaLevel);
  const statsEroded = analyzeTerrain(eroded.heights, eroded.grid, eroded.params.seaLevel);
  assert.ok(statsEroded.highest < statsSmooth.highest);
  assert.ok(Math.abs(statsEroded.landPercent - statsSmooth.landPercent) > 0.5);
});

test("changing only sea level keeps the peak and floods a flat low-lying area", () => {
  const terrain = generateTerrain({ ...DEFAULT_PARAMS, seaLevel: 0.3 }, 128);
  const lowWater = analyzeTerrain(terrain.heights, terrain.grid, 0.3);
  const highWater = analyzeTerrain(terrain.heights, terrain.grid, 0.64);
  assert.equal(highWater.highest, lowWater.highest);
  assert.ok(highWater.landAreaKm2 < lowWater.landAreaKm2);
  const expectedLand = Array.from(terrain.heights).filter((height) => height > 0.64).length / terrain.heights.length;
  assert.ok(Math.abs(highWater.landFraction - expectedLand) < 1e-12);
  assert.equal(highWater.waterElevation, 0.64 * HEIGHT_SCALE);
});

test("flag world coordinates survive seed and water changes", () => {
  const original = generateTerrain({ ...DEFAULT_PARAMS, seed: "ember-42", seaLevel: 0.4 }, 128);
  let flagGrid = null;
  for (let index = 0; index < original.heights.length; index += 1) {
    if (original.heights[index] > 0.42 && original.heights[index] < 0.47) {
      flagGrid = { x: index % original.grid, z: Math.floor(index / original.grid) };
      break;
    }
  }
  assert.ok(flagGrid, "expected a low coastal cell above the initial water line");
  const flag = {
    id: "cave-test",
    name: "洞穴 01",
    world: gridToWorld(original.heights, original.grid, flagGrid.x, flagGrid.z),
  };
  const coordinateSnapshot = JSON.stringify(flag.world);
  const before = analyzeTerrain(original.heights, original.grid, original.params.seaLevel);
  assert.ok(flag.world.y > before.waterElevation);

  const flooded = analyzeTerrain(original.heights, original.grid, 0.62);
  assert.ok(flag.world.y < flooded.waterElevation);
  assert.equal(JSON.stringify(flag.world), coordinateSnapshot);

  const changed = generateTerrain({
    ...DEFAULT_PARAMS,
    seed: "tidal-ridge",
    frequency: 4.2,
    octaves: 7,
    erosion: 0.82,
    seaLevel: 0.62,
  }, 128);
  const changedStats = analyzeTerrain(changed.heights, changed.grid, changed.params.seaLevel);
  assert.equal(JSON.stringify(flag.world), coordinateSnapshot);
  assert.ok(Number.isFinite(changedStats.peakElevation));
  const surfaceNow = sampleHeight(changed.heights, changed.grid, flag.world.x, flag.world.z) * HEIGHT_SCALE;
  assert.notEqual(Math.round(surfaceNow), Math.round(flag.world.y));
});

test("world and grid coordinate conversion round trips", () => {
  const terrain = generateTerrain({ ...DEFAULT_PARAMS, seed: "coordinate-check" }, 100);
  const world = gridToWorld(terrain.heights, terrain.grid, 71, 28);
  const grid = worldToGrid(world.x, world.z, terrain.grid);
  assert.ok(Math.abs(grid.x - 71) < 1e-9);
  assert.ok(Math.abs(grid.z - 28) < 1e-9);
  assert.ok(Math.abs(world.y - terrain.heights[28 * terrain.grid + 71] * HEIGHT_SCALE) < 1e-9);
});
