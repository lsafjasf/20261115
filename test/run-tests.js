/*
 * 模拟核心验证（Node 运行：node test/run-tests.js）
 * 1) 同 seed 重置完全一致
 * 2) 地形修改后统计同步刷新
 * 3) 河道连续、不爬坡（不穿山）
 * 4) 强降雨侵蚀强于弱降雨
 */
'use strict';
const assert = require('assert');
const { ErosionSim } = require('../js/sim.js');

const SEED = 20261115;
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok -', name);
}

function run(sim, steps, rainScale) {
  for (let k = 0; k < steps; k++) sim.step(rainScale);
}

test('同 seed 两个实例逐步结果一致', () => {
  const a = new ErosionSim({ size: 64, seed: SEED });
  const b = new ErosionSim({ size: 64, seed: SEED });
  run(a, 40); run(b, 40);
  assert(Buffer.from(a.height.buffer).equals(Buffer.from(b.height.buffer)));
  assert(Buffer.from(a.flux.buffer).equals(Buffer.from(b.flux.buffer)));
});

test('重置到初始 seed 后重放结果一致', () => {
  const a = new ErosionSim({ size: 64, seed: SEED });
  a.addRainZone(20, 20, 8, 0.1);
  a.paintHardness(30, 30, 6, 0.95);
  run(a, 40);
  a.reset();                       // 重置应清除降雨区与硬度修改
  assert.strictEqual(a.rainZones.length, 0);
  assert.strictEqual(a.stepCount, 0);
  run(a, 40);
  const b = new ErosionSim({ size: 64, seed: SEED });
  run(b, 40);
  assert(Buffer.from(a.height.buffer).equals(Buffer.from(b.height.buffer)));
  assert(Buffer.from(a.hardness.buffer).equals(Buffer.from(b.hardness.buffer)));
});

test('地形修改后统计同步（与独立重算一致且随之变化）', () => {
  const sim = new ErosionSim({ size: 64, seed: SEED });
  run(sim, 30);
  const before = sim.computeStats();
  // 独立重算最高/最低/河道格数
  function independent() {
    let maxH = -Infinity, minH = Infinity, riverCells = 0;
    const thr = sim.riverThresholdValue();
    for (let i = 0; i < sim.height.length; i++) {
      maxH = Math.max(maxH, sim.height[i]);
      minH = Math.min(minH, sim.height[i]);
      if (sim.flux[i] >= thr) riverCells++;
    }
    return { maxH, minH, riverCells };
  }
  let ind = independent();
  assert.strictEqual(before.maxHeight, ind.maxH);
  assert.strictEqual(before.minHeight, ind.minH);
  assert.strictEqual(before.riverCells, ind.riverCells);
  // 修改地形：加降雨区 + 改硬度 + 推进
  sim.addRainZone(32, 32, 10, 0.15);
  sim.paintHardness(32, 32, 8, 0.05);
  run(sim, 30);
  const after = sim.computeStats();
  ind = independent();
  assert.strictEqual(after.maxHeight, ind.maxH);
  assert.strictEqual(after.minHeight, ind.minH);
  assert.strictEqual(after.riverCells, ind.riverCells);
  assert.strictEqual(after.step, before.step + 30);
  // 统计确实随修改变化（侵蚀降低山头 / 沉积抬高洼地）
  assert(before.maxHeight !== after.maxHeight || before.minHeight !== after.minHeight,
    '修改地形并推进后统计应变化');
});

test('主河道连续且只降不升（不穿山）', () => {
  const sim = new ErosionSim({ size: 96, seed: SEED });
  run(sim, 80);
  const st = sim.computeStats();
  assert(st.riverLength > 5, '河道应有可观长度，实际 ' + st.riverLength);
  const p = st.riverPath, n = sim.size;
  for (let k = 1; k < p.length; k++) {
    const dx = Math.abs((p[k] % n) - (p[k - 1] % n));
    const dy = Math.abs(((p[k] / n) | 0) - ((p[k - 1] / n) | 0));
    assert(dx <= 1 && dy <= 1, '路径必须 8 邻域连续');
    const t0 = sim.height[p[k - 1]] + sim.water[p[k - 1]];
    const t1 = sim.height[p[k]] + sim.water[p[k]];
    assert(t1 <= t0 + 1e-9, '路径不得爬坡');
  }
});

test('强降雨比弱降雨侵蚀更强、河道更发育', () => {
  function scenario(rainScale) {
    const sim = new ErosionSim({ size: 96, seed: SEED });
    sim.addRainZone(48, 40, 14, 0.1);
    run(sim, 120, rainScale);
    return sim.computeStats();
  }
  const weak = scenario(0.5);
  const strong = scenario(2.0);
  assert(strong.erodedVolume > weak.erodedVolume,
    '强降雨侵蚀量应更大: ' + strong.erodedVolume.toFixed(1) + ' vs ' + weak.erodedVolume.toFixed(1));
  assert(strong.depositedVolume > weak.depositedVolume,
    '强降雨沉积量应更大: ' + strong.depositedVolume.toFixed(1) + ' vs ' + weak.depositedVolume.toFixed(1));
  assert(strong.riverLength >= weak.riverLength,
    '强降雨主河道应不短于弱降雨: ' + strong.riverLength + ' vs ' + weak.riverLength);
  console.log('  弱降雨:', JSON.stringify({ max: +weak.maxHeight.toFixed(3), min: +weak.minHeight.toFixed(3), riverCells: weak.riverCells, riverLen: weak.riverLength, eroded: +weak.erodedVolume.toFixed(1), deposited: +weak.depositedVolume.toFixed(1) }));
  console.log('  强降雨:', JSON.stringify({ max: +strong.maxHeight.toFixed(3), min: +strong.minHeight.toFixed(3), riverCells: strong.riverCells, riverLen: strong.riverLength, eroded: +strong.erodedVolume.toFixed(1), deposited: +strong.depositedVolume.toFixed(1) }));
});

console.log('\n全部通过 (' + passed + ' 项)');
