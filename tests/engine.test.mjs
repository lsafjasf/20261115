import assert from "node:assert/strict";
import test from "node:test";

import { AssemblyEngine } from "../src/engine.js";

function fastEngine() {
  return new AssemblyEngine({
    e2e: true,
    feedDuration: 0.02,
    countdownDuration: 0.03,
    weldDuration: 0.4,
    settleDuration: 0.02,
    triggerGrace: 0.2,
    tolerance: 0.025,
    trimSpeed: 0.19
  });
}

function advance(engine, seconds, step = 0.01) {
  const count = Math.ceil(seconds / step);
  for (let i = 0; i < count; i += 1) engine.update(step);
}

function reachAlign(engine) {
  for (let i = 0; i < 20 && engine.phase !== "align"; i += 1) {
    engine.update(0.01);
  }
  assert.equal(engine.phase, "align");
  engine.setE2EOffsets(0, 0);
  engine.update(0.001);
}

test("simultaneous dual triggers complete one group", () => {
  const engine = fastEngine();
  reachAlign(engine);

  engine.pressTrigger("fixture");
  engine.pressTrigger("torch");

  assert.equal(engine.phase, "welding");
  assert.equal(engine.held.fixture, true);
  assert.equal(engine.held.torch, true);
  assert.ok(engine.weldProgress < 1);

  advance(engine, 0.45);
  assert.equal(engine.completed, 1);
  assert.equal(engine.spares, 2);
  assert.ok(["complete", "feed", "countdown"].includes(engine.phase));
});

test("one held trigger trips the interlock without progress", () => {
  const engine = fastEngine();
  reachAlign(engine);

  engine.pressTrigger("fixture");
  advance(engine, 0.25);

  assert.equal(engine.completed, 0);
  assert.equal(engine.phase, "failed");
  assert.equal(engine.failure.code, "SINGLE_OPERATOR");
  assert.equal(engine.spares, 1);
});

test("a lone tap also damages the part", () => {
  const engine = fastEngine();
  reachAlign(engine);

  engine.pressTrigger("torch");
  engine.releaseTrigger("torch");

  assert.equal(engine.completed, 0);
  assert.equal(engine.phase, "failed");
  assert.equal(engine.failure.code, "SINGLE_OPERATOR");
});

test("simultaneous but misaligned triggers damage the part", () => {
  const engine = fastEngine();
  reachAlign(engine);
  engine.setE2EOffsets(0.052, 0.052);

  engine.pressTrigger("fixture");
  engine.pressTrigger("torch");

  assert.equal(engine.completed, 0);
  assert.equal(engine.phase, "failed");
  assert.equal(engine.failure.code, "OFFSET_FAULT");
});

test("triggering during countdown is rejected", () => {
  const engine = fastEngine();
  engine.update(0.02);
  engine.update(0.01);
  assert.equal(engine.phase, "countdown");

  engine.pressTrigger("fixture");

  assert.equal(engine.phase, "failed");
  assert.equal(engine.failure.code, "EARLY_TRIGGER");
  assert.equal(engine.completed, 0);
});

test("three aligned groups finish with two spare sets retained", () => {
  const engine = fastEngine();

  for (let group = 1; group <= 3; group += 1) {
    reachAlign(engine);
    engine.pressTrigger("fixture");
    engine.pressTrigger("torch");
    advance(engine, 0.42);
    assert.equal(engine.completed, group);
    advance(engine, 0.08);
  }

  assert.equal(engine.phase, "success");
  assert.equal(engine.completed, 3);
  assert.equal(engine.spares, 2);
});
