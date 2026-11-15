'use strict';

var core = require('../js/core.js');

function makeCtx() {
  var noop = function () {};
  return {
    canvas: null,
    imageSmoothingEnabled: true,
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    createImageData: function (w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData: noop,
    drawImage: noop,
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    clip: noop,
    setLineDash: noop,
    createLinearGradient: function () {
      return { addColorStop: noop };
    },
    measureText: function () {
      return { width: 0 };
    }
  };
}

var listeners = {};

function makeElement(id, tag) {
  var el = {
    id: id,
    tagName: tag || 'div',
    width: 300,
    height: 150,
    value: '',
    hidden: false,
    dataset: {},
    children: [],
    style: {},
    classList: {
      _set: {},
      add: function (c) { this._set[c] = true; },
      remove: function (c) { delete this._set[c]; },
      toggle: function (c, on) { this._set[c] = !!on; },
      contains: function (c) { return !!this._set[c]; }
    },
    innerHTML: '',
    textContent: '',
    getContext: function () {
      var c = makeCtx();
      c.canvas = el;
      return c;
    },
    addEventListener: function (type, fn) {
      listeners[id + ':' + type] = fn;
    },
    setPointerCapture: function () {},
    releasePointerCapture: function () {},
    getBoundingClientRect: function () {
      return { left: 0, top: 0, width: core.WORLD_W, height: core.WORLD_H };
    },
    toBlob: function (cb) {
      cb({ size: 1 });
    },
    click: function () {},
    appendChild: function () {},
    removeChild: function () {}
  };
  return el;
}

var elementIds = [
  'scene', 'seed', 'seedVal', 'density', 'densityVal', 'aspect', 'aspectVal',
  'wind', 'windVal', 'seasonRow', 'roadWidth', 'roadWidthVal', 'stats',
  'screenshot', 'save', 'restore', 'reset', 'exportBtn', 'importFile', 'toast'
];
var elements = {};
elementIds.forEach(function (id) {
  elements[id] = makeElement(id, id === 'scene' ? 'canvas' : 'div');
});
['spring', 'summer', 'autumn', 'winter'].forEach(function (s) {
  var btn = makeElement('season-' + s, 'button');
  btn.dataset.season = s;
  elements.seasonRow.children.push(btn);
});

var rafQueue = [];
var store = {};

global.window = global;
global.self = global;
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
global.requestAnimationFrame = function (fn) {
  rafQueue.push(fn);
  return rafQueue.length;
};
global.performance = { now: function () { return 1000; } };
global.document = {
  getElementById: function (id) {
    return elements[id] || null;
  },
  createElement: function (tag) {
    return makeElement('created-' + tag, tag);
  },
  body: makeElement('body')
};
global.Blob = global.Blob || function (parts, opts) {
  this.parts = parts;
  this.type = opts && opts.type;
};
global.URL = global.URL || {};
global.URL.createObjectURL = function () { return 'blob:stub'; };
global.URL.revokeObjectURL = function () {};

global.MeadowCore = require('../js/core.js');
require('../js/app.js');

var failures = [];
function assert(name, cond, detail) {
  console.log('[' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (detail ? ' -> ' + detail : ''));
  if (!cond) {
    failures.push(name);
  }
}

var meadow = window.__meadow;
assert('app.js 初始化并暴露调试句柄', !!meadow);
assert('初始场景生成了树木与草丛',
  meadow.scene.trees.length > 100 && meadow.scene.grass.length > 1000,
  '树=' + meadow.scene.trees.length + ' 草=' + meadow.scene.grass.length);

var beforePositions = meadow.scene.trees.map(function (t) {
  return t.x + ',' + t.y + ',' + t.kind;
});

var winterBtn = elements.seasonRow.children[3];
listeners['season-winter:click']();
assert('季节按钮可切换到冬季', meadow.params.season === 'winter');
var afterPositions = meadow.scene.trees.map(function (t) {
  return t.x + ',' + t.y + ',' + t.kind;
});
assert('DOM 流程下季节切换不改变植物位置',
  JSON.stringify(beforePositions) === JSON.stringify(afterPositions),
  '树数=' + afterPositions.length);

var initialTreeCount = meadow.scene.trees.length;
var moveNode = 2;
var target = { x: 260, y: 180 };
listeners['scene:pointerdown']({
  clientX: meadow.params.road.points[moveNode].x,
  clientY: meadow.params.road.points[moveNode].y,
  pointerId: 1
});
listeners['scene:pointermove']({ clientX: target.x, clientY: target.y, pointerId: 1 });
listeners['scene:pointerup']({ clientX: target.x, clientY: target.y, pointerId: 1 });

assert('模拟拖动后道路节点坐标已更新',
  meadow.params.road.points[moveNode].x === target.x &&
  meadow.params.road.points[moveNode].y === target.y);

var roadViolations = meadow.scene.trees.filter(function (t) {
  return core.isOnRoad(t.x, t.y, meadow.params.road);
});
var grassViolations = meadow.scene.grass.filter(function (g) {
  return core.isOnRoad(g.x, g.y, meadow.params.road);
});
assert('DOM 模拟拖动道路后没有树落在路面上',
  roadViolations.length === 0, '压线树=' + roadViolations.length);
assert('DOM 模拟拖动道路后没有草丛落在路面上',
  grassViolations.length === 0, '压线草丛=' + grassViolations.length);
assert('拖动触发了受影响区域重算',
  meadow.scene.trees.length !== initialTreeCount,
  '拖动前=' + initialTreeCount + '，拖动后=' + meadow.scene.trees.length);

listeners['save:click']();
assert('保存参数写入 localStorage', !!store['meadow-params-v1']);
listeners['reset:click']();
assert('重置恢复默认 seed', meadow.params.seed === core.defaultParams().seed);
listeners['restore:click']();
assert('从 localStorage 恢复到拖动后的道路',
  meadow.params.road.points[moveNode].x === target.x &&
  meadow.params.road.points[moveNode].y === target.y);

var frames = 0;
while (rafQueue.length && frames < 3) {
  var fn = rafQueue.shift();
  fn(2000 + frames * 16);
  frames++;
}
assert('动画循环可连续渲染多帧', frames === 3, '渲染帧数=' + frames);

if (failures.length) {
  console.error('\nDOM 冒烟测试失败: ' + failures.join('; '));
  process.exit(1);
}
console.log('\nDOM/Canvas 冒烟测试全部通过 ✔');
