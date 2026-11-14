"use strict";

const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const compassCanvas = document.getElementById("compass");
const compassCtx = compassCanvas.getContext("2d");
const WORLD = { width: 1600, height: 900, ground: 720 };
const HOME = { x: 1300, y: 690 };
const TOWERS = [
  { x: 560, base: 716, height: 472, label: "01#" },
  { x: 930, base: 716, height: 490, label: "02#" },
  { x: 1300, base: 716, height: 464, label: "03#" }
];
const TARGETS = [
  { id: 0, name: "导线异常", detail: "2#—3# 档距 · 中相", x: 1182, y: 326, found: false, quality: 0 },
  { id: 1, name: "绝缘子串", detail: "2# 塔 · 右横担", x: 1075, y: 318, found: false, quality: 0 },
  { id: 2, name: "金具磨损", detail: "1# 塔 · 左横担", x: 415, y: 321, found: false, quality: 0 }
];
const STAGING = [
  { x: 1082, y: 375 },
  { x: 972, y: 370 },
  { x: 505, y: 373 }
];
const PALETTE = {
  bgTop: "#06151b",
  bgMid: "#102b2e",
  horizon: "#d18a52",
  steel: "#5d756f",
  steelBright: "#9ab1a7",
  wire: "#93aaa1",
  mint: "#77e3c1",
  amber: "#e6b45f",
  orange: "#ff9151",
  danger: "#ff6b56"
};

const ui = {
  startScreen: document.getElementById("startScreen"),
  startButton: document.getElementById("startButton"),
  demoButton: document.getElementById("demoButton"),
  resultScreen: document.getElementById("resultScreen"),
  resultTitle: document.getElementById("resultTitle"),
  resultCopy: document.getElementById("resultCopy"),
  resultEyebrow: document.getElementById("resultEyebrow"),
  resultTargets: document.getElementById("resultTargets"),
  resultTime: document.getElementById("resultTime"),
  resultBattery: document.getElementById("resultBattery"),
  againButton: document.getElementById("againButton"),
  finishButton: document.getElementById("finishButton"),
  captureButton: document.getElementById("captureButton"),
  captureStatus: document.getElementById("captureStatus"),
  batteryFill: document.getElementById("batteryFill"),
  batteryValue: document.getElementById("batteryValue"),
  returnReserve: document.getElementById("returnReserve"),
  windValue: document.getElementById("windValue"),
  windNeedle: document.getElementById("windNeedle"),
  windCaption: document.getElementById("windCaption"),
  interferenceValue: document.getElementById("interferenceValue"),
  compassWarning: document.getElementById("compassWarning"),
  speedValue: document.getElementById("speedValue"),
  altitudeValue: document.getElementById("altitudeValue"),
  cameraValue: document.getElementById("cameraValue"),
  flightMode: document.getElementById("flightMode"),
  missionClock: document.getElementById("missionClock"),
  missionPhase: document.getElementById("missionPhase"),
  targetRows: [...document.querySelectorAll(".target-row")],
  reticleHint: document.getElementById("reticleHint"),
  hintText: document.getElementById("hintText"),
  soundButton: document.getElementById("soundButton"),
  soundLabel: document.getElementById("soundLabel"),
  helpButton: document.getElementById("helpButton"),
  helpModal: document.getElementById("helpModal"),
  closeHelp: document.getElementById("closeHelp"),
  toast: document.getElementById("toast"),
  toastTitle: document.getElementById("toastTitle"),
  toastCopy: document.getElementById("toastCopy")
};

const game = {
  mode: "intro",
  time: 0,
  battery: 100,
  wind: 6.2,
  turbulence: 0,
  interference: 0,
  compassDrift: 0,
  drone: {
    x: HOME.x,
    y: HOME.y,
    speed: 0,
    groundSpeed: 0,
    altitude: 8,
    camera: 0,
    rotor: 0,
    trail: []
  },
  throttle: 34,
  hoverTime: 0,
  capturedCount: 0,
  demo: false,
  demoIndex: 0,
  demoReturning: false,
  demoSettle: 0,
  autoReturn: false,
  flash: 0,
  shake: 0,
  lowBatteryWarned: false,
  toastTimer: 0,
  result: null,
  sound: true
};

const input = {
  keys: new Set(),
  pointerX: 1000,
  pointerY: 372,
  pointerActive: false,
  canvasX: 1000,
  canvasY: 372
};

const view = {
  width: WORLD.width,
  height: WORLD.height,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  dpr: 1
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - Math.pow(1 - t, 3);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const sceneRandom = seededRandom(247031);
const stars = Array.from({ length: 96 }, () => ({
  x: sceneRandom() * WORLD.width,
  y: 40 + sceneRandom() * 330,
  r: 0.35 + sceneRandom() * 1.1,
  a: 0.18 + sceneRandom() * 0.55,
  phase: sceneRandom() * Math.PI * 2
}));
const fogBands = Array.from({ length: 9 }, (_, index) => ({
  x: sceneRandom() * WORLD.width,
  y: 350 + sceneRandom() * 250,
  width: 250 + sceneRandom() * 480,
  speed: 4 + sceneRandom() * 9,
  alpha: 0.025 + sceneRandom() * 0.045,
  offset: index * 1.7
}));
const windSeeds = Array.from({ length: 42 }, () => ({
  x: sceneRandom() * WORLD.width,
  y: 100 + sceneRandom() * 570,
  length: 8 + sceneRandom() * 28,
  speed: 0.6 + sceneRandom() * 1.5,
  alpha: 0.08 + sceneRandom() * 0.2
}));
const distantLights = Array.from({ length: 24 }, () => ({
  x: sceneRandom() * WORLD.width,
  y: 635 + sceneRandom() * 36,
  size: sceneRandom() > 0.8 ? 2 : 1
}));

const sound = {
  context: null,
  master: null,
  rotorGain: null,
  rotorA: null,
  rotorB: null,
  noiseGain: null,
  noiseFilter: null,
  initialized: false,
  init() {
    if (this.initialized) {
      if (this.context.state === "suspended") this.context.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const audio = new AudioContext();
    this.context = audio;
    this.master = audio.createGain();
    this.master.gain.value = game.sound ? 0.6 : 0;
    this.master.connect(audio.destination);

    this.rotorGain = audio.createGain();
    this.rotorGain.gain.value = 0;
    this.rotorGain.connect(this.master);
    this.rotorA = audio.createOscillator();
    this.rotorA.type = "sawtooth";
    this.rotorA.frequency.value = 72;
    const rotorAFilter = audio.createBiquadFilter();
    rotorAFilter.type = "lowpass";
    rotorAFilter.frequency.value = 210;
    this.rotorA.connect(rotorAFilter).connect(this.rotorGain);
    this.rotorA.start();
    this.rotorB = audio.createOscillator();
    this.rotorB.type = "triangle";
    this.rotorB.frequency.value = 116;
    const rotorBGain = audio.createGain();
    rotorBGain.gain.value = 0.35;
    this.rotorB.connect(rotorBGain).connect(this.rotorGain);
    this.rotorB.start();

    const buffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) channel[i] = Math.random() * 2 - 1;
    const noise = audio.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    this.noiseFilter = audio.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.frequency.value = 900;
    this.noiseFilter.Q.value = 0.7;
    this.noiseGain = audio.createGain();
    this.noiseGain.gain.value = 0;
    noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    noise.start();
    this.initialized = true;
  },
  update(speed, interference, active) {
    if (!this.initialized) return;
    const now = this.context.currentTime;
    const flying = active ? 1 : 0;
    const rotorLevel = flying * (0.016 + speed / 2400);
    this.rotorGain.gain.setTargetAtTime(rotorLevel, now, 0.08);
    this.rotorA.frequency.setTargetAtTime(68 + speed * 0.26, now, 0.1);
    this.rotorB.frequency.setTargetAtTime(108 + speed * 0.4, now, 0.1);
    this.noiseGain.gain.setTargetAtTime(flying * (0.006 + interference * 0.055), now, 0.08);
    this.noiseFilter.frequency.setTargetAtTime(600 + interference * 1700, now, 0.08);
  },
  setEnabled(enabled) {
    this.init();
    if (!this.initialized) return;
    this.master.gain.setTargetAtTime(enabled ? 0.6 : 0, this.context.currentTime, 0.06);
  },
  click(kind = "shutter") {
    if (!this.initialized || !game.sound) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = kind === "success" ? "sine" : "square";
    osc.frequency.setValueAtTime(kind === "success" ? 540 : 140, now);
    osc.frequency.exponentialRampToValueAtTime(kind === "success" ? 860 : 70, now + 0.09);
    gain.gain.setValueAtTime(kind === "success" ? 0.055 : 0.025, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.13);
  }
};

function worldToCanvas(clientX, clientY) {
  return {
    x: (clientX - view.offsetX) / view.scale,
    y: (clientY - view.offsetY) / view.scale
  };
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.scale = Math.min(rect.width / WORLD.width, rect.height / WORLD.height);
  view.offsetX = (rect.width - WORLD.width * view.scale) / 2;
  view.offsetY = (rect.height - WORLD.height * view.scale) / 2;
  canvas.width = Math.round(rect.width * view.dpr);
  canvas.height = Math.round(rect.height * view.dpr);
}

function setPointer(clientX, clientY) {
  const point = worldToCanvas(clientX, clientY);
  input.canvasX = point.x;
  input.canvasY = point.y;
  input.pointerX = clamp(point.x, 24, WORLD.width - 24);
  input.pointerY = clamp(point.y, 64, WORLD.height - 120);
  input.pointerActive = true;
}

function activeTarget() {
  return TARGETS.find((target) => !target.found) || null;
}

function normalizeAngle(angle) {
  let value = angle % (Math.PI * 2);
  if (value < 0) value += Math.PI * 2;
  return value;
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  const rest = String(safe % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function showToast(title, copy, type = "success", duration = 2.8) {
  ui.toastTitle.textContent = title;
  ui.toastCopy.textContent = copy;
  ui.toast.className = `toast visible ${type === "success" ? "" : type}`.trim();
  game.toastTimer = duration;
}

function hideToast() {
  ui.toast.className = "toast";
}

function resetMission(demo = false) {
  game.mode = "flying";
  game.time = 0;
  game.battery = 100;
  game.wind = 6.2;
  game.interference = 0;
  game.compassDrift = 0;
  game.capturedCount = 0;
  game.hoverTime = 0;
  game.demo = demo;
  game.demoIndex = 0;
  game.demoReturning = false;
  game.demoSettle = 0;
  game.demoPause = 0;
  game.autoReturn = false;
  game.lowBatteryWarned = false;
  game.flash = 0;
  game.shake = 0;
  game.result = null;
  game.drone.x = HOME.x;
  game.drone.y = HOME.y;
  game.drone.speed = 0;
  game.drone.groundSpeed = 0;
  game.drone.altitude = 7;
  game.drone.camera = Math.PI;
  game.drone.rotor = 0;
  game.drone.trail = [{ x: HOME.x, y: HOME.y, age: 0 }];
  game.throttle = demo ? 44 : 34;
  input.pointerX = demo ? TARGETS[0].x : 1100;
  input.pointerY = demo ? TARGETS[0].y : 380;
  input.pointerActive = demo;
  TARGETS.forEach((target) => {
    target.found = false;
    target.quality = 0;
  });
  ui.targetRows.forEach((row) => {
    row.classList.remove("done", "active");
    row.querySelector(".target-state").textContent = "待取证";
  });
  ui.startScreen.classList.add("leaving");
  ui.resultScreen.hidden = true;
  ui.helpModal.hidden = true;
  hideToast();
  sound.init();
  sound.setEnabled(game.sound);
  showToast(demo ? "示范巡检启动" : "无人机已起飞", demo ? "自动航线将完成三处取证并返航" : "横风修正已开启，注意返航余量", "success", 3.4);
}

function startDemo() {
  resetMission(true);
}

function startMission() {
  resetMission(false);
}

function restartFromIntro() {
  game.mode = "intro";
  game.demo = false;
  game.battery = 100;
  game.time = 0;
  game.capturedCount = 0;
  game.result = null;
  TARGETS.forEach((target) => {
    target.found = false;
    target.quality = 0;
  });
  game.drone.x = HOME.x;
  game.drone.y = HOME.y;
  game.drone.trail = [];
  ui.resultScreen.hidden = true;
  ui.startScreen.classList.remove("leaving");
  ui.targetRows.forEach((row) => {
    row.classList.remove("done", "active");
    row.querySelector(".target-state").textContent = "待取证";
  });
  hideToast();
}

function completeMission(success, reason = "success") {
  if (game.mode !== "flying") return;
  game.mode = "result";
  game.demo = false;
  game.autoReturn = false;
  const successCopy = game.capturedCount === 3
    ? "三处目标均已取证，无人机安全返航。"
    : reason;
  game.result = {
    success,
    time: game.time,
    battery: game.battery,
    captured: game.capturedCount
  };
  ui.resultEyebrow.textContent = success ? "MISSION COMPLETE / 03 OF 03" : "MISSION ABORTED";
  ui.resultTitle.textContent = success ? "巡检完成" : "任务中止";
  ui.resultCopy.textContent = successCopy;
  ui.resultTargets.textContent = `${game.capturedCount} / 3`;
  ui.resultTime.textContent = formatClock(game.time);
  ui.resultBattery.textContent = `${Math.round(game.battery)}%`;
  ui.againButton.querySelector("span").textContent = success ? "再次巡检" : "重新起飞";
  ui.resultScreen.hidden = false;
  sound.click(success ? "success" : "shutter");
}

function getInterference(x, y, time) {
  let value = 0.04 + Math.sin(time * 0.8 + 0.4) * 0.018;
  TOWERS.forEach((tower, index) => {
    const centerY = tower.base - tower.height + 156;
    const dx = (x - tower.x) / 185;
    const dy = (y - centerY) / 230;
    const pulse = 0.68 + Math.sin(time * 1.1 + index * 2.3) * 0.18;
    value = Math.max(value, Math.exp(-(dx * dx + dy * dy)) * pulse);
  });
  const conductor = Math.exp(-Math.pow((x - 1182) / 195, 2) - Math.pow((y - 326) / 150, 2));
  value = Math.max(value, conductor * (0.36 + Math.sin(time * 0.7) * 0.08));
  return clamp(value, 0, 0.94);
}

function updateEnvironment(dt) {
  game.wind = 5.4 + Math.sin(game.time * 0.19 + 0.7) * 3.6 + Math.sin(game.time * 0.57 + 2.1) * 1.25;
  game.turbulence = Math.sin(game.time * 2.2 + 1.5) * 2.4 + Math.sin(game.time * 0.73) * 1.2;
  game.interference = getInterference(game.drone.x, game.drone.y, game.time);
  game.compassDrift = game.interference * (Math.sin(game.time * 1.8) * 15 + Math.sin(game.time * 0.43 + 1.2) * 8);
}

function droneCameraAngle() {
  return Math.atan2(input.pointerY - game.drone.y, input.pointerX - game.drone.x);
}

function updateTrail(dt) {
  game.drone.trail.forEach((point) => {
    point.age += dt;
  });
  game.drone.trail = game.drone.trail.filter((point) => point.age < 12);
  const last = game.drone.trail[game.drone.trail.length - 1];
  if (!last || Math.hypot(last.x - game.drone.x, last.y - game.drone.y) > 13) {
    game.drone.trail.push({ x: game.drone.x, y: game.drone.y, age: 0 });
  }
}

function updateManualFlight(dt) {
  const left = input.keys.has("KeyA") || input.keys.has("ArrowLeft");
  const right = input.keys.has("KeyD") || input.keys.has("ArrowRight");
  const up = input.keys.has("KeyW");
  const down = input.keys.has("KeyS");
  const horizontal = (right ? 1 : 0) - (left ? 1 : 0);
  const vertical = (down ? 1 : 0) - (up ? 1 : 0);
  if (input.keys.has("ArrowUp")) game.throttle = clamp(game.throttle + dt * 38, 0, 100);
  if (input.keys.has("ArrowDown")) game.throttle = clamp(game.throttle - dt * 38, 0, 100);
  const horizontalSpeed = 34 + game.throttle * 1.22;
  const verticalSpeed = 24 + game.throttle * 0.55;
  const beforeX = game.drone.x;
  const beforeY = game.drone.y;

  game.drone.x += horizontal * horizontalSpeed * dt + game.wind * 2.25 * dt;
  game.drone.y += vertical * verticalSpeed * dt + game.turbulence * 0.75 * dt;
  game.drone.x = clamp(game.drone.x, 48, WORLD.width - 48);
  game.drone.y = clamp(game.drone.y, 96, WORLD.ground - 18);

  const moved = Math.hypot(game.drone.x - beforeX, game.drone.y - beforeY) / Math.max(dt, 0.001);
  game.drone.groundSpeed = lerp(game.drone.groundSpeed || 0, moved, 0.18);
  game.drone.speed = Math.round(game.drone.groundSpeed * 0.55);
  if (game.drone.groundSpeed < 20) {
    game.hoverTime += dt;
  } else {
    game.hoverTime = 0;
  }
  game.drone.rotor += dt * (8.2 + game.throttle * 0.08);
}

function moveToward(point, dt, speedLimit = 166) {
  const dx = point.x - game.drone.x;
  const dy = point.y - game.drone.y;
  const dist = Math.hypot(dx, dy);
  const beforeX = game.drone.x;
  const beforeY = game.drone.y;
  if (dist > 1.5) {
    const braking = clamp(dist * 2.2, 15, speedLimit);
    const vx = (dx / dist) * braking - game.wind * 2.25;
    const vy = (dy / dist) * braking - game.turbulence * 0.55;
    game.drone.x += vx * dt;
    game.drone.y += vy * dt;
  }
  game.drone.x = clamp(game.drone.x, 48, WORLD.width - 48);
  game.drone.y = clamp(game.drone.y, 96, WORLD.ground - 18);
  const moved = Math.hypot(game.drone.x - beforeX, game.drone.y - beforeY) / Math.max(dt, 0.001);
  game.drone.groundSpeed = lerp(game.drone.groundSpeed || 0, moved, 0.2);
  game.drone.speed = Math.round(game.drone.groundSpeed * 0.55);
  game.drone.rotor += dt * (9 + Math.min(moved, 150) * 0.06);
  if (game.drone.groundSpeed < 22 && dist < 6) {
    game.hoverTime += dt;
  } else {
    game.hoverTime = 0;
  }
  return dist;
}

function updateDemoFlight(dt) {
  if (game.demoPause > 0) {
    game.demoPause -= dt;
    game.drone.groundSpeed = lerp(game.drone.groundSpeed, 0, 0.2);
    game.drone.speed = Math.round(game.drone.groundSpeed * 0.55);
    game.hoverTime += dt;
    return;
  }

  if (!game.demoReturning) {
    const target = TARGETS[game.demoIndex];
    if (!target) {
      game.demoReturning = true;
      showToast("三处取证完成", "自动返航至 03# 塔基", "success", 3.2);
      return;
    }
    input.pointerX = target.x;
    input.pointerY = target.y;
    const dist = moveToward(STAGING[game.demoIndex], dt);
    if (dist < 5 && game.drone.groundSpeed < 22) {
      game.demoSettle += dt;
      if (game.demoSettle > 0.78) {
        const captured = captureTarget(game.demoIndex, true);
        if (captured) {
          game.demoIndex += 1;
          game.demoSettle = 0;
          game.demoPause = 0.42;
          if (game.demoIndex >= TARGETS.length) {
            game.demoReturning = true;
            game.demoPause = 0.8;
            showToast("三处取证完成", "自动返航至 03# 塔基", "success", 3.2);
          }
        }
      }
    } else {
      game.demoSettle = 0;
    }
    return;
  }

  const remaining = moveToward(HOME, dt, 178);
  if (remaining < 5.5) {
    game.drone.y = Math.min(game.drone.y, HOME.y);
    game.drone.groundSpeed = 0;
    game.drone.speed = 0;
    game.hoverTime += dt;
    if (game.hoverTime > 0.5) completeMission(true);
  }
}

function updateAutoReturn(dt) {
  const remaining = moveToward(HOME, dt, 170);
  if (remaining < 5) {
    game.drone.y = Math.min(game.drone.y, HOME.y);
    game.drone.groundSpeed = 0;
    game.drone.speed = 0;
    game.hoverTime += dt;
    if (game.hoverTime > 0.45) completeMission(true);
  }
}

function captureReadiness(target) {
  if (!target) {
    return { ready: false, quality: 0, reason: "三处目标均已完成", pointerDist: 999, droneDist: 999 };
  }
  const pointerDist = Math.hypot(input.pointerX - target.x, input.pointerY - target.y);
  const droneDist = distance(game.drone, target);
  const quality = clamp(
    100 - Math.max(0, droneDist - 76) * 0.42 - pointerDist * 0.72 - game.drone.groundSpeed * 0.18 - game.interference * 6,
    0,
    100
  );
  let reason = "目标入框 · 可拍摄";
  if (pointerDist > 40) reason = "目标未进入取景框";
  else if (droneDist > 172) reason = "距离过远 · 继续靠近";
  else if (game.drone.groundSpeed > 31) reason = "航速过高 · 降低速度";
  else if (game.hoverTime < 0.38) reason = "保持悬停 · 等待稳定";
  else if (quality < 76) reason = "图像质量不足";
  const ready = pointerDist <= 40 &&
    droneDist <= 172 &&
    game.drone.groundSpeed <= 31 &&
    game.hoverTime >= 0.38 &&
    quality >= 76;
  return { ready, quality: Math.round(quality), reason, pointerDist, droneDist };
}

function captureTarget(index, automatic = false) {
  const target = TARGETS[index];
  if (!target || target.found) return false;
  const active = activeTarget();
  if (!active || active.id !== target.id) {
    if (!automatic) showToast("顺序不符", `请先拍摄 ${active ? active.name : "当前目标"}`, "warning");
    return false;
  }
  if (game.mode !== "flying") return false;
  const readiness = captureReadiness(target);
  if (!readiness.ready) {
    if (!automatic) showToast("无法取证", readiness.reason, "warning");
    return false;
  }
  target.found = true;
  target.quality = readiness.quality;
  game.capturedCount += 1;
  game.flash = 1;
  game.shake = 0.36;
  const row = ui.targetRows[index];
  row.classList.add("done");
  row.classList.remove("active");
  row.querySelector(".target-state").textContent = `合格 ${target.quality}`;
  if (game.capturedCount === 3) {
    showToast("三处取证完成", "返回 03# 塔基 · 按 R 自动返航", "success", 4.2);
    sound.click("success");
  } else {
    showToast(`已取证 · ${target.quality} 分`, `${target.name} / ${target.detail}`, "success");
    sound.click("shutter");
  }
  return true;
}

function capturePhoto() {
  if (game.mode !== "flying") return;
  if (game.demo) return;
  const active = activeTarget();
  if (!active) {
    showToast("取证已完成", "请返回右侧 03# 塔基", "success");
    return;
  }
  const pointed = TARGETS.find((target) => Math.hypot(input.pointerX - target.x, input.pointerY - target.y) <= 48);
  if (!pointed) {
    showToast("未锁定目标", "移动镜头，将疑似故障置于取景框内", "warning");
    return;
  }
  captureTarget(pointed.id, false);
}

function requestAutoReturn() {
  if (game.mode !== "flying" || game.demo) return;
  if (game.capturedCount < 3) {
    showToast("暂不能返航", `还剩 ${3 - game.capturedCount} 处目标未取证`, "warning");
    return;
  }
  if (!game.autoReturn) {
    game.autoReturn = true;
    game.hoverTime = 0;
    showToast("自动返航已接通", "无人机正在返回 03# 塔基", "success", 3.2);
  }
}

function returnReserve() {
  const homeDistance = Math.hypot(game.drone.x - HOME.x, game.drone.y - HOME.y);
  return Math.ceil(16 + homeDistance * 0.016 + (3 - game.capturedCount) * 4);
}

function updateBattery(dt) {
  const hoverUse = game.drone.groundSpeed < 24 ? 0.2 : 0.04;
  const drain = 0.22 + hoverUse + (game.drone.groundSpeed / 100) * 0.11 + game.interference * 0.045;
  game.battery = Math.max(0, game.battery - drain * dt);
  if (game.battery <= 18 && game.battery > 0 && !game.lowBatteryWarned) {
    game.lowBatteryWarned = true;
    showToast("电量低于 18%", "请立即返航", "error", 4);
  }
  if (game.battery <= 0) {
    completeMission(false, "动力电池耗尽，无人机已在峡谷内迫降。");
  }
}

function checkManualReturn() {
  if (game.mode !== "flying" || game.demo || game.capturedCount < 3) return;
  const homeDistance = Math.hypot(game.drone.x - HOME.x, game.drone.y - HOME.y);
  if (homeDistance < 42 && game.drone.y > HOME.y - 34 && game.drone.groundSpeed < 24) {
    completeMission(true);
  }
}

function updateGame(dt) {
  if (game.mode !== "flying") return;
  game.time += dt;
  updateEnvironment(dt);
  if (game.demo) {
    updateDemoFlight(dt);
  } else if (game.autoReturn) {
    updateAutoReturn(dt);
  } else {
    updateManualFlight(dt);
  }
  if (game.mode !== "flying") return;
  game.drone.camera = normalizeAngle(droneCameraAngle());
  game.drone.altitude = Math.max(0, (WORLD.ground - game.drone.y) / 3.65);
  updateTrail(dt);
  updateBattery(dt);
  checkManualReturn();
  game.flash = Math.max(0, game.flash - dt * 4.2);
  game.shake = Math.max(0, game.shake - dt * 3.4);
  if (game.toastTimer > 0) {
    game.toastTimer -= dt;
    if (game.toastTimer <= 0) hideToast();
  }
  updateHud();
}

function updateHud() {
  const active = activeTarget();
  const windText = Math.abs(game.wind).toFixed(1);
  ui.windValue.textContent = `${windText} m/s`;
  ui.windNeedle.style.left = `${clamp(((game.wind + 10) / 30) * 100, 3, 97)}%`;
  ui.windCaption.textContent = `阵风 ${windText} m/s · ${game.wind >= 0 ? "向东" : "向西"}`;
  const interferencePercent = Math.round(game.interference * 100);
  ui.interferenceValue.textContent = interferencePercent > 55
    ? `强干扰 ${interferencePercent}%`
    : interferencePercent > 24 ? `中等 ${interferencePercent}%` : `低干扰 ${interferencePercent}%`;
  const drift = Math.round(game.compassDrift);
  ui.compassWarning.textContent = Math.abs(drift) > 3
    ? `磁偏 ${drift > 0 ? "+" : ""}${drift}° · 航向会漂移`
    : "磁场稳定";
  ui.compassWarning.className = Math.abs(drift) > 3 ? "compass-warning" : "";
  ui.speedValue.textContent = Math.round(game.drone.groundSpeed * 0.52);
  ui.altitudeValue.textContent = Math.round(game.drone.altitude);
  ui.cameraValue.textContent = String(Math.round(game.drone.camera * 180 / Math.PI) % 360).padStart(3, "0");
  ui.missionClock.textContent = `T+ ${formatClock(game.time)}`;
  ui.batteryValue.textContent = `${Math.round(game.battery)}%`;
  ui.batteryFill.style.width = `${game.battery}%`;
  ui.batteryFill.style.background = game.battery < 22 ? PALETTE.danger : game.battery < 42 ? PALETTE.amber : PALETTE.mint;
  const reserve = returnReserve();
  ui.returnReserve.textContent = `${reserve}%`;
  ui.returnReserve.style.color = game.battery < reserve ? PALETTE.danger : "";

  let mode = "MANUAL";
  let phase = "巡检中";
  if (game.demo) {
    mode = game.demoReturning ? "DEMO RTB" : "DEMO";
    phase = game.demoReturning ? "示范返航" : `示范取证 ${game.demoIndex + 1}/3`;
  } else if (game.autoReturn) {
    mode = "RTB";
    phase = "自动返航";
  } else if (game.capturedCount === 3) {
    mode = "RTB";
    phase = "等待返航";
  } else if (game.drone.y > HOME.y - 10 && game.time < 2) {
    phase = "塔基起飞";
  }
  ui.flightMode.textContent = mode;
  ui.missionPhase.textContent = phase;

  if (active) {
    ui.targetRows[active.id].classList.add("active");
  }
  ui.targetRows.forEach((row, index) => {
    if (TARGETS[index].found) return;
    row.classList.toggle("active", active ? active.id === index : false);
  });

  const readiness = captureReadiness(active);
  ui.captureStatus.textContent = active ? readiness.reason : "取证完成 · 返航塔基";
  ui.captureButton.disabled = !active || game.demo;
  ui.captureButton.classList.toggle("ready", Boolean(active) && readiness.ready && !game.demo);
  ui.hintText.textContent = active
    ? `镜头对准 ${active.name} · 保持悬停`
    : "返回 03# 塔基 · 按 R 自动返航";
  ui.reticleHint.classList.toggle("visible", game.mode === "flying" && !game.demo);
}

function drawCompass() {
  const c = compassCtx;
  const width = compassCanvas.width;
  const height = compassCanvas.height;
  c.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height * 0.58;
  const radius = width * 0.36;
  const drift = game.compassDrift * Math.PI / 180;
  c.save();
  c.translate(cx, cy);
  c.strokeStyle = "rgba(177, 207, 193, 0.18)";
  c.lineWidth = 1;
  c.beginPath();
  c.arc(0, 0, radius, Math.PI * 1.06, Math.PI * 1.94);
  c.stroke();
  for (let index = 0; index <= 20; index += 1) {
    const angle = Math.PI * 1.06 + (Math.PI * 0.88 * index) / 20;
    const length = index % 5 === 0 ? 8 : 4;
    c.beginPath();
    c.moveTo(Math.cos(angle) * (radius - length), Math.sin(angle) * (radius - length));
    c.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    c.strokeStyle = index % 5 === 0 ? "rgba(218, 234, 225, 0.44)" : "rgba(177, 207, 193, 0.23)";
    c.stroke();
  }
  c.fillStyle = "rgba(187, 211, 199, 0.68)";
  c.font = "10px 'DIN Condensed', sans-serif";
  c.textAlign = "center";
  c.fillText("N", 0, -radius + 19);
  c.fillText("E", radius - 9, 3);
  c.fillText("S", 0, radius + 5);
  c.fillText("W", -radius + 9, 3);
  c.rotate(drift);
  c.shadowBlur = 10;
  c.shadowColor = game.interference > 0.35 ? PALETTE.amber : PALETTE.mint;
  c.fillStyle = game.interference > 0.35 ? PALETTE.amber : PALETTE.mint;
  c.beginPath();
  c.moveTo(0, -radius + 5);
  c.lineTo(5, 2);
  c.lineTo(1, 2);
  c.lineTo(1, radius - 28);
  c.lineTo(-1, radius - 28);
  c.lineTo(-1, 2);
  c.lineTo(-5, 2);
  c.closePath();
  c.fill();
  c.restore();
  c.fillStyle = "rgba(117, 142, 133, 0.8)";
  c.font = "9px sans-serif";
  c.textAlign = "center";
  c.fillText(`航向 ${String(Math.round(((game.drone.camera * 180 / Math.PI) + 360) % 360)).padStart(3, "0")}°`, cx, height - 5);
  if (game.interference > 0.28) {
    c.strokeStyle = `rgba(230, 180, 95, ${0.12 + game.interference * 0.25})`;
    for (let index = 0; index < 4; index += 1) {
      const y = 12 + index * 19;
      c.beginPath();
      c.moveTo(9, y);
      c.lineTo(width - 9, y + (Math.sin(game.time * 19 + index) > 0 ? 2 : -2));
      c.stroke();
    }
  }
}

function ridgePath(points) {
  ctx.beginPath();
  ctx.moveTo(-40, WORLD.height);
  ctx.lineTo(-40, points[0][1]);
  points.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(WORLD.width + 40, points[points.length - 1][1]);
  ctx.lineTo(WORLD.width + 40, WORLD.height);
  ctx.closePath();
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, 610);
  sky.addColorStop(0, "#031015");
  sky.addColorStop(0.48, "#0b282d");
  sky.addColorStop(0.82, "#466058");
  sky.addColorStop(1, "#a66c4b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  const glow = ctx.createRadialGradient(380, 562, 10, 380, 562, 430);
  glow.addColorStop(0, "rgba(224, 142, 78, 0.31)");
  glow.addColorStop(0.38, "rgba(211, 130, 74, 0.13)");
  glow.addColorStop(1, "rgba(211, 130, 74, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 160, 900, 520);

  stars.forEach((star) => {
    const alpha = star.a * (0.82 + Math.sin(game.time * 0.35 + star.phase) * 0.18);
    ctx.fillStyle = `rgba(220, 236, 229, ${alpha})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = "#d9d2bc";
  ctx.beginPath();
  ctx.arc(1228, 158, 35, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = "#06151b";
  ctx.beginPath();
  ctx.arc(1213, 150, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(7, 21, 24, 0.78)";
  ridgePath([[0, 511], [118, 460], [220, 486], [335, 420], [460, 482], [580, 439], [700, 490], [820, 430], [952, 477], [1082, 404], [1214, 470], [1340, 427], [1478, 462], [1600, 421]]);
  ctx.fill();

  ctx.fillStyle = "rgba(6, 23, 25, 0.91)";
  ridgePath([[0, 574], [98, 533], [225, 561], [370, 501], [498, 548], [632, 487], [750, 532], [865, 491], [1018, 543], [1174, 480], [1320, 535], [1452, 503], [1600, 545]]);
  ctx.fill();

  ctx.fillStyle = "#071c1e";
  ridgePath([[0, 625], [137, 586], [286, 607], [431, 558], [589, 608], [735, 573], [845, 613], [1027, 566], [1160, 609], [1308, 563], [1467, 615], [1600, 588]]);
  ctx.fill();

  const ground = ctx.createLinearGradient(0, 578, 0, 780);
  ground.addColorStop(0, "rgba(8, 26, 27, 0.25)");
  ground.addColorStop(0.46, "#0a1b1b");
  ground.addColorStop(1, "#071111");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 606, WORLD.width, 294);

  fogBands.forEach((band) => {
    const drift = (game.time * band.speed + band.x) % (WORLD.width + 600) - 300;
    const fog = ctx.createRadialGradient(drift, band.y, 0, drift, band.y, band.width);
    fog.addColorStop(0, `rgba(171, 186, 168, ${band.alpha})`);
    fog.addColorStop(0.55, `rgba(142, 163, 151, ${band.alpha * 0.45})`);
    fog.addColorStop(1, "rgba(140, 160, 150, 0)");
    ctx.fillStyle = fog;
    ctx.fillRect(drift - band.width, band.y - 58, band.width * 2, 116);
  });

  distantLights.forEach((light) => {
    ctx.fillStyle = `rgba(238, 179, 104, ${0.26 + Math.sin(game.time * 0.9 + light.x) * 0.08})`;
    ctx.fillRect(light.x, light.y, light.size, 1);
  });
}

function crossarmY(tower) {
  return tower.base - tower.height + 43;
}

function drawTower(tower) {
  const topY = tower.base - tower.height;
  const armY = crossarmY(tower);
  const lowerArmY = armY + 74;
  const bottomHalf = 75;
  const topHalf = 15;
  const legColor = "rgba(99, 125, 116, 0.9)";
  const braceColor = "rgba(105, 133, 124, 0.48)";
  const highlight = "rgba(181, 204, 190, 0.35)";
  ctx.save();
  ctx.lineCap = "round";

  ctx.fillStyle = "rgba(4, 12, 12, 0.5)";
  ctx.beginPath();
  ctx.ellipse(tower.x + 18, tower.base + 7, 105, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = legColor;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(tower.x - topHalf, topY);
  ctx.lineTo(tower.x - bottomHalf, tower.base);
  ctx.moveTo(tower.x + topHalf, topY);
  ctx.lineTo(tower.x + bottomHalf, tower.base);
  ctx.stroke();

  ctx.strokeStyle = braceColor;
  ctx.lineWidth = 1;
  const sections = 13;
  for (let index = 0; index <= sections; index += 1) {
    const t = index / sections;
    const y = lerp(topY, tower.base, t);
    const half = lerp(topHalf, bottomHalf, t);
    ctx.beginPath();
    ctx.moveTo(tower.x - half, y);
    ctx.lineTo(tower.x + half, y);
    ctx.stroke();
    if (index < sections) {
      const nextT = (index + 1) / sections;
      const nextHalf = lerp(topHalf, bottomHalf, nextT);
      const nextY = lerp(topY, tower.base, nextT);
      ctx.beginPath();
      if (index % 2 === 0) {
        ctx.moveTo(tower.x - half, y);
        ctx.lineTo(tower.x + nextHalf, nextY);
        ctx.moveTo(tower.x + half, y);
        ctx.lineTo(tower.x - nextHalf, nextY);
      } else {
        ctx.moveTo(tower.x, y);
        ctx.lineTo(tower.x, nextY);
      }
      ctx.stroke();
    }
  }

  ctx.strokeStyle = highlight;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(tower.x - topHalf, topY + 2);
  ctx.lineTo(tower.x - bottomHalf, tower.base - 2);
  ctx.stroke();

  const drawArm = (armCenterY, halfSpan, depth) => {
    ctx.strokeStyle = legColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tower.x - halfSpan, armCenterY);
    ctx.lineTo(tower.x + halfSpan, armCenterY);
    ctx.stroke();
    ctx.strokeStyle = braceColor;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(tower.x - topHalf, topY + 12);
    ctx.lineTo(tower.x - halfSpan, armCenterY);
    ctx.moveTo(tower.x + topHalf, topY + 12);
    ctx.lineTo(tower.x + halfSpan, armCenterY);
    for (let index = 0; index < 4; index += 1) {
      const startX = lerp(tower.x - halfSpan, tower.x + halfSpan, index / 4);
      const endX = lerp(tower.x - halfSpan, tower.x + halfSpan, (index + 1) / 4);
      ctx.moveTo(startX, armCenterY);
      ctx.lineTo((startX + endX) / 2, armCenterY + depth);
      ctx.lineTo(endX, armCenterY);
    }
    ctx.stroke();
  };
  drawArm(armY, 145, 19);
  drawArm(lowerArmY, 112, 14);

  const drawInsulator = (x, y, length) => {
    ctx.strokeStyle = "rgba(152, 170, 160, 0.54)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + length);
    ctx.stroke();
    for (let index = 1; index <= 5; index += 1) {
      ctx.fillStyle = "rgba(128, 151, 142, 0.5)";
      ctx.beginPath();
      ctx.ellipse(x, y + (length * index) / 5, 3.4, 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  drawInsulator(tower.x - 145, armY, 51);
  drawInsulator(tower.x + 145, armY, 51);
  drawInsulator(tower.x - 96, lowerArmY, 34);

  ctx.fillStyle = "rgba(180, 201, 188, 0.62)";
  ctx.font = "9px 'DIN Condensed', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(tower.label, tower.x, tower.base + 21);

  const beacon = 0.5 + Math.sin(game.time * 2.4 + tower.x) * 0.5;
  ctx.fillStyle = `rgba(255, 99, 70, ${0.34 + beacon * 0.5})`;
  ctx.beginPath();
  ctx.arc(tower.x, topY - 3, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 10;
  ctx.shadowColor = "rgba(255, 84, 58, 0.8)";
  ctx.beginPath();
  ctx.arc(tower.x, topY - 3, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function conductorPoint(x1, y1, x2, y2, sag, t) {
  const base = lerp(y1, y2, t);
  return { x: lerp(x1, x2, t), y: base + Math.sin(Math.PI * t) * sag };
}

function drawSpan(x1, y1, x2, y2, sag, highlight = false) {
  ctx.beginPath();
  for (let index = 0; index <= 28; index += 1) {
    const t = index / 28;
    const point = conductorPoint(x1, y1, x2, y2, sag, t);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.strokeStyle = highlight ? "rgba(181, 200, 188, 0.78)" : "rgba(135, 159, 147, 0.62)";
  ctx.lineWidth = highlight ? 1.4 : 1;
  ctx.stroke();
  if (highlight) {
    ctx.save();
    ctx.shadowBlur = 7;
    ctx.shadowColor = "rgba(198, 217, 202, 0.3)";
    ctx.stroke();
    ctx.restore();
  }
}

function drawTransmissionLine() {
  for (let index = 0; index < TOWERS.length - 1; index += 1) {
    const left = TOWERS[index];
    const right = TOWERS[index + 1];
    const leftArm = crossarmY(left);
    const rightArm = crossarmY(right);
    const sag = 58 + index * 4;
    drawSpan(left.x - 145, leftArm, right.x - 145, rightArm, sag);
    drawSpan(left.x, leftArm + 28, right.x, rightArm + 28, sag + 12);
    drawSpan(left.x + 145, leftArm, right.x + 145, rightArm, sag, index === 1);
    drawSpan(left.x - 112, leftArm + 74, right.x - 112, rightArm + 74, sag + 8);
    drawSpan(left.x + 96, leftArm + 74, right.x + 96, rightArm + 74, sag + 8);
  }
}

function drawPlannedRoute() {
  if (game.mode === "intro") return;
  const points = [
    HOME,
    { x: 1118, y: 268 },
    { x: 1075, y: 318 },
    { x: 415, y: 321 },
    HOME
  ];
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 11]);
  ctx.strokeStyle = "rgba(230, 180, 95, 0.24)";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midX = (previous.x + current.x) / 2;
    ctx.bezierCurveTo(midX, previous.y - 18, midX, current.y - 18, current.x, current.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  TARGETS.forEach((target, index) => {
    const x = target.x;
    const y = target.y - 45;
    ctx.strokeStyle = target.found ? "rgba(119, 227, 193, 0.45)" : "rgba(230, 180, 95, 0.48)";
    ctx.fillStyle = "rgba(5, 17, 18, 0.72)";
    ctx.beginPath();
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + 7, y);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x - 7, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = target.found ? PALETTE.mint : PALETTE.amber;
    ctx.font = "7px 'DIN Condensed', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(index + 1).padStart(2, "0"), x, y + 2.5);
  });
  ctx.restore();
}

function drawFlightTrail() {
  if (game.drone.trail.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let index = 1; index < game.drone.trail.length; index += 1) {
    const previous = game.drone.trail[index - 1];
    const current = game.drone.trail[index];
    const alpha = clamp(1 - current.age / 12, 0, 1) * 0.42;
    ctx.strokeStyle = `rgba(119, 227, 193, ${alpha})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWind() {
  ctx.save();
  ctx.lineWidth = 0.8;
  windSeeds.forEach((seed) => {
    const speedScale = 18 + Math.abs(game.wind) * 4.2;
    const x = ((seed.x + game.time * speedScale * seed.speed) % (WORLD.width + 100)) - 50;
    const y = seed.y + Math.sin(game.time * 0.7 + seed.x) * 7;
    const length = seed.length * (0.6 + Math.abs(game.wind) / 16);
    ctx.strokeStyle = `rgba(194, 220, 207, ${seed.alpha * (0.45 + Math.abs(game.wind) / 18)})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length * Math.sign(game.wind || 1), y - 1);
    ctx.stroke();
  });
  ctx.restore();
}

function drawTargets() {
  const active = activeTarget();
  TARGETS.forEach((target) => {
    const isActive = active && active.id === target.id;
    const color = target.found ? PALETTE.mint : isActive ? PALETTE.amber : "rgba(255, 145, 81, 0.75)";
    const pulse = 0.5 + Math.sin(game.time * 2.1 + target.id * 2.2) * 0.5;
    ctx.save();
    if (isActive) {
      ctx.shadowBlur = 18 + pulse * 12;
      ctx.shadowColor = target.found ? PALETTE.mint : "rgba(255, 145, 81, 0.7)";
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = isActive ? 1.3 : 0.8;
    ctx.beginPath();
    ctx.arc(target.x, target.y, (target.found ? 20 : 11) + pulse * 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 4 + pulse * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (target.found) {
      ctx.save();
      ctx.strokeStyle = PALETTE.mint;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(target.x - 4, target.y);
      ctx.lineTo(target.x - 1, target.y + 4);
      ctx.lineTo(target.x + 6, target.y - 5);
      ctx.stroke();
      ctx.restore();
    }

    if (isActive || target.found) {
      const labelX = target.x + (target.id === 2 ? 18 : 24);
      const labelY = target.y - (target.id === 2 ? 64 : 82);
      ctx.save();
      ctx.strokeStyle = target.found ? "rgba(119, 227, 193, 0.3)" : "rgba(230, 180, 95, 0.4)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(target.x + 12, target.y - 10);
      ctx.lineTo(labelX - 7, labelY + 9);
      ctx.lineTo(labelX + 149, labelY + 9);
      ctx.stroke();
      ctx.fillStyle = "rgba(5, 17, 18, 0.82)";
      ctx.fillRect(labelX - 4, labelY - 13, 158, 24);
      ctx.fillStyle = target.found ? PALETTE.mint : PALETTE.amber;
      ctx.font = "7px 'DIN Condensed', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`T-${String(target.id + 1).padStart(2, "0")} / ${target.found ? "QUALIFIED" : "SUSPECT"}`, labelX + 1, labelY - 3);
      ctx.fillStyle = "rgba(219, 231, 224, 0.82)";
      ctx.font = "9px 'Noto Sans SC', sans-serif";
      ctx.fillText(target.name, labelX + 1, labelY + 7);
      ctx.restore();
    }
  });
}

function drawInterference() {
  if (game.interference < 0.16) return;
  ctx.save();
  const source = TOWERS[1];
  const sourceY = crossarmY(source) + 70;
  ctx.globalCompositeOperation = "screen";
  for (let index = 0; index < 4; index += 1) {
    const radius = 28 + ((game.time * 18 + index * 44) % 150);
    const alpha = (1 - radius / 190) * game.interference * 0.25;
    ctx.strokeStyle = `rgba(230, 180, 95, ${alpha})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(source.x, sourceY, radius, -0.8 + index, 2.9 + index);
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(255, 145, 81, ${game.interference * 0.16})`;
  for (let index = 0; index < 5; index += 1) {
    const y = 188 + index * 47 + Math.sin(game.time * 10 + index) * 4;
    ctx.beginPath();
    ctx.moveTo(905, y);
    ctx.lineTo(1120 + game.interference * 80, y + 1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDrone() {
  const { x, y } = game.drone;
  const angle = game.drone.camera;
  const glow = game.interference > 0.4 ? PALETTE.amber : PALETTE.mint;
  ctx.save();
  ctx.translate(x, y);

  ctx.strokeStyle = "rgba(119, 227, 193, 0.14)";
  ctx.lineWidth = 0.7;
  ctx.setLineDash([3, 7]);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(angle) * 68, Math.sin(angle) * 68);
  ctx.stroke();
  ctx.setLineDash([]);

  const rotorPositions = [
    [-25, -10], [25, -10], [-25, 10], [25, 10]
  ];
  rotorPositions.forEach(([rx, ry], index) => {
    ctx.save();
    ctx.translate(rx, ry);
    ctx.strokeStyle = "rgba(137, 158, 150, 0.65)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(index < 2 ? 5 : -5, index % 2 === 0 ? 6 : -6);
    ctx.stroke();
    ctx.rotate(game.drone.rotor * (index % 2 === 0 ? 1 : -1));
    ctx.fillStyle = "rgba(188, 219, 205, 0.12)";
    ctx.strokeStyle = "rgba(197, 225, 211, 0.3)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 4.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(15, 0);
    ctx.stroke();
    ctx.restore();
  });

  ctx.fillStyle = "rgba(7, 19, 20, 0.92)";
  ctx.strokeStyle = "rgba(185, 211, 198, 0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-12, -8);
  ctx.lineTo(10, -8);
  ctx.lineTo(16, 0);
  ctx.lineTo(10, 8);
  ctx.lineTo(-12, 8);
  ctx.lineTo(-17, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(-2, 1, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 10;
  ctx.shadowColor = glow;
  ctx.beginPath();
  ctx.arc(-2, 1, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  ctx.rotate(angle);
  ctx.fillStyle = "#263c39";
  ctx.fillRect(7, -3, 7, 6);
  ctx.fillStyle = "rgba(196, 223, 209, 0.8)";
  ctx.beginPath();
  ctx.arc(14, 0, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(255, 80, 56, 0.9)";
  ctx.beginPath();
  ctx.arc(-10, -8, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(119, 227, 193, 0.85)";
  ctx.beginPath();
  ctx.arc(10, 8, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDroneTelemetry() {
  const x = game.drone.x;
  const y = game.drone.y;
  const side = x > WORLD.width - 260 ? -1 : 1;
  const labelX = x + side * 52;
  const labelY = y - 58;
  const batteryWidth = 34;
  const chargeWidth = batteryWidth * (game.battery / 100);
  ctx.save();
  ctx.strokeStyle = "rgba(198, 220, 208, 0.24)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x + side * 16, y - 9);
  ctx.lineTo(labelX - side * 8, labelY + 14);
  ctx.lineTo(labelX + side * 104, labelY + 14);
  ctx.stroke();
  ctx.textAlign = side > 0 ? "left" : "right";
  const textX = labelX;
  ctx.fillStyle = "rgba(225, 237, 230, 0.86)";
  ctx.font = "7px 'DIN Condensed', sans-serif";
  ctx.fillText(game.demo ? "AUTO / UAV-03" : "UAV-03 / LIVE", textX, labelY - 5);
  ctx.strokeStyle = game.battery < 22 ? PALETTE.danger : "rgba(188, 214, 202, 0.46)";
  ctx.strokeRect(textX, labelY + 1, batteryWidth, 7);
  ctx.fillStyle = game.battery < 22 ? PALETTE.danger : game.battery < 42 ? PALETTE.amber : PALETTE.mint;
  ctx.fillRect(textX + 1, labelY + 2, Math.max(0, chargeWidth - 2), 5);
  ctx.fillStyle = "rgba(225, 237, 230, 0.86)";
  ctx.fillText(`${Math.round(game.battery)}%`, textX + batteryWidth + 6, labelY + 7);
  ctx.fillStyle = "rgba(134, 158, 148, 0.82)";
  ctx.fillText(`${Math.round(game.drone.groundSpeed * 0.52)} KM/H  ·  ${Math.round(game.drone.altitude)} M`, textX, labelY + 22);
  ctx.restore();
}

function drawViewfinder() {
  if (game.mode !== "flying" || !input.pointerActive) return;
  const active = activeTarget();
  const pointed = TARGETS.find((target) => Math.hypot(input.pointerX - target.x, input.pointerY - target.y) < 55);
  const focusTarget = pointed || active;
  const readiness = captureReadiness(focusTarget);
  const jitter = game.interference > 0.28 ? game.interference : 0;
  const jx = Math.sin(game.time * 37) * jitter * 3;
  const jy = Math.cos(game.time * 29) * jitter * 2;
  const x = input.pointerX + jx;
  const y = input.pointerY + jy;
  const width = 112;
  const height = 78;
  const left = x - width / 2;
  const right = x + width / 2;
  const top = y - height / 2;
  const bottom = y + height / 2;
  const color = pointed && readiness.ready
    ? PALETTE.mint
    : pointed && active && pointed.id !== active.id ? PALETTE.danger : PALETTE.amber;
  const corner = 16;

  ctx.save();
  ctx.strokeStyle = "rgba(207, 226, 216, 0.13)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(game.drone.x, game.drone.y);
  ctx.lineTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.lineTo(right, top);
  ctx.lineTo(right, bottom);
  ctx.lineTo(game.drone.x, game.drone.y);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.shadowBlur = pointed ? 9 : 0;
  ctx.shadowColor = color;
  const brackets = [
    [left, top, 1, 1], [right, top, -1, 1], [left, bottom, 1, -1], [right, bottom, -1, -1]
  ];
  brackets.forEach(([bx, by, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(bx, by + sy * corner);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + sx * corner, by);
    ctx.stroke();
  });
  ctx.shadowBlur = 0;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x - 8, y);
  ctx.lineTo(x - 2, y);
  ctx.moveTo(x + 2, y);
  ctx.lineTo(x + 8, y);
  ctx.moveTo(x, y - 7);
  ctx.lineTo(x, y - 2);
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x, y + 7);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 1.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "7px 'DIN Condensed', sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(211, 229, 219, 0.68)";
  ctx.fillText("AF / CONT", left, top - 10);
  ctx.fillText("1/125  F2.8  ISO400", left, bottom + 14);
  ctx.textAlign = "right";
  ctx.fillStyle = color;
  if (pointed) {
    const quality = focusTarget.found ? Math.round(focusTarget.quality) : readiness.quality;
    ctx.fillText(pointed.found ? `ARCHIVED ${quality}` : `Q ${quality}`, right, top - 10);
    ctx.fillStyle = readiness.ready ? PALETTE.mint : "rgba(230, 180, 95, 0.75)";
    ctx.fillText(readiness.ready ? "FOCUS LOCK" : readiness.reason, right, bottom + 14);
  } else {
    ctx.fillText(active ? `SEEK T-${String(active.id + 1).padStart(2, "0")}` : "RTB / HOME", right, top - 10);
  }

  if (game.interference > 0.4) {
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = PALETTE.orange;
    for (let index = 0; index < 6; index += 1) {
      const lineY = top + 8 + index * 11;
      ctx.beginPath();
      ctx.moveTo(left, lineY);
      ctx.lineTo(left + 18 + index * 5, lineY);
      ctx.moveTo(right - 14 - index * 3, lineY + 3);
      ctx.lineTo(right, lineY + 3);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawScreenEffects() {
  if (game.interference > 0.34 && game.mode === "flying") {
    const intensity = game.interference;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = `rgba(255, 145, 81, ${0.014 + intensity * 0.018})`;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    for (let index = 0; index < 7; index += 1) {
      const y = ((game.time * 217 + index * 133) % WORLD.height + WORLD.height) % WORLD.height;
      const drift = Math.sin(game.time * 15 + index) * 32 * intensity;
      ctx.fillStyle = `rgba(119, 227, 193, ${0.02 + intensity * 0.025})`;
      ctx.fillRect(0, y, WORLD.width, 1 + index % 3);
      ctx.fillStyle = `rgba(255, 122, 83, ${0.035 + intensity * 0.03})`;
      ctx.fillRect(0, y + 3, WORLD.width, 1);
      ctx.fillStyle = "rgba(4, 12, 13, 0.3)";
      ctx.fillRect(780 + drift, y - 8, 440, 16);
    }
    ctx.restore();
  }
  if (game.flash > 0) {
    const amount = ease(game.flash);
    ctx.save();
    ctx.fillStyle = `rgba(235, 245, 235, ${amount * 0.24})`;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    ctx.strokeStyle = `rgba(240, 248, 239, ${amount * 0.7})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(800, 430, 160 + (1 - game.flash) * 260, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function render() {
  const pixelScale = view.scale * view.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#031012";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(pixelScale, 0, 0, pixelScale, view.offsetX * view.dpr, view.offsetY * view.dpr);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, WORLD.width, WORLD.height);
  ctx.clip();
  const shakeAmount = game.shake * 5 + game.interference * (game.mode === "flying" ? 1.2 : 0);
  ctx.translate(Math.sin(game.time * 73) * shakeAmount, Math.cos(game.time * 61) * shakeAmount * 0.6);
  drawBackground();
  drawPlannedRoute();
  TOWERS.forEach(drawTower);
  drawTransmissionLine();
  drawInterference();
  drawWind();
  drawFlightTrail();
  drawTargets();
  if (game.mode !== "intro") {
    drawDrone();
    drawDroneTelemetry();
    drawViewfinder();
  }
  drawScreenEffects();
  ctx.restore();
  drawCompass();
}

function toggleSound() {
  game.sound = !game.sound;
  ui.soundButton.classList.toggle("muted", !game.sound);
  ui.soundLabel.textContent = game.sound ? "声音 开" : "声音 关";
  sound.setEnabled(game.sound);
  if (game.sound) sound.init();
}

function toggleHelp(force) {
  const shouldShow = typeof force === "boolean" ? force : ui.helpModal.hidden;
  ui.helpModal.hidden = !shouldShow;
}

function handleKeyDown(event) {
  const movementKeys = ["KeyA", "KeyD", "KeyW", "KeyS", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  if (movementKeys.includes(event.code)) {
    event.preventDefault();
    input.keys.add(event.code);
  }
  if (event.code === "Space") {
    event.preventDefault();
    if (!event.repeat) capturePhoto();
  }
  if (event.code === "KeyR" && !event.repeat) requestAutoReturn();
  if (event.code === "KeyM" && !event.repeat) toggleSound();
  if (event.code === "KeyH" && !event.repeat) toggleHelp();
  if (event.code === "Escape" && !ui.helpModal.hidden) toggleHelp(false);
  if (event.code === "Enter" && game.mode === "intro" && !event.repeat) {
    sound.init();
    startMission();
  }
}

function handleKeyUp(event) {
  input.keys.delete(event.code);
}

function bindEvents() {
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  canvas.addEventListener("pointermove", (event) => {
    setPointer(event.clientX, event.clientY);
  });
  canvas.addEventListener("pointerdown", (event) => {
    setPointer(event.clientX, event.clientY);
    sound.init();
  });
  ui.startButton.addEventListener("click", () => {
    sound.init();
    startMission();
  });
  ui.demoButton.addEventListener("click", () => {
    sound.init();
    startDemo();
  });
  ui.captureButton.addEventListener("click", capturePhoto);
  ui.soundButton.addEventListener("click", toggleSound);
  ui.helpButton.addEventListener("click", () => toggleHelp());
  ui.closeHelp.addEventListener("click", () => toggleHelp(false));
  ui.helpModal.addEventListener("click", (event) => {
    if (event.target === ui.helpModal) toggleHelp(false);
  });
  ui.againButton.addEventListener("click", restartFromIntro);
  ui.finishButton.addEventListener("click", () => {
    ui.resultScreen.hidden = true;
    game.mode = "view";
    showToast("巡检记录已归档", "峡谷线 03# · 三处目标全部合格", "success", 4.5);
  });
}

function getPublicState() {
  return {
    mode: game.mode,
    demo: game.demo,
    time: Number(game.time.toFixed(2)),
    battery: Number(game.battery.toFixed(2)),
    wind: Number(game.wind.toFixed(2)),
    interference: Number(game.interference.toFixed(3)),
    compassDrift: Number(game.compassDrift.toFixed(2)),
    captured: TARGETS.filter((target) => target.found).length,
    targets: TARGETS.map((target) => ({
      id: target.id,
      found: target.found,
      quality: target.quality
    })),
    drone: {
      x: Number(game.drone.x.toFixed(2)),
      y: Number(game.drone.y.toFixed(2)),
      speed: Number(game.drone.groundSpeed.toFixed(2))
    },
    result: game.result ? { ...game.result } : null
  };
}

function simulate(seconds = 60, step = 1 / 60) {
  if (game.mode === "intro") startDemo();
  let remaining = Math.max(0, seconds);
  while (remaining > 0 && game.mode === "flying") {
    const dt = Math.min(step, remaining);
    updateGame(dt);
    remaining -= dt;
  }
  updateHud();
  return getPublicState();
}

let lastFrame = performance.now();
function animate(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  if (game.mode === "flying") {
    updateGame(dt);
  } else {
    game.time += dt;
    updateEnvironment(dt);
    if (game.mode === "intro") updateHud();
  }
  sound.update(game.drone.groundSpeed || 0, game.interference, game.mode === "flying");
  render();
  requestAnimationFrame(animate);
}

window.__inspection = {
  startMission,
  startDemo,
  capturePhoto,
  requestAutoReturn,
  simulate,
  getState: getPublicState,
  reset: restartFromIntro,
  game,
  targets: TARGETS
};

bindEvents();
resizeCanvas();
updateEnvironment(0);
updateHud();
requestAnimationFrame(animate);
