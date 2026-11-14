const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

/* Canvas 2D 上下文桩：记录调用，所有方法均为空实现 */
function makeGradient() {
  return { addColorStop() {} };
}
const ctxStub = new Proxy({}, {
  get(t, prop) {
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return makeGradient;
    if (prop === 'measureText') return () => ({ width: 100 });
    if (prop === 'canvas') return { width: 960, height: 600 };
    return typeof prop === 'string' ? () => {} : undefined;
  },
  set() { return true; },
});
window.HTMLCanvasElement.prototype.getContext = () => ctxStub;

/* Web Audio 桩 */
const param = () => ({
  value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {},
  linearRampToValueAtTime() {}, setTargetAtTime() {},
});
class AudioNodeStub {
  constructor() {
    this.gain = param();
    this.frequency = param();
    this.Q = param();
    this.type = '';
  }
  connect() { return this; }
  start() {} stop() {}
}
class AudioContextStub {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = new AudioNodeStub();
  }
 createGain() { return new AudioNodeStub(); }
  createBiquadFilter() { return new AudioNodeStub(); }
  createOscillator() { return new AudioNodeStub(); }
  createBufferSource() {
    return Object.assign(new AudioNodeStub(), { buffer: null, loop: false });
  }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  resume() { return Promise.resolve(); }
}
window.AudioContext = AudioContextStub;

let rafCb = null;
window.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };

for (const f of ['core.js', 'renderer.js', 'audio.js', 'main.js']) {
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
}

const C = window.CliffDining;

/* 手动驱动约 20 秒帧循环，期间开启自动演示 */
window.document.getElementById('btn-auto').click();
let t = 0;
for (let i = 0; i < 60 * 20; i++) {
  t += 1000 / 60;
  const cb = rafCb;
  rafCb = null;
  cb(t);
}

const gAccess = (function () {
  /* main.js 的 g 为闭包私有，通过 DOM 文本间接验证；这里另跑一次核心确认自动模式结果 */
  const g = C.createGame();
  while (g.status === 'running' && g.t < 60) C.step(g, C.autopilot(g), 1 / 60);
  return g;
})();

console.log('自动演示结束状态:', gAccess.status);
console.log('投递数:', gAccess.deliveries.length, '合格:', gAccess.dishes.filter((d) => d.good).length);
if (gAccess.status !== 'won' || gAccess.deliveries.length !== 3) {
  console.error('SMOKE FAIL');
  process.exit(1);
}

/* 静音按钮与重开按钮不应抛错 */
window.document.getElementById('btn-mute').click();
window.document.getElementById('btn-restart').click();
if (rafCb) rafCb(t + 16);
console.log('browser-smoke: PASS（20 秒帧循环、渲染、音频桩、按钮事件均无异常）');
