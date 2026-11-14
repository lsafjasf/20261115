import test from "node:test";
import assert from "node:assert/strict";
import {
  ROWS,
  SIM,
  consumeNotifications,
  createSimulation,
  getLighting,
  setControl,
  startSimulation,
  stepSimulation,
} from "../src/sim.js";

function runFor(sim, seconds, onTick) {
  const ticks = Math.round(seconds / 0.1);
  for (let index = 0; index < ticks; index += 1) {
    onTick?.(index * 0.1);
    stepSimulation(sim, 0.1);
    if (sim.status !== "running") break;
  }
}

test("灯架停在单排过久会升温灼伤并结束本轮", () => {
  const sim = createSimulation({ controls: { rackX: ROWS[1].x } });
  startSimulation(sim);
  runFor(sim, 200);

  assert.equal(sim.status, "failed");
  assert.equal(sim.failReason, "burn");
  assert.equal(sim.rows[1].burned, true);
  assert.ok(sim.time < 100, `灼伤应在久留后发生，实际 ${sim.time.toFixed(1)}s`);
  assert.ok(sim.rows[1].temp >= SIM.burnTemp);
  assert.ok(
    consumeNotifications(sim).some((notice) => notice.tone === "danger"),
    "灼伤应产生危险提示",
  );
});

test("按照三排轮换并执行默认暗周期可提前完成一局", () => {
  const sim = createSimulation();
  startSimulation(sim);
  const order = [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2];
  let elapsed = 0;

  for (const rowIndex of order) {
    if (sim.status !== "running") break;
    setControl(sim, "rackX", ROWS[rowIndex].x);
    const passEnd = Math.min(elapsed + 40, sim.duration);
    while (elapsed + 0.05 < passEnd && sim.status === "running") {
      stepSimulation(sim, 0.1);
      elapsed += 0.1;
    }
  }

  assert.equal(sim.status, "won");
  assert.ok(sim.time <= 720, "应在十二分钟内完成");
  assert.ok(sim.time < 400, "有效轮换应能提前完成");
  assert.equal(sim.rows.some((row) => row.burned), false);
  for (const row of sim.rows) assert.equal(row.growth, 100);
});

test("灯架停驻会压暗相邻区域的自然光", () => {
  const sim = createSimulation({ controls: { rackX: ROWS[0].x } });
  const near = getLighting(sim, 1);
  const far = getLighting(sim, 2);

  assert.ok(near.shadow > far.shadow, "靠近灯架的一排应有更明显的遮挡");
  assert.ok(near.ambient < far.ambient, "遮挡应降低邻近排的自然光");
});

test("低于停滞阈值时生长值不增加", () => {
  const sim = createSimulation({ controls: { rackX: 2.4 } });
  startSimulation(sim);
  setControl(sim, "duty", 0.35);
  runFor(sim, 20);

  assert.equal(sim.rows[0].growth, 0);
  assert.ok(getLighting(sim, 0).ppfd < SIM.stallBelow);
});
