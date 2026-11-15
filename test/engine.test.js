const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Engine = require('../js/engine.js');
const History = require('../js/history.js');

const demo = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'data', 'demo-plan.json'), 'utf8'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}

console.log('水力引擎测试');

test('示例方案收敛且无负压、无错误', () => {
  const report = Engine.analyze(clone(demo));
  assert.strictEqual(report.solution.converged, true);
  assert.strictEqual(report.hasError, false);
  assert.strictEqual(report.hasNegativePressure, false);
  report.solution.nodes.forEach((n) => assert.ok(n.pressureKpa > 0));
});

test('三个用水设备均按需求获得流量', () => {
  const report = Engine.analyze(clone(demo));
  report.delivered.forEach((d) => {
    assert.ok(Math.abs(d.delivered - d.required) < 1e-6,
      d.name + ' 供水不匹配: ' + d.delivered);
  });
});

test('两个水源均正向供水', () => {
  const report = Engine.analyze(clone(demo));
  const p1 = report.solution.edges.find((e) => e.id === 'P1');
  const p2 = report.solution.edges.find((e) => e.id === 'P2');
  assert.ok(p1.flow > 0, 'S1 应正向供水');
  assert.ok(p2.flow > 0, 'S2 应正向供水');
});

test('自动识别环路', () => {
  const report = Engine.analyze(clone(demo));
  assert.strictEqual(report.loops.length, 1);
  assert.ok(report.issues.some((i) => i.type === 'loop'));
});

test('管径过小触发高流速告警', () => {
  const plan = clone(demo);
  plan.edges.find((e) => e.id === 'P6').diameter = 0.05;
  const report = Engine.analyze(plan);
  assert.ok(report.issues.some((i) => i.type === 'high-velocity'));
});

test('关阀导致设备断连时报告错误', () => {
  const plan = clone(demo);
  plan.edges.find((e) => e.id === 'P6').valve = { kind: 'closed' };
  const report = Engine.analyze(plan);
  assert.ok(report.issues.some((i) => i.type === 'disconnected' && i.nodeId === 'D1'));
});

test('止回阀阻止反向流动', () => {
  const plan = clone(demo);
  plan.edges.find((e) => e.id === 'P1').valve = {
    kind: 'check', allowDirection: 'backward'
  };
  const report = Engine.analyze(plan);
  const p1 = report.solution.edges.find((e) => e.id === 'P1');
  assert.strictEqual(p1.flow, 0);
});

test('死端节点可被检测', () => {
  const plan = clone(demo);
  plan.nodes.push({
    id: 'X1', kind: 'junction', name: '盲端', x: 700, y: 80, elevation: 0
  });
  plan.edges.push({
    id: 'PX', from: 'J3', to: 'X1', diameter: 0.1, roughness: 0.02, valve: null
  });
  const report = Engine.analyze(plan);
  assert.ok(report.deadEnds.some((d) => d.id === 'X1'));
  assert.ok(report.issues.some((i) => i.type === 'dead-end'));
});

test('极端需求可制造负压并被检出', () => {
  const plan = clone(demo);
  plan.nodes.find((n) => n.id === 'D1').demand = 0.5;
  plan.nodes.find((n) => n.id === 'D2').demand = 0.5;
  plan.nodes.find((n) => n.id === 'D3').demand = 0.5;
  plan.nodes.forEach((n) => { if (n.kind === 'source') n.head = 5; });
  const report = Engine.analyze(plan);
  assert.strictEqual(report.hasNegativePressure, true);
  assert.ok(report.issues.some((i) => i.type === 'negative-pressure'));
});

console.log('\n撤销/重算测试');

test('修改管径后撤销，流量恢复到修改前结果', () => {
  const history = new History(clone(demo));
  const baseline = Engine.analyze(history.current());
  const baseEdge = baseline.solution.edges.find((e) => e.id === 'P6');
  const baseVelocity = baseEdge.velocity;
  const baseFlow = baseEdge.flow;

  const modified = history.current();
  modified.edges.find((e) => e.id === 'P6').diameter = 0.06;
  history.push(modified);
  const changed = Engine.analyze(history.current());
  const changedEdge = changed.solution.edges.find((e) => e.id === 'P6');
  assert.notStrictEqual(changedEdge.velocity.toFixed(6), baseVelocity.toFixed(6));

  const restored = history.undo();
  assert.ok(restored, '撤销应返回上一状态');
  const recalculated = Engine.analyze(restored);
  const restoredFlow = recalculated.solution.edges.find((e) => e.id === 'P6').flow;
  assert.ok(Math.abs(restoredFlow - baseFlow) < 1e-12,
    '撤销后流量必须重算并恢复原值');
  assert.strictEqual(history.canRedo(), true);

  history.redo();
  const redone = Engine.analyze(history.current());
  const redoneEdge = redone.solution.edges.find((e) => e.id === 'P6');
  assert.ok(Math.abs(redoneEdge.velocity - changedEdge.velocity) < 1e-12,
    '重做后流量应回到修改值');
});

test('拖拽节点改变管长后撤销，水头损失恢复', () => {
  const history = new History(clone(demo));
  const before = Engine.analyze(history.current())
    .solution.edges.find((e) => e.id === 'P1').headLoss;

  const moved = history.current();
  moved.nodes.find((n) => n.id === 'J1').x += 120;
  history.push(moved);
  const movedLoss = Engine.analyze(history.current())
    .solution.edges.find((e) => e.id === 'P1').headLoss;
  assert.notStrictEqual(movedLoss.toFixed(6), before.toFixed(6));

  const undone = Engine.analyze(history.undo());
  const undoneLoss = undone.solution.edges.find((e) => e.id === 'P1').headLoss;
  assert.ok(Math.abs(undoneLoss - before) < 1e-12);
});

test('方案可序列化为 JSON 并完整还原', () => {
  const json = JSON.stringify(demo);
  const roundTrip = JSON.parse(json);
  const report = Engine.analyze(roundTrip);
  assert.strictEqual(report.solution.converged, true);
  assert.strictEqual(roundTrip.nodes.length, demo.nodes.length);
  assert.strictEqual(roundTrip.edges.length, demo.edges.length);
});

console.log('\n通过 ' + passed + ' 项测试');
