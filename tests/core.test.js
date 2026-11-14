import assert from "node:assert/strict";
import test from "node:test";
import { LIGHT_FIXTURES, StudioEngine } from "../src/engine.js";

const REFERENCE_TAKES = [
  {
    atMs: 1700,
    camera: { x: 525, y: 211, focal: 51 },
    lights: [13.284866484902182, 270.48850144290964],
  },
  {
    atMs: 2300,
    camera: { x: 240, y: 85, focal: 30 },
    lights: [351.21615037438164, 152.0540227769858],
  },
  {
    atMs: 2300,
    camera: { x: 240, y: 154, focal: 55 },
    lights: [11.216150374381641, 276.0540227769858],
  },
];

function applyTake(engine, take) {
  const delta = take.atMs - engine.elapsedMs;
  assert.ok(delta >= 0, "test takes must move forward in time");
  engine.update(delta);
  engine.setCamera(take.camera);
  engine.setLightAngle(0, take.lights[0]);
  engine.setLightAngle(1, take.lights[1]);
}

test("pause freezes actor and beat on exactly the same clock frame", () => {
  const engine = new StudioEngine();
  engine.update(1700);
  engine.setPaused(true);

  const frozen = engine.getClockSnapshot();
  assert.equal(frozen.paused, true);
  assert.equal(frozen.elapsedMs, 1700);
  assert.equal(frozen.beatIndex, 2);

  for (let index = 0; index < 10; index += 1) {
    const result = engine.update(500);
    assert.equal(result.advanced, false);
    assert.equal(result.beatChanged, false);
  }

  const stillFrozen = engine.getClockSnapshot();
  assert.deepEqual(stillFrozen.actor, frozen.actor);
  assert.equal(stillFrozen.elapsedMs, frozen.elapsedMs);
  assert.equal(stillFrozen.beatIndex, frozen.beatIndex);
  assert.equal(stillFrozen.beatProgress, frozen.beatProgress);
  assert.equal(stillFrozen.beatPulses, frozen.beatPulses);
  assert.equal(engine.capture().code, "paused");

  engine.setPaused(false);
  engine.update(600);
  const resumed = engine.getClockSnapshot();
  assert.equal(resumed.paused, false);
  assert.ok(resumed.beatIndex > frozen.beatIndex);
  assert.ok(resumed.beatPulses > frozen.beatPulses);
  assert.notDeepEqual(resumed.actor, frozen.actor);
});

test("a complete three-shot set reaches the next round", () => {
  const engine = new StudioEngine();

  for (const take of REFERENCE_TAKES) {
    applyTake(engine, take);
    const analysis = engine.analyze();
    assert.equal(analysis.subjectInFrame, true);
    assert.equal(analysis.windowOpen, true);
    assert.equal(analysis.exposureReady, true);
    assert.equal(analysis.ready, true, analysis.message);

    const result = engine.capture();
    assert.equal(result.ok, true, result.message);
  }

  assert.equal(engine.completedShots.length, 3);
  assert.equal(engine.roundComplete, true);
  assert.equal(engine.paused, true);

  const completedRound = engine.round;
  assert.equal(engine.nextRound(), completedRound + 1);
  assert.equal(engine.completedShots.length, 0);
  assert.equal(engine.roundComplete, false);
  assert.equal(engine.paused, false);
  assert.ok(engine.beatMs < 600);
});

test("out-of-frame and overexposed takes are rejected with explicit reasons", () => {
  const engine = new StudioEngine();
  engine.update(1700);
  const actor = engine.actor;
  LIGHT_FIXTURES.forEach((fixture, index) => {
    const angle =
      (Math.atan2(actor.y - fixture.y, actor.x - fixture.x) * 180) / Math.PI;
    engine.setLightAngle(index, angle);
  });
  assert.equal(engine.capture().code, "overexposed");

  engine.setCamera({ x: 205, y: 215, focal: 85 });
  engine.setLightAngle(0, 13.284866484902182);
  engine.setLightAngle(1, 270.48850144290964);
  const result = engine.capture();
  assert.equal(result.ok, false);
  assert.equal(result.code, "outOfFrame");
});
