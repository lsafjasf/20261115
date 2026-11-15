import test from "node:test";
import assert from "node:assert/strict";
import {
  createSampleProject,
  easedProgress,
  frameGeometry,
  getBoundsViolation,
  normalizeProject,
  sampleValues,
  verifyRestoration,
} from "../js/engine.js";

test("eight-second sample contains six four-axis keyframes", () => {
  const project = createSampleProject();
  assert.equal(project.duration, 8);
  assert.equal(project.keyframes.length, 6);
  project.keyframes.forEach((key) => {
    assert.deepEqual(Object.keys(key.values).sort(), ["focus", "position", "rotation", "scale"]);
    assert.deepEqual(Object.keys(key.easing).sort(), ["focus", "position", "rotation", "scale"]);
  });
  assert.equal(getBoundsViolation(project), null);
});

test("JSON normalization restores all four axes without error", () => {
  const project = createSampleProject();
  const reloaded = normalizeProject(JSON.parse(JSON.stringify(project)));
  const results = verifyRestoration(project, reloaded);
  assert.equal(results.length, 4);
  assert.ok(results.every((result) => result.ok));
  assert.ok(results.every((result) => result.maxDelta === 0));
});

test("viewfinder outside the stage is rejected across the interpolated path", () => {
  const project = createSampleProject();
  project.keyframes[1].values.position.x = 1080;
  const violation = getBoundsViolation(project);
  assert.ok(violation);
  assert.equal(violation.side, "右");
  assert.ok(violation.overshoot > 0);
});

test("camera frame reflects position scale rotation and focus", () => {
  const project = createSampleProject();
  const base = frameGeometry(project, sampleValues(project, 0));
  const changed = frameGeometry(project, {
    position: { x: 500, y: 260 },
    scale: 1.4,
    rotation: 8,
    focus: { x: 40, y: -20 },
  });
  assert.notDeepEqual(base.center, changed.center);
  assert.notEqual(base.width, changed.width);
  assert.notEqual(base.rotation, changed.rotation);
  assert.notDeepEqual(base.focus, changed.focus);
});

test("bezier easing remains pinned at both endpoints", () => {
  assert.ok(Math.abs(easedProgress(0, [0.3, 0, 0.2, 1])) < 0.0001);
  assert.ok(Math.abs(easedProgress(1, [0.3, 0, 0.2, 1]) - 1) < 0.0001);
});
