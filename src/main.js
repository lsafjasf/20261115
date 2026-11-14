import { SnowAudio } from "./audio.js";
import { clamp, damp, normalizeAngle, range } from "./rng.js";
import { SnowSled } from "./vehicle.js";
import { SnowWorld } from "./world.js";

const FIXED_STEP = 1 / 60;
const STATION_NAMES = ["KHAN", "RIDGE", "NORTH"];

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

class WhiteoutRun {
  constructor() {
    this.canvas = document.querySelector("#game");
    this.ctx = this.canvas.getContext("2d");
    this.world = new SnowWorld();
    this.sled = new SnowSled(this.world);
    this.audio = new SnowAudio();
    this.ui = this.collectUi();
    document.body.classList.add("prestart");
    this.keys = Object.create(null);
    this.touch = { throttle: false, reverse: false, left: false, right: false, brake: false, straps: false };
    this.camera = { x: this.sled.x, y: this.sled.y, zoom: 0.95, width: 1, height: 1 };
    this.weather = { time: 0, wind: 0.62, gust: 0.6, visibility: 0.74, angle: 0.45 };
    this.snow = [];
    this.tracks = [];
    this.started = false;
    this.running = false;
    this.paused = false;
    this.debugMode = false;
    this.completed = false;
    this.failed = false;
    this.elapsed = 0;
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.uiClock = 0;
    this.promptVisible = false;
    this.toastTimeout = null;
    this.completeTimer = 0;
    this.trackTimer = 0;
    this.nextStationIndex = 0;
    this.cargoCount = 3;
    this.tightenPresses = 0;
    this.loosenPresses = 0;
    this.weatherBurst = 0;
    this.dpr = 1;
    this.resize();
    this.bindEvents();
    this.makeSnow();
    this.updateRouteUi();
    this.updateUi(true);
    this.render(performance.now() / 1000);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  collectUi() {
    const query = (selector) => document.querySelector(selector);
    return {
      startScreen: query("#start-screen"),
      resultScreen: query("#result-screen"),
      startButton: query("#start-button"),
      restartButton: query("#restart-button"),
      speed: query("#speed"),
      gear: query("#gear"),
      slipBar: query("#slip-bar"),
      slipValue: query("#slip-value"),
      cargoBar: query("#cargo-bar"),
      cargoValue: query("#cargo-value"),
      strapBar: query("#strap-bar"),
      strapValue: query("#strap-value"),
      riskBar: query("#risk-bar"),
      riskValue: query("#risk-value"),
      cargoStrip: [...document.querySelectorAll("#cargo-strip i")],
      routeCount: query("#route-count"),
      routeNodes: [...document.querySelectorAll(".route-node")],
      routeSegments: [...document.querySelectorAll(".route-segment")],
      clock: query("#clock"),
      visibility: query("#visibility"),
      weatherLabel: query("#weather-label"),
      windArrow: query("#wind-arrow"),
      prompt: query("#prompt"),
      promptTitle: query("#prompt-title"),
      promptSub: query("#prompt-sub"),
      toast: query("#toast"),
      audioDot: query("#audio-dot"),
      audioLabel: query("#audio-label"),
      touchControls: query("#touch-controls"),
      resultKicker: query("#result-kicker"),
      resultTitle: query("#result-title"),
      resultCopy: query("#result-copy"),
      statTime: query("#stat-time"),
      statCargo: query("#stat-cargo"),
      statRisk: query("#stat-risk"),
      statStraps: query("#stat-straps"),
    };
  }

  bindEvents() {
    this.ui.startButton.addEventListener("click", () => this.start());
    this.ui.restartButton.addEventListener("click", () => this.restart());
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => this.onKeyDown(event));
    window.addEventListener("keyup", (event) => this.onKeyUp(event));
    this.canvas.addEventListener("pointerdown", () => this.audio.start());
    this.bindTouchControls();
  }

  bindTouchControls() {
    const buttons = [...document.querySelectorAll("[data-control]")];
    const aliases = {
      left: "left",
      right: "right",
      throttle: "throttle",
      brake: "brake",
      straps: "straps",
    };
    buttons.forEach((button) => {
      const activate = (active) => (event) => {
        event.preventDefault();
        this.touch[aliases[button.dataset.control]] = active;
        button.classList.toggle("active", active);
        if (active) this.audio.start();
      };
      button.addEventListener("pointerdown", activate(true));
      button.addEventListener("pointerup", activate(false));
      button.addEventListener("pointercancel", activate(false));
      button.addEventListener("pointerleave", activate(false));
    });
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.camera.width = window.innerWidth;
    this.camera.height = window.innerHeight;
    this.canvas.width = Math.round(this.camera.width * this.dpr);
    this.canvas.height = Math.round(this.camera.height * this.dpr);
    const baseZoom = this.camera.width < 900 ? 0.78 : this.camera.width < 1400 ? 0.88 : 0.96;
    this.camera.zoom = baseZoom * Math.min(1.1, Math.max(0.92, this.camera.height / 850));
    this.makeSnow();
  }

  onKeyDown(event) {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
    }
    if (event.repeat) {
      if (event.code === "KeyR") return;
      if (event.code === "KeyT") return;
    }
    this.keys[event.code] = true;

    if (event.code === "Enter" && !this.started) {
      this.start();
      return;
    }
    if (!this.started) return;
    this.audio.start();

    if (event.code === "KeyE" && !event.repeat) this.tryDeliver();
    if (event.code === "KeyM" && !event.repeat) this.toggleMute();
    if (event.code === "KeyP" && !event.repeat && !this.completed && !this.failed) {
      this.paused = !this.paused;
      this.showToast(this.paused ? "驾驶暂停" : "继续运输");
    }
    if (event.code === "KeyR" && !event.repeat) this.tightenPresses += 1;
    if (event.code === "KeyT" && !event.repeat) this.loosenPresses += 1;
    if (event.code === "Space" && !event.repeat) this.audio.brakeSqueal();
  }

  onKeyUp(event) {
    this.keys[event.code] = false;
  }

  getControls() {
    const left = this.keys.KeyA || this.keys.ArrowLeft || this.touch.left;
    const right = this.keys.KeyD || this.keys.ArrowRight || this.touch.right;
    const forward = this.keys.KeyW || this.keys.ArrowUp || this.touch.throttle;
    const reverse = this.keys.KeyS || this.keys.ArrowDown || this.touch.reverse;
    const tighten = this.keys.KeyR || this.touch.straps;
    return {
      throttle: forward ? 1 : 0,
      reverse: reverse ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      brake: this.keys.Space || this.touch.brake ? 1 : 0,
      strapTighten: Boolean(tighten),
      strapLoosen: Boolean(this.keys.KeyT),
    };
  }

  async start() {
    if (this.started) return;
    await this.audio.start();
    this.started = true;
    this.running = true;
    this.ui.startScreen.classList.add("hidden");
    document.body.classList.remove("prestart");
    this.ui.touchControls.classList.remove("hidden");
    this.ui.audioDot.classList.add("on");
    this.ui.audioLabel.textContent = "合成音频在线";
    this.camera.x = this.sled.x;
    this.camera.y = this.sled.y;
    this.showToast("补给线已激活 · 前往 OBS-01 KHAN");
  }

  restart() {
    this.sled.reset(this.world);
    this.world.route.stations.forEach((station) => { station.delivered = false; });
    this.started = true;
    this.running = true;
    this.paused = false;
    this.debugMode = false;
    this.completed = false;
    this.failed = false;
    this.elapsed = 0;
    this.accumulator = 0;
    this.completeTimer = 0;
    this.nextStationIndex = 0;
    this.cargoCount = 3;
    this.tightenPresses = 0;
    this.loosenPresses = 0;
    this.tracks.length = 0;
    this.camera.x = this.sled.x;
    this.camera.y = this.sled.y;
    this.ui.resultScreen.classList.add("hidden");
    this.ui.touchControls.classList.remove("hidden");
    this.ui.resultScreen.querySelector(".result-card").classList.remove("failure");
    this.updateRouteUi();
    this.showToast("重新出发 · OBS-01 KHAN");
    this.audio.chime("station");
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    this.ui.audioLabel.textContent = this.audio.muted ? "音频已静音" : "合成音频在线";
    this.ui.audioDot.classList.toggle("on", !this.audio.muted);
  }

  loop(timestamp) {
    const frameTime = Math.min(0.05, Math.max(0, (timestamp - this.lastFrame) / 1000));
    this.lastFrame = timestamp;

    if (this.running && !this.paused && !this.debugMode && !this.completed && !this.failed) {
      this.accumulator += frameTime;
      let steps = 0;
      while (this.accumulator >= FIXED_STEP && steps < 4) {
        this.stepGame(FIXED_STEP, this.getControls());
        this.accumulator -= FIXED_STEP;
        steps += 1;
      }
    }

    if (this.debugMode) this.accumulator = 0;
    this.updateWeather(frameTime);
    this.updateSnow(frameTime);
    this.updateCamera(frameTime);
    if (this.completed && this.completeTimer > 0) {
      this.completeTimer -= frameTime;
      if (this.completeTimer <= 0) this.showResult(true);
    }

    this.uiClock += frameTime;
    if (this.uiClock > 0.07) {
      this.updateUi();
      this.uiClock = 0;
    }

    this.render(timestamp / 1000);
    requestAnimationFrame(this.loop);
  }

  stepGame(dt, controls) {
    if (this.completed || this.failed || !this.started) return;
    this.elapsed += dt;
    this.sled.step(dt, controls, this.world, this.weather);
    this.processVehicleEvents();
    this.addTrackPoint(dt);
    this.updatePrompt();
    this.audio.update({
      speed: Math.abs(this.sled.longitudinalSpeed),
      throttle: controls.throttle - controls.reverse,
      onRoad: this.sled.onRoad,
      wind: this.weather.wind,
      brake: controls.brake,
      strapTension: this.sled.strapTension,
      time: this.audio.ctx ? this.audio.ctx.currentTime : 0,
    });
  }

  processVehicleEvents() {
    for (const event of this.sled.events) {
      if (event.type === "cargoBrake") {
        this.audio.brakeSqueal();
        this.audio.impact(Math.min(1.2, event.speed / 14));
        this.showToast(`急刹 · 货箱因惯性前移`, true);
      }
      if (event.type === "cargoImpact") {
        this.audio.impact(Math.min(2, event.force / 5));
        this.showToast("货箱撞击驾驶室 · 减速或收紧绑带", true);
      }
      if (event.type === "strapClick") this.audio.ratchet();
      if (event.type === "rollover") this.failRun();
    }
  }

  addTrackPoint(dt) {
    if (Math.abs(this.sled.longitudinalSpeed) < 0.8) return;
    this.trackTimer += dt;
    if (this.trackTimer < 0.055) return;
    this.trackTimer = 0;
    const forwardX = Math.cos(this.sled.heading);
    const forwardY = Math.sin(this.sled.heading);
    const rightX = -forwardY;
    const rightY = forwardX;
    const baseX = this.sled.x - forwardX * 25;
    const baseY = this.sled.y - forwardY * 25;
    const point = {
      leftX: baseX - rightX * 18,
      leftY: baseY - rightY * 18,
      rightX: baseX + rightX * 18,
      rightY: baseY + rightY * 18,
      time: this.elapsed,
    };
    this.tracks.push(point);
    if (this.tracks.length > 1100) this.tracks.shift();
  }

  updatePrompt() {
    const station = this.world.route.stations[this.nextStationIndex];
    if (!station || station.delivered || this.cargoCount <= 0 || this.completed || this.failed) {
      this.setPrompt(false);
      return;
    }
    const distance = Math.hypot(this.sled.x - station.x, this.sled.y - station.y);
    if (distance < station.radius + 30) {
      this.setPrompt(true);
      const stopped = this.sled.speedKmh < 4;
      this.ui.promptTitle.textContent = `${station.code} · 卸下物资`;
      this.ui.promptSub.textContent = stopped
        ? `按 E 交付给 ${station.name} 观测点`
        : `减速至 4 km/h 以下再交付`;
    } else {
      this.setPrompt(false);
    }
  }

  setPrompt(visible) {
    if (this.promptVisible === visible) return;
    this.promptVisible = visible;
    this.ui.prompt.classList.toggle("hidden", !visible);
  }

  tryDeliver() {
    if (!this.started || this.completed || this.failed) return false;
    const station = this.world.route.stations[this.nextStationIndex];
    if (!station || station.delivered) return false;
    const distance = Math.hypot(this.sled.x - station.x, this.sled.y - station.y);
    if (distance > station.radius + 30 || this.sled.speedKmh >= 4) {
      this.showToast("停稳后靠近观测点，再按 E 交付", true);
      return false;
    }

    station.delivered = true;
    this.cargoCount -= 1;
    this.nextStationIndex += 1;
    this.sled.cargoForward *= 0.72;
    this.sled.cargoLateral *= 0.72;
    this.audio.chime(this.nextStationIndex >= 3 ? "complete" : "station");
    this.updateRouteUi();

    if (this.nextStationIndex >= 3) {
      this.completed = true;
      this.running = false;
      this.completeTimer = 0.85;
      this.setPrompt(false);
      this.showToast("三站物资全部送达 · 任务完成");
    } else {
      const next = this.world.route.stations[this.nextStationIndex];
      this.showToast(`${station.code} 已送达 · 前往 ${next.code} ${next.name}`);
    }
    this.updateUi();
    return true;
  }

  failRun() {
    if (this.failed) return;
    this.failed = true;
    this.running = false;
    this.setPrompt(false);
    this.audio.chime("warning");
    this.showToast("车体翻覆 · 运输失败", true);
    this.showResult(false);
  }

  showResult(success) {
    if (!this.ui.resultScreen.classList.contains("hidden")) return;
    const card = this.ui.resultScreen.querySelector(".result-card");
    card.classList.toggle("failure", !success);
    if (success) {
      this.ui.resultKicker.textContent = "DELIVERY COMPLETE";
      this.ui.resultTitle.textContent = "三站物资，全部送达。";
      this.ui.resultCopy.textContent = "风雪还在继续，但观测点的灯还亮着。";
    } else {
      this.ui.resultKicker.textContent = "VEHICLE ROLLOVER";
      this.ui.resultTitle.textContent = "雪橇翻覆，物资受困。";
      this.ui.resultCopy.textContent = "急刹和坡面侧滑叠加时，先收紧绑带，再降低入弯速度。";
    }
    this.ui.statTime.textContent = formatTime(this.elapsed);
    this.ui.statCargo.textContent = `${Math.round(this.sled.maxCargoShift)} cm`;
    this.ui.statRisk.textContent = `${Math.round(this.sled.maxRisk * 100)}%`;
    this.ui.statStraps.textContent = `${this.tightenPresses + this.loosenPresses} 次调整`;
    this.ui.resultScreen.classList.remove("hidden");
    this.ui.touchControls.classList.add("hidden");
  }

  updateRouteUi() {
    this.ui.routeCount.textContent = `${this.nextStationIndex} / 3 已送达`;
    this.ui.routeNodes.forEach((node, index) => {
      node.classList.toggle("done", index < this.nextStationIndex);
      node.classList.toggle("active", index === this.nextStationIndex);
    });
    this.ui.routeSegments.forEach((segment, index) => {
      segment.classList.toggle("done", index < this.nextStationIndex);
    });
  }

  updateWeather(dt) {
    this.weather.time += dt;
    const slow = Math.sin(this.weather.time * 0.11) * 0.18;
    const gust = Math.max(0, Math.sin(this.weather.time * 0.61 + 0.7)) ** 3 * 0.22;
    this.weather.gust = 0.5 + slow + gust;
    this.weather.wind = clamp(0.48 + slow * 0.4 + gust, 0.25, 0.82);
    this.weather.visibility = clamp(0.87 - gust * 0.72 + slow * 0.3, 0.38, 0.9);
    this.weather.angle += dt * 0.018;
    this.weatherBurst = Math.max(0, this.weatherBurst - dt);
  }

  betterZoom() {
    const base = this.camera.width < 900 ? 0.78 : this.camera.width < 1400 ? 0.88 : 0.96;
    return base * Math.min(1.1, Math.max(0.92, this.camera.height / 850));
  }

  updateCamera(dt) {
    const targetZoom = this.betterZoom() - Math.min(0.055, Math.abs(this.sled.longitudinalSpeed) * 0.003);
    this.camera.zoom = damp(this.camera.zoom, targetZoom, 2.5, dt);
    const lookAhead = 35 + Math.min(70, Math.abs(this.sled.longitudinalSpeed) * 3.5);
    const targetX = this.sled.x + Math.cos(this.sled.heading) * lookAhead;
    const targetY = this.sled.y + Math.sin(this.sled.heading) * lookAhead;
    this.camera.x = damp(this.camera.x, targetX, 3.2, dt);
    this.camera.y = damp(this.camera.y, targetY, 3.2, dt);
    const halfWidth = this.camera.width / this.camera.zoom / 2;
    const halfHeight = this.camera.height / this.camera.zoom / 2;
    this.camera.x = clamp(this.camera.x, halfWidth, this.world.width - halfWidth);
    this.camera.y = clamp(this.camera.y, halfHeight, this.world.height - halfHeight);
  }

  makeSnow() {
    const width = this.camera.width || window.innerWidth;
    const height = this.camera.height || window.innerHeight;
    this.snow = Array.from({ length: Math.round(clamp(width / 7, 120, 260)) }, () => ({
      x: range(Math.random, -40, width + 90),
      y: range(Math.random, -40, height + 90),
      depth: range(Math.random, 0.25, 1),
      length: range(Math.random, 3, 15),
      speed: range(Math.random, 38, 125),
      alpha: range(Math.random, 0.08, 0.45),
    }));
  }

  updateSnow(dt) {
    if (!this.snow.length) return;
    const windX = Math.cos(this.weather.angle);
    const windY = Math.sin(this.weather.angle);
    const boost = this.weather.wind * 2.5 + this.weatherBurst;
    for (const flake of this.snow) {
      flake.x -= (windX * boost * flake.speed + 7 * flake.depth) * dt;
      flake.y -= (windY * boost * flake.speed + 13 * flake.depth) * dt;
      if (flake.x < -70) flake.x = this.camera.width + 60;
      if (flake.x > this.camera.width + 80) flake.x = -55;
      if (flake.y < -60) flake.y = this.camera.height + 50;
      if (flake.y > this.camera.height + 80) flake.y = -45;
    }
  }

  render(time) {
    const ctx = this.ctx;
    const { width, height, zoom, x, y } = this.camera;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.world.drawBackdrop(ctx, this.camera);

    ctx.save();
    ctx.translate(width / 2 - x * zoom, height / 2 - y * zoom);
    ctx.scale(zoom, zoom);
    const station = this.world.route.stations[this.nextStationIndex];
    if (station && !station.delivered) {
      this.world.drawNavigation(ctx, this.sled.routeIndex, station, time);
    }
    for (const [index, point] of this.world.route.stations.entries()) {
      this.world.drawStation(ctx, point, index === this.nextStationIndex, time);
    }
    this.drawTracks(ctx);
    this.sled.drawLighting(ctx, time);
    this.sled.draw(ctx, time, this.cargoCount);
    this.drawNextStationMarker(ctx, time);
    ctx.restore();

    this.drawVisibility(ctx);
    this.drawSnow(ctx);
    this.drawMinimap(ctx);
  }

  drawTracks(ctx) {
    if (this.tracks.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const side of ["left", "right"]) {
      ctx.beginPath();
      this.tracks.forEach((point, index) => {
        const px = point[`${side}X`];
        const py = point[`${side}Y`];
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = "rgba(20, 37, 43, 0.2)";
      ctx.lineWidth = 13;
      ctx.stroke();
      ctx.strokeStyle = "rgba(31, 52, 58, 0.32)";
      ctx.lineWidth = 8.5;
      ctx.stroke();
      ctx.strokeStyle = "rgba(207, 229, 230, 0.13)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawNextStationMarker(ctx, time) {
    const station = this.world.route.stations[this.nextStationIndex];
    if (!station || station.delivered) return;
    const pulse = (Math.sin(time * 3) + 1) / 2;
    ctx.save();
    ctx.translate(station.x, station.y - 116 - pulse * 4);
    ctx.fillStyle = "rgba(9, 19, 23, 0.82)";
    ctx.strokeStyle = "rgba(255, 193, 90, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 13);
    ctx.lineTo(-7, 3);
    ctx.lineTo(-3, 3);
    ctx.lineTo(-3, -11);
    ctx.lineTo(3, -11);
    ctx.lineTo(3, 3);
    ctx.lineTo(7, 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawSnow(ctx) {
    const windX = Math.cos(this.weather.angle);
    const windY = Math.sin(this.weather.angle);
    const intensity = 0.45 + (1 - this.weather.visibility) * 0.8;
    ctx.save();
    ctx.lineCap = "round";
    for (const flake of this.snow) {
      const alpha = flake.alpha * intensity * (0.4 + flake.depth * 0.6);
      ctx.strokeStyle = `rgba(235, 250, 252, ${alpha})`;
      ctx.lineWidth = 0.6 + flake.depth * 1.25;
      ctx.beginPath();
      ctx.moveTo(flake.x, flake.y);
      ctx.lineTo(
        flake.x + windX * flake.length * (0.6 + flake.depth),
        flake.y + windY * flake.length * (0.6 + flake.depth),
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  drawVisibility(ctx) {
    const { width, height, zoom, x, y } = this.camera;
    const vehicleScreenX = width / 2 + (this.sled.x - x) * zoom;
    const vehicleScreenY = height / 2 + (this.sled.y - y) * zoom;
    const fog = 1 - this.weather.visibility;
    ctx.save();
    ctx.fillStyle = `rgba(199, 218, 222, ${0.035 + fog * 0.12})`;
    ctx.fillRect(0, 0, width, height);
    const gradient = ctx.createRadialGradient(
      vehicleScreenX,
      vehicleScreenY,
      Math.min(width, height) * 0.12,
      vehicleScreenX,
      vehicleScreenY,
      Math.max(width, height) * 0.72,
    );
    gradient.addColorStop(0, "rgba(7, 17, 21, 0)");
    gradient.addColorStop(0.52, `rgba(7, 17, 21, ${0.04 + fog * 0.15})`);
    gradient.addColorStop(1, `rgba(5, 12, 16, ${0.35 + fog * 0.42})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  drawMinimap(ctx) {
    if (this.camera.width < 760) return;
    const width = 194;
    const height = 132;
    const x = this.camera.width - width - 28;
    const y = 116;
    const scaleX = (width - 20) / this.world.width;
    const scaleY = (height - 27) / this.world.height;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(7, 18, 23, 0.72)";
    ctx.strokeStyle = "rgba(187, 230, 234, 0.17)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(155, 185, 190, 0.75)";
    ctx.font = "8px 'Barlow Condensed', 'Noto Sans SC Local', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("WHITEOUT-7 / ROUTE", 10, 13);

    ctx.save();
    ctx.translate(10, 20);
    ctx.beginPath();
    this.world.route.samples.forEach((sample, index) => {
      const px = sample.x * scaleX;
      const py = sample.y * scaleY;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = "rgba(201, 226, 229, 0.34)";
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const [index, station] of this.world.route.stations.entries()) {
      ctx.fillStyle = station.delivered
        ? "#79e1bf"
        : index === this.nextStationIndex ? "#ffc15a" : "rgba(196, 224, 227, 0.5)";
      ctx.beginPath();
      ctx.arc(station.x * scaleX, station.y * scaleY, index === this.nextStationIndex ? 3.2 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(this.sled.x * scaleX, this.sled.y * scaleY);
    ctx.rotate(this.sled.heading);
    ctx.fillStyle = "#f4ffff";
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-3, -3);
    ctx.lineTo(-1, 0);
    ctx.lineTo(-3, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();

    const next = this.world.route.stations[this.nextStationIndex];
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(179, 208, 212, 0.72)";
    ctx.font = "8px 'Barlow Condensed', 'Noto Sans SC Local', sans-serif";
    if (next) {
      const distance = Math.round(Math.hypot(this.sled.x - next.x, this.sled.y - next.y) * 2.4);
      ctx.fillText(`NEXT  ${next.code}  ${distance} m`, width - 10, height - 9);
    } else {
      ctx.fillStyle = "#79e1bf";
      ctx.fillText("ROUTE COMPLETE", width - 10, height - 9);
    }
    ctx.restore();
  }

  updateUi(force = false) {
    const speed = Math.min(99, Math.round(this.sled.speedKmh));
    this.ui.speed.textContent = String(speed).padStart(2, "0");
    this.ui.gear.textContent = this.failed || this.completed ? "P" : this.sled.longitudinalSpeed < -0.2 ? "R" : "D";
    const slip = Math.abs(this.sled.lateralSpeed);
    this.ui.slipBar.style.width = `${clamp(slip / 8, 0, 1) * 100}%`;
    this.ui.slipValue.textContent = slip.toFixed(1);

    const shift = this.sled.cargoShiftCm;
    this.ui.cargoBar.style.width = `${clamp(shift / 125, 0, 1) * 100}%`;
    const cargoCaution = shift > 24;
    this.ui.cargoBar.style.background = this.sled.cargoDanger
      ? "var(--danger)"
      : cargoCaution ? "var(--amber)" : "var(--ice)";
    this.ui.cargoValue.textContent = `${Math.round(shift)} cm`;
    this.ui.cargoValue.style.color = this.sled.cargoDanger
      ? "var(--danger)"
      : cargoCaution ? "var(--amber)" : "";

    const strap = this.sled.strapTension;
    this.ui.strapBar.style.width = `${strap * 100}%`;
    this.ui.strapValue.textContent = `${Math.round(strap * 100)}%`;
    this.ui.strapValue.style.color = strap > 0.7 ? "var(--amber)" : "";

    const risk = this.sled.risk;
    this.ui.riskBar.style.width = `${clamp(risk, 0, 1) * 100}%`;
    const riskLabel = risk > 0.86 ? "危险" : risk > 0.64 ? "高" : risk > 0.12 ? "注意" : "低";
    this.ui.riskValue.textContent = riskLabel;
    this.ui.riskValue.style.color = risk > 0.64 ? "var(--danger)" : risk > 0.12 ? "var(--amber)" : "";
    this.ui.cargoStrip.forEach((item, index) => {
      item.classList.toggle("filled", index < this.cargoCount);
    });

    this.ui.routeCount.textContent = `${this.nextStationIndex} / 3 已送达`;
    const totalMinutes = 402 + Math.floor(this.elapsed / 5);
    this.ui.clock.textContent = `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
    this.ui.visibility.textContent = `能见度 ${Math.round(this.weather.visibility * 100)}%`;
    this.ui.weatherLabel.textContent = this.weather.visibility < 0.55 ? "阵风 / 风雪增强" : "侧风 / 小雪";
    this.ui.windArrow.style.transform = `rotate(${this.weather.angle}rad)`;
    if (force) this.updateRouteUi();
  }

  showToast(message, danger = false) {
    clearTimeout(this.toastTimeout);
    this.ui.toast.textContent = message;
    this.ui.toast.classList.toggle("danger", danger);
    this.ui.toast.classList.add("show");
    this.toastTimeout = setTimeout(() => this.ui.toast.classList.remove("show"), 2400);
  }

  getDebugState() {
    const station = this.world.route.stations[this.nextStationIndex] || null;
    return {
      seed: this.world.seed,
      started: this.started,
      running: this.running,
      completed: this.completed,
      failed: this.failed,
      elapsed: this.elapsed,
      cargoCount: this.cargoCount,
      nextStationIndex: this.nextStationIndex,
      station: station ? {
        code: station.code,
        name: station.name,
        x: station.x,
        y: station.y,
        routeIndex: station.routeIndex,
        delivered: station.delivered,
      } : null,
      vehicle: {
        x: this.sled.x,
        y: this.sled.y,
        heading: this.sled.heading,
        routeIndex: this.sled.routeIndex,
        speedKmh: this.sled.speedKmh,
        longitudinalSpeed: this.sled.longitudinalSpeed,
        lateralSpeed: this.sled.lateralSpeed,
        cargoShiftCm: this.sled.cargoShiftCm,
        cargoForward: this.sled.cargoForward,
        cargoLateral: this.sled.cargoLateral,
        strapTension: this.sled.strapTension,
        risk: this.sled.risk,
        onRoad: this.sled.onRoad,
        rolledOver: this.sled.rolledOver,
        maxCargoShift: this.sled.maxCargoShift,
        maxRisk: this.sled.maxRisk,
      },
      audio: {
        ready: this.audio.ready,
        state: this.audio.ctx ? this.audio.ctx.state : "closed",
        muted: this.audio.muted,
      },
    };
  }

  installDebugApi() {
    window.__SNOWLINE__ = {
      freeze: () => {
        this.debugMode = true;
        return this.getDebugState();
      },
      step: (controls = {}) => {
        this.debugMode = true;
        this.stepGame(FIXED_STEP, {
          throttle: controls.throttle ? 1 : 0,
          reverse: controls.reverse ? 1 : 0,
          steer: clamp(controls.steer || 0, -1, 1),
          brake: controls.brake ? 1 : 0,
          strapTighten: Boolean(controls.strapTighten),
          strapLoosen: Boolean(controls.strapLoosen),
        });
        this.updateUi();
        return this.getDebugState();
      },
      autopilotStep: () => {
        this.debugMode = true;
        const station = this.world.route.stations[this.nextStationIndex];
        if (!station || this.completed || this.failed) return this.getDebugState();
        const distance = Math.hypot(this.sled.x - station.x, this.sled.y - station.y);
        if (distance < station.radius + 30 && this.sled.speedKmh < 4) {
          this.tryDeliver();
          this.updateUi();
          return this.getDebugState();
        }

        const speed = this.sled.speedKmh / 3.6;
        const lookAhead = Math.round(8 + speed * 1.45);
        const routeIndex = Math.min(
          station.routeIndex,
          this.sled.routeIndex + lookAhead,
        );
        const target = distance < 170 ? station : this.world.route.samples[routeIndex];
        const angle = Math.atan2(target.y - this.sled.y, target.x - this.sled.x);
        const difference = normalizeAngle(angle - this.sled.heading);
        const stopZone = distance < station.radius + 24;
        const nearStation = distance < 190;
        const desiredSpeed = stopZone
          ? 0.05
          : nearStation ? 4.2 : Math.abs(difference) > 0.58 ? 4.7 : 9.2;
        const throttle = speed < desiredSpeed ? 1 : 0;
        const brake = speed > desiredSpeed + (stopZone ? 0.18 : nearStation ? 1.1 : 1.7) ? 1 : 0;
        this.stepGame(FIXED_STEP, {
          throttle,
          reverse: 0,
          steer: clamp(difference * 2.3, -1, 1),
          brake,
          strapTighten: this.sled.cargoShiftCm > 16 || this.sled.risk > 0.35,
          strapLoosen: false,
        });
        this.updateUi();
        return this.getDebugState();
      },
      deliver: () => this.tryDeliver(),
      getState: () => this.getDebugState(),
      getStations: () => this.world.route.stations.map((station) => ({
        code: station.code,
        name: station.name,
        x: station.x,
        y: station.y,
        routeIndex: station.routeIndex,
        radius: station.radius,
        delivered: station.delivered,
      })),
      getRoute: () => this.world.route.samples.map((sample) => ({
        x: sample.x,
        y: sample.y,
        angle: sample.angle,
      })),
      resetDebug: () => {
        this.restart();
        this.debugMode = true;
        return this.getDebugState();
      },
      setVehicleState: (patch = {}) => {
        for (const key of ["x", "y", "heading", "vx", "vy", "routeIndex"]) {
          if (Number.isFinite(patch[key])) this.sled[key] = patch[key];
        }
        if (Number.isFinite(patch.speed)) {
          this.sled.vx = Math.cos(this.sled.heading) * patch.speed;
          this.sled.vy = Math.sin(this.sled.heading) * patch.speed;
          this.sled.longitudinalSpeed = patch.speed;
        }
        return this.getDebugState();
      },
    };
  }
}

const game = new WhiteoutRun();
game.installDebugApi();
