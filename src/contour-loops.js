// Turn marching-squares chains into closed plan-view polygons by joining
// border endpoints along the terrain perimeter.

import { joinChains, boundaryParam, boundaryPoint } from './marching.js';

export function buildPlanLoops(segments) {
  const chains = joinChains(segments);
  const loops = [];
  const openChains = [];
  for (const chain of chains) {
    if (chain.closed) {
      loops.push(chain.points.map((p) => [p[0], p[2]]));
    } else {
      openChains.push(chain);
    }
  }
  if (openChains.length === 0) return loops;

  // Every open chain is closed by tracing the perimeter backward from its tail
  // crossing back to its head crossing; winding keeps the "above" region inside.
  for (const chain of openChains) {
    const headT = boundaryParam(chain.points[0]);
    const tailT = boundaryParam(chain.points[chain.points.length - 1]);
    const loop = chain.points.map((p) => [p[0], p[2]]);
    appendPerimeterArc(loop, tailT, headT);
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function appendPerimeterArc(loop, tFrom, tTo) {
  const span = (tFrom - tTo + 8) % 8;
  const steps = Math.max(2, Math.ceil(span * 8));
  for (let k = 1; k <= steps; k++) {
    if (k === steps) {
      loop.push([...loop[0]]);
    } else {
      const t = (tFrom - (span * k) / steps + 80) % 8;
      const [x, z] = boundaryPoint(t);
      loop.push([x, z]);
    }
  }
}

export function fullTerrainPolygon() {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
}
