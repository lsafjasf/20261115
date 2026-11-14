/* Deterministic autopilot: proves a full three-point run is possible.
   It only ever calls the same impulse API the human player uses. */
(function (global) {
  const { T } = global.IceWorld;
  const { C } = global.IceSim;

  function bfs(world, start, goal) {
    const { cols, rows, types } = world;
    const k = (x, y) => y * cols + x;
    /* Weighted shortest path: thin ice costs more, so the tour routes
       around thin zones whenever solid ice offers a reasonable detour. */
    const prev = new Map();
    const dist = new Map();
    const sk = k(start.x, start.y);
    dist.set(sk, 0);
    const visited = new Set();
    const goalKey = k(goal.x, goal.y);
    while (dist.size) {
      let curKey = null, curD = Infinity;
      for (const [kk, d] of dist) {
        if (!visited.has(kk) && d < curD) { curD = d; curKey = kk; }
      }
      if (curKey === null) break;
      visited.add(curKey);
      if (curKey === goalKey) break;
      const cx = curKey % cols, cy = Math.floor(curKey / cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nk = k(nx, ny);
        if (visited.has(nk) || types[nk] === T.HOLE) continue;
        const w = types[nk] === T.THIN ? 6 : 1;
        const nd = curD + w;
        if (nd < (dist.has(nk) ? dist.get(nk) : Infinity)) {
          dist.set(nk, nd);
          prev.set(nk, curKey);
        }
      }
    }
    if (!visited.has(goalKey)) return null;
    const path = [];
    let cur = goalKey;
    while (cur !== sk) {
      path.push({ x: cur % cols, y: Math.floor(cur / cols) });
      cur = prev.get(cur);
    }
    path.reverse();
    return path;
  }

  function center(world, cell) {
    return {
      x: (cell.x + 0.5) * world.cell,
      y: (cell.y + 0.5) * world.cell
    };
  }

  /* Nearest-point ordering keeps the route short and thin-ice exposure low. */
  function planTour(world) {
    const goals = world.points
      .slice()
      .sort((a, b) =>
        Math.hypot(a.x - world.camp.x, a.y - world.camp.y) -
        Math.hypot(b.x - world.camp.x, b.y - world.camp.y));
    const legs = [];
    let cur = world.camp;
    for (const g of goals) {
      const path = bfs(world, cur, g);
      if (!path) throw new Error('no path to point ' + g.id);
      legs.push({ point: g.id, path });
      cur = g;
    }
    const home = bfs(world, cur, world.camp);
    if (!home) throw new Error('no path back to camp');
    legs.push({ point: -1, path: home });
    return legs;
  }

  function createPilot(world, sim) {
    const legs = planTour(world);
    let leg = 0;
    let stepIdx = 0;
    let phase = 'travel';      // travel | measure | home
    let wait = 0;
    let armed = false;
    const log = [];
    const cruise = 90;         // target cruise speed, px/s

    /* Velocity-matching controller: every impulse nudges the current
       velocity toward a desired velocity vector, using scaled power so
       thrust and brake never fight each other into oscillation. */
    function steerToward(desiredVx, desiredVy, cooldown) {
      const dvx = desiredVx - sim.vx;
      const dvy = desiredVy - sim.vy;
      const dv = Math.hypot(dvx, dvy);
      if (dv < 6 || wait > 0) return;
      const power = Math.min(1, dv / C.impulse);
      global.IceSim.thrust(sim, dvx / dv, dvy / dv, power);
      wait = cooldown;
    }

    function target() {
      const path = legs[leg].path;
      if (stepIdx >= path.length) return null;
      return center(world, path[stepIdx]);
    }

    function update(dt) {
      if (sim.status !== 'playing') return;
      wait = Math.max(0, wait - dt);
      const sp = Math.hypot(sim.vx, sim.vy);

      /* On a measurement point: brake, then sit still for the full 2 s. */
      if (phase === 'measure') {
        const pointId = legs[leg].point;
        const goal = center(world, {
          x: world.points[pointId].x,
          y: world.points[pointId].y
        });
        /* Desired velocity: kill speed, with a gentle recentering term. */
        const k = 1.6;
        steerToward((goal.x - sim.x) * k, (goal.y - sim.y) * k, 0.12);
        if (armed && pointId >= 0 && world.points[pointId].measured) {
          log.push({ t: sim.time, event: 'point-measured', point: pointId });
          leg++;
          stepIdx = 0;
          armed = false;
          phase = leg >= legs.length ? 'done'
            : legs[leg].point >= 0 ? 'travel' : 'home';
        }
        return;
      }
      if (phase === 'done' || leg >= legs.length) return;

      /* Final approach to camp: brake once the win zone is reached and let
         the simulation's own win condition close the mission. */
      if (phase === 'home-final') {
        const campC = center(world, world.camp);
        steerToward((campC.x - sim.x) * 1.6, (campC.y - sim.y) * 1.6, 0.12);
        return;
      }

      const t = target();
      if (!t) return;
      const dx = t.x - sim.x, dy = t.y - sim.y;
      const dist = Math.hypot(dx, dy);

      /* Reached the current path waypoint: advance. */
      if (dist < world.cell * 0.3) {
        stepIdx++;
        if (stepIdx >= legs[leg].path.length) {
          if (legs[leg].point >= 0) {
            phase = 'measure';
            armed = true;
            wait = 0;
          } else {
            phase = 'home-final';
            wait = 0;
          }
          return;
        }
        return;
      }
      const nx = dx / dist, ny = dy / dist;
      const isLastStep = stepIdx === legs[leg].path.length - 1;
      const targetSpeed = isLastStep ? 22 : cruise;
      /* Slow down on the final approach so the sphere arrives ready to
         hold still for the two-second sensor reading. */
      const desired = isLastStep
        ? Math.min(targetSpeed, dist * 2.2)
        : targetSpeed;
      steerToward(nx * desired, ny * desired, 0.14);
    }

    return {
      update, legs, log,
      get leg() { return leg; },
      get stepIdx() { return stepIdx; },
      get phase() { return phase; }
    };
  }

  /* Headless helper: run the whole mission and return a trace. */
  function runMission(world, sim, dt) {
    const pilot = createPilot(world, sim);
    const trace = [];
    const hz = dt || 1 / 60;
    let guard = 0;
    while (sim.status === 'playing' && guard < 60 * 60 * 5) {
      pilot.update(hz);
      global.IceSim.step(sim, hz);
      if (guard % 6 === 0) {
        trace.push({
          t: +sim.time.toFixed(3), x: +sim.x.toFixed(2), y: +sim.y.toFixed(2),
          vx: +sim.vx.toFixed(2), vy: +sim.vy.toFixed(2),
          status: sim.status,
          measured: world.points.map((p) => p.measured)
        });
      }
      guard++;
    }
    return {
      status: sim.status,
      failReason: sim.failReason,
      time: +sim.time.toFixed(2),
      thrusts: sim.thrusts,
      measurements: sim.measurements,
      events: sim.events,
      trace
    };
  }

  const api = { bfs, planTour, createPilot, runMission };
  globalThis.IcePilot = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
