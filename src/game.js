import {
  boatMaxSpeed,
  clamp,
  createGameState,
  DOCKS,
  RULES,
  WORLD,
} from "./config.js";
import { HarborAudio } from "./audio.js";
import { Renderer } from "./renderer.js";

const $ = (id) => document.getElementById(id);

class TideGame {
  constructor() {
    this.canvas = $("gameCanvas");
    this.renderer = new Renderer(this.canvas);
    this.audio = new HarborAudio();
    this.state = createGameState();
    this.keys = Object.create(null);
    this.touchCompact = false;
    this.camera = 0;
    this.time = 0;
    this.lastFrame = performance.now();
    this.toastTimer = 0;
    this.endTimer = 0;
    this.lastCompacting = false;
    this.ui = {
      timer: $("timer"),
      tideFill: $("tideFill"),
      tideLevel: $("tideLevel"),
      tideState: $("tideState"),
      phaseLabel: $("phaseLabel"),
      massValue: $("massValue"),
      loadFill: $("loadFill"),
      speedValue: $("speedValue"),
      batteryValue: $("batteryValue"),
      batteryFill: $("batteryFill"),
      powerState: $("powerState"),
      leakValue: $("leakValue"),
      leakFill: $("leakFill"),
      leakState: $("leakState"),
      missionCount: $("missionCount"),
      stepCollect: $("stepCollect"),
      stepCompact: $("stepCompact"),
      stepDeliver: $("stepDeliver"),
      volumeValue: $("volumeValue"),
      volumeFill: $("volumeFill"),
      compactBand: $("compactBand"),
      holdHint: $("holdHint"),
      toast: $("toast"),
      toastText: $("toastText"),
      actionHint: $("actionHint"),
      startOverlay: $("startOverlay"),
      endOverlay: $("endOverlay"),
      endKicker: $("endKicker"),
      endTitle: $("endTitle"),
      endMessage: $("endMessage"),
      resultDocks: $("resultDocks"),
      resultPower: $("resultPower"),
      resultLeak: $("resultLeak"),
      resultTime: $("resultTime"),
      audioButton: $("audioButton"),
      audioLabel: $("audioLabel"),
    };

    this.bindEvents();
    this.syncCamera(true);
    this.updateUI();
    requestAnimationFrame((now) => this.loop(now));
  }

  bindEvents() {
    window.addEventListener("resize", () => this.renderer.resize());
    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      if (["arrowleft", "arrowright", " ", "e"].includes(key)) event.preventDefault();
      if (key === "enter" && this.state.mode === "menu") this.start();
      if (event.repeat) return;
      this.keys[key] = true;
      if (key === "e") this.performAction();
    });
    window.addEventListener("keyup", (event) => {
      this.keys[event.key.toLowerCase()] = false;
    });
    window.addEventListener("blur", () => {
      this.keys = Object.create(null);
      this.touchCompact = false;
    });

    $("startButton").addEventListener("click", () => this.start());
    $("restartButton").addEventListener("click", () => this.start());
    this.ui.audioButton.addEventListener("click", () => this.toggleAudio());

    const holdButton = (id, key) => {
      const element = $(id);
      const activate = (event) => {
        event.preventDefault();
        this.keys[key] = true;
        element.setPointerCapture?.(event.pointerId);
      };
      const deactivate = (event) => {
        event.preventDefault();
        this.keys[key] = false;
      };
      element.addEventListener("pointerdown", activate);
      element.addEventListener("pointerup", deactivate);
      element.addEventListener("pointercancel", deactivate);
      element.addEventListener("pointerleave", deactivate);
    };
    holdButton("leftButton", "arrowleft");
    holdButton("rightButton", "arrowright");

    const compact = $("compactButton");
    const startCompact = (event) => {
      event.preventDefault();
      this.touchCompact = true;
    };
    const stopCompact = (event) => {
      event.preventDefault();
      this.touchCompact = false;
    };
    compact.addEventListener("pointerdown", startCompact);
    compact.addEventListener("pointerup", stopCompact);
    compact.addEventListener("pointercancel", stopCompact);
    compact.addEventListener("pointerleave", stopCompact);
    $("actionButton").addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.performAction();
    });

    this.canvas.addEventListener("pointerdown", () => this.audio.init());
  }

  async start() {
    this.endTimer = 0;
    clearTimeout(this.toastTimer);
    this.ui.endOverlay.classList.add("hidden");
    this.ui.startOverlay.classList.add("hidden");
    this.state = createGameState();
    this.state.mode = "playing";
    this.keys = Object.create(null);
    this.touchCompact = false;
    this.lastCompacting = false;
    this.warningShown = false;
    this.syncCamera(true);
    await this.audio.init();
    this.showToast("靠泊三处码头，按住 SPACE 压缩后送往东岸", "good", 3.8);
    this.updateUI();
  }

  loop(now) {
    const dt = Math.min(0.04, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.time += dt;

    if (this.state.mode === "playing") this.update(dt);
    this.updateEffects(dt);
    this.syncCamera(false, dt);

    this.state.boat.compacting = this.isCompacting();
    this.renderer.render(this.state, {
      camera: this.camera,
      time: this.time,
      maxSpeed: boatMaxSpeed(this.state),
    });
    this.audio.update(this.state, boatMaxSpeed(this.state), dt);
    this.updateUI();
    requestAnimationFrame((nextNow) => this.loop(nextNow));
  }

  update(dt) {
    const state = this.state;
    const boat = state.boat;
    state.time = Math.max(0, state.time - dt);
    state.elapsed += dt;

    if (state.time <= 0) {
      this.finish(false, "tide");
      return;
    }

    const left = this.keys.arrowleft || this.keys.a;
    const right = this.keys.arrowright || this.keys.d;
    const maxSpeed = boatMaxSpeed(state);
    const input = (right ? 1 : 0) - (left ? 1 : 0);

    if (input !== 0) {
      const opposite = Math.sign(boat.vx) !== 0 && Math.sign(boat.vx) !== input;
      const acceleration = WORLD.acceleration * (opposite ? 1.55 : 1);
      boat.vx += acceleration * input * dt;
    } else {
      boat.vx *= Math.exp(-WORLD.drag * dt);
      if (Math.abs(boat.vx) < 0.4) boat.vx = 0;
    }

    boat.vx = clamp(boat.vx, -maxSpeed * 0.52, maxSpeed);
    boat.x = clamp(boat.x + boat.vx * dt, 88, WORLD.width - 82);
    boat.tilt += (clamp(boat.vx / maxSpeed, -1, 1) * 0.02 - boat.tilt) * Math.min(1, dt * 5);
    boat.battery = Math.max(0, boat.battery - RULES.idlePower * dt);

    this.updateCompactor(dt);
    this.updateLeak(dt, maxSpeed);
    this.updateDockProximity();

    state.stats.peakLeak = Math.max(state.stats.peakLeak, boat.leak);
    state.stats.maxMass = Math.max(state.stats.maxMass, boat.mass);

    if (boat.battery <= 0) this.finish(false, "battery");
    else if (boat.leak >= RULES.alarmLeak) this.finish(false, "alarm");
  }

  updateCompactor(dt) {
    const boat = this.state.boat;
    const floor = boat.mass * RULES.solidMassRatio;
    const wantsCompact = this.touchCompact || this.keys[" "];
    const canCompact = wantsCompact && boat.volume > floor + 0.05 && boat.battery > 0;

    if (canCompact) {
      const before = boat.volume;
      boat.volume = Math.max(floor, boat.volume - RULES.compactRate * dt);
      boat.battery = Math.max(0, boat.battery - RULES.compactPower * dt);
      boat.leak = Math.min(100, boat.leak + RULES.leakCompactCost * dt);
      boat.hasCompacted = true;
      this.state.stats.powerUsed += RULES.compactPower * dt;
      if (boat.volume < before - 0.001 && !this.lastCompacting) {
        this.audio.compactStart();
      }
      this.lastCompacting = true;
    } else {
      if (this.lastCompacting) this.audio.compactStop();
      this.lastCompacting = false;
    }
    boat.compacting = canCompact;
  }

  updateLeak(dt, maxSpeed) {
    const boat = this.state.boat;
    const loadRatio = clamp(boat.volume / WORLD.capacity, 0, 1);
    const speedRatio = clamp(Math.abs(boat.vx) / Math.max(1, maxSpeed), 0, 1);
    const nearStation =
      Math.abs(boat.vx) < 16 &&
      (this.state.docks.some((dock) => !dock.collected && Math.abs(boat.x - dock.x) < WORLD.dockReach) ||
        Math.abs(boat.x - this.state.processor.x) < WORLD.processorReach);

    if (nearStation) {
      boat.leak = Math.max(0, boat.leak - RULES.leakDockRecovery * dt);
      return;
    }

    const loadLeak = loadRatio * loadRatio * RULES.leakLoadFactor;
    const speedLeak = speedRatio * speedRatio * loadRatio * RULES.leakSpeedFactor;
    const spill = RULES.leakBase + loadLeak + speedLeak;
    boat.leak = Math.min(100, boat.leak + spill * dt);

    if (boat.leak >= RULES.warningLeak && !this.warningShown) {
      this.warningShown = true;
      this.showToast("泄漏逼近环保红线，减速或靠岸回收", "danger", 2.5);
      this.audio.beep(640, 0.12, 0.04, "square");
    }
    if (boat.leak < RULES.warningLeak - 8) this.warningShown = false;
  }

  updateDockProximity() {
    const boat = this.state.boat;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const dock of this.state.docks) {
      if (dock.collected) continue;
      const distance = Math.abs(boat.x - dock.x);
      if (distance < nearestDistance) {
        nearest = dock;
        nearestDistance = distance;
      }
    }
    boat.dockedAt = nearest && nearestDistance < WORLD.dockReach ? nearest.id : null;
    this.ui.actionHint.textContent =
      nearest && nearestDistance < WORLD.dockReach
        ? "收集垃圾"
        : Math.abs(boat.x - this.state.processor.x) < WORLD.processorReach
          ? "送抵处理"
          : "收集 / 卸货";
  }

  updateEffects(dt) {
    const state = this.state;
    state.effect.leakPulse = Math.max(0, state.effect.leakPulse - dt);
    state.effect.success = Math.max(0, state.effect.success - dt);
    for (const dock of state.docks) dock.flash = Math.max(0, dock.flash - dt * 1.6);
    state.processor.flash = Math.max(0, state.processor.flash - dt * 1.1);
  }

  syncCamera(instant = false, dt = 0.016) {
    const target = clamp(
      this.state.boat.x - this.renderer.width * 0.38,
      0,
      Math.max(0, WORLD.width - this.renderer.width),
    );
    if (instant) this.camera = target;
    else this.camera += (target - this.camera) * (1 - Math.exp(-dt * 4.6));
  }

  isCompacting() {
    const boat = this.state.boat;
    const floor = boat.mass * RULES.solidMassRatio;
    return (
      this.state.mode === "playing" &&
      (this.touchCompact || this.keys[" "]) &&
      boat.battery > 0 &&
      boat.volume > floor + 0.05
    );
  }

  performAction() {
    if (this.state.mode !== "playing") return;
    const boat = this.state.boat;
    const dock = this.state.docks.find(
      (candidate) => !candidate.collected && Math.abs(boat.x - candidate.x) < WORLD.dockReach,
    );

    if (dock) {
      if (boat.volume + dock.volume > WORLD.capacity) {
        this.state.stats.fullRejects += 1;
        this.state.stats.lastFullReject = {
          dock: dock.id,
          heldVolume: boat.volume,
          incomingVolume: dock.volume,
          time: this.state.elapsed,
        };
        this.state.effect.leakPulse = 1;
        this.audio.reject();
        this.showToast(`满载：${boat.volume.toFixed(0)} + ${dock.volume} m³ 超过 100 m³，先按住 SPACE 压缩`, "danger", 2.8);
        return;
      }

      boat.volume += dock.volume;
      boat.mass += dock.mass;
      boat.dockedAt = null;
      dock.collected = true;
      dock.collectedAt = this.state.elapsed;
      dock.flash = 1;
      this.state.stats.collections += 1;
      boat.leak = Math.min(100, boat.leak + 1.5);
      this.audio.collect();

      const remaining = this.state.docks.filter((candidate) => !candidate.collected).length;
      if (remaining === 0) {
        this.showToast("三处码头已完成。压缩货舱并驶向东岸处理点", "good", 3.2);
      } else {
        this.showToast(
          `${dock.label}装载完成，货舱 ${boat.volume.toFixed(0)} m³，下一处还有 ${remaining} 次`,
          "good",
          2.5,
        );
      }
      return;
    }

    if (Math.abs(boat.x - this.state.processor.x) < WORLD.processorReach) {
      const allCollected = this.state.docks.every((candidate) => candidate.collected);
      if (!allCollected) {
        const remaining = this.state.docks.filter((candidate) => !candidate.collected).length;
        this.audio.reject();
        this.showToast(`还不能卸货：还有 ${remaining} 处码头未完成`, "danger", 2.3);
        return;
      }
      if (!boat.hasCompacted) {
        this.audio.reject();
        this.showToast("处理点要求压缩装舱，请先按住 SPACE 压缩垃圾", "danger", 2.3);
        return;
      }
      this.state.processor.delivered = true;
      this.state.processor.flash = 1;
      this.finish(true, "delivered");
      return;
    }

    this.audio.reject();
    this.showToast("附近没有可作业的码头，继续沿河向东岸行驶", "danger", 1.9);
  }

  finish(victory, reason) {
    if (this.state.mode !== "playing") return;
    this.state.mode = victory ? "won" : "lost";
    this.state.effect.failReason = reason;
    this.lastCompacting = false;
    this.audio.compactStop();

    if (victory) {
      this.audio.deliver();
      this.showToast("全部垃圾已压缩送抵，环保清运完成", "good", 3);
      this.endTimer = window.setTimeout(() => this.showEnd(true, reason), 650);
    } else {
      this.audio.fail();
      const message =
        reason === "alarm"
          ? "泄漏量突破环保红线，任务被现场叫停"
          : reason === "battery"
            ? "电池耗尽，压缩系统与动力停止工作"
            : "满潮已经到来，剩余码头无法继续作业";
      this.showToast(message, "danger", 3);
      this.endTimer = window.setTimeout(() => this.showEnd(false, reason), 700);
    }
    this.updateUI();
  }

  showEnd(victory, reason) {
    if (this.state.mode !== (victory ? "won" : "lost")) return;
    const stats = this.state.stats;
    this.ui.endKicker.textContent = victory ? "任务完成 · TIDE CLEARED" : "任务中止 · WINDOW CLOSED";
    this.ui.endTitle.innerHTML = victory
      ? "满潮之前，<br><em>河道清空。</em>"
      : reason === "alarm"
        ? "环保红线，<br><em>警报响起。</em>"
        : reason === "battery"
          ? "电量耗尽，<br><em>船已失速。</em>"
          : "潮水先到，<br><em>窗口关闭。</em>";
    this.ui.endMessage.textContent = victory
      ? "三处码头垃圾已全部收集、压缩并送抵处理点，电量仍在安全范围。"
      : reason === "alarm"
        ? "未能控制垃圾渗滤液，环保警报触发。下次在满载时减速，并尽早压缩。"
        : reason === "battery"
          ? "压缩机和推进器同时失去供电。注意压缩只在需要腾出空间时短时使用。"
          : "满潮封航，仍有码头垃圾未完成收集。提高航速效率并提前规划压缩时机。";
    this.ui.resultDocks.textContent = `${stats.collections} / 3`;
    this.ui.resultPower.textContent = `${Math.round(100 - this.state.boat.battery)}%`;
    this.ui.resultLeak.textContent = `${Math.round(stats.peakLeak)}%`;
    this.ui.resultTime.textContent = this.formatTime(this.state.time);
    this.ui.endOverlay.classList.remove("hidden");
  }

  updateUI() {
    const state = this.state;
    const boat = state.boat;
    const durationRatio = state.time / WORLD.duration;
    const collectedCount = state.docks.filter((dock) => dock.collected).length;
    const allCollected = collectedCount === 3;
    const nearProcessor = Math.abs(boat.x - state.processor.x) < WORLD.processorReach;
    const floor = boat.mass * RULES.solidMassRatio;

    this.ui.timer.textContent = this.formatTime(state.time);
    this.ui.timer.classList.toggle("urgent", state.time <= RULES.tideWarning);
    this.ui.tideFill.style.transform = `scaleX(${clamp(durationRatio, 0, 1)})`;
    this.ui.tideFill.classList.toggle("low", state.time <= RULES.tideWarning);
    this.ui.tideLevel.textContent = `${(0.8 + (1 - durationRatio) * 2.6).toFixed(1)}m`;
    this.ui.phaseLabel.textContent =
      state.time <= RULES.tideCritical ? "即将满潮" : state.time <= RULES.tideWarning ? "满潮迫近" : "距满潮";
    this.ui.tideState.textContent =
      state.time <= RULES.tideCritical ? "封航临界" : state.time <= RULES.tideWarning ? "抓紧收尾" : "安全窗口";

    this.ui.massValue.textContent = `${boat.mass.toFixed(1)} t`;
    this.ui.loadFill.style.width = `${clamp((boat.mass / 63) * 100, 0, 100)}%`;
    this.ui.speedValue.textContent = `航速 ${(Math.abs(boat.vx) / 18.2).toFixed(1)} kn`;

    this.ui.batteryValue.textContent = `${Math.round(boat.battery)}%`;
    this.ui.batteryFill.style.width = `${clamp(boat.battery, 0, 100)}%`;
    this.ui.batteryFill.style.background =
      boat.battery < 25 ? "#ff795f" : boat.battery < 50 ? "#ffc957" : "#65ddd4";
    this.ui.powerState.textContent = boat.compacting
      ? `压缩中 · -${RULES.compactPower.toFixed(1)} kW`
      : boat.battery < 25
        ? "电量偏低"
        : "压缩系统待机";
    this.ui.powerState.className = boat.battery < 25 ? "critical" : boat.battery < 50 ? "warning" : "";

    this.ui.leakValue.textContent = `${Math.round(boat.leak)}%`;
    this.ui.leakFill.style.width = `${clamp(boat.leak, 0, 100)}%`;
    this.ui.leakState.textContent =
      boat.leak >= RULES.criticalLeak
        ? "环保警报临界"
        : boat.leak >= RULES.warningLeak
          ? "油膜扩散 · 立即减速"
          : boat.leak >= 30
            ? "轻微渗漏"
            : "密封正常";
    this.ui.leakState.className =
      boat.leak >= RULES.warningLeak ? "critical" : boat.leak >= 30 ? "warning" : "";

    this.ui.missionCount.textContent = `${collectedCount} / 3`;
    this.ui.stepCollect.classList.toggle("done", allCollected);
    this.ui.stepCollect.classList.toggle("active", !allCollected && state.mode === "playing");
    this.ui.stepCollect.querySelector("b").textContent = `${collectedCount}/3`;
    this.ui.stepCompact.classList.toggle("done", boat.hasCompacted);
    this.ui.stepCompact.classList.toggle(
      "active",
      !boat.hasCompacted && collectedCount > 0 && state.mode === "playing",
    );
    this.ui.stepCompact.querySelector("b").textContent = boat.hasCompacted
      ? "已完成"
      : collectedCount > 0
        ? "建议启用"
        : "待命";
    this.ui.stepDeliver.classList.toggle("done", state.processor.delivered);
    this.ui.stepDeliver.classList.toggle(
      "active",
      allCollected && boat.hasCompacted && !state.processor.delivered && state.mode === "playing",
    );
    this.ui.stepDeliver.querySelector("b").textContent = state.processor.delivered
      ? "已完成"
      : allCollected && boat.hasCompacted
        ? nearProcessor
          ? "可卸货"
          : "前往东岸"
        : "未解锁";

    this.ui.volumeValue.textContent = `${Math.round(boat.volume)} / 100 m³`;
    this.ui.volumeFill.style.width = `${clamp(boat.volume, 0, 100)}%`;
    this.ui.volumeFill.classList.toggle("heavy", boat.volume >= 76);
    this.ui.compactBand.style.width = `${clamp(floor, 4, 62)}%`;
    this.ui.holdHint.textContent = boat.compacting
      ? "压缩中 · 体积下降，电量消耗"
      : boat.volume >= WORLD.capacity - 0.1
        ? "满载 · 无法继续收集"
        : boat.volume + 38 > WORLD.capacity
          ? "下次装载会超限，先压缩"
          : boat.volume > 0
            ? "可短时压缩腾出舱容"
            : "空舱，沿河前往第一处码头";
  }

  formatTime(seconds) {
    const safe = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  showToast(message, style = "good", duration = 2.4) {
    clearTimeout(this.toastTimer);
    this.ui.toastText.textContent = message;
    this.ui.toast.className = `toast visible ${style}`;
    this.toastTimer = window.setTimeout(() => {
      this.ui.toast.classList.remove("visible");
    }, duration * 1000);
  }

  async toggleAudio() {
    await this.audio.init();
    const muted = !this.audio.muted;
    this.audio.setMuted(muted);
    this.ui.audioButton.classList.toggle("muted", muted);
    this.ui.audioLabel.textContent = muted ? "声音关" : "声音开";
  }

  snapshot() {
    const state = this.state;
    return {
      mode: state.mode,
      time: state.time,
      elapsed: state.elapsed,
      boat: {
        x: state.boat.x,
        vx: state.boat.vx,
        mass: state.boat.mass,
        volume: state.boat.volume,
        battery: state.boat.battery,
        leak: state.boat.leak,
        compacting: state.boat.compacting,
        hasCompacted: state.boat.hasCompacted,
      },
      docks: state.docks.map((dock) => ({
        id: dock.id,
        x: dock.x,
        volume: dock.volume,
        collected: dock.collected,
      })),
      processor: { x: state.processor.x, delivered: state.processor.delivered },
      stats: {
        ...state.stats,
        lastFullReject: state.stats.lastFullReject && { ...state.stats.lastFullReject },
      },
    };
  }

  debugSet(patch) {
    if (!patch || typeof patch !== "object") return;
    if (Number.isFinite(patch.x)) this.state.boat.x = clamp(patch.x, 88, WORLD.width - 82);
    if (Number.isFinite(patch.volume)) this.state.boat.volume = clamp(patch.volume, 0, WORLD.capacity);
    if (Number.isFinite(patch.battery)) this.state.boat.battery = clamp(patch.battery, 0, WORLD.batteryCapacity);
    if (Number.isFinite(patch.leak)) this.state.boat.leak = clamp(patch.leak, 0, 100);
    if (Number.isFinite(patch.mass)) this.state.boat.mass = Math.max(0, patch.mass);
    this.syncCamera(true);
  }
}

const game = new TideGame();

window.__tideGame = {
  start: () => game.start(),
  snapshot: () => game.snapshot(),
  action: () => game.performAction(),
  debugSet: (patch) => game.debugSet(patch),
  audioStatus: () => game.audio.status(),
  docks: DOCKS.map((dock) => ({ ...dock })),
};
