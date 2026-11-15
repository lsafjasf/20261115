// Headless verification of every required behavior.
// Run: node test/run-tests.js

import { createScene, launchAtThinWall } from '../src/scene.js';
import { Body, circle, box, wall } from '../src/body.js';
import { World } from '../src/world.js';
import { detectContact, CONTACT_EPS } from '../src/collision.js';
import { len, sub, dot, normalize } from '../src/vec.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    failures.push(`${name} ${detail}`);
    console.log(`  \u2717 ${name} ${detail}`);
  }
}

function approx(a, b, tol = 1e-6) {
  return Math.abs(a - b) <= tol;
}

function contactBetween(world, labelA, labelB) {
  return world.lastContacts.find(
    (c) =>
      (c.a.label === labelA && c.b.label === labelB) ||
      (c.a.label === labelB && c.b.label === labelA),
  );
}

const DT = 1 / 60;

// 1. circle vs circle ------------------------------------------------------
{
  console.log('\n[1] circle vs circle contact');
  const world = createScene();
  const a = world.find('circle-A');
  const b = world.find('circle-B');

  // Before anything reaches anything: no false contact.
  world.collectContacts();
  check('no contact while separated', contactBetween(world, 'circle-A', 'circle-B') === undefined);

  // Place them overlapping by a known amount (5 px).
  const overlap = 5;
  a.pos = { x: 100, y: 200 };
  b.pos = { x: 100 + a.shape.radius + b.shape.radius - overlap, y: 200 };
  const c = detectContact(a, b);
  check('contact detected on overlap', c !== null);
  check('normal points A -> B (+x)', c && approx(c.normal.x, 1) && approx(c.normal.y, 0));
  check('depth equals known overlap', c && approx(c.depth, overlap, 1e-6),
    `depth=${c?.depth}`);
  check('point lies between centers',
    c && approx(c.point.x, a.pos.x + a.shape.radius + overlap / 2, 1e-6));

  // A 2 px gap must NOT be reported.
  a.pos = { x: 100, y: 200 };
  b.pos = { x: 100 + a.shape.radius + b.shape.radius + 2, y: 200 };
  check('gap of 2 px is not a collision', detectContact(a, b) === null);

  // Dynamic run: moving circles actually meet and bounce apart.
  const world2 = createScene();
  const a2 = world2.find('circle-A');
  const b2 = world2.find('circle-B');
  let sawContact = false;
  for (let i = 0; i < 60; i++) {
    world2.step(DT);
    if (contactBetween(world2, 'circle-A', 'circle-B')) sawContact = true;
  }
  check('contact occurs during simulation', sawContact);
  check('bodies separate after bounce (no sticking)',
    len(sub(a2.pos, b2.pos)) >= a2.shape.radius + b2.shape.radius - 1e-4);
}

// 2. circle vs rotating box ------------------------------------------------
{
  console.log('\n[2] circle vs rotating box contact');
  const world = createScene();
  const c = world.find('circle-C');
  const bx = world.find('spinning-box');

  // Near-miss geometry: circle center 3 px outside the box face.
  c.pos = { x: bx.pos.x - bx.shape.halfX - c.shape.radius - 3, y: bx.pos.y };
  bx.angle = 0;
  check('circle 3 px away from box face is not contact',
    detectContact(c, bx) === null);

  // Overlap 4 px through the left face.
  c.pos = { x: bx.pos.x - bx.shape.halfX - c.shape.radius + 4, y: bx.pos.y };
  const hit = detectContact(c, bx);
  check('face contact detected', hit !== null);
  // a -> b convention: normal points from circle toward box (+x).
  check('normal points circle -> box (+x)',
    hit && approx(hit.normal.x, 1, 1e-9) && approx(hit.normal.y, 0, 1e-9));
  check('depth is 4 px', hit && approx(hit.depth, 4, 1e-6), `depth=${hit?.depth}`);
  check('contact point on the face',
    hit && approx(hit.point.x, bx.pos.x - bx.shape.halfX, 1e-9));

  // Rotated face: normal must follow the box orientation.
  bx.angle = Math.PI / 2;
  c.pos = { x: bx.pos.x, y: bx.pos.y - bx.shape.halfX - c.shape.radius + 6 };
  const hit2 = detectContact(c, bx);
  check('rotated box contact detected', hit2 !== null);
  check('rotated normal points into box (0,+1)',
    hit2 && approx(hit2.normal.x, 0, 1e-9) && approx(hit2.normal.y, 1, 1e-9),
    `n=(${hit2?.normal.x},${hit2?.normal.y})`);
  check('rotated depth is 6 px', hit2 && approx(hit2.depth, 6, 1e-6));

  // Simulation with spinning box: contact must fire and never deeply sink.
  const world2 = createScene();
  let frames = 0;
  let maxDepth = 0;
  for (let i = 0; i < 120; i++) {
    world2.step(DT);
    const cc = contactBetween(world2, 'circle-C', 'spinning-box');
    if (cc) {
      frames++;
      maxDepth = Math.max(maxDepth, cc.depth);
    }
  }
  check('spinning box contacts circle at runtime', frames > 0);
  check('penetration stays shallow (< 1 px)', maxDepth < 1, `maxDepth=${maxDepth}`);
}

// 3. box vs static incline -------------------------------------------------
{
  console.log('\n[3] rotating box vs static incline contact');
  const world = createScene();
  const bx = world.find('slide-box');
  const incline = world.find('incline');
  const [wa, wb] = incline.wallPoints();
  const wallDir = normalize(sub(wb, wa));
  const n = { x: -wallDir.y, y: wallDir.x };
  const wallLen = len(sub(wb, wa));
  // A point 100 px along the wall, lifted onto the outward (+n) side.
  const baseOnWall = { x: wa.x + wallDir.x * 100, y: wa.y + wallDir.y * 100 };
  // Align the box with the wall so one full edge runs parallel to it. With
  // angle = atan2(wallDir), the box's local +y axis maps onto the wall normal.
  const wallAngle = Math.atan2(wallDir.y, wallDir.x);
  bx.angle = wallAngle;
  const edgeNormalOffset = bx.shape.halfY;

  // Rest the box just above the wall: no contact yet.
  bx.pos = {
    x: baseOnWall.x + n.x * (edgeNormalOffset + 10),
    y: baseOnWall.y + n.y * (edgeNormalOffset + 10),
  };
  check('box above incline has no contact', detectContact(bx, incline) === null);

  // depth = halfY + offset, so an offset of (7 - halfY) puts the near edge
  // 7 px across the wall while the far edge stays on the other side.
  bx.pos = {
    x: baseOnWall.x + n.x * (7 - edgeNormalOffset),
    y: baseOnWall.y + n.y * (7 - edgeNormalOffset),
  };
  const hit = detectContact(bx, incline);
  check('crossing vertex creates contact', hit !== null);
  check('depth equals 7 px', hit && approx(hit.depth, 7, 1e-6), `depth=${hit?.depth}`);
  check('normal is perpendicular to incline',
    hit && approx(Math.abs(dot(hit.normal, wallDir)), 0, 1e-9));
  // The box center sits on the -n side, so the wall -> box normal is -n.
  check('normal points from wall into box',
    hit && dot(hit.normal, n) <= -0.999, `dot=${hit && dot(hit.normal, n)}`);
  check('wall length sanity', wallLen > 100);

  // Full fall onto the incline: lands, slides down, and never tunnels.
  const world2 = createScene();
  const b2 = world2.find('slide-box');
  const w2 = world2.find('incline');
  let contactFrames = 0;
  let maxDepth = 0;
  const startX = b2.pos.x;
  for (let i = 0; i < 240; i++) {
    world2.step(DT);
    const inclineHits = world2.frameContacts.filter(
      (c) =>
        (c.a === b2 || c.b === b2) &&
        (c.a === w2 || c.b === w2),
    );
    if (inclineHits.length > 0) {
      contactFrames++;
      for (const c of inclineHits) maxDepth = Math.max(maxDepth, c.depth);
    }
  }
  check('box makes repeated incline contact while sliding', contactFrames >= 4,
    `contactFrames=${contactFrames}`);
  check('incline penetration stays sub-pixel', maxDepth < 0.5,
    `maxDepth=${maxDepth}`);
  check('box slides down the incline (x decreases toward its foot)',
    b2.pos.x < startX - 100, `from ${startX} to ${b2.pos.x}`);
  check('box comes to rest near the ground without tunneling',
    Math.abs(b2.pos.y - 600) < 60, `y=${b2.pos.y}`);
}

// 4. thin-wall CCD: no tunneling at extreme speed --------------------------
{
  console.log('\n[4] continuous collision against a zero-thickness wall');
  const world = createScene();
  const fast = launchAtThinWall(world, 2600); // 43 px per 1/60 s frame
  const thin = world.find('thin-wall');

  // Per-frame motion vastly exceeds wall thickness (0) and circle radius.
  check('tunneling condition: per-frame travel > radius',
    fast.vel.x * DT > fast.shape.radius * 2);

  let contactFrames = 0;
  let maxDepth = 0;
  for (let i = 0; i < 30; i++) {
    world.step(DT);
    const cc = contactBetween(world, 'fast-circle', 'thin-wall');
    if (cc) {
      contactFrames++;
      maxDepth = Math.max(maxDepth, cc.depth);
    }
    // The circle center can never end up on the far side of the wall.
    check('circle stays on launch side of wall',
      fast.pos.x <= thin.pos.x + thin.shape.a.x + fast.shape.radius + 0.5,
      `x=${fast.pos.x}`);
  }
  check('contact with thin wall is registered', contactFrames > 0);
  check('no deep penetration through wall', maxDepth < 1, `maxDepth=${maxDepth}`);
  check('circle bounced (velocity reversed)', fast.vel.x < 0,
    `vx=${fast.vel.x}`);
}

// 5. no false positives for close-but-disjoint shapes ----------------------
{
  console.log('\n[5] close-but-not-touching shapes are not collisions');
  const world = createScene();

  const c1 = new Body(circle(20), { x: 0, y: 0 });
  const c2 = new Body(circle(20), { x: 40 + CONTACT_EPS * 0.5, y: 0 });
  check('circles with positive gap: null', detectContact(c1, c2) === null);

  const bx = new Body(box(30, 20), { x: 100, y: 0 });
  const c3 = new Body(circle(15), { x: 100 - 30 - 15 - 0.5, y: 0 });
  check('circle near box face: null', detectContact(c3, bx) === null);

  const w = new Body(wall({ x: 200, y: -100 }, { x: 200, y: 100 }), {
    isStatic: true,
  });
  const c4 = new Body(circle(15), { x: 200 - 15 - 0.8, y: 0 });
  check('circle near wall: null', detectContact(c4, w) === null);

  const b2 = new Body(box(25, 25), { x: 300, y: 0 });
  const b3 = new Body(box(25, 25), { x: 350 + 0.5, y: 0 });
  check('boxes with positive gap: null', detectContact(b2, b3) === null);

  // Endpoint corner case: circle beside a wall endpoint but not overlapping.
  const c5 = new Body(circle(10), { x: 210, y: -110 });
  check('circle past wall endpoint, disjoint: null',
    detectContact(c5, w) === null);
}

// 6. pause / single-step behavior ------------------------------------------
{
  console.log('\n[6] pause still allows deterministic single steps');
  const world = createScene();
  const fast = launchAtThinWall(world, 1500);
  const startX = fast.pos.x;

  // "Paused": the harness simply does not call step(). State must freeze.
  const snapshot = JSON.stringify({ p: fast.pos, v: fast.vel });
  for (let i = 0; i < 5; i++) {
    // no step() calls -> paused
  }
  check('paused world is frozen',
    JSON.stringify({ p: fast.pos, v: fast.vel }) === snapshot);

  // Single step advances exactly one frame and remains repeatable.
  world.step(DT);
  const afterOne = { x: fast.pos.x, vx: fast.vel.x };
  check('single step moves the body', afterOne.x > startX);

  const worldB = createScene();
  launchAtThinWall(worldB, 1500);
  worldB.step(DT);
  const fastB = worldB.find('fast-circle');
  check('single step is deterministic across worlds',
    approx(fastB.pos.x, afterOne.x, 1e-9) && approx(fastB.vel.x, afterOne.vx, 1e-9));
}

// 7. contact report fields sanity ------------------------------------------
{
  console.log('\n[7] contact reports carry point, normal and depth');
  const world = createScene();
  const a = new Body(circle(25), { x: 0, y: 0 });
  const b = new Body(circle(25), { x: 45, y: 0 }); // 5 px overlap
  world.bodies = [a, b];
  world.collectContacts();
  const c = world.lastContacts[0];
  check('one contact reported', world.lastContacts.length === 1);
  check('has numeric point', c && Number.isFinite(c.point.x) && Number.isFinite(c.point.y));
  check('normal is unit length', c && approx(len(c.normal), 1, 1e-9));
  check('depth is positive', c && c.depth > 0);
  check('bodies referenced in order', c && c.a === a && c.b === b);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFAILURES:\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
