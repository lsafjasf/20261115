import { contourDifference, currentProfile } from "./profiles.js";

export const TUNING = {
  ambientTemperature: 880,
  coldFloor: 250,
  plasticFloor: 500,
  plasticCeiling: 880,
  heaterCenter: 0.54,
  heaterRadius: 0.24,
  pressureSafe: 0.78,
  wallTolerance: 0.55,
  contourTarget: 0.9,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class GlassSimulation {
  constructor() {
    this.reset();
  }

  reset() {
    this.phase = "ready";
    this.elapsed = 0;
    this.temperature = TUNING.ambientTemperature;
    this.fill = 0.18;
    this.pressure = 0.08;
    this.rpm = 0;
    this.heaterPosition = 0.18;
    this.imbalance = 0.03;
    this.tilt = 0;
    this.stress = 0;
    this.bubbleRisk = 0;
    this.bubbles = [];
    this.coldTime = 0;
    this.finishAttempt = null;
    this.finalStats = null;
  }

  start() {
    if (this.phase === "ready") this.phase = "playing";
  }

  setHeaterPosition(position) {
    this.heaterPosition = clamp(position, 0, 1);
  }

  get isHeating() {
    return this.heaterAlignment > 0.08;
  }

  get heaterAlignment() {
    return clamp(
      1 - Math.abs(this.heaterPosition - TUNING.heaterCenter) / TUNING.heaterRadius,
      0,
      1,
    );
  }

  get workability() {
    return clamp(
      (this.temperature - TUNING.plasticFloor) /
        (TUNING.plasticCeiling - TUNING.plasticFloor),
      0,
      1,
    );
  }

  get rotationQuality() {
    if (this.rpm >= 30 && this.rpm <= 46) return 1;
    if (this.rpm < 30) return clamp(this.rpm / 30, 0.08, 1);
    return clamp(1 - (this.rpm - 46) / 38, 0.05, 1);
  }

  get wallDelta() {
    return clamp(
      0.14 +
        this.imbalance * 0.75 +
        this.bubbles.length * 0.055 +
        this.stress * 0.36 +
        Math.abs(this.tilt) * 0.3,
      0.1,
      1.75,
    );
  }

  get contourScore() {
    const f = clamp((this.fill - 0.14) / 0.86, 0, 1.14);
    const rms = contourDifference(this.fill, this.bubbles);
    const error = clamp(
      rms / 0.42 +
        Math.max(0, 0.96 - f) * 0.44 +
        Math.abs(this.tilt) * 0.78 +
        this.bubbles.length * 0.025,
      0,
      1,
    );
    return 1 - error;
  }

  get profile() {
    return currentProfile(this.fill, this.bubbles);
  }

  get displayWallThickness() {
    return 2.2 + Math.sin(this.elapsed * 2.4) * 0.02;
  }

  update(dt, input = {}) {
    if (this.phase !== "playing") return;
    const step = clamp(dt, 0, 0.08);
    if (step <= 0) return;

    this.elapsed += step;
    this.updateTemperature(step);
    this.updatePressure(step, input.blow === true);
    this.updateRotation(step, input);
    this.updateGlass(step, input.blow === true);
    this.updateFailure(step);
  }

  updateTemperature(dt) {
    const alignment = this.heaterAlignment;
    if (alignment > 0.02) {
      const target = 930 + alignment * 130;
      const exchange = 0.18 + alignment * 0.3;
      this.temperature += (target - this.temperature) * exchange * dt;
      this.temperature = Math.min(this.temperature, 1070);
    } else {
      this.temperature -= (10 + this.temperature * 0.015) * dt;
    }
    this.temperature = Math.max(TUNING.coldFloor, this.temperature);
  }

  updatePressure(dt, blowing) {
    if (blowing) {
      this.pressure += 0.72 * dt;
      if (this.pressure > 0.84 && this.workability > 0.32) {
        this.bubbleRisk +=
          dt * (this.pressure - 0.84) * 4.4 * (0.5 + this.fill);
      }
    } else {
      this.pressure -= 0.95 * dt;
    }
    this.pressure = clamp(this.pressure, 0, 1.22);

    if (this.bubbleRisk >= 0.62 && this.bubbles.length < 6) {
      const seed = this.bubbles.length * 7 + Math.floor(this.elapsed * 9);
      this.bubbles.push({
        id: this.bubbles.length,
        x: ((seed * 37) % 61) / 61 - 0.5,
        y: 0.2 + (((seed * 19) % 67) / 67) * 0.62,
        size: 0.035 + (((seed * 13) % 29) / 29) * 0.04,
      });
      this.bubbleRisk = 0.18;
      this.imbalance += 0.035;
    }
    this.bubbleRisk = Math.max(0, this.bubbleRisk - dt * 0.13);
  }

  updateRotation(dt, input) {
    if (input.spin) this.rpm += 48 * dt;
    if (input.brake) this.rpm -= 38 * dt;
    if (!input.spin && !input.brake) this.rpm -= 7.2 * dt;
    this.rpm = clamp(this.rpm, 0, 86);

    const quality = this.rotationQuality;
    if (quality > 0.82) {
      this.imbalance -= dt * 0.012;
      this.tilt *= 1 - dt * 0.01;
    } else {
      this.imbalance += dt * (1 - quality) * (0.018 + this.fill * 0.012);
      this.tilt += dt * (1 - quality) * 0.005;
    }
    this.imbalance = clamp(this.imbalance, 0, 0.9);
    this.tilt = clamp(this.tilt, 0, 0.13);
  }

  updateGlass(dt, blowing) {
    const workability = this.workability;
    const quality = this.rotationQuality;

    if (blowing && this.pressure > 0.16 && workability > 0.03) {
      const rate = (this.pressure - 0.1) * workability * (0.62 + quality * 0.38);
      this.fill += dt * rate * 0.28;
      this.stress += dt * this.pressure * (1 - workability) * 0.07;
    }

    if (this.rpm < 22 && this.fill > 0.3) {
      const sag = ((22 - this.rpm) / 22) * (0.25 + this.fill) * dt * 0.012;
      this.tilt += sag;
      this.imbalance += sag * 0.45;
    }

    if (blowing && this.pressure > 0.91) {
      this.stress += dt * (this.pressure - 0.91) * 0.12;
    }

    this.fill = clamp(this.fill, 0.08, 1.12);
    this.imbalance = clamp(this.imbalance, 0, 0.9);
    this.tilt = clamp(this.tilt, 0, 0.13);
    this.stress = clamp(this.stress, 0, 2.2);
  }

  updateFailure(dt) {
    if (this.temperature < TUNING.plasticFloor) {
      this.coldTime += dt;
    } else {
      this.coldTime = Math.max(0, this.coldTime - dt * 1.8);
    }
    if (this.coldTime >= 1.25) {
      this.phase = "failed";
      this.finalStats = this.getStats();
    }
  }

  getChecks() {
    return {
      contour: this.contourScore >= TUNING.contourTarget,
      wall: this.wallDelta <= TUNING.wallTolerance,
      warmth: this.temperature >= 540,
      clean: this.bubbles.length === 0,
    };
  }

  getStats() {
    return {
      elapsed: this.elapsed,
      temperature: this.temperature,
      contour: this.contourScore,
      wallDelta: this.wallDelta,
      wallMin: this.displayWallThickness - this.wallDelta / 2,
      wallMax: this.displayWallThickness + this.wallDelta / 2,
      rpm: this.rpm,
      bubbles: this.bubbles.length,
      tilt: this.tilt,
      fill: this.fill,
    };
  }

  tryFinish() {
    if (this.phase !== "playing") {
      return { ok: false, checks: this.getChecks() };
    }
    const checks = this.getChecks();
    const ok = Object.values(checks).every(Boolean);
    this.finishAttempt = checks;
    if (ok) {
      this.phase = "success";
      this.finalStats = this.getStats();
    }
    return { ok, checks };
  }
}
