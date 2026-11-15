import { makeRng } from "./random.js";

export const REPLAY_DURATION_MS = 10_000;
export const REPLAY_FPS = 60;

// Build a fixed 10 s action script. Every run with the same seed yields
// identical frame-by-frame motion, so the three render configurations
// replay exactly the same input and only rendering work differs.
export function buildScript(scene, seed = 7) {
  const rng = makeRng(seed);
  const frames = (REPLAY_DURATION_MS / 1000) * REPLAY_FPS; // 600
  const frameMs = REPLAY_DURATION_MS / frames;
  const segments = 14;
  const segLen = Math.floor(frames / segments);
  const actions = [];
  let cursor = 0;
  let camX = 0;
  let camY = 0;
  for (let seg = 0; seg < segments; seg++) {
    const start = cursor;
    const end = Math.min(frames, cursor + segLen);
    cursor = end;
    const kind = seg % 3 === 2 ? "pan" : "drag";
    if (kind === "drag") {
      const shape = scene.shapes[rng.int(0, scene.shapes.length - 1)];
      const fromX = shape.x;
      const fromY = shape.y;
      const toX = rng.range(40, scene.worldW - 40 - shape.size);
      const toY = rng.range(40, scene.worldH - 40 - shape.size);
      actions.push({ kind, shapeId: shape.id, start, end, fromX, fromY, toX, toY });
      shape.x = toX;
      shape.y = toY;
    } else {
      const toX = rng.range(0, Math.max(0, scene.worldW - 960));
      const toY = rng.range(0, Math.max(0, scene.worldH - 600));
      actions.push({ kind, start, end, fromX: camX, fromY: camY, toX, toY });
      camX = toX;
      camY = toY;
    }
  }
  for (const shape of scene.shapes) {
    shape.x = shape.homeX;
    shape.y = shape.homeY;
  }
  return { seed, frames, frameMs, durationMs: REPLAY_DURATION_MS, actions };
}

function ease(t) {
  return t * t * (3 - 2 * t);
}

// Apply the script state for frame index `frame` directly onto the scene
// and camera. Absolute placement (not deltas) keeps replay deterministic
// regardless of frame timing jitter.
export function applyFrame(scene, camera, script, frame) {
  const action = script.actions.find((a) => frame >= a.start && frame < a.end);
  if (!action) return;
  const t = ease((frame - action.start) / (action.end - action.start));
  if (action.kind === "drag") {
    const shape = scene.shapes[action.shapeId];
    shape.x = action.fromX + (action.toX - action.fromX) * t;
    shape.y = action.fromY + (action.toY - action.fromY) * t;
  } else {
    camera.x = action.fromX + (action.toX - action.fromX) * t;
    camera.y = action.fromY + (action.toY - action.fromY) * t;
  }
}

// Replay a user-recorded session. Each drag event stores absolute world
// coordinates with timestamps; the target shape is interpolated along its
// recorded points while other shapes stay untouched. The recorded point is
// the pointer world position, so the shape center is offset by half its size.
export function applyRecordingFrame(scene, recording, elapsedMs) {
  for (const event of recording.events || []) {
    if (event.type !== "drag" || !event.points.length) continue;
    const shape = scene.shapes[event.shapeId];
    if (!shape) continue;
    const pts = event.points;
    const place = (x, y) => {
      shape.x = x - shape.size / 2;
      shape.y = y - shape.size / 2;
    };
    if (elapsedMs <= pts[0].t) {
      place(pts[0].x, pts[0].y);
      continue;
    }
    if (elapsedMs >= pts[pts.length - 1].t) {
      const last = pts[pts.length - 1];
      place(last.x, last.y);
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      if (elapsedMs <= pts[i].t) {
        const a = pts[i - 1];
        const b = pts[i];
        const span = b.t - a.t || 1;
        const k = (elapsedMs - a.t) / span;
        place(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
        break;
      }
    }
  }
}
