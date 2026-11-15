import assert from "node:assert/strict";
import test from "node:test";
import {
  MAP_GEOMETRY,
  PERIOD_STATS,
  createMapGeometry,
  weightedMean,
} from "../js/data.js";
import {
  buildingsInRect,
  calculateSelectionStats,
  intersectionArea,
  statsConsistencyCheck,
} from "../js/selection.js";

const selectionRect = { x: 30, y: 30, w: 445, h: 300 };

test("three periods compare in the expected thermal order", () => {
  const { day, night, heatwave } = PERIOD_STATS;
  assert.ok(night.average < day.average);
  assert.ok(day.average < heatwave.average);
  assert.ok(day.average - night.average > 5);
  assert.ok(heatwave.average - day.average > 5);
  assert.equal(MAP_GEOMETRY.blocks.length, 24);
  assert.equal(MAP_GEOMETRY.buildings.length, 94);
});

test("building geometry is identical across all periods", () => {
  const day = createMapGeometry("day");
  const night = createMapGeometry("night");
  const heatwave = createMapGeometry("heatwave");
  const world = (geometry) => geometry.buildings.map(({ id, world: rect }) => ({ id, rect }));
  assert.deepEqual(world(night), world(day));
  assert.deepEqual(world(heatwave), world(day));
});

test("selection contains every intersected roof, not just roof centers", () => {
  const building = MAP_GEOMETRY.buildings[0];
  const edgeRect = {
    x: building.world.x + building.world.w - 1,
    y: building.world.y + building.world.h - 1,
    w: 2,
    h: 2,
  };
  assert.ok(intersectionArea(edgeRect, building.world) > 0);
  assert.ok(buildingsInRect(MAP_GEOMETRY.buildings, edgeRect).some(({ id }) => id === building.id));
});

test("selected building ids stay fixed while statistics update by period", () => {
  const day = calculateSelectionStats(selectionRect, "day");
  const night = calculateSelectionStats(selectionRect, "night");
  const heatwave = calculateSelectionStats(selectionRect, "heatwave");

  assert.ok(day.count > 0);
  assert.deepEqual(night.selectedIds, day.selectedIds);
  assert.deepEqual(heatwave.selectedIds, day.selectedIds);
  assert.ok(night.average < day.average);
  assert.ok(day.average < heatwave.average);
});

test("area-weighted selection statistics match the highlighted id set", () => {
  for (const period of ["day", "night", "heatwave"]) {
    const stats = calculateSelectionStats(selectionRect, period);
    assert.equal(statsConsistencyCheck(stats, period), true);
    assert.equal(stats.buildings.length, stats.selectedIds.length);
    assert.equal(stats.count, stats.selectedIds.length);

    const recomputed = weightedMean(stats.buildings, period);
    assert.ok(Math.abs(recomputed - stats.average) < 1e-9);
  }
});

test("empty selections do not produce a misleading average", () => {
  const stats = calculateSelectionStats({ x: 0, y: 0, w: 2, h: 2 }, "day");
  assert.equal(stats.count, 0);
  assert.equal(stats.average, null);
  assert.deepEqual(stats.selectedIds, []);
  assert.equal(statsConsistencyCheck(stats, "day"), true);
});
