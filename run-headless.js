// Headless 12-minute run for both strategies. Writes results/results.json.
const fs = require('fs');
const path = require('path');
const S = require('./strategies.js');

const report = { generatedAt: new Date().toISOString(), runs: {} };
for (const name of ['conservative', 'aggressive']) {
  const sim = S.run(S[name]);
  report.runs[name] = {
    results: sim.results(),
    ships: sim.state.ships.map((sh) => ({
      id: sh.id,
      release: sh.release,
      deadline: sh.deadline,
      startedAt: sh.startedAt,
      finishedAt: sh.finishedAt,
      delay: sh.delay
    })),
    events: sim.state.events
  };
}

const outDir = path.join(__dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(report, null, 2));

for (const [name, run] of Object.entries(report.runs)) {
  const r = run.results;
  console.log(
    name.padEnd(13),
    'gen=' + r.generatedKWh.toFixed(3) + ' kWh',
    'storage=' + r.finalStoragePct.toFixed(1) + '%',
    'delay=' + r.delayS.toFixed(0) + 's',
    'wear=' + r.wearPct.toFixed(1) + '%',
    'ships=' + r.completed + '/3',
    'verdict=' + (r.passed ? 'PASS' : 'FAIL')
  );
}
console.log('\nWrote results/results.json');
