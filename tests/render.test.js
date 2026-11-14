const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ShaftSim = require('../js/sim.js');
const { createController, decide } = require('../js/controller.js');

// 构造无操作的 2D 上下文桩，记录调用以验证渲染路径被覆盖
function createCtxStub() {
  const calls = [];
  const grad = { addColorStop() {} };
  const handler = {
    get(target, prop) {
      if (prop === 'createLinearGradient') return () => grad;
      if (prop === 'canvas') return { width: 1000, height: 640 };
      return function (...args) {
        calls.push(prop);
        if (prop === 'measureText') return { width: 10 };
      };
    },
    set() { return true; }
  };
  return { ctx: new Proxy({}, handler), calls };
}

function loadRenderer() {
  const code = fs.readFileSync(path.join(__dirname, '../js/render.js'), 'utf8');
  const sandbox = { self: {} };
  const fn = new Function('self', code);
  fn(sandbox.self);
  return sandbox.self.ShaftRenderer;
}

test('渲染器在各种游戏状态下均能完整绘制且不抛异常', () => {
  const Renderer = loadRenderer();
  const C = ShaftSim.CONFIG;
  const states = [];

  const running = ShaftSim.createState();
  const ctrl = createController();
  for (let i = 0; i < 600; i++) ShaftSim.step(running, decide(ctrl, running));
  states.push(['运行中', running]);

  const paused = ShaftSim.snapshot(running);
  ShaftSim.setPaused(paused, true);
  states.push(['暂停', paused]);

  const rupture = ShaftSim.createState();
  for (let i = 0; i < 2000 && rupture.status === 'running'; i++) {
    ShaftSim.step(rupture, { inlet: 1, overflow: 0, brake: 0 });
  }
  states.push(['裂管失败', rupture]);

  const won = ShaftSim.createState();
  const ctrl2 = createController();
  while (won.status === 'running' && won.time < 500) ShaftSim.step(won, decide(ctrl2, won));
  states.push(['胜利', won]);

  for (const [name, st] of states) {
    const { ctx, calls } = createCtxStub();
    const canvas = { width: 1000, height: 640, getContext: () => ctx };
    const renderer = new Renderer(canvas);
    assert.doesNotThrow(() => renderer.draw(st, C, ShaftSim.metrics(st)), `${name} 渲染失败`);
    assert.ok(calls.includes('fillRect') && calls.includes('beginPath'), `${name} 缺少基础绘制调用`);
  }

  assert.equal(rupture.status, 'failed');
  assert.equal(rupture.failReason, 'rupture');
  assert.equal(won.status, 'won');
  assert.equal(won.delivered, 3);
});
