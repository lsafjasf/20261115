import assert from "node:assert/strict";
import {
  CHECKPOINTS,
  WORLD,
  createFlight,
  runSimulation,
  setPitchCommand,
  settingsFrom,
  stepFlight,
  windAt,
} from "../js/sim.js";

const base = settingsFrom({ cg: -2, pitch: -17.5 });
const record = runSimulation({ ...base, span: 3.4 }, { auto: true });

assert.equal(record.status, "success", record.reason);
assert.equal(record.checkpointMarks.length, CHECKPOINTS.length);
assert.ok(record.checkpointMarks.every((mark) => mark.passed));
assert.ok(record.touchdown.inRunway);
assert.ok(record.groundSpeed <= 30);

const approach = { ...base, span: 3 };
const wide = { ...base, span: 3.8 };
const flightA = runSimulation(approach, { auto: true });
const flightB = runSimulation(wide, { auto: true });
const initialA = createFlight(approach);
const initialB = createFlight(wide);

assert.equal(flightA.status, "success", flightA.reason);
assert.equal(flightB.status, "success", flightB.reason);
assert.equal(flightA.x === flightB.x, false);
assert.equal(flightA.settings.cg, flightB.settings.cg);
assert.equal(flightA.settings.pitch, flightB.settings.pitch);
assert.notEqual(flightA.settings.span, flightB.settings.span);
assert.equal(initialA.x, initialB.x);
assert.equal(initialA.y, initialB.y);
assert.equal(initialA.speed, initialB.speed);
assert.equal(initialA.pitch, initialB.pitch);
assert.notEqual(flightA.time, flightB.time);
assert.notEqual(flightA.groundSpeed, flightB.groundSpeed);

const noFlare = createFlight({ ...base, span: 3.4 });
noFlare.status = "flying";
while (noFlare.status === "flying" && noFlare.time < 70) {
  setPitchCommand(noFlare, -17.5);
  stepFlight(noFlare, 1 / 90);
}
assert.equal(noFlare.status, "failed");
assert.match(noFlare.reason, /触地速度/);

const missedGate = createFlight({ ...base, span: 3.4, pitch: -11 });
missedGate.status = "flying";
while (missedGate.status === "flying" && missedGate.time < 30) {
  setPitchCommand(missedGate, -11);
  stepFlight(missedGate, 1 / 90);
}
assert.equal(missedGate.status, "failed");
assert.match(missedGate.reason, /偏离切变入口检查点/);

const stalled = createFlight({ ...base, span: 3.4, pitch: 8 });
stalled.status = "flying";
while (stalled.status === "flying" && stalled.time < 20) {
  setPitchCommand(stalled, 8);
  stepFlight(stalled, 1 / 90);
}
assert.equal(stalled.status, "failed");
assert.match(stalled.reason, /失速/);

assert.ok(windAt(400, 0).x > 0);
assert.ok(windAt(240, 0).x < 0);
assert.ok(windAt(90, 0).x > 0);

console.log("PASS  demonstration route");
console.log(`      ${record.time.toFixed(1)} s · x ${record.x.toFixed(0)} m · ${record.groundSpeed.toFixed(1)} m/s`);
console.log("PASS  same-initial wingspan comparison");
console.log(
  `      A ${flightA.settings.span.toFixed(2)} m · ${flightA.time.toFixed(1)} s · ${flightA.groundSpeed.toFixed(1)} m/s`,
);
console.log(
  `      B ${flightB.settings.span.toFixed(2)} m · ${flightB.time.toFixed(1)} s · ${flightB.groundSpeed.toFixed(1)} m/s`,
);
console.log("PASS  high-speed touchdown rejection");
console.log(`      ${noFlare.reason} at x ${noFlare.x.toFixed(0)} m`);
console.log("PASS  checkpoint and stall rejection");
console.log(`      ${missedGate.reason} · ${stalled.reason}`);
console.log("PASS  three-layer wind directions");
console.log(`      course ${WORLD.width} m · checkpoints ${CHECKPOINTS.map((item) => item.name).join(" / ")}`);
