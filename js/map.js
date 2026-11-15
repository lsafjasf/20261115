/* Street network: a 6-column x 4-row grid of intersections on a 900x560 canvas. */
const COLS = 6;
const ROWS = 4;
const MARGIN_X = 70;
const MARGIN_Y = 70;
const STEP_X = 152;
const STEP_Y = 140;

function nodeId(col, row) {
  return row * COLS + col;
}

function nodeXY(id) {
  const col = id % COLS;
  const row = Math.floor(id / COLS);
  return {
    x: MARGIN_X + col * STEP_X,
    y: MARGIN_Y + row * STEP_Y,
  };
}

function buildEdges() {
  const edges = [];
  const add = (a, b) => {
    const pa = nodeXY(a);
    const pb = nodeXY(b);
    const length = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    edges.push({ a, b, length });
  };
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const id = nodeId(col, row);
      if (col < COLS - 1) add(id, nodeId(col + 1, row));
      if (row < ROWS - 1) add(id, nodeId(col, row + 1));
    }
  }
  return edges;
}

/* Five districts, each anchored to an intersection where casualties appear. */
const DISTRICTS = [
  { id: "D1", name: "北区一号", node: nodeId(0, 0), color: "#f59e0b" },
  { id: "D2", name: "东区商圈", node: nodeId(5, 0), color: "#ef4444" },
  { id: "D3", name: "中央广场", node: nodeId(2, 2), color: "#8b5cf6" },
  { id: "D4", name: "西南住宅", node: nodeId(0, 3), color: "#10b981" },
  { id: "D5", name: "东南厂区", node: nodeId(5, 3), color: "#0ea5e9" },
];

const DEPOT = { id: "DEPOT", name: "急救中心车库", node: nodeId(2, 0) };

const HOSPITALS = [
  { id: "H1", name: "市立医院", node: nodeId(4, 1), initialBeds: 3 },
  { id: "H2", name: "红十字医院", node: nodeId(1, 3), initialBeds: 2 },
];

const MAP = {
  width: 900,
  height: 560,
  cols: COLS,
  rows: ROWS,
  nodeCount: COLS * ROWS,
  edges: buildEdges(),
  nodeXY,
  districts: DISTRICTS,
  depot: DEPOT,
  hospitals: HOSPITALS,
};

/* Adjacency list with per-edge live traffic weight (seconds of travel). */
function buildGraph(map, trafficFactor) {
  const graph = Array.from({ length: map.nodeCount }, () => []);
  for (const edge of map.edges) {
    const weight = edge.length * (trafficFactor[edgeKey(edge.a, edge.b)] ?? 1);
    graph[edge.a].push({ to: edge.b, edge, weight });
    graph[edge.b].push({ to: edge.a, edge, weight });
  }
  return graph;
}

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/* Dijkstra over time-weighted edges; returns ordered node list. */
function shortestPath(map, graph, from, to) {
  const dist = new Array(map.nodeCount).fill(Infinity);
  const prev = new Array(map.nodeCount).fill(-1);
  const visited = new Array(map.nodeCount).fill(false);
  dist[from] = 0;
  for (let step = 0; step < map.nodeCount; step += 1) {
    let current = -1;
    let best = Infinity;
    for (let i = 0; i < map.nodeCount; i += 1) {
      if (!visited[i] && dist[i] < best) {
        best = dist[i];
        current = i;
      }
    }
    if (current === -1 || current === to) break;
    visited[current] = true;
    for (const link of graph[current]) {
      const candidate = dist[current] + link.weight;
      if (candidate < dist[link.to]) {
        dist[link.to] = candidate;
        prev[link.to] = current;
      }
    }
  }
  if (dist[to] === Infinity) return [from];
  const path = [];
  let cursor = to;
  while (cursor !== -1) {
    path.unshift(cursor);
    cursor = prev[cursor];
  }
  return path;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { MAP, nodeId, nodeXY, edgeKey, buildGraph, shortestPath };
} else if (typeof globalThis !== "undefined") {
  globalThis.__AMBULANCE_MAP__ = { MAP, nodeId, nodeXY, edgeKey, buildGraph, shortestPath };
}
