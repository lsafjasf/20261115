/* 无头冒烟测试：DOM/Canvas 桩加载 game.js，跑若干帧确认无运行时错误 */
"use strict";

function makeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => grad;
      if (k === "measureText") return () => ({ width: 0 });
      if (typeof t[k] !== "undefined") return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeEl(tag) {
  const el = {
    tagName: tag, children: [], style: {}, dataset: {}, classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    textContent: "", className: "", innerHTML: "",
    width: 800, height: 600, clientWidth: 800, clientHeight: 600,
    scrollTop: 0, scrollHeight: 0, firstChild: null,
    getContext: () => makeCtx(),
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); this.firstChild = this.children[0]; return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); },
    querySelectorAll: () => [],
    parentElement: null,
  };
  return el;
}

const els = {};
const ids = ["sea", "panel", "time", "wind", "power", "peaks", "soc", "socbar",
  "health", "healthbar", "batkw", "batbar", "turbines", "chart", "log",
  "banner", "restart", "mute"];
ids.forEach(id => { els[id] = makeEl(id === "sea" || id === "chart" ? "canvas" : "div"); });

global.window = {
  addEventListener() {},
  WindSim: undefined,
};
global.document = {
  getElementById: id => els[id] || (els[id] = makeEl("div")),
  createElement: tag => makeEl(tag),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
};
let rafCb = null;
global.requestAnimationFrame = cb => { rafCb = cb; };
global.self = global;

global.window.WindSim = require("./sim.js");
require("./game.js");

// 手动驱动 200 帧（每帧 16ms），覆盖完整的 UI 渲染路径
let ts = 0;
for (let i = 0; i < 200; i++) {
  ts += 16;
  const cb = rafCb; rafCb = null;
  cb(ts);
}
console.log("SMOKE_OK: game.js 运行 200 帧无异常");
