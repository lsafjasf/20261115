/* 零依赖 DOM/Canvas 桩：在 Node 中加载真实 app.js，冒烟测试 UI 交互链路 */
'use strict';

const fs = require('fs');
const path = require('path');

function makeCtx2d() {
  const noop = function () {};
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'getImageData') {
        return function (x, y, w, h) {
          return { data: new Uint8ClampedArray(w * h * 4) };
        };
      }
      if (prop === 'measureText') return function () { return { width: 0 }; };
      if (prop === 'canvas') return { width: 900, height: 620 };
      return typeof prop === 'string' ? noop : undefined;
    },
    set() { return true; },
  });
}

function makeElement(id) {
  const listeners = {};
  return {
    id,
    value: '0',
    textContent: '',
    className: '',
    style: {},
    children: [],
    width: 900,
    height: 620,
    getContext: function () { return makeCtx2d(); },
    addEventListener: function (evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
    },
    getBoundingClientRect: function () {
      return { left: 0, top: 0, width: 900, height: 620 };
    },
    prepend: function (child) { this.children.unshift(child); },
    removeChild: function (child) {
      this.children = this.children.filter(function (c) { return c !== child; });
    },
    _emit: function (evt, payload) {
      (listeners[evt] || []).forEach(function (fn) { fn(payload || { target: this }); }, this);
    },
  };
}

const ids = [
  'pressCanvas', 'dxSlider', 'dySlider', 'redSlider', 'blueSlider',
  'dxVal', 'dyVal', 'redVal', 'blueVal', 'reprintBtn', 'reprintOnlyBtn',
  'undoBtn', 'resetBtn', 'autoBtn', 'soundBtn', 'mX', 'mY', 'mRed',
  'mBlue', 'mGhost', 'mVerdict', 'streakText', 'streakBar', 'eventLog',
  'statusPill',
];
const registry = {};
ids.forEach(function (id) { registry[id] = makeElement(id); });
registry.redSlider.value = '0.78';
registry.blueSlider.value = '1.24';

global.document = {
  getElementById: function (id) {
    if (!registry[id]) registry[id] = makeElement(id);
    return registry[id];
  },
  createElement: function (tag) {
    const el = makeElement('dynamic-' + tag);
    el.tag = tag;
    return el;
  },
};
global.window = global;
global.AudioContext = function () {
  return {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    resume: function () {},
    createOscillator: function () {
      return {
        type: '', frequency: { setValueAtTime: function () {} },
        connect: function () { return this; },
        start: function () {}, stop: function () {},
      };
    },
    createGain: function () {
      return { gain: { setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} },
        connect: function () { return this; } };
    },
    createBuffer: function (ch, len) { return { getChannelData: function () { return new Float32Array(len); } }; },
    createBufferSource: function () {
      return { buffer: null, connect: function () { return this; }, start: function () {} };
    },
    createBiquadFilter: function () {
      return { type: '', frequency: { value: 0 }, connect: function () { return this; } };
    },
  };
};
global.setTimeout = function (fn) { return 0; };
global.setInterval = function () { return 0; };

global.PrintSim = require(path.join(__dirname, '..', 'engine'));
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
new Function(appSource)();

const assert = require('assert');
const findLog = function (re) {
  return registry.eventLog.children.some(function (c) { return re.test(c.textContent); });
};
assert.strictEqual(registry.statusPill.textContent, '待印刷');
assert.ok(registry.eventLog.children.length >= 1);

/* 模拟用户：先在无修正时点重印（应被拒绝），再做一次修正重印 */
registry.reprintBtn._emit('click');
const logAfterNoop = registry.eventLog.children.length;

registry.dxSlider.value = '-200';
registry.dxSlider._emit('input', { target: registry.dxSlider });
registry.dySlider.value = '130';
registry.dySlider._emit('input', { target: registry.dySlider });
registry.redSlider.value = '1.0';
registry.redSlider._emit('input', { target: registry.redSlider });
registry.blueSlider.value = '1.0';
registry.blueSlider._emit('input', { target: registry.blueSlider });
registry.reprintBtn._emit('click');

assert.ok(registry.eventLog.children.length > logAfterNoop, '修正重印应写日志');
assert.strictEqual(registry.undoBtn.disabled, false, '修正后撤销按钮应可用');
assert.ok(findLog(/第1张/));

/* 仅重印与撤销 */
registry.reprintOnlyBtn._emit('click');
assert.ok(findLog(/第2张/));
const beforeUndo = registry.mX.textContent;
registry.undoBtn._emit('click');
assert.ok(findLog(/第3张/), '撤销后应重印第 3 张');
assert.ok(findLog(/套偏重新出现/), '撤销后应提示套偏复现');
assert.notStrictEqual(registry.mX.textContent, beforeUndo);

/* 重置 */
registry.resetBtn._emit('click');
assert.strictEqual(registry.statusPill.textContent, '待印刷');
assert.strictEqual(registry.undoBtn.disabled, true);

/* 鼠标移动放大镜不报错 */
registry.pressCanvas._emit('mousemove', { clientX: 100, clientY: 100 });
registry.pressCanvas._emit('mouseleave');

console.log('DOM 冒烟测试通过 ✔  日志条数=' + registry.eventLog.children.length);
