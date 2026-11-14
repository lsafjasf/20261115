import { LANDER_RADIUS, TOTAL_JARS, TURN_RATE, PICKUP_RADIUS } from './config.js';

const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 固定 seed 世界下预先规划的航点走廊：沿世界边缘绕行，与全部陨坑保持安全距离。
const WAYPOINTS = [
  { x: 24, y: 50, kind: 'sample', jar: 0 },
  { x: 30, y: 62, kind: 'via' },
  { x: 50, y: 62, kind: 'via' },
  { x: 63, y: 55, kind: 'sample', jar: 1 },
  { x: 72, y: 60, kind: 'via' },
  { x: 86, y: 30, kind: 'via' },
  { x: 81, y: 12, kind: 'sample', jar: 2 },
  { x: 86, y: 8, kind: 'via' },
  { x: 70, y: 8, kind: 'via' },
  { x: 48, y: 8, kind: 'via' },
  { x: 20, y: 26, kind: 'via' },
  { x: 9, y: 33, kind: 'lander' }
];
const REACH = 2.2;

export function currentTarget(world, rover) {
  if (rover.jars < TOTAL_JARS) {
    return world.samples.find((s) => !s.collected) ?? world.lander;
  }
  return world.lander;
}

function activeWaypoint(world, rover) {
  if (rover.wpIndex === undefined) rover.wpIndex = 0;
  let wp = WAYPOINTS[rover.wpIndex];
  // 带迟滞的航点推进：普通航点进入 REACH 即推进；样本航点必须真正拾取。
  while (wp.kind !== 'sample' && wp.kind !== 'lander'
    && Math.hypot(rover.x - wp.x, rover.y - wp.y) <= REACH
    && rover.wpIndex < WAYPOINTS.length - 1) {
    rover.wpIndex += 1;
    wp = WAYPOINTS[rover.wpIndex];
  }
  if (wp.kind === 'sample' && world.samples[wp.jar].collected && rover.wpIndex < WAYPOINTS.length - 1) {
    rover.wpIndex += 1;
    wp = WAYPOINTS[rover.wpIndex];
  }
  return wp;
}

export function autopilot(world, rover) {
  const wp = activeWaypoint(world, rover);
  const dx = wp.x - rover.x;
  const dy = wp.y - rover.y;
  const dist = Math.hypot(dx, dy);
  const base = Math.atan2(dy, dx);
  let desired = base;

  // 局部兜底：航点走廊已绕开陨坑，这里只在被外力（滑坡/打滑）推入危险区时修正。
  let threat = null;
  let threatMargin = Infinity;
  for (const c of world.craters) {
    const cd = Math.hypot(rover.x - c.x, rover.y - c.y);
    const margin = cd - (c.rim + c.band + 1.4);
    if (margin < threatMargin) {
      threatMargin = margin;
      threat = { c, margin };
    }
  }
  if (threat && threatMargin < 0) {
    const away = Math.atan2(rover.y - threat.c.y, rover.x - threat.c.x);
    desired = normAngle(away + normAngle(base - away) * 0.3);
  }

  const err = normAngle(desired - rover.heading);
  const steer = clamp(err * 1.8, -1, 1);
  const speed = Math.hypot(rover.vx, rover.vy);
  const maxSafeSpeed = Math.max(1.1, Math.min(5.6, TURN_RATE * 0.95 / Math.max(Math.abs(err), 0.12)));

  let throttle = 0;
  let brake = 0;
  if (dist < 3.2) {
    if (speed > dist * 0.9 + 0.5) brake = 0.8;
    else if (speed < 2.0 && dist > 0.8) throttle = 0.5;
  } else if (speed > maxSafeSpeed + 0.4) {
    brake = 0.3;
  } else {
    throttle = 0.85;
  }
  if (rover.slip) {
    throttle = 0;
    brake = 0.3;
    return { throttle, brake, steer: clamp(steer * 0.4, -0.5, 0.5) };
  }
  return { throttle, brake, steer };
}

export function planSummary(world, rover) {
  const wp = activeWaypoint(world, rover);
  return {
    target: [wp.x, wp.y],
    distance: Math.hypot(wp.x - rover.x, wp.y - rover.y),
    landerRadius: LANDER_RADIUS,
    pickupRadius: PICKUP_RADIUS
  };
}
