import assert from "node:assert/strict";
import {
  FIXED_STEP,
  REQUIRED_RESIDENTIAL_RATIO,
  SEEDS,
  createSimulation,
  fingerprint,
  getMapView,
  getMetrics,
  getSectionView,
  moveSandbag,
  stepSimulation,
  toggleGate,
} from "./simulation.js";

function advance(sim, seconds) {
  const steps = Math.round(seconds / FIXED_STEP);
  for (let i = 0; i < steps; i += 1) stepSimulation(sim, FIXED_STEP);
}

function playToEnd(sim) {
  while (!sim.ended) stepSimulation(sim, FIXED_STEP);
  return getMetrics(sim);
}

function applyWinningActions(sim) {
  for (const gateId of ["g2", "g3"]) {
    const gate = sim.gates.find((item) => item.id === gateId);
    if (!gate.open) toggleGate(sim, gateId);
  }
  const move = moveSandbag(sim, "b1", 8, 0);
  assert.equal(move.ok, true, "planned sandbag move must be legal");
}

const report = [];
const finalDigests = new Set();

for (const seed of SEEDS) {
  const baseline = createSimulation(seed.id);
  const baselineMetrics = playToEnd(baseline);
  assert.equal(
    baselineMetrics.success,
    false,
    `seed ${seed.id} should require intervention when no gates or bags are moved`,
  );
  assert.ok(
    baselineMetrics.safeRatio < REQUIRED_RESIDENTIAL_RATIO,
    `seed ${seed.id} baseline should miss the residential target`,
  );

  const first = createSimulation(seed.id);
  const second = createSimulation(seed.id);
  applyWinningActions(first);
  applyWinningActions(second);
  advance(first, 12);
  advance(second, 12);
  assert.equal(fingerprint(first), fingerprint(second), `seed ${seed.id} must be deterministic`);

  const mapView = getMapView(first);
  const sectionView = getSectionView(first);
  assert.equal(
    mapView.sharedDigest,
    sectionView.sharedDigest,
    `seed ${seed.id} map and section must read the same state`,
  );
  assert.deepEqual(mapView.metrics, sectionView.metrics, "both views must expose identical metrics");

  const firstResult = playToEnd(first);
  const secondResult = playToEnd(second);
  assert.equal(fingerprint(first), fingerprint(second), "same seed and actions must reach one final state");
  assert.equal(firstResult.success, true, `seed ${seed.id} must be winnable with the intended controls`);
  assert.ok(firstResult.safeRatio >= REQUIRED_RESIDENTIAL_RATIO);
  assert.equal(firstResult.criticalSafe, true);
  assert.equal(secondResult.success, true);
  finalDigests.add(fingerprint(first));

  report.push({
    seed: seed.id,
    name: seed.name,
    baselineSafe: baselineMetrics.safeCount,
    baselineSuccess: baselineMetrics.success,
    resolvedSafe: firstResult.safeCount,
    hospital: firstResult.hospital.level,
    substation: firstResult.substation.level,
    digest: fingerprint(first),
    viewsMatch: true,
    reproducible: true,
  });
}

assert.equal(finalDigests.size, SEEDS.length, "different fixed seeds must produce different final states");

const interaction = createSimulation(SEEDS[1].id);
advance(interaction, 8);
const before = fingerprint(interaction);
toggleGate(interaction, "g2");
assert.notEqual(fingerprint(interaction), before, "a gate action must update shared state immediately");
assert.equal(getMapView(interaction).sharedDigest, getSectionView(interaction).sharedDigest);
const moved = moveSandbag(interaction, "b2", 9, 0);
assert.equal(moved.ok, true);
assert.equal(getMapView(interaction).sharedDigest, getSectionView(interaction).sharedDigest);

console.table(report);
console.log(`PASS: ${SEEDS.length} fixed seeds, linked views, and deterministic replay verified.`);
