/*
 * map-core.js
 * 种子地图生成 + 可达性分析核心逻辑（浏览器与 Node 通用）。
 *
 * 单元格类型：
 *   0 FLOOR     空地
 *   1 WALL      静态墙（不可破坏、不可编辑）
 *   2 BREAKABLE 可破坏墙体（玩家可删除/移动，数量受预算限制）
 *   3 GATE      动态闸门（按周期开合，关闭时不可通行）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MapCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const T = { FLOOR: 0, WALL: 1, BREAKABLE: 2, GATE: 3 };

  const WIDTH = 23;
  const HEIGHT = 15;
  const MAX_EDITS = 3;

  const STATUS = {
    STATIC: 'static',       // 静止可达：无需等待闸门
    GATE: 'gate',           // 等待闸门可达：利用闸门周期开放
    UNREACHABLE: 'unreachable' // 永久不可达
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeGrid(w, h, fill) {
    const grid = new Array(h);
    for (let y = 0; y < h; y++) {
      grid[y] = new Array(w).fill(fill);
    }
    return grid;
  }

  function cloneGrid(grid) {
    return grid.map(function (row) { return row.slice(); });
  }

  function key(x, y) {
    return y * 1000 + x;
  }

  function inBounds(map, x, y) {
    return x >= 0 && y >= 0 && x < map.width && y < map.height;
  }

  function isFreeFloor(map, x, y) {
    return inBounds(map, x, y) && map.grid[y][x] === T.FLOOR;
  }

  /*
   * 由 seed 生成地图：
   *  - 外圈静态墙 + 一道纵向隔墙（含 1 个周期开合的动态闸门）
   *  - 左下封闭密室，密室四周为静态墙，仅留 1 面可破坏墙体
   *  - 起点在左下区域；目标 A 在左侧（静止可达），目标 B 在闸门右侧
   *    （等待闸门可达），目标 C 在密室内（初始永久不可达）
   *  - 其余空地按 seed 随机散布少量可破坏墙体，且不破坏上述结构性结论
   */
  function generateMap(seed) {
    const rng = mulberry32(seed);
    const grid = makeGrid(WIDTH, HEIGHT, T.FLOOR);

    for (let x = 0; x < WIDTH; x++) {
      grid[0][x] = T.WALL;
      grid[HEIGHT - 1][x] = T.WALL;
    }
    for (let y = 0; y < HEIGHT; y++) {
      grid[y][0] = T.WALL;
      grid[y][WIDTH - 1] = T.WALL;
    }

    const dividerX = 14;
    const gateY = 3 + Math.floor(rng() * (HEIGHT - 6));
    const period = 4 + Math.floor(rng() * 4); // 4..7
    const openAt = 1 + Math.floor(rng() * (period - 1)); // 1..period-1
    for (let y = 1; y < HEIGHT - 1; y++) {
      grid[y][dividerX] = y === gateY ? T.GATE : T.WALL;
    }
    const gate = { x: dividerX, y: gateY, period: period, openAt: openAt };

    // 密室：外墙静态，右侧中段留一面可破坏墙
    const chamber = { x0: 2, y0: 2, x1: 6, y1: 6 };
    for (let x = chamber.x0; x <= chamber.x1; x++) {
      grid[chamber.y0][x] = T.WALL;
      grid[chamber.y1][x] = T.WALL;
    }
    for (let y = chamber.y0; y <= chamber.y1; y++) {
      grid[y][chamber.x0] = T.WALL;
      grid[y][chamber.x1] = T.WALL;
    }
    const door = { x: chamber.x1, y: chamber.y0 + 2 };
    grid[door.y][door.x] = T.BREAKABLE;

    const start = { x: 1, y: HEIGHT - 2 };
    const goals = [
      pickGoal(rng, grid, WIDTH, HEIGHT, function (x, y) {
        return x < dividerX - 1 && y > 8 && !(x === start.x && y === start.y);
      }),
      pickGoal(rng, grid, WIDTH, HEIGHT, function (x, y) {
        return x > dividerX + 1 && y > 4;
      }),
      { x: chamber.x0 + 2, y: chamber.y0 + 2 }
    ];
    goals.forEach(function (g, i) { g.id = 'G' + (i + 1); });

    const map = {
      seed: seed >>> 0,
      width: WIDTH,
      height: HEIGHT,
      grid: grid,
      start: start,
      goals: goals,
      gate: gate,
      chamber: chamber,
      breakableDoors: [door],
      editLog: []
    };

    scatterBreakables(map, rng);
    return map;
  }

  function pickGoal(rng, grid, w, h, accept) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const x = 1 + Math.floor(rng() * (w - 2));
      const y = 1 + Math.floor(rng() * (h - 2));
      if (grid[y][x] === T.FLOOR && accept(x, y)) {
        return { x: x, y: y };
      }
    }
    throw new Error('goal placement failed');
  }

  function scatterBreakables(map, rng) {
    const protectedCells = new Set();
    protectedCells.add(key(map.start.x, map.start.y));
    map.goals.forEach(function (g) {
      protectedCells.add(key(g.x, g.y));
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          protectedCells.add(key(g.x + dx, g.y + dy));
        }
      }
    });
    protectedCells.add(key(map.gate.x, map.gate.y));
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        protectedCells.add(key(map.gate.x + dx, map.gate.y + dy));
      }
    }
    map.breakableDoors.forEach(function (d) {
      protectedCells.add(key(d.x, d.y));
    });

    // 保护一条起点 -> G1 的地基路径，保证随机障碍不会隔断静止可达性
    const basePath = floodPath(map, map.start, map.goals[0], false);
    basePath.forEach(function (p) { protectedCells.add(key(p.x, p.y)); });

    const candidates = [];
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (map.grid[y][x] === T.FLOOR && !protectedCells.has(key(x, y))) {
          candidates.push({ x: x, y: y });
        }
      }
    }
    const count = Math.floor(candidates.length * 0.08);
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }
    for (let i = 0; i < count; i++) {
      const c = candidates[i];
      map.grid[c.y][c.x] = T.BREAKABLE;
    }
  }

  /* 泛洪 BFS：allowBreakable 时把可破坏墙视为可通行，闸门始终视为阻挡 */
  function floodComponent(map, origin, allowBreakable) {
    const seen = new Map();
    const queue = [origin];
    seen.set(key(origin.x, origin.y), null);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (queue.length) {
      const cur = queue.shift();
      for (const d of dirs) {
        const nx = cur.x + d[0];
        const ny = cur.y + d[1];
        if (!inBounds(map, nx, ny) || seen.has(key(nx, ny))) continue;
        const cell = map.grid[ny][nx];
        const passable = cell === T.FLOOR ||
          (allowBreakable && cell === T.BREAKABLE);
        if (!passable) continue;
        seen.set(key(nx, ny), { x: cur.x, y: cur.y });
        queue.push({ x: nx, y: ny });
      }
    }
    return seen;
  }

  function floodPath(map, from, to, allowBreakable) {
    const seen = floodComponent(map, from, allowBreakable);
    if (!seen.has(key(to.x, to.y))) return null;
    const path = [];
    let cur = { x: to.x, y: to.y };
    while (cur) {
      path.push(cur);
      cur = seen.get(key(cur.x, cur.y));
    }
    return path.reverse();
  }

  function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
  }

  function lcm(a, b) {
    return (a / gcd(a, b)) * b;
  }

  function gatePeriod(map) {
    return Array.isArray(map.gates)
      ? map.gates.reduce(function (acc, g) { return lcm(acc, g.period); }, 1)
      : map.gate.period;
  }

  function gateOpenAt(map, x, y, t) {
    const gates = Array.isArray(map.gates) ? map.gates : [map.gate];
    for (const g of gates) {
      if (g.x === x && g.y === y) {
        return t % g.period === g.openAt;
      }
    }
    return false;
  }

  function passableCell(map, x, y, t) {
    if (!inBounds(map, x, y)) return false;
    const cell = map.grid[y][x];
    if (cell === T.WALL || cell === T.BREAKABLE) return false;
    if (cell === T.GATE) return gateOpenAt(map, x, y, t);
    return true;
  }

  /*
   * 时间扩展 BFS：状态 = (x, y, t mod L)，L 为闸门周期。
   * 每个 tick 可移动到相邻格，或原地等待一个 tick。
   * 返回含 waitTicks 标记的路径（到达目标即停止，天然给出最短时间）。
   */
  function timeBfs(map, target) {
    const period = gatePeriod(map);
    const start = map.start;
    const startState = { x: start.x, y: start.y, t: 0 };
    const parent = new Map();
    const startKey = stateKey(start.x, start.y, 0, period);
    parent.set(startKey, null);
    const queue = [startState];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]];

    while (queue.length) {
      const cur = queue.shift();
      if (cur.x === target.x && cur.y === target.y) {
        return reconstructTimePath(parent, cur, period);
      }
      for (const d of dirs) {
        const nx = cur.x + d[0];
        const ny = cur.y + d[1];
        const nt = cur.t + 1;
        if (!passableCell(map, nx, ny, nt)) continue;
        const sk = stateKey(nx, ny, nt % period, period);
        if (parent.has(sk)) continue;
        parent.set(sk, {
          x: cur.x, y: cur.y, t: cur.t % period,
          wait: d[0] === 0 && d[1] === 0
        });
        queue.push({ x: nx, y: ny, t: nt });
      }
    }
    return null;
  }

  function stateKey(x, y, t, period) {
    return (y * 1000 + x) * period + t;
  }

  function reconstructTimePath(parent, endState, period) {
    const steps = [];
    let sk = stateKey(endState.x, endState.y, endState.t % period, period);
    while (sk !== null) {
      const info = parent.get(sk);
      steps.push({ stateKey: sk, parent: info });
      if (info === null) break;
      sk = stateKey(info.x, info.y, info.t, period);
    }
    steps.reverse();
    const path = [];
    for (const step of steps) {
      const cellIndex = Math.floor(step.stateKey / period);
      const x = cellIndex % 1000;
      const y = Math.floor(cellIndex / 1000);
      path.push({
        x: x,
        y: y,
        t: path.length,
        wait: step.parent ? step.parent.wait : false
      });
    }
    return path;
  }

  /*
   * 全量可达性分析：每次编辑后必须重新调用。
   * 每个目标给出 static / gate / unreachable 三态、路径与失败原因。
   */
  function analyzeMap(map) {
    const staticSeen = floodComponent(map, map.start, false);
    const breakSeen = floodComponent(map, map.start, true);
    return map.goals.map(function (goal) {
      const result = {
        goal: goal,
        status: STATUS.UNREACHABLE,
        path: null,
        reason: null,
        suggestedBreak: null
      };

      if (staticSeen.has(key(goal.x, goal.y))) {
        result.status = STATUS.STATIC;
        result.path = floodPath(map, map.start, goal, false);
        return result;
      }

      const timePath = timeBfs(map, goal);
      if (timePath) {
        result.status = STATUS.GATE;
        result.path = timePath;
        result.reason = '静态路径被闸门隔断，需在闸门前等待周期开放（共等待 ' +
          countWaits(timePath) + ' tick）';
        return result;
      }

      result.reason = unreachableReason(map, goal, staticSeen, breakSeen);
      return result;
    });
  }

  function countWaits(path) {
    return path.filter(function (p) { return p.wait; }).length;
  }

  function unreachableReason(map, goal, staticSeen, breakSeen) {
    if (breakSeen.has(key(goal.x, goal.y))) {
      const blockers = findBreakableBlockers(map, goal, staticSeen);
      if (blockers.length) {
        const b = blockers[0];
        return '被可破坏墙体封死；删除 (' + b.x + ',' + b.y + ') 处墙体后可达';
      }
      return '被可破坏墙体封死，删除相应墙体后可达';
    }
    if (behindClosedGate(map, goal)) {
      return '位于闸门后方且时间扩展搜索无可达路径';
    }
    return '被静态墙完全封闭，静态墙不可编辑，永久不可达';
  }

  function findBreakableBlockers(map, goal, staticSeen) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const found = [];
    for (const entry of staticSeen.keys()) {
      const x = entry % 1000;
      const y = Math.floor(entry / 1000);
      for (const d of dirs) {
        const nx = x + d[0];
        const ny = y + d[1];
        if (inBounds(map, nx, ny) && map.grid[ny][nx] === T.BREAKABLE) {
          const trial = cloneGrid(map.grid);
          trial[ny][nx] = T.FLOOR;
          const probe = Object.assign({}, map, { grid: trial });
          if (floodPath(probe, map.start, goal, false)) {
            found.push({ x: nx, y: ny });
          }
        }
      }
    }
    return found;
  }

  function behindClosedGate(map, goal) {
    const gates = Array.isArray(map.gates) ? map.gates : [map.gate];
    return gates.some(function (g) {
      return goal.x > g.x;
    });
  }

  /* ---------- 编辑操作（每次都会在 UI 层触发全量重新分析） ---------- */

  function editCount(map) {
    return map.editLog.length;
  }

  function canEdit(map) {
    return map.editLog.length < MAX_EDITS;
  }

  function applyEdit(map, action) {
    if (!canEdit(map)) {
      throw new Error('编辑预算已用完（最多 ' + MAX_EDITS + ' 次）');
    }
    const record = {
      seq: map.editLog.length + 1,
      type: action.type,
      at: { x: action.x, y: action.y },
      before: map.grid[action.y][action.x],
      to: action.to || null,
      timestamp: new Date().toISOString()
    };

    if (action.type === 'delete') {
      if (map.grid[action.y][action.x] !== T.BREAKABLE) {
        throw new Error('只能删除可破坏墙体');
      }
      map.grid[action.y][action.x] = T.FLOOR;
    } else if (action.type === 'move') {
      if (map.grid[action.y][action.x] !== T.BREAKABLE) {
        throw new Error('只能移动可破坏墙体');
      }
      if (map.grid[action.to.y][action.to.x] !== T.FLOOR) {
        throw new Error('目标格必须是空地');
      }
      map.grid[action.y][action.x] = T.FLOOR;
      map.grid[action.to.y][action.to.x] = T.BREAKABLE;
    } else {
      throw new Error('未知编辑类型: ' + action.type);
    }

    map.editLog.push(record);
    return record;
  }

  function undoLastEdit(map) {
    const record = map.editLog.pop();
    if (!record) return null;
    if (record.type === 'delete') {
      map.grid[record.at.y][record.at.x] = T.BREAKABLE;
    } else {
      map.grid[record.to.y][record.to.x] = T.FLOOR;
      map.grid[record.at.y][record.at.x] = T.BREAKABLE;
    }
    return record;
  }

  return {
    T: T,
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    MAX_EDITS: MAX_EDITS,
    STATUS: STATUS,
    mulberry32: mulberry32,
    generateMap: generateMap,
    cloneGrid: cloneGrid,
    analyzeMap: analyzeMap,
    floodPath: floodPath,
    timeBfs: timeBfs,
    gateOpenAt: gateOpenAt,
    applyEdit: applyEdit,
    undoLastEdit: undoLastEdit,
    editCount: editCount,
    canEdit: canEdit
  };
});

