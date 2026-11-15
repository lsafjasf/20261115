// Node test suite for the map validator.
// Run: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMap, START } from "../js/mapgen.js";
import { hashLayers, findPath, locateBlockingPlacement, findFixedSeed } from "../js/validator.js";
import { validateSeed, diffLayer } from "../js/report.js";

export const GOOD_SEED = "demo-good";
export const BAD_SEED = "348";
export const FIXED_SEED = "349";

test("three generations produce identical layer hashes", () => {
  const r = validateSeed(GOOD_SEED);
  assert.equal(r.deterministic, true);
  for (const layer of ["obstacles", "goals", "decorations", "navNodes"]) {
    assert.equal(r.determinism[layer].ok, true, layer);
    assert.equal(r.determinism[layer].hashes.length, 3);
  }
});

test("good seed: every goal reachable with a sane path length", () => {
  const r = validateSeed(GOOD_SEED);
  assert.equal(r.ok, true);
  assert.equal(r.unreachable.length, 0);
  for (const g of r.goalResults) {
    assert.equal(g.reachable, true);
    assert.ok(g.pathLength > 0, "path length positive");
    assert.equal(g.path[0].x, START.x);
    assert.equal(g.path[0].y, START.y);
    const last = g.path[g.path.length - 1];
    assert.equal(last.x, g.goal.x);
    assert.equal(last.y, g.goal.y);
  }
});

test("bad seed 348: goal #1 unreachable, blocker located, fix proposed", () => {
  const r = validateSeed(BAD_SEED);
  assert.equal(r.ok, false);
  assert.equal(r.unreachable.length, 1);
  assert.deepEqual(
    { x: r.unreachable[0].goal.x, y: r.unreachable[0].goal.y },
    { x: 2, y: 6 }
  );
  const blocker = r.blockers[0].placement;
  assert.ok(blocker, "blocking placement identified");
  assert.equal(blocker.type, "obstacle");
  assert.deepEqual({ x: blocker.x, y: blocker.y }, { x: 1, y: 6 });
  assert.ok(r.fix, "fix seed proposed");
  assert.equal(r.fix.seed, FIXED_SEED);
});

test("fixed seed passes full validation", () => {
  const r = validateSeed(FIXED_SEED);
  assert.equal(r.ok, true);
  assert.equal(r.unreachable.length, 0);
});

test("locateBlockingPlacement pinpoints the exact enclosing obstacle", () => {
  const map = generateMap(BAD_SEED);
  const goal = map.goals.find((g) => g.x === 2 && g.y === 6);
  const p = locateBlockingPlacement(map, goal);
  assert.deepEqual({ x: p.x, y: p.y }, { x: 1, y: 6 });

  // Sanity: removing that single obstacle restores reachability.
  const repaired = generateMap(BAD_SEED);
  repaired.obstacles.delete(`${p.x},${p.y}`);
  assert.ok(findPath(repaired, goal.x, goal.y), "reachable after repair");
});

test("findFixedSeed returns a fully reachable map", () => {
  const fix = findFixedSeed(BAD_SEED);
  assert.ok(fix);
  const map = generateMap(fix.seed);
  for (const g of map.goals) {
    assert.ok(findPath(map, g.x, g.y), `goal ${g.id} reachable`);
  }
});

test("hashLayers is stable and layer-sensitive", () => {
  const a = hashLayers(generateMap(GOOD_SEED));
  const b = hashLayers(generateMap(GOOD_SEED));
  assert.deepEqual(a, b);
  const c = hashLayers(generateMap("another-seed"));
  assert.notEqual(a.obstacles, c.obstacles);
});

test("diffLayer reports cell-level differences", () => {
  const m1 = generateMap(GOOD_SEED);
  const m2 = generateMap(GOOD_SEED);
  const same = diffLayer(m1, m2, "obstacles");
  assert.equal(same.onlyA.length, 0);
  assert.equal(same.onlyB.length, 0);

  const m3 = generateMap(BAD_SEED);
  const diff = diffLayer(m1, m3, "obstacles");
  assert.ok(diff.onlyA.length > 0 || diff.onlyB.length > 0);
});
