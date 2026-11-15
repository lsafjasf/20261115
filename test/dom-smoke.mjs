import assert from "node:assert/strict";
import { createInitialState, step } from "../src/physics.js";
import { drawScene } from "../src/renderer.js";
import { drawTelemetryChart, drawBrakeCurve } from "../src/chart.js";
import { runRecording, snapshot } from "../src/replayer.js";
import { buildSuccessRecording } from "../src/scenario.js";

function createStubCtx() {
  const calls = [];
  const fn = (...args) => calls.push(args);
  const target = {
    canvas: { width: 720, height: 480 },
    createLinearGradient: () => ({ addColorStop: fn }),
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      obj[prop] = fn;
      return obj[prop];
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  });
}

const ctx = createStubCtx();
let state = createInitialState();
for (let i = 0; i < 30; i++) {
  state = step(state, { boomTargetVel: 0.1, cableTargetVel: -10, brake: 0.2 });
}
assert.doesNotThrow(() => drawScene(ctx, state, { boomTargetVel: 0.1, cableTargetVel: -10, brake: 0.2 }));

const { frames } = runRecording(buildSuccessRecording(), { collect: true });
assert.ok(frames.length > 100);
assert.doesNotThrow(() => drawTelemetryChart(ctx, frames));
assert.doesNotThrow(() => drawBrakeCurve(ctx, frames[0] && [{ v: 0, b: 0 }, { v: 3, b: 1 }]));
assert.equal(typeof snapshot(state).tension, "number");
console.log("  ✓ 渲染冒烟测试通过（场景/曲线图/刹车曲线均无异常）");
