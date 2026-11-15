import {
  cloneState,
  normalizeInput,
  snapshotState,
  stepSimulation
} from "./physics.js";

function round(value, digits = 9) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function angleError(a, b) {
  let delta = (a - b) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

function compareSnapshots(actual, expected) {
  let maxError = 0;
  let mismatches = 0;
  const check = (a, b, angular = false) => {
    const error = angular ? angleError(a, b) : Math.abs(a - b);
    maxError = Math.max(maxError, error);
    if (error > 1e-9) mismatches += 1;
  };

  for (let index = 0; index < 2; index += 1) {
    const actualCar = actual.cars[index];
    const expectedCar = expected.cars[index];
    check(actualCar.x, expectedCar.x);
    check(actualCar.y, expectedCar.y);
    check(actualCar.angle, expectedCar.angle, true);
    check(actualCar.vx, expectedCar.vx);
    check(actualCar.vy, expectedCar.vy);
    check(actualCar.damage, expectedCar.damage);
  }
  check(actual.cable.length, expected.cable.length);
  check(actual.cable.tension, expected.cable.tension);
  check(actual.cable.target, expected.cable.target);

  const flagsMatch =
    actual.status === expected.status &&
    actual.gatePasses === expected.gatePasses &&
    actual.finishCount === expected.finishCount &&
    actual.cars.every(
      (car, index) =>
        car.finished === expected.cars[index].finished &&
        car.gates.every((gate, gateIndex) => gate === expected.cars[index].gates[gateIndex])
    );
  if (!flagsMatch) mismatches += 1;
  return { maxError, mismatches };
}

function digestValue(hash, value) {
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function snapshotDigest(snapshot) {
  let hash = 2166136261;
  hash = digestValue(hash, snapshot.status);
  hash = digestValue(hash, snapshot.gatePasses);
  hash = digestValue(hash, snapshot.finishCount);
  for (const car of snapshot.cars) {
    hash = digestValue(hash, round(car.x));
    hash = digestValue(hash, round(car.y));
    hash = digestValue(hash, round(car.angle));
    hash = digestValue(hash, round(car.vx));
    hash = digestValue(hash, round(car.vy));
    hash = digestValue(hash, round(car.damage));
    hash = digestValue(hash, car.finished ? 1 : 0);
    hash = digestValue(hash, car.gates.map(Number).join(""));
  }
  hash = digestValue(hash, round(snapshot.cable.length));
  hash = digestValue(hash, round(snapshot.cable.tension));
  hash = digestValue(hash, round(snapshot.cable.target));
  return hash.toString(16).padStart(8, "0").toUpperCase();
}

export class RunRecorder {
  constructor(initialState) {
    this.initialState = cloneState(initialState);
    this.frames = [];
  }

  get stepCount() {
    return this.frames.length;
  }

  record(input, state) {
    const frame = {
      step: state.step,
      input: normalizeInput(input),
      snapshot: snapshotState(state)
    };
    this.frames.push(frame);
    return frame;
  }

  latestSnapshot() {
    return this.frames.at(-1)?.snapshot || snapshotState(this.initialState);
  }

  digest() {
    if (!this.frames.length) return snapshotDigest(snapshotState(this.initialState));
    return snapshotDigest(this.frames.at(-1).snapshot);
  }
}

export function verifyReplay(initialState, frames) {
  if (!frames.length) {
    return {
      ok: true,
      steps: 0,
      maxError: 0,
      mismatches: 0,
      recordedDigest: snapshotDigest(snapshotState(initialState)),
      replayDigest: snapshotDigest(snapshotState(initialState))
    };
  }

  const replay = cloneState(initialState);
  let maxError = 0;
  let mismatches = 0;
  let replayHash = 2166136261;

  for (const frame of frames) {
    stepSimulation(replay, frame.input);
    const actual = snapshotState(replay);
    const result = compareSnapshots(actual, frame.snapshot);
    maxError = Math.max(maxError, result.maxError);
    mismatches += result.mismatches;
    if (actual.step !== frame.step) mismatches += 1;
    replayHash = digestValue(replayHash, snapshotDigest(actual));
  }

  let recordedHash = 2166136261;
  for (const frame of frames) {
    recordedHash = digestValue(recordedHash, snapshotDigest(frame.snapshot));
  }

  return {
    ok: mismatches === 0,
    steps: frames.length,
    maxError,
    mismatches,
    recordedDigest: (recordedHash >>> 0).toString(16).padStart(8, "0").toUpperCase(),
    replayDigest: (replayHash >>> 0).toString(16).padStart(8, "0").toUpperCase()
  };
}

export function inputsFromFrames(frames) {
  const last = { throttle: 0, steer: 0, anchor: false, payout: 0 };
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const input = frames[index].input;
    last.throttle = input.throttle;
    last.steer = input.steer;
    last.anchor = input.anchor;
    last.payout = input.payout;
    if (input.throttle || input.steer || input.anchor || input.payout) return last;
  }
  return last;
}
