// End-to-end demonstration in Node:
// 1. play one full game with the auto-player and record every tick,
// 2. replay the log from the initial state and verify the score summary,
// 3. tamper with one recorded input and confirm the first divergence is found.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRecorder, replayAndVerify } from '../src/recorder.js';
import { decideInput } from '../src/bot.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED = 20261115;

function hr(title) {
  console.log(`\n=== ${title} ===`);
}

// --- 1. Play one full game ------------------------------------------------
hr('1. Playing one full recorded game');
const recorder = createRecorder(SEED);
let last;
while (!recorder.finished) {
  const input = decideInput(recorder.state);
  last = recorder.recordTick(input);
}
const log = recorder.finish();
console.log(`ticks recorded : ${log.entries.length}`);
console.log(`final score    : ${log.summary.finalScore}`);
console.log(`hits / misses  : ${log.summary.hits} / ${log.summary.misses}`);
console.log(`last hash      : 0x${log.summary.lastHash.toString(16)}`);
writeFileSync(join(here, 'game-log.json'), JSON.stringify(log, null, 2));

// --- 2. Replay and verify -------------------------------------------------
hr('2. Replaying inputs on a fresh initial state');
const report = replayAndVerify(log);
console.log(`hash chain intact : ${report.hashChain.intact}`);
console.log(`summary matches   : ${report.summaryMatches}`);
console.log(`first divergence  : ${report.firstDivergence ? `tick ${report.firstDivergence.tick}` : 'none'}`);
console.log(`faithful log      : ${report.faithful}`);
writeFileSync(join(here, 'replay-report.json'), JSON.stringify(report, null, 2));

// --- 3. Tamper with one record -------------------------------------------
hr('3. Tampering with one recorded input');
const tampered = structuredClone(log);
const targetIndex = Math.floor(tampered.entries.length / 3);
const targetTick = tampered.entries[targetIndex].tick;
tampered.entries[targetIndex].input.clicked = true;
tampered.entries[targetIndex].input.x = 40;
tampered.entries[targetIndex].input.y = 40;
console.log(`mutated entry tick : ${targetTick} (index ${targetIndex})`);

const tamperReport = replayAndVerify(tampered);
console.log(`hash chain intact  : ${tamperReport.hashChain.intact}`);
console.log(`hash first bad tick: ${tamperReport.hashChain.firstBadTick}`);
console.log(`summary matches    : ${tamperReport.summaryMatches}`);
if (tamperReport.firstDivergence) {
  const d = tamperReport.firstDivergence;
  console.log(`first divergence   : tick ${d.tick}, field ${d.field}`);
  if (d.field === 'state') {
    console.log(`  logged score=${d.expected.score} rng=${d.expected.rng} -> replayed score=${d.actual.score} rng=${d.actual.rng}`);
  }
}
console.log(`faithful log       : ${tamperReport.faithful}`);
writeFileSync(join(here, 'tamper-report.json'), JSON.stringify(tamperReport, null, 2));

// --- 4. Assertions --------------------------------------------------------
hr('4. Assertions');
const checks = [
  ['recorded full game', log.entries.length === log.summary.totalTicks],
  ['clean replay is faithful', report.faithful === true],
  ['tamper breaks hash chain', tamperReport.hashChain.intact === false],
  ['tamper detected at mutated tick', tamperReport.hashChain.firstBadTick === targetTick],
  ['behavioral divergence located', tamperReport.firstDivergence?.tick === targetTick],
  ['tampered log marked unfaithful', tamperReport.faithful === false],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok = ok && pass;
}
if (!ok) process.exit(1);
console.log('\nAll checks passed.');
