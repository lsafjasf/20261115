import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLLISION_WAYPOINTS,
  SAFE_WAYPOINTS,
  computeShotPlan,
  getHorizontalFov,
  samplePath,
} from '../src/planner.js';

test('safe shot clears both actors and both pillars', () => {
  const plan = computeShotPlan(SAFE_WAYPOINTS, { safety: 0.8, focal: 28, heading: 8 });

  assert.equal(plan.valid, true);
  assert.equal(plan.intervals.length, 0);
  assert.equal(plan.conflictObjects.length, 0);
  assert.ok(plan.minimumClearance >= 0.8, 'minimum clearance must honor the safety threshold');
  assert.ok(plan.path.length > 10, 'path should cover the full stage');
});

test('forced pillar path is rejected and names pillar B as the conflict', () => {
  const plan = computeShotPlan(COLLISION_WAYPOINTS, { safety: 0.8, focal: 28, heading: 8 });

  assert.equal(plan.valid, false);
  assert.ok(plan.intervals.length >= 1);
  assert.ok(plan.conflictObjects.some((object) => object.id === 'pillar-2'));

  const pillarConflict = plan.conflictObjects.find((object) => object.id === 'pillar-2');
  assert.ok(pillarConflict.minClearance < 0.8);
  const interval = plan.intervals.find((item) => item.obstacleId === 'pillar-2');
  assert.ok(interval.startTime >= 0 && interval.endTime <= 10);
  assert.ok(interval.endTime > interval.startTime);
});

test('raising the safety distance invalidates an otherwise clear shot', () => {
  const conservative = computeShotPlan(SAFE_WAYPOINTS, { safety: 1.2 });

  assert.equal(conservative.valid, false);
  assert.ok(conservative.conflictObjects.length >= 1);
  assert.ok(conservative.minimumClearance < 1.2);
});

test('focal length maps to a realistic horizontal field of view', () => {
  assert.ok(Math.abs(getHorizontalFov(28) - 65.47) < 0.05);
  assert.ok(getHorizontalFov(18) > getHorizontalFov(85));
});

test('arc-length sampling returns the configured waypoint endpoints', () => {
  const plan = computeShotPlan(SAFE_WAYPOINTS);
  const start = samplePath(plan.path, 0);
  const end = samplePath(plan.path, 1);

  assert.ok(Math.abs(start.x - SAFE_WAYPOINTS[0][0]) < 1e-9);
  assert.ok(Math.abs(start.y - SAFE_WAYPOINTS[0][1]) < 1e-9);
  assert.ok(Math.abs(end.x - SAFE_WAYPOINTS.at(-1)[0]) < 1e-9);
  assert.ok(Math.abs(end.y - SAFE_WAYPOINTS.at(-1)[1]) < 1e-9);
});
