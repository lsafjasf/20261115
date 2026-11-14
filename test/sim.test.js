import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG, SaltRun, TRACK, createRun } from "../src/sim.js";

function driveRoute(run, policyForSection, step = 0.05) {
  let guard = 0;
  while (run.status === "running" && guard < 200000) {
    const section = run.getSectionAtPx(run.progressPx);
    run.step(step, policyForSection(section.index));
    guard += 1;
  }
  assert.notEqual(run.status, "running", "route should finish within the guard limit");
  return run.getStats();
}

test("a tuned run clears all three slopes with enough material left", () => {
  const run = createRun();
  run.start();
  const policies = [
    { width: 7, speed: 20, outlet: 0.6 },
    { width: 9, speed: 18, outlet: 0.68 },
    { width: 9.2, speed: 18, outlet: 0.68 },
  ];

  const stats = driveRoute(run, (section) => policies[section]);

  assert.equal(stats.complete, true);
  assert.equal(stats.success, true);
  assert.equal(stats.allPass, true);
  assert.ok(stats.remaining >= CONFIG.minRemaining);
  assert.ok(stats.sections.every((section) => section.coverage >= CONFIG.coveragePass));
  assert.ok(
    stats.sections.every(
      (section) => section.coverage >= CONFIG.coveragePass && section.curveLeak < 0.3,
    ),
  );
});

test("fast, narrow spreading misses the edge through the hairpin", () => {
  const run = new SaltRun();
  run.start();
  const starter = {
    width: CONFIG.width.default,
    speed: CONFIG.speed.default,
    outlet: CONFIG.outlet.default,
  };

  const stats = driveRoute(run, () => starter);
  const straight = stats.sections[0];
  const hairpin = TRACK.sections.find((section) => section.name === "鹰嘴回头弯");
  const hairpinStats = stats.sections[hairpin.index];

  assert.equal(starter.width, 6.5);
  assert.equal(starter.speed, 22);
  assert.equal(stats.success, false);
  assert.equal(straight.pass, true);
  assert.equal(hairpinStats.pass, false);
  assert.ok(
    hairpinStats.coverage < CONFIG.coveragePass,
    `hairpin coverage ${hairpinStats.coverage} should be below the pass line`,
  );
  assert.ok(
    hairpinStats.curveLeak > 0.35,
    `curved outer cells should show a leak, got ${hairpinStats.curveLeak}`,
  );
  assert.ok(
    hairpinStats.curveLeak > straight.curveLeak,
    "the hairpin should leak more than the gentle first slope",
  );
});

test("using too much salt leaves the hopper below the handoff reserve", () => {
  const run = createRun();
  run.start();
  const stats = driveRoute(run, () => ({ width: 9.8, speed: 9, outlet: 0.95 }));

  assert.equal(stats.complete, true);
  assert.equal(stats.enoughMaterial, false);
  assert.equal(stats.success, false);
});
