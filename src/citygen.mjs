import { makeRng } from './rng.mjs';
import { USAGE_TYPES } from './palette.mjs';

export const GRID = 4; // 4 x 4 lots
export const LOT_SPACING = 18;
export const GROUND_SIZE = GRID * LOT_SPACING + 6;
export const GROUND_THICKNESS = 4;
export const PIPE_Y = -2.6;

// World-space center of a grid column/row.
export function gridAxis(index) {
  return (index - (GRID - 1) / 2) * LOT_SPACING;
}

export function buildingHeight(b) {
  return b.floors * b.floorHeight;
}

export function generateCity(seed) {
  const rng = makeRng(seed);
  const half = GROUND_SIZE / 2;
  const buildingCount = rng.int(11, 15);
  const lotCount = GRID * GRID;
  const lotOrder = Array.from({ length: lotCount }, (_, i) => i);
  for (let i = lotOrder.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [lotOrder[i], lotOrder[j]] = [lotOrder[j], lotOrder[i]];
  }
  const chosen = lotOrder.slice(0, Math.max(10, buildingCount)).sort((a, b) => a - b);

  const buildings = chosen.map((lot, ord) => {
    const gx = lot % GRID;
    const gy = Math.floor(lot / GRID);
    const width = rng.range(9, 13);
    const depth = rng.range(9, 13);
    return {
      id: `B${String(ord + 1).padStart(2, '0')}`,
      lot,
      gx,
      gy,
      x: gridAxis(gx),
      z: gridAxis(gy),
      width,
      depth,
      floors: rng.int(2, 9),
      floorHeight: rng.range(3, 4.2),
      usage: rng.pick(USAGE_TYPES),
      shade: rng.int(-14, 14),
      hasBasement: rng.next() > 0.45,
    };
  });

  const pipes = [];
  const axes = Array.from({ length: GRID }, (_, i) => gridAxis(i));
  const edge = gridAxis(GRID - 1) + LOT_SPACING / 2;
  for (const a of axes) {
    // Horizontal trunk (runs along Z) and lateral trunk (runs along X).
    pipes.push({ from: [a, PIPE_Y, -edge], to: [a, PIPE_Y, edge], radius: 0.32 });
    pipes.push({ from: [-edge, PIPE_Y, a], to: [edge, PIPE_Y, a], radius: 0.32 });
  }

  const vaults = [];
  for (const x of axes) {
    for (const z of axes) {
      vaults.push({ x, y: PIPE_Y, z, size: 1.6 });
    }
  }

  return {
    seed: String(seed),
    version: 1,
    bounds: {
      minX: -half,
      maxX: half,
      minY: -GROUND_THICKNESS,
      maxY: 42,
      minZ: -half,
      maxZ: half,
    },
    ground: { size: GROUND_SIZE, thickness: GROUND_THICKNESS },
    buildings,
    pipes,
    vaults,
  };
}

export function replaceBuilding(model, updated) {
  const buildings = model.buildings.map((b) => (b.id === updated.id ? { ...b, ...updated } : b));
  return { ...model, buildings };
}
