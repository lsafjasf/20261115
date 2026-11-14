import test from "node:test";
import assert from "node:assert/strict";

import { createState, drainEvents, step } from "../src/engine.js";
import {
  Camera,
  drawBoxes,
  drawCenterOfMass,
  drawControlsHint,
  drawCrane,
  drawHud,
  drawPlatforms,
  drawPontoon,
  drawWater,
} from "../src/render.js";
import { CraneAudio } from "../src/audio.js";

function makeCtx() {
  const noop = () => {};
  return {
    canvas: { width: 960, height: 540 },
    fillRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    fillText: noop,
    arc: noop,
    strokeRect: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    setLineDash: noop,
    setTransform: noop,
    save: noop,
    restore: noop,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
  };
}

test("渲染管线在无 DOM 环境下可完整绘制一帧", () => {
  const canvas = { width: 960, height: 540, getBoundingClientRect: () => ({ width: 960, height: 540 }) };
  const ctx = makeCtx();
  const camera = new Camera(canvas);
  const state = createState({ wave: { on: true } });

  for (let frame = 0; frame < 120; frame += 1) {
    step(state, { trolley: 1 }, 1 / 60);
  }
  drainEvents(state);

  assert.doesNotThrow(() => {
    drawWater(ctx, camera, state.time);
    drawPlatforms(ctx, camera);
    drawPontoon(ctx, camera, state);
    drawBoxes(ctx, camera, state);
    drawCrane(ctx, camera, state);
    drawCenterOfMass(ctx, camera, state);
    drawHud(ctx, camera, state);
    drawControlsHint(ctx, camera);
  });
});

test("侧翻与获胜终局的 HUD 覆盖层不报错", () => {
  const canvas = { width: 960, height: 540 };
  const ctx = makeCtx();
  const camera = new Camera(canvas);

  const capsized = createState({ wave: { on: false } });
  capsized.status = "capsized";
  assert.doesNotThrow(() => drawHud(ctx, camera, capsized));

  const won = createState({ wave: { on: false } });
  won.status = "won";
  assert.doesNotThrow(() => drawHud(ctx, camera, won));
});

test("音频控制器在缺失 Web Audio 时安全降级", () => {
  const audio = new CraneAudio();
  assert.equal(audio.ctx, null);
  assert.doesNotThrow(() => {
    audio.update(0.8, true);
    audio.handleEvent({ type: "delivered" });
    audio.handleEvent({ type: "capsize" });
    audio.setMuted(true);
  });
});
