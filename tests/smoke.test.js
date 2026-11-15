import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM / WebGL stubs: enough to exercise the full app wiring without
// a browser. Real rendering correctness is covered by the algorithm tests.
function makeContext() {
  const store = new Map();
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, DYNAMIC_DRAW: 8,
    TRIANGLES: 9, UNSIGNED_SHORT: 10, FLOAT: 11, DEPTH_TEST: 12,
    DEPTH_COMPONENT: 13, UNSIGNED_SHORT: 14, COLOR_BUFFER_BIT: 16,
    DEPTH_BUFFER_BIT: 32, BLEND: 64, SRC_ALPHA: 65, ONE_MINUS_SRC_ALPHA: 66,
    NO_ERROR: 0,
    createShader: () => ({}), shaderSource() {}, compileShader() {},
    getShaderParameter: () => true, getShaderInfoLog: () => '',
    createProgram: () => ({}), attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, getProgramInfoLog: () => '',
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {},
    getUniformLocation: () => ({}), getAttribLocation: () => 0,
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    uniformMatrix4fv() {}, uniform4f() {}, useProgram() {},
    enable() {}, disable() {}, blendFunc() {}, depthMask() {},
    viewport() {}, clear() {}, clearColor() {}, drawArrays() {}, drawElements() {},
    readPixels(target, ...args) {
      const view = args[args.length - 1];
      view[0] = 0.5;
    },
    getError: () => 0,
  };
}

function makeCanvas(contextType) {
  const listeners = new Map();
  return {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    listeners,
    getContext: () => (contextType === 'webgl' ? makeContext() : {
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      arc() {}, fill() {}, fillText() {}, measureText: () => ({ width: 40 }),
      closePath() {}, arcTo() {}, strokeRect() {}, fillRect() {},
    }),
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
}

function makeUI() {
  const listeners = new Map();
  const element = () => ({
    textContent: '',
    value: '0.5',
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
  });
  const ui = {
    threshold: element(),
    thresholdValue: element(),
    metrics: element(),
    sweepLog: element(),
    exportSVG: element(),
    exportPNG: element(),
    autoRotate: element(),
    sweep: element(),
    reset: element(),
  };
  return { ui, fire: (name, type, event) => ui[name].listeners?.get(type)?.(event) };
}

test('full app lifecycle runs without throwing under DOM stubs', async () => {
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.performance = { now: () => Date.now() };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.Blob = class {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options?.type;
    }
  };
  globalThis.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL() {} };
  globalThis.document = {
    createElement: () => ({
      click() {},
      getContext: () => ({
        scale() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {},
        lineTo() {}, closePath() {}, fill() {}, stroke() {},
        toBlob: (resolve) => resolve(new globalThis.Blob([], { type: 'image/png' })),
      }),
      width: 0,
      height: 0,
    }),
    body: { appendChild() {}, removeChild() {} },
  };

  const { createApp, CONTOUR_LEVELS } = await import('../src/app.js');
  const glCanvas = makeCanvas('webgl');
  const overlayCanvas = makeCanvas('2d');
  const { ui } = makeUI();
  const app = createApp({ glCanvas, overlayCanvas, ui });

  assert.equal(app.state.activeContour.level, 0.5);
  assert.ok(app.state.activeContour.chains.length > 0);
  app.updateThreshold(0.12);
  assert.equal(app.state.threshold, 0.12);
  app.updateThreshold(0.93);
  assert.ok(app.state.metrics.triangles >= 0);
  app.updateThreshold(2);
  assert.equal(app.state.threshold, 1);
  app.updateThreshold(0.5);
  assert.equal(CONTOUR_LEVELS.length, 9);
});
