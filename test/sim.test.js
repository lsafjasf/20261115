const path = require('path');
const { test, assert, approx, finish } = require('./assert');
const Sim = require(path.join(__dirname, '..', 'src', 'sim.js'));
require(path.join(__dirname, '..', 'src', 'autopilot.js'));

const SEED = 'dune-2026';

test('fixed seed produces identical terrain and wind', () => {
  const a = Sim.createSim({ seed: SEED });
  const b = Sim.createSim({ seed: SEED });
  assert(a.terrain.seed === b.terrain.seed, 'terrain seed matches');
  assert(approx(a.wind.angle, b.wind.angle), 'wind angle deterministic');
  for (const p of [
    [120, 80],
    [640, 400],
    [1100, 720],
  ]) {
    assert(approx(a.terrain.heightAt(p[0], p[1]), b.terrain.heightAt(p[0], p[1]), 1e-12), 'height deterministic');
  }
  const c = Sim.createSim({ seed: 'other-seed' });
  assert(c.terrain.seed !== a.terrain.seed, 'different seed => different terrain');
});

test('three reachable contour zones are generated and separated', () => {
  const sim = Sim.createSim({ seed: SEED });
  assert(sim.zones.length === 3, 'three zones');
  for (const z of sim.zones) {
    assert(z.cells.length > 100, 'zone has raster cells');
    assert(z.length >= 140, 'zone long enough');
    for (const p of z.polyline) {
      assert(sim.terrain.slopeAt(p.x, p.y) <= 0.2, 'zone stays on gentle slope');
      assert(sim.terrain.inBounds(p.x, p.y, 40), 'zone inside world');
    }
  }
  const sets = sim.zones.map((z) => new Set(z.cells.map((c) => c.join(','))));
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      let overlap = 0;
      for (const key of sets[i]) if (sets[j].has(key)) overlap++;
      assert(overlap === 0, 'zones do not share cells');
    }
  }
});

test('steep slopes exist and trigger gravity slide', () => {
  const sim = Sim.createSim({ seed: SEED });
  const terrain = sim.terrain;
  let found = false;
  let steepPoint = null;
  let bestSlope = 0;
  for (let x = 30; x < terrain.world.width - 30; x += 12) {
    for (let y = 30; y < terrain.world.height - 30; y += 12) {
      const s = terrain.slopeAt(x, y);
      if (s >= terrain.world.steepStart && s > bestSlope) {
        found = true;
        steepPoint = { x, y };
        bestSlope = s;
      }
    }
  }
  assert(found, 'map contains steep terrain');
  assert(bestSlope >= terrain.world.steepStart + 0.04, 'a clearly steep cell exists');
  const v = sim.vehicle;
  v.x = steepPoint.x;
  v.y = steepPoint.y;
  v.speed = 0;
  v.slideVx = 0;
  v.slideVy = 0;
  sim.input.throttle = 0;
  sim.input.contourAssist = false;
  let moved = 0;
  for (let i = 0; i < 120; i++) {
    const bx = v.x;
    const by = v.y;
    sim.input.sowing = false;
    sim.step();
    moved += Math.hypot(v.x - bx, v.y - by);
  }
  assert(v.sliding === true, 'vehicle reports sliding state');
  assert(moved > 1, 'gravity pulls vehicle downhill on steep slope');
});

test('overlap sowing is counted as waste, not new cover', () => {
  const sim = Sim.createSim({ seed: SEED });
  const grid = sim.grid;
  const r1 = App.Coverage.markSegment(grid, 100, 100, 130, 100, 14);
  const r2 = App.Coverage.markSegment(grid, 100, 100, 130, 100, 14);
  assert(r1.fresh > 0, 'first pass covers fresh cells');
  assert(r2.fresh === 0, 'identical second pass has no fresh cells');
  assert(r2.wasted === r2.touched, 're-sowing is fully wasted overlap');
});

finish();
