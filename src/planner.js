export const SHOT_DURATION = 10;
export const SENSOR_WIDTH_MM = 36;
export const WORLD = Object.freeze({ width: 16, height: 9 });
export const STAGE = Object.freeze({ x: 1.25, y: 1.0, width: 13.5, height: 7 });

export const SAFE_WAYPOINTS = Object.freeze([
  Object.freeze([2.2, 7.8]),
  Object.freeze([5, 3]),
  Object.freeze([10.5, 6.5]),
  Object.freeze([13.8, 3]),
]);

export const COLLISION_WAYPOINTS = Object.freeze([
  Object.freeze([2.2, 7.8]),
  Object.freeze([5, 3]),
  Object.freeze([10.5, 6.5]),
  Object.freeze([12.6, 7.2]),
]);

export const OBSTACLES = Object.freeze([
  Object.freeze({
    id: 'actor-1',
    type: 'actor',
    name: '演员 01 · 林',
    short: 'A1',
    x: 7,
    y: 2,
    radius: 0.52,
    color: '#f7b267',
  }),
  Object.freeze({
    id: 'actor-2',
    type: 'actor',
    name: '演员 02 · 周',
    short: 'A2',
    x: 9,
    y: 7.6,
    radius: 0.52,
    color: '#f4845f',
  }),
  Object.freeze({
    id: 'pillar-1',
    type: 'pillar',
    name: '立柱 A · 左',
    short: 'P1',
    x: 3,
    y: 2,
    radius: 0.42,
    color: '#9aa9b8',
  }),
  Object.freeze({
    id: 'pillar-2',
    type: 'pillar',
    name: '立柱 B · 右',
    short: 'P2',
    x: 12.6,
    y: 7.2,
    radius: 0.42,
    color: '#b6c2cc',
  }),
]);

export const CAMERA_RADIUS = 0.28;
export const NEAR_MARGIN = 0.32;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function getHorizontalFov(focalMm) {
  return (2 * Math.atan(SENSOR_WIDTH_MM / (2 * focalMm)) * 180) / Math.PI;
}

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1[0] +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    y:
      0.5 *
      (2 * p1[1] +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  };
}

export function buildPath(waypoints, stepsPerSegment = 180) {
  const anchors = waypoints.map(([x, y]) => [x, y]);
  const padded = [anchors[0], ...anchors, anchors.at(-1)];
  const raw = [];

  for (let segment = 1; segment < padded.length - 2; segment += 1) {
    const [p0, p1, p2, p3] = padded.slice(segment - 1, segment + 3);
    for (let step = 0; step < stepsPerSegment; step += 1) {
      raw.push(catmullRomPoint(p0, p1, p2, p3, step / stepsPerSegment));
    }
  }
  raw.push({ x: anchors.at(-1)[0], y: anchors.at(-1)[1] });

  let length = 0;
  raw[0].distance = 0;
  for (let index = 1; index < raw.length; index += 1) {
    length += distance(raw[index - 1], raw[index]);
    raw[index].distance = length;
  }
  raw[0].u = 0;
  for (let index = 1; index < raw.length; index += 1) {
    raw[index].u = length === 0 ? 0 : raw[index].distance / length;
  }
  return { points: raw, length, stepsPerSegment };
}

function locateSample(path, u) {
  const clamped = clamp(u, 0, 1);
  const target = clamped * path.length;
  let low = 0;
  let high = path.points.length - 1;

  while (low < high - 1) {
    const middle = Math.floor((low + high) / 2);
    if (path.points[middle].distance <= target) low = middle;
    else high = middle;
  }

  const start = path.points[low];
  const end = path.points[high] ?? start;
  const span = end.distance - start.distance;
  const ratio = span > 0 ? clamp((target - start.distance) / span, 0, 1) : 0;
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    index: low,
  };
}

export function samplePath(path, u) {
  return locateSample(path, u);
}

export function sampleTangent(path, u, delta = 0.002) {
  const before = locateSample(path, clamp(u - delta, 0, 1));
  const after = locateSample(path, clamp(u + delta, 0, 1));
  const length = Math.hypot(after.x - before.x, after.y - before.y);
  if (length < 1e-6) return { x: 1, y: 0, angle: 0 };
  const x = (after.x - before.x) / length;
  const y = (after.y - before.y) / length;
  return { x, y, angle: Math.atan2(y, x) };
}

export function sampleWaypointProgress(path, waypointIndex) {
  if (waypointIndex <= 0) return 0;
  if (waypointIndex >= path.stepsPerSegment) return 1;
  const index = waypointIndex * path.stepsPerSegment;
  return path.points[Math.min(index, path.points.length - 1)]?.u ?? 0;
}

function mergeIntervals(intervals, maxGap) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.startU - b.startU);
  const merged = [{ ...sorted[0] }];

  for (const interval of sorted.slice(1)) {
    const current = merged.at(-1);
    if (interval.startU - current.endU <= maxGap) {
      current.endU = Math.max(current.endU, interval.endU);
      current.minClearance = Math.min(current.minClearance, interval.minClearance);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

export function computeShotPlan(
  waypoints,
  { safety = 0.8, focal = 28, heading = 8, duration = SHOT_DURATION, sampleCount = 1000 } = {},
) {
  const path = buildPath(waypoints);
  const obstacles = OBSTACLES.map((obstacle) => ({
    ...obstacle,
    minClearance: Infinity,
    closestU: 0,
    blockedSamples: [],
  }));
  const obstaclesById = new Map(obstacles.map((obstacle) => [obstacle.id, obstacle]));
  const samples = [];
  let globalClosest = null;
  let blockedCount = 0;

  for (let index = 0; index <= sampleCount; index += 1) {
    const u = index / sampleCount;
    const point = samplePath(path, u);
    let nearest = null;
    let status = 'safe';

    for (const obstacle of obstacles) {
      const centerDistance = distance(point, obstacle);
      const clearance = centerDistance - obstacle.radius;
      if (clearance < obstacle.minClearance) {
        obstacle.minClearance = clearance;
        obstacle.closestU = u;
      }
      if (!nearest || clearance < nearest.clearance) {
        nearest = {
          id: obstacle.id,
          name: obstacle.name,
          type: obstacle.type,
          short: obstacle.short,
          clearance,
        };
      }
      if (clearance < safety) {
        obstacle.blockedSamples.push({ index, u, clearance });
        status = 'blocked';
      } else if (clearance < safety + NEAR_MARGIN && status !== 'blocked') {
        status = 'near';
      }
    }

    if (!globalClosest || nearest.clearance < globalClosest.clearance) {
      globalClosest = { ...nearest, u };
    }
    if (status === 'blocked') blockedCount += 1;
    samples.push({ ...point, u, distance: u * path.length, clearance: nearest.clearance, status });
  }

  const maxGap = 2 / sampleCount;
  const conflictObjects = [];
  const intervals = [];

  for (const obstacle of obstacles) {
    if (!obstacle.blockedSamples.length) continue;
    const runs = [];
    for (const sample of obstacle.blockedSamples) {
      const current = runs.at(-1);
      if (current && sample.index <= current.lastIndex + 1) {
        current.last = sample;
        current.lastIndex = sample.index;
        current.minClearance = Math.min(current.minClearance, sample.clearance);
      } else {
        runs.push({
          first: sample,
          last: sample,
          lastIndex: sample.index,
          minClearance: sample.clearance,
        });
      }
    }
    for (const [runIndex, run] of runs.entries()) {
      const pad = 0.5 / sampleCount;
      const startU = clamp(run.first.u - pad, 0, 1);
      const endU = clamp(run.last.u + pad, 0, 1);
      intervals.push({
        id: `${obstacle.id}-${runIndex}`,
        obstacleId: obstacle.id,
        obstacleName: obstacle.name,
        obstacleType: obstacle.type,
        obstacleShort: obstacle.short,
        startU,
        endU,
        startTime: startU * duration,
        endTime: endU * duration,
        minClearance: run.minClearance,
      });
    }
    conflictObjects.push({
      ...obstacle,
      intervalCount: runs.length,
    });
  }

  conflictObjects.sort((a, b) => a.minClearance - b.minClearance);
  intervals.sort((a, b) => a.startTime - b.startTime);
  const mergedIntervals = mergeIntervals(intervals, maxGap);

  return {
    waypoints: waypoints.map(([x, y]) => ({ x, y })),
    path,
    samples,
    safety,
    focal,
    heading,
    duration,
    horizontalFov: getHorizontalFov(focal),
    minimumClearance: globalClosest?.clearance ?? Infinity,
    closest: globalClosest,
    blockedCount,
    valid: conflictObjects.length === 0,
    conflictObjects,
    intervals,
    mergedIntervals,
  };
}

export function clampWaypoint([x, y]) {
  const margin = 0.32;
  return [
    clamp(x, STAGE.x + margin, STAGE.x + STAGE.width - margin),
    clamp(y, STAGE.y + margin, STAGE.y + STAGE.height - margin),
  ];
}

export function formatSeconds(seconds) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const tenths = Math.floor(safeSeconds * 10);
  const whole = Math.floor(tenths / 10);
  return `00:${String(whole).padStart(2, '0')}.${tenths % 10}`;
}

export function formatClearance(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(2)} m`;
}
