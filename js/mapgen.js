// Seeded map generator for the mini game.
// A map contains: obstacles (blocking), goals, decorations (non-blocking),
// nav nodes (waypoints) and a placement log used for blockage forensics.

import { makeRng } from "./prng.js";

export const MAP_W = 24;
export const MAP_H = 16;
export const OBSTACLE_RATIO = 0.14;
export const GOAL_COUNT = 4;
export const DECORATION_COUNT = 22;
export const NAV_STEP = 3;
export const START = { x: 1, y: 1 };

export function cellKey(x, y) {
  return x + "," + y;
}

function isBorder(x, y) {
  return x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
}

export function generateMap(seed) {
  const rng = makeRng(seed);
  const obstacles = new Set();
  const placements = []; // ordered log: {index, type, x, y}
  let idx = 0;

  // Border walls.
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (isBorder(x, y)) {
        obstacles.add(cellKey(x, y));
        placements.push({ index: idx++, type: "wall", x, y });
      }
    }
  }

  // Random interior obstacles. Keep the start cell and its neighbours free.
  const interior = [];
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      if (Math.abs(x - START.x) <= 1 && Math.abs(y - START.y) <= 1) continue;
      interior.push({ x, y });
    }
  }
  const target = Math.floor(interior.length * OBSTACLE_RATIO);
  let placed = 0;
  while (placed < target) {
    const c = interior[Math.floor(rng() * interior.length)];
    const k = cellKey(c.x, c.y);
    if (obstacles.has(k)) continue;
    obstacles.add(k);
    placements.push({ index: idx++, type: "obstacle", x: c.x, y: c.y });
    placed++;
  }

  // Goals on free cells, at least 5 steps (Manhattan) from start.
  const goals = [];
  let guard = 0;
  while (goals.length < GOAL_COUNT && guard++ < 5000) {
    const x = 1 + Math.floor(rng() * (MAP_W - 2));
    const y = 1 + Math.floor(rng() * (MAP_H - 2));
    const k = cellKey(x, y);
    if (obstacles.has(k)) continue;
    if (Math.abs(x - START.x) + Math.abs(y - START.y) < 5) continue;
    if (goals.some((g) => g.x === x && g.y === y)) continue;
    goals.push({ id: goals.length, x, y });
  }

  // Decorations on free, non-goal cells (purely visual, never block).
  const decorations = [];
  guard = 0;
  while (decorations.length < DECORATION_COUNT && guard++ < 5000) {
    const x = 1 + Math.floor(rng() * (MAP_W - 2));
    const y = 1 + Math.floor(rng() * (MAP_H - 2));
    const k = cellKey(x, y);
    if (obstacles.has(k)) continue;
    if (goals.some((g) => g.x === x && g.y === y)) continue;
    if (decorations.some((d) => d.x === x && d.y === y)) continue;
    decorations.push({ x, y, kind: Math.floor(rng() * 3) });
  }

  // Nav nodes: a coarse lattice over free cells.
  const navNodes = [];
  for (let y = 1; y < MAP_H - 1; y += NAV_STEP) {
    for (let x = 1; x < MAP_W - 1; x += NAV_STEP) {
      if (!obstacles.has(cellKey(x, y))) navNodes.push({ x, y });
    }
  }

  return { seed: String(seed), width: MAP_W, height: MAP_H, obstacles, goals, decorations, navNodes, placements };
}
