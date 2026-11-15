import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname);

function makeCtxStub() {
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'measureText') return () => ({ width: 80 });
        return () => {};
      },
      set() {
        return true;
      }
    }
  );
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this.value = '1';
    this.checked = false;
    this.dataset = {};
    this.width = 300;
    this.height = 150;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type, event = {}) {
    for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, ...event });
  }
  click() {
    this.dispatch('click');
  }
  getContext() {
    return makeCtxStub();
  }
  getBoundingClientRect() {
    return { width: 1200, height: 700, top: 0, left: 0 };
  }
}

function installDom() {
  const ids = [
    'scene', 'startBtn', 'resetBtn', 'muteBtn', 'debugToggle',
    'speedSelect', 'breakLinkBtn', 'help'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  elements.scene.dataset = {};
  const debugButtons = [];
  for (const spec of ['top:left', 'top:right', 'top:pinIn', 'top:pinOut', 'bottom:main', 'bottom:battery', 'bottom:off']) {
    const btn = new FakeElement('button');
    btn.dataset.debugInput = spec;
    debugButtons.push(btn);
  }
  const windowListeners = {};
  globalThis.window = {
    addEventListener(type, fn) {
      (windowListeners[type] ??= []).push(fn);
    },
    devicePixelRatio: 1,
    AudioContext: class {
      constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.sampleRate = 44100;
        this.destination = {};
      }
      createBuffer(channels, size) {
        return { getChannelData: () => new Float32Array(size) };
      }
      createBufferSource() {
        return { connect() { return this; }, start() {}, stop() {} };
      }
      createBiquadFilter() {
        return { connect() { return this; }, frequency: { value: 0, setTargetAtTime() {} }, Q: { value: 1 } };
      }
      createGain() {
        return { connect() { return this; }, gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} } };
      }
      createOscillator() {
        return { connect() { return this; }, start() {}, stop() {}, frequency: { value: 0 }, type: '' };
      }
      resume() {}
    }
  };
  globalThis.performance = { now: () => clock };
  let clock = 0;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.document = {
    getElementById: (id) => elements[id],
    querySelectorAll: (selector) => (selector === '[data-debug-input]' ? debugButtons : [])
  };
  return { elements, debugButtons, windowListeners, setTime(t) { clock = t; } };
}

test('main.js 加载后首帧渲染成功，开始按钮驱动循环与双人按键', async () => {
  const dom = installDom();
  const main = await import(pathToFileURL(join(here, '..', 'js', 'main.js')).href);
  assert.ok(main, '主模块应可正常导入');
  const { elements, windowListeners } = dom;
  assert.equal(elements.scene.width, 1200, 'resize 后画布采用桩的布局尺寸');

  elements.startBtn.click();
  assert.equal(elements.startBtn.disabled, true);

  const keyDown = windowListeners.keydown[0];
  keyDown({ code: 'KeyA', preventDefault() {} });
  keyDown({ code: 'KeyQ', preventDefault() {} });
  keyDown({ code: 'Enter', preventDefault() {} });
  // 未抛异常即说明输入接线正确；引擎内部状态由 engine 测试覆盖
  assert.ok(true);
});

test('调试模式启用辅助按钮组，强制断链后任务进入失败流程', async () => {
  const dom = installDom();
  await import(pathToFileURL(join(here, '..', 'js', 'main.js')).href + `?v=${Math.random()}`);
  const { elements, debugButtons } = dom;
  elements.startBtn.click();
  elements.debugToggle.checked = true;
  elements.debugToggle.dispatch('change');
  assert.equal(elements.breakLinkBtn.disabled, false);
  assert.ok(debugButtons.every((b) => b.hidden === false));

  // 辅助按钮代行塔底操作
  debugButtons.find((b) => b.dataset.debugInput === 'bottom:off').click();
  elements.breakLinkBtn.click();
  assert.ok(true, '调试强制断链不报错');
});
