const path = require('path');
const { test, assert, finish } = require('./assert');
const Sim = require(path.join(__dirname, '..', 'src', 'sim.js'));
require(path.join(__dirname, '..', 'src', 'autopilot.js'));

const SEED = 'dune-2026';
const WIN_THRESHOLD = 0.8;

test('full coverage run: wind-compensated sowing reaches all three zones', () => {
  const sim = Sim.createSim({ seed: SEED, windCompensation: true });
  const result = App.Autopilot.runAutopilot(sim, { compensate: true, maxSteps: 30000 });
  const snap = result.final;
  assert(snap.won === true, 'mission succeeds with compensation');
  assert(snap.zoneRatios.length === 3, 'reports three zones');
  snap.zoneRatios.forEach((ratio, i) => {
    assert(ratio >= WIN_THRESHOLD, 'zone ' + i + ' coverage ' + ratio.toFixed(3) + ' >= 0.8');
  });
  assert(snap.seedUsed < snap.stock, 'completes before seed runs out');
  console.log('    coverage =', snap.zoneRatios.map((r) => r.toFixed(3)).join(', '),
    '| seed', Math.round(snap.seedUsed) + '/' + snap.stock);
});

test('wind drift miss: uncompensated crosswind leaves a zone below threshold', () => {
  const sim = Sim.createSim({ seed: SEED, windCompensation: false });
  const result = App.Autopilot.runAutopilot(sim, { compensate: false, maxSteps: 30000 });
  const snap = result.final;
  const failedZones = snap.zoneRatios
    .map((ratio, i) => ({ ratio, i }))
    .filter((z) => z.ratio < WIN_THRESHOLD);
  assert(failedZones.length >= 1, 'at least one zone misses the 0.8 target without compensation');
  assert(snap.won === false, 'mission cannot be completed without wind compensation');
  const labels = failedZones.map((z) => 'zone' + z.i + '=' + z.ratio.toFixed(3)).join(' ');
  console.log('    missed zones:', labels,
    '| lateral drift', (sim.wind.baseSpeed * sim.wind.driftPerMeter).toFixed(2) + 'm');
});

test('compensation strictly improves coverage over the uncompensated run', () => {
  const compensated = Sim.createSim({ seed: SEED, windCompensation: true });
  App.Autopilot.runAutopilot(compensated, { compensate: true, maxSteps: 30000 });
  const drifted = Sim.createSim({ seed: SEED, windCompensation: false });
  App.Autopilot.runAutopilot(drifted, { compensate: false, maxSteps: 30000 });
  let improved = 0;
  for (let i = 0; i < 3; i++) {
    if (compensated.zones[i].ratio > drifted.zones[i].ratio) improved++;
  }
  assert(improved >= 2, 'compensation improves coverage on most zones');
});

test('seed exhaustion fails the mission when stock is overspent', () => {
  const sim = Sim.createSim({ seed: SEED, windCompensation: true });
  sim.stock = sim.stock * 0.25;
  const result = App.Autopilot.runAutopilot(sim, { compensate: true, maxSteps: 30000 });
  assert(result.final.failReason === 'seed-exhausted', 'reports seed exhaustion');
  assert(result.final.won === false, 'exhaustion prevents victory');
});

finish();
