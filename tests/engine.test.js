/**
 * 纯 Node 引擎测试：三段反射、错位丢信号、过热锁定、云层可见度、胜利条件。
 * 运行：node tests/engine.test.js
 */
const assert = require('assert');
const E = require('../src/engine.js');
const { CanyonGame } = require('../src/game.js');
const { LAYOUT, TARGET_ANGLES } = E;

let passed = 0;
function test(name, fn) {
  const g = new CanyonGame(7);
  g.weatherEnabled = false; // 默认关闭天气，单独的用例再开启
  fn(g);
  passed++;
  console.log('  ✓ ' + name);
}

// 仅通过合法步长把镜片转到设计解，模拟真实玩家操作：
// 每转 8 步散热一次，避免过热（与真实玩法一致）。
function solveBySteps(g) {
  g.mirrors.forEach((m, i) => {
    let steps = Math.round(TARGET_ANGLES[i] / LAYOUT.stepDeg);
    steps = ((steps % 120) + 120) % 120;
    for (let k = 0; k < steps; k++) {
      if (m.heat + LAYOUT.heatPerStep >= LAYOUT.overheatAt) {
        for (let c = 0; c < 22; c++) g.update(100); // 累积散热 2.2s
      }
      g.rotate(i, +1);
    }
  });
}

test('设计解落在步长网格上，量化误差小于半格', () => {
  TARGET_ANGLES.forEach((a) => {
    const q = Math.abs(E.angleDelta(a, Math.round(a / LAYOUT.stepDeg) * LAYOUT.stepDeg));
    assert.ok(q < LAYOUT.stepDeg / 2 + 1e-9);
  });
  assert.strictEqual(LAYOUT.toleranceDeg < LAYOUT.stepDeg, true);
});

test('实际完成一次三段反射：三组信号全部建立', (g) => {
  solveBySteps(g);
  const trace = g.update(16);
  assert.deepStrictEqual(trace.signals, [true, true, true]);
  trace.segments.forEach((s, i) => {
    assert.ok(s.hit, `段 ${i} 应命中目标`);
    assert.ok(s.errorDeg <= LAYOUT.toleranceDeg);
  });
  assert.strictEqual(g.lockedCount, 3);
});

test('温度降回上限以下后触发胜利，且胜利事件只发一次', (g) => {
  solveBySteps(g);
  g.update(16);
  assert.strictEqual(g.won, false, '刚调完温度高，不应胜利');
  const coolMs = (LAYOUT.heatPerStep * 40 / LAYOUT.heatCooldown) * 1000 + 500;
  for (let t = 0; t < coolMs; t += 100) g.update(100);
  assert.strictEqual(g.signals.join(','), 'true,true,true', '冷却期间信号保持');
  assert.strictEqual(g.won, true);
  const wins = g.events.filter((e) => e.type === 'win').length;
  g.update(100);
  assert.strictEqual(g.events.filter((e) => e.type === 'win').length, wins);
});

test('错位一个步长：中间镜片导致后两段信号丢失', (g) => {
  solveBySteps(g);
  g.update(16);
  g.rotate(1, +1); // M2 偏 3°，超过 2.4° 容差
  const trace = g.update(16);
  assert.deepStrictEqual(trace.signals, [true, false, false]);
  assert.strictEqual(trace.segments[1].hit, false);
  assert.ok(g.events.some((e) => e.type === 'signalLost' && e.index === 1));
});

test('错位后转回，信号重新建立', (g) => {
  solveBySteps(g);
  g.update(16);
  g.rotate(1, +1);
  g.update(16);
  g.rotate(1, -1);
  const trace = g.update(16);
  assert.deepStrictEqual(trace.signals, [true, true, true]);
  assert.ok(g.events.some((e) => e.type === 'signal' && e.index === 1));
});

test('首镜错位：三段信号全部丢失', (g) => {
  solveBySteps(g);
  g.update(16);
  g.rotate(0, +1);
  const trace = g.update(16);
  assert.deepStrictEqual(trace.signals, [false, false, false]);
});

test('连续快速转动累积热量，到限后过热锁定并拒绝操作', (g) => {
  for (let k = 0; k < 9; k++) g.rotate(0, +1); // 9*11=99，尚未触顶
  assert.strictEqual(g.mirrors[0].locked, false);
  const ok = g.rotate(0, +1); // 第 10 次动作生效，但热量触顶立即锁定
  assert.strictEqual(ok, true);
  assert.strictEqual(g.mirrors[0].locked, true);
  assert.strictEqual(g.mirrors[0].heat, LAYOUT.overheatAt);
  assert.ok(g.events.some((e) => e.type === 'overheat' && e.index === 0));
  assert.strictEqual(g.rotate(0, -1), false, '锁定中不能调角');
});

test('锁定持续固定时长，解除后温度回落且恢复可调', (g) => {
  for (let k = 0; k < 10; k++) g.rotate(2, +1);
  assert.strictEqual(g.mirrors[2].locked, true);
  for (let t = 0; t < LAYOUT.overheatLockMs; t += 100) g.update(100);
  assert.strictEqual(g.mirrors[2].locked, false);
  assert.strictEqual(g.mirrors[2].heat, LAYOUT.lockReleaseHeat);
  assert.strictEqual(g.rotate(2, -1), true);
});

test('未锁定镜片随时间自然散热', (g) => {
  g.rotate(0, +1);
  const h0 = g.mirrors[0].heat;
  for (let i = 0; i < 10; i++) g.update(100); // 累积 1 秒
  assert.ok(g.mirrors[0].heat < h0);
  assert.ok(Math.abs((h0 - g.mirrors[0].heat) - LAYOUT.heatCooldown) < 0.2);
});

test('云层遮挡使可见度下降，低于阈值时信号丢失', () => {
  const g = new CanyonGame(7);
  g.weatherEnabled = true;
  solveBySteps(g);
  // 造一块厚云盖在 M2 -> M3 的路径上
  const mid = E.unit(E.sub(LAYOUT.mirrors[2], LAYOUT.mirrors[1]));
  g.clouds.length = 0;
  // 扁而宽的厚云，沿 M2->M3 方向覆盖整条线段
  g.clouds.push({
    x: (LAYOUT.mirrors[1].x + LAYOUT.mirrors[2].x) / 2,
    y: (LAYOUT.mirrors[1].y + LAYOUT.mirrors[2].y) / 2,
    w: 1200, depth: 1, speed: 0
  });
  const trace = g.update(16);
  assert.ok(trace.segments[1].visibility < 0.25, '厚云下可见度应低于阈值');
  assert.strictEqual(trace.signals[1], false);
  // 云移走后恢复
  g.weatherEnabled = false;
  const trace2 = g.update(16);
  assert.deepStrictEqual(trace2.signals, [true, true, true]);
});

test('reset 恢复初始场景', (g) => {
  solveBySteps(g);
  g.update(16);
  g.reset();
  assert.strictEqual(g.won, false);
  assert.deepStrictEqual(g.signals, [false, false, false]);
  assert.ok(g.mirrors.every((m) => m.angle === 0 && m.heat === 0 && !m.locked));
});

console.log(`\n引擎测试 ${passed} 项全部通过`);
