// 冒烟测试：用 DOM 桩加载 main.js，跑若干帧，验证装配无误
const ctxStub = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : () => ctxStub),
  set: (t, k, v) => { t[k] = v; return true; },
});

function makeEl() {
  return {
    width: 960, height: 720,
    disabled: false, checked: true, value: '20',
    textContent: '', innerHTML: '', className: '', title: '',
    style: {},
    addEventListener() {},
    appendChild() {},
    getContext: () => ctxStub,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }),
    click() {},
  };
}

const els = new Map();
globalThis.document = {
  getElementById(id) {
    if (!els.has(id)) els.set(id, makeEl());
    return els.get(id);
  },
  createElement: () => makeEl(),
};
globalThis.window = globalThis;

let frames = 0;
globalThis.requestAnimationFrame = (cb) => {
  if (frames++ < 5) setImmediate(() => cb(performance.now()));
};

await import('../js/main.js');
await new Promise((r) => setTimeout(r, 50));
console.log(`SMOKE_OK frames=${frames}`);
if (frames < 2) process.exit(1);
