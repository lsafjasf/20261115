import assert from "node:assert/strict";
import {
  DIRECTIONS,
  PRE_ROLL,
  TRANSITION_TYPES,
  sampleTimeline,
  timelineLength,
} from "../src/transitions.js";

assert.deepEqual(TRANSITION_TYPES, ["push", "wipe", "fog"]);
assert.equal(DIRECTIONS.length, 4);
assert.equal(timelineLength(2), PRE_ROLL + 2 + 2.2);

const start = sampleTimeline(PRE_ROLL, 2);
assert.equal(start.mode, "transition");
assert.equal(start.phase, 0);
assert.equal(start.aTime, 3.2);
assert.equal(start.bTime, 0);

const middle = sampleTimeline(PRE_ROLL + 1, 2);
assert.equal(middle.phase, 0.5);
assert.equal(middle.aTime, 4.2);
assert.equal(middle.bTime, 1);
assert.notEqual(middle.aTime, middle.bTime);

const end = sampleTimeline(PRE_ROLL + 2, 2);
assert.equal(end.phase, 1);
assert.equal(end.bTime, 2);

const after = sampleTimeline(PRE_ROLL + 2.75, 2);
assert.equal(after.mode, "b");
assert.equal(after.bTime, 2.75);
assert.notEqual(after.bTime, after.aTime);

const before = sampleTimeline(1.4, 2);
assert.equal(before.mode, "a");
assert.equal(before.bTime, 0);
assert.equal(before.phase, 0);

console.log("timeline: ok");
console.log(`midpoint: A=${middle.aTime.toFixed(2)}s B=${middle.bTime.toFixed(2)}s`);
