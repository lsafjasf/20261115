import assert from "node:assert/strict";

class FakeContext {
  constructor() {
    this.calls = [];
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) return target[prop];
        target[prop] = () => {};
        return target[prop];
      },
    });
  }
  createLinearGradient() {
    return { addColorStop() {} };
  }
}

const handlers = new Map();
const elements = new Map();

function makeElement(id) {
  return {
    id,
    value: "0",
    width: 720,
    height: 480,
    disabled: false,
    style: {},
    classList: { toggle() {}, add() {} },
    innerHTML: "",
    textContent: "",
    files: [],
    getContext: () => new FakeContext(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 480 }),
    addEventListener(type, fn) {
      handlers.set(`${id}:${type}`, fn);
    },
    appendChild() {},
    click() {},
  };
}

const ids = [
  "sceneCanvas", "chartCanvas", "curveCanvas", "modeBadge", "boomSlider", "cableSlider",
  "brakeSlider", "boomVal", "cableVal", "brakeVal", "statusValue", "timeValue",
  "speedValue", "tensionValue", "airValue", "maxTensionValue", "eventLog",
  "recordBtn", "playBtn", "pauseBtn", "stepBtn", "resetBtn", "exportBtn", "importBtn",
  "fileInput", "addPointBtn", "resetCurveBtn", "runDemoBtn", "overloadBtn", "collisionBtn",
];
for (const id of ids) elements.set(id, makeElement(id));

globalThis.document = {
  getElementById: (id) => elements.get(id),
  createElement: () => makeElement("dynamic"),
};
globalThis.window = {
  addEventListener() {},
  AudioContext: class {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
    }
    createOscillator() {
      const node = {
        type: "",
        frequency: { value: 0, setTargetAtTime() {} },
        connect() {
          return node;
        },
        start() {},
        stop() {},
      };
      return node;
    }
    createGain() {
      const node = {
        gain: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {
          return node;
        },
      };
      return node;
    }
    resume() {
      return Promise.resolve();
    }
  },
};
globalThis.requestAnimationFrame = () => 0;
globalThis.Blob = class {};
globalThis.URL = { createObjectURL: () => "", revokeObjectURL() {} };

await import("../src/main.js");

const runDemo = handlers.get("runDemoBtn:click");
assert.equal(typeof runDemo, "function");
runDemo();
assert.equal(elements.get("modeBadge").textContent, "回放模式");

const pause = handlers.get("pauseBtn:click");
const step = handlers.get("stepBtn:click");
pause();
const beforeLabel = elements.get("timeValue").textContent;
for (let i = 0; i < 3; i++) step();
const afterLabel = elements.get("timeValue").textContent;
assert.notEqual(afterLabel, beforeLabel, "单帧推进应刷新仿真时间显示");
const afterTime = Number.parseFloat(afterLabel);
assert.ok(afterTime >= 2 / 60 && afterTime <= 3 / 60 + 0.01, "每次单帧只推进固定步长");

const addPoint = handlers.get("addPointBtn:click");
assert.doesNotThrow(() => addPoint());
console.log("  ✓ 主控制器集成测试通过：DOM 装配、载入记录、暂停与单帧推进正常");
