const fs = require('fs');
const path = require('path');
const Engine = require('../js/engine.js');
const History = require('../js/history.js');

const root = path.join(__dirname, '..');
const demo = JSON.parse(fs.readFileSync(
  path.join(root, 'data', 'demo-plan.json'), 'utf8'));

function fmtFlow(cubicMeters) {
  return (cubicMeters * 1000).toFixed(2) + ' L/s';
}

const lines = [];
const log = (text) => {
  lines.push(text);
  console.log(text);
};

log('=== 步骤 1：加载并求解无负压示例方案 ===');
const history = new History(demo);
const initial = Engine.analyze(history.current());
log('收敛：' + initial.solution.converged +
  '，迭代 ' + initial.solution.iterations + ' 次');
log('环路数量：' + initial.loops.length +
  '，死端数量：' + initial.deadEnds.length +
  '，负压：' + initial.hasNegativePressure);
initial.solution.edges.forEach((edge) => {
  log(edge.id + ' 流量 ' + fmtFlow(edge.flow) +
    '，流速 ' + edge.velocity.toFixed(2) + ' m/s');
});
initial.delivered.forEach((d) => {
  log(d.name + ' 需求 ' + fmtFlow(d.required) +
    '，实供 ' + fmtFlow(d.delivered));
});
const p6Before = initial.solution.edges.find((e) => e.id === 'P6');
log('修改前 P6 流速：' + p6Before.velocity.toFixed(3) + ' m/s');

log('');
log('=== 步骤 2：把 P6 管径从 150 mm 改为 60 mm ===');
const modified = history.current();
modified.edges.find((e) => e.id === 'P6').diameter = 0.06;
history.push(modified);
const changed = Engine.analyze(history.current());
const p6Changed = changed.solution.edges.find((e) => e.id === 'P6');
log('修改后 P6 流速：' + p6Changed.velocity.toFixed(3) + ' m/s');
log('高流速告警：' +
  changed.issues.some((i) => i.type === 'high-velocity'));

log('');
log('=== 步骤 3：撤销一次修改并重新计算 ===');
const restoredPlan = history.undo();
const restored = Engine.analyze(restoredPlan);
const p6Restored = restored.solution.edges.find((e) => e.id === 'P6');
log('撤销后 P6 管径：' +
  Math.round(restoredPlan.edges.find((e) => e.id === 'P6').diameter * 1000) +
  ' mm');
log('撤销后 P6 流速：' + p6Restored.velocity.toFixed(3) + ' m/s');
log('撤销后流量与基线一致：' +
  (Math.abs(p6Restored.flow - p6Before.flow) < 1e-12));
log('撤销后仍为无负压方案：' + !restored.hasNegativePressure);
log('可重做：' + history.canRedo());

const reportPath = path.join(root, 'artifacts', 'verification-report.txt');
fs.writeFileSync(reportPath, lines.join('\n') + '\n');
console.log('\n报告已写入 ' + reportPath);
