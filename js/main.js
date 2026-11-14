import { createWorld } from './world.js';
import { createRover, step, runEpisode } from './simulation.js';
import { autopilot } from './autopilot.js';
import { Renderer } from './renderer.js';
import { RoverAudio } from './audio.js';
import { DT, MAX_SPEED, SEED } from './config.js';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');

let activeWorld = createWorld(SEED);
const renderer = new Renderer(canvas, activeWorld);
const audio = new RoverAudio();

let rover = createRover(activeWorld);
let mode = 'auto';
const keys = new Set();
let acc = 0;
let last = performance.now();
let handled = new Set();

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyA') mode = mode === 'auto' ? 'manual' : 'auto';
  if (e.code === 'KeyR') reset();
  if (e.code === 'KeyM') audio.start().catch(() => {});
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

document.getElementById('btn-auto').onclick = () => { mode = 'auto'; };
document.getElementById('btn-reset').onclick = () => reset();
document.getElementById('btn-audio').onclick = () => audio.start().catch((err) => { statusEl.textContent = err.message; });
document.getElementById('btn-mission').onclick = () => { reset(); mode = 'auto'; };

function manualInput() {
  const throttle = (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0);
  const steer = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
  const brake = keys.has('Space') ? 1 : 0;
  return { throttle, steer, brake };
}

function reset() {
  for (const c of activeWorld.craters) c.triggered = false;
  for (const s of activeWorld.samples) s.collected = false;
  rover = createRover(activeWorld);
  acc = 0;
  handled = new Set();
}

function handleEvents() {
  for (const ev of rover.events) {
    const key = `${ev.type}-${rover.time.toFixed(3)}`;
    if (handled.has(key)) continue;
    handled.add(key);
    if (ev.type === 'pickup') audio.pickup(ev.jar);
    if (ev.type === 'landslide') audio.landslide();
    if (ev.type === 'hop') audio.hop();
    if (ev.type === 'land') audio.land(ev.impact);
    if (ev.type === 'abort') audio.abort();
    if (ev.type === 'return') audio.win();
  }
}

function frame(now) {
  const delta = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += delta;
  let guard = 0;
  while (acc >= DT && guard < 5 && rover.status === 'active') {
    const input = mode === 'auto' ? autopilot(activeWorld, rover) : manualInput();
    step(activeWorld, rover, input);
    handleEvents();
    acc -= DT;
    guard++;
  }
  const speed = Math.hypot(rover.vx, rover.vy);
  audio.update(speed, MAX_SPEED, rover.jars, rover.slip, rover.airborne);
  renderer.world = activeWorld;
  renderer.render(rover);
  statusEl.textContent = `模式: ${mode === 'auto' ? '自动驾驶（A 切手动）' : '手动 WASD/方向键 + 空格制动（A 切自驾）'} · seed=${SEED} · R 重置 · M 开声音`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 暴露给控制台/无头调试
window.__game = {
  get world() { return activeWorld; },
  get rover() { return rover; },
  reset,
  __swap(w, r) { activeWorld = w; rover = r; renderer.world = w; },
  runMission: () => runEpisode(createWorld(SEED), autopilot)
};
