import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  LANES,
  createSimulation,
  getSnapshot,
  selectLane,
  setControlValues,
  stepSimulation,
  triggerWarmFront,
} from "../src/simulation.js";

const SPRAY_TEST_RECIPE = [
  [42, 69, 34],
  [78, 57, 34],
  [96, 36, 36],
];

function sprayLane(simulation, index, [water, air, angle], extra = 0.5) {
  selectLane(simulation, index);
  setControlValues(simulation, { water, air, angle, spraying: true });
  for (let step = 0; step < 400; step += 1) {
    stepSimulation(simulation, 0.1);
    const lane = getSnapshot(simulation).lanes[index];
    if (lane.certified && lane.thickness >= lane.targetThickness + extra) break;
  }
  setControlValues(simulation, { spraying: false });
}

const simulation = createSimulation();
SPRAY_TEST_RECIPE.forEach((recipe, index) => sprayLane(simulation, index, recipe));
const prepared = getSnapshot(simulation);

assert.equal(prepared.success, true);
assert.equal(prepared.certifiedCount, LANES.length);

triggerWarmFront(simulation);
for (let step = 0; step < 180; step += 1) stepSimulation(simulation, 0.1);
const warmed = getSnapshot(simulation);

assert.ok(warmed.environment.temperature - prepared.environment.temperature >= 4);
assert.ok(warmed.averageQuality < prepared.averageQuality - 0.2);
assert.equal(warmed.success, false);
assert.ok(warmed.certifiedCount < LANES.length);

const warmRecipe = [
  [35, 98, 38],
  [57, 65, 38],
  [80, 48, 40],
];
warmRecipe.forEach((recipe, index) => sprayLane(simulation, index, recipe, 0.7));
const restored = getSnapshot(simulation);

assert.equal(restored.success, true);
assert.equal(restored.certifiedCount, LANES.length);
assert.ok(restored.averageQuality > warmed.averageQuality + 0.08);

const report = {
  generatedAt: new Date().toISOString(),
  checks: [
    {
      name: "三条雪道达到不同硬度与厚度标准",
      passed: prepared.success && prepared.certifiedCount === 3,
    },
    {
      name: "暖锋使气温上升超过 4°C",
      passed:
        warmed.environment.temperature - prepared.environment.temperature >= 4,
    },
    {
      name: "升温后平均雪质显著下降",
      passed: warmed.averageQuality < prepared.averageQuality - 0.2,
    },
    {
      name: "升温后雪道认证失效",
      passed: !warmed.success && warmed.certifiedCount < 3,
    },
    {
      name: "调整水量、空气和角度后恢复验收",
      passed: restored.success && restored.certifiedCount === 3,
    },
  ],
  preparation: {
    targetTemperature: Number(prepared.environment.temperature.toFixed(1)),
    quality: Number(prepared.averageQuality.toFixed(3)),
    lanes: prepared.lanes.map((lane) => ({
      name: lane.name,
      thickness: Number(lane.thickness.toFixed(1)),
      hardness: Number(lane.hardness.toFixed(1)),
    })),
  },
  warmFront: {
    temperature: Number(warmed.environment.temperature.toFixed(1)),
    quality: Number(warmed.averageQuality.toFixed(3)),
    qualityDrop: Number(
      (prepared.averageQuality - warmed.averageQuality).toFixed(3),
    ),
    certifiedCount: warmed.certifiedCount,
    success: warmed.success,
  },
  adjustment: {
    controls: warmRecipe.at(-1),
    quality: Number(restored.averageQuality.toFixed(3)),
    certifiedCount: restored.certifiedCount,
    success: restored.success,
  },
};

await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/verification.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
