import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIG,
  CargoSimulation,
  generateTasks,
  runAutoScenario
} from "../src/simulation.js";

test("same seed reproduces the exact task sequence", () => {
  const first = generateTasks("RING-305");
  const second = generateTasks("RING-305");
  const other = generateTasks("RING-305-ALT");

  assert.deepEqual(first, second);
  assert.notDeepEqual(
    first.map((task) => `${task.origin}>${task.destination}:${task.cargo}`),
    other.map((task) => `${task.origin}>${task.destination}:${task.cargo}`)
  );
  assert.equal(first.length, CONFIG.waveCount * CONFIG.tasksPerWave);
  for (let wave = 0; wave < CONFIG.waveCount; wave += 1) {
    assert.equal(first.filter((task) => task.wave === wave).length, CONFIG.tasksPerWave);
  }
});

test("task waves appear at zero, sixty and one hundred twenty seconds", () => {
  const sim = new CargoSimulation({ seed: "RING-WAVES" });
  assert.equal(sim.visibleTasks.length, 3);
  sim.advance(59.9);
  assert.equal(sim.visibleTasks.length, 3);
  sim.advance(0.2);
  assert.equal(sim.visibleTasks.length, 6);
  sim.advance(60);
  assert.equal(sim.visibleTasks.length, 9);
});

test("a policy run completes the three minute shift successfully", () => {
  const sim = runAutoScenario({ seed: "RING-305" });

  assert.equal(sim.result.status, "success");
  assert.equal(sim.time, CONFIG.duration);
  assert.ok(sim.result.completed >= sim.result.required);
  assert.ok(sim.result.reserveVehicles.length >= 1);
  assert.equal(sim.result.depletedVehicles.length, 0);
});

test("low initial batteries reach a real depletion failure", () => {
  const sim = runAutoScenario({
    seed: "RING-305",
    initialBattery: 8,
    incidentCount: 3,
    vehicleLimit: 4,
    maxQueued: 1,
    minBattery: 0
  });

  assert.equal(sim.result.status, "failure");
  assert.ok(sim.result.completed < sim.result.required);
  assert.ok(sim.result.depletedVehicles.length > 0);
  assert.match(sim.result.reason, /电量耗尽/);
});

test("priority settings are accepted and influence stored dispatch rules", () => {
  const sim = new CargoSimulation({ seed: "RING-PRIORITY" });
  assert.equal(sim.setPriority("AGV-01", "docking", 2), true);
  assert.equal(sim.setPriority("AGV-01", "charging", 0), true);
  assert.equal(sim.setPriority("AGV-01", "avoidance", 1), true);
  assert.deepEqual(sim.vehicleById.get("AGV-01").priorities, {
    docking: 2,
    charging: 0,
    avoidance: 1
  });
});
