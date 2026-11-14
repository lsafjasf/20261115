// UI 冒烟测试：用 DOM/Canvas/Audio 桩在 Node 中跑通 ui.js 主循环
const fs = require('fs');

function anyProxy() {
  const f = function () { return p; };
  const p = new Proxy(f, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : p),
    set: () => true,
    apply: () => p,
  });
  return p;
}
const ctx2d = anyProxy();

function makeEl(id) {
  return {
    id, textContent: '', innerHTML: '', disabled: false, onclick: null,
    width: 920, height: 560, scrollTop: 0, dataset: {},
    _classes: new Set(),
    classList: {
      toggle(c) {}, remove(c) {},
      add(c) { this._owner && this._owner._classes.add(c); },
    },
    getContext: () => ctx2d,
    querySelector: () => makeEl('q'),
  };
}
const els = {};
function getEl(id) {
  if (!els[id]) {
    els[id] = makeEl(id);
    els[id].classList._owner = els[id];
  }
  return els[id];
}
const valves = [0, 1, 2].map(i => { const e = makeEl('v' + i); e.dataset.i = i; return e; });

global.document = {
  getElementById: getEl,
  querySelectorAll: sel => (sel === '.btnValve' ? valves : []),
};

function audioNode() {
  return {
    connect: n => n, start() {}, stop() {},
    gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    frequency: { value: 0, setTargetAtTime() {} },
    type: '', buffer: null, loop: false,
  };
}
global.window = {
  AudioContext: function () {
    return {
      currentTime: 0, state: 'running', sampleRate: 8000, destination: {},
      resume() {},
      createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
      createBufferSource: audioNode, createBiquadFilter: audioNode,
      createGain: audioNode, createOscillator: audioNode,
    };
  },
  addEventListener() {},
};
global.self = global.window;

let rafCb = null;
global.requestAnimationFrame = cb => { rafCb = cb; };

global.GreenhouseSim = require('./sim.js');
eval(fs.readFileSync('./ui.js', 'utf8'));

// 点击“开始”，跑 400 帧（模拟推进 + 渲染 + 音频更新）
els['start'].onclick();
let ts = 0;
for (let i = 0; i < 400; i++) { ts += 16.7; const cb = rafCb; rafCb = null; cb(ts); }
// 触发各控件与一次检修
els['btnFan'].onclick(); els['btnFanSpd'].onclick(); els['btnCurtain'].onclick();
valves[0].onclick(); els['btnMaint'].onclick();
for (let i = 0; i < 400; i++) { ts += 16.7; const cb = rafCb; rafCb = null; cb(ts); }

// 无人值守继续跑到模拟结束，验证结算横幅出现
for (let i = 0; i < 12000 && !els['banner']._classes.has('show'); i++) {
  ts += 16.7; const cb = rafCb; rafCb = null; cb(ts);
}
const shown = els['banner']._classes.has('show');
console.log('UI 冒烟测试：800 帧交互无异常；结算横幅' + (shown ? '已弹出' : '未弹出') +
  '（' + els['banner'].querySelector('.big').textContent + '）');
if (!shown) { console.log('FAIL: 模拟结束后未显示结算横幅'); process.exit(1); }
console.log('UI 冒烟测试通过 ✔');
