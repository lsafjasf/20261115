const assert = require('assert');
const fs = require('fs');
const path = require('path');

function makeElement(id) {
  return {
    id: id,
    innerHTML: '',
    value: '',
    disabled: false,
    hidden: false,
    files: [],
    listeners: {},
    style: {},
    width: 1000,
    height: 560,
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    dispatch(type, event) {
      (this.listeners[type] || []).forEach((fn) => fn(event || {}));
    },
    querySelectorAll() {
      return this._inputs || [];
    },
    click() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1000, height: 560 };
    },
    getContext() {
      return new Proxy({}, {
        get(target, prop) {
          if (prop === 'measureText') return () => ({ width: 10 });
          return typeof prop === 'string' ? function () {} : undefined;
        },
        set() {
          return true;
        }
      });
    }
  };
}

const elements = {};
const registry = {
  window: {
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    dispatch(type, event) {
      (this.listeners[type] || []).forEach((fn) => fn(event || {}));
    }
  },
  document: {
    getElementById(id) {
      return elements[id] || (elements[id] = makeElement(id));
    },
    createElement() {
      return makeElement('dynamic');
    },
    addEventListener(type, fn) {
      (this.listeners = this.listeners || {});
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    dispatch(type, event) {
      (this.listeners[type] || []).forEach((fn) => fn(event || {}));
    }
  },
  Blob: function (parts) { this.parts = parts; },
  URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
  fetch(url) {
    const file = path.join(__dirname, '..', url);
    return Promise.resolve({
      json: () => Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8')))
    });
  }
};

global.window = registry.window;
global.document = registry.document;
global.Blob = registry.Blob;
global.URL = registry.URL;
global.fetch = registry.fetch;

global.self = global;
global.HydraulicEngine = require('../js/engine.js');
global.History = require('../js/history.js');
global.Renderer = require('../js/renderer.js');

const appSource = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
eval(appSource);

const Engine = require('../js/engine.js');

setTimeout(() => {
  const app = global.window.App;
  let passed = 0;
  const check = (name, condition) => {
    assert.ok(condition, name);
    passed += 1;
    console.log('  ✓ ' + name);
  };

  console.log('UI 交互冒烟测试');
  const initial = app.currentPlan();
  check('启动后自动载入示例方案', initial.nodes.length === 8);
  const initialReport = Engine.analyze(initial);
  check('初始方案无负压', !initialReport.hasNegativePressure);

  const canvas = elements.canvas;
  const j1 = { x: 340, y: 180 };
  canvas.dispatch('mousedown', { clientX: j1.x, clientY: j1.y });
  canvas.dispatch('mousemove', { clientX: j1.x + 100, clientY: j1.y + 40 });
  registry.window.dispatch('mouseup', {});

  const afterDrag = app.currentPlan();
  const moved = afterDrag.nodes.find((n) => n.id === 'J1');
  check('拖拽节点后坐标更新', moved.x === j1.x + 100 && moved.y === j1.y + 40);

  const p6LossBeforeUndo = Engine.analyze(afterDrag)
    .solution.edges.find((e) => e.id === 'P1').headLoss;
  check('拖拽后管长变化触发水头重算',
    Math.abs(p6LossBeforeUndo -
      initialReport.solution.edges.find((e) => e.id === 'P1').headLoss) > 1e-9);

  registry.document.dispatch('keydown', {
    key: 'z', ctrlKey: true, shiftKey: false,
    preventDefault: () => {}
  });
  const restored = app.currentPlan();
  const restoredJ1 = restored.nodes.find((n) => n.id === 'J1');
  check('Ctrl+Z 撤销后节点坐标恢复',
    restoredJ1.x === j1.x && restoredJ1.y === j1.y);
  const restoredReport = Engine.analyze(restored);
  check('撤销后流量自动重算并恢复',
    Math.abs(restoredReport.solution.edges.find((e) => e.id === 'P1').headLoss -
      initialReport.solution.edges.find((e) => e.id === 'P1').headLoss) < 1e-12);

  registry.document.dispatch('keydown', {
    key: 'y', ctrlKey: true, shiftKey: false,
    preventDefault: () => {}
  });
  const redone = app.currentPlan();
  const redoneJ1 = redone.nodes.find((n) => n.id === 'J1');
  check('Ctrl+Y 重做后节点再次移动',
    redoneJ1.x === j1.x + 100 && redoneJ1.y === j1.y + 40);

  const fresh = JSON.parse(JSON.stringify(redone));
  fresh.nodes.find((n) => n.id === 'J1').x = 340;
  fresh.nodes.find((n) => n.id === 'J1').y = 180;
  app.commit(fresh);
  const p3 = fresh.edges.find((e) => e.id === 'P3');
  const j2 = fresh.nodes.find((n) => n.id === 'J2');
  const j2Base = { x: j2.x, y: j2.y };
  const mid = {
    x: (340 + j2.x) / 2,
    y: (180 + j2.y) / 2
  };
  canvas.dispatch('mousedown', { clientX: mid.x, clientY: mid.y });
  canvas.dispatch('mousemove', { clientX: mid.x + 30, clientY: mid.y - 20 });
  registry.window.dispatch('mouseup', {});
  const afterEdgeDrag = app.currentPlan();
  const movedJ1 = afterEdgeDrag.nodes.find((n) => n.id === 'J1');
  const movedJ2 = afterEdgeDrag.nodes.find((n) => n.id === 'J2');
  check('拖拽管段中点可整体平移两端节点',
    movedJ1.x === 370 && movedJ1.y === 160 &&
    movedJ2.x === j2Base.x + 30 && movedJ2.y === j2Base.y - 20);
  registry.document.dispatch('keydown', {
    key: 'z', ctrlKey: true, shiftKey: false,
    preventDefault: () => {}
  });

  const p6 = redone.edges.find((e) => e.id === 'P6');
  app.selected = { kind: 'edge', id: 'P6' };
  app.renderAll();
  const beforeVelocity = Engine.analyze(redone)
    .solution.edges.find((e) => e.id === 'P6').velocity;
  const plan = JSON.parse(JSON.stringify(redone));
  plan.edges.find((e) => e.id === 'P6').diameter = 0.06;
  app.commit(plan);
  const afterVelocity = Engine.analyze(app.currentPlan())
    .solution.edges.find((e) => e.id === 'P6').velocity;
  check('修改管径后流速立即重算',
    Math.abs(afterVelocity - beforeVelocity) > 0.5);
  check('小管径触发高流速告警',
    Engine.analyze(app.currentPlan()).issues.some((i) => i.type === 'high-velocity'));

  const json = JSON.stringify(app.currentPlan());
  check('方案可导出为合法 JSON 且包含 8 条管段',
    JSON.parse(json).edges.length === 8);

  console.log('\n通过 ' + passed + ' 项 UI 冒烟测试');
}, 0);
