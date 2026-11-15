import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateStars, Camera, pickStar, isStarVisible, mulberry32,
} from '../src/core.js';
import {
  createConstellation, addStar, removeStar, toggleEdge, hasEdge,
  renameConstellation, setMagRange, isConstellationInRange,
  serializeProject, deserializeProject, constellationCenter,
} from '../src/project.js';
import { renderScene } from '../src/render.js';
import { buildDemoConstellations } from '../src/demo.js';

// Canvas 2D mock that records line/arc/label calls with their coordinates.
class MockCtx {
  constructor() {
    this.calls = [];
    this.state = {};
    this.path = null;
    this.strokedSegments = [];
  }
  record(method, args) { this.calls.push({ method, args }); }
  save() { this.record('save', []); }
  restore() { this.record('restore', []); }
  scale(x, y) { this.record('scale', [x, y]); }
  fillRect(x, y, w, h) { this.record('fillRect', [x, y, w, h]); }
  beginPath() { this.record('beginPath', []); this.path = []; }
  moveTo(x, y) { this.record('moveTo', [x, y]); if (this.path) this.path.push(['move', x, y]); }
  lineTo(x, y) { this.record('lineTo', [x, y]); if (this.path) this.path.push(['line', x, y]); }
  stroke() {
    this.record('stroke', []);
    if (!this.path) return;
    let pending = null;
    for (const [kind, x, y] of this.path) {
      if (kind === 'move') pending = [x, y];
      if (kind === 'line' && pending) {
        this.strokedSegments.push([pending, [x, y]]);
        pending = null;
      }
    }
    this.path = null;
  }
  fill() { this.record('fill', []); }
  arc(x, y, r, a, b) { this.record('arc', [x, y, r, a, b]); if (this.path) this.path.push(['arc', x, y]); }
  fillText(text, x, y) { this.record('fillText', [text, x, y]); }
  measureText(text) { return { width: text.length * 8 }; }
  set fillStyle(value) { this.state.fillStyle = value; }
  set strokeStyle(value) { this.state.strokeStyle = value; }
  set lineWidth(value) { this.state.lineWidth = value; }
  set globalAlpha(value) { this.state.globalAlpha = value; }
  set font(value) { this.state.font = value; }
  set textAlign(value) { this.state.textAlign = value; }
  set textBaseline(value) { this.state.textBaseline = value; }
  lineSegments() {
    return this.strokedSegments;
  }
}

test('seeded star generation is deterministic and free of external data', () => {
  const a = generateStars({ seed: 7, count: 300 });
  const b = generateStars({ seed: 7, count: 300 });
  assert.equal(a.length, 300);
  assert.deepEqual(a, b);
  assert.notDeepEqual(generateStars({ seed: 8, count: 300 }), a);
  assert.ok(a.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)));
  assert.ok(a.every((s) => s.magnitude >= -1.5 && s.magnitude <= 7.001));
  // Dim stars outnumber bright ones, like a real sky.
  const bright = a.filter((s) => s.magnitude <= 2).length;
  const dim = a.filter((s) => s.magnitude > 4.5).length;
  assert.ok(dim > bright * 3);
});

test('camera round-trips world and screen coordinates at any zoom', () => {
  const camera = new Camera({ x: 120, y: -80, scale: 2.4, viewWidth: 640, viewHeight: 480 });
  const world = { x: 333.5, y: -210.25 };
  const screen = camera.worldToScreen(world.x, world.y);
  const back = camera.screenToWorld(screen.x, screen.y);
  assert.ok(Math.abs(back.x - world.x) < 1e-9);
  assert.ok(Math.abs(back.y - world.y) < 1e-9);
});

test('zoomAt keeps the world point under the cursor fixed', () => {
  const camera = new Camera({ viewWidth: 800, viewHeight: 600 });
  const cursor = { x: 512, y: 288 };
  const before = camera.screenToWorld(cursor.x, cursor.y);
  camera.zoomAt(cursor.x, cursor.y, 2.5);
  const after = camera.screenToWorld(cursor.x, cursor.y);
  assert.ok(Math.abs(after.x - before.x) < 1e-9);
  assert.ok(Math.abs(after.y - before.y) < 1e-9);
  assert.equal(camera.scale, 2.5);

  // After zoom+panning, a world point must map to a different screen point
  // but the same world point is still recoverable (lines cannot "jump").
  camera.pan(40, -25);
  const moved = camera.screenToWorld(cursor.x, cursor.y);
  const expected = { x: before.x - 40 / 2.5, y: before.y + 25 / 2.5 };
  assert.ok(Math.abs(moved.x - expected.x) < 1e-9);
  assert.ok(Math.abs(moved.y - expected.y) < 1e-9);
});

test('magnitude threshold hides faint stars but never edits annotations', () => {
  const stars = generateStars({ seed: 11, count: 500 });
  const c = createConstellation({ name: '测试座' });
  const faint = stars.find((s) => s.magnitude > 5.5);
  const bright = stars.find((s) => s.magnitude < 2);
  addStar(c, faint.id);
  addStar(c, bright.id);
  toggleEdge(c, faint.id, bright.id);
  const before = structuredClone(c);

  assert.equal(isStarVisible(faint, 4), false);
  assert.equal(isStarVisible(bright, 4), true);
  // The hidden faint star remains a full member with its edge intact.
  assert.deepEqual(c, before);
  assert.ok(hasEdge(c, faint.id, bright.id));
});

test('edge toggling and star removal keep the constellation consistent', () => {
  const c = createConstellation({});
  addStar(c, 's1');
  addStar(c, 's2');
  addStar(c, 's3');
  assert.equal(toggleEdge(c, 's1', 's2'), true);
  assert.equal(toggleEdge(c, 's2', 's1'), false); // undirected, removes it
  toggleEdge(c, 's1', 's2');
  toggleEdge(c, 's2', 's3');
  assert.equal(c.edges.length, 2);
  assert.equal(toggleEdge(c, 's1', 's9'), false); // unknown endpoint rejected
  removeStar(c, 's2');
  assert.deepEqual(c.starIds, ['s1', 's3']);
  assert.equal(c.edges.length, 0); // both dangling edges removed
  renameConstellation(c, '  新名字  ');
  assert.equal(c.name, '新名字');
});

test('visible range only controls display, data is preserved outside the band', () => {
  const c = createConstellation({ magRange: [0, 4] });
  assert.equal(isConstellationInRange(c, 3), true);
  assert.equal(isConstellationInRange(c, 6), false);
  setMagRange(c, 5, 2); // swapped inputs are normalised
  assert.deepEqual(c.magRange, [2, 5]);
  assert.equal(isConstellationInRange(c, 3), true);
});

test('two demo constellations are built with valid stars and connected edges', () => {
  const stars = generateStars({ seed: 20261115, count: 1400, worldSize: 2000 });
  const [ladle, triangle] = buildDemoConstellations(stars);
  assert.equal(ladle.name, '北斗七星');
  assert.equal(triangle.name, '三角座');
  assert.equal(ladle.starIds.length, 7);
  assert.equal(triangle.starIds.length, 3);
  assert.ok(ladle.edges.length >= 6);
  assert.equal(triangle.edges.length, 3);
  const ids = new Set(stars.map((s) => s.id));
  for (const c of [ladle, triangle]) {
    for (const starId of c.starIds) assert.ok(ids.has(starId));
    for (const [a, b] of c.edges) {
      assert.ok(c.starIds.includes(a) && c.starIds.includes(b));
    }
  }
});

test('project serializes to JSON and reloads identically from regenerated stars', () => {
  const stars = generateStars({ seed: 99, count: 800 });
  const constellations = buildDemoConstellations(stars);
  const camera = new Camera({ x: 50, y: -30, scale: 3.2, viewWidth: 1000, viewHeight: 700 });
  const text = serializeProject({
    seed: 99, worldSize: 2000, magnitudeThreshold: 4.2, constellations, camera,
  });
  const parsed = JSON.parse(text);
  assert.equal(parsed.formatVersion, 1);

  // Simulate a fresh page load: regenerate the star field from the seed only.
  const reloadedStars = generateStars({ seed: parsed.seed, count: 800, worldSize: parsed.worldSize });
  const project = deserializeProject(text, reloadedStars);
  assert.equal(project.constellations.length, 2);
  assert.deepEqual(
    project.constellations.map((c) => c.edges),
    constellations.map((c) => c.edges),
  );
  assert.deepEqual(
    project.constellations.map((c) => c.starIds),
    constellations.map((c) => c.starIds),
  );
  assert.deepEqual(project.cameraJSON, { x: 50, y: -30, scale: 3.2 });
});

test('reload rejects references to unknown stars instead of misplacing lines', () => {
  const stars = generateStars({ seed: 5, count: 200 });
  const text = JSON.stringify({
    formatVersion: 1, seed: 5, worldSize: 2000, magnitudeThreshold: 6,
    constellations: [{
      id: 'bad', name: '坏', starIds: ['s1'], edges: [['s1', 's99999']],
      magRange: [-1.5, 7], color: '#fff',
    }],
    camera: null,
  });
  assert.throws(() => deserializeProject(text, stars), /不存在的星点/);
});

test('rendered line endpoints always coincide with star screen positions', () => {
  const stars = generateStars({ seed: 21, count: 600 });
  const constellations = buildDemoConstellations(stars);
  const camera = new Camera({ x: -140, y: 90, scale: 4.1, viewWidth: 900, viewHeight: 640 });
  const ctx = new MockCtx();
  renderScene(ctx, {
    stars, constellations, camera, magnitudeThreshold: 5, width: 900, height: 640,
  });
  const segments = ctx.lineSegments();
  const inRangeAt5 = constellations.filter((c) => isConstellationInRange(c, 5));
  const expectedCount = inRangeAt5.reduce((n, c) => n + c.edges.length, 0);
  assert.equal(segments.length, expectedCount);
  assert.ok(expectedCount === constellations.reduce((n, c) => n + c.edges.length, 0));

  const starById = new Map(stars.map((s) => [s.id, s]));
  let checked = 0;
  for (const constellation of constellations) {
    for (const [aId, bId] of constellation.edges) {
      const expectedA = camera.worldToScreen(starById.get(aId).x, starById.get(aId).y);
      const expectedB = camera.worldToScreen(starById.get(bId).x, starById.get(bId).y);
      const match = segments.find(([p1, p2]) =>
        near(p1, expectedA) && near(p2, expectedB));
      assert.ok(match, `edge ${aId}-${bId} rendered on the wrong stars`);
      checked += 1;
    }
  }
  assert.ok(checked >= 9);

  // A threshold that hides every member star still draws annotation lines for
  // constellations whose visible band includes that threshold.
  const hiddenCtx = new MockCtx();
  renderScene(hiddenCtx, {
    stars, constellations, camera, magnitudeThreshold: -1.5, width: 900, height: 640,
  });
  const inRange = constellations.filter((c) => isConstellationInRange(c, -1.5));
  assert.ok(inRange.length === 1);
  assert.ok(hiddenCtx.lineSegments().length >=
    inRange.reduce((n, c) => n + c.edges.length, 0));
});

test('pickStar tolerance scales with zoom so clicks stay precise', () => {
  const stars = generateStars({ seed: 3, count: 400 });
  const target = stars[10];
  const zoomed = new Camera({ x: target.x, y: target.y, scale: 5, viewWidth: 800, viewHeight: 600 });
  const screen = zoomed.worldToScreen(target.x, target.y);
  const world = zoomed.screenToWorld(screen.x + 2, screen.y - 2);
  assert.equal(pickStar(stars, world.x, world.y, 14 / zoomed.scale)?.id, target.id);
});

function near(a, b) {
  return Math.abs(a[0] - b.x) < 1e-9 && Math.abs(a[1] - b.y) < 1e-9;
}
