import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CUTS, FPS, TOTAL_FRAMES, PEAK_TOLERANCE_FRAMES,
  validateCuts, nearestPeakFrame, frameDistanceToPeak, shotWeights,
  shotAtFrame, isPeakFrame, ballState, timeToFrame,
} from '../src/editor-core.mjs';

test('default cut points sit exactly on action peaks', () => {
  const checks = validateCuts(DEFAULT_CUTS);
  assert.equal(checks.length, 3);
  for (const check of checks) {
    assert.equal(check.distance, 0);
    assert.equal(check.status, 'ok');
    assert.ok(isPeakFrame(check.frame));
  }
  assert.deepEqual(checks.map((c) => c.frame), [90, 180, 270]);
});

test('misalignment beyond two frames triggers a warning', () => {
  const cuts = DEFAULT_CUTS.map((cut) => ({ ...cut }));
  cuts[1].frame += PEAK_TOLERANCE_FRAMES; // exactly 2 frames off -> still ok
  cuts[2].frame += PEAK_TOLERANCE_FRAMES + 1; // 3 frames off -> warn
  const checks = validateCuts(cuts);
  assert.equal(checks[1].status, 'ok');
  assert.equal(checks[2].status, 'warn');
  assert.match(checks[2].message, /偏离峰值 3 帧/);
});

test('nearest peak snapping recovers a displaced cut', () => {
  assert.equal(nearestPeakFrame(92), 90);
  assert.equal(nearestPeakFrame(93), 90);
  assert.equal(nearestPeakFrame(181), 180);
  assert.equal(frameDistanceToPeak(272), 2);
});

test('output timeline walks wide -> medium -> close -> wide', () => {
  const shots = [0, 50, 89, 90, 179, 180, 269, 270, 359]
    .map((frame) => shotAtFrame(frame, DEFAULT_CUTS));
  assert.deepEqual(shots, [0, 0, 0, 1, 1, 2, 2, 0, 0]);
});

test('hard cut weights always select exactly one shot', () => {
  const cuts = DEFAULT_CUTS.map((cut) => ({ ...cut, mode: 'hard' }));
  for (let frame = 0; frame < TOTAL_FRAMES; frame += 1) {
    const weights = shotWeights(frame / FPS, cuts);
    const sum = weights.reduce((acc, value) => acc + value, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weight sum at frame ${frame}: ${sum}`);
    assert.equal(weights.filter((w) => w === 1).length, 1);
  }
});

test('crossfade blends two shots with weights summing to one', () => {
  const cuts = DEFAULT_CUTS.map((cut) => ({ ...cut }));
  cuts[1].mode = 'crossfade';
  const inside = shotWeights(180 / FPS, cuts); // center of the fade
  assert.equal(inside[1], 0.5);
  assert.equal(inside[2], 0.5);
  assert.equal(inside[0], 0);
  for (let frame = 177; frame <= 183; frame += 1) {
    const weights = shotWeights(frame / FPS, cuts);
    const sum = weights.reduce((acc, value) => acc + value, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  }
  // Outside the window the hard-cut behavior is unchanged.
  const before = shotWeights(170 / FPS, cuts);
  assert.deepEqual(before, [0, 1, 0]);
});

test('ball impact (action peak) happens at each cut frame', () => {
  for (const cut of DEFAULT_CUTS) {
    const state = ballState(cut.frame / FPS + 1e-6);
    assert.ok(state.height < 1, `ball should be at floor, got ${state.height}`);
    assert.ok(state.squash > 0.5, 'impact squash should be visible');
  }
  const apex = ballState(0.75);
  assert.ok(apex.height > 200);
});

test('time/frame conversion is consistent at 30 fps', () => {
  assert.equal(timeToFrame(3), 90);
  assert.equal(90 / FPS, 3);
});

test('cut points stay ordered under the same neighbor constraints as dragging', () => {
  const cuts = DEFAULT_CUTS.map((cut) => ({ ...cut }));
  const constrain = (index, raw) => {
    const lower = index === 0 ? 1 : cuts[index - 1].frame + 1;
    const upper = index === cuts.length - 1
      ? TOTAL_FRAMES - 1
      : cuts[index + 1].frame - 1;
    return Math.max(lower, Math.min(upper, raw));
  };
  cuts[0].frame = constrain(0, 300); // cannot cross cut 2 at frame 180
  assert.equal(cuts[0].frame, 179);
  cuts[2].frame = constrain(2, 30); // cannot cross cut 3 at frame 270
  assert.equal(cuts[2].frame, 181);
  cuts[1].frame = constrain(1, 359);
  assert.equal(cuts[1].frame, 180);
  assert.ok(cuts[0].frame < cuts[1].frame && cuts[1].frame < cuts[2].frame);
});
