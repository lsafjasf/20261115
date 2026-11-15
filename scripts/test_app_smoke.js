// 轻量 DOM 桩冒烟测试：验证 app.js 初始化、渲染与拦截路径，不依赖浏览器。
const fs = require('fs');
const path = require('path');

function makeElement(id) {
  const listeners = {};
  return {
    id,
    style: {},
    dataset: {},
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    className: '',
    children: [],
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatch(type, event = {}) {
      for (const fn of listeners[type] || []) fn({ stopPropagation() {}, ...event });
    },
    appendChild(child) { this.children.push(child); },
    querySelector(sel) {
      return makeElement(sel);
    },
    querySelectorAll() {
      const inputs = ['start', 'end', 'text'].map((field) => {
        const input = makeElement(`input-${field}`);
        input.dataset.field = field;
        return input;
      });
      return inputs;
    },
    getBoundingClientRect() { return { left: 0, width: 1000 }; },
  };
}

const ids = ['track', 'playhead', 'timeline', 'scrubber', 'readout',
  'preview-text', 'cue-rows', 'toast', 'btn-play', 'btn-add', 'btn-split',
  'btn-vtt', 'btn-wav', 'btn-json', 'btn-reload', 'file-json'];
const registry = new Map(ids.map((id) => [id, makeElement(id)]));

const sandbox = {
  console,
  setTimeout, clearTimeout, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  Blob: class { constructor(parts, options) { this.parts = parts; this.options = options; } },
  TextEncoder,
  URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() {} },
  document: {
    getElementById: (id) => registry.get(id) || makeElement(id),
    createElement: () => makeElement('dynamic'),
  },
};
sandbox.window = sandbox;
global.window = sandbox;

for (const file of ['studio_core.js', 'studio_audio.js', 'studio_export.js', 'app.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'web', file), 'utf8');
  new Function('StudioCore', `with (this) { ${code} }`).call(sandbox, sandbox.StudioCore);
}

const app = sandbox.StudioApp;
if (!app || app.project.cues.length !== 6) throw new Error('应用初始化后应含六条字幕');
console.log('  [通过] app.js 初始化，默认载入六条字幕');

let blocked = false;
try {
  app.project.updateCue(2, { start: 1000 });
} catch (error) {
  blocked = error.code === 'OVERLAP';
}
if (!blocked) throw new Error('重叠编辑未被阻止');
if (app.project.cues.length !== 6) throw new Error('拦截后字幕数量被改变');
console.log('  [通过] 重叠编辑被阻止且工程未被污染');

app.seek(3300);
const active = app.project.activeCueAt(3300);
if (!active || app.currentTimeMs !== 3300) throw new Error('seek 后播放头状态异常');
console.log(`  [通过] 播放头 seek 到 3300ms，当前文字: ${active.text}`);

app.commit('冒烟测试-断句', () => app.project.splitCue(1, 1500));
if (app.project.cues.length !== 7) throw new Error('断句后应为 7 条');
console.log('  [通过] 断句操作生效（6 -> 7 条），提交路径可正常重建音频状态');

console.log('\n前端冒烟测试全部通过 ✔');
