import { makeRng } from "./random.js";

export const SHAPE_TYPES = ["rect", "circle", "roundRect"];
export const PALETTE = [
  "#4f8cff", "#ff6b6b", "#51cf66", "#f59f00",
  "#cc5de8", "#20c997", "#ff8787", "#748ffc",
];

// World is larger than the viewport so that off-screen culling has
// real work to do when the camera pans.
export const WORLD_W = 3600;
export const WORLD_H = 2400;

export function createScene(seed = 42, count = 600) {
  const rng = makeRng(seed);
  const shapes = [];
  for (let id = 0; id < count; id++) {
    const size = rng.int(36, 96);
    const x = rng.range(40, WORLD_W - 40 - size);
    const y = rng.range(40, WORLD_H - 40 - size);
    shapes.push({
      id,
      type: rng.pick(SHAPE_TYPES),
      x,
      y,
      size,
      color: rng.pick(PALETTE),
      label: "#" + id,
      // Stable home position so a replay can restore the scene.
      homeX: x,
      homeY: y,
    });
  }
  return { seed, count, worldW: WORLD_W, worldH: WORLD_H, shapes };
}

export function serializeScene(scene) {
  return JSON.stringify({
    seed: scene.seed,
    count: scene.count,
    worldW: scene.worldW,
    worldH: scene.worldH,
    shapes: scene.shapes.map((s) => ({
      id: s.id, type: s.type, x: s.x, y: s.y, size: s.size,
      color: s.color, label: s.label, homeX: s.homeX, homeY: s.homeY,
    })),
  });
}

export function deserializeScene(text) {
  const data = JSON.parse(text);
  return data;
}

export function resetScene(scene) {
  for (const shape of scene.shapes) {
    shape.x = shape.homeX;
    shape.y = shape.homeY;
  }
}

// Hit test in world coordinates. Later ids render on top, so test in
// reverse id order to return the visually topmost shape.
export function hitTest(scene, wx, wy) {
  const shapes = scene.shapes;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (wx >= s.x && wx <= s.x + s.size && wy >= s.y && wy <= s.y + s.size) {
      return s;
    }
  }
  return null;
}
