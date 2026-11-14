import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../js/world.js';
import { createRover, step } from '../js/simulation.js';
import { Renderer } from '../js/renderer.js';
import { RoverAudio } from '../js/audio.js';

function makeCtx2d() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, prop) {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => ({ addColorStop: noop });
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'canvas') return { width: 1170, height: 858 };
      return typeof prop === 'string' ? noop : undefined;
    },
    set() { return true; }
  });
}

test('Renderer 无头环境可完成一帧渲染（月尘/车辙/陨坑/跳痕/HUD 全路径）', () => {
  const world = createWorld();
  const canvas = {
    width: 1170,
    height: 858,
    getContext: () => makeCtx2d()
  };
  globalThis.document = { createElement: () => ({ width: 1170, height: 858, getContext: () => makeCtx2d() }) };
  globalThis.performance = { now: () => 1000 };
  const renderer = new Renderer(canvas, world);
  const rover = createRover(world);
  for (let i = 0; i < 240; i++) {
    const speed = Math.hypot(rover.vx, rover.vy);
    step(world, rover, { throttle: 1, brake: 0, steer: speed > 4 ? 1 : 0 });
  }
  assert.doesNotThrow(() => renderer.render(rover));
  assert.ok(rover.ruts.length > 0 || rover.dust.length > 0, '行驶应产生车辙或尘土');
});

test('RoverAudio 在无 AudioContext 环境安全降级，事件方法不抛错', () => {
  const audio = new RoverAudio();
  assert.equal(audio.enabled, false);
  assert.doesNotThrow(() => audio.update(4, 6.2, 2, true, false));
  assert.doesNotThrow(() => audio.pickup(2));
  assert.doesNotThrow(() => audio.landslide());
  assert.doesNotThrow(() => audio.win());
});
