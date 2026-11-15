// Headless smoke test: minimal DOM + Canvas stubs prove the UI wiring and
// renderers never throw for any of the four faults or recovery flows.
import assert from 'node:assert/strict';

const listeners = new Map();

function makeCtx() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (prop === 'measureText') return () => ({ width: 10 });
      return typeof prop === 'string' ? () => {} : undefined;
    },
    set() { return true; },
  });
}

class El {
  constructor(id = '', tag = 'div') {
    this.id = id; this.tagName = tag; this.children = []; this.dataset = {};
    this.style = {}; this._class = new Set(); this._html = ''; this.textContent = '';
    this.width = 300; this.height = 180; this.value = '500';
  }
  get className() { return [...this._class].join(' '); }
  set className(value) {
    this._class = new Set(String(value).split(' ').filter(Boolean));
  }
  get classList() {
    const set = this._class;
    return {
      add: (name) => set.add(name),
      remove: (name) => set.delete(name),
      toggle: (name, force) => {
        const should = force === undefined ? !set.has(name) : force;
        set[should ? 'add' : 'delete'](name);
        return should;
      },
      contains: (name) => set.has(name),
    };
  }
  addEventListener(type, fn) {
    const key = this.id || this.tagName;
    if (!listeners.has(key)) listeners.set(key, []);
    listeners.get(key).push([type, fn]);
  }
  dispatch(type, event = {}) {
    for (const [t, fn] of (listeners.get(this.id || this.tagName) || [])) {
      if (t === type) fn({ preventDefault() {}, ...event });
    }
  }
  appendChild(child) { this.children.push(child); return child; }
  querySelectorAll(sel) {
    if (sel === '.fault-chip') return this._chips || [];
    return [];
  }
  querySelector(sel) {
    if (sel === 'canvas.gauge') return this._gauge;
    if (sel === 'canvas.chart') return this._chart;
    return null;
  }
  set innerHTML(value) {
    this._html = value;
    if (this.className.includes('grid') || this.dataset.sensor) {
      this._chips = ['missing', 'spike', 'delay', 'out_of_order'].map((fault) => {
        const chip = new El('', 'button');
        chip.dataset.fault = fault; chip.className = 'fault-chip';
        return chip;
      });
      this._gauge = new El('', 'canvas');
      this._gauge.getContext = () => makeCtx();
      this._gauge.getBoundingClientRect = () => ({ width: 340, height: 190 });
      this._chart = new El('', 'canvas');
      this._chart.getContext = () => makeCtx();
      this._chart.getBoundingClientRect = () => ({ width: 340, height: 170 });
    }
  }
  get innerHTML() { return this._html; }
  click() { this.dispatch('click'); }
  getContext() { return makeCtx(); }
  getBoundingClientRect() { return { width: 340, height: 180 }; }
}

const sensorGrid = new El('sensorGrid');
const knownIds = ['errorBanner', 'sensorGrid', 'btnPause', 'btnStep', 'btnRecover', 'btnExport',
  'speedSel', 'runState', 'stepCount', 'simTime', 'logCount', 'alarmCount', 'alarmBody', 'logBody'];
const elements = new Map(knownIds.map((id) => [id, id === 'sensorGrid' ? sensorGrid : new El(id)]));

globalThis.window = {
  // Record handlers so the test can also fire simulated error events.
  _handlers: {},
  addEventListener(type, fn) { (this._handlers[type] ||= []).push(fn); },
  devicePixelRatio: 1,
  setInterval: (fn) => { const id = setInterval(fn, 10_000); id.unref?.(); return id; },
  clearInterval: (id) => clearInterval(id),
};
globalThis.document = {
  readyState: 'complete',
  getElementById: (id) => elements.get(id) || new El(id),
  querySelector: (sel) => {
    const match = /\[data-sensor="(s\d)"\]/.exec(sel);
    return match ? sensorGrid.children.find((card) => card.dataset.sensor === match[1]) : null;
  },
  createElement: (tag) => new El('', tag),
  querySelectorAll: (selector) => {
    if (selector === '.fault-chip.active') return [];
    return [];
  },
  addEventListener() {},
};
globalThis.Blob = class { constructor(parts, opts) { this.parts = parts; this.opts = opts; } };
globalThis.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };

await import('../src/app.js');

const banner = () => elements.get('errorBanner');
assert.notEqual(banner().style.display, 'block', `启动即报错: ${banner().textContent}`);
assert.equal(sensorGrid.children.length, 3, '应生成 3 张传感器卡片');
console.log('  ✓ 启动建卡、初始 tick 与 Canvas 渲染全部无异常');

for (const target of sensorGrid.children) {
  for (const chip of target._chips) chip.click();
}
assert.notEqual(banner().style.display, 'block', `故障注入报错: ${banner().textContent}`);
console.log('  ✓ 四类故障 × 三传感器通过界面点击注入，渲染不崩溃');

elements.get('btnPause').click();
assert.equal(elements.get('btnPause').textContent, '继续');
elements.get('btnStep').click();
const stepAfterStep = Number(elements.get('stepCount').textContent);
elements.get('btnStep').click();
assert.equal(Number(elements.get('stepCount').textContent), stepAfterStep + 1, '单步每次只推进一拍');
console.log('  ✓ 暂停与单步注入行为正确，暂停期间无自动推进');

let exported = null;
globalThis.Blob = class { constructor(parts) { exported = parts[0]; } };
elements.get('btnRecover').click();
elements.get('btnExport').click();
assert.ok(exported && exported.includes(',recover,'), '导出 CSV 必须包含 recover 记录');
assert.ok(exported.trim().split('\n').length > 5, '导出应包含完整故障日志');
assert.notEqual(banner().style.display, 'block', `恢复/导出报错: ${banner().textContent}`);
console.log('  ✓ 一键恢复与 CSV 导出正常，全程零未捕获异常');

// Prove the global guards themselves keep the app alive after a real thrown error event.
for (const fn of globalThis.window._handlers.error || []) {
  fn({ message: '模拟渲染异常', preventDefault() {} });
}
assert.equal(banner().style.display, 'block');
assert.ok(banner().textContent.includes('模拟渲染异常'));
assert.equal(sensorGrid.children.length, 3, '错误横幅出现后页面结构仍然完好');
console.log('  ✓ 全局 error 事件被捕获并提示，页面不崩溃');

console.log('\nUI 冒烟测试全部通过 ✔');
