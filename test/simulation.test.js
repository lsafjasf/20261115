import assert from "node:assert/strict";
import test from "node:test";
import {
  LANES,
  advanceSimulation,
  createSimulation,
  getForecast,
  getSnapshot,
  selectLane,
  setControlValues,
  stepSimulation,
  triggerWarmFront,
} from "../src/simulation.js";

function setLaneControls(simulation, index, water, air, angle = 34, spraying = true) {
  selectLane(simulation, index);
  setControlValues(simulation, { water, air, angle, spraying });
}

function sprayUntilCertified(simulation, index, stepSeconds = 0.1, maxSeconds = 30) {
  let elapsed = 0;
  while (elapsed < maxSeconds) {
    stepSimulation(simulation, stepSeconds);
    elapsed += stepSeconds;
    const lane = getSnapshot(simulation).lanes[index];
    if (lane.certified && lane.thickness >= LANES[index].targetThickness + 0.6) {
      break;
    }
  }
  setControlValues(simulation, { spraying: false });
  return elapsed;
}

function prepareAllLanes(simulation) {
  const recipe = [
    [42, 69, 34],
    [78, 57, 34],
    [96, 36, 36],
  ];
  recipe.forEach(([water, air, angle], index) => {
    setLaneControls(simulation, index, water, air, angle);
    sprayUntilCertified(simulation, index);
  });
  setControlValues(simulation, { spraying: false });
  return getSnapshot(simulation);
}

test("three lanes reach distinct thickness and hardness targets", () => {
  const simulation = createSimulation();
  const snapshot = prepareAllLanes(simulation);

  assert.equal(snapshot.success, true);
  assert.equal(snapshot.certifiedCount, 3);
  assert.equal(snapshot.phase, "open");
  assert.deepEqual(
    snapshot.lanes.map((lane) => lane.certified),
    [true, true, true],
  );
  assert.ok(snapshot.lanes[0].hardness < snapshot.lanes[1].hardness);
  assert.ok(snapshot.lanes[1].hardness < snapshot.lanes[2].hardness);
  snapshot.lanes.forEach((lane, index) => {
    assert.ok(lane.thickness >= LANES[index].targetThickness);
    assert.ok(
      Math.abs(lane.hardness - LANES[index].targetHardness) <= LANES[index].tolerance,
    );
    assert.ok(lane.ice <= 0.38);
  });
});

test("warm front raises temperature and degrades settled snow quality", () => {
  const simulation = createSimulation();
  const prepared = prepareAllLanes(simulation);
  const before = {
    temperature: prepared.environment.temperature,
    quality: prepared.averageQuality,
    certified: prepared.certifiedCount,
  };

  assert.equal(triggerWarmFront(simulation), true);
  advanceSimulation(simulation, 18);
  const after = getSnapshot(simulation);

  assert.ok(
    after.environment.temperature - before.temperature >= 4,
    "temperature should rise by at least 4 °C",
  );
  assert.ok(after.averageQuality < before.quality - 0.2, "average snow quality should drop");
  assert.ok(after.certifiedCount < before.certified, "warmth should revoke certification");
  assert.equal(after.phase, "testing");
  assert.equal(after.success, false);
  assert.ok(
    after.lanes.some((lane) => lane.meltLoss > 0.2),
    "settled snow should record melt loss",
  );
});

test("warmer air requires more air, less water and a higher nozzle angle", () => {
  const simulation = createSimulation();
  prepareAllLanes(simulation);
  triggerWarmFront(simulation);
  advanceSimulation(simulation, 18);

  const coldForecast = getForecast(createSimulation(), 0);
  const warmForecast = getForecast(simulation, 0);
  assert.ok(warmForecast.wetness > coldForecast.wetness + 0.15);
  assert.ok(warmForecast.hardness > LANES[0].targetHardness + LANES[0].tolerance);

  selectLane(simulation, 0);
  setControlValues(simulation, { water: 35, air: 98, angle: 38, spraying: true });
  const adjusted = getForecast(simulation, 0);
  assert.ok(adjusted.wetness < warmForecast.wetness);
  assert.ok(
    Math.abs(adjusted.hardness - LANES[0].targetHardness) <= LANES[0].tolerance,
  );
  assert.ok(adjusted.quality > 0.8);
});

test("rebalancing after the warm front restores all three certifications", () => {
  const simulation = createSimulation();
  prepareAllLanes(simulation);
  triggerWarmFront(simulation);
  advanceSimulation(simulation, 18);
  const degraded = getSnapshot(simulation);
  assert.ok(degraded.averageQuality < 0.75);
  assert.ok(degraded.certifiedCount < 3);

  const warmRecipe = [
    [35, 98, 38],
    [57, 65, 38],
    [80, 48, 40],
  ];
  warmRecipe.forEach(([water, air, angle], index) => {
    setLaneControls(simulation, index, water, air, angle);
    sprayUntilCertified(simulation, index);
  });
  setControlValues(simulation, { spraying: false });
  const restored = getSnapshot(simulation);

  assert.equal(restored.success, true);
  assert.equal(restored.certifiedCount, 3);
  assert.equal(restored.phase, "open");
  assert.ok(restored.averageQuality > degraded.averageQuality + 0.08);
});
