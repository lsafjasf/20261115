import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANCHOR_DEFS,
  DEFAULT_TENSION,
  QuarrySimulation,
  SIMULATION_SECONDS
} from '../src/simulation.js';

const raisedAnchors = [
  { x: 516, y: 112 },
  { x: 858, y: 142 },
  { x: 932, y: 410 },
  { x: 636, y: 340 }
];

function simulate(options, mode = 'normal') {
  const simulation = new QuarrySimulation(options);
  simulation.start(mode);
  simulation.advance(SIMULATION_SECONDS);
  return simulation;
}

test('recommended layout contains the normal ten-second blast', () => {
  const simulation = simulate({ tension: DEFAULT_TENSION });
  const result = simulation.getSnapshot();

  assert.equal(result.state, 'complete');
  assert.equal(result.elapsed, SIMULATION_SECONDS);
  assert.equal(result.rockCount, 17);
  assert.equal(result.breachCount, 0);
  assert.equal(result.result.success, true);
  assert.ok(result.caught >= 1);
  assert.ok(result.pocketLoad < 1);
});

test('a slack net fails from pocket overload', () => {
  const simulation = simulate({ tension: 8 });
  const result = simulation.getSnapshot();

  assert.equal(result.result.success, false);
  assert.ok(result.pocketLoad >= 1);
  assert.match(result.result.reasons.join(' '), /堆载/);
});

test('an over-tensioned net tears from an anchor', () => {
  const simulation = simulate({ tension: 88 });
  const result = simulation.getSnapshot();

  assert.equal(result.result.success, false);
  assert.notEqual(result.tearIndex, null);
  assert.match(result.result.reasons.join(' '), /撕裂/);
});

test('the abnormal edge rock breaches the default upper coverage', () => {
  const simulation = simulate({ tension: DEFAULT_TENSION }, 'abnormal');
  const result = simulation.getSnapshot();

  assert.equal(result.rockCount, 1);
  assert.equal(result.result.success, false);
  assert.equal(result.breachCount, 1);
  assert.match(result.result.reasons.join(' '), /越过围栏/);
});

test('raising both upper anchors contains the abnormal edge rock', () => {
  const simulation = simulate({ anchors: raisedAnchors, tension: 48 }, 'abnormal');
  const result = simulation.getSnapshot();
  const [anomaly] = simulation.rocks;

  assert.equal(result.rockCount, 1);
  assert.equal(anomaly.kind, 'anomaly');
  assert.equal(anomaly.netContacts > 0, true);
  assert.equal(anomaly.buffered, true);
  assert.equal(result.breachCount, 0);
  assert.equal(result.result.success, true);
  assert.ok(result.peakAnchorLoad < 1);
  assert.ok(result.peakAnchorLoad > 0.5);
});

test('anchor controls stay within surveyed limits', () => {
  const simulation = new QuarrySimulation();
  const [first] = ANCHOR_DEFS;
  simulation.updateAnchor(0, -999, 999);
  const anchor = simulation.anchors[0];

  assert.equal(anchor.x, first.bounds.minX);
  assert.equal(anchor.y, first.bounds.maxY);
  assert.equal(simulation.setTension(130), true);
  assert.equal(simulation.tension, 100);
});
