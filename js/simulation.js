/* Sphere physics + game state machine. Shared by browser and headless runs. */
(function (global) {
  const { T, key } = global.IceWorld;

  const C = {
    radius: 13,
    impulse: 150,          // px/s added per thrust impulse
    damping: 0.28,         // ice friction: velocity decays slowly
    maxSpeed: 330,
    measureSpeed: 26,      // sensor only valid below this speed
    measureTime: 2.0,      // must stay still for 2 seconds
    stressRate: 0.28,      // stress gained per second on thin ice
    stressMove: 0.24,      // extra stress while moving on thin ice
    stressDecay: 0.22,     // stress slowly relaxes after leaving
    stressCrack: 0.55,     // visible cracking starts here
    stressBreak: 1.0,      // ice gives way — mission failed
    campRadius: 30
  };

  const STATUS = { PLAYING: 'playing', FAILED: 'failed', WON: 'won' };

  function create(world) {
    const cx = (world.camp.x + 0.5) * world.cell;
    const cy = (world.camp.y + 0.5) * world.cell;
    return {
      world,
      status: STATUS.PLAYING,
      failReason: '',
      time: 0,
      x: cx,
      y: cy,
      vx: 0,
      vy: 0,
      roll: 0,
      thrusts: 0,
      activePoint: -1,
      measureProgress: 0,
      measurements: [],     // {point, x, y, t, duration}
      events: [],
      lastThrust: null
    };
  }

  function speed(sim) {
    return Math.hypot(sim.vx, sim.vy);
  }

  /* The only control available to the player: an instantaneous impulse. */
  function thrust(sim, dx, dy, power) {
    if (sim.status !== STATUS.PLAYING) return;
    const len = Math.hypot(dx, dy) || 1;
    const amount = C.impulse * Math.max(0.15, Math.min(1, power == null ? 1 : power));
    sim.vx += (dx / len) * amount;
    sim.vy += (dy / len) * amount;
    const sp = speed(sim);
    if (sp > C.maxSpeed) {
      sim.vx *= C.maxSpeed / sp;
      sim.vy *= C.maxSpeed / sp;
    }
    sim.thrusts++;
    sim.lastThrust = { t: sim.time, dx: dx / len, dy: dy / len };
    sim.events.push({ t: sim.time, type: 'thrust', x: sim.x, y: sim.y });
  }

  function currentPoint(world, x, y) {
    for (const p of world.points) {
      const px = (p.x + 0.5) * world.cell;
      const py = (p.y + 0.5) * world.cell;
      if (Math.hypot(px - x, py - y) <= world.cell * 0.55) return p;
    }
    return null;
  }

  function step(sim, dt) {
    if (sim.status !== STATUS.PLAYING) return sim;
    dt = Math.min(dt, 1 / 30);
    sim.time += dt;
    const w = sim.world;

    sim.vx -= sim.vx * C.damping * dt;
    sim.vy -= sim.vy * C.damping * dt;
    sim.x += sim.vx * dt;
    sim.y += sim.vy * dt;

    /* Lake walls keep the sphere on the grid. */
    const r = C.radius;
    if (sim.x < r) { sim.x = r; sim.vx = Math.abs(sim.vx) * 0.35; }
    if (sim.y < r) { sim.y = r; sim.vy = Math.abs(sim.vy) * 0.35; }
    if (sim.x > w.width - r) { sim.x = w.width - r; sim.vx = -Math.abs(sim.vx) * 0.35; }
    if (sim.y > w.height - r) { sim.y = w.height - r; sim.vy = -Math.abs(sim.vy) * 0.35; }

    sim.roll += (speed(sim) * dt) / r;

    const cell = w.cellAt(sim.x, sim.y);

    /* Falling into a hole is instant failure. */
    if (cell && cell.type === T.HOLE) {
      sim.status = STATUS.FAILED;
      sim.failReason = '探测器坠入冰洞';
      sim.events.push({ t: sim.time, type: 'fall', x: sim.x, y: sim.y });
      return sim;
    }

    /* Thin ice bends and accumulates damage while the sphere lingers. */
    if (cell && cell.type === T.THIN) {
      const moving = speed(sim) > C.measureSpeed ? C.stressMove : 0;
      w.stress[cell.index] = Math.min(
        C.stressBreak,
        w.stress[cell.index] + (C.stressRate + moving) * dt
      );
      if (w.stress[cell.index] >= C.stressBreak) {
        sim.status = STATUS.FAILED;
        sim.failReason = '薄冰应力超限，冰面破裂';
        sim.events.push({ t: sim.time, type: 'break', x: sim.x, y: sim.y,
          cell: cell.index });
        return sim;
      }
    }
    for (let k = 0; k < w.stress.length; k++) {
      if (cell && k === cell.index) continue;
      if (w.stress[k] > 0) w.stress[k] = Math.max(0, w.stress[k] - C.stressDecay * dt);
    }

    /* Measurement: inside a detection circle and slow enough for 2 s. */
    const p = currentPoint(w, sim.x, sim.y);
    if (p && !p.measured && speed(sim) <= C.measureSpeed) {
      if (sim.activePoint !== p.id) {
        sim.activePoint = p.id;
        sim.measureProgress = 0;
      }
      sim.measureProgress += dt;
      if (sim.measureProgress >= C.measureTime) {
        p.measured = true;
        sim.measurements.push({
          point: p.id, x: sim.x, y: sim.y, t: sim.time,
          duration: C.measureTime
        });
        sim.events.push({ t: sim.time, type: 'measure', point: p.id,
          x: sim.x, y: sim.y });
        sim.activePoint = -1;
        sim.measureProgress = 0;
      }
    } else {
      sim.activePoint = -1;
      sim.measureProgress = 0;
    }

    /* Win only after all three points are measured and the sphere is home. */
    const campX = (w.camp.x + 0.5) * w.cell;
    const campY = (w.camp.y + 0.5) * w.cell;
    const allDone = w.points.every((pt) => pt.measured);
    if (allDone && Math.hypot(sim.x - campX, sim.y - campY) <= C.campRadius
        && speed(sim) <= C.measureSpeed) {
      sim.status = STATUS.WON;
      sim.events.push({ t: sim.time, type: 'win' });
    }
    return sim;
  }

  const api = { C, STATUS, create, thrust, step, speed, currentPoint };
  globalThis.IceSim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
