import { MAP_GEOMETRY, weightedMean } from "./data.js";

export function normalizeRect(startX, startY, endX, endY) {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    w: Math.abs(endX - startX),
    h: Math.abs(endY - startY),
  };
}

export function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

export function buildingsInRect(buildings, rect) {
  return buildings.filter((building) => intersectionArea(building.world, rect) > 0);
}

export function calculateSelectionStats(rect, period, buildings = MAP_GEOMETRY.buildings) {
  const selected = buildingsInRect(buildings, rect);
  if (!selected.length) {
    return {
      rect,
      selectedIds: [],
      buildings: [],
      count: 0,
      average: null,
      min: null,
      max: null,
      area: 0,
      delta: null,
      hottest: null,
    };
  }

  let area = 0;
  let total = 0;
  let min = Infinity;
  let max = -Infinity;
  let hottest = null;

  for (const building of selected) {
    const roofArea = building.world.w * building.world.h;
    const temperature = building.temperatures[period];
    area += roofArea;
    total += temperature * roofArea;
    if (temperature < min) min = temperature;
    if (temperature > max) {
      max = temperature;
      hottest = building;
    }
  }

  const average = total / area;
  const mapAverage = weightedMean(buildings, period);
  return {
    rect,
    selectedIds: selected.map((building) => building.id),
    buildings: selected,
    count: selected.length,
    average,
    min,
    max,
    area,
    delta: average - mapAverage,
    hottest,
  };
}

export function statsConsistencyCheck(stats, period) {
  if (!stats.count) {
    return stats.selectedIds.length === 0 && stats.average === null;
  }

  const byId = new Map(stats.buildings.map((building) => [building.id, building]));
  const sameBuildings = stats.selectedIds.every((id) => byId.has(id));
  let area = 0;
  let total = 0;

  for (const id of stats.selectedIds) {
    const building = byId.get(id);
    if (!building) continue;
    const roofArea = building.world.w * building.world.h;
    area += roofArea;
    total += building.temperatures[period] * roofArea;
  }

  const recomputed = area ? total / area : null;
  return sameBuildings
    && area === stats.area
    && Math.abs(recomputed - stats.average) < 1e-9;
}
