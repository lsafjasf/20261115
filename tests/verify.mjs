import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_CONFIGS, environmentHash, runSimulation } from "../src/simulation.js";

export const VERIFY_SEEDS = Object.freeze(["NORD-17", "TIDE-42"]);

function formatFleet(run) {
  return run.fleet
    .map((boat) => `${boat.callsign} ${boat.completed}/5 ${boat.finished ? "FIN" : boat.status.toUpperCase()} ${boat.finishTime ? `${boat.finishTime.toFixed(1)}s` : ""}`)
    .join(" | ");
}

let failed = false;
const report = { verdict: "PASS", seeds: [] };
for (const seed of VERIFY_SEEDS) {
  const first = runSimulation(seed, DEFAULT_CONFIGS);
  const second = runSimulation(seed, DEFAULT_CONFIGS);
  const exactFrames = JSON.stringify(first.frames) === JSON.stringify(second.frames);
  const hashMatches = first.hash === second.hash;
  const reachable = first.finishedCount >= 2;
  failed ||= !(exactFrames && hashMatches && reachable);
  report.seeds.push({
    seed,
    environmentHash: environmentHash(seed),
    replayHash: first.hash,
    replayIdentical: exactFrames && hashMatches,
    reachable,
    finished: first.finishedCount,
    duration: Number(first.duration.toFixed(1)),
    fleet: first.fleet.map((boat) => ({
      callsign: boat.callsign,
      completed: boat.completed,
      finished: boat.finished,
      collisions: boat.collisions
    }))
  });

  console.log(`\n[${seed}] env ${environmentHash(seed)}  run ${first.hash}`);
  console.log(`  reachable: ${reachable} (${first.finishedCount}/3 finished)`);
  console.log(`  replay identical: ${exactFrames && hashMatches}`);
  console.log(`  ${formatFleet(first)}`);
  console.log(
    `  collisions: ${first.fleet.map((boat) => boat.collisions).join("/")}  duration: ${first.duration.toFixed(1)}s`
  );
}

if (failed) {
  report.verdict = "FAIL";
  mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
  writeFileSync(
    new URL("../artifacts/verification.json", import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.error("\nVERIFICATION FAILED");
  process.exit(1);
}
mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../artifacts/verification.json", import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`
);
console.log("\nVERIFICATION PASSED: both seeds reachable; replay frames and hashes are identical.");
