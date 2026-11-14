const assert = require('assert');
const { Simulation, AutoPilot, solveHydraulics, P } = require('../src/fire-sim.js');

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log(`  ok - ${name}`);
}

console.log('1. 水力基础');
check('无泵运行时压力与流量为 0', () => {
  const sim = new Simulation({ ruptureAt: null });
  sim.hoses.forEach(h => { h.valve = h.target = 1; });
  const r = sim.step();
  assert.strictEqual(r.pressure, 0);
  assert.ok(r.hoses.every(h => h.flow === 0));
});

check('等开度下远端水带流量低于近端', () => {
  const sim = new Simulation({ ruptureAt: null });
  sim.pumps.forEach((p, i) => sim.setPump(i, true));
  sim.hoses.forEach(h => { h.valve = h.target = 1; });
  sim.step();
  const r = solveHydraulics(sim);
  assert.ok(r.hoseFlows[0] > r.hoseFlows[3]);
  assert.ok(r.pressure > 80 && r.pressure < 320);
});

check('开启更多支路会拉低总压力', () => {
  const one = new Simulation({ ruptureAt: null });
  one.pumps.forEach((p, i) => one.setPump(i, true));
  one.hoses[0].valve = one.hoses[0].target = 1;
  one.step();
  const pOne = solveHydraulics(one).pressure;

  const four = new Simulation({ ruptureAt: null });
  four.pumps.forEach((p, i) => four.setPump(i, true));
  four.hoses.forEach(h => { h.valve = h.target = 1; });
  four.step();
  const pFour = solveHydraulics(four).pressure;
  assert.ok(pOne > pFour, `单支路 ${pOne.toFixed(1)} 应高于四支路 ${pFour.toFixed(1)}`);
});

console.log('2. 水锤');
check('紧急关阀产生水锤压力峰值', () => {
  const sim = new Simulation({ ruptureAt: null });
  sim.pumps.forEach((p, i) => sim.setPump(i, true));
  sim.hoses.forEach(h => { h.valve = h.target = 1; });
  for (let i = 0; i < 40; i++) sim.step(); // 建立稳态流量
  const before = sim.pressure;
  sim.hoses.forEach((_, i) => sim.emergencyClose(i)); // 瞬时截断全部支路
  sim.step();
  assert.ok(sim.hammer > 40, `水锤峰值应明显，got ${sim.hammer.toFixed(1)}`);
  assert.ok(sim.hammerWarn);
  assert.ok(sim.pressure + sim.hammer > before);
});

check('超过爆管阈值的水锤会撑破水带', () => {
  const sim = new Simulation({ ruptureAt: null });
  sim.pumps.forEach((p, i) => sim.setPump(i, true));
  sim.hoses.forEach(h => { h.valve = h.target = 1; });
  for (let i = 0; i < 40; i++) sim.step();
  // 反复瞬时关阀，累积高压冲击
  for (let n = 0; n < 6 && sim.hoses.every(h => !h.ruptured); n++) {
    sim.hoses.forEach(h => { h.valve = h.target = 1; });
    for (let i = 0; i < 30; i++) sim.step();
    sim.hoses.forEach((_, idx) => sim.emergencyClose(idx));
    sim.step();
  }
  assert.ok(sim.hoses.some(h => h.ruptured), '应至少有一条水带破裂');
});

console.log('3. 破裂后压力重分配');
check('破裂泄压 -> 关阀隔离 -> 压力恢复且剩余支路流量上升', () => {
  const sim = new Simulation({ ruptureAt: null });
  sim.pumps.forEach((p, i) => sim.setPump(i, true));
  sim.hoses.forEach(h => { h.valve = h.target = 0.8; });
  for (let i = 0; i < 60; i++) sim.step();
  const pHealthy = sim.pressure;
  const flowBefore = sim.hoses.map(h => h.flow);

  sim.triggerRupture(2); // C 管破裂，保持开度，破口自由泄放
  for (let i = 0; i < 10; i++) sim.step();
  const pLeak = sim.pressure;
  assert.ok(pLeak < pHealthy * 0.85, '破裂后压力应显著下降');
  assert.ok(sim.hoses[2].flow > P.leakFlow * 0.7, '破口大量漏水');

  // 缓慢关闭破裂支路（模拟正确处置，不产生水锤）
  sim.setValve(2, 0);
  for (let i = 0; i < 80; i++) sim.step();
  const pRecovered = sim.pressure;
  assert.ok(pRecovered > pLeak * 1.25,
    `隔离后压力应回升: ${pLeak.toFixed(1)} -> ${pRecovered.toFixed(1)}`);
  const others = [0, 1, 3];
  for (const idx of others) {
    assert.ok(sim.hoses[idx].flow > flowBefore[idx],
      `水带 ${sim.hoses[idx].id} 流量应随压力重分配而上升`);
  }
  console.log(`    压力: 健康 ${pHealthy.toFixed(1)} -> 泄漏 ${pLeak.toFixed(1)}` +
    ` -> 隔离恢复 ${pRecovered.toFixed(1)} kPa`);
});

console.log('4. 完整灭火任务（自动驾驶，35s 时 C 管破裂）');
{
  const sim = new Simulation({ ruptureAt: 35, ruptureHose: 2 });
  const pilot = new AutoPilot(sim);
  const trace = { minPressure: Infinity, isolated: null };
  let maxHammer = 0;
  while (sim.status === 'running' && sim.t < 240) {
    pilot.update(P.dt);
    sim.step();
    maxHammer = Math.max(maxHammer, sim.hammer);
    if (sim.hoses[2].ruptured && !trace.leak) {
      trace.leak = { t: sim.t, p: sim.pressure, flows: sim.hoses.map(h => h.flow) };
    }
    if (trace.leak) {
      trace.minPressure = Math.min(trace.minPressure, sim.pressure);
      if (sim.hoses[2].valve <= 0.02 && !trace.isolated) {
        trace.isolated = { t: sim.t, p: sim.pressure, flows: sim.hoses.map(h => h.flow) };
      }
    }
  }
  assert.strictEqual(sim.status, 'won', `应成功灭火，实际 ${sim.status}`);
  assert.ok(sim.tank > 0, '应在储水耗尽前完成');
  assert.ok(maxHammer < P.pressureWarn,
    `平稳操作不应触发水锤告警，峰值 ${maxHammer.toFixed(1)}`);
  assert.ok(trace.leak && trace.isolated, '应经历泄漏与隔离两个阶段');
  assert.ok(trace.isolated.p > trace.minPressure * 1.08,
    `隔离后压力应重分配回升: 最低 ${trace.minPressure.toFixed(1)} -> ` +
    `${trace.isolated.p.toFixed(1)} kPa`);
  console.log(`    用时 ${sim.t.toFixed(1)}s，剩余水 ${Math.round(sim.tank)}L，` +
    `最大水锤 ${maxHammer.toFixed(1)} kPa`);
  console.log(`    破裂后最低压力 ${trace.minPressure.toFixed(1)} kPa，` +
    `隔离后恢复 ${trace.isolated.p.toFixed(1)} kPa`);
  pass++;
  console.log('  ok - 自动驾驶完成灭火并正确处置破裂');
}

console.log(`\n全部 ${pass} 项断言通过`);
