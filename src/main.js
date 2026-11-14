import { CraneAudio } from "./audio.js";
import { createState, drainEvents, getLoadRatio, step } from "./engine.js";
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
} from "./render.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const camera = new Camera(canvas);
const audio = new CraneAudio();

let state = createState();
const keys = new Set();
const edgeKeys = new Set();

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  camera.width = rect.width;
  camera.height = rect.height;
}
window.addEventListener("resize", resize);
resize();

const keyMap = {
  KeyA: "boom+",
  KeyD: "boom-",
  KeyW: "trolley+",
  KeyS: "trolley-",
  Space: "hook",
};

window.addEventListener("keydown", (event) => {
  if (keyMap[event.code]) {
    event.preventDefault();
    audio.ensure();
    if (!keys.has(event.code)) edgeKeys.add(event.code);
    keys.add(event.code);
  }
  if (event.code === "KeyR") resetGame();
  if (event.code === "KeyM") audio.setMuted(!audio.muted);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));

function readInput() {
  const input = { boom: 0, trolley: 0, hook: false };
  if (keys.has("KeyA")) input.boom += 1;
  if (keys.has("KeyD")) input.boom -= 1;
  if (keys.has("KeyW")) input.trolley += 1;
  if (keys.has("KeyS")) input.trolley -= 1;
  if (edgeKeys.has("Space")) input.hook = true;
  edgeKeys.clear();
  return input;
}

function resetGame() {
  state = createState();
  drainEvents(state);
}

let last = performance.now();
let accumulator = 0;
const fixedDt = 1 / 60;

function frame(now) {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  accumulator += elapsed;

  let moving = false;
  while (accumulator >= fixedDt) {
    const input = readInput();
    moving = moving || input.boom !== 0 || input.trolley !== 0;
    step(state, input, fixedDt);
    accumulator -= fixedDt;
  }

  for (const event of drainEvents(state)) {
    audio.handleEvent(event);
  }
  audio.update(getLoadRatio(state), moving);
  render();
  requestAnimationFrame(frame);
}

function render() {
  ctx.clearRect(0, 0, camera.width, camera.height);
  drawWater(ctx, camera, state.time);
  drawPlatforms(ctx, camera);
  drawPontoon(ctx, camera, state);
  drawBoxes(ctx, camera, state);
  drawCrane(ctx, camera, state);
  drawCenterOfMass(ctx, camera, state);
  drawHud(ctx, camera, state);
  drawControlsHint(ctx, camera);
}

requestAnimationFrame(frame);
