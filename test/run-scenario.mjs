// 端到端验证：自动调水通关 + 缓闭/急关水锤对比
import assert from 'node:assert/strict';
import {
  createState,
  step,
  closeGates,
  CONFIG,
  FIELDS,
} from '../src/engine.js';
import { createController, control } from '../src/controller.js';

function runIrrigation() {
  const state = createState();
  const ctl = createController();
  const trace = [];
  while (!state.finished) {
    control(state, ctl);
    step(state);
    if (Math.round(state.t * 10) % 100 === 0) {
      trace.push({
        t: state.t,
        pressure: state.pressure,
        moisture: state.moisture.map((m) => Math.round(m)),
        pumped: Math.round(state.totalPumped),
      });
    }
  }
  return { state, trace };
}

function runClosure(snap) {
  const state = createState();
  const ctl = createController();
  while (state.t < 30) {
    control(state, ctl);
    step(state);
  }
  const flowBefore = state.flow.reduce((a, b) => a + b, 0);
  closeGates(state, snap);
  let peak = state.pressure;
  for (let k = 0; k < 40; k++) {
    step(state);
    peak = Math.max(peak, state.peakTransient);
  }
  return { peak, flowBefore, alarm: state.alarmLatch, events: state.events };
}

console.log('== 1. 完整调水过程 ==');
const { state, trace } = runIrrigation();
for (const row of trace) {
  console.log(
    `t=${row.t}s 压力=${row.pressure.toFixed(1)}m ` +
      `湿度=[${row.moisture.join(',')}]% 累计耗水=${row.pumped}L`
  );
}
console.log(
  `结果: ${state.result} 用时=${state.t}s 耗水=${state.totalPumped.toFixed(1)}L ` +
    `预算=${CONFIG.budgetLitres}L 湿度=[${state.moisture
      .map((m) => m.toFixed(1))
      .join(', ')}]%`
);

assert.equal(state.result, 'success');
assert.ok(state.t <= CONFIG.duration, '必须在限定时间内完成');
assert.ok(
  state.totalPumped <= CONFIG.budgetLitres,
  '总耗水不能超标'
);
for (let i = 0; i < FIELDS.length; i++) {
  assert.ok(
    state.moisture[i] >= CONFIG.targetMoisture,
    `${FIELDS[i].name}湿度达标`
  );
}
assert.equal(state.alarmLatch, false, '正常调水不应触发水锤报警');

console.log('\n== 2a. 缓闭分水闸（0.5s 关闭） ==');
const slow = runClosure(false);
console.log(
  `关前流量=${slow.flowBefore.toFixed(2)}L/s 峰值=${slow.peak.toFixed(2)}m ` +
    `报警=${slow.alarm}`
);
assert.equal(slow.alarm, false, '缓闭不应报警');
assert.ok(slow.peak < CONFIG.waterhammerAlarm);

console.log('\n== 2b. 急关分水闸（单步关死） ==');
const snap = runClosure(true);
console.log(
  `关前流量=${snap.flowBefore.toFixed(2)}L/s 峰值=${snap.peak.toFixed(2)}m ` +
    `报警=${snap.alarm} 事件数=${snap.events.length}`
);
assert.equal(snap.alarm, true, '急关必须触发水锤报警');
assert.ok(snap.peak >= CONFIG.waterhammerAlarm);
assert.ok(snap.events.some((e) => e.type === 'waterhammer'));
assert.ok(snap.peak > slow.peak * 1.4, '急关冲击应显著高于缓闭');

console.log('\n全部断言通过 ✔');
