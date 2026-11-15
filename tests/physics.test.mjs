import test from "node:test";
import assert from "node:assert/strict";
import {
  cloneState,
  createInitialState,
  snapshotState,
  stepSimulation
} from "../js/physics.js";
import { createDemoController } from "../js/autopilot.js";
import { RunRecorder, verifyReplay } from "../js/recording.js";

function simulateRecordedRun() {
  const initial = createInitialState();
  const simulation = cloneState(initial);
  const recorder = new RunRecorder(initial);
  const controller = createDemoController();

  while (simulation.status === "live" && simulation.step < 900) {
    const input = controller(simulation);
    stepSimulation(simulation, input);
    recorder.record(input, simulation);
  }
  return { initial, simulation, recorder };
}

test("two-player demo clears both gates and reaches the finish", () => {
  const { simulation } = simulateRecordedRun();

  assert.equal(simulation.status, "success");
  assert.equal(simulation.gatePasses, 4);
  assert.equal(simulation.finishCount, 2);
  assert.ok(simulation.cars.every((car) => car.finished));
  assert.ok(simulation.cars.every((car) => car.gates.every(Boolean)));
  assert.ok(simulation.cable.damage < 100);
  assert.ok(simulation.step < 900);
});

test("recorded inputs reproduce every physics frame exactly", () => {
  const { initial, recorder } = simulateRecordedRun();
  const result = verifyReplay(initial, recorder.frames);

  assert.equal(result.ok, true);
  assert.equal(result.mismatches, 0);
  assert.equal(result.maxError, 0);
  assert.equal(result.recordedDigest, result.replayDigest);
  assert.ok(result.steps > 0);
});

test("the same run is deterministic across executions", () => {
  const first = simulateRecordedRun();
  const second = simulateRecordedRun();
  const firstFinal = snapshotState(first.simulation);
  const secondFinal = snapshotState(second.simulation);

  assert.deepEqual(firstFinal, secondFinal);
  assert.equal(verifyReplay(first.initial, first.recorder.frames).replayDigest,
    verifyReplay(second.initial, second.recorder.frames).replayDigest);
});

test("an over-tight anchored cable damages both vehicles", () => {
  const state = createInitialState();
  state.cable.target = 92;

  for (let index = 0; index < 1200 && state.status === "live"; index += 1) {
    stepSimulation(state, { throttle: 1, steer: 0, payout: -1, anchor: true });
  }

  assert.equal(state.status, "failed");
  assert.equal(state.cable.damage, 100);
  assert.ok(state.cars.every((car) => car.damage === 100));
  assert.match(state.events[0].text, /损毁/);
});

test("a cable longer than the distance transmits no force", () => {
  const state = createInitialState();
  state.cable.target = 290;

  for (let index = 0; index < 60; index += 1) {
    stepSimulation(state, { throttle: 0, steer: 0, payout: 0, anchor: false });
  }

  assert.equal(state.cable.tension, 0);
  assert.ok(state.cable.slack > 0);
});
