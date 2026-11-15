// Fixed, deterministic test scene shared by the browser UI and the
// headless test harness.
//
// Layout (y grows downward, canvas-like coordinates):
//   zone 1 (x ~ 120-330):  circle vs circle
//   zone 2 (x ~ 430-640):  circle vs rotating box
//   zone 3 (x ~ 740-940):  box vs static incline
//   far right (x ~ 1030):  thin wall CCD challenge

import { Body, circle, box, wall } from './body.js';
import { World } from './world.js';

export const SCENE_W = 1180;
export const SCENE_H = 640;

export function createScene() {
  const world = new World({ x: 0, y: 900 });

  // Ground (thin static wall).
  const ground = new Body(wall({ x: 0, y: 600 }, { x: SCENE_W, y: 600 }), {
    isStatic: true,
    label: 'ground',
    friction: 0.6,
  });
  world.add(ground);

  // --- zone 1: circle vs circle ---
  const circleA = new Body(circle(28), {
    x: 130,
    y: 220,
    vx: 260,
    label: 'circle-A',
    restitution: 0.5,
  });
  const circleB = new Body(circle(36), {
    x: 300,
    y: 220,
    label: 'circle-B',
    restitution: 0.5,
  });
  world.add(circleA);
  world.add(circleB);

  // --- zone 2: circle vs rotating box ---
  const spinBox = new Body(box(46, 30), {
    x: 560,
    y: 300,
    angularVel: 1.4,
    label: 'spinning-box',
    friction: 0.4,
  });
  const circleC = new Body(circle(24), {
    x: 440,
    y: 260,
    vx: 200,
    label: 'circle-C',
  });
  world.add(spinBox);
  world.add(circleC);

  // --- zone 3: box vs static incline ---
  const incline = new Body(wall({ x: 720, y: 560 }, { x: 1000, y: 320 }), {
    isStatic: true,
    label: 'incline',
    friction: 0.5,
  });
  const slideBox = new Body(box(34, 22), {
    x: 900,
    y: 200,
    angle: 0.2,
    label: 'slide-box',
    friction: 0.3,
  });
  world.add(incline);
  world.add(slideBox);

  // --- zone 4: thin wall, CCD challenge ---
  const thinWall = new Body(wall({ x: 1050, y: 180 }, { x: 1050, y: 560 }), {
    isStatic: true,
    label: 'thin-wall',
    friction: 0.1,
    restitution: 0.6,
  });
  const fastCircle = new Body(circle(16), {
    x: 980,
    y: 260,
    vx: 0,
    label: 'fast-circle',
    restitution: 0.6,
  });
  world.add(thinWall);
  world.add(fastCircle);

  world.find = (label) => world.bodies.find((b) => b.label === label);
  return world;
}

// Fire the fast circle at the thin wall at a speed far above the
// per-frame tunneling threshold.
export function launchAtThinWall(world, speed = 2600) {
  const c = world.find('fast-circle');
  c.pos = { x: 980, y: 260 };
  c.vel = { x: speed, y: 0 };
  c.angle = 0;
  c.angularVel = 0;
  return c;
}
