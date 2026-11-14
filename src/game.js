import {
  BRIDGES,
  CAMP,
  DRILL,
  SITES,
  STRATA,
  WORLD,
} from "./config.js";
import { crackCrossing } from "./pathfinding.js";

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function approach(current, target, amount) {
  if (current < target) return Math.min(current + amount, target);
  return Math.max(current - amount, target);
}

export class IceCoreGame {
  constructor(navigation) {
    this.navigation = navigation;
    this.events = [];
    this.reset();
  }

  reset() {
    this.mode = "title";
    this.elapsed = 0;
    this.activeSiteIndex = 0;
    this.sites = SITES.map((site) => ({
      ...site,
      done: false,
      progress: 0,
      heat: 22,
      entries: 0,
    }));
    this.vehicle = {
      x: CAMP.x,
      y: CAMP.y,
      angle: -Math.PI / 2,
      speed: 0,
      hull: 100,
      maxHull: 100,
      load: 0,
      cores: [],
      trackPhase: 0,
    };
    this.drilling = {
      rpm: 24,
      pressure: 12,
      torque: 24,
      heat: 22,
      jam: false,
      jamTime: 0,
      jamClock: 0,
      overheatTimer: 0,
      overheated: false,
      completeTimer: 0,
      warnedOverheat: false,
      warnedTorque: false,
      rpmHold: false,
      pressureHold: false,
    };
    this.camera = {
      x: CAMP.x,
      y: CAMP.y,
      zoom: 0.74,
      shake: 0,
    };
    this.route = null;
    this.routeTimer = 0;
    this.crackCooldown = 0;
    this.canDrill = false;
    this.canReturn = false;
    this.jamCount = 0;
    this.overheatCount = 0;
    this.crackCrossings = 0;
    this.safeBridgeCrossings = 0;
    this.damageTaken = 0;
    this.completed = false;
    this.result = null;
    this.particles = [];
    this.tracks = [];
    this.particleClock = 0;
    this.trackClock = 0;
    this.tipClock = 0;
    this.lowRpmWarned = false;
    this.sampledAt = [];
    this.events = [];
  }

  start() {
    if (this.mode !== "title") return false;
    this.mode = "driving";
    this.recalculateRoute(true);
    this.emit("mission-start");
    return true;
  }

  emit(type, detail = {}) {
    this.events.push({ type, time: this.elapsed, ...detail });
  }

  consumeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  get currentSite() {
    return this.sites[this.activeSiteIndex] || null;
  }

  get objective() {
    if (this.activeSiteIndex >= this.sites.length) {
      return { type: "camp", ...CAMP };
    }
    return {
      type: "site",
      ...this.sites[this.activeSiteIndex],
    };
  }

  get objectiveLabel() {
    if (this.activeSiteIndex >= this.sites.length) return "返回岸基营地";
    const site = this.currentSite;
    return `前往 ${site.id} ${site.name}`;
  }

  get summary() {
    return {
      mode: this.mode,
      elapsed: this.elapsed,
      activeSiteIndex: this.activeSiteIndex,
      hull: this.vehicle.hull,
      load: this.vehicle.load,
      speed: this.vehicle.speed,
      cores: this.vehicle.cores.map((core) => ({ ...core })),
      sites: this.sites.map((site) => ({
        id: site.id,
        name: site.name,
        done: site.done,
        progress: site.progress,
      })),
      drilling: {
        rpm: this.drilling.rpm,
        pressure: this.drilling.pressure,
        torque: this.drilling.torque,
        heat: this.drilling.heat,
        jam: this.drilling.jam,
        jamTime: this.drilling.jamTime,
        overheated: this.drilling.overheated,
        completeTimer: this.drilling.completeTimer,
      },
      canDrill: this.canDrill,
      canReturn: this.canReturn,
      jamCount: this.jamCount,
      overheatCount: this.overheatCount,
      crackCrossings: this.crackCrossings,
      safeBridgeCrossings: this.safeBridgeCrossings,
      damageTaken: this.damageTaken,
      route: this.route
        ? {
            found: this.route.found,
            bridges: this.route.bridges,
            violations: this.route.violations.length,
            length: this.route.length,
          }
        : null,
      vehicle: {
        x: this.vehicle.x,
        y: this.vehicle.y,
        angle: this.vehicle.angle,
      },
      camera: { ...this.camera },
      result: this.result ? { ...this.result } : null,
    };
  }

  startDrilling() {
    if (this.mode !== "driving" || !this.canDrill || !this.currentSite) {
      return false;
    }
    const site = this.currentSite;
    this.mode = "drilling";
    site.entries += 1;
    this.vehicle.speed = 0;
    this.drilling.rpm = 20;
    this.drilling.pressure = 9;
    this.drilling.torque = 18;
    this.drilling.heat = site.heat;
    this.drilling.jam = false;
    this.drilling.jamClock = 0;
    this.drilling.jamTime = 0;
    this.drilling.completeTimer = 0;
    this.drilling.overheatTimer = 0;
    this.drilling.overheated = false;
    this.drilling.warnedOverheat = false;
    this.drilling.warnedTorque = false;
    this.lowRpmWarned = false;
    this.emit("drill-start", { siteId: site.id });
    this.recalculateRoute(true);
    return true;
  }

  stopDrilling() {
    if (this.mode !== "drilling" || this.drilling.completeTimer > 0) {
      return false;
    }
    const site = this.currentSite;
    if (site) {
      site.progress = clamp(site.progress, 0, 99.4);
      site.heat = this.drilling.heat;
    }
    this.mode = "driving";
    this.drilling.rpmHold = false;
    this.drilling.pressureHold = false;
    this.drilling.jam = false;
    this.emit("drill-stop");
    this.recalculateRoute(true);
    return true;
  }

  interact() {
    if (this.mode === "drilling") return this.stopDrilling();
    if (this.mode !== "driving") return false;
    if (this.canReturn) {
      this.finishMission(true);
      return true;
    }
    if (this.canDrill) return this.startDrilling();
    return false;
  }

  update(rawDt, input) {
    const dt = Math.min(0.045, Math.max(0, rawDt));
    if (this.mode === "title") {
      this.updateCamera(dt);
      return;
    }
    if (this.mode === "complete") {
      this.updateCamera(dt);
      this.updateParticles(dt);
      return;
    }

    this.elapsed += dt;
    this.crackCooldown = Math.max(0, this.crackCooldown - dt);
    this.updateAmbient(dt);
    if (this.mode === "driving") {
      this.updateDriving(dt, input);
    } else if (this.mode === "drilling") {
      this.updateDrilling(dt, input);
    }
    this.updateParticles(dt);
    this.updateCamera(dt);

    this.routeTimer -= dt;
    if (this.routeTimer <= 0) this.recalculateRoute();
  }

  updateAmbient(dt) {
    if (this.mode !== "drilling") {
      for (const site of this.sites) {
        if (!site.done) site.heat = approach(site.heat, 22, dt * 1.8);
      }
    }
    this.trackClock -= dt;
    this.particleClock -= dt;
    this.tipClock -= dt;
  }

  updateDriving(dt, input) {
    const vehicle = this.vehicle;
    const massFactor = 1 + vehicle.load * 0.24;
    const maxForward = 94 / massFactor;
    const maxReverse = 46 / massFactor;
    let targetSpeed = 0;
    if (input.forward && !input.reverse) targetSpeed = maxForward;
    if (input.reverse && !input.forward) targetSpeed = -maxReverse;

    const acceleration = targetSpeed === 0 ? 32 : 46 / massFactor;
    const brakeRate = targetSpeed === 0 ? 58 : 54;
    vehicle.speed = approach(
      vehicle.speed,
      targetSpeed,
      (targetSpeed === 0 ? brakeRate : acceleration) * dt,
    );

    if (Math.abs(vehicle.speed) > 2) {
      const steerStrength = 1.15 / massFactor;
      const direction = vehicle.speed >= 0 ? 1 : -1;
      if (input.left && !input.right) {
        vehicle.angle -= steerStrength * dt * direction;
      }
      if (input.right && !input.left) {
        vehicle.angle += steerStrength * dt * direction;
      }
    }

    const before = { x: vehicle.x, y: vehicle.y };
    vehicle.x += Math.cos(vehicle.angle) * vehicle.speed * dt;
    vehicle.y += Math.sin(vehicle.angle) * vehicle.speed * dt;
    vehicle.x = clamp(vehicle.x, 38, WORLD.width - 38);
    vehicle.y = clamp(vehicle.y, 38, WORLD.height - 54);
    vehicle.trackPhase += Math.abs(vehicle.speed) * dt * 0.09;

    if (Math.abs(vehicle.speed) > 15 && this.trackClock <= 0) {
      this.tractMarks(before, vehicle);
      this.trackClock = 0.07;
    }

    const crossing = crackCrossing(before, vehicle);
    if (crossing) this.handleCrackCrossing(crossing);

    const site = this.currentSite;
    this.canDrill = false;
    if (site) {
      const distance = Math.hypot(vehicle.x - site.x, vehicle.y - site.y);
      if (distance < site.radius + 18 && Math.abs(vehicle.speed) < 7) {
        this.canDrill = true;
      }
    }

    if (this.activeSiteIndex >= this.sites.length) {
      const distance = Math.hypot(vehicle.x - CAMP.x, vehicle.y - CAMP.y);
      this.canReturn = distance < CAMP.radius + 18 && Math.abs(vehicle.speed) < 9;
      if (distance < CAMP.radius - 8 && Math.abs(vehicle.speed) < 6) {
        this.finishMission(true);
      }
    } else {
      this.canReturn = false;
    }
  }

  tractMarks(before, vehicle) {
    if (this.tracks.length > 220) this.tracks.shift();
    const perpendicular = vehicle.angle + Math.PI / 2;
    const offset = 24;
    for (const side of [-1, 1]) {
      this.tracks.push({
        x: before.x + Math.cos(perpendicular) * offset * side,
        y: before.y + Math.sin(perpendicular) * offset * side,
        angle: vehicle.angle,
        strength: clamp(Math.abs(vehicle.speed) / 100, 0.25, 1),
      });
    }
  }

  handleCrackCrossing(crossing) {
    if (this.crackCooldown > 0) return;
    this.crackCooldown = 0.9;
    if (crossing.bridge) {
      this.safeBridgeCrossings += 1;
      this.camera.shake = Math.max(this.camera.shake, 1.8);
      this.emit("bridge", { label: crossing.bridge.label });
      return;
    }
    const speedFactor = clamp(Math.abs(this.vehicle.speed) / 80, 0.25, 1.35);
    const damage = 7 + this.vehicle.load * 11 + speedFactor * 9;
    this.vehicle.hull = clamp(this.vehicle.hull - damage, 0, this.vehicle.maxHull);
    this.damageTaken += damage;
    this.crackCrossings += 1;
    this.addCrackDebris(crossing.point, this.vehicle.load);
    this.vehicle.speed *= 0.62;
    this.camera.shake = Math.max(this.camera.shake, 8 + this.vehicle.load * 3);
    this.emit("crack", {
      crackId: crossing.crackId,
      load: this.vehicle.load,
      damage: Math.round(damage),
      point: crossing.point,
    });
    if (this.vehicle.hull <= 0) {
      this.finishMission(false, "hull-failure");
    }
  }

  updateDrilling(dt, input) {
    const site = this.currentSite;
    if (!site) return;
    const drill = this.drilling;
    drill.rpmHold = Boolean(input.rpm);
    drill.pressureHold = Boolean(input.pressure);

    if (drill.completeTimer > 0) {
      drill.completeTimer += dt;
      drill.rpm = approach(drill.rpm, 0, dt * 50);
      drill.pressure = approach(drill.pressure, 0, dt * 34);
      this.spawnDrillChips(dt, site, 0.3);
      if (drill.completeTimer >= 1.15) this.completeCore();
      return;
    }

    if (drill.overheated) {
      drill.overheatTimer += dt;
      drill.rpm = approach(drill.rpm, 0, dt * 55);
      drill.torque = approach(drill.torque, 0, dt * 60);
      if (drill.overheatTimer >= 1.4) {
        site.heat = 58;
        drill.heat = 58;
        drill.overheated = false;
        this.emit("overheat-stop", { siteId: site.id });
        this.stopDrilling();
      }
      return;
    }

    if (drill.jam) {
      drill.jamTime += dt;
      drill.rpm = approach(drill.rpm, 8, dt * 36);
      drill.torque = approach(
        drill.torque,
        drill.pressure * 0.7 + 16,
        dt * 34,
      );
      if (
        drill.jamTime > 2.4 &&
        !input.rpm &&
        !input.pressure
      ) {
        drill.jam = false;
        drill.jamTime = 0;
        drill.jamClock = 0;
        drill.rpm = 10;
        drill.torque = 20;
        drill.warnedTorque = false;
        this.emit("jam-cleared", { siteId: site.id });
      }
      return;
    }

    const rpmTarget = input.rpm ? DRILL.maxRpm : 11;
    const pressureTarget = input.pressure ? DRILL.maxPressure : 8;
    drill.rpm = approach(drill.rpm, rpmTarget, (input.rpm ? 72 : 37) * dt);
    drill.pressure = approach(
      drill.pressure,
      pressureTarget,
      (input.pressure ? 63 : 31) * dt,
    );

    const highRpm = Math.max(0, drill.rpm - 72);
    const highPressure = Math.max(0, drill.pressure - 60);
    drill.torque = approach(
      drill.torque,
      drill.pressure * 0.78 +
        drill.rpm * 0.34 +
        highRpm * 2.3 +
        highPressure * 0.7,
      dt * 48,
    );

    const cutting =
      drill.rpm > 11 &&
      drill.pressure > 8 &&
      drill.torque < DRILL.torqueJam;
    if (cutting) {
      const effective = (drill.rpm * drill.pressure) / 10000;
      const rate = (0.04 + effective * 34) / site.hardness;
      site.progress = clamp(site.progress + rate * dt, 0, 100);
      this.spawnDrillChips(dt, site, rate);
    }

    const heatGain =
      (drill.pressure / 100) * 7 +
      (drill.rpm < 34 ? 3.4 : 0.55) -
      (drill.rpm > 42 ? 1.1 : 0);
    drill.heat = clamp(drill.heat + heatGain * dt, 12, 110);

    if (drill.torque >= 82 && !drill.warnedTorque) {
      drill.warnedTorque = true;
      this.emit("torque-warning", { torque: drill.torque });
    }
    if (drill.torque < 68) drill.warnedTorque = false;
    if (drill.heat >= 75 && !drill.warnedOverheat) {
      drill.warnedOverheat = true;
      this.emit("heat-warning", { heat: drill.heat });
    }
    if (
      drill.rpm < 28 &&
      drill.pressure > 26 &&
      site.progress < 98 &&
      this.tipClock <= 0
    ) {
      this.tipClock = 7;
      this.emit("low-rpm-warning", { siteId: site.id });
    }

    if (
      drill.rpm >= DRILL.jamRpm &&
      drill.torque >= DRILL.torqueJam
    ) {
      drill.jamClock += dt;
      if (drill.jamClock > 0.36) this.triggerJam(site);
    } else {
      drill.jamClock = Math.max(0, drill.jamClock - dt * 2.4);
    }

    if (drill.heat >= DRILL.maxHeat) {
      drill.heat = 100;
      drill.overheated = true;
      drill.overheatTimer = 0;
      drill.rpmHold = false;
      drill.pressureHold = false;
      this.overheatCount += 1;
      this.emit("overheat", { siteId: site.id });
    }

    if (site.progress >= 100) {
      drill.completeTimer = 0.001;
      site.progress = 100;
      this.emit("core-ready", { siteId: site.id });
    }
  }

  triggerJam(site) {
    const drill = this.drilling;
    drill.jam = true;
    drill.jamTime = 0;
    drill.jamClock = 0;
    drill.warnedTorque = false;
    site.heat = drill.heat;
    this.jamCount += 1;
    this.camera.shake = Math.max(this.camera.shake, 6);
    this.emit("jam", {
      siteId: site.id,
      rpm: drill.rpm,
      pressure: drill.pressure,
      torque: drill.torque,
    });
  }

  completeCore() {
    const site = this.currentSite;
    if (!site || site.done) return;
    site.done = true;
    site.progress = 100;
    site.heat = this.drilling.heat;
    const core = {
      siteId: site.id,
      name: site.name,
      strata: site.core,
      sample: STRATA[site.core].sample,
      sampledAt: this.elapsed,
    };
    this.vehicle.cores.push(core);
    this.vehicle.load = this.vehicle.cores.length;
    this.sampledAt.push({ ...core });
    this.activeSiteIndex += 1;
    this.mode = "driving";
    this.vehicle.speed = 0;
    this.drilling.rpm = 0;
    this.drilling.pressure = 0;
    this.drilling.torque = 0;
    this.drilling.completeTimer = 0;
    this.camera.shake = Math.max(this.camera.shake, 4);
    this.emit("sample-complete", {
      siteId: site.id,
      load: this.vehicle.load,
      core,
    });
    this.recalculateRoute(true);
  }

  finishMission(success, reason = "returned") {
    if (this.mode === "complete") return;
    this.mode = "complete";
    this.completed = success;
    this.result = {
      success,
      reason,
      elapsed: this.elapsed,
      cores: this.vehicle.cores.length,
      hull: Math.round(this.vehicle.hull),
      jamCount: this.jamCount,
      overheatCount: this.overheatCount,
      crackCrossings: this.crackCrossings,
      safeBridgeCrossings: this.safeBridgeCrossings,
      damageTaken: Math.round(this.damageTaken),
    };
    this.emit(success ? "mission-complete" : "mission-failed", this.result);
  }

  spawnDrillChips(dt, site, rate) {
    this.particleClock -= dt;
    if (this.particleClock > 0 || this.drilling.rpm < 14) return;
    this.particleClock = clamp(0.16 - rate * 0.008, 0.05, 0.15);
    const count = rate > 4 ? 4 : 2;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * TAU;
      const speed = 24 + Math.random() * 56;
      this.particles.push({
        x: site.x + (Math.random() - 0.5) * 12,
        y: site.y + 18 + (Math.random() - 0.5) * 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 18,
        life: 0.35 + Math.random() * 0.45,
        maxLife: 0.8,
        size: 1 + Math.random() * 2.2,
        color: Math.random() > 0.35 ? "#d9fffb" : "#8fdbe0",
      });
    }
    if (this.particles.length > 360) {
      this.particles.splice(0, this.particles.length - 360);
    }
  }

  addCrackDebris(point, load) {
    for (let index = 0; index < 14 + load * 6; index += 1) {
      const angle = Math.random() * TAU;
      const speed = 20 + Math.random() * 75;
      this.particles.push({
        x: point.x,
        y: point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.5 + Math.random() * 0.8,
        maxLife: 1.3,
        size: 1 + Math.random() * 3,
        color: Math.random() > 0.7 ? "#e2fdf8" : "#3b8792",
      });
    }
  }

  updateParticles(dt) {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= dt;
      if (particle.life <= 0) {
        this.particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 54 * dt;
      particle.vx *= 1 - dt * 1.8;
    }
  }

  updateCamera(dt) {
    const camera = this.camera;
    let targetX = this.vehicle.x;
    let targetY = this.vehicle.y;
    let targetZoom = 0.78;
    if (this.mode === "title") {
      targetX = 1010;
      targetY = 640;
      targetZoom = 0.61;
    } else if (this.mode === "drilling" && this.currentSite) {
      targetX = this.currentSite.x;
      targetY = this.currentSite.y + 14;
      targetZoom = 1.26;
    } else if (this.mode === "complete") {
      targetZoom = this.result?.success ? 0.84 : 0.9;
    }
    const positionEase = 1 - Math.exp(-dt * 3.6);
    const zoomEase = 1 - Math.exp(-dt * 2.8);
    camera.x += (targetX - camera.x) * positionEase;
    camera.y += (targetY - camera.y) * positionEase;
    camera.zoom += (targetZoom - camera.zoom) * zoomEase;
    if (this.viewport && camera.zoom > 0) {
      const halfHeight = this.viewport.height / (2 * camera.zoom);
      const halfWidth = this.viewport.width / (2 * camera.zoom);
      if (WORLD.height > halfHeight * 2) {
        camera.y = clamp(camera.y, halfHeight, WORLD.height - halfHeight);
      }
      if (WORLD.width > halfWidth * 2) {
        camera.x = clamp(camera.x, halfWidth, WORLD.width - halfWidth);
      }
    }
    camera.shake = Math.max(0, camera.shake - dt * 16);
  }

  recalculateRoute(force = false) {
    if (this.mode === "title") return;
    if (!force && this.routeTimer > 0) return;
    const objective = this.objective;
    const target = {
      x: objective.type === "camp" ? CAMP.x : objective.x,
      y: objective.type === "camp" ? CAMP.y : objective.y,
    };
    this.route = this.navigation.findPath(
      { x: this.vehicle.x, y: this.vehicle.y },
      target,
    );
    this.routeTimer = 0.55;
  }

  debugTeleportToSite(index = 0) {
    if (index < 0 || index >= SITES.length) return false;
    const site = this.sites[index];
    this.mode = "driving";
    this.activeSiteIndex = index;
    this.vehicle.x = site.x;
    this.vehicle.y = site.y + site.radius + 3;
    this.vehicle.angle = -Math.PI / 2;
    this.vehicle.speed = 0;
    this.canDrill = false;
    this.canReturn = false;
    this.recalculateRoute(true);
    return true;
  }

  debugTeleportToCamp() {
    this.mode = "driving";
    this.vehicle.x = CAMP.x;
    this.vehicle.y = CAMP.y;
    this.vehicle.angle = -Math.PI / 2;
    this.vehicle.speed = 0;
    this.recalculateRoute(true);
    return true;
  }

  debugRestart() {
    this.reset();
    this.start();
    return true;
  }

  debugRoutes() {
    return {
      campToSites: this.navigation.campRoutes.map((route, index) => ({
        site: SITES[index].id,
        found: route.found,
        length: route.length,
        bridges: route.bridges,
        violations: route.violations.length,
        points: route.points,
      })),
    };
  }

  getSnapshot() {
    return this.summary;
  }
}

export function audioCueForEvent(event) {
  switch (event.type) {
    case "crack":
      return { sound: "ice-crack", intensity: 0.65 + event.load * 0.16 };
    case "bridge":
      return { sound: "bridge", intensity: 0.35 };
    case "jam":
      return { sound: "jam", intensity: 1 };
    case "core-ready":
    case "sample-complete":
      return { sound: "core", intensity: 1 };
    case "mission-complete":
      return { sound: "success", intensity: 1 };
    case "mission-failed":
      return { sound: "failure", intensity: 1 };
    case "overheat":
      return { sound: "overheat", intensity: 1 };
    default:
      return null;
  }
}
