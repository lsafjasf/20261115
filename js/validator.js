// Map validator: determinism hashing, reachability, blockage forensics,
// and repaired-seed search.

import { digest } from "./prng.js";
import { generateMap, cellKey, START } from "./mapgen.js";

export const RUNS = 3;

function sortedCells(set) {
  return [...set].sort();
}

function pointsToString(points) {
  return points.map((p) => cellKey(p.x, p.y)).sort().join(";");
}

// Per-layer hashes of one generated map.
export function hashLayers(map) {
  return {
    obstacles: digest(sortedCells(map.obstacles).join(";")),
    goals: digest(pointsToString(map.goals)),
    decorations: digest(
      map.decorations.map((d) => cellKey(d.x, d.y) + "#" + d.kind).sort().join(";")
    ),
    navNodes: digest(pointsToString(map.navNodes)),
  };
}

// Breadth-first search from START to (tx, ty). Returns path array or null.
export function findPath(map, tx, ty) {
  const start = cellKey(START.x, START.y);
  const target = cellKey(tx, ty);
  if (map.obstacles.has(target)) return null;
  const prev = new Map([[start, null]]);
  const queue = [[START.x, START.y]];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length) {
    const [cx, cy] = queue.shift();
    if (cellKey(cx, cy) === target) {
      const path = [];
      let k = target;
      while (k) {
        const [px, py] = k.split(",").map(Number);
        path.push({ x: px, y: py });
        k = prev.get(k);
      }
      return path.reverse();
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nk = cellKey(nx, ny);
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (map.obstacles.has(nk) || prev.has(nk)) continue;
      prev.set(nk, cellKey(cx, cy));
      queue.push([nx, ny]);
    }
  }
  return null;
}

// Replay obstacle placements one by one and find the first placement
// that makes the given goal unreachable from START.
export function locateBlockingPlacement(map, goal) {
  const probe = {
    width: map.width,
    height: map.height,
    obstacles: new Set(),
  };
  for (const p of map.placements) {
    probe.obstacles.add(cellKey(p.x, p.y));
    if (p.type !== "obstacle" && p.type !== "wall") continue;
    if (!findPath(probe, goal.x, goal.y)) {
      return p;
    }
  }
  return null;
}

// Find the next seed (numerically, if numeric) whose map is fully reachable.
export function findFixedSeed(seed, maxTries = 500) {
  const numeric = /^\d+$/.test(String(seed));
  for (let i = 1; i <= maxTries; i++) {
    const candidate = numeric ? String(BigInt(seed) + BigInt(i)) : `${seed}-fix${i}`;
    const map = generateMap(candidate);
    if (map.goals.every((g) => findPath(map, g.x, g.y))) {
      return { seed: candidate, tries: i };
    }
  }
  return null;
}
