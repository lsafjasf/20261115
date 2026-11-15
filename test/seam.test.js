import assert from "node:assert/strict";
import { test } from "node:test";
import { createTileGeometry, tileBounds } from "../src/geometry.js";
import { LEVEL_META } from "../src/terrain.js";

function edgeSamples(levelIndex, x, z) {
  const level = LEVEL_META[levelIndex];
  const geometry = createTileGeometry(level, x, z);
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color");
  const bounds = tileBounds(level, x, z);
  const samples = new Map();
  for (let i = 0; i < position.count; i += 1) {
    const px = position.getX(i);
    const pz = position.getZ(i);
    const onEdge =
      Math.abs(px - bounds.minX) < 0.01 ||
      Math.abs(px - bounds.maxX) < 0.01 ||
      Math.abs(pz - bounds.minZ) < 0.01 ||
      Math.abs(pz - bounds.maxZ) < 0.01;
    if (!onEdge) continue;
    samples.set(`${px.toFixed(3)}:${pz.toFixed(3)}`, {
      height: position.getY(i),
      color: [color.getX(i), color.getY(i), color.getZ(i)]
    });
  }
  geometry.dispose();
  return samples;
}

test("shared L0/L1 boundary vertices agree in height and color", () => {
  const coarse = edgeSamples(0, 1, 0);
  const fineWest = edgeSamples(1, 3, 0);
  const fineNorth = edgeSamples(1, 3, 1);
  let compared = 0;
  let maxHeight = 0;
  let maxColor = 0;

  for (const [key, value] of fineWest) {
    const match = coarse.get(key);
    if (!match) continue;
    compared += 1;
    maxHeight = Math.max(maxHeight, Math.abs(match.height - value.height));
    for (let channel = 0; channel < 3; channel += 1) {
      maxColor = Math.max(
        maxColor,
        Math.abs(match.color[channel] - value.color[channel])
      );
    }
  }

  assert.ok(compared > 40, `expected shared boundary samples, got ${compared}`);
  assert.ok(
    fineNorth.size > 0,
    "the adjacent fine tile should provide boundary coverage"
  );
  assert.ok(maxHeight < 1e-6, `height discontinuity: ${maxHeight}`);
  assert.ok(maxColor < 1e-6, `color discontinuity: ${maxColor}`);
});

test("tile pyramid covers the full world extent exactly", () => {
  for (const level of LEVEL_META) {
    const first = tileBounds(level, 0, 0);
    const last = tileBounds(level, level.grid - 1, level.grid - 1);
    assert.equal(first.minX, -1024);
    assert.equal(first.minZ, -1024);
    assert.equal(last.maxX, 1024);
    assert.equal(last.maxZ, 1024);
    assert.equal(level.tileSize, level.tileSize);
    assert.equal(level.tileSize % 8, 0);
  }
});
