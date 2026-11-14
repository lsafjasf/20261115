import { T, DIR } from './layout.js';
import { HEAVY_SMOKE as HS, TICK_S } from './sim.js';

function legalMove(sim, fromR, fromC, toR, toC) {
  const L = sim.layout;
  if (toR < 0 || toC < 0 || toR >= L.rows || toC >= L.cols) return false;
  if (L.cells[toR][toC] === T.WALL) return false;
  if (sim.smoke[toR][toC] >= HS) return false;

  // 穿越受控通道/闸门时校验通行方向
  const ctl = sim.controlAt(toR, toC) || sim.controlAt(fromR, fromC);
  if (ctl && (toR !== fromR)) {
    const goingUp = toR < fromR;
    if (ctl.dir === DIR.CLOSED) return false;
    if (goingUp && ctl.dir === DIR.DOWN) return false;
    if (!goingUp && ctl.dir === DIR.UP) return false;
  }
  return true;
}

// 多源 Dijkstra：每个格子到最近出口的最小代价距离
export function recomputeField(sim) {
  const L = sim.layout;
  const dist = sim.field;
  for (let r = 0; r < L.rows; r++) dist[r].fill(Infinity);

  const queue = [];
  for (const ex of L.exits) {
    dist[ex.row][ex.col] = 0;
    queue.push([0, ex.row, ex.col]);
  }

  while (queue.length) {
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i][0] < queue[bestIdx][0]) bestIdx = i;
    }
    const [d, r, c] = queue.splice(bestIdx, 1)[0];
    if (d > dist[r][c]) continue;
    const dirs = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    for (const [nr, nc] of dirs) {
      if (nr < 0 || nc < 0 || nr >= L.rows || nc >= L.cols) continue;
      if (!legalMove(sim, nr, nc, r, c)) continue; // nr,nc 能否走到当前格
      const occ = sim.occupancy[nr][nc] || 0;
      const smoke = sim.smoke[nr][nc] || 0;
      // 整数化代价，避免 Float32 舍入导致陈旧条目判断误杀
      const w = Math.round((1 + occ * 0.35 + smoke * 0.6) * 1000);
      const nd = d + w;
      if (nd < dist[nr][nc]) {
        dist[nr][nc] = nd;
        queue.push([nd, nr, nc]);
      }
    }
  }
}

export function moveAgents(sim) {
  const L = sim.layout;
  // 实时占用（整数格），供统计使用
  for (let r = 0; r < L.rows; r++) sim.occupancy[r].fill(0);
  for (const a of sim.agents) sim.occupancy[a.row][a.col] += 1;

  // 连续位置下的局部人数：半径 0.8 格内的乘客密度，用于真实减速
  const localCrowd = (x, y) => {
    let n = 0;
    for (const o of sim.agents) {
      if (o === undefined) continue;
      if (Math.abs(o.x - x) <= 0.8 && Math.abs(o.y - y) <= 0.8) n += 1;
    }
    return Math.max(0, n - 1);
  };

  const remaining = [];
  for (const a of sim.agents) {
    if (L.cells[a.row][a.col] === T.EXIT) {
      sim.evacuated += 1;
      a.evacTick = sim.tick;
      continue;
    }

    // 选择场值最小的合法邻居
    let best = null;
    const options = [[a.row - 1, a.col], [a.row + 1, a.col], [a.row, a.col - 1], [a.row, a.col + 1]];
    for (const [nr, nc] of options) {
      if (!legalMove(sim, a.row, a.col, nr, nc)) continue;
      const d = sim.field[nr][nc];
      if (!isFinite(d)) continue;
      if (!best || d < best.d) best = { r: nr, c: nc, d };
    }
    if (!best) { remaining.push(a); continue; } // 无路可走，原地等待

    const targetOcc = localCrowd(best.c + 0.5, best.r + 0.5);
    const targetSmoke = sim.smoke[best.r][best.c] || 0;
    const jamFactor = 1 / (1 + 0.3 * Math.max(0, targetOcc - 1));
    const smokeFactor = targetSmoke > 1 ? 0.55 : 1;
    const speed = a.speed * jamFactor * smokeFactor; // 格/秒
    const stepLen = speed * TICK_S;

    const tx = best.c + 0.5;
    const ty = best.r + 0.5;
    const dx = tx - a.x;
    const dy = ty - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= stepLen || dist === 0) {
      a.x = tx; a.y = ty;
      a.row = best.r; a.col = best.c;
    } else {
      a.x += (dx / dist) * stepLen;
      a.y += (dy / dist) * stepLen;
    }
    remaining.push(a);
  }
  sim.agents = remaining;
}
