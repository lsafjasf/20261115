'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Solver = require('../src/solver.js');
const Scenarios = require('../src/scenarios.js');
const Keyframes = require('../src/keyframe-store.js');

function circleInView(ch, view) {
  const r = ch.r + (ch.margin || 0);
  return ch.x - r >= view.x - 1e-6 &&
    ch.x + r <= view.x + view.w + 1e-6 &&
    ch.y - r >= view.y - 1e-6 &&
    ch.y + r <= view.y + view.h + 1e-6;
}

function viewInsideStage(view, stage) {
  return view.x >= stage.x - 1e-6 &&
    view.y >= stage.y - 1e-6 &&
    view.x + view.w <= stage.x + stage.w + 1e-6 &&
    view.y + view.h <= stage.y + stage.h + 1e-6;
}

function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
    a.y < b.y + b.h && a.y + a.h > b.y;
}

test('焦段越长视野越窄，宽高比固定', () => {
  const wide = Solver.viewSize(35, 16 / 9);
  const tight = Solver.viewSize(85, 16 / 9);
  assert.ok(wide.w > tight.w);
  assert.ok(Math.abs(wide.w / wide.h - 16 / 9) < 1e-9);
  assert.ok(Math.abs(tight.w / tight.h - 16 / 9) < 1e-9);
});

test('场景 A 可解：双角色入镜、不越界、不穿布景', () => {
  const scene = Scenarios.load('solvable');
  const result = Solver.solve(scene);
  assert.equal(result.feasible, true);
  assert.ok(result.camera);
  scene.characters.forEach((ch) => assert.ok(circleInView(ch, result.view)));
  assert.ok(viewInsideStage(result.view, scene.stage));
  scene.set.forEach((ob) => assert.equal(rectsIntersect(result.view, ob), false));
});

test('场景 B 无解：冲突来源明确指向中央高墙', () => {
  const scene = Scenarios.load('infeasible');
  const result = Solver.solve(scene);
  assert.equal(result.feasible, false);
  assert.equal(result.camera, null);
  const collision = result.conflicts.find((c) => c.type === 'set-collision');
  assert.ok(collision, '应给出布景冲突');
  assert.equal(collision.obstacleId, 'wall');
  assert.equal(collision.blocking, true);
  assert.ok(collision.message.includes('中央高墙'));
});

test('场景 B 临时放宽布景约束后可解', () => {
  const scene = Scenarios.load('infeasible');
  scene.relax = { stage: false, set: true };
  const result = Solver.solve(scene);
  assert.equal(result.feasible, true);
  assert.equal(result.relaxed.set, true);
  scene.characters.forEach((ch) => assert.ok(circleInView(ch, result.view)));
});

test('锁定角色时机位贴近被锁定角色', () => {
  const scene = Scenarios.load('solvable');
  scene.characters[0].x = 350;
  scene.characters[1].x = 650;
  scene.characters[0].y = 230;
  scene.characters[1].y = 380;
  const unlocked = Solver.solve(scene);
  scene.lock = 1;
  const locked = Solver.solve(scene);
  assert.equal(locked.feasible, true);
  const target = scene.characters[1];
  const dLocked = Math.hypot(locked.camera.x - target.x, locked.camera.y - target.y);
  const dUnlocked = Math.hypot(unlocked.camera.x - target.x, unlocked.camera.y - target.y);
  assert.ok(dLocked < dUnlocked);
});

test('焦段过长导致视野装不下两人时给出 view-too-small', () => {
  const scene = Scenarios.load('solvable');
  scene.focal = 300;
  const result = Solver.solve(scene);
  assert.equal(result.feasible, false);
  assert.ok(result.conflicts.some((c) => c.type === 'view-too-small'));
});

test('取景框大于舞台时给出 stage-boundary 冲突', () => {
  const scene = Scenarios.load('solvable');
  scene.focal = 10;
  const result = Solver.solve(scene);
  assert.equal(result.feasible, false);
  assert.ok(result.conflicts.some((c) => c.type === 'stage-boundary'));
});

test('关键帧保存后可恢复，并重新解出相同机位', () => {
  const mem = Keyframes.createMemoryStorage();
  const store = Keyframes.createStore(mem);
  const scene = Scenarios.load('solvable');
  const result = Solver.solve(scene);

  const frame = store.snapshot({ scenarioId: 'solvable', ...scene }, result, '镜头 1');
  store.save(frame);
  assert.equal(store.list().length, 1);

  const restoredState = store.restore(store.list()[0]);
  const reSolved = Solver.solveFrame(restoredState);
  assert.equal(reSolved.feasible, true);
  assert.ok(Math.abs(reSolved.camera.x - result.camera.x) < 1e-9);
  assert.ok(Math.abs(reSolved.camera.y - result.camera.y) < 1e-9);
  assert.ok(store.exportJSON().includes('镜头 1'));
});

test('无解关键帧恢复后仍无解且冲突来源一致', () => {
  const store = Keyframes.createStore(Keyframes.createMemoryStorage());
  const scene = Scenarios.load('infeasible');
  const result = Solver.solve(scene);
  store.save(store.snapshot({ scenarioId: 'infeasible', ...scene }, result));

  const reSolved = Solver.solveFrame(store.restore(store.list()[0]));
  assert.equal(reSolved.feasible, false);
  assert.ok(reSolved.conflicts.some((c) => c.obstacleId === 'wall' && c.blocking));
});
