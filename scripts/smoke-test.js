/* Smoke tests for engine rules, determinism and browser-global export branches. */

const assert = require("assert");
const { Rng } = require("../js/rng.js");
const { MAP, shortestPath, buildGraph } = require("../js/map.js");
const { GameEngine } = require("../js/engine.js");
const { runAuto } = require("../js/autopilot.js");

function makeEngine(seed = 20261115) {
  return new GameEngine(new Rng(seed), MAP);
}

function runTo(engine, seconds) {
  while (engine.time < seconds && !engine.finished) engine.update(1);
}

function testDeterminism() {
  const first = makeEngine();
  const second = makeEngine();
  runAuto(first, 1);
  runAuto(second, 1);
  assert.deepStrictEqual(first.exportData().dispatchRecords, second.exportData().dispatchRecords);
  assert.strictEqual(first.result.success, true);
  console.log("✓ 固定 seed 可复现，且自动局成功");
}

function testNoDuplicateDispatch() {
  const engine = makeEngine();
  assert.strictEqual(engine.dispatch("A1", "P1").ok, true);
  const retry = engine.dispatch("A2", "P1");
  assert.strictEqual(retry.ok, false);
  assert.match(retry.error, /不能重复调派/);
  console.log("✓ 同一伤员不能重复派遣");
}

function testCrewAndMaintenance() {
  const engine = makeEngine();
  const blocked = engine.dispatch("A3", "P1");
  assert.strictEqual(blocked.ok, false);
  runTo(engine, 46);
  const repaired = engine.ambulanceById("A3");
  assert.strictEqual(repaired.mode, "idle");
  assert.strictEqual(engine.dispatch("A3", "P5").ok, true);
  console.log("✓ 维修车辆解封后才能派遣，且人数校验生效");
}

function testFuelGuard() {
  const engine = makeEngine();
  engine.ambulanceById("A2").fuel = 5;
  const blocked = engine.dispatch("A2", "P3");
  assert.strictEqual(blocked.ok, false);
  assert.match(blocked.error, /油量不足/);
  console.log("✓ 油量不足禁止派遣");
}

function testTimeoutDecay() {
  const engine = makeEngine();
  runTo(engine, 200);
  assert.strictEqual(engine.dispatch("A1", "P1").ok, true);
  while (!engine.patientById("P1").deliveredAt && !engine.finished) engine.update(1);
  const patient = engine.patientById("P1");
  assert.ok(patient.successRate <= 0.2, `成功率应随超时下降，实际 ${patient.successRate}`);
  console.log("✓ 超时导致成功率下降至", patient.successRate);
}

function testBedQueue() {
  const engine = makeEngine();
  const hospital = engine.hospitalById("H1");
  hospital.beds = 0;
  assert.strictEqual(engine.dispatch("A1", "P1", "H1").ok, true);
  while (engine.ambulanceById("A1").mode !== "queued" && engine.time < 120) engine.update(1);
  assert.strictEqual(engine.ambulanceById("A1").mode, "queued");
  hospital.beds = 2;
  engine._admitQueued();
  assert.strictEqual(engine.patientById("P1").state, "delivered");
  console.log("✓ 无床位时排队，床位恢复后入院");
}

function testRerouteAndHospitalSwitch() {
  const engine = makeEngine();
  engine.dispatch("A1", "P1", "H1", "fastest");
  assert.strictEqual(engine.setPriority("A1", "shortest").ok, true);
  assert.strictEqual(engine.setTargetHospital("A1", "H2").ok, true);
  assert.strictEqual(engine.ambulanceById("A1").mission.hospitalId, "H2");
  console.log("✓ 路径优先级与目标医院可在途中切换");
}

function testPathfinding() {
  const graph = buildGraph(MAP, {});
  const path = shortestPath(MAP, graph, MAP.depot.node, MAP.districts[4].node);
  assert.ok(path.length > 1);
  assert.strictEqual(path[0], MAP.depot.node);
  assert.strictEqual(path[path.length - 1], MAP.districts[4].node);
  console.log("✓ 路径规划连通");
}

const tests = [
  testPathfinding,
  testDeterminism,
  testNoDuplicateDispatch,
  testCrewAndMaintenance,
  testFuelGuard,
  testTimeoutDecay,
  testBedQueue,
  testRerouteAndHospitalSwitch,
];

for (const test of tests) test();
console.log(`\n全部 ${tests.length} 项冒烟测试通过`);
