/* Headless mission verification: same engine the browser uses. */
const path = require('path');
const fs = require('fs');
global.window = global;
require(path.join(__dirname, '..', 'js', 'rng.js'));
require(path.join(__dirname, '..', 'js', 'world.js'));
require(path.join(__dirname, '..', 'js', 'simulation.js'));
require(path.join(__dirname, '..', 'js', 'autopilot.js'));

const seed = Number(process.argv[2]) || IceRng.DEFAULT_SEED;
const world = IceWorld.generate(seed);
const sim = IceSim.create(world);

const result = IcePilot.runMission(world, sim, 1 / 60);

const outDir = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'mission-trace.json'),
  JSON.stringify({
    seed,
    camp: world.camp,
    points: world.points,
    ...result
  }, null, 2)
);

console.log('seed           :', seed);
console.log('points         :', world.points.map((p) => `(${p.x},${p.y})`).join(' '));
console.log('status         :', result.status);
console.log('failReason     :', result.failReason || '-');
console.log('elapsed (s)    :', result.time);
console.log('thrust impulses:', result.thrusts);
console.log('measurements   :', result.measurements.length);
for (const m of result.measurements) {
  console.log(`  point ${m.point} at t=${m.t.toFixed(2)}s (${m.x.toFixed(0)},${m.y.toFixed(0)})`);
}
if (result.status !== 'won') process.exit(1);
