const test = require('node:test');
const assert = require('node:assert/strict');
const ShaftSim = require('../js/sim.js');
const { createController, decide } = require('../js/controller.js');

const C = ShaftSim.CONFIG;

function runUntil(s, controller, maxSeconds) {
  const ctrl = controller || createController();
  const steps = Math.ceil(maxSeconds / C.DT);
  let maxPressure = 0;
  let maxTilt = 0;
  for (let i = 0; i < steps && s.status === 'running'; i++) {
    ShaftSim.step(s, decide(ctrl, s));
    maxPressure = Math.max(maxPressure, s.pressure);
    maxTilt = Math.max(maxTilt, Math.abs(s.tilt));
  }
  return { maxPressure, maxTilt, steps };
}

test('初始状态固定：水位、物资批次与控制开度', () => {
  const s = ShaftSim.createState();
  assert.equal(s.level, C.INIT_LEVEL);
  assert.equal(s.remaining, C.BATCHES);
  assert.equal(s.loaded, 1);
  assert.equal(s.inlet, 0);
  assert.equal(s.overflow, 0);
  assert.equal(s.brake, 0);
  assert.equal(s.status, 'running');
});

test('场景一：脚本控制器可完成三批物资运输且全程不裂管、不撞壁', () => {
  const s = ShaftSim.createState();
  const r = runUntil(s, createController(), 500);
  assert.equal(s.status, 'won');
  assert.equal(s.delivered, 3);
  assert.equal(s.remaining, 0);
  assert.ok(r.maxPressure < C.PRESSURE_RUPTURE, '压力不得达到裂管阈值');
  assert.ok(r.maxTilt < C.TILT_LIMIT, '倾角不得达到撞壁阈值');
  assert.ok(s.basketY >= C.PLATFORM_Y - C.DOCK_BAND, '最终停留在上层平台对接区');
});

test('场景二：进水阀长期满开且溢流关闭必然超压裂管失败', () => {
  const s = ShaftSim.createState();
  const steps = Math.ceil(120 / C.DT);
  let failedAt = -1;
  for (let i = 0; i < steps; i++) {
    ShaftSim.step(s, { inlet: 1, overflow: 0, brake: 0 });
    if (s.status === 'failed') { failedAt = i; break; }
  }
  assert.equal(s.status, 'failed');
  assert.equal(s.failReason, 'rupture');
  assert.ok(failedAt >= 0, '应在时限内触发裂管');
  assert.ok(s.pressure >= C.PRESSURE_RUPTURE);
  assert.equal(s.delivered, 0, '失败前不应有物资送达');
});

test('场景三：暂停期间状态冻结，恢复后从同一状态继续推进', () => {
  const s = ShaftSim.createState();
  const ctrl = createController();
  for (let i = 0; i < 300; i++) ShaftSim.step(s, decide(ctrl, s));

  ShaftSim.setPaused(s, true);
  assert.equal(ShaftSim.isPaused(s), true);
  const frozen = ShaftSim.snapshot(s);

  // 暂停期间无论推进多少步、给什么输入，状态都必须冻结
  for (let i = 0; i < 120; i++) {
    ShaftSim.step(s, { inlet: 1, overflow: 1, brake: 1 });
  }
  assert.deepEqual(s, frozen);

  // 恢复后继续运行，状态可正常推进，并最终获胜
  ShaftSim.setPaused(s, false);
  const before = ShaftSim.snapshot(s);
  ShaftSim.step(s, decide(ctrl, s));
  assert.ok(s.time > before.time, '恢复后时间重新推进');
  assert.notDeepEqual(s, before);

  const r = runUntil(s, ctrl, 500);
  assert.equal(s.status, 'won');
  assert.equal(s.delivered, 3);
  assert.ok(r.maxPressure < C.PRESSURE_RUPTURE);
});

test('快照可序列化并还原为等价模拟状态', () => {
  const s = ShaftSim.createState();
  const ctrl = createController();
  for (let i = 0; i < 240; i++) ShaftSim.step(s, decide(ctrl, s));
  const snap = ShaftSim.snapshot(s);
  const json = JSON.stringify(snap);
  const restored = ShaftSim.restore(JSON.parse(json));
  assert.deepEqual(restored, s);
});

test('场景补充：高频反向猛切进水/溢流会累积扰动并导致吊篮撞壁', () => {
  const s = ShaftSim.createState();
  const steps = Math.ceil(60 / C.DT);
  for (let i = 0; i < steps && s.status === 'running'; i++) {
    const drain = Math.floor(i / 4) % 2 === 1;
    ShaftSim.step(s, { inlet: drain ? 0 : 1, overflow: drain ? 1 : 0, brake: 0 });
  }
  assert.equal(s.status, 'failed');
  assert.equal(s.failReason, 'wall');
  assert.ok(Math.abs(s.tilt) >= C.TILT_LIMIT);
});

test('场景补充：从容的单阀操作不会因摆倾撞壁（扰动会衰减回稳）', () => {
  const s = ShaftSim.createState();
  // 每隔 2 秒才切换一次阀门，模拟有节奏的人工操作
  const steps = Math.ceil(120 / C.DT);
  let maxTilt = 0;
  for (let i = 0; i < steps && s.status === 'running'; i++) {
    const open = Math.floor(i / 120) % 2 === 0;
    ShaftSim.step(s, { inlet: open ? 0.4 : 0, overflow: open ? 0 : 0.4, brake: 0 });
    maxTilt = Math.max(maxTilt, Math.abs(s.tilt));
  }
  assert.equal(s.status, 'running');
  assert.ok(maxTilt < C.TILT_LIMIT, '从容操作的最大倾角必须低于撞壁阈值');
});
