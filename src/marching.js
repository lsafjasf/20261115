// Marching squares over the regular heightfield.
// Corners: 0=(i,j) 1=(i+1,j) 2=(i+1,j+1) 3=(i,j+1).
// Edges: 0=bottom, 1=right, 2=top, 3=left.

import { gridPoint } from './terrain.js';

const KEY_EPS = 1e7;

function pointKey(p) {
  return `${Math.round(p[0] * KEY_EPS)},${Math.round(p[1] * KEY_EPS)},${Math.round(
    p[2] * KEY_EPS,
  )}`;
}

function edgePoint(field, i, j, edge, level) {
  const corners = [
    [i, j],
    [i + 1, j],
    [i + 1, j + 1],
    [i, j + 1],
  ];
  const pairs = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ];
  const [a, b] = pairs[edge];
  const pa = gridPoint(field, corners[a][0], corners[a][1]);
  const pb = gridPoint(field, corners[b][0], corners[b][1]);
  const raw = (level - pa[1]) / (pb[1] - pa[1]);
  const t = Math.max(0, Math.min(1, raw));
  return [
    pa[0] + (pb[0] - pa[0]) * t,
    level,
    pa[2] + (pb[2] - pa[2]) * t,
  ];
}

// Segment pairs per 4-bit case (unordered; saddles emit two).
const CASE_TABLE = {
  1: [[3, 0]],
  2: [[0, 1]],
  3: [[3, 1]],
  4: [[1, 2]],
  5: [[3, 2], [0, 1]],
  6: [[0, 2]],
  7: [[3, 2]],
  8: [[2, 3]],
  9: [[0, 2]],
  10: [[0, 3], [1, 2]],
  11: [[1, 2]],
  12: [[1, 3]],
  13: [[0, 1]],
  14: [[2, 3]],
};

// Ordered polygon of the "above level" region inside one cell, then fan it.
function aboveTriangles(field, i, j, caseIndex, level) {
  if (caseIndex === 0) return [];
  if (caseIndex === 15) {
    const p0 = gridPoint(field, i, j);
    const p1 = gridPoint(field, i + 1, j);
    const p2 = gridPoint(field, i + 1, j + 1);
    const p3 = gridPoint(field, i, j + 1);
    return [p0, p1, p2, p0, p2, p3];
  }
  const cornerAbove = [
    caseIndex & 1,
    caseIndex & 2,
    caseIndex & 4,
    caseIndex & 8,
  ];
  const polygon = [];
  for (let edge = 0; edge < 4; edge++) {
    const start = edge;
    const end = (edge + 1) % 4;
    if (cornerAbove[start]) {
      const ci = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ][start];
      polygon.push(gridPoint(field, ci[0], ci[1]));
    }
    if (cornerAbove[start] !== cornerAbove[end]) {
      polygon.push(edgePoint(field, i, j, edge, level));
    }
  }
  const triangles = [];
  for (let k = 1; k < polygon.length - 1; k++) {
    triangles.push(polygon[0], polygon[k], polygon[k + 1]);
  }
  return triangles;
}

export function contourAtLevel(field, level) {
  const segments = [];
  const triangles = [];
  const { resolution, n, heights } = field;
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const h00 = heights[j * n + i];
      const h10 = heights[j * n + i + 1];
      const h11 = heights[(j + 1) * n + i + 1];
      const h01 = heights[(j + 1) * n + i];
      const caseIndex =
        (h00 >= level ? 1 : 0) |
        (h10 >= level ? 2 : 0) |
        (h11 >= level ? 4 : 0) |
        (h01 >= level ? 8 : 0);
      if (caseIndex === 0) continue;
      const pairs = CASE_TABLE[caseIndex] ?? [];
      for (const [ea, eb] of pairs) {
        segments.push([
          edgePoint(field, i, j, ea, level),
          edgePoint(field, i, j, eb, level),
        ]);
      }
      triangles.push(...aboveTriangles(field, i, j, caseIndex, level));
    }
  }
  return { segments, triangles, level };
}

// Stitch raw segments into closed loops and open (border-touching) chains.
export function joinChains(segments) {
  const nodeMap = new Map();
  const nodes = [];
  function nodeOf(point) {
    const key = pointKey(point);
    let id = nodeMap.get(key);
    if (id === undefined) {
      id = nodes.length;
      nodeMap.set(key, id);
      nodes.push({ point, edges: [] });
    }
    return id;
  }
  const edges = segments.map((seg) => {
    const a = nodeOf(seg[0]);
    const b = nodeOf(seg[1]);
    const edge = { a, b, used: false };
    nodes[a].edges.push(edge);
    nodes[b].edges.push(edge);
    return edge;
  });
  const chains = [];
  for (const startEdge of edges) {
    if (startEdge.used) continue;
    const chain = [];
    let edge = startEdge;
    let current = edge.a;
    while (edge && !edge.used) {
      edge.used = true;
      const next = edge.a === current ? edge.b : edge.a;
      chain.push(nodes[current].point);
      current = next;
      edge = nodes[current].edges.find((e) => !e.used);
    }
    chain.push(nodes[current].point);
    const closed = pointKey(chain[0]) === pointKey(chain[chain.length - 1]);
    chains.push({ points: closed ? chain.slice(0, -1) : chain, closed });
  }
  return chains;
}

// Perimeter parameter t in [0, 8) around the [-1,1] x/z square.
export function boundaryParam(point) {
  const [x, , z] = point;
  const eps = 1e-5;
  if (Math.abs(z + 1) < eps) return x + 1;
  if (Math.abs(x - 1) < eps) return 2 + (z + 1);
  if (Math.abs(z - 1) < eps) return 4 + (1 - x);
  return 6 + (1 - z);
}

export function boundaryPoint(t) {
  const side = Math.floor(t / 2) % 4;
  const u = (t % 2) - 1;
  if (side === 0) return [u, -1];
  if (side === 1) return [1, u];
  if (side === 2) return [-u, 1];
  return [-1, -u];
}
