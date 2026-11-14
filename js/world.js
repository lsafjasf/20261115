// 世界模型:街区网格、地下管网、漏点、阀门室、声学传播模型。
// 纯逻辑模块,浏览器(game.js)与 Node 仿真(sim.js)共用同一份数学模型。

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GRID = 7;            // 7x7 个街区 -> 8x8 个路口
export const SPACING = 100;       // 街区边长(世界单位)
export const WORLD_SIZE = GRID * SPACING;

// 街道段:两个相邻路口之间。每段街道下方有一根水管。
export function buildSegments() {
  const segs = [];
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      if (i < GRID) segs.push({ id: segs.length, x1: i * SPACING, y1: j * SPACING, x2: (i + 1) * SPACING, y2: j * SPACING });
      if (j < GRID) segs.push({ id: segs.length, x1: i * SPACING, y1: j * SPACING, x2: i * SPACING, y2: (j + 1) * SPACING });
    }
  }
  return segs;
}

export function createWorld(seed) {
  const rand = mulberry32(seed);
  const segments = buildSegments();

  // 三个漏点:随机选三段互不相同的管道,漏点位于段内随机位置
  const pool = segments.slice();
  const leaks = [];
  while (leaks.length < 3) {
    const idx = Math.floor(rand() * pool.length);
    const seg = pool.splice(idx, 1)[0];
    const t = 0.2 + rand() * 0.6;
    leaks.push({
      segId: seg.id,
      x: seg.x1 + (seg.x2 - seg.x1) * t,
      y: seg.y1 + (seg.y2 - seg.y1) * t,
      freq: 700 + rand() * 900,
      amp: 0.9 + rand() * 0.3,
      found: false,
    });
  }

  // 阀门室:放在路口,避开漏点附近,产生周期性干扰振动
  const valves = [];
  let guard = 0;
  while (valves.length < 3 && guard++ < 500) {
    const i = 1 + Math.floor(rand() * (GRID - 1));
    const j = 1 + Math.floor(rand() * (GRID - 1));
    const x = i * SPACING, y = j * SPACING;
    const nearLeak = leaks.some(l => Math.hypot(l.x - x, l.y - y) < SPACING * 1.2);
    const dup = valves.some(v => v.x === x && v.y === y);
    if (!nearLeak && !dup) {
      valves.push({ x, y, rate: 1.5 + rand() * 2.5, phase: rand() * Math.PI * 2 });
    }
  }

  return { seed, segments, leaks, valves };
}

// ---- 声学模型(音频引擎与仿真共用)----

export function leakGain(leak, x, y) {
  const d = Math.hypot(leak.x - x, leak.y - y);
  const r0 = 55;
  return leak.amp / (1 + (d / r0) * (d / r0));
}

// 左右声道声像:根据漏点相对车头的方位角
export function panGains(leak, x, y, heading) {
  const ang = Math.atan2(leak.y - y, leak.x - x);
  let rel = ang - heading;
  while (rel > Math.PI) rel -= 2 * Math.PI;
  while (rel < -Math.PI) rel += 2 * Math.PI;
  const s = Math.sin(rel);
  return [Math.sqrt((1 + s) / 2), Math.sqrt((1 - s) / 2)];
}

// 阀门室干扰强度(低频脉冲振动)
export function valveGain(valve, x, y, time) {
  const d = Math.hypot(valve.x - x, valve.y - y);
  const r0 = 45;
  const pulse = Math.max(0, Math.sin(time * valve.rate * Math.PI * 2 + valve.phase));
  return (0.8 / (1 + (d / r0) * (d / r0))) * (0.3 + 0.7 * pulse * pulse);
}

// 发动机噪声:随速度增大,掩蔽微弱水声
export function engineGain(speed, maxSpeed) {
  const v = Math.abs(speed) / maxSpeed;
  return 0.03 + 0.85 * v * v;
}

// 听筒信噪比
export function snr(world, x, y, speed, maxSpeed, time) {
  let sig = 0;
  for (const l of world.leaks) if (!l.found) sig += leakGain(l, x, y);
  let noise = engineGain(speed, maxSpeed) + 0.02;
  for (const v of world.valves) noise += valveGain(v, x, y, time);
  return sig / noise;
}

// 找到车当前所在的街道段(取最近段)
export function segmentAt(world, x, y) {
  let best = null, bestD = Infinity;
  for (const s of world.segments) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    let t = ((x - s.x1) * dx + (y - s.y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = s.x1 + dx * t, py = s.y1 + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
