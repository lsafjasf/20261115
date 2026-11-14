import { clamp, damp, normalizeAngle } from "./rng.js";

const GRAVITY = 9.81;

export class SnowSled {
  constructor(world) {
    const sample = world.route.samples[3];
    this.x = sample.x;
    this.y = sample.y;
    this.vx = 0;
    this.vy = 0;
    this.heading = sample.angle;
    this.angularVelocity = 0;
    this.steerVisual = 0;
    this.throttleVisual = 0;
    this.longitudinalSpeed = 0;
    this.lateralSpeed = 0;
    this.acceleration = 0;
    this.onRoad = true;
    this.routeIndex = 3;
    this.strapTension = 0.35;
    this.cargoForward = 0;
    this.cargoLateral = 0;
    this.cargoVelocityForward = 0;
    this.cargoVelocityLateral = 0;
    this.cargoDanger = false;
    this.risk = 0.06;
    this.riskTimer = 0;
    this.rolledOver = false;
    this.maxCargoShift = 0;
    this.maxRisk = 0;
    this.strapActions = 0;
    this.lastBrake = 0;
    this.lastLongSpeed = 0;
    this.brakeHold = 0;
    this.shake = 0;
    this.strapRatchetTimer = 0;
    this.events = [];
    this.updateVectors();
  }

  updateVectors() {
    this.forwardX = Math.cos(this.heading);
    this.forwardY = Math.sin(this.heading);
    this.rightX = -this.forwardY;
    this.rightY = this.forwardX;
  }

  reset(world) {
    const sample = world.route.samples[3];
    this.x = sample.x;
    this.y = sample.y;
    this.vx = 0;
    this.vy = 0;
    this.heading = sample.angle;
    this.angularVelocity = 0;
    this.steerVisual = 0;
    this.throttleVisual = 0;
    this.longitudinalSpeed = 0;
    this.lateralSpeed = 0;
    this.acceleration = 0;
    this.onRoad = true;
    this.routeIndex = 3;
    this.strapTension = 0.35;
    this.cargoForward = 0;
    this.cargoLateral = 0;
    this.cargoVelocityForward = 0;
    this.cargoVelocityLateral = 0;
    this.cargoDanger = false;
    this.risk = 0.06;
    this.riskTimer = 0;
    this.rolledOver = false;
    this.maxCargoShift = 0;
    this.maxRisk = 0;
    this.strapActions = 0;
    this.lastBrake = 0;
    this.lastLongSpeed = 0;
    this.brakeHold = 0;
    this.shake = 0;
    this.strapRatchetTimer = 0;
    this.events = [];
    this.updateVectors();
  }

  get speedKmh() {
    return Math.abs(this.longitudinalSpeed) * 3.6;
  }

  get cargoShiftCm() {
    return Math.hypot(this.cargoForward, this.cargoLateral) * 6.1;
  }

  pressBrake(controls) {
    this.brakeHold = controls.brake > 0 ? this.brakeHold + 1 : 0;
  }

  updateCargo(dt, brake, long, lateral, acceleration, slopeLateral, world) {
    const brakeStart = brake > 0.55 && this.lastBrake < 0.2;
    if (brakeStart && Math.abs(long) > 4.2) {
      this.cargoVelocityForward += 2.8 + Math.abs(long) * 0.62;
      this.shake = Math.max(this.shake, 0.75);
      this.events.push({ type: "cargoBrake", speed: Math.abs(long), strap: this.strapTension });
    }

    const stiffness = 0.48 + this.strapTension * 6.2;
    const damping = 0.72 + this.strapTension * 3.7;
    const inertialForward = -acceleration * 0.76;
    const inertialLateral = -long * this.angularVelocity * 0.44 - slopeLateral * 5.1;

    this.cargoVelocityForward += (
      inertialForward -
      this.cargoForward * stiffness -
      this.cargoVelocityForward * damping
    ) * dt;
    this.cargoVelocityLateral += (
      inertialLateral -
      this.cargoLateral * (stiffness * 0.8) -
      this.cargoVelocityLateral * damping
    ) * dt;

    this.cargoForward += this.cargoVelocityForward * dt;
    this.cargoLateral += this.cargoVelocityLateral * dt;

    if (this.cargoForward > 25) {
      this.cargoForward = 25;
      if (this.cargoVelocityForward > 2) {
        this.events.push({ type: "cargoImpact", force: this.cargoVelocityForward });
        this.shake = Math.max(this.shake, 1);
      }
      this.cargoVelocityForward *= -0.16;
    }
    if (this.cargoForward < -8) {
      this.cargoForward = -8;
      this.cargoVelocityForward *= -0.2;
    }
    this.cargoLateral = clamp(this.cargoLateral, -13, 13);

    const shift = Math.hypot(this.cargoForward, this.cargoLateral) * 6.1;
    this.maxCargoShift = Math.max(this.maxCargoShift, shift);
    this.cargoDanger = shift > 76;
  }

  updateRisk(dt, throttle, steer, brake, slopeLateral, world) {
    const turnLoad = Math.abs(this.longitudinalSpeed * this.angularVelocity) / GRAVITY;
    const sideLoad = Math.abs(slopeLateral) * 2.15;
    const cargoMoment =
      (Math.max(0, this.cargoForward - 1.5) / 23) * 1.12 +
      (Math.abs(this.cargoLateral) / 26) * 0.24;
    const target = clamp(
      turnLoad * 0.58 +
      cargoMoment +
      Math.abs(this.lateralSpeed) * 0.016 +
      sideLoad +
      (this.onRoad ? 0 : 0.08) -
      this.strapTension * 0.045 -
      0.045,
      0,
      1.25,
    );
    this.risk = damp(this.risk, target, target > this.risk ? 3.6 : 1.4, dt);
    this.maxRisk = Math.max(this.maxRisk, this.risk);

    if (this.risk > 0.91 && Math.abs(this.longitudinalSpeed) > 3.2) {
      this.riskTimer += dt;
      if (this.riskTimer > 1.45) {
        this.rolledOver = true;
        this.events.push({ type: "rollover" });
      }
    } else {
      this.riskTimer = Math.max(0, this.riskTimer - dt * 2.1);
    }
  }

  updateStraps(dt, controls, world) {
    const tighten = controls.strapTighten ? 1 : 0;
    const loosen = controls.strapLoosen ? 1 : 0;
    const change = tighten - loosen;
    if (change !== 0) {
      this.strapTension = clamp(this.strapTension + change * 0.19 * dt, 0.08, 1);
      this.strapRatchetTimer += dt;
      if (tighten && this.strapRatchetTimer > 0.33) {
        this.strapRatchetTimer = 0;
        this.events.push({ type: "strapClick" });
      }
    } else {
      this.strapRatchetTimer = 0;
    }
    this.strapTension = clamp(this.strapTension - dt * (this.onRoad ? 0.0015 : 0.009), 0.08, 1);
  }

  drawLighting(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading);
    const flicker = 0.92 + Math.sin(time * 14) * 0.025 + Math.sin(time * 31) * 0.015;
    const beam = ctx.createLinearGradient(20, 0, 195, 0);
    beam.addColorStop(0, `rgba(225, 247, 238, ${0.17 * flicker})`);
    beam.addColorStop(0.45, `rgba(198, 234, 229, ${0.07 * flicker})`);
    beam.addColorStop(1, "rgba(180, 220, 222, 0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(24, -9);
    ctx.lineTo(192, -95);
    ctx.lineTo(226, -70);
    ctx.lineTo(121, 0);
    ctx.lineTo(226, 70);
    ctx.lineTo(192, 95);
    ctx.lineTo(24, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  draw(ctx, time, cargoCount) {
    const shakeX = (Math.random() - 0.5) * this.shake * 1.8;
    const shakeY = (Math.random() - 0.5) * this.shake * 1.8;
    const lean = clamp(this.lateralSpeed * 0.006 + this.cargoForward * 0.0009, -0.12, 0.12);
    ctx.save();
    ctx.translate(this.x + shakeX, this.y + shakeY);
    ctx.rotate(this.heading);

    ctx.save();
    ctx.translate(-4, 5);
    ctx.fillStyle = "rgba(4, 12, 15, 0.43)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 41, 25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.rotate(lean);
    for (const side of [-1, 1]) {
      ctx.fillStyle = "#111d21";
      ctx.beginPath();
      ctx.roundRect(-34, side * 18 - 8, 68, 16, 7);
      ctx.fill();
      ctx.strokeStyle = "rgba(198, 224, 225, 0.28)";
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.strokeStyle = "rgba(157, 189, 191, 0.3)";
      ctx.lineWidth = 0.75;
      for (let tread = -29; tread <= 28; tread += 6) {
        const offset = (time * Math.abs(this.longitudinalSpeed) * 0.7) % 6;
        const x = tread + offset;
        if (x > -31 && x < 31) {
          ctx.beginPath();
          ctx.moveTo(x, side * 18 - 5);
          ctx.lineTo(x + 2, side * 18 + 5);
          ctx.stroke();
        }
      }
    }

    ctx.fillStyle = "#31474d";
    ctx.beginPath();
    ctx.roundRect(-31, -16, 60, 32, 5);
    ctx.fill();

    ctx.fillStyle = "#d8e4e3";
    ctx.beginPath();
    ctx.roundRect(5, -16, 28, 32, 5);
    ctx.fill();
    ctx.fillStyle = "#20353d";
    ctx.beginPath();
    ctx.roundRect(11, -11, 15, 22, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(131, 213, 218, 0.5)";
    ctx.fillRect(14, -8, 8, 14);

    ctx.fillStyle = "#a8bdc0";
    ctx.beginPath();
    ctx.roundRect(-31, -16, 35, 32, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(218, 239, 239, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-31, -16, 35, 32, 3);
    ctx.stroke();

    for (let row = -1; row <= 1; row += 1) {
      if (row + 2 > cargoCount) continue;
      const cargoX = -21 + this.cargoForward * 0.82;
      const cargoY = row * 9 + this.cargoLateral * 0.8;
      ctx.fillStyle = "rgba(8, 20, 24, 0.27)";
      ctx.fillRect(cargoX + 2 - 7, cargoY + 2 - 7, 15, 15);
      ctx.fillStyle = row === 1 ? "#d6a955" : row === 2 ? "#bd8c3d" : "#e1b861";
      ctx.fillRect(cargoX - 7, cargoY - 7, 15, 15);
      ctx.strokeStyle = "rgba(73, 51, 24, 0.65)";
      ctx.lineWidth = 0.9;
      ctx.strokeRect(cargoX - 7, cargoY - 7, 15, 15);
      ctx.fillStyle = "rgba(255, 248, 220, 0.8)";
      ctx.fillRect(cargoX - 1.5, cargoY - 3.5, 3, 7);
      ctx.fillRect(cargoX - 3.5, cargoY - 1.5, 7, 3);
    }

    ctx.strokeStyle = this.strapTension > 0.7 ? "#ffc15a" : "rgba(92, 68, 36, 0.9)";
    ctx.lineWidth = 1.1 + this.strapTension * 1.1;
    const strapY = 12 - this.cargoLateral * 0.4;
    const strapX = -5 + this.cargoForward * 0.45;
    ctx.beginPath();
    ctx.moveTo(-29, -15);
    ctx.lineTo(strapX, -strapY);
    ctx.lineTo(-29, 15);
    ctx.moveTo(4, -15);
    ctx.lineTo(strapX + 7, strapY);
    ctx.lineTo(4, 15);
    ctx.stroke();

    ctx.fillStyle = "#111c20";
    ctx.beginPath();
    ctx.roundRect(27, -14, 5, 9, 2);
    ctx.roundRect(27, 5, 5, 9, 2);
    ctx.fill();
    ctx.fillStyle = "rgba(238, 255, 238, 0.9)";
    ctx.fillRect(31, -12, 2, 5);
    ctx.fillRect(31, 7, 2, 5);
    ctx.fillStyle = "rgba(255, 133, 62, 0.8)";
    ctx.fillRect(-34, -14, 2, 4);
    ctx.fillRect(-34, 10, 2, 4);

    ctx.fillStyle = "rgba(239, 251, 251, 0.85)";
    ctx.font = "600 8px 'Barlow Condensed', 'Noto Sans SC Local', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("07", 19, 1);
    ctx.restore();
  }
  step(dt, controls, world, weather) {
    this.events.length = 0;
    if (this.rolledOver) {
      this.vx = damp(this.vx, 0, 4, dt);
      this.vy = damp(this.vy, 0, 4, dt);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      return;
    }

    this.updateVectors();
    const nearest = world.nearestRoute(this.x, this.y, 35);
    this.onRoad = nearest.distance < 31;
    this.routeIndex = nearest.index;

    let long = this.vx * this.forwardX + this.vy * this.forwardY;
    let lateral = this.vx * this.rightX + this.vy * this.rightY;
    const throttle = clamp(controls.throttle - controls.reverse, -1, 1);
    const brake = clamp(controls.brake, 0, 1);
    const steer = clamp(controls.steer, -1, 1);
    const directionSign = Math.sign(long) || Math.sign(throttle) || 1;
    const speedLimit = this.onRoad ? 18.5 : 7.2;
    const driveForce = throttle >= 0
      ? throttle * 7.1 * (1 - clamp(Math.abs(long) / (speedLimit * 1.2), 0, 0.82))
      : throttle * 4.6;
    const brakeForce = -directionSign * brake * 12.8;
    const rollingResistance = -Math.sign(long) * (this.onRoad ? 0.5 : 2.1);
    const drag = -long * Math.abs(long) * (this.onRoad ? 0.007 : 0.018);
    let acceleration = driveForce + brakeForce + rollingResistance + drag;

    const gradient = world.terrain.gradient(this.x, this.y);
    const slopeForward = gradient.x * this.forwardX + gradient.y * this.forwardY;
    const slopeLateral = gradient.x * this.rightX + gradient.y * this.rightY;
    acceleration -= slopeForward * 20.5;

    if (Math.abs(long) < 0.15 && brake > 0.1) acceleration = 0;
    long += acceleration * dt;
    if (Math.abs(long) < 0.03 && Math.abs(throttle) < 0.01) long = 0;

    const lateralGrip = this.onRoad ? 4.25 : 1.75;
    lateral *= Math.exp(-lateralGrip * dt);
    lateral -= slopeLateral * 18.5 * dt;
    lateral += -steer * Math.min(Math.abs(long), 15) * 0.035 * dt;

    const turnAuthority = steer * (0.13 + Math.min(Math.abs(long), 16) * 0.027);
    const targetAngularVelocity = turnAuthority * directionSign * (0.55 + this.strapTension * 0.08);
    this.angularVelocity = damp(this.angularVelocity, targetAngularVelocity, 5.8, dt);
    if (brake > 0.15) this.angularVelocity *= Math.exp(-1.8 * dt);
    this.heading = normalizeAngle(this.heading + this.angularVelocity * dt);
    this.updateVectors();

    const velocityX = this.forwardX * long + this.rightX * lateral;
    const velocityY = this.forwardY * long + this.rightY * lateral;
    this.vx = velocityX;
    this.vy = velocityY;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = clamp(this.x, 24, world.width - 24);
    this.y = clamp(this.y, 24, world.height - 24);

    this.longitudinalSpeed = long;
    this.lateralSpeed = lateral;
    this.acceleration = clamp((long - this.lastLongSpeed) / Math.max(dt, 0.0001), -32, 32);
    this.lastLongSpeed = long;
    this.steerVisual = damp(this.steerVisual, steer, 9, dt);
    this.throttleVisual = damp(this.throttleVisual, throttle, 7, dt);

    this.updateCargo(dt, brake, long, lateral, acceleration, slopeLateral, world);
    this.updateRisk(dt, throttle, steer, brake, slopeLateral, world);
    this.updateStraps(dt, controls, world);
    this.shake = damp(this.shake, (1 - this.onRoad) * Math.min(Math.abs(long) / 9, 1), 3.2, dt);
    this.lastBrake = brake;
  }
}
