export const WORLD = Object.freeze({
  width: 1280,
  height: 720,
  groundY: 648,
  fenceX: 1000,
  blast: { x: 248, y: 154 },
  buffer: { x: 585, y: 338, width: 390, height: 306 },
  noEntry: { x: 1000, y: 112, width: 270, height: 536 }
});

export const ANCHOR_DEFS = Object.freeze([
  {
    id: 'tl',
    label: '左上锚',
    x: 516,
    y: 176,
    bounds: { minX: 456, maxX: 632, minY: 112, maxY: 258 }
  },
  {
    id: 'tr',
    label: '右上锚',
    x: 858,
    y: 214,
    bounds: { minX: 744, maxX: 956, minY: 142, maxY: 318 }
  },
  {
    id: 'br',
    label: '右下锚',
    x: 932,
    y: 508,
    bounds: { minX: 824, maxX: 968, minY: 410, maxY: 586 }
  },
  {
    id: 'bl',
    label: '左下锚',
    x: 636,
    y: 430,
    bounds: { minX: 566, maxX: 752, minY: 340, maxY: 554 }
  }
]);

export const DEFAULT_TENSION = 58;
export const SIMULATION_SECONDS = 10;
export const TENSION_SAFE = Object.freeze({ min: 42, max: 68 });

const NET_COLS = 18;
const NET_ROWS = 13;
const FIXED_DT = 1 / 120;
const MAX_TRAIL_POINTS = 110;

const NORMAL_SEQUENCE = [
  { at: 0.18, angle: -18, speed: 338, radius: 7, mass: 1.0, kind: 'stone' },
  { at: 0.28, angle: -9, speed: 352, radius: 11, mass: 1.7, kind: 'stone' },
  { at: 0.39, angle: 4, speed: 321, radius: 8, mass: 1.1, kind: 'stone' },
  { at: 0.51, angle: -22, speed: 368, radius: 6, mass: 0.85, kind: 'stone' },
  { at: 0.62, angle: 10, speed: 345, radius: 13, mass: 2.1, kind: 'stone' },
  { at: 0.75, angle: -4, speed: 329, radius: 7, mass: 0.95, kind: 'stone' },
  { at: 0.88, angle: 18, speed: 312, radius: 9, mass: 1.25, kind: 'stone' },
  { at: 1.02, angle: -14, speed: 366, radius: 12, mass: 1.85, kind: 'stone' },
  { at: 1.13, angle: 1, speed: 337, radius: 6, mass: 0.8, kind: 'stone' },
  { at: 1.25, angle: 8, speed: 324, radius: 10, mass: 1.45, kind: 'stone' },
  { at: 1.38, angle: -27, speed: 383, radius: 8, mass: 1.1, kind: 'stone' },
  { at: 1.49, angle: 14, speed: 331, radius: 14, mass: 2.3, kind: 'stone' },
  { at: 1.61, angle: -6, speed: 347, radius: 7, mass: 0.9, kind: 'stone' },
  { at: 1.73, angle: 21, speed: 306, radius: 9, mass: 1.3, kind: 'stone' },
  { at: 1.86, angle: -20, speed: 375, radius: 11, mass: 1.6, kind: 'stone' },
  { at: 1.98, angle: 3, speed: 355, radius: 8, mass: 1.0, kind: 'stone' },
  { at: 2.12, angle: 11, speed: 336, radius: 10, mass: 1.4, kind: 'stone' }
];

const ABNORMAL_SEQUENCE = [
  {
    at: 0.24,
    angle: -6,
    speed: 840,
    radius: 18,
    mass: 2.4,
    kind: 'anomaly',
    launchY: 96
  }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function normalize(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1) : 0;
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { x, y, distance: Math.hypot(px - x, py - y), t };
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if ((a.y > y) !== (b.y > y) &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function initialAnchors() {
  return ANCHOR_DEFS.map((anchor) => ({
    ...anchor,
    x: anchor.x,
    y: anchor.y
  }));
}

function cloneAnchors(anchors = initialAnchors()) {
  return ANCHOR_DEFS.map((definition, index) => {
    const source = anchors[index] ?? definition;
    return {
      ...definition,
      x: clamp(Number(source.x) || definition.x, definition.bounds.minX, definition.bounds.maxX),
      y: clamp(Number(source.y) || definition.y, definition.bounds.minY, definition.bounds.maxY)
    };
  });
}

export class QuarrySimulation {
  constructor(options = {}) {
    this.anchors = cloneAnchors(options.anchors);
    this.tension = clamp(options.tension ?? DEFAULT_TENSION, 0, 100);
    this.mode = options.mode ?? 'normal';
    this.state = 'editing';
    this.elapsed = 0;
    this.accumulator = 0;
    this.rocks = [];
    this.spawned = 0;
    this.sequence = NORMAL_SEQUENCE;
    this.nextId = 1;
    this.breaches = [];
    this.tearIndex = null;
    this.overload = false;
    this.result = null;
    this.events = [];
    this.listeners = new Set();
    this.netPulses = [];
    this.anchorLoads = [0, 0, 0, 0];
    this.netPoints = [];
    this.netSegments = [];
    this.netOutline = [];
    this.rebuildNet();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, detail = {}) {
    const event = { type, time: this.elapsed, ...detail };
    this.events.push(event);
    if (this.events.length > 180) this.events.shift();
    this.listeners.forEach((listener) => listener(event));
  }

  setAnchors(anchors) {
    if (this.state !== 'editing') return false;
    this.anchors = cloneAnchors(anchors);
    this.rebuildNet();
    this.emit('layout', { anchors: this.getAnchorState() });
    return true;
  }

  updateAnchor(index, x, y) {
    if (this.state !== 'editing' || !this.anchors[index]) return false;
    const bounds = this.anchors[index].bounds;
    this.anchors[index].x = clamp(x, bounds.minX, bounds.maxX);
    this.anchors[index].y = clamp(y, bounds.minY, bounds.maxY);
    this.rebuildNet();
    return true;
  }

  setTension(tension) {
    if (this.state !== 'editing') return false;
    this.tension = clamp(Number(tension) || 0, 0, 100);
    this.rebuildNet();
    this.emit('tension', { tension: this.tension });
    return true;
  }

  getAnchorState() {
    return this.anchors.map((anchor) => ({
      id: anchor.id,
      label: anchor.label,
      x: Math.round(anchor.x),
      y: Math.round(anchor.y)
    }));
  }

  netPoint(u, v) {
    const [tl, tr, br, bl] = this.anchors;
    const topX = lerp(tl.x, tr.x, u);
    const topY = lerp(tl.y, tr.y, u);
    const bottomX = lerp(bl.x, br.x, u);
    const bottomY = lerp(bl.y, br.y, u);
    const slack = Math.max(0, 1 - this.tension / 100);
    const envelope = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    const sag = slack * slack * 66 * envelope;
    const drag = slack * 9 * envelope;
    return {
      x: lerp(topX, bottomX, v) - drag,
      y: lerp(topY, bottomY, v) + sag,
      u,
      v
    };
  }

  rebuildNet() {
    this.netPoints = [];
    for (let row = 0; row <= NET_ROWS; row += 1) {
      const current = [];
      for (let col = 0; col <= NET_COLS; col += 1) {
        current.push(this.netPoint(col / NET_COLS, row / NET_ROWS));
      }
      this.netPoints.push(current);
    }

    this.netSegments = [];
    for (let row = 0; row <= NET_ROWS; row += 1) {
      for (let col = 0; col <= NET_COLS; col += 1) {
        if (col < NET_COLS) {
          this.netSegments.push({
            a: this.netPoints[row][col],
            b: this.netPoints[row][col + 1],
            u: (col + 0.5) / NET_COLS,
            v: row / NET_ROWS
          });
        }
        if (row < NET_ROWS) {
          this.netSegments.push({
            a: this.netPoints[row][col],
            b: this.netPoints[row + 1][col],
            u: col / NET_COLS,
            v: (row + 0.5) / NET_ROWS
          });
        }
      }
    }

    this.netOutline = [
      this.netPoint(0, 0),
      this.netPoint(1, 0),
      this.netPoint(1, 1),
      this.netPoint(0, 1)
    ];
    const xs = this.netPoints.flat().map((point) => point.x);
    const ys = this.netPoints.flat().map((point) => point.y);
    this.netBounds = {
      minX: Math.min(...xs) - 24,
      maxX: Math.max(...xs) + 24,
      minY: Math.min(...ys) - 24,
      maxY: Math.max(...ys) + 24
    };
  }

  start(mode = 'normal') {
    this.mode = mode === 'abnormal' ? 'abnormal' : 'normal';
    this.sequence = this.mode === 'abnormal' ? ABNORMAL_SEQUENCE : NORMAL_SEQUENCE;
    this.state = 'running';
    this.elapsed = 0;
    this.accumulator = 0;
    this.rocks = [];
    this.spawned = 0;
    this.nextId = 1;
    this.breaches = [];
    this.tearIndex = null;
    this.overload = false;
    this.result = null;
    this.events = [];
    this.netPulses = [];
    this.anchorLoads = [0, 0, 0, 0];
    this.emit('blast', { mode: this.mode, x: WORLD.blast.x, y: WORLD.blast.y });
  }

  reset() {
    this.state = 'editing';
    this.elapsed = 0;
    this.accumulator = 0;
    this.rocks = [];
    this.spawned = 0;
    this.nextId = 1;
    this.breaches = [];
    this.tearIndex = null;
    this.overload = false;
    this.result = null;
    this.events = [];
    this.netPulses = [];
    this.anchorLoads = [0, 0, 0, 0];
  }

  spawnRock(config) {
    const angle = (config.angle * Math.PI) / 180;
    const originY = config.launchY ?? WORLD.blast.y;
    this.rocks.push({
      id: this.nextId++,
      x: WORLD.blast.x,
      y: originY,
      vx: Math.cos(angle) * config.speed,
      vy: Math.sin(angle) * config.speed,
      radius: config.radius,
      mass: config.mass,
      kind: config.kind,
      hazard: true,
      state: 'flying',
      trail: [{ x: WORLD.blast.x, y: originY }],
      trailClock: 0,
      netContacts: 0,
      lastNetContact: -1,
      netCooldown: 0,
      peakImpactLoad: 0,
      peakUV: null,
      maxSpeed: config.speed,
      breached: false,
      buffered: false,
      settled: false,
      rotation: (config.at * 19) % (Math.PI * 2),
      spin: (config.speed - 320) * 0.011
    });
    this.emit('spawn', { rock: this.rocks[this.rocks.length - 1] });
  }

  step(dt) {
    if (this.state !== 'running') return;
    this.elapsed += dt;

    while (
      this.spawned < this.sequence.length &&
      this.elapsed >= this.sequence[this.spawned].at
    ) {
      this.spawnRock(this.sequence[this.spawned]);
      this.spawned += 1;
    }

    for (const rock of this.rocks) {
      if (rock.settled) continue;
      this.stepRock(rock, dt);
    }

    this.updateNetPulses(dt);
    this.recomputeAnchorLoads();
    void this.pocketLoad;

    if (this.elapsed >= SIMULATION_SECONDS) {
      this.elapsed = SIMULATION_SECONDS;
      this.state = 'complete';
      this.result = this.assess();
      this.emit('complete', { result: this.result });
    }
  }

  update(dt) {
    if (this.state !== 'running') return;
    this.accumulator += Math.max(0, Math.min(dt, 0.1));
    while (this.accumulator >= FIXED_DT && this.state === 'running') {
      this.step(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
  }

  advance(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const steps = Math.ceil(safeSeconds / FIXED_DT);
    for (let i = 0; i < steps && this.state === 'running'; i += 1) {
      this.step(FIXED_DT);
    }
  }

  stepRock(rock, dt) {
    rock.netCooldown = Math.max(0, rock.netCooldown - dt);
    rock.trailClock += dt;
    rock.vy += 360 * dt;
    rock.vx *= 0.9992;
    rock.x += rock.vx * dt;
    rock.y += rock.vy * dt;
    rock.rotation += rock.spin * dt;
    rock.maxSpeed = Math.max(rock.maxSpeed, Math.hypot(rock.vx, rock.vy));

    if (rock.trailClock >= 0.045) {
      rock.trailClock = 0;
      const last = rock.trail[rock.trail.length - 1];
      if (!last || Math.hypot(rock.x - last.x, rock.y - last.y) > 2.5) {
        rock.trail.push({ x: rock.x, y: rock.y });
        if (rock.trail.length > MAX_TRAIL_POINTS) rock.trail.shift();
      }
    }

    if (
      !rock.breached &&
      rock.x + rock.radius * 0.45 >= WORLD.fenceX &&
      rock.y < WORLD.groundY - 2
    ) {
      rock.breached = true;
      this.breaches.push({
        id: rock.id,
        x: Math.round(rock.x),
        y: Math.round(rock.y),
        time: Number(this.elapsed.toFixed(2)),
        kind: rock.kind
      });
      this.emit('breach', { rock, time: this.elapsed });
    }

    this.collideWithNet(rock);

    if (rock.y + rock.radius >= WORLD.groundY) {
      rock.y = WORLD.groundY - rock.radius;
      if (Math.abs(rock.vy) > 54) {
        rock.vy *= -0.24;
        rock.vx *= 0.78;
        this.emit('ground', { rock, strength: Math.abs(rock.vy) });
      } else {
        rock.vy = 0;
        rock.vx *= 0.8;
        if (Math.abs(rock.vx) < 7) {
          rock.vx = 0;
          rock.settled = true;
        }
      }
      if (
        !rock.buffered &&
        rock.x > WORLD.buffer.x &&
        rock.x < WORLD.fenceX &&
        rock.y > WORLD.buffer.y
      ) {
        rock.buffered = true;
      }
    }

    if (rock.x < -80 || rock.x > WORLD.width + 80 || rock.y > WORLD.height + 140) {
      rock.settled = true;
    }
  }

  collideWithNet(rock) {
    if (rock.netCooldown > 0) return;
    const bounds = this.netBounds;
    if (
      rock.x < bounds.minX ||
      rock.x > bounds.maxX ||
      rock.y < bounds.minY ||
      rock.y > bounds.maxY
    ) {
      return;
    }

    let closest = null;
    for (const segment of this.netSegments) {
      const result = pointSegmentDistance(
        rock.x,
        rock.y,
        segment.a.x,
        segment.a.y,
        segment.b.x,
        segment.b.y
      );
      if (!closest || result.distance < closest.distance) {
        closest = { ...result, segment };
      }
    }
    if (!closest) return;

    const inside = pointInPolygon(rock.x, rock.y, this.netOutline);
    if (!inside && closest.distance > rock.radius + 3) return;

    const { segment } = closest;
    const tangent = normalize(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
    let normal = normalize(-tangent.y, tangent.x);
    if (normal.x > 0) normal = { x: -normal.x, y: -normal.y };
    if (Math.abs(normal.x) < 0.02) {
      normal = normal.y < 0 ? normal : { x: -normal.x, y: -normal.y };
    }

    const toward = rock.vx * normal.x + rock.vy * normal.y;
    const signedDistance =
      (rock.x - closest.x) * normal.x + (rock.y - closest.y) * normal.y;
    if (toward > -6 && signedDistance > rock.radius - 1) return;

    const speed = Math.hypot(rock.vx, rock.vy);
    const normalSpeed = Math.max(0, -toward);
    const tightness = this.tension / 100;
    const restitution = 0.025 + tightness * 0.12;

    if (toward < 0) {
      rock.vx -= (1 + restitution) * toward * normal.x;
      rock.vy -= (1 + restitution) * toward * normal.y;
    }

    let downhill = tangent;
    if (downhill.y < 0) downhill = { x: -downhill.x, y: -downhill.y };
    const slide = clamp(normalSpeed * 0.14, 12, 65) * (1 - tightness * 0.28);
    rock.vx += downhill.x * slide;
    rock.vy += downhill.y * slide;
    const friction = 0.9 + tightness * 0.04;
    rock.vx *= friction;
    rock.vy *= friction;

    const correction = rock.radius + 2.5 - signedDistance;
    if (correction > 0) {
      rock.x += normal.x * correction;
      rock.y += normal.y * correction;
    }

    rock.netContacts += 1;
    rock.lastNetContact = this.elapsed;
    rock.netCooldown = 0.085;
    const load = Math.min(
      3,
      (Math.pow(normalSpeed / 390, 1.35) * rock.mass * (0.34 + tightness * 0.92)) / 2.8
    );
    if (load > rock.peakImpactLoad) {
      rock.peakImpactLoad = load;
      rock.peakUV = { u: segment.u, v: segment.v };
    }

    this.netPulses.push({
      x: closest.x,
      y: closest.y,
      u: segment.u,
      v: segment.v,
      radius: 4,
      strength: clamp(load * 2.4 + 0.16, 0.16, 1),
      age: 0,
      life: 0.7
    });
    if (this.netPulses.length > 18) this.netPulses.shift();

    const impact = {
      rock,
      x: closest.x,
      y: closest.y,
      u: segment.u,
      v: segment.v,
      load,
      speed,
      normalSpeed,
      time: this.elapsed
    };
    this.emit('impact', impact);
  }

  recomputeAnchorLoads() {
    const loads = [0, 0, 0, 0];
    for (const rock of this.rocks) {
      if (!rock.peakUV || rock.peakImpactLoad <= 0) continue;
      const { u, v } = rock.peakUV;
      const weights = [
        (1 - u) * (1 - v),
        u * (1 - v),
        u * v,
        (1 - u) * v
      ];
      const threshold = 0.025;
      const boosted = weights.map((weight) =>
        weight > threshold ? Math.pow(weight, 0.72) : 0
      );
      const total = boosted.reduce((sum, value) => sum + value, 0) || 1;
      boosted.forEach((weight, index) => {
        loads[index] += rock.peakImpactLoad * (weight / total);
      });
    }
    this.anchorLoads = loads;
    if (this.tearIndex === null) {
      const torn = loads.findIndex((load) => load >= 1);
      if (torn >= 0) {
        this.tearIndex = torn;
        this.emit('tear', {
          index: torn,
          anchor: this.anchors[torn].label,
          load: loads[torn]
        });
      }
    }
  }

  updateNetPulses(dt) {
    for (const pulse of this.netPulses) {
      pulse.age += dt;
      pulse.radius += (11 + pulse.strength * 18) * dt;
    }
    this.netPulses = this.netPulses.filter((pulse) => pulse.age < pulse.life);
  }

  get pocketLoad() {
    const caughtMass = this.rocks.reduce(
      (sum, rock) => sum + (rock.netContacts > 0 ? rock.mass : 0),
      0
    );
    const looseness = Math.max(0, (TENSION_SAFE.min + 22 - this.tension) / 100);
    const pressure = Math.min(1.35, caughtMass * looseness * 0.18);
    if (pressure >= 1 && !this.overload) {
      this.overload = true;
      this.emit('overload', { pressure });
    }
    return pressure;
  }

  get peakAnchorLoad() {
    return Math.max(0, ...this.anchorLoads);
  }

  assess() {
    const breachCount = this.breaches.length;
    const caught = this.rocks.filter((rock) => rock.netContacts > 0).length;
    const buffered = this.rocks.filter((rock) => rock.buffered).length;
    const pocket = this.pocketLoad;
    const reasons = [];
    if (breachCount > 0) reasons.push(`${breachCount} 枚岩块越过围栏`);
    if (this.tearIndex !== null) reasons.push(`${this.anchors[this.tearIndex].label} 撕裂`);
    if (this.overload) reasons.push('网兜堆载超出安全容量');
    const success = reasons.length === 0;
    return {
      success,
      mode: this.mode,
      breachCount,
      caught,
      buffered,
      rockCount: this.rocks.length,
      pocketLoad: Number(pocket.toFixed(3)),
      peakAnchorLoad: Number(this.peakAnchorLoad.toFixed(3)),
      tearAnchor: this.tearIndex === null ? null : this.anchors[this.tearIndex].id,
      reasons,
      tension: this.tension,
      anchors: this.getAnchorState(),
      breaches: this.breaches
    };
  }

  getSnapshot() {
    return {
      state: this.state,
      mode: this.mode,
      elapsed: Number(this.elapsed.toFixed(2)),
      remaining: Number(Math.max(0, SIMULATION_SECONDS - this.elapsed).toFixed(2)),
      tension: this.tension,
      anchors: this.getAnchorState(),
      rockCount: this.rocks.length,
      caught: this.rocks.filter((rock) => rock.netContacts > 0).length,
      buffered: this.rocks.filter((rock) => rock.buffered).length,
      breachCount: this.breaches.length,
      peakAnchorLoad: Number(this.peakAnchorLoad.toFixed(3)),
      anchorLoads: this.anchorLoads.map((load) => Number(load.toFixed(3))),
      pocketLoad: Number(this.pocketLoad.toFixed(3)),
      tearIndex: this.tearIndex,
      result: this.result
    };
  }
}
