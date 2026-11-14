import {
  GRAVITY, MASS_BASE, MASS_PER_JAR, MAX_SPEED, DRIVE_FORCE, ROLLING_DRAG, BRAKE_FORCE,
  TURN_RATE, GRIP, SLIP_GRIP, SLIP_SIDE_SPEED, HIGH_SPEED_STEER, HOP_TRIGGER_SLOPE,
  HOP_LIFT, LANDING_DAMAGE_SPEED, LANDING_DAMAGE_K, RIM_LANDSLIDE_DAMAGE, RIM_SIDE_KICK,
  STEEP_DAMAGE_RATE, DAMAGE_ABORT, PICKUP_RADIUS, LANDER_RADIUS, TOTAL_JARS, DT
} from './config.js';

export function createRover(world) {
  return {
    x: world.lander.x, y: world.lander.y,
    heading: 0, vx: 0, vy: 0,
    z: world.heightAt(world.lander.x, world.lander.y), vz: 0,
    groundZ: world.heightAt(world.lander.x, world.lander.y),
    hopStartZ: world.heightAt(world.lander.x, world.lander.y), airborne: false,
    throttle: 0, brake: 0, steer: 0,
    jars: 0, damage: 0, status: 'active',
    time: 0, slip: false, slipDistance: 0,
    ruts: [], rutTimer: 0, dust: [], hopMarks: [],
    events: [], totalDistance: 0
  };
}

function pushDust(r, x, y, n, power, rng) {
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const sp = (0.4 + rng() * 0.8) * power;
    r.dust.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0, maxLife: 0.7 + rng() * 0.7,
      size: 0.25 + rng() * 0.45
    });
  }
  if (r.dust.length > 400) r.dust.splice(0, r.dust.length - 400);
}

// 单步推进（固定 60Hz）。input: {throttle, brake, steer}，范围 -1..1。
export function step(world, r, input = {}, dt = DT) {
  r.events = [];
  if (r.status !== 'active') return r;
  r.throttle = clamp(input.throttle ?? 0, -1, 1);
  r.brake = clamp(input.brake ?? 0, 0, 1);
  r.steer = clamp(input.steer ?? 0, -1, 1);
  r.time += dt;
  const mass = MASS_BASE + r.jars * MASS_PER_JAR;
  const slope = world.slopeAt(r.x, r.y);

  if (r.airborne) {
    r.vz -= GRAVITY * dt;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.heading += r.steer * TURN_RATE * 0.35 * dt; // 低重力空中只能缓慢修正朝向
    const ground = world.heightAt(r.x, r.y);
    r.z += r.vz * dt;
    // 落地条件：高度降到当前地面，且相对起跳点已明显回落（坑内地面更低时也能落地）
    if (r.z <= ground && r.z <= r.hopStartZ + 0.4) {
      const impact = Math.max(0, -(r.vz - 0));
      r.z = ground; r.vz = 0; r.airborne = false; r.groundZ = ground;
      r.hopMarks.push({ x: r.x, y: r.y, r: 0.5 + impact * 0.18, age: 0 });
      r.events.push({ type: 'land', impact });
      if (impact > LANDING_DAMAGE_SPEED) {
        r.damage += (impact - LANDING_DAMAGE_SPEED) * LANDING_DAMAGE_K;
      }
      pushDust(r, r.x, r.y, 14, 1.6, world.rng);
    }
  } else {
    driveOnGround(world, r, slope, mass, dt);
  }

  handleCraters(world, r);
  handleSamples(world, r);
  updateEffects(world, r, dt);
  r.x = clamp(r.x, 1, world.width - 1);
  r.y = clamp(r.y, 1, world.height - 1);
  if (r.damage >= DAMAGE_ABORT) {
    r.damage = DAMAGE_ABORT;
    r.status = 'aborted';
    r.events.push({ type: 'abort' });
  }
  if (r.jars >= TOTAL_JARS && Math.hypot(r.x - world.lander.x, r.y - world.lander.y) <= LANDER_RADIUS) {
    r.status = 'returned';
    r.events.push({ type: 'return' });
  }
  return r;
}

function driveOnGround(world, r, slope, mass, dt) {
  const headingBefore = r.heading;
  const fx0 = Math.cos(headingBefore), fy0 = Math.sin(headingBefore);
  let vf = r.vx * fx0 + r.vy * fy0;
  let vs = r.vx * (-fy0) + r.vy * fx0;

  // 纵向：驱动力 / 制动 / 月尘滚动阻力 / 坡面重力分量。载荷越重加速越钝。
  let af = r.throttle * DRIVE_FORCE / mass;
  if (r.brake > 0 && Math.abs(vf) > 0.02) af -= Math.sign(vf) * BRAKE_FORCE * r.brake / mass;
  af -= ROLLING_DRAG * vf;
  af -= GRAVITY * (slope.dx * fx0 + slope.dy * fy0);
  vf += af * dt;
  vf = clamp(vf, -MAX_SPEED * 0.5, MAX_SPEED);

  // 加速后转向迟滞：速度越高，相同输入的转角越小。
  const steerFactor = clamp(HIGH_SPEED_STEER / Math.max(Math.abs(vf), 0.1), 0.32, 1);
  r.heading += r.steer * TURN_RATE * steerFactor * dt;

  // 车头旋转后，旧速度相对新车头产生横向分量；抓地只能按指数拉回，拉不回即打滑。
  const grip = r.slip ? SLIP_GRIP : GRIP;
  const turn = r.heading - headingBefore;
  const vsRot = vf * Math.sin(turn) + vs * Math.cos(turn);
  const vfRot = vf * Math.cos(turn) - vs * Math.sin(turn);
  vs = vsRot;
  vf = vfRot;
  vs += -GRAVITY * (slope.dx * (-Math.sin(r.heading)) + slope.dy * Math.cos(r.heading)) * dt;
  vs *= Math.exp(-grip * dt);
  if (!r.slip && Math.abs(vs) > SLIP_SIDE_SPEED) {
    r.slip = true;
    r.events.push({ type: 'slip-start', side: Math.sign(vs) });
  } else if (r.slip && Math.abs(vs) < 0.35) {
    r.slip = false;
    r.events.push({ type: 'slip-end' });
  }
  if (r.slip) r.slipDistance += Math.abs(vs) * dt;

  const nfx = Math.cos(r.heading), nfy = Math.sin(r.heading);
  const nrx = -nfy, nry = nfx;
  r.vx = nfx * vf + nrx * vs;
  r.vy = nfy * vf + nry * vs;
  const speed = Math.hypot(r.vx, r.vy);
  r.x += r.vx * dt;
  r.y += r.vy * dt;
  r.groundZ = world.heightAt(r.x, r.y);
  r.z = r.groundZ;
  r.totalDistance += speed * dt;

  // 陡坡在低重力下把车抛起来，形成跳痕。
  if (slope.mag > HOP_TRIGGER_SLOPE && speed > 2.2) {
    r.airborne = true;
    r.groundZ = world.heightAt(r.x, r.y);
    r.hopStartZ = r.groundZ;
    r.vz = HOP_LIFT * (0.7 + Math.min(slope.mag, 0.8));
    r.events.push({ type: 'hop', slope: slope.mag });
  }
  if (slope.mag > 0.46) r.damage += STEEP_DAMAGE_RATE * dt;
  if (r.slip || speed > 3.2) {
    pushDust(r, r.x - nfx * 0.8, r.y - nfy * 0.8, r.slip ? 4 : 1, 0.6 + speed * 0.18, world.rng);
  }
}

function handleCraters(world, r) {
  for (const c of world.craters) {
    const d = Math.hypot(r.x - c.x, r.y - c.y);
    const onRim = d >= c.rim - 0.9 && d <= c.rim + c.band;
    if (onRim && !c.triggered) {
      c.triggered = true;
      r.damage += RIM_LANDSLIDE_DAMAGE;
      const out = Math.atan2(r.y - c.y, r.x - c.x);
      r.vx += Math.cos(out) * RIM_SIDE_KICK;
      r.vy += Math.sin(out) * RIM_SIDE_KICK;
      r.events.push({ type: 'landslide', crater: c, damage: RIM_LANDSLIDE_DAMAGE });
      pushDust(r, r.x, r.y, 26, 2.2, world.rng);
    }
    if (d < c.rim * 0.55 && !r.airborne) {
      r.damage += STEEP_DAMAGE_RATE * 1.4 * DT;
    }
  }
}

function handleSamples(world, r) {
  for (const s of world.samples) {
    if (s.collected) continue;
    if (Math.hypot(r.x - s.x, r.y - s.y) <= PICKUP_RADIUS) {
      s.collected = true;
      r.jars += 1;
      r.events.push({ type: 'pickup', jar: r.jars, sample: s });
      pushDust(r, s.x, s.y, 12, 1.1, world.rng);
    }
  }
}

function updateEffects(world, r, dt) {
  r.rutTimer += dt;
  const speed = Math.hypot(r.vx, r.vy);
  if (!r.airborne && speed > 0.4 && r.rutTimer > 0.12) {
    r.rutTimer = 0;
    const rx = -Math.sin(r.heading), ry = Math.cos(r.heading);
    r.ruts.push({
      x: r.x, y: r.y,
      x2: r.x + rx * 0.9, y2: r.y + ry * 0.9,
      x3: r.x - rx * 0.9, y3: r.y - ry * 0.9,
      slip: r.slip, age: 0
    });
    if (r.ruts.length > 900) r.ruts.splice(0, r.ruts.length - 900);
  }
  for (const p of r.dust) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.96;
    p.vy *= 0.96;
  }
  r.dust = r.dust.filter((p) => p.life < p.maxLife);
  for (const m of r.hopMarks) m.age += dt;
  if (r.hopMarks.length > 60) r.hopMarks.shift();
  for (const q of r.ruts) q.age += dt;
}

// 从当前速度全制动到停止所需距离；每多一罐样本制动距离增加。
export function measureBraking(world, startX, startY, heading, speed0, jars) {
  const probe = createRover(world);
  probe.x = startX; probe.y = startY; probe.heading = heading;
  probe.vx = Math.cos(heading) * speed0;
  probe.vy = Math.sin(heading) * speed0;
  probe.jars = jars;
  let distance = 0;
  let steps = 0;
  while (Math.hypot(probe.vx, probe.vy) > 0.05 && steps < 60 * 20) {
    const before = Math.hypot(probe.vx, probe.vy);
    step(world, probe, { throttle: 0, brake: 1, steer: 0 });
    distance += before * DT;
    steps++;
  }
  return { distance, steps, time: steps * DT };
}

export function runEpisode(world, controller, maxSteps = 60 * 90) {
  const rover = createRover(world);
  const log = [];
  for (let i = 0; i < maxSteps && rover.status === 'active'; i++) {
    const input = controller(world, rover, i);
    step(world, rover, input);
    for (const ev of rover.events) log.push({ t: rover.time, ...ev });
  }
  return { rover, log, steps: Math.round(rover.time / DT) };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
