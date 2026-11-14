/* Deterministic autopilot. transit: drive to a zone start without sowing.
   follow: trace the contour polyline slowly while continuously sowing. */
(function (global) {
  const App = (global.App = global.App || {});

  function angleDiff(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  function createAutopilot(sim, options) {
    const opts = options || {};
    sim.setWidth(opts.width || 22);
    const route = [];
    const zoneBounds = [];
    for (const zone of sim.zones) {
      zoneBounds.push([route.length, route.length + zone.polyline.length]);
      for (const p of zone.polyline) route.push({ x: p.x, y: p.y, zone: zone.id });
    }

    const ap = {
      route,
      zoneBounds,
      wpIndex: 0,
      zoneIndex: 0,
      phase: 'transit',
      done: false,
      maxSteps: opts.maxSteps || 60 * sim.zones.length * 60,
      steps: 0,
      compensate: opts.compensate !== false,
      arrivalRadius: 5,
      seedExhausted: false,
    };

    ap.update = function () {
      if (ap.done) return sim.input;
      ap.steps++;
      const v = sim.vehicle;
      const [lo, hi] = zoneBounds[ap.zoneIndex];
      if (ap.wpIndex < lo) ap.wpIndex = lo;
      const target = route[ap.wpIndex];
      let tx = target.x;
      let ty = target.y;
      if (ap.compensate) {
        const driftMag = sim.wind.baseSpeed * sim.wind.driftPerMeter;
        tx -= sim.wind.unit.x * driftMag;
        ty -= sim.wind.unit.y * driftMag;
      }
      const dist = Math.hypot(tx - v.x, ty - v.y);
      const desired = Math.atan2(ty - v.y, tx - v.x);
      const diff = angleDiff(v.heading, desired);
      const headingDiff = Math.abs(diff);

      sim.input.contourAssist = false;
      sim.input.steer = 0;
      sim.input.brake = false;

      if (ap.phase === 'transit') {
        if (headingDiff > 0.1) sim.input.steer = Math.sign(diff);
        sim.input.throttle = headingDiff > 0.6 ? 0 : dist > 60 ? 0.85 : 0.5;
        sim.input.brake = headingDiff > 0.6 && v.speed > 4;
        sim.input.sowing = false;
        if (dist <= ap.arrivalRadius * 2) ap.phase = 'follow';
      } else {
        const prev = route[Math.max(lo, ap.wpIndex - 1)];
        const segH = Math.atan2(target.y - prev.y, target.x - prev.x);
        const nx = -Math.sin(segH);
        const ny = Math.cos(segH);
        const cross = (v.x - prev.x) * nx + (v.y - prev.y) * ny;
        const corrected = desired - Math.max(-0.5, Math.min(0.5, cross * 0.08));
        const followDiff = angleDiff(v.heading, corrected);
        if (Math.abs(followDiff) > 0.05) sim.input.steer = Math.sign(followDiff);
        sim.input.throttle = Math.abs(followDiff) > 0.4 ? 0.06 : 0.16;
        sim.input.sowing = Math.abs(followDiff) <= 0.25;
      }

      if (dist <= ap.arrivalRadius) {
        ap.wpIndex++;
        if (ap.wpIndex >= hi) {
          ap.zoneIndex++;
          if (ap.zoneIndex >= zoneBounds.length) {
            ap.done = true;
          } else {
            ap.phase = 'transit';
            ap.wpIndex = zoneBounds[ap.zoneIndex][0];
          }
        }
      }
      if (sim.finished && !sim.won) ap.seedExhausted = true;
      if (ap.steps >= ap.maxSteps) ap.done = true;
      return sim.input;
    };

    return ap;
  }

  function runAutopilot(sim, options) {
    const ap = createAutopilot(sim, options);
    const trace = [];
    while (!ap.done) {
      ap.update();
      const snap = sim.step();
      if (trace.length % 30 === 0) trace.push(snap);
      if (sim.finished) break;
    }
    sim.input.sowing = false;
    return { autopilot: ap, final: sim.snapshot(), trace };
  }

  App.Autopilot = { createAutopilot, runAutopilot };
  if (typeof module !== 'undefined' && module.exports) module.exports = App.Autopilot;
})(typeof globalThis !== 'undefined' ? globalThis : this);
