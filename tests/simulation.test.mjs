import assert from "node:assert/strict";
import test from "node:test";
import { TUNING, GlassSimulation } from "../src/simulation.js";

function runUntil(sim, predicate, maxSeconds = 45) {
  const dt = 0.02;
  for (let elapsed = 0; elapsed < maxSeconds; elapsed += dt) {
    if (predicate(sim)) return elapsed;
    sim.update(dt, {
      blow: sim.pressure < 0.52,
      spin: sim.rpm < 38,
      brake: sim.rpm > 45,
    });
    if (sim.phase === "failed") return elapsed;
  }
  return maxSeconds;
}

function shapeBottle(sim) {
  for (let index = 0; index < 60 * 40; index += 1) {
    if (sim.temperature < 760) sim.setHeaterPosition(TUNING.heaterCenter);
    else if (sim.temperature > 970) sim.setHeaterPosition(0.18);

    sim.update(0.02, {
      blow: sim.pressure < 0.52,
      spin: sim.rpm < 38,
      brake: sim.rpm > 45,
    });
    if (sim.phase === "failed" || sim.fill > 0.992) break;
  }
}

test("a stable breath and rotation complete the target bottle", () => {
  const sim = new GlassSimulation();
  sim.start();
  shapeBottle(sim);

  const stats = sim.getStats();
  assert.equal(sim.phase, "playing");
  assert.ok(stats.contour >= TUNING.contourTarget, `contour ${stats.contour}`);
  assert.ok(stats.wallDelta <= TUNING.wallTolerance, `wall delta ${stats.wallDelta}`);
  assert.equal(stats.bubbles, 0);
  assert.ok(stats.temperature >= 540);

  const result = sim.tryFinish();
  assert.equal(result.ok, true);
  assert.equal(sim.phase, "success");
  assert.ok(sim.finalStats.contour >= TUNING.contourTarget);
  assert.ok(sim.finalStats.wallDelta <= TUNING.wallTolerance);
});

test("staying away from the glory hole overcools the glass", () => {
  const sim = new GlassSimulation();
  sim.start();
  const failedAt = runUntil(sim, (state) => state.phase === "failed");

  assert.equal(sim.phase, "failed");
  assert.ok(failedAt > 18 && failedAt < 22, `failed at ${failedAt}s`);
  assert.ok(sim.temperature < TUNING.plasticFloor);
  assert.ok(sim.coldTime >= 1.25);
  assert.equal(sim.tryFinish().ok, false);
});

test("overpressure forms internal bubbles and blocks annealing", () => {
  const sim = new GlassSimulation();
  sim.start();
  sim.setHeaterPosition(TUNING.heaterCenter);

  for (let index = 0; index < 100; index += 1) {
    sim.update(0.02, { blow: true, spin: sim.rpm < 38 });
  }
  for (let index = 0; index < 220; index += 1) {
    sim.update(0.02, { blow: sim.pressure < 0.52, spin: sim.rpm < 38 });
  }

  assert.ok(sim.bubbles.length > 0, "expected at least one internal bubble");
  assert.equal(sim.getChecks().clean, false);
  assert.equal(sim.tryFinish().ok, false);
});
