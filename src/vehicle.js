/* Seeding truck physics: throttle, steering, contour assist and gravity slide on steep slopes. */
(function (global) {
  const App = (global.App = global.App || {});

  const CFG = {
    maxSpeed: 16,
    accel: 5.5,
    brakeDecel: 9,
    drag: 0.55,
    turnRate: 1.35,
    traction: 1.6,
    g: 9.81,
  };

  function createVehicle(x, y, terrain) {
    return {
      x,
      y,
      heading: terrain.contourAngle(x, y),
      speed: 0,
      throttle: 0,
      slideVx: 0,
      slideVy: 0,
      sliding: false,
      slope: terrain.slopeAt(x, y),
      width: 14,
      sowing: false,
      contourAssist: true,
    };
  }

  function stepVehicle(v, terrain, input, dt) {
    const target = (input.throttle || 0) * CFG.maxSpeed;
    if (input.brake) {
      v.speed = approach(v.speed, 0, CFG.brakeDecel * dt);
    } else {
      const rate = target > v.speed ? CFG.accel : CFG.drag;
      v.speed = approach(v.speed, target, rate * dt);
    }
    v.speed = Math.max(0, Math.min(CFG.maxSpeed, v.speed));

    if (input.contourAssist) {
      const targetHeading = terrain.contourAngle(v.x, v.y);
      v.heading = approachAngle(v.heading, targetHeading, CFG.turnRate * 1.4 * dt);
    } else if (input.steer) {
      v.heading += input.steer * CFG.turnRate * (0.35 + 0.65 * v.speed / CFG.maxSpeed) * dt;
    }

    const g = terrain.analyticGrad(v.x, v.y);
    const slope = Math.hypot(g.dx, g.dy);
    v.slope = slope;
    v.sliding = slope >= terrain.world.steepStart;
    let ax = 0;
    let ay = 0;
    if (v.sliding) {
      const excess = Math.min(1, (slope - terrain.world.steepStart) / 0.12);
      const accel = CFG.g * slope * excess * 0.55;
      ax += g.dx * accel;
      ay += g.dy * accel;
    }
    v.slideVx += ax * dt;
    v.slideVy += ay * dt;
    const tractionDecay = Math.exp(-CFG.traction * dt * (v.sliding ? 0.35 : 1.6));
    v.slideVx *= tractionDecay;
    v.slideVy *= tractionDecay;

    v.x += (Math.cos(v.heading) * v.speed + v.slideVx) * dt;
    v.y += (Math.sin(v.heading) * v.speed + v.slideVy) * dt;

    const m = 24;
    v.x = clamp(v.x, m, terrain.world.width - m);
    v.y = clamp(v.y, m, terrain.world.height - m);
    return v;
  }

  function approach(value, target, maxDelta) {
    if (value < target) return Math.min(target, value + maxDelta);
    if (value > target) return Math.max(target, value - maxDelta);
    return target;
  }

  function approachAngle(current, target, maxDelta) {
    let diff = normalizeAngle(target - current);
    if (Math.abs(diff) <= maxDelta) return target;
    return current + Math.sign(diff) * maxDelta;
  }

  function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  App.Vehicle = { createVehicle, stepVehicle, CFG };
  if (typeof module !== 'undefined' && module.exports) module.exports = App.Vehicle;
})(typeof globalThis !== 'undefined' ? globalThis : this);
