(() => {
  "use strict";

  const TARGETS = [150, 300, 450];
  const SAMPLE_TOLERANCE = 18;
  const MAX_DEPTH = 580;
  const MAX_RATE = 34;
  const TENSION_BREAK = 100;
  const TENSION_WARN = 82;
  const SLACK_LIMIT = 75;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const moveToward = (value, target, step) => {
    if (value < target) return Math.min(value + step, target);
    return Math.max(value - step, target);
  };
  const padDepth = (value) => value.toFixed(1).padStart(5, "0");
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const canvas = $("#scene");
  const ctx = canvas.getContext("2d");

  const ui = {
    depth: $("#depthValue"),
    elapsed: $("#elapsed"),
    tension: $("#tensionValue"),
    tensionFill: $("#tensionFill"),
    integrity: $("#integrity"),
    slackState: $("#slackState"),
    slackFill: $("#slackFill"),
    lineSpeed: $("#lineSpeed"),
    basketSpeed: $("#basketSpeed"),
    wallDistance: $("#wallDistance"),
    sway: $("#swayValue"),
    winchSpeed: $("#winchSpeed"),
    speedDirection: $("#speedDirection"),
    speedFill: $("#speedFill"),
    sampleCount: $("#sampleCount"),
    sampleHint: $("#sampleHint"),
    sampleFill: $("#sampleFill"),
    tone: $("#toneReadout"),
    toast: $("#toast"),
    start: $("#startScreen"),
    result: $("#resultScreen"),
    resultCard: $("#resultScreen .result-card"),
    resultEyebrow: $("#resultEyebrow"),
    resultTitle: $("#resultTitle"),
    resultCopy: $("#resultCopy"),
    resultSamples: $("#resultSamples"),
    resultTension: $("#resultTension"),
    resultTime: $("#resultTime"),
    targetCards: $$(".target"),
    vials: $$(".vial"),
    haulButton: $("#haulButton"),
    soundToggle: $("#soundToggle"),
    volume: $("#volume"),
  };

  const state = {
    phase: "ready",
    started: false,
    resultOpen: false,
    elapsed: 0,
    depth: 0,
    velocity: 0,
    winchTarget: 0,
    lineSpeed: 0,
    brake: false,
    weight: 0,
    sway: 0.04,
    swayVelocity: 0,
    tension: 42,
    slack: 0,
    peakTension: 42,
    samples: [false, false, false],
    sampleZone: -1,
    sampleProgress: 0,
    sampleFlash: 0,
    breakTimer: 0,
    failTimer: 0,
    failReason: "",
    cableSnapped: false,
    sceneTime: 0,
    cameraShake: 0,
    toastTimer: 0,
    lastWarning: "",
    toneFrequency: 295,
    audioReady: false,
    audioMuted: false,
    volume: 0.42,
    timeScale: 1,
    samplesAtFailure: 0,
  };

  const input = {
    speedUp: false,
    speedDown: false,
    brake: false,
    weightLeft: false,
    weightRight: false,
  };

  let lastFrame = performance.now();
  let hudFrame = 0;
  let toastTimeout = 0;

  function resetState() {
    Object.assign(state, {
      phase: "ready",
      started: false,
      resultOpen: false,
      elapsed: 0,
      depth: 0,
      velocity: 0,
      winchTarget: 0,
      lineSpeed: 0,
      brake: false,
      weight: 0,
      sway: 0.04,
      swayVelocity: 0,
      tension: 42,
      slack: 0,
      peakTension: 42,
      samples: [false, false, false],
      sampleZone: -1,
      sampleProgress: 0,
      sampleFlash: 0,
      breakTimer: 0,
      failTimer: 0,
      failReason: "",
      cableSnapped: false,
      cameraShake: 0,
      lastWarning: "",
      samplesAtFailure: 0,
    });
    Object.keys(input).forEach((key) => { input[key] = false; });
    ui.start.classList.remove("hidden");
    ui.result.className = "result-screen";
    ui.result.setAttribute("aria-hidden", "true");
    ui.targetCards.forEach((card) => card.className = "target");
    ui.vials.forEach((vial) => vial.classList.remove("filled"));
    ui.haulButton.classList.remove("active");
    updateHUD(true);
  }

  function startGame() {
    if (state.started) return;
    state.started = true;
    state.phase = "running";
    ui.start.classList.add("hidden");
    initAudio();
    showToast("绞车解锁 · 三个层位等待取样", false);
  }

  function adjustWinch(delta) {
    if (!state.started || state.phase !== "running") return;
    state.winchTarget = clamp(state.winchTarget + delta, -MAX_RATE, MAX_RATE);
  }

  function toggleHaul() {
    if (!state.started || state.phase !== "running") return;
    if (!state.samples.every(Boolean)) {
      const remaining = state.samples.filter((sample) => !sample).length;
      showToast(`还有 ${remaining} 个层位未封存，无法回收`, true);
      return;
    }
    if (state.winchTarget > -12) {
      state.winchTarget = -30;
      state.brake = false;
      input.brake = false;
      showToast("绞车换向 · 开始回收", false);
      ui.haulButton.classList.add("active");
    } else {
      state.winchTarget = 0;
      ui.haulButton.classList.remove("active");
      showToast("回收暂停", false);
    }
  }

  function showToast(message, danger = false) {
    ui.toast.textContent = message;
    ui.toast.classList.toggle("danger", danger);
    ui.toast.classList.add("show");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => ui.toast.classList.remove("show"), 2600);
  }

  function setControl(action, active) {
    if (action === "brake") {
      input.brake = active;
      state.brake = active;
      if (active && state.started && state.phase === "running" && Math.abs(state.velocity) > 20) {
        showToast("制动负荷过高 · 观察张力", true);
      }
      return;
    }
    if (!(action in input)) return;
    input[action] = active;
  }

  const keyMap = {
    ArrowUp: "speedUp",
    KeyW: "speedUp",
    ArrowDown: "speedDown",
    KeyS: "speedDown",
    ArrowLeft: "weightLeft",
    KeyA: "weightLeft",
    ArrowRight: "weightRight",
    KeyD: "weightRight",
    Space: "brake",
  };

  window.addEventListener("keydown", (event) => {
    if (keyMap[event.code]) {
      event.preventDefault();
      if (!state.started) startGame();
      setControl(keyMap[event.code], true);
      const control = document.querySelector(`[data-action="${keyMap[event.code]}"]`);
      if (control) control.classList.add("active");
    }
    if (event.code === "Enter") {
      if (!state.started) startGame();
      else if (!state.resultOpen && (state.phase === "success" || state.phase === "failed")) {
        resetState();
        startGame();
      }
    }
    if (event.code === "KeyR" && !event.repeat) toggleHaul();
  });

  window.addEventListener("keyup", (event) => {
    if (keyMap[event.code]) {
      event.preventDefault();
      setControl(keyMap[event.code], false);
      const control = document.querySelector(`[data-action="${keyMap[event.code]}"]`);
      if (control) control.classList.remove("active");
    }
  });

  $$("[data-action]").forEach((button) => {
    const action = button.dataset.action;
    if (action === "haul") {
      button.addEventListener("click", toggleHaul);
      return;
    }
    const start = (event) => {
      event.preventDefault();
      if (!state.started) startGame();
      const wasActive = input[action];
      setControl(action, true);
      button.classList.add("active");
      if (!wasActive) {
        const impulse = { speedUp: 1.6, speedDown: -1.6, weightLeft: -0.08, weightRight: 0.08 }[action];
        if (impulse && action.startsWith("speed")) adjustWinch(impulse);
        if (impulse && action.startsWith("weight")) state.weight = clamp(state.weight + impulse, -1, 1);
      }
    };
    const end = () => {
      setControl(action, false);
      button.classList.remove("active");
    };
    button.addEventListener("pointerdown", start);
    button.addEventListener("pointerup", end);
    button.addEventListener("pointerleave", end);
    button.addEventListener("pointercancel", end);
  });

  $("#startButton").addEventListener("click", startGame);
  $("#retryButton").addEventListener("click", () => {
    resetState();
    startGame();
  });
  $("#inspectButton").addEventListener("click", () => {
    ui.result.classList.remove("visible");
    ui.result.classList.add("hidden");
    state.resultOpen = false;
    showToast("结果已收起 · 按 Enter 再次下潜", false);
  });

  function initAudio() {
    if (state.audioReady) {
      if (audio.context?.state === "suspended") audio.context.resume();
      return;
    }
    try {
      audio.init();
      state.audioReady = true;
    } catch (error) {
      console.warn("Web Audio unavailable:", error);
    }
  }

  function update(dt) {
    const running = state.phase === "running";

    if (running) {
      state.elapsed += dt;
      if (input.speedUp) adjustWinch(-15 * dt);
      if (input.speedDown) adjustWinch(15 * dt);
      if (input.weightLeft) state.weight = clamp(state.weight - 0.72 * dt, -1, 1);
      if (input.weightRight) state.weight = clamp(state.weight + 0.72 * dt, -1, 1);

      const brakeTarget = state.brake ? 0 : state.winchTarget;
      state.lineSpeed = moveToward(
        state.lineSpeed,
        brakeTarget,
        (state.brake ? 92 : 20) * dt
      );

      const targetVelocity = clamp(state.lineSpeed, -31, MAX_RATE);
      const accel = Math.abs(targetVelocity) < Math.abs(state.velocity) ? 9.5 : 7.2;
      state.velocity = moveToward(state.velocity, targetVelocity, accel * dt);
    } else if (state.phase === "failed" && state.cableSnapped) {
      state.velocity = Math.min(state.velocity + 11 * dt, 46);
    } else if (state.phase === "failed") {
      state.velocity = moveToward(state.velocity, 0, 14 * dt);
    }

    if (running) {
      const nextDepth = state.depth + state.velocity * dt;
      if (nextDepth >= MAX_DEPTH) {
        state.depth = MAX_DEPTH;
        state.velocity = Math.min(state.velocity, 0);
        state.winchTarget = Math.min(state.winchTarget, 0);
        if (state.lastWarning !== "floor") {
          showToast("已到海底安全限位 · 绞车停止下放", true);
          state.lastWarning = "floor";
        }
      } else if (nextDepth <= 0) {
        state.depth = 0;
        state.velocity = Math.max(state.velocity, 0);
        if (state.samples.every(Boolean)) finishSuccess();
      } else {
        state.depth = nextDepth;
        if (state.lastWarning === "floor" && state.depth < MAX_DEPTH - 12) {
          state.lastWarning = "";
        }
      }
    } else if (state.phase === "failed" && state.cableSnapped) {
      state.depth = Math.min(state.depth + state.velocity * dt, MAX_DEPTH + 45);
    }

    updateSway(dt);
    updateLoad(dt);
    if (running) {
      updateSampling(dt);
      checkFailure(dt);
    } else if (state.phase === "failed" || state.phase === "success") {
      state.failTimer += dt;
      if (state.phase === "failed" && !state.resultOpen && state.failTimer > 1.3) {
        openResult(false);
      }
      if (state.phase === "success" && !state.resultOpen && state.failTimer > 0.9) {
        openResult(true);
      }
    }

    state.sampleFlash = Math.max(0, state.sampleFlash - dt * 1.6);
    state.cameraShake = Math.max(0, state.cameraShake - dt * 1.8);
    audio.update();
  }

  function updateSway(dt) {
    const depthRatio = clamp(state.depth / MAX_DEPTH, 0, 1);
    const current = 0.76
      + 0.36 * depthRatio
      + 0.28 * Math.sin(state.sceneTime * 0.43 + state.depth * 0.012)
      + 0.14 * Math.sin(state.sceneTime * 0.17 + 1.7);
    const drag = current * 0.064;
    const ballast = state.weight * 0.105;
    const wallLimit = 0.49;
    const acceleration = drag + ballast - state.sway * 0.22 - state.swayVelocity * 0.42;

    state.swayVelocity += acceleration * dt;
    state.sway += state.swayVelocity * dt;

    if (state.sway > wallLimit) {
      state.sway = wallLimit;
      if (state.swayVelocity > 1.2) state.cameraShake = Math.max(state.cameraShake, 0.55);
      state.swayVelocity *= -0.16;
    }
    if (state.sway < -0.63) {
      state.sway = -0.63;
      state.swayVelocity *= -0.16;
    }
    if (!state.started) {
      state.sway = 0.04 + Math.sin(state.sceneTime * 0.55) * 0.012;
      state.swayVelocity = 0;
    }
  }

  function updateLoad(dt) {
    const speed = Math.abs(state.velocity);
    const descentMismatch = state.lineSpeed >= 0
      ? Math.max(0, state.velocity - state.lineSpeed)
      : 0;
    const haulMismatch = state.lineSpeed < 0
      ? Math.max(0, Math.abs(state.lineSpeed) - Math.abs(state.velocity)) * 0.45
      : 0;
    const driveMismatch = descentMismatch + haulMismatch;
    const haulLoad = state.lineSpeed < 0 ? Math.abs(state.lineSpeed) * 0.52 : 0;
    const brakeLoad = state.brake ? speed * 0.92 : 0;
    const wallLoad = Math.max(0, state.sway - 0.44) * 310;
    const pulse = Math.sin(state.sceneTime * 2.1) * 1.4;
    const deadWeight = state.phase === "failed" ? 0 : 1;
    const target = 36
      + speed * 0.86
      + driveMismatch * 2.05
      + haulLoad
      + brakeLoad
      + wallLoad
      + pulse;

    state.tension += (target - state.tension) * Math.min(1, dt * 7.5);
    if (state.phase === "failed") state.tension *= Math.max(0, 1 - dt * 2.2);
    state.tension = clamp(state.tension, 0, 128);
    state.peakTension = Math.max(state.peakTension, state.tension * deadWeight);

    if (state.phase !== "running") {
      state.slack = moveToward(state.slack, 0, dt * 3);
      return;
    }

    const payoutExcess = Math.max(0, state.lineSpeed - state.velocity - 2.5);
    if (payoutExcess > 0.5 && state.depth > 8) {
      state.slack += payoutExcess * dt * 3.2;
    } else {
      state.slack = Math.max(0, state.slack - dt * 7);
    }
    state.slack = clamp(state.slack, 0, SLACK_LIMIT);
  }

  function updateSampling(dt) {
    let zone = -1;
    for (let index = 0; index < TARGETS.length; index += 1) {
      if (!state.samples[index] && Math.abs(state.depth - TARGETS[index]) <= SAMPLE_TOLERANCE) {
        zone = index;
        break;
      }
    }

    if (zone !== state.sampleZone) {
      if (zone >= 0) showToast(`进入 ${TARGETS[zone]} m 采样层 · 稳定悬停`, false);
      state.sampleZone = zone;
      state.sampleProgress = 0;
    }

    const stable = zone >= 0 && Math.abs(state.velocity) < 9.2 && state.tension < TENSION_WARN;
    if (stable) {
      state.sampleProgress = Math.min(1, state.sampleProgress + dt / 1.35);
      if (state.sampleProgress >= 1) {
        state.samples[zone] = true;
        state.sampleFlash = 1;
        state.sampleProgress = 0;
        state.sampleZone = -1;
        ui.vials[zone].classList.add("filled");
        showToast(`样品 ${String(zone + 1).padStart(2, "0")} 已封存 · ${TARGETS[zone]} m`, false);
        if (state.samples.every(Boolean)) {
          showToast("三点取样完成 · 按 R 或点击“回收”", false);
          ui.haulButton.classList.add("active");
        }
      }
    } else if (zone >= 0) {
      state.sampleProgress = Math.max(0, state.sampleProgress - dt * 0.58);
    }

    const missed = TARGETS.findIndex((depth, index) =>
      !state.samples[index] && state.depth > depth + SAMPLE_TOLERANCE + 5
    );
    if (missed >= 0 && state.lastWarning !== `miss-${missed}`) {
      state.lastWarning = `miss-${missed}`;
      showToast(`错过 ${TARGETS[missed]} m 层位 · 可收缆返回重试`, true);
    }
  }

  function checkFailure(dt) {
    if (state.tension >= TENSION_BREAK) state.breakTimer += dt;
    else state.breakTimer = Math.max(0, state.breakTimer - dt * 2);

    if (state.breakTimer > 0.12) {
      failMission("snap");
      return;
    }
    if (state.slack >= SLACK_LIMIT - 0.1) {
      failMission("tangle");
    }
  }

  function failMission(reason) {
    if (state.phase !== "running") return;
    state.phase = "failed";
    state.samplesAtFailure = state.samples.filter(Boolean).length;
    state.resultOpen = false;
    state.failTimer = 0;
    state.failReason = reason;
    state.cableSnapped = reason === "snap";
    state.cameraShake = 1;
    state.winchTarget = 0;
    state.brake = false;
    state.samplesAtFailure = state.samples.filter(Boolean).length;
    Object.keys(input).forEach((key) => { input[key] = false; });
    if (reason === "snap") {
      state.velocity = Math.max(state.velocity, 18);
      showToast("张力过载 · 缆绳断裂", true);
    } else {
      state.velocity = 0;
      showToast("持续松弛 · 缆绳缠结", true);
    }
  }

  function finishSuccess() {
    if (state.phase !== "running" || !state.samples.every(Boolean)) return;
    state.phase = "success";
    state.failTimer = 0;
    state.resultOpen = false;
    state.winchTarget = 0;
    state.lineSpeed = 0;
    state.velocity = 0;
    Object.keys(input).forEach((key) => { input[key] = false; });
    showToast("采样篮出水 · 三点样品回收完成", false);
  }

  function openResult(success) {
    state.resultOpen = true;
    ui.result.className = `result-screen visible ${success ? "success" : "failure"}`;
    ui.result.setAttribute("aria-hidden", "false");
    ui.resultTension.textContent = `${state.peakTension.toFixed(1)} kN`;
    ui.resultTime.textContent = formatTime(state.elapsed);
    if (success) {
      ui.resultEyebrow.textContent = "任务完成 · 样品封存";
      ui.resultTitle.textContent = "样品已回收";
      ui.resultCopy.textContent = `采样篮在三处热液层位完成悬停取样，并以 ${state.peakTension.toFixed(1)} kN 的峰值张力安全出水。缆绳结构无损，样品链完整。`;
      ui.resultSamples.textContent = "3 / 3";
    } else if (state.failReason === "snap") {
      ui.resultEyebrow.textContent = "任务中断 · 结构失效";
      ui.resultTitle.textContent = "缆绳断裂";
      ui.resultCopy.textContent = "制动施加过晚：篮体仍带着高速下坠动量，绞车滚筒已停止放缆，冲击载荷超过 100 kN 断裂阈值。应在到达层位前提前减速。";
      ui.resultSamples.textContent = `${state.samplesAtFailure} / 3`;
    } else {
      ui.resultEyebrow.textContent = "任务中断 · 线缆故障";
      ui.resultTitle.textContent = "缆绳缠结";
      ui.resultCopy.textContent = "放缆速度长期高于篮体实际下落速度，松弛在缆绳中段累积并形成扭结。绞车已紧急停止。";
      ui.resultSamples.textContent = `${state.samplesAtFailure} / 3`;
    }
  }
  const motes = Array.from({ length: 105 }, (_, index) => ({
    x: pseudoRandom(index * 3.7 + 2.1),
    y: pseudoRandom(index * 7.2 + 8.4),
    size: 0.35 + pseudoRandom(index * 11.3) * 1.65,
    drift: 5 + pseudoRandom(index * 5.8) * 17,
    phase: pseudoRandom(index * 2.3) * Math.PI * 2,
  }));

  const currentStreaks = Array.from({ length: 34 }, (_, index) => ({
    x: pseudoRandom(index * 8.13 + 3.2),
    y: 0.16 + pseudoRandom(index * 6.41 + 1.7) * 0.79,
    length: 18 + pseudoRandom(index * 2.76) * 76,
    speed: 0.025 + pseudoRandom(index * 4.31) * 0.055,
    alpha: 0.05 + pseudoRandom(index * 9.2) * 0.16,
  }));

  function pseudoRandom(seed) {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function depthToY(depth, height) {
    return 160 + (clamp(depth, 0, MAX_DEPTH) / MAX_DEPTH) * (height - 230);
  }

  function render() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    ctx.clearRect(0, 0, width, height);

    drawOcean(width, height);
    drawLightShafts(width, height);
    drawMotes(width, height);
    drawRockWall(width, height);
    drawDepthMarkers(width, height);
    drawCurrent(width, height);
    drawSeabed(width, height);

    const shake = state.cameraShake;
    const shakeX = shake ? Math.sin(state.sceneTime * 91) * 7 * shake : 0;
    const shakeY = shake ? Math.cos(state.sceneTime * 73) * 4 * shake : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawShipAndWinch(width, height);
    drawCable(width, height);
    drawBasket(width, height);
    ctx.restore();

    drawForeground(width, height);
  }

  function drawOcean(width, height) {
    const water = ctx.createLinearGradient(0, 72, 0, height);
    water.addColorStop(0, "#0a3544");
    water.addColorStop(0.16, "#082634");
    water.addColorStop(0.45, "#051722");
    water.addColorStop(0.78, "#020b12");
    water.addColorStop(1, "#010508");
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, width, height);

    const bloom = ctx.createRadialGradient(width * 0.35, 105, 5, width * 0.35, 105, height * 0.58);
    bloom.addColorStop(0, "rgba(92, 205, 202, 0.13)");
    bloom.addColorStop(0.38, "rgba(35, 100, 111, 0.05)");
    bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 70, width, height);

    const surface = ctx.createLinearGradient(0, 92, 0, 154);
    surface.addColorStop(0, "rgba(139, 227, 219, 0.26)");
    surface.addColorStop(0.28, "rgba(64, 154, 162, 0.1)");
    surface.addColorStop(1, "rgba(0, 24, 35, 0)");
    ctx.fillStyle = surface;
    ctx.fillRect(0, 92, width, 68);

    ctx.strokeStyle = "rgba(137, 225, 219, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 10) {
      const y = 102
        + Math.sin(x * 0.017 + state.sceneTime * 1.2) * 2.7
        + Math.sin(x * 0.043 - state.sceneTime * 0.65) * 1.3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(202, 248, 238, 0.16)";
    ctx.beginPath();
    for (let x = 0; x <= width; x += 14) {
      const y = 106 + Math.sin(x * 0.012 - state.sceneTime * 0.9) * 4;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawLightShafts(width, height) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let index = 0; index < 5; index += 1) {
      const originX = width * (0.13 + index * 0.13);
      const sway = Math.sin(state.sceneTime * 0.16 + index * 1.8) * 22;
      const shaft = ctx.createLinearGradient(originX, 100, originX + sway, height * 0.66);
      shaft.addColorStop(0, `rgba(94, 204, 203, ${0.035 - index * 0.002})`);
      shaft.addColorStop(1, "rgba(94, 204, 203, 0)");
      ctx.fillStyle = shaft;
      ctx.beginPath();
      ctx.moveTo(originX - 15, 98);
      ctx.lineTo(originX + 23, 98);
      ctx.lineTo(originX + 128 + sway, height * 0.68);
      ctx.lineTo(originX - 85 + sway, height * 0.68);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMotes(width, height) {
    const span = height - 120;
    for (const mote of motes) {
      const y = 110 + ((mote.y * span + state.sceneTime * mote.drift) % span);
      const x = mote.x * width + Math.sin(state.sceneTime * 0.28 + mote.phase) * 9;
      const alpha = 0.16 + Math.sin(state.sceneTime * 0.7 + mote.phase) * 0.07;
      ctx.fillStyle = `rgba(178, 232, 226, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, mote.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawDepthMarkers(width, height) {
    const anchorX = width * 0.42;
    const wallX = width * 0.735;
    TARGETS.forEach((depth, index) => {
      const y = depthToY(depth, height);
      const complete = state.samples[index];
      const active = state.sampleZone === index;
      const color = complete ? "100, 211, 154" : active ? "243, 191, 114" : "105, 160, 166";
      const alpha = complete ? 0.25 : active ? 0.36 : 0.12;
      ctx.save();
      ctx.setLineDash([3, 9]);
      ctx.strokeStyle = `rgba(${color}, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(anchorX - 92, y);
      ctx.lineTo(wallX - 10, y);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = `rgba(${color}, ${active || complete ? 0.82 : 0.38})`;
      ctx.font = "9px Consolas, monospace";
      ctx.letterSpacing = "1px";
      ctx.fillText(complete ? "✓" : active ? "◉" : "○", anchorX - 84, y - 8);
      ctx.fillText(`SAMPLE ${String(index + 1).padStart(2, "0")}`, anchorX - 63, y - 8);
      ctx.fillStyle = `rgba(${color}, ${active || complete ? 0.48 : 0.2})`;
      ctx.fillText(`${depth} M`, anchorX - 63, y + 15);

      if (active) {
        const pulse = 0.55 + Math.sin(state.sceneTime * 3.2) * 0.25;
        ctx.fillStyle = `rgba(243, 191, 114, ${pulse})`;
        ctx.fillRect(wallX - 16, y - 34, 2, 68);
      }
    });
  }

  function drawCurrent(width, height) {
    ctx.save();
    ctx.lineCap = "round";
    for (const streak of currentStreaks) {
      const travel = (streak.x + state.sceneTime * streak.speed) % 1.15;
      const x = -120 + travel * (width + 230);
      const y = 112 + streak.y * (height - 160)
        + Math.sin(state.sceneTime * 0.7 + streak.x * 9) * 11;
      const gradient = ctx.createLinearGradient(x, y, x + streak.length, y + 4);
      gradient.addColorStop(0, "rgba(125, 218, 210, 0)");
      gradient.addColorStop(0.7, `rgba(125, 218, 210, ${streak.alpha})`);
      gradient.addColorStop(1, "rgba(125, 218, 210, 0)");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        x + streak.length * 0.45,
        y - 3,
        x + streak.length,
        y + 4
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRockWall(width, height) {
    const wallX = width * 0.735;
    const path = new Path2D();
    path.moveTo(wallX - 10, 80);
    for (let y = 80; y <= height + 30; y += 26) {
      const ledge = Math.sin(y * 0.023 + 2.4) * 18 + Math.sin(y * 0.067) * 6;
      const notch = y > height * 0.48 && y < height * 0.58 ? -18 : 0;
      path.lineTo(wallX + ledge + notch - 12, y);
    }
    path.lineTo(width + 20, height + 20);
    path.lineTo(width + 20, 60);
    path.closePath();

    const rock = ctx.createLinearGradient(wallX - 30, 100, width, height);
    rock.addColorStop(0, "#172b30");
    rock.addColorStop(0.24, "#102126");
    rock.addColorStop(0.7, "#081419");
    rock.addColorStop(1, "#03090c");
    ctx.fillStyle = rock;
    ctx.fill(path);

    const rim = ctx.createLinearGradient(wallX - 10, 0, wallX + 80, 0);
    rim.addColorStop(0, "rgba(111, 159, 157, 0.2)");
    rim.addColorStop(0.35, "rgba(65, 109, 110, 0.04)");
    rim.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = rim;

    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = "rgba(122, 168, 166, 0.17)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 11; index += 1) {
      const startY = 120 + index * (height - 140) / 10;
      const startX = wallX + 5 + pseudoRandom(index * 2.17) * 22;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(
        startX + 38 + pseudoRandom(index * 4.1) * 40,
        startY + 18,
        startX + 69,
        startY + 52,
        startX + 48 + pseudoRandom(index * 3.7) * 100,
        startY + 94 + pseudoRandom(index * 5.8) * 60
      );
      ctx.stroke();
    }

    for (let index = 0; index < 28; index += 1) {
      const x = wallX + 8 + pseudoRandom(index * 8.3) * Math.max(30, width - wallX);
      const y = 108 + pseudoRandom(index * 6.7 + 3) * (height - 150);
      const radius = 1.5 + pseudoRandom(index * 2.9) * 5;
      ctx.fillStyle = `rgba(108, 146, 146, ${0.035 + pseudoRandom(index) * 0.06})`;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 2.4, radius, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const ventGlow = ctx.createRadialGradient(
      wallX + 58,
      height * 0.78,
      2,
      wallX + 58,
      height * 0.78,
      125
    );
    ventGlow.addColorStop(0, "rgba(240, 148, 92, 0.17)");
    ventGlow.addColorStop(0.4, "rgba(167, 91, 63, 0.07)");
    ventGlow.addColorStop(1, "rgba(70, 35, 28, 0)");
    ctx.fillStyle = ventGlow;
    ctx.fillRect(wallX, height * 0.57, 240, height * 0.38);
  }

  function drawSeabed(width, height) {
    const floorY = height - 37;
    const ground = ctx.createLinearGradient(0, floorY - 40, 0, height);
    ground.addColorStop(0, "rgba(15, 31, 34, 0.25)");
    ground.addColorStop(0.35, "#0b1b1e");
    ground.addColorStop(1, "#03090b");
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.moveTo(0, floorY + 8);
    for (let x = 0; x <= width; x += 42) {
      const bump = Math.sin(x * 0.015 + 1.2) * 8 + Math.sin(x * 0.043) * 4;
      ctx.lineTo(x, floorY + bump);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fill();

    ctx.save();
    ctx.strokeStyle = "rgba(123, 173, 163, 0.18)";
    ctx.lineWidth = 1;
    const ventX = width * 0.735 + 44;
    ctx.beginPath();
    ctx.moveTo(ventX, floorY + 12);
    ctx.bezierCurveTo(ventX - 13, floorY - 18, ventX + 14, floorY - 55, ventX + 2, floorY - 85);
    ctx.stroke();

    for (let index = 0; index < 4; index += 1) {
      const plumeY = floorY - 18 - index * 21 - (state.sceneTime * 12 + index * 9) % 24;
      const plumeX = ventX + Math.sin(state.sceneTime * 0.8 + index) * (5 + index * 3);
      ctx.fillStyle = `rgba(213, 145, 101, ${0.055 - index * 0.008})`;
      ctx.beginPath();
      ctx.ellipse(plumeX, plumeY, 7 + index * 3, 17, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawShipAndWinch(width, height) {
    const hullLeft = width * 0.065;
    const hullRight = width * 0.655;
    const deckY = 76;
    const anchorX = width * 0.42;

    const hull = ctx.createLinearGradient(0, deckY, 0, 112);
    hull.addColorStop(0, "#20424b");
    hull.addColorStop(0.35, "#162f37");
    hull.addColorStop(1, "#08161c");
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(hullLeft, deckY);
    ctx.lineTo(hullRight, deckY);
    ctx.lineTo(hullRight - 17, 108);
    ctx.lineTo(hullLeft + 34, 108);
    ctx.lineTo(hullLeft + 10, 94);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(113, 179, 181, 0.26)";
    ctx.fillRect(hullLeft, deckY, hullRight - hullLeft, 2);
    ctx.fillStyle = "rgba(2, 7, 9, 0.55)";
    ctx.fillRect(hullLeft + 16, 96, hullRight - hullLeft - 35, 2);

    ctx.fillStyle = "#102932";
    ctx.beginPath();
    ctx.moveTo(width * 0.112, deckY);
    ctx.lineTo(width * 0.122, 48);
    ctx.lineTo(width * 0.214, 48);
    ctx.lineTo(width * 0.229, deckY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(122, 214, 207, 0.24)";
    ctx.fillRect(width * 0.136, 55, width * 0.063, 5);
    ctx.fillRect(width * 0.143, 64, 10, 2);

    ctx.strokeStyle = "#2a4d55";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(width * 0.314, deckY);
    ctx.lineTo(width * 0.348, 42);
    ctx.lineTo(anchorX - 18, 42);
    ctx.stroke();

    ctx.strokeStyle = "rgba(99, 151, 157, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width * 0.326, deckY);
    ctx.lineTo(width * 0.365, 54);
    ctx.lineTo(width * 0.405, 58);
    ctx.stroke();

    drawWinchDrum(width * 0.365, 61, 18);
    drawSheave(anchorX, 86, 9);

    ctx.fillStyle = "rgba(3, 10, 13, 0.7)";
    ctx.fillRect(width * 0.068, 66, 34, 8);
    ctx.fillStyle = "rgba(161, 205, 201, 0.55)";
    ctx.font = "8px Consolas, monospace";
    ctx.fillText("R/V", width * 0.076, 72);

    const glow = ctx.createRadialGradient(anchorX, 86, 1, anchorX, 86, 30);
    glow.addColorStop(0, "rgba(147, 236, 221, 0.18)");
    glow.addColorStop(1, "rgba(147, 236, 221, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(anchorX - 30, 56, 60, 60);
  }

  function drawWinchDrum(x, y, radius) {
    const rotation = state.elapsed * state.lineSpeed * 0.34;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillStyle = "#36545a";
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#162e35";
    ctx.beginPath();
    ctx.arc(0, 0, radius - 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#658e91";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 9, 0, Math.PI * 2);
    ctx.stroke();
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 4, Math.sin(angle) * 4);
      ctx.lineTo(Math.cos(angle) * (radius - 7), Math.sin(angle) * (radius - 7));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSheave(x, y, radius) {
    ctx.fillStyle = "#29474f";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#78a3a3";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#0b1c21";
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function basketPosition(width, height) {
    return {
      x: width * 0.42 + state.sway * width * 0.53,
      y: depthToY(state.depth, height),
    };
  }

  function cubicPoint(p0, p1, p2, p3, t) {
    const inverse = 1 - t;
    return {
      x: inverse ** 3 * p0.x
        + 3 * inverse ** 2 * t * p1.x
        + 3 * inverse * t ** 2 * p2.x
        + t ** 3 * p3.x,
      y: inverse ** 3 * p0.y
        + 3 * inverse ** 2 * t * p1.y
        + 3 * inverse * t ** 2 * p2.y
        + t ** 3 * p3.y,
    };
  }

  function drawCable(width, height) {
    const anchor = { x: width * 0.42, y: 95 };
    const basket = basketPosition(width, height);
    const bridle = { x: basket.x, y: basket.y - 30 };
    const length = Math.max(1, bridle.y - anchor.y);
    const tension = state.tension;
    const cableColor = tension > TENSION_WARN
      ? "240, 111, 99"
      : tension > 65
        ? "243, 191, 114"
        : "171, 222, 211";

    if (state.cableSnapped) {
      const breakPoint = {
        x: anchor.x + (bridle.x - anchor.x) * 0.27,
        y: anchor.y + length * 0.32,
      };
      const c1 = {
        x: anchor.x + (breakPoint.x - anchor.x) * 0.34 + Math.sin(state.sceneTime * 2.1) * 5,
        y: anchor.y + length * 0.1,
      };
      drawCableStroke(anchor, c1, breakPoint, breakPoint, cableColor, 1);

      const tail = {
        x: breakPoint.x + Math.sin(state.sceneTime * 2.6) * 18,
        y: breakPoint.y + 50 + Math.sin(state.sceneTime * 1.7) * 9,
      };
      drawCableStroke(
        breakPoint,
        { x: breakPoint.x - 15, y: breakPoint.y + 18 },
        tail,
        tail,
        cableColor,
        0.58
      );

      ctx.strokeStyle = "rgba(240, 111, 99, 0.85)";
      ctx.lineWidth = 2;
      for (let index = 0; index < 8; index += 1) {
        const angle = index / 8 * Math.PI * 2 + state.sceneTime * 1.4;
        const radius = 7 + (state.sceneTime * 26 + index * 4) % 23;
        ctx.beginPath();
        ctx.moveTo(breakPoint.x, breakPoint.y);
        ctx.lineTo(
          breakPoint.x + Math.cos(angle) * radius,
          breakPoint.y + Math.sin(angle) * radius
        );
        ctx.stroke();
      }

      ctx.strokeStyle = `rgba(${cableColor}, 0.5)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(basket.x, basket.y - 30);
      ctx.bezierCurveTo(
        basket.x + 18,
        basket.y - 56,
        basket.x - 22,
        basket.y - 74,
        basket.x + Math.sin(state.sceneTime * 2.2) * 26,
        basket.y - 91
      );
      ctx.stroke();
      return;
    }

    const p1 = {
      x: anchor.x + 12 + Math.sin(state.sceneTime * 0.9) * 4,
      y: anchor.y + length * 0.3,
    };
    const p2 = {
      x: bridle.x - 30 + Math.sin(state.sceneTime * 1.15) * 8,
      y: anchor.y + length * 0.68,
    };
    const slackWiggle = clamp(state.slack * 0.16, 0, 16);

    const glow = ctx.createLinearGradient(anchor.x, anchor.y, bridle.x, bridle.y);
    glow.addColorStop(0, `rgba(${cableColor}, 0.12)`);
    glow.addColorStop(0.5, `rgba(${cableColor}, 0.34)`);
    glow.addColorStop(1, `rgba(${cableColor}, 0.16)`);
    ctx.strokeStyle = glow;
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let index = 0; index <= 42; index += 1) {
      const t = index / 42;
      const point = cubicPoint(anchor, p1, p2, bridle, t);
      const wiggle = Math.sin(t * Math.PI * 3.5 + state.sceneTime * 1.8)
        * slackWiggle * Math.sin(t * Math.PI);
      if (index === 0) ctx.moveTo(point.x + wiggle, point.y);
      else ctx.lineTo(point.x + wiggle, point.y);
    }
    ctx.stroke();

    drawCableStroke(anchor, p1, p2, bridle, cableColor, 1, slackWiggle);

    if (tension > TENSION_WARN || state.phase === "failed") {
      const flash = 0.3 + Math.sin(state.sceneTime * 20) * 0.16;
      ctx.strokeStyle = `rgba(240, 111, 99, ${flash})`;
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (let index = 0; index <= 18; index += 1) {
        const t = 0.66 + index / 18 * 0.34;
        const point = cubicPoint(anchor, p1, p2, bridle, t);
        const wiggle = Math.sin(t * Math.PI * 3.5 + state.sceneTime * 1.8)
          * slackWiggle * Math.sin(t * Math.PI);
        if (index === 0) ctx.moveTo(point.x + wiggle, point.y);
        else ctx.lineTo(point.x + wiggle, point.y);
      }
      ctx.stroke();
    }

    if (state.started && state.phase === "running") {
      for (let index = 0; index < 3; index += 1) {
        const t = (state.sceneTime * 0.32 + index / 3) % 1;
        const point = cubicPoint(anchor, p1, p2, bridle, t);
        const alpha = Math.sin(t * Math.PI) * 0.5 * clamp(tension / 80, 0, 1);
        ctx.fillStyle = `rgba(${cableColor}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawCableStroke(p0, p1, p2, p3, color, alpha, wiggle = 0) {
    ctx.strokeStyle = `rgba(0, 4, 6, ${0.55 * alpha})`;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    for (let index = 0; index <= 36; index += 1) {
      const t = index / 36;
      const point = cubicPoint(p0, p1, p2, p3, t);
      const offset = wiggle
        ? Math.sin(t * Math.PI * 3.5 + state.sceneTime * 1.8) * wiggle * Math.sin(t * Math.PI)
        : 0;
      if (index === 0) ctx.moveTo(point.x + offset, point.y);
      else ctx.lineTo(point.x + offset, point.y);
    }
    ctx.stroke();

    ctx.strokeStyle = `rgba(${color}, ${0.82 * alpha})`;
    ctx.lineWidth = 1.7;
    ctx.stroke();

    ctx.strokeStyle = `rgba(231, 250, 244, ${0.4 * alpha})`;
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    for (let index = 0; index <= 36; index += 1) {
      const t = index / 36;
      const point = cubicPoint(p0, p1, p2, p3, t);
      const offset = wiggle
        ? Math.sin(t * Math.PI * 3.5 + state.sceneTime * 1.8) * wiggle * Math.sin(t * Math.PI)
        : 0;
      if (index === 0) ctx.moveTo(point.x + offset - 0.6, point.y);
      else ctx.lineTo(point.x + offset - 0.6, point.y);
    }
    ctx.stroke();
  }

  function drawBasket(width, height) {
    const basket = basketPosition(width, height);
    const swayAngle = state.sway * 0.42 + Math.sin(state.sceneTime * 1.1) * 0.022;

    if (state.phase !== "failed" || !state.cableSnapped) {
      ctx.strokeStyle = "rgba(175, 220, 211, 0.45)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(basket.x - 17, basket.y - 29);
      ctx.lineTo(basket.x - 5, basket.y - 7);
      ctx.moveTo(basket.x + 17, basket.y - 29);
      ctx.lineTo(basket.x + 5, basket.y - 7);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(basket.x, basket.y - 10);
    ctx.rotate(swayAngle);

    const light = ctx.createLinearGradient(0, 22, 0, 145);
    light.addColorStop(0, "rgba(150, 232, 220, 0.075)");
    light.addColorStop(1, "rgba(150, 232, 220, 0)");
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(-17, 18);
    ctx.lineTo(17, 18);
    ctx.lineTo(80, 155);
    ctx.lineTo(-80, 155);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(3, 10, 13, 0.72)";
    ctx.beginPath();
    ctx.ellipse(0, 42, 35, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#5f8787";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-28, -22);
    ctx.lineTo(-25, 24);
    ctx.lineTo(-20, 31);
    ctx.lineTo(20, 31);
    ctx.lineTo(25, 24);
    ctx.lineTo(28, -22);
    ctx.stroke();

    ctx.fillStyle = "rgba(18, 48, 55, 0.62)";
    ctx.beginPath();
    ctx.moveTo(-25, -15);
    ctx.lineTo(25, -15);
    ctx.lineTo(21, 28);
    ctx.lineTo(-21, 28);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(140, 191, 184, 0.42)";
    ctx.lineWidth = 0.7;
    for (let index = -2; index <= 2; index += 1) {
      ctx.beginPath();
      ctx.moveTo(index * 9, -14);
      ctx.lineTo(index * 7.5, 27);
      ctx.stroke();
    }
    for (let index = 0; index < 3; index += 1) {
      const y = -5 + index * 11;
      ctx.beginPath();
      ctx.moveTo(-23, y);
      ctx.lineTo(24, y);
      ctx.stroke();
    }

    ctx.fillStyle = "#718d8d";
    ctx.fillRect(-29, -22, 58, 5);
    ctx.fillStyle = "rgba(201, 240, 233, 0.3)";
    ctx.fillRect(-27, -21, 54, 1);

    state.samples.forEach((filled, index) => {
      const vialX = -14 + index * 14;
      ctx.fillStyle = filled ? "rgba(107, 231, 201, 0.9)" : "rgba(75, 111, 113, 0.45)";
      ctx.fillRect(vialX, 4, 5, 15);
      ctx.fillStyle = filled ? "rgba(213, 255, 235, 0.95)" : "rgba(156, 190, 185, 0.32)";
      ctx.fillRect(vialX + 1, 5, 1, 4);
    });

    const weightOffset = state.weight * 9;
    ctx.fillStyle = "#d3aa60";
    ctx.beginPath();
    ctx.arc(weightOffset, 35, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(247, 222, 163, 0.65)";
    ctx.beginPath();
    ctx.arc(weightOffset - 1, 34, 1.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(123, 224, 219, 0.9)";
    ctx.beginPath();
    ctx.arc(20, 7, 2.1, 0, Math.PI * 2);
    ctx.fill();
    const beacon = ctx.createRadialGradient(20, 7, 0, 20, 7, 15);
    beacon.addColorStop(0, "rgba(123, 224, 219, 0.28)");
    beacon.addColorStop(1, "rgba(123, 224, 219, 0)");
    ctx.fillStyle = beacon;
    ctx.fillRect(5, -8, 30, 30);

    ctx.fillStyle = "rgba(170, 208, 204, 0.5)";
    ctx.font = "7px Consolas, monospace";
    ctx.fillText("S-07", -22, -9);
    ctx.restore();

    if (state.sampleFlash > 0) {
      const radius = 27 + (1 - state.sampleFlash) * 37;
      ctx.strokeStyle = `rgba(123, 224, 219, ${state.sampleFlash * 0.75})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(basket.x, basket.y - 9, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawForeground(width, height) {
    const vignette = ctx.createRadialGradient(
      width * 0.46,
      height * 0.43,
      Math.min(width, height) * 0.18,
      width * 0.46,
      height * 0.43,
      Math.max(width, height) * 0.72
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.72, "rgba(0, 4, 7, 0.15)");
    vignette.addColorStop(1, "rgba(0, 3, 5, 0.68)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const bottom = ctx.createLinearGradient(0, height - 90, 0, height);
    bottom.addColorStop(0, "rgba(1, 6, 9, 0)");
    bottom.addColorStop(1, "rgba(1, 6, 9, 0.48)");
    ctx.fillStyle = bottom;
    ctx.fillRect(0, height - 90, width, 90);
  }
  const audio = {
    context: null,
    master: null,
    toneGain: null,
    toneOscillator: null,
    undertone: null,
    toneFilter: null,
    motorOscillator: null,
    motorGain: null,

    init() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error("Web Audio is not supported");
      const context = new AudioContext();
      const master = context.createGain();
      const compressor = context.createDynamicsCompressor();
      const toneGain = context.createGain();
      const toneFilter = context.createBiquadFilter();
      const toneOscillator = context.createOscillator();
      const undertone = context.createOscillator();
      const undertoneGain = context.createGain();
      const motorOscillator = context.createOscillator();
      const motorGain = context.createGain();
      const motorFilter = context.createBiquadFilter();

      master.gain.value = state.volume * 0.7;
      compressor.threshold.value = -20;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.02;
      compressor.release.value = 0.25;

      toneOscillator.type = "triangle";
      toneOscillator.frequency.value = 295;
      undertone.type = "sine";
      undertone.frequency.value = 147.5;
      undertoneGain.gain.value = 0.48;
      toneFilter.type = "lowpass";
      toneFilter.frequency.value = 2200;
      toneFilter.Q.value = 1.2;
      toneGain.gain.value = 0;

      motorOscillator.type = "sawtooth";
      motorOscillator.frequency.value = 38;
      motorFilter.type = "lowpass";
      motorFilter.frequency.value = 160;
      motorGain.gain.value = 0;

      toneOscillator.connect(toneGain);
      undertone.connect(undertoneGain).connect(toneGain);
      toneGain.connect(toneFilter).connect(compressor);
      motorOscillator.connect(motorFilter).connect(motorGain).connect(compressor);
      compressor.connect(master).connect(context.destination);

      const startTime = context.currentTime;
      toneOscillator.start(startTime);
      undertone.start(startTime);
      motorOscillator.start(startTime);

      Object.assign(this, {
        context,
        master,
        toneGain,
        toneOscillator,
        undertone,
        toneFilter,
        motorOscillator,
        motorGain,
      });
      if (context.state === "suspended") context.resume();
    },

    update() {
      const frequency = 110 + state.tension * 4.4;
      state.toneFrequency = frequency;
      if (!this.context) return;
      const now = this.context.currentTime;
      const active = state.phase === "running" || state.phase === "success";
      const audible = !state.audioMuted && state.started;
      const volume = state.volume;
      const toneLevel = audible && active
        ? volume * (0.035 + clamp(state.tension / TENSION_BREAK, 0, 1) * 0.075)
        : 0;
      const motorLevel = audible && active
        ? volume * clamp(Math.abs(state.velocity) / 70, 0, 0.024)
        : 0;

      this.toneOscillator.frequency.setTargetAtTime(frequency, now, 0.045);
      this.undertone.frequency.setTargetAtTime(frequency * 0.5, now, 0.055);
      this.toneFilter.frequency.setTargetAtTime(650 + state.tension * 22, now, 0.08);
      this.toneGain.gain.setTargetAtTime(toneLevel, now, 0.08);
      this.motorOscillator.frequency.setTargetAtTime(32 + Math.abs(state.velocity) * 1.9, now, 0.06);
      this.motorGain.gain.setTargetAtTime(motorLevel, now, 0.1);
      this.master.gain.setTargetAtTime(state.audioMuted ? 0 : volume * 0.7, now, 0.04);
    },

    setMuted(muted) {
      state.audioMuted = muted;
      if (this.master && this.context) {
        this.master.gain.setTargetAtTime(muted ? 0 : state.volume * 0.7, this.context.currentTime, 0.04);
      }
    },

    setVolume(volume) {
      state.volume = clamp(volume, 0, 1);
      if (this.master && this.context) {
        this.master.gain.setTargetAtTime(state.audioMuted ? 0 : state.volume * 0.7, this.context.currentTime, 0.04);
      }
    },
  };

  ui.soundToggle.addEventListener("click", () => {
    const muted = !state.audioMuted;
    audio.setMuted(muted);
    ui.soundToggle.textContent = muted ? "音频 关" : "音频 开";
    ui.soundToggle.setAttribute("aria-pressed", String(!muted));
    showToast(muted ? "张力声呐已静音" : "张力声呐已开启", false);
  });

  ui.volume.addEventListener("input", () => {
    audio.setVolume(Number(ui.volume.value) / 100);
  });

  function loop(now) {
    const frameDt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    const dt = frameDt * state.timeScale;
    state.sceneTime += dt;
    if (state.started) update(dt);
    render();
    if (++hudFrame % 3 === 0) updateHUD();
    requestAnimationFrame(loop);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function updateHUD(force = false) {
    const tension = state.tension;
    const sampleCount = state.samples.filter(Boolean).length;
    const wallDistance = Math.max(0, (0.49 - state.sway) * 57);
    const swayDegrees = Math.atan(state.sway) * 180 / Math.PI;

    ui.depth.textContent = padDepth(state.depth);
    ui.elapsed.textContent = `T+ ${formatTime(state.elapsed)}`;
    ui.tension.textContent = String(Math.round(tension));
    ui.tensionFill.style.width = `${clamp(tension, 0, 100)}%`;
    ui.tensionFill.style.background = tension > TENSION_WARN
      ? "var(--red)"
      : tension > 65
        ? "var(--amber)"
        : "var(--safe)";

    ui.integrity.textContent = state.cableSnapped
      ? "缆绳断裂"
      : tension > TENSION_WARN
        ? "过载警告"
        : "缆绳完好";
    ui.integrity.className = `integrity${state.cableSnapped ? " failure" : tension > TENSION_WARN ? " warning" : ""}`;

    ui.slackFill.style.width = `${clamp(state.slack / SLACK_LIMIT * 100, 0, 100)}%`;
    ui.slackState.textContent = state.slack > 55 ? "松弛累积" : state.slack > 18 ? "轻度松弛" : "张紧";
    ui.slackState.style.color = state.slack > 55 ? "var(--red)" : state.slack > 18 ? "var(--amber)" : "var(--safe)";

    ui.lineSpeed.textContent = Math.abs(state.lineSpeed).toFixed(1);
    ui.basketSpeed.textContent = Math.abs(state.velocity).toFixed(1);
    ui.wallDistance.textContent = wallDistance.toFixed(1);
    ui.wallDistance.style.color = wallDistance < 5 ? "var(--red)" : wallDistance < 11 ? "var(--amber)" : "";
    ui.sway.textContent = swayDegrees.toFixed(1);

    ui.winchSpeed.textContent = Math.abs(state.lineSpeed).toFixed(1);
    ui.speedDirection.textContent = state.brake
      ? "制动中"
      : state.lineSpeed < -0.2 || state.winchTarget < -0.2
        ? "回收 ↑"
        : state.lineSpeed > 0.2 || state.winchTarget > 0.2
          ? "下放 ↓"
          : "待命";
    ui.speedDirection.style.color = state.brake ? "var(--amber)" : "";
    const speedPercent = clamp(Math.abs(state.lineSpeed) / MAX_RATE, 0, 1) * 50;
    if (state.lineSpeed < 0) {
      ui.speedFill.style.left = `${50 - speedPercent}%`;
      ui.speedFill.style.width = `${speedPercent}%`;
      ui.speedFill.style.background = "var(--safe)";
    } else {
      ui.speedFill.style.left = "50%";
      ui.speedFill.style.width = `${speedPercent}%`;
      ui.speedFill.style.background = "var(--cyan)";
    }

    ui.sampleCount.textContent = `${sampleCount} / 3`;
    ui.targetCards.forEach((card, index) => {
      const complete = state.samples[index];
      const active = state.sampleZone === index;
      card.className = `target${complete ? " complete" : active ? " active" : ""}`;
      const status = card.querySelector(".target-state");
      if (complete) status.textContent = "已封存";
      else if (active) status.textContent = `悬停 ${Math.round(state.sampleProgress * 100)}%`;
      else if (Math.abs(state.depth - TARGETS[index]) <= SAMPLE_TOLERANCE + 15) status.textContent = "接近层位";
      else if (state.depth > TARGETS[index] + SAMPLE_TOLERANCE) status.textContent = "已错过";
      else status.textContent = "待采样";
    });

    if (state.sampleZone >= 0) {
      ui.sampleHint.textContent = Math.abs(state.velocity) < 9.2
        ? `采样中 · ${TARGETS[state.sampleZone]} m 层位`
        : "速度过快 · 先制动稳定篮体";
    } else if (state.samples.every(Boolean)) {
      ui.sampleHint.textContent = state.phase === "success" ? "全部样品已出水" : "三点完成 · 按 R 回收";
    } else {
      ui.sampleHint.textContent = state.samples.some(Boolean) ? "继续下放至下一层位" : "进入采样层后减速保持稳定";
    }
    ui.sampleFill.style.width = `${state.sampleProgress * 100}%`;
    ui.tone.textContent = `${Math.round(state.toneFrequency)} Hz`;
    ui.tone.style.color = tension > TENSION_WARN ? "var(--red)" : "var(--cyan)";
    ui.haulButton.classList.toggle("ready", state.samples.every(Boolean) && state.phase === "running");
    if (force) ui.resultSamples.textContent = `${sampleCount} / 3`;
  }
  function getAudioInfo() {
    return {
      ready: state.audioReady,
      contextState: audio.context?.state ?? "not-created",
      frequency: Number(state.toneFrequency.toFixed(1)),
      muted: state.audioMuted,
      volume: state.volume,
    };
  }

  window.__deepTether = {
    getState: () => ({
      phase: state.phase,
      started: state.started,
      depth: Number(state.depth.toFixed(2)),
      elapsed: Number(state.elapsed.toFixed(2)),
      velocity: Number(state.velocity.toFixed(2)),
      winchTarget: Number(state.winchTarget.toFixed(2)),
      lineSpeed: Number(state.lineSpeed.toFixed(2)),
      brake: state.brake,
      tension: Number(state.tension.toFixed(2)),
      peakTension: Number(state.peakTension.toFixed(2)),
      slack: Number(state.slack.toFixed(2)),
      weight: Number(state.weight.toFixed(2)),
      samples: [...state.samples],
      sampleCount: state.samples.filter(Boolean).length,
      resultOpen: state.resultOpen,
      failReason: state.failReason,
      cableSnapped: state.cableSnapped,
      toneFrequency: Number(state.toneFrequency.toFixed(1)),
      audio: getAudioInfo(),
    }),
    setTimeScale: (scale) => { state.timeScale = clamp(Number(scale) || 1, 0.25, 4); },
    start: startGame,
    reset: resetState,
  };

  resize();
  window.addEventListener("resize", resize);
  updateHUD(true);
  requestAnimationFrame(loop);
})();
