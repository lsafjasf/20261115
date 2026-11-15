// 迷宫生成与声源布局：一切由 seed 决定，仿真与复盘平面图共用同一份数据
import { makeRng } from './rng.js';

// 材质决定脚步声的频段、衰减与混响（audio.js 与复盘展示共用）
export const MATERIALS = {
  stone: { label: '石材', band: 900, q: 1.1, decay: 0.09, reverbTime: 1.6, wetMix: 0.45 },
  metal: { label: '金属', band: 2400, q: 6.0, decay: 0.05, reverbTime: 2.4, wetMix: 0.65 },
  wood: { label: '木质', band: 480, q: 0.8, decay: 0.15, reverbTime: 0.7, wetMix: 0.28 },
  wet: { label: '潮湿混凝土', band: 1400, q: 2.0, decay: 0.07, reverbTime: 2.1, wetMix: 0.55 },
};
export const MATERIAL_KEYS = Object.keys(MATERIALS);

const DIRS = [
  { dx: 0, dy: -1, bit: 1, opp: 4 }, // N
  { dx: 1, dy: 0, bit: 2, opp: 8 }, // E
  { dx: 0, dy: 1, bit: 4, opp: 1 }, // S
  { dx: -1, dy: 0, bit: 8, opp: 2 }, // W
];

export function generateMaze(seed, opts = {}) {
  const width = opts.width ?? 12;
  const height = opts.height ?? 9;
  const rng = makeRng(seed);

  // 每个 cell 的 open 位掩码：1=N 2=E 4=S 8=W
  const cells = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) row.push({ x, y, open: 0, material: 'stone' });
    cells.push(row);
  }

  // 递归回溯（迭代版）雕刻通道
  const visited = new Set(['0,0']);
  const stack = [cells[0][0]];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = DIRS.filter((d) => {
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      return nx >= 0 && ny >= 0 && nx < width && ny < height && !visited.has(nx + ',' + ny);
    });
    if (!options.length) { stack.pop(); continue; }
    const d = rng.pick(options);
    const nxt = cells[cur.y + d.dy][cur.x + d.dx];
    cur.open |= d.bit;
    nxt.open |= d.opp;
    visited.add(nxt.x + ',' + nxt.y);
    stack.push(nxt);
  }

  // 随机打通少量额外墙，形成环路，让"听声绕路"有替代路线
  const extra = Math.floor(width * height * 0.08);
  for (let i = 0; i < extra; i++) {
    const x = rng.int(0, width - 1), y = rng.int(0, height - 1);
    const d = rng.pick(DIRS);
    const nx = x + d.dx, ny = y + d.dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    cells[y][x].open |= d.bit;
    cells[ny][nx].open |= d.opp;
  }

  // 材质分区：多源 BFS（Voronoi），同一区域材质一致
  const zoneCount = Math.min(MATERIAL_KEYS.length, 4);
  const zoneSeeds = [];
  while (zoneSeeds.length < zoneCount) {
    const zx = rng.int(0, width - 1), zy = rng.int(0, height - 1);
    if (!zoneSeeds.some((z) => z.x === zx && z.y === zy)) zoneSeeds.push({ x: zx, y: zy });
  }
  const owner = Array.from({ length: height }, () => new Array(width).fill(-1));
  const queue = zoneSeeds.map((z, i) => ({ ...z, zone: i }));
  for (const q of queue) owner[q.y][q.x] = q.zone;
  while (queue.length) {
    const cur = queue.shift();
    const cell = cells[cur.y][cur.x];
    for (const d of DIRS) {
      if (!(cell.open & d.bit)) continue;
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      if (owner[ny][nx] !== -1) continue;
      owner[ny][nx] = cur.zone;
      queue.push({ x: nx, y: ny, zone: cur.zone });
    }
  }
  const zoneMaterial = rng.shuffle([...MATERIAL_KEYS]).slice(0, zoneCount);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      cells[y][x].material = zoneMaterial[owner[y][x] ?? 0];

  const start = { x: 0, y: 0 };
  const dist = bfsDistances(cells, width, height, start);

  // 出口：离起点 BFS 距离最远的格子
  let exit = start, best = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (dist[y][x] > best) { best = dist[y][x]; exit = { x, y }; }

  // 录音芯片：距起点较远且彼此分散的 3 格
  const farCells = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (dist[y][x] >= 3 && !(x === exit.x && y === exit.y)) farCells.push({ x, y, d: dist[y][x] });
  farCells.sort((a, b) => b.d - a.d);
  const chips = [];
  for (const c of farCells) {
    if (chips.length >= 3) break;
    if (chips.every((p) => gridDist(cells, width, height, p, c) >= 4)) chips.push({ x: c.x, y: c.y });
  }
  for (const c of farCells) { // 兜底：放宽间距
    if (chips.length >= 3) break;
    if (!chips.some((p) => p.x === c.x && p.y === c.y)) chips.push({ x: c.x, y: c.y });
  }

  // 环境声源：滴水与机械噪声，避开起点/出口/芯片
  const reserved = new Set([start, exit, ...chips].map((p) => p.x + ',' + p.y));
  const freeCells = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (!reserved.has(x + ',' + y)) freeCells.push({ x, y });
  rng.shuffle(freeCells);
  const drips = freeCells.splice(0, 3).map((p, i) => ({ ...p, kind: 'drip', id: 'drip' + i }));
  const machines = freeCells.splice(0, 2).map((p, i) => ({ ...p, kind: 'machine', id: 'machine' + i }));

  const maze = {
    seed, width, height, cells, start, exit, chips,
    sources: [...drips, ...machines],
  };
  maze.correctPath = computeCorrectPath(maze);
  return maze;
}

export function bfsDistances(cells, width, height, from) {
  const dist = Array.from({ length: height }, () => new Array(width).fill(Infinity));
  dist[from.y][from.x] = 0;
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    const cell = cells[cur.y][cur.x];
    for (const d of DIRS) {
      if (!(cell.open & d.bit)) continue;
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      if (dist[ny][nx] !== Infinity) continue;
      dist[ny][nx] = dist[cur.y][cur.x] + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

function gridDist(cells, width, height, a, b) {
  return bfsDistances(cells, width, height, a)[b.y][b.x];
}

// 两格之间的最短路径（含端点），返回格子坐标数组；blocked 为禁止经过的格子
export function bfsPath(cells, width, height, from, to, blocked = null) {
  const isBlocked = (x, y) =>
    blocked && blocked.has(x + ',' + y) && !(x === to.x && y === to.y) &&
    !(x === from.x && y === from.y);
  const prev = new Map();
  const seen = new Set([from.x + ',' + from.y]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.x === to.x && cur.y === to.y) break;
    const cell = cells[cur.y][cur.x];
    for (const d of DIRS) {
      if (!(cell.open & d.bit)) continue;
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      const key = nx + ',' + ny;
      if (seen.has(key) || isBlocked(nx, ny)) continue;
      seen.add(key);
      prev.set(key, cur);
      queue.push({ x: nx, y: ny });
    }
  }
  const path = [{ x: to.x, y: to.y }];
  while (path[0].x !== from.x || path[0].y !== from.y) {
    const p = prev.get(path[0].x + ',' + path[0].y);
    if (!p) return null;
    path.unshift(p);
  }
  return path;
}

// 正确路径：从起点出发，最近邻顺序收集全部芯片后抵达出口
export function computeCorrectPath(maze) {
  const { cells, width, height, start, exit, chips } = maze;
  const remaining = [...chips];
  const waypoints = [];
  let cur = start;
  // 末段之前禁止经过出口格，避免收齐芯片前误触出口判定
  const blocked = new Set([exit.x + ',' + exit.y]);
  while (remaining.length) {
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = gridDist(cells, width, height, cur, remaining[i]);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    const next = remaining.splice(bestI, 1)[0];
    const seg = bfsPath(cells, width, height, cur, next, blocked);
    waypoints.push(...(waypoints.length ? seg.slice(1) : seg));
    cur = next;
  }
  const seg = bfsPath(cells, width, height, cur, exit);
  waypoints.push(...seg.slice(1));
  return waypoints;
}

// 把连续墙体整理成线段列表，供碰撞检测与平面图绘制共用
export function wallSegments(maze) {
  const { width, height, cells } = maze;
  const segs = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = cells[y][x];
      if (!(c.open & 1)) segs.push({ x1: x, y1: y, x2: x + 1, y2: y, material: c.material });
      if (!(c.open & 8)) segs.push({ x1: x, y1: y, x2: x, y2: y + 1, material: c.material });
      if (y === height - 1 && !(c.open & 4))
        segs.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1, material: c.material });
      if (x === width - 1 && !(c.open & 2))
        segs.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, material: c.material });
    }
  }
  return segs;
}
