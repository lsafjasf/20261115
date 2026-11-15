import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, step, togglePause, getFloorPlan, REQUIRED_CHIPS,
} from '../src/game.js';
import { bfsPath } from '../src/maze.js';

const DT = 1 / 60;

// 沿格子路径自动驾驶：转向对准下一个路径点后前进
function followPath(state, path, maxSteps = 200000) {
  let i = 0;
  const allEvents = [];
  for (let n = 0; n < maxSteps && state.status === 'playing'; n++) {
    while (i < path.length - 1) {
      const t = path[i];
      if (Math.hypot(state.player.x - (t.x + 0.5), state.player.y - (t.y + 0.5)) < 0.12) i++;
      else break;
    }
    const t = path[Math.min(i, path.length - 1)];
    const tx = t.x + 0.5, ty = t.y + 0.5;
    const want = Math.atan2(ty - state.player.y, tx - state.player.x);
    let diff = want - state.player.angle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const input = {
      turn: Math.abs(diff) < 0.05 ? 0 : Math.sign(diff),
      forward: Math.abs(diff) < 0.6 ? 1 : 0,
    };
    step(state, input, DT);
    allEvents.push(...state.events);
    if (i >= path.length - 1 &&
        Math.hypot(state.player.x - tx, state.player.y - ty) < 0.1) break;
  }
  return allEvents;
}

function playSeed(seed) {
  const state = createGame(seed);
  const events = followPath(state, state.maze.correctPath);
  return { state, events };
}

test('seed 7：沿正确路径收集三枚芯片并抵达出口获胜', () => {
  const { state, events } = playSeed(7);
  assert.equal(state.status, 'won');
  assert.equal(state.chipsCollected, REQUIRED_CHIPS);
  assert.ok(events.some((e) => e.type === 'step'), '应产生脚步事件');
  assert.ok(events.some((e) => e.type === 'win'));
});

test('seed 20261115：另一条 seed 的路线同样可通关', () => {
  const { state } = playSeed(20261115);
  assert.equal(state.status, 'won');
  assert.equal(state.chipsCollected, REQUIRED_CHIPS);
});

test('两个 seed 的迷宫布局与正确路径确实不同', () => {
  const a = createGame(7), b = createGame(20261115);
  assert.notDeepEqual(a.maze.correctPath, b.maze.correctPath);
  assert.notDeepEqual(a.maze.sources, b.maze.sources);
});

test('暂停冻结仿真，恢复后继续', () => {
  const state = createGame(7);
  for (let i = 0; i < 30; i++) step(state, { forward: 1, turn: 0 }, DT);
  togglePause(state);
  assert.equal(state.status, 'paused');
  const snapshot = { ...state.player, time: state.time };
  for (let i = 0; i < 60; i++) step(state, { forward: 1, turn: 1 }, DT);
  assert.equal(state.player.x, snapshot.x);
  assert.equal(state.player.y, snapshot.y);
  assert.equal(state.player.angle, snapshot.angle);
  assert.equal(state.time, snapshot.time);
  togglePause(state);
  assert.equal(state.status, 'playing');
  step(state, { forward: 1, turn: 0 }, DT);
  assert.ok(state.time > snapshot.time);
});

test('直奔出口（错误方向）→ 证据不足结局，平面图与仿真参数一致', () => {
  // 找一个直达路径上不经过全部芯片的 seed
  let state, direct;
  for (const seed of [3, 11, 42, 99, 1234]) {
    state = createGame(seed);
    direct = bfsPath(state.maze.cells, state.maze.width, state.maze.height,
      state.maze.start, state.maze.exit);
    const chipsOnWay = state.chips.filter((c) =>
      direct.some((p) => p.x === c.x && p.y === c.y)).length;
    if (chipsOnWay < REQUIRED_CHIPS) break;
  }
  followPath(state, direct);
  assert.equal(state.status, 'failed');
  assert.equal(state.failReason, 'insufficient_evidence');
  assert.ok(state.chipsCollected < REQUIRED_CHIPS);

  const plan = getFloorPlan(state);
  assert.equal(plan.failReason, 'insufficient_evidence');
  assert.deepEqual(plan.correctPath, state.maze.correctPath, '正确路径须与仿真一致');
  assert.deepEqual(plan.sources, state.maze.sources, '声源位置须与仿真一致');
  assert.deepEqual(plan.exit, state.maze.exit);
  assert.deepEqual(plan.chips.map((c) => [c.x, c.y]),
    state.maze.chips.map((c) => [c.x, c.y]));
});

test('撞墙产生带声像方向的 bump 事件', () => {
  const state = createGame(7);
  state.player.angle = -Math.PI / 2; // 朝北，起点北侧是外墙
  let bump = null;
  for (let i = 0; i < 120 && !bump; i++) {
    step(state, { forward: 1, turn: 0 }, DT);
    bump = state.events.find((e) => e.type === 'bump');
  }
  assert.ok(bump, '应检测到撞墙');
  assert.ok(bump.pan >= -1 && bump.pan <= 1);
  assert.ok(typeof bump.material === 'string');
});
