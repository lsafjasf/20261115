import { BRIDGES, CAMP, CRACKS, SITES, WORLD } from "./config.js";

const CELL = 34;
const CLEARANCE = 25;

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function pointSegmentDistanceSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) {
    return (point.x - start[0]) ** 2 + (point.y - start[1]) ** 2;
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start[0]) * dx + (point.y - start[1]) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  const px = start[0] + t * dx;
  const py = start[1] + t * dy;
  return (point.x - px) ** 2 + (point.y - py) ** 2;
}

export function segmentIntersection(a, b, c, d) {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denominator) < 1e-8) return null;
  const t =
    ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
  const u =
    ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), t, u };
}

export function bridgeAtPoint(point) {
  return (
    BRIDGES.find(
      (bridge) => distanceSquared(point, bridge) <= bridge.radius ** 2,
    ) || null
  );
}

export function crackCrossing(a, b) {
  for (const crack of CRACKS) {
    for (let index = 0; index < crack.points.length - 1; index += 1) {
      const start = crack.points[index];
      const end = crack.points[index + 1];
      const point = segmentIntersection(
        a,
        b,
        { x: start[0], y: start[1] },
        { x: end[0], y: end[1] },
      );
      if (point) {
        const bridge = bridgeAtPoint(point);
        return {
          crackId: crack.id,
          kind: crack.kind,
          point,
          bridge,
        };
      }
    }
  }
  return null;
}

function isPointOpen(x, y) {
  if (x < 18 || y < 18 || x > WORLD.width - 18 || y > WORLD.height - 18) {
    return false;
  }
  for (const crack of CRACKS) {
    for (let index = 0; index < crack.points.length - 1; index += 1) {
      const start = crack.points[index];
      const end = crack.points[index + 1];
      const radius = crack.width / 2 + CLEARANCE;
      if (
        pointSegmentDistanceSquared({ x, y }, start, end) <=
        radius * radius
      ) {
        const nearestBridge = BRIDGES.some(
          (bridge) =>
            pointSegmentDistanceSquared(bridge, start, end) <=
            bridge.radius ** 2,
        );
        if (!nearestBridge) return false;
        let onBridge = false;
        for (const bridge of BRIDGES) {
          if (
            distanceSquared({ x, y }, bridge) <=
              (bridge.radius - CLEARANCE * 0.4) ** 2 &&
            pointSegmentDistanceSquared(bridge, start, end) <=
              bridge.radius ** 2
          ) {
            onBridge = true;
            break;
          }
        }
        if (!onBridge) return false;
      }
    }
  }
  return true;
}

export class Navigation {
  constructor() {
    this.cols = Math.ceil(WORLD.width / CELL);
    this.rows = Math.ceil(WORLD.height / CELL);
    this.grid = new Uint8Array(this.cols * this.rows);
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const open = isPointOpen(
          col * CELL + CELL / 2,
          row * CELL + CELL / 2,
        );
        this.grid[row * this.cols + col] = open ? 1 : 0;
      }
    }
  }

  index(col, row) {
    return row * this.cols + col;
  }

  walkable(col, row) {
    return (
      col >= 0 &&
      row >= 0 &&
      col < this.cols &&
      row < this.rows &&
      this.grid[this.index(col, row)] === 1
    );
  }

  nearestWalkable(position) {
    const col = Math.max(
      0,
      Math.min(this.cols - 1, Math.floor(position.x / CELL)),
    );
    const row = Math.max(
      0,
      Math.min(this.rows - 1, Math.floor(position.y / CELL)),
    );
    if (this.walkable(col, row)) return { col, row };
    for (let radius = 1; radius <= 8; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          if (this.walkable(col + dx, row + dy)) {
            return { col: col + dx, row: row + dy };
          }
        }
      }
    }
    return null;
  }
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= this.items[index].score) break;
      [this.items[parent], this.items[index]] = [
        this.items[index],
        this.items[parent],
      ];
      index = parent;
    }
  }

  pop() {
    if (this.items.length === 1) return this.items.pop();
    const result = this.items[0];
    this.items[0] = this.items.pop();
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (
        left < this.items.length &&
        this.items[left].score < this.items[smallest].score
      ) {
        smallest = left;
      }
      if (
        right < this.items.length &&
        this.items[right].score < this.items[smallest].score
      ) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.items[index], this.items[smallest]] = [
        this.items[smallest],
        this.items[index],
      ];
      index = smallest;
    }
    return result;
  }

  get size() {
    return this.items.length;
  }
}

function lineIsOpen(start, end) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / 8));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    if (
      !isPointOpen(
        start.x + (end.x - start.x) * t,
        start.y + (end.y - start.y) * t,
      )
    ) {
      return false;
    }
  }
  return true;
}

function simplifyPath(navigation, points) {
  if (points.length <= 2) return points;
  const simplified = [points[0]];
  let cursor = 0;
  while (cursor < points.length - 1) {
    let next = cursor + 1;
    for (let candidate = points.length - 1; candidate > cursor; candidate -= 1) {
      if (lineIsOpen(points[cursor], points[candidate])) {
        next = candidate;
        break;
      }
    }
    simplified.push(points[next]);
    cursor = next;
  }
  return simplified;
}

export function analyzePath(points) {
  const bridges = new Set();
  const violations = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const crossing = crackCrossing(points[index], points[index + 1]);
    if (!crossing) continue;
    if (crossing.bridge) {
      bridges.add(crossing.bridge.label);
    } else {
      violations.push(crossing);
    }
  }
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += Math.hypot(
      points[index + 1].x - points[index].x,
      points[index + 1].y - points[index].y,
    );
  }
  return {
    bridges: [...bridges],
    violations,
    length: Math.round(length),
  };
}

export function createNavigation() {
  const navigation = new Navigation();

  function findPath(start, end) {
    const startCell = navigation.nearestWalkable(start);
    const goalCell = navigation.nearestWalkable(end);
    if (!startCell || !goalCell) {
      return { points: [], found: false, bridges: [], violations: [], length: 0 };
    }

    const startIndex = navigation.index(startCell.col, startCell.row);
    const goalIndex = navigation.index(goalCell.col, goalCell.row);
    const count = navigation.grid.length;
    const gScore = new Float32Array(count);
    gScore.fill(Infinity);
    const cameFrom = new Int32Array(count);
    cameFrom.fill(-1);
    const closed = new Uint8Array(count);
    const open = new MinHeap();
    const heuristic = (col, row) =>
      Math.hypot(goalCell.col - col, goalCell.row - row);

    gScore[startIndex] = 0;
    open.push({
      index: startIndex,
      col: startCell.col,
      row: startCell.row,
      score: heuristic(startCell.col, startCell.row),
    });

    const directions = [
      [-1, 0, 1],
      [1, 0, 1],
      [0, -1, 1],
      [0, 1, 1],
      [-1, -1, Math.SQRT2],
      [1, -1, Math.SQRT2],
      [-1, 1, Math.SQRT2],
      [1, 1, Math.SQRT2],
    ];
    let found = false;
    let iterations = 0;

    while (open.size && iterations < 9000) {
      iterations += 1;
      const current = open.pop();
      if (closed[current.index]) continue;
      closed[current.index] = 1;
      if (current.index === goalIndex) {
        found = true;
        break;
      }
      for (const [dx, dy, cost] of directions) {
        const col = current.col + dx;
        const row = current.row + dy;
        if (!navigation.walkable(col, row)) continue;
        if (
          dx !== 0 &&
          dy !== 0 &&
          (!navigation.walkable(current.col + dx, current.row) ||
            !navigation.walkable(current.col, current.row + dy))
        ) {
          continue;
        }
        const index = navigation.index(col, row);
        const tentative = gScore[current.index] + cost;
        if (tentative >= gScore[index]) continue;
        gScore[index] = tentative;
        cameFrom[index] = current.index;
        open.push({
          index,
          col,
          row,
          score: tentative + heuristic(col, row),
        });
      }
    }

    if (!found) {
      return { points: [], found: false, bridges: [], violations: [], length: 0 };
    }
    const cells = [];
    let cursor = goalIndex;
    while (cursor !== -1) {
      const row = Math.floor(cursor / navigation.cols);
      const col = cursor % navigation.cols;
      cells.push({
        x: col * CELL + CELL / 2,
        y: row * CELL + CELL / 2,
      });
      if (cursor === startIndex) break;
      cursor = cameFrom[cursor];
    }
    cells.reverse();
    const points = simplifyPath(navigation, [
      { x: start.x, y: start.y },
      ...cells,
      { x: end.x, y: end.y },
    ]);
    const audit = analyzePath(points);
    return {
      points,
      found: true,
      ...audit,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
    };
  }

  const campRoutes = SITES.map((site) =>
    findPath({ x: CAMP.x, y: CAMP.y }, { x: site.x, y: site.y }),
  );

  return {
    cellSize: CELL,
    findPath,
    campRoutes,
    isPointOpen,
  };
}
