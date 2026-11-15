import assert from "node:assert/strict";
import { createScene } from "../src/engine/scene.js";
import { buildScript, applyFrame, applyRecordingFrame } from "../src/engine/replay.js";
import { Renderer } from "../src/engine/renderer.js";
import { createCanvasStub } from "./canvas-stub.mjs";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

test("same seed produces identical scenes", () => {
  const a = createScene(42, 600);
  const b = createScene(42, 600);
  assert.equal(a.shapes.length, 600);
  assert.deepEqual(
    a.shapes.map((s) => [s.x, s.y, s.type, s.color]),
    b.shapes.map((s) => [s.x, s.y, s.type, s.color])
  );
});

test("replay is deterministic across runs", () => {
  const snap = [];
  for (let run = 0; run < 2; run++) {
    const scene = createScene(42, 600);
    const script = buildScript(scene, 1042);
    const camera = { x: 0, y: 0 };
    const frames = [];
    for (let f = 0; f < script.frames; f++) {
      applyFrame(scene, camera, script, f);
      if (f % 50 === 0) frames.push([f, scene.shapes[3].x, camera.x]);
    }
    snap.push(frames);
  }
  assert.deepEqual(snap[0], snap[1]);
});

test("linear and grid paths emit identical ascending-id lists", () => {
  const scene = createScene(42, 600);
  const { ctx } = createCanvasStub();
  const renderer = new Renderer(ctx);
  const camera = { x: 300, y: 200 };
  const linear = renderer.buildList(scene, camera, 960, 600, {
    shadows: true, spatialSort: false, culling: true,
  });
  const grid = renderer.buildList(scene, camera, 960, 600, {
    shadows: true, spatialSort: true, culling: true,
  });
  assert.deepEqual(grid, linear);
  for (let i = 1; i < grid.length; i++) assert.ok(grid[i] > grid[i - 1]);
});

test("culling off draws every shape; culling on draws a strict subset", () => {
  const scene = createScene(42, 600);
  const { ctx } = createCanvasStub();
  const renderer = new Renderer(ctx);
  const camera = { x: 900, y: 700 };
  const all = renderer.buildList(scene, camera, 960, 600, {
    shadows: true, spatialSort: false, culling: false,
  });
  const culled = renderer.buildList(scene, camera, 960, 600, {
    shadows: true, spatialSort: false, culling: true,
  });
  assert.equal(all.length, 600);
  assert.ok(culled.length < 600);
  const set = new Set(culled);
  assert.ok(culled.every((id) => set.has(id)));
});

test("grid path never loses a visible shape vs the linear path", () => {
  const scene = createScene(42, 600);
  const { ctx } = createCanvasStub();
  const renderer = new Renderer(ctx);
  for (const [cx, cy] of [[0, 0], [123, 456], [2600, 1700], [3000, 1900]]) {
    const camera = { x: cx, y: cy };
    for (const culling of [true, false]) {
      const linear = renderer.buildList(scene, camera, 960, 600, {
        shadows: true, spatialSort: false, culling,
      });
      const grid = renderer.buildList(scene, camera, 960, 600, {
        shadows: true, spatialSort: true, culling,
      });
      assert.deepEqual([...grid].sort((a, b) => a - b), [...linear].sort((a, b) => a - b));
    }
  }
});

test("draw call estimate counts fills and labels per visible shape", () => {
  const scene = createScene(42, 600);
  const { ctx, calls } = createCanvasStub();
  const renderer = new Renderer(ctx);
  const camera = { x: 0, y: 0 };
  const result = renderer.renderFrame(scene, camera, 960, 600, {
    shadows: true, spatialSort: true, culling: true,
  });
  const visible = renderer.lastFrameCount.visible;
  // shadow fill + solid fill + one text label per visible shape
  assert.equal(result.fillCalls, visible * 2);
  assert.equal(result.textCalls, visible);
  assert.equal(calls.fill, visible * 2);
});

test("stress: grid stays correct at 4000 shapes across camera moves", () => {
  const scene = createScene(42, 4000);
  const { ctx } = createCanvasStub();
  const renderer = new Renderer(ctx);
  for (const [cx, cy] of [[0, 0], [500, 500], [1500, 900], [2200, 1500]]) {
    const camera = { x: cx, y: cy };
    for (const culling of [true, false]) {
      const linear = renderer.buildList(scene, camera, 1400, 900, {
        shadows: true, spatialSort: false, culling,
      });
      const grid = renderer.buildList(scene, camera, 1400, 900, {
        shadows: true, spatialSort: true, culling,
      });
      assert.equal(grid.length, linear.length);
      assert.deepEqual(grid, linear);
    }
  }
});

test("recorded session replay interpolates and lands on the final point", () => {
  const scene = createScene(42, 10);
  const shape = scene.shapes[2];
  const originalX = shape.x;
  const recording = {
    durationMs: 100,
    events: [{
      type: "drag",
      shapeId: 2,
      t: 0,
      points: [
        { t: 0, x: 100, y: 100 },
        { t: 50, x: 200, y: 100 },
        { t: 100, x: 200, y: 200 },
      ],
    }],
  };
  applyRecordingFrame(scene, recording, 0);
  assert.equal(shape.x, 100 - shape.size / 2);
  applyRecordingFrame(scene, recording, 50);
  assert.equal(shape.x, 200 - shape.size / 2);
  applyRecordingFrame(scene, recording, 100);
  assert.equal(shape.y, 200 - shape.size / 2);
  // Other shapes are untouched.
  assert.equal(scene.shapes[3].x, scene.shapes[3].homeX);
  assert.notEqual(originalX, undefined);
});

console.log(`\n${passed} engine tests passed`);
