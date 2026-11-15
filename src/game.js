// 游戏仿真核心：纯逻辑、无 DOM/WebAudio 依赖，可在 Node 中直接验证
import { generateMaze, wallSegments, MATERIALS } from './maze.js';

export const PLAYER_RADIUS = 0.18;
export const MOVE_SPEED = 2.2;
export const TURN_SPEED = 2.8;
export const CHIP_RADIUS = 0.35;
export const EXIT_RADIUS = 0.4;
export const REQUIRED_CHIPS = 3;
const BUMP_COOLDOWN = 0.25;

export function createGame(seed, opts = {}) {
  const maze = generateMaze(seed, opts);
  return {
    seed,
    maze,
    walls: wallSegments(maze),
    player: {
      x: maze.start.x + 0.5,
      y: maze.start.y + 0.5,
      angle: Math.PI / 2,
    },
    chipsCollected: 0,
    chips: maze.chips.map((c, i) => ({ ...c, id: 'chip' + i, taken: false })),
    status: 'playing', // playing | paused | won | failed
    failReason: null, // 'insufficient_evidence'
    time: 0,
    stepDistance: 0,
    bumpCooldown: 0,
    trail: [{ x: maze.start.x + 0.5, y: maze.start.y + 0.5 }],
    events: [],
  };
}

export function togglePause(state) {
  if (state.status === 'playing') state.status = 'paused';
  else if (state.status === 'paused') state.status = 'playing';
  return state.status;
}

// input: { forward: -1|0|1, turn: -1|0|1 }
export function step(state, input, dt) {
  state.events = [];
  if (state.status !== 'playing') return state;

  state.time += dt;
  state.bumpCooldown = Math.max(0, state.bumpCooldown - dt);

  const p = state.player;
  p.angle += (input.turn || 0) * TURN_SPEED * dt;
  const move = (input.forward || 0) * MOVE_SPEED * dt;
  if (move !== 0) {
    const nx = p.x + Math.cos(p.angle) * move;
    const ny = p.y + Math.sin(p.angle) * move;
    resolveMovement(state, nx, ny);
    state.stepDistance += Math.abs(move);
    if (state.stepDistance >= 0.55) {
      state.stepDistance = 0;
      state.events.push({ type: 'step', material: materialAt(state, p.x, p.y) });
    }
  }

  const last = state.trail[state.trail.length - 1];
  if (Math.hypot(p.x - last.x, p.y - last.y) > 0.15)
    state.trail.push({ x: p.x, y: p.y });

  for (const chip of state.chips) {
    if (chip.taken) continue;
    if (Math.hypot(p.x - (chip.x + 0.5), p.y - (chip.y + 0.5)) <= CHIP_RADIUS) {
      chip.taken = true;
      state.chipsCollected++;
      state.events.push({ type: 'chip', id: chip.id, count: state.chipsCollected });
    }
  }

  const ex = state.maze.exit;
  if (Math.hypot(p.x - (ex.x + 0.5), p.y - (ex.y + 0.5)) <= EXIT_RADIUS) {
    if (state.chipsCollected >= REQUIRED_CHIPS) {
      state.status = 'won';
      state.events.push({ type: 'win' });
    } else {
      state.status = 'failed';
      state.failReason = 'insufficient_evidence';
      state.events.push({ type: 'fail', reason: 'insufficient_evidence' });
    }
  }
  return state;
}

export function materialAt(state, x, y) {
  const cx = Math.max(0, Math.min(state.maze.width - 1, Math.floor(x)));
  const cy = Math.max(0, Math.min(state.maze.height - 1, Math.floor(y)));
  return state.maze.cells[cy][cx].material;
}

// 圆 vs 墙线段推出；撞墙时记录带法线方向的 bump 事件（供声像反馈）
function resolveMovement(state, nx, ny) {
  const p = state.player;
  let x = nx, y = ny;
  for (let iter = 0; iter < 3; iter++) {
    let pushed = false;
    for (const w of state.walls) {
      const cx = clamp(x, Math.min(w.x1, w.x2), Math.max(w.x1, w.x2));
      const cy = clamp(y, Math.min(w.y1, w.y2), Math.max(w.y1, w.y2));
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= PLAYER_RADIUS * PLAYER_RADIUS || d2 === 0) continue;
      const d = Math.sqrt(d2);
      x += (dx / d) * (PLAYER_RADIUS - d);
      y += (dy / d) * (PLAYER_RADIUS - d);
      pushed = true;
      if (state.bumpCooldown === 0) {
        state.bumpCooldown = BUMP_COOLDOWN;
        // 法线相对玩家朝向的侧向分量 → 左右声像
        const nxn = dx / d, nyn = dy / d;
        const side = Math.sin(p.angle) * nxn - Math.cos(p.angle) * nyn;
        state.events.push({
          type: 'bump',
          pan: clamp(-side * 2, -1, 1),
          material: w.material,
        });
      }
    }
    if (!pushed) break;
  }
  p.x = clamp(x, PLAYER_RADIUS, state.maze.width - PLAYER_RADIUS);
  p.y = clamp(y, PLAYER_RADIUS, state.maze.height - PLAYER_RADIUS);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// 复盘平面图：正确路径与声源位置直接取自同一份仿真数据，保证一致
export function getFloorPlan(state) {
  const { maze } = state;
  return {
    seed: state.seed,
    width: maze.width,
    height: maze.height,
    walls: state.walls,
    cells: maze.cells,
    start: maze.start,
    exit: maze.exit,
    chips: state.chips.map((c) => ({ x: c.x, y: c.y, taken: c.taken })),
    sources: maze.sources,
    correctPath: maze.correctPath,
    playerTrail: state.trail,
    materials: MATERIALS,
    failReason: state.failReason,
    status: state.status,
  };
}
