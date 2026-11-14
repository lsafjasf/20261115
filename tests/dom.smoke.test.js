const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 极简浏览器环境桩：足以加载真实 sim/controller/audio/render/main 并驱动主循环
function createDomHarness() {
  const rafQueue = [];
  const listeners = {};
  const grad = { addColorStop() {} };
  const ctx2d = new Proxy({}, {
    get(t, prop) {
      if (prop === 'createLinearGradient') return () => grad;
      return () => (prop === 'measureText' ? { width: 1 } : undefined);
    },
    set() { return true; }
  });
  const elements = {};
  const makeEl = (id) => ({
    id, textContent: '', classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(ev, fn) { (this._h = this._h || {})[ev] = fn; },
    click() { this._h && this._h.click && this._h.click(); }
  });
  ['game', 'status', 'btnInlet', 'btnOverflow', 'btnBrake', 'btnPause',
   'btnReset', 'btnDemo', 'btnFail', 'btnWall', 'btnMute'].forEach((id) => { elements[id] = makeEl(id); });
  elements.game.width = 1000;
  elements.game.height = 640;
  elements.game.getContext = () => ctx2d;

  const sandbox = {
    console, Math, JSON, setInterval: () => 0, clearInterval() {},
    setTimeout: (fn) => 0,
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    document: {
      getElementById: (id) => elements[id],
      addEventListener: (ev, fn) => { listeners[ev] = fn; }
    }
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, rafQueue, listeners, elements };
}

test('真实浏览器脚本在 DOM 桩中可加载并驱动主循环、暂停、重置与自动演示', () => {
  const h = createDomHarness();
  ['js/sim.js', 'js/controller.js', 'js/audio.js', 'js/render.js', 'js/main.js'].forEach((f) => {
    assert.doesNotThrow(
      () => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), h.sandbox, { filename: f }),
      `加载 ${f} 失败`
    );
  });

  const game = h.sandbox.window.__game;
  assert.ok(game, 'main.js 应暴露调试句柄 __game');

  for (let f = 0; f < 120; f++) h.rafQueue.shift()(f * 16.7);
  assert.equal(game.state.status, 'running');

  // 自动演示：推进主循环直到胜利
  h.elements.btnDemo.click();
  let frames = 0;
  while (game.state.status === 'running' && frames < 40000) {
    h.rafQueue.shift()(frames * 16.7);
    frames++;
  }
  assert.equal(game.state.status, 'won');
  assert.equal(game.state.delivered, 3);

  // 重置 -> 暂停冻结 -> 恢复
  h.elements.btnReset.click();
  assert.equal(game.state.delivered, 0);
  h.listeners.keydown({ code: 'Space', preventDefault() {} });
  assert.equal(game.state.paused, true);
  const frozen = JSON.stringify(game.state);
  for (let f = 0; f < 60; f++) h.rafQueue.shift()(f * 16.7);
  assert.equal(JSON.stringify(game.state), frozen);
  h.listeners.keydown({ code: 'Space', preventDefault() {} });
  assert.equal(game.state.paused, false);

  // 过压失败演示
  h.elements.btnFail.click();
  frames = 0;
  while (game.state.status === 'running' && frames < 3000) {
    h.rafQueue.shift()(frames * 16.7);
    frames++;
  }
  assert.equal(game.state.status, 'failed');
  assert.equal(game.state.failReason, 'rupture');

  // 失衡撞壁演示
  h.elements.btnWall.click();
  frames = 0;
  while (game.state.status === 'running' && frames < 6000) {
    h.rafQueue.shift()(frames * 16.7);
    frames++;
  }
  assert.equal(game.state.status, 'failed');
  assert.equal(game.state.failReason, 'wall');
});
