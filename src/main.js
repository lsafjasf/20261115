// Browser entry point: fixed scene, drag interaction, pause / single-step.

import { createScene, launchAtThinWall, SCENE_W, SCENE_H } from './scene.js';
import { render } from './render.js';
import { len, sub } from './vec.js';

const canvas = document.getElementById('stage');
canvas.width = SCENE_W;
canvas.height = SCENE_H;
const ctx = canvas.getContext('2d');

const world = createScene();
const FIXED_DT = 1 / 60;

let paused = false;
let dragged = null;
let dragOffset = { x: 0, y: 0 };

const $ = (id) => document.getElementById(id);

function pickBody(point) {
  for (let i = world.bodies.length - 1; i >= 0; i--) {
    const body = world.bodies[i];
    if (body.isStatic) continue;
    if (body.shape.kind === 'circle') {
      if (len(sub(point, body.pos)) <= body.shape.radius) return body;
    } else if (body.shape.kind === 'box') {
      if (len(sub(point, body.pos)) <= body.boundingRadius()) return body;
    }
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const p = {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
  dragged = pickBody(p);
  if (dragged) {
    dragged.userDragged = true;
    dragged.vel = { x: 0, y: 0 };
    dragged.angularVel = 0;
    dragOffset = sub(dragged.pos, p);
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragged) return;
  const rect = canvas.getBoundingClientRect();
  const p = {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
  dragged.pos = { x: p.x + dragOffset.x, y: p.y + dragOffset.y };
  dragged.vel = { x: 0, y: 0 };
});

function endDrag(e) {
  if (!dragged) return;
  dragged.userDragged = false;
  dragged = null;
  if (e && canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

$('btn-pause').addEventListener('click', () => {
  paused = !paused;
  $('btn-pause').textContent = paused ? '▶ 继续' : '⏸ 暂停';
  $('status').textContent = paused ? '已暂停' : '运行中';
});

$('btn-step').addEventListener('click', () => {
  paused = true;
  $('btn-pause').textContent = '▶ 继续';
  $('status').textContent = '单步推进';
  world.step(FIXED_DT);
});

$('btn-reset').addEventListener('click', () => location.reload());

$('btn-launch').addEventListener('click', () => launchAtThinWall(world, 2600));

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    $('btn-pause').click();
  } else if (e.code === 'KeyS' && paused) {
    $('btn-step').click();
  }
});

function updateHud() {
  const list = $('contact-list');
  if (world.lastContacts.length === 0) {
    list.innerHTML = '<li class="empty">当前无接触（接近但未接触不会误报）</li>';
    $('contact-count').textContent = '0';
    return;
  }
  $('contact-count').textContent = String(world.lastContacts.length);
  list.innerHTML = world.lastContacts.map((c) => {
    const name = `${c.a.label || c.a.shape.kind} ↔ ${c.b.label || c.b.shape.kind}`;
    return `<li>
      <strong>${name}</strong><br>
      接触点 (${c.point.x.toFixed(1)}, ${c.point.y.toFixed(1)})<br>
      法线 (${c.normal.x.toFixed(3)}, ${c.normal.y.toFixed(3)})<br>
      穿透深度 ${c.depth.toFixed(3)} px
    </li>`;
  }).join('');
}

function loop() {
  if (!paused) world.step(FIXED_DT);
  render(ctx, world, dragged);
  updateHud();
  requestAnimationFrame(loop);
}

render(ctx, world, null);
updateHud();
loop();
