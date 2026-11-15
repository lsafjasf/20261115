// Top-level validation pipeline: generate the map RUNS times, compare
// per-layer hashes, check goal reachability, and on failure locate the
// blocking placement and propose a repaired seed.

import { generateMap, cellKey } from "./mapgen.js";
import {
  RUNS,
  hashLayers,
  findPath,
  locateBlockingPlacement,
  findFixedSeed,
} from "./validator.js";

const LAYERS = ["obstacles", "goals", "decorations", "navNodes"];

export function validateSeed(seed) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const map = generateMap(seed);
    runs.push({ run: i + 1, map, hashes: hashLayers(map) });
  }

  const determinism = {};
  let deterministic = true;
  for (const layer of LAYERS) {
    const values = runs.map((r) => r.hashes[layer]);
    const ok = values.every((v) => v === values[0]);
    determinism[layer] = { ok, hashes: values };
    if (!ok) deterministic = false;
  }

  const map = runs[0].map;
  const goalResults = map.goals.map((g) => {
    const path = findPath(map, g.x, g.y);
    return {
      goal: g,
      reachable: path !== null,
      pathLength: path ? path.length - 1 : null,
      path,
    };
  });

  const unreachable = goalResults.filter((r) => !r.reachable);
  const blockers = unreachable.map((r) => ({
    goal: r.goal,
    placement: locateBlockingPlacement(map, r.goal),
  }));

  let fix = null;
  if (unreachable.length > 0) {
    fix = findFixedSeed(seed);
  }

  return {
    seed: String(seed),
    runs,
    determinism,
    deterministic,
    goalResults,
    unreachable,
    blockers,
    fix,
    ok: deterministic && unreachable.length === 0,
  };
}

// Cell-level diff between run A and run B for a given layer.
// Returns {onlyA: [...keys], onlyB: [...keys]}.
export function diffLayer(mapA, mapB, layer) {
  const toKeys = (m) => {
    if (layer === "obstacles") return new Set(m.obstacles);
    const list =
      layer === "goals" ? m.goals :
      layer === "decorations" ? m.decorations :
      m.navNodes;
    return new Set(list.map((p) => cellKey(p.x, p.y)));
  };
  const a = toKeys(mapA);
  const b = toKeys(mapB);
  return {
    onlyA: [...a].filter((k) => !b.has(k)),
    onlyB: [...b].filter((k) => !a.has(k)),
  };
}
