import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { CONFIG, generateTasks, runAutoScenario } from "../src/simulation.js";

const seed = "RING-305";
const taskSequence = generateTasks(seed).map((task) => ({
  id: task.id,
  wave: task.wave,
  route: `${task.origin} > ${task.destination}`,
  cargo: task.cargo,
  revealAt: task.revealAt
}));
const sequenceHash = createHash("sha256")
  .update(JSON.stringify(taskSequence))
  .digest("hex");

const success = runAutoScenario({ seed });
const failure = runAutoScenario({
  seed,
  initialBattery: 8,
  incidentCount: 3,
  vehicleLimit: 4,
  maxQueued: 1,
  minBattery: 0
});

function runLog(sim) {
  return [
    `seed=${sim.seed} duration=${CONFIG.duration}s required=${sim.requiredCompleted}`,
    ...sim.events.map((event) => `${event.at.toFixed(1).padStart(6)}s ${event.type.padEnd(8)} ${event.message}`),
    `RESULT ${sim.result.status.toUpperCase()} completed=${sim.result.completed}/${sim.result.totalTasks}`,
    `reason=${sim.result.reason}`,
    `reserve=${sim.result.reserveVehicles.join(",") || "none"}`,
    `depleted=${sim.result.depletedVehicles.join(",") || "none"}`
  ].join("\n");
}

if (success.result.status !== "success" || success.result.completed < success.result.required) {
  throw new Error(`Expected success run, got ${JSON.stringify(success.result)}`);
}
if (
  failure.result.status !== "failure" ||
  failure.result.depletedVehicles.length === 0 ||
  !failure.result.reason.includes("电量耗尽")
) {
  throw new Error(`Expected depletion failure, got ${JSON.stringify(failure.result)}`);
}

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/success-run.log", `${runLog(success)}\n`);
await writeFile("artifacts/battery-failure-run.log", `${runLog(failure)}\n`);
await writeFile("artifacts/verification.json", `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  seed,
  sequenceHash,
  taskSequence,
  success: success.result,
  failure: failure.result
}, null, 2)}\n`);

console.log(`seed=${seed} sequence=${sequenceHash.slice(0, 16)}`);
console.log(`success: ${success.result.reason}`);
console.log(`failure: ${failure.result.reason}`);
console.log("artifacts/verification.json written");
