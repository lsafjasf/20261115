(() => {
  "use strict";

  const W = 1440;
  const H = 900;
  const SAFE_MIN = 4.5;
  const SAFE_MAX = 8.8;
  const canvas = document.querySelector("#world");
  const ctx = canvas.getContext("2d");
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const ROUTE_DATA = [
    {
      id: "A",
      name: "苔痕线",
      cargo: "血浆",
      mass: 18,
      sag: 64,
      length: 44,
      gravity: 2.4,
      brakePower: 5.6,
      windExposure: 0.38,
      windPhase: 0.3,
      startSpeed: 6.2,
      start: { x: 436, y: 682 },
      end: { x: 858, y: 356 },
      defaultBrake: 32,
    },
    {
      id: "B",
      name: "白雾线",
      cargo: "抗毒血清",
      mass: 25,
      sag: 86,
      length: 41,
      gravity: 3.1,
      brakePower: 6.2,
      windExposure: 1,
      windPhase: 2.2,
      startSpeed: 5.9,
      start: { x: 392, y: 548 },
      end: { x: 870, y: 336 },
      defaultBrake: 40,
    },
    {
      id: "C",
      name: "藤桥线",
      cargo: "止血包",
      mass: 14,
      sag: 48,
      length: 38,
      gravity: 4,
      brakePower: 7,
      windExposure: 0.62,
      windPhase: 4.4,
      startSpeed: 6.6,
      start: { x: 484, y: 436 },
      end: { x: 882, y: 316 },
      defaultBrake: 48,
    },
  ];

  const routes = ROUTE_DATA.map((data) => ({
    ...data,
    status: "ready",
    progress: 0,
    speed: 0,
    countdown: 0,
    launchAt: 0,
    brake: data.defaultBrake,
    delay: 0,
    attempts: 0,
    arrivalSpeed: 0,
    sway: 0,
    crashAt: 0,
    deliveredAt: 0,
  }));

  const state = {
    selected: "A",
    elapsed: 0,
    delivered: 0,
    runStarted: performance.now(),
    lastTime: performance.now(),
    toastTimer: 0,
    modalTimer: 0,
    modalOpen: false,
    finishTime: 0,
    totalCrashes: 0,
    totalRecoveries: 0,
    runActive: false,
    runStartElapsed: 0,
    failed: false,
    shake: 0,
    modalKind: "",
    audioEnabled: false,
    audioReady: false,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  const ui = {
    delivered: $("#delivered-count"),
    progress: $("#progress-fill"),
    windSpeed: $("#wind-speed"),
    windNeedle: $("#wind-needle"),
    selectedLetter: $("#selected-letter"),
    selectedName: $("#selected-name"),
    cargoTag: $("#cargo-tag"),
    factSag: $("#fact-sag"),
    factWind: $("#fact-wind"),
    delay: $("#delay"),
    delayOutput: $("#delay-output"),
    brake: $("#brake"),
    brakeOutput: $("#brake-output"),
    speed: $("#live-speed"),
    arrival: $("#arrival-estimate"),
    dispatch: $("#dispatch"),
    dispatchIcon: $("#dispatch-icon"),
    dispatchLabel: $("#dispatch-label"),
    dispatchNote: $("#dispatch-note"),
    recover: $("#recover"),
    toast: $("#toast"),
    modal: $("#modal"),
    modalKicker: $("#modal-kicker"),
    modalTitle: $("#modal-title"),
    modalCopy: $("#modal-copy"),
    modalStats: $("#modal-stats"),
    modalAction: $("#modal-action"),
    audioButton: $("#audio-button"),
    audioLabel: $("#audio-label"),
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const routeById = (id) => routes.find((route) => route.id === id);
  const selectedRoute = () => routeById(state.selected);
  const totalMass = () => routes.reduce((sum, route) => sum + route.mass, 0);

  function mulberry32(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const random = mulberry32(20261115);

  function windAt(time, phase = 0) {
    return (
      0.16 +
      Math.sin(time * 0.82 + phase) * 0.48 +
      Math.sin(time * 2.12 + phase * 1.7) * 0.19
    );
  }

  function cablePoint(route, progress) {
    const t = clamp(progress, 0, 1);
    const controlX = (route.start.x + route.end.x) * 0.5;
    const controlY = Math.max(route.start.y, route.end.y) + route.sag;
    const inv = 1 - t;
    return {
      x: inv * inv * route.start.x + 2 * inv * t * controlX + t * t * route.end.x,
      y: inv * inv * route.start.y + 2 * inv * t * controlY + t * t * route.end.y,
    };
  }

  function cableTangent(route, progress) {
    const p = clamp(progress, 0.001, 0.999);
    const a = cablePoint(route, p - 0.004);
    const b = cablePoint(route, p + 0.004);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  const audio = {
    context: null,
    master: null,
    rainGain: null,
    windGain: null,
    hum: null,
    humGain: null,
    friction: null,
    frictionGain: null,
    frictionFilter: null,
  };

  function makeNoiseBuffer(context, seconds = 2) {
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < channel.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      channel[i] = last;
    }
    return buffer;
  }

  function initAudio() {
    if (state.audioReady) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      showToast("当前浏览器不支持 Web Audio", "warn");
      return;
    }

    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0.7;
    master.connect(context.destination);

    const rain = context.createBufferSource();
    rain.buffer = makeNoiseBuffer(context, 3);
    rain.loop = true;
    const rainFilter = context.createBiquadFilter();
    rainFilter.type = "lowpass";
    rainFilter.frequency.value = 2200;
    const rainGain = context.createGain();
    rainGain.gain.value = 0.055;
    rain.connect(rainFilter).connect(rainGain).connect(master);
    rain.start();

    const wind = context.createBufferSource();
    wind.buffer = makeNoiseBuffer(context, 4);
    wind.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 380;
    windFilter.Q.value = 0.7;
    const windGain = context.createGain();
    windGain.gain.value = 0.018;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();

    const hum = context.createOscillator();
    hum.type = "triangle";
    hum.frequency.value = 88;
    const humFilter = context.createBiquadFilter();
    humFilter.type = "lowpass";
    humFilter.frequency.value = 620;
    const humGain = context.createGain();
    humGain.gain.value = 0.0001;
    hum.connect(humFilter).connect(humGain).connect(master);
    hum.start();

    const friction = context.createBufferSource();
    friction.buffer = makeNoiseBuffer(context, 3);
    friction.loop = true;
    const frictionFilter = context.createBiquadFilter();
    frictionFilter.type = "bandpass";
    frictionFilter.frequency.value = 680;
    frictionFilter.Q.value = 1.1;
    const frictionGain = context.createGain();
    frictionGain.gain.value = 0.0001;
    friction.connect(frictionFilter).connect(frictionGain).connect(master);
    friction.start();

    Object.assign(audio, {
      context,
      master,
      rainGain,
      windGain,
      hum,
      humGain,
      friction,
      frictionGain,
      frictionFilter,
    });
    state.audioReady = true;
  }

  async function setAudioEnabled(enabled) {
    initAudio();
    if (!audio.context) return;
    if (enabled) {
      if (audio.context.state === "suspended") await audio.context.resume();
      audio.master.gain.setTargetAtTime(0.7, audio.context.currentTime, 0.04);
    } else {
      audio.master.gain.setTargetAtTime(0.0001, audio.context.currentTime, 0.04);
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (audio.context.state === "running") await audio.context.suspend();
    }
    state.audioEnabled = enabled;
    ui.audioButton.setAttribute("aria-pressed", String(enabled));
    ui.audioLabel.textContent = enabled ? "环境声已开启" : "开启环境声";
  }

  function updateAudio() {
    if (!state.audioReady || !state.audioEnabled) return;
    const now = audio.context.currentTime;
    const moving = routes.filter((route) => route.status === "moving");
    const peakSpeed = moving.length
      ? Math.max(...moving.map((route) => route.speed))
      : 0;
    const friction = moving.length
      ? Math.max(
          ...moving.map(
            (route) =>
              (route.brake / 100) * clamp(route.speed / SAFE_MAX, 0, 1.4)
          )
        )
      : 0;
    const wind = Math.abs(windAt(state.elapsed, selectedRoute().windPhase));
    const speedNorm = clamp(peakSpeed / 14, 0, 1);

    audio.hum.frequency.setTargetAtTime(82 + peakSpeed * 11.5, now, 0.08);
    audio.humGain.gain.setTargetAtTime(0.012 * speedNorm + 0.001, now, 0.08);
    audio.frictionGain.gain.setTargetAtTime(0.006 + friction * 0.045, now, 0.06);
    audio.frictionFilter.frequency.setTargetAtTime(520 + friction * 1100, now, 0.1);
    audio.windGain.gain.setTargetAtTime(0.01 + wind * 0.035, now, 0.25);
    audio.rainGain.gain.setTargetAtTime(0.048 + Math.abs(wind) * 0.018, now, 0.3);
  }

  function tone(frequency, duration, volume, type = "sine", delay = 0) {
    if (!state.audioReady || !state.audioEnabled) return;
    const start = audio.context.currentTime + delay;
    const oscillator = audio.context.createOscillator();
    const gain = audio.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audio.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function impactSound() {
    if (!state.audioReady || !state.audioEnabled) return;
    const start = audio.context.currentTime;
    const source = audio.context.createBufferSource();
    source.buffer = makeNoiseBuffer(audio.context, 0.4);
    const filter = audio.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, start);
    filter.frequency.exponentialRampToValueAtTime(90, start + 0.32);
    const gain = audio.context.createGain();
    gain.gain.setValueAtTime(0.17, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
    source.connect(filter).connect(gain).connect(audio.master);
    source.start(start);
    tone(62, 0.36, 0.13, "sine");
  }

  function successSound() {
    tone(392, 0.28, 0.055, "sine");
    tone(523.25, 0.34, 0.045, "sine", 0.1);
    tone(659.25, 0.46, 0.04, "sine", 0.2);
  }

  const sceneRandom = mulberry32(87123);
  const rainDrops = Array.from({ length: 230 }, () => ({
    x: sceneRandom() * W,
    y: sceneRandom() * H,
    length: 8 + sceneRandom() * 22,
    speed: 13 + sceneRandom() * 24,
    alpha: 0.1 + sceneRandom() * 0.24,
    layer: sceneRandom(),
  }));
  const mistMotes = Array.from({ length: 55 }, () => ({
    x: sceneRandom() * W,
    y: 120 + sceneRandom() * 650,
    radius: 2 + sceneRandom() * 7,
    phase: sceneRandom() * Math.PI * 2,
    speed: 0.25 + sceneRandom() * 0.55,
  }));
  const sparks = [];
  const splashes = [];
  const leafClusters = [];
  const canopyPalette = ["#183d2c", "#20503a", "#2a603f", "#346c45", "#406f49"];
  const clusterZones = [
    [0, 0, 520, 360, 0],
    [1040, 0, 400, 390, 0],
    [0, 0, 1440, 120, 0],
    [0, 90, 230, 680, 1],
    [240, 60, 390, 270, 1],
    [1040, 110, 400, 500, 1],
    [0, 690, 340, 220, 2],
    [1010, 570, 430, 330, 2],
    [380, 0, 340, 190, 1],
  ];
  clusterZones.forEach((zone, zoneIndex) => {
    const count = 9 + Math.floor(sceneRandom() * 8);
    for (let i = 0; i < count; i += 1) {
      leafClusters.push({
        x: zone[0] + sceneRandom() * zone[2],
        y: zone[1] + sceneRandom() * zone[3],
        rx: 18 + sceneRandom() * 46,
        ry: 7 + sceneRandom() * 22,
        color: canopyPalette[Math.min(canopyPalette.length - 1, zone[4] + 2)],
        rotation: sceneRandom() * Math.PI,
        sway: sceneRandom() * Math.PI * 2,
        depth: zone[4],
        accent: sceneRandom() > 0.7,
        zoneIndex,
      });
    }
  });

  const target = { x: 878, y: 368, deckY: 385 };
  let viewport = { scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    const scale = Math.max(canvas.width / W, canvas.height / H);
    viewport = {
      scale,
      offsetX: (canvas.width - W * scale) * 0.5,
      offsetY: (canvas.height - H * scale) * 0.5,
      dpr,
    };
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#071914");
    sky.addColorStop(0.34, "#0b2c23");
    sky.addColorStop(0.68, "#174032");
    sky.addColorStop(1, "#06130f");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(target.x, target.y, 30, target.x, target.y, 430);
    glow.addColorStop(0, "rgba(197, 219, 143, 0.24)");
    glow.addColorStop(0.38, "rgba(100, 146, 98, 0.12)");
    glow.addColorStop(1, "rgba(6, 20, 16, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(450, 0, 900, H);

    drawDistantForest();
    drawHaze();
  }

  function drawDistantForest() {
    ctx.save();
    ctx.globalAlpha = 0.48;
    ctx.fillStyle = "#173c31";
    for (let i = 0; i < 17; i += 1) {
      const x = i * 98 - 40;
      const trunkH = 260 + (i % 5) * 80;
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.bezierCurveTo(x + 40, 650, x - 20, 420, x + 24, H - trunkH);
      ctx.lineTo(x + 74, H - trunkH + 25);
      ctx.bezierCurveTo(x + 58, 540, x + 95, 690, x + 110, H);
      ctx.fill();
    }
    ctx.globalAlpha = 0.75;
    for (let layer = 0; layer < 3; layer += 1) {
      ctx.fillStyle = ["#153a2e", "#1a4637", "#214f3e"][layer];
      for (let i = 0; i < 8; i += 1) {
        const x = (i * 212 + layer * 57) % 1510 - 40;
        const y = 140 + layer * 76 + (i % 3) * 28;
        ctx.beginPath();
        ctx.ellipse(x, y, 110 + layer * 28, 24 + layer * 7, -0.08, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawHaze() {
    const haze = ctx.createLinearGradient(0, 480, 0, 900);
    haze.addColorStop(0, "rgba(116, 153, 128, 0)");
    haze.addColorStop(0.55, "rgba(95, 132, 113, 0.1)");
    haze.addColorStop(1, "rgba(30, 66, 51, 0.22)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 440, W, 460);
  }

  function drawTrunks() {
    const leftTrunk = ctx.createLinearGradient(35, 0, 190, 0);
    leftTrunk.addColorStop(0, "#07120f");
    leftTrunk.addColorStop(0.45, "#173327");
    leftTrunk.addColorStop(0.75, "#274a34");
    leftTrunk.addColorStop(1, "#091914");
    ctx.fillStyle = leftTrunk;
    ctx.beginPath();
    ctx.moveTo(-40, 900);
    ctx.bezierCurveTo(54, 710, 24, 410, 95, 60);
    ctx.bezierCurveTo(126, 42, 170, 85, 176, 260);
    ctx.bezierCurveTo(194, 500, 150, 705, 205, 900);
    ctx.fill();

    const rightTrunk = ctx.createLinearGradient(1120, 0, 1430, 0);
    rightTrunk.addColorStop(0, "#0a1813");
    rightTrunk.addColorStop(0.5, "#263c2b");
    rightTrunk.addColorStop(1, "#07140f");
    ctx.fillStyle = rightTrunk;
    ctx.beginPath();
    ctx.moveTo(1234, 900);
    ctx.bezierCurveTo(1180, 670, 1375, 474, 1294, 0);
    ctx.lineTo(1460, 0);
    ctx.lineTo(1460, 900);
    ctx.fill();

    const supportTrunk = ctx.createLinearGradient(800, 0, 980, 0);
    supportTrunk.addColorStop(0, "#0a1914");
    supportTrunk.addColorStop(0.5, "#243d2d");
    supportTrunk.addColorStop(1, "#0c1d16");
    ctx.fillStyle = supportTrunk;
    ctx.beginPath();
    ctx.moveTo(815, 900);
    ctx.bezierCurveTo(846, 650, 822, 480, 853, 310);
    ctx.bezierCurveTo(862, 265, 902, 254, 918, 318);
    ctx.bezierCurveTo(940, 520, 973, 700, 997, 900);
    ctx.fill();

    ctx.strokeStyle = "rgba(94, 129, 86, 0.24)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(864, 880);
    ctx.bezierCurveTo(874, 620, 866, 480, 880, 344);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(922, 850);
    ctx.bezierCurveTo(926, 670, 900, 550, 891, 368);
    ctx.stroke();
  }

  function drawCanopy() {
    const wind = windAt(state.elapsed, 0.2);
    ctx.save();
    leafClusters.forEach((leaf) => {
      const sway = Math.sin(state.elapsed * 0.55 + leaf.sway) * (1.2 + leaf.depth);
      ctx.save();
      ctx.translate(leaf.x + sway, leaf.y);
      ctx.rotate(leaf.rotation + wind * 0.025);
      ctx.globalAlpha = [0.35, 0.65, 0.86][leaf.depth];
      ctx.fillStyle = leaf.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, leaf.rx, leaf.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha *= 0.55;
      ctx.fillStyle = leaf.accent ? "#89a85e" : "#0d251b";
      ctx.beginPath();
      ctx.ellipse(-leaf.rx * 0.24, -leaf.ry * 0.1, leaf.rx * 0.55, leaf.ry * 0.52, -0.2, 0, Math.PI * 2);
      ctx.fill();
      if (leaf.accent && leaf.depth === 2) {
        ctx.strokeStyle = "rgba(183, 208, 126, 0.34)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-leaf.rx * 0.92, 0);
        ctx.lineTo(leaf.rx * 0.8, 0);
        ctx.stroke();
      }
      ctx.restore();
    });
    ctx.restore();

    drawVines(wind);
    drawForegroundFronds(wind);
  }

  function drawVines(wind) {
    ctx.save();
    ctx.lineCap = "round";
    const vines = [
      [68, -20, 114, 360, 14],
      [151, -20, 177, 240, 8],
      [1358, -20, 1318, 410, 12],
      [1218, -20, 1265, 300, 6],
      [523, -20, 502, 178, 5],
    ];
    vines.forEach(([x1, y1, x2, y2, width], index) => {
      ctx.strokeStyle = index % 2 ? "rgba(85, 118, 70, 0.72)" : "rgba(65, 99, 62, 0.84)";
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(
        x1 + 50 + wind * 4,
        y1 + (y2 - y1) * 0.32,
        x2 - 42,
        y1 + (y2 - y1) * 0.7,
        x2,
        y2
      );
      ctx.stroke();
      for (let i = 0; i < 4; i += 1) {
        const yy = y1 + (y2 - y1) * (0.22 + i * 0.19);
        ctx.fillStyle = "rgba(68, 119, 72, 0.74)";
        ctx.beginPath();
        ctx.ellipse(x2 + 10 + i * 2, yy, 17, 6, 0.45 + i * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  }

  function drawForegroundFronds(wind) {
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = "#0b2118";
    const fronds = [
      [85, 925, 310, 720, -0.3],
      [302, 940, 365, 738, 0.22],
      [1268, 930, 1090, 750, 3.42],
      [1390, 905, 1190, 720, 3.4],
    ];
    fronds.forEach(([x, y, tipX, tipY, rotation]) => {
      ctx.save();
      ctx.translate(x + wind * 4, y);
      ctx.rotate(rotation);
      for (let i = 0; i < 7; i += 1) {
        const angle = -0.75 + i * 0.23;
        const length = 130 + i * 13;
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.ellipse(length * 0.55, 0, length * 0.55, 11 - i * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate(-angle);
      }
      ctx.restore();
    });
    ctx.restore();
  }

  function drawTargetPlatform() {
    const pulse = 0.5 + Math.sin(state.elapsed * 2.2) * 0.5;
    ctx.save();

    ctx.fillStyle = "rgba(218, 171, 84, 0.09)";
    ctx.beginPath();
    ctx.ellipse(target.x, target.deckY + 10, 176 + pulse * 10, 66 + pulse * 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#13271e";
    ctx.beginPath();
    ctx.ellipse(target.x, target.deckY + 28, 151, 39, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#41543a";
    ctx.beginPath();
    ctx.ellipse(target.x, target.deckY + 5, 146, 42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(202, 181, 115, 0.24)";
    ctx.lineWidth = 2;
    for (let i = -6; i <= 6; i += 1) {
      ctx.beginPath();
      ctx.moveTo(target.x + i * 20, target.deckY - 35);
      ctx.lineTo(target.x + i * 22, target.deckY + 42);
      ctx.stroke();
    }

    ctx.strokeStyle = "#8e8762";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(target.x, target.deckY, 129, 30, 0, 0.04, Math.PI - 0.04);
    ctx.stroke();

    for (let i = 0; i < 4; i += 1) {
      const angle = 0.38 + i * 0.55;
      const x = target.x + Math.cos(angle) * 148;
      const y = target.deckY + 10 + Math.sin(angle) * 33;
      ctx.fillStyle = "#374d34";
      ctx.fillRect(x - 3, y - 48, 6, 48);
      ctx.fillStyle = "#d5e598";
      ctx.beginPath();
      ctx.arc(x, y - 50, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(219, 236, 179, 0.22)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const x1 = target.x - 137 + i * 92;
      const x2 = target.x - 101 + i * 92;
      ctx.beginPath();
      ctx.moveTo(x1, target.deckY + 32);
      ctx.quadraticCurveTo((x1 + x2) / 2, target.deckY + 62, x2, target.deckY + 32);
      ctx.stroke();
    }

    drawShelter();
    drawLandingMark();
    drawDeliveredCargo();
    drawTargetLabel();
    ctx.restore();
  }

  function drawShelter() {
    ctx.fillStyle = "#172d21";
    ctx.fillRect(target.x + 66, 245, 8, 116);
    ctx.fillRect(target.x + 138, 260, 7, 112);
    ctx.fillStyle = "#314a30";
    ctx.beginPath();
    ctx.moveTo(target.x + 36, 268);
    ctx.lineTo(target.x + 112, 218);
    ctx.lineTo(target.x + 198, 274);
    ctx.lineTo(target.x + 168, 282);
    ctx.lineTo(target.x + 110, 243);
    ctx.lineTo(target.x + 64, 281);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(203, 224, 145, 0.64)";
    ctx.beginPath();
    ctx.arc(target.x + 106, 320, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "#e2f2a1";
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawLandingMark() {
    ctx.save();
    ctx.strokeStyle = "rgba(213, 240, 155, 0.26)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.ellipse(target.x - 22, target.deckY - 2, 76, 19, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(216, 239, 145, 0.15)";
    ctx.beginPath();
    ctx.ellipse(target.x - 22, target.deckY - 2, 43, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawDeliveredCargo() {
    let slot = 0;
    routes.forEach((route) => {
      if (route.status !== "delivered") return;
      const x = target.x + 42 + slot * 28;
      const y = target.deckY - 11 - slot * 2;
      drawCrate(x, y, 0.74, route);
      slot += 1;
    });
  }

  function drawTargetLabel() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(216, 239, 145, 0.7)";
    ctx.font = "600 9px 'Trebuchet MS', 'Canopy Sans', sans-serif";
    ctx.letterSpacing = "2px";
    ctx.fillText("CANOPY AID STATION", target.x, target.deckY + 74);
    ctx.fillStyle = "rgba(232, 238, 214, 0.9)";
    ctx.font = "600 12px 'Palatino Linotype', 'Canopy Serif', serif";
    ctx.fillText("树冠救护站", target.x, target.deckY + 91);
    ctx.restore();
  }

  function drawLaunchStations() {
    routes.forEach((route) => {
      const { x, y } = route.start;
      ctx.save();
      ctx.fillStyle = "#0d2017";
      ctx.beginPath();
      ctx.ellipse(x, y + 23, 55, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3c5237";
      ctx.beginPath();
      ctx.ellipse(x, y + 17, 49, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(216, 239, 145, 0.24)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, y + 17, 42, 10, 0, 0.1, Math.PI - 0.1);
      ctx.stroke();
      ctx.fillStyle = "#283d2d";
      ctx.fillRect(x + 35, y - 46, 5, 65);
      ctx.fillStyle = "rgba(7, 19, 14, 0.86)";
      ctx.fillRect(x - 18, y + 28, 38, 20);
      ctx.strokeStyle = "rgba(216, 239, 145, 0.35)";
      ctx.strokeRect(x - 18, y + 28, 38, 20);
      ctx.fillStyle = "#d8ef91";
      ctx.font = "700 12px 'Palatino Linotype', 'Canopy Serif', serif";
      ctx.textAlign = "center";
      ctx.fillText(route.id, x + 1, y + 42);
      ctx.fillStyle = "rgba(223, 234, 203, 0.58)";
      ctx.font = "8px 'Trebuchet MS', 'Canopy Sans', sans-serif";
      ctx.fillText(route.name, x, y + 62);
      ctx.restore();
    });
  }

  function drawCables() {
    routes.forEach((route) => {
      const moving = route.status === "moving";
      const vibration = moving ? Math.sin(state.elapsed * 17 + route.windPhase) * 0.8 : 0.18;
      const points = [];
      for (let i = 0; i <= 54; i += 1) {
        const p = i / 54;
        const point = cablePoint(route, p);
        const normal = Math.sin(p * Math.PI) * vibration;
        points.push({ x: point.x, y: point.y + normal });
      }

      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = 5;
      strokePoints(points);
      ctx.strokeStyle = route.id === "B" ? "#aeb89d" : "#c2c9a9";
      ctx.lineWidth = 1.35;
      strokePoints(points);
      ctx.strokeStyle = "rgba(244, 255, 214, 0.34)";
      ctx.lineWidth = 0.45;
      strokePoints(points);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = "#17261d";
      ctx.beginPath();
      ctx.arc(route.start.x, route.start.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(216, 239, 145, 0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#23392b";
      ctx.beginPath();
      ctx.arc(route.end.x, route.end.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function strokePoints(points) {
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }

  function drawCrate(x, y, scale = 1, route = null, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(scale, scale);

    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.beginPath();
    ctx.ellipse(0, 20, 18, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = route?.id === "B" ? "#e7d3a0" : route?.id === "C" ? "#d7b981" : "#d7c49b";
    ctx.beginPath();
    ctx.roundRect(-17, -15, 34, 32, 3);
    ctx.fill();
    ctx.strokeStyle = "#3f3526";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = "rgba(64, 52, 33, 0.34)";
    ctx.fillRect(-17, -5, 34, 4);
    ctx.fillStyle = "#465d42";
    ctx.fillRect(-14, -2, 28, 5);
    ctx.fillStyle = route?.id === "B" ? "#315e62" : "#71382e";
    ctx.fillRect(-4, -12, 8, 22);
    ctx.fillRect(-11, -4, 22, 7);
    ctx.fillStyle = "#f1e4b9";
    ctx.fillRect(-2.5, -10, 5, 16);
    ctx.fillRect(-8, -3.5, 16, 3.5);
    ctx.strokeStyle = "rgba(255, 247, 211, 0.5)";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-14, 9, 11, 5);
    ctx.restore();
  }

  function drawCarrier(route) {
    if (route.status === "delivered" || route.status === "crashed") return;
    if (route.status === "recovering") {
      drawRecoveryRope(route);
    }

    const point = cablePoint(route, route.progress);
    const angle = cableTangent(route, route.progress);
    const sway = route.status === "moving"
      ? Math.sin(state.elapsed * 4.7 + route.windPhase) * 0.12 + route.sway * 0.18
      : Math.sin(state.elapsed * 1.4 + route.windPhase) * 0.045;
    const cargoY = point.y + 34;

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle * 0.13);
    ctx.strokeStyle = "#a9ad91";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 19);
    ctx.stroke();

    ctx.fillStyle = "#2c3b2f";
    ctx.beginPath();
    ctx.arc(-3, -3, 5, 0, Math.PI * 2);
    ctx.arc(5, -3, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#cad2b2";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.translate(0, 31);
    ctx.rotate(sway);
    ctx.strokeStyle = "#8c917c";
    ctx.beginPath();
    ctx.moveTo(-11, -13);
    ctx.lineTo(-11, -8);
    ctx.moveTo(11, -13);
    ctx.lineTo(11, -8);
    ctx.stroke();
    drawCrate(0, 0, 0.9, route, 0);
    ctx.restore();

    if (route.status === "moving") {
      drawSpeedPips(point, route);
    }
  }

  function drawSpeedPips(point, route) {
    const dangerous = route.speed > SAFE_MAX;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = dangerous ? "#ff7a5c" : "#d8ef91";
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i += 1) {
      const offset = 11 + i * 8;
      ctx.beginPath();
      ctx.moveTo(point.x - offset, point.y + 48);
      ctx.lineTo(point.x - offset - 7, point.y + 54);
      ctx.stroke();
    }
    ctx.restore();
    if (dangerous) {
      ctx.fillStyle = "#ff9c82";
      ctx.font = "700 9px 'Trebuchet MS', 'Canopy Sans', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("过速", point.x, point.y + 69);
    }
  }

  function drawRecoveryRope(route) {
    const packagePoint = cablePoint(route, route.progress);
    const rope = cablePoint(route, Math.max(0, route.progress - 0.07));
    ctx.save();
    ctx.strokeStyle = "rgba(255, 189, 104, 0.82)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(route.start.x - 6, route.start.y + 9);
    ctx.quadraticCurveTo(
      (route.start.x + packagePoint.x) / 2,
      Math.max(route.start.y, packagePoint.y) + 58,
      packagePoint.x - 7,
      packagePoint.y + 28
    );
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffbd68";
    ctx.beginPath();
    ctx.arc(rope.x - 7, rope.y + 24, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCrashDebris() {
    sparks.forEach((particle) => {
      if (particle.life <= 0) return;
      ctx.save();
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.fillRect(-particle.size * 0.5, -particle.size * 0.35, particle.size, particle.size * 0.7);
      ctx.restore();
    });
  }

  function drawCrashedCargo() {
    const route = routes.find((item) => item.status === "crashed");
    if (!route) return;
    const age = Math.max(0, (state.elapsed - route.crashAt));
    const x = route.end.x + age * 42;
    const y = route.end.y + 20 - Math.max(0, 65 * age - 45 * age * age);
    if (age < 2.2) drawCrate(x, y, 0.85, route, age * 5);
  }

  function updateAmbient(dt) {
    const wind = windAt(state.elapsed, selectedRoute().windPhase);
    rainDrops.forEach((drop) => {
      drop.y += drop.speed * dt * (60 / 60);
      drop.x += wind * 23 * dt + 2.2 * dt;
      if (drop.y > H + 30) {
        drop.y = -30 - Math.random() * 120;
        drop.x = Math.random() * W;
      }
      if (drop.x > W + 30) drop.x = -20;
      if (drop.x < -30) drop.x = W + 10;
    });

    mistMotes.forEach((mote) => {
      mote.x += (wind * 7 + mote.speed) * dt;
      mote.y += Math.sin(state.elapsed * 0.6 + mote.phase) * dt * 4;
      if (mote.x > W + 20) mote.x = -20;
    });

    sparks.forEach((particle) => {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 22 * dt;
      particle.rotation += particle.spin * dt;
    });
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      if (sparks[i].life <= 0) sparks.splice(i, 1);
    }

    splashes.forEach((splash) => {
      splash.life -= dt;
      splash.radius += dt * 13;
    });
    for (let i = splashes.length - 1; i >= 0; i -= 1) {
      if (splashes[i].life <= 0) splashes.splice(i, 1);
    }
    if (!state.reducedMotion && Math.random() < dt * 7) {
      splashes.push({
        x: target.x + (Math.random() - 0.5) * 230,
        y: target.deckY + (Math.random() - 0.5) * 35,
        radius: 1,
        life: 0.22 + Math.random() * 0.25,
        maxLife: 0.47,
      });
    }
  }

  function drawRain() {
    const wind = windAt(state.elapsed, selectedRoute().windPhase);
    ctx.save();
    ctx.lineCap = "round";
    rainDrops.forEach((drop) => {
      ctx.globalAlpha = drop.alpha * (drop.layer > 0.65 ? 1 : 0.65);
      ctx.lineWidth = drop.layer > 0.65 ? 1.05 : 0.65;
      ctx.strokeStyle = "#d9ebd8";
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - wind * drop.length * 0.5, drop.y - drop.length);
      ctx.stroke();
    });
    ctx.restore();

    ctx.save();
    mistMotes.forEach((mote) => {
      ctx.globalAlpha = 0.07 + (Math.sin(state.elapsed + mote.phase) + 1) * 0.025;
      ctx.fillStyle = "#c6d8ba";
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawSplashes() {
    ctx.save();
    ctx.strokeStyle = "rgba(214, 235, 208, 0.42)";
    ctx.lineWidth = 1;
    splashes.forEach((splash) => {
      ctx.globalAlpha = clamp(splash.life / splash.maxLife, 0, 1) * 0.5;
      ctx.beginPath();
      ctx.ellipse(splash.x, splash.y, splash.radius, splash.radius * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawWindGusts() {
    const signal = windAt(state.elapsed, selectedRoute().windPhase);
    if (signal < 0.45) return;
    ctx.save();
    ctx.globalAlpha = clamp((signal - 0.45) * 0.5, 0, 0.24);
    ctx.strokeStyle = "#ddecbc";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i += 1) {
      const x = 390 + i * 133 + Math.sin(state.elapsed + i) * 18;
      const y = 105 + i * 42;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 55, y - 12, x + 92, y + 12, x + 148, y - 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  function spawnCrash(route) {
    const origin = cablePoint(route, 1);
    const colors = ["#ffbd68", "#ff7a5c", "#d8ef91", "#f1e4b9", "#586c42"];
    for (let i = 0; i < 48; i += 1) {
      const angle = -Math.PI * (0.15 + Math.random() * 0.75);
      const velocity = 24 + Math.random() * 95;
      sparks.push({
        x: origin.x,
        y: origin.y + 18,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        size: 2 + Math.random() * 7,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 8,
        life: 0.65 + Math.random() * 0.9,
        maxLife: 1.55,
      });
    }
  }

  function drawScene() {
    drawBackground();
    drawTrunks();
    drawCanopy();
    drawTargetPlatform();
    drawLaunchStations();
    drawCables();
    routes.forEach(drawCarrier);
    drawCrashedCargo();
    drawCrashDebris();
    drawWindGusts();
    drawRain();
    drawSplashes();

    const vignette = ctx.createRadialGradient(W * 0.54, H * 0.45, 280, W * 0.54, H * 0.45, 880);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.73, "rgba(0, 0, 0, 0.08)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function accelerationFor(route, progress, speed, brake, time) {
    const loadFactor = Math.sqrt(route.mass / 18);
    const wind = windAt(time, route.windPhase);
    const grade = route.gravity * (1 - progress * 0.22);
    const windForce = (wind * route.windExposure * 1.45) / loadFactor;
    const sagFriction =
      (route.sag / 80) * 0.2 * (0.58 + 0.42 * Math.sin(progress * Math.PI));
    const drag = (0.0078 * speed * speed) / loadFactor;
    const bite = 0.55 + 0.45 * clamp(speed / SAFE_MAX, 0, 1.15);
    const brakeForce = (brake / 100) * route.brakePower * bite / loadFactor;
    return {
      total: grade + windForce - sagFriction - drag - brakeForce,
      wind,
      loadFactor,
      sagFriction,
      brakeForce,
    };
  }

  function estimateArrival(route) {
    let progress = route.status === "ready" || route.status === "queued" ? 0 : route.progress;
    let speed = route.status === "ready" || route.status === "queued" ? route.startSpeed : route.speed;
    let simulatedTime = state.elapsed + route.countdown;
    const dt = 0.04;
    for (let step = 0; step < 900; step += 1) {
      if (speed <= 0.35) return { speed: 0, stalled: true };
      const physics = accelerationFor(route, progress, speed, route.brake, simulatedTime);
      speed = Math.max(0, speed + physics.total * dt);
      progress += (speed * dt) / route.length;
      simulatedTime += dt;
      if (progress >= 1) return { speed, stalled: false };
    }
    return { speed, stalled: true };
  }

  function launchRoute(route) {
    route.status = "moving";
    route.progress = 0.002;
    route.speed = route.startSpeed;
    route.countdown = 0;
    route.attempts += 1;
    route.arrivalSpeed = 0;
    if (!state.runActive) {
      state.runActive = true;
      state.runStartElapsed = state.elapsed;
    }
    showToast(`${route.id} 线放行：${route.cargo} 已离站`, "info", 1900);
  }

  function updateRoutes(dt) {
    if (state.failed) return;
    routes.forEach((route) => {
      if (route.status === "queued") {
        route.countdown = Math.max(0, route.countdown - dt);
        if (route.countdown <= 0) launchRoute(route);
        return;
      }

      if (route.status === "recovering") {
        route.progress = Math.max(0, route.progress - dt * 0.24);
        if (route.progress <= 0) {
          route.status = "ready";
          route.speed = 0;
          route.sway = 0;
          showToast(`${route.id} 线吊包已拉回，可重新放行`, "info");
        }
        return;
      }

      if (route.status !== "moving") return;

      const physics = accelerationFor(
        route,
        route.progress,
        route.speed,
        route.brake,
        state.elapsed
      );
      route.speed = Math.max(0, route.speed + physics.total * dt);
      route.progress += (route.speed * dt) / route.length;
      route.sway = clamp(physics.wind * route.windExposure, -1, 1);

      if (route.speed < 0.28 && route.progress < 0.965) {
        route.speed = 0;
        route.status = "stalled";
        route.stalledAt = state.elapsed;
        showToast(`${route.id} 线停在线路中间，等待回收绳`, "warn", 3500);
        return;
      }

      if (route.progress >= 1) {
        route.progress = 1;
        route.arrivalSpeed = route.speed;
        if (route.speed > SAFE_MAX) {
          crashRoute(route);
        } else {
          deliverRoute(route);
        }
      }
    });
  }

  function crashRoute(route) {
    route.status = "crashed";
    route.crashAt = state.elapsed;
    route.speed = 0;
    state.failed = true;
    state.totalCrashes += 1;
    state.shake = 1;
    spawnCrash(route);
    impactSound();
    showToast(
      `${route.id} 线到站 ${route.arrivalSpeed.toFixed(1)} m/s，撞击树冠平台！`,
      "danger",
      3800
    );
    state.modalTimer = 1.25;
    state.modalKind = "crash";
  }

  function deliverRoute(route) {
    route.status = "delivered";
    route.speed = 0;
    route.deliveredAt = state.elapsed;
    route.progress = 1;
    state.delivered += 1;
    successSound();
    const low = route.arrivalSpeed < SAFE_MIN;
    showToast(
      `${route.cargo} 送达 · 到站 ${route.arrivalSpeed.toFixed(1)} m/s${low ? " · 低速靠站" : ""}`,
      "info",
      2800
    );
    if (state.delivered === 3) {
      state.finishTime = state.elapsed - state.runStartElapsed;
      state.modalTimer = 1.35;
      state.modalKind = "success";
    }
  }

  function beginRecovery(route) {
    if (route.status !== "stalled") return;
    route.status = "recovering";
    state.totalRecoveries += 1;
    tone(235, 0.15, 0.04, "triangle");
    showToast("回收绳已抛出，队友正在拉回吊包", "warn", 2400);
  }

  function showToast(message, type = "info", duration = 2600) {
    clearTimeout(state.toastTimer);
    ui.toast.textContent = message;
    ui.toast.className = `toast is-visible${type === "danger" ? " is-danger" : type === "warn" ? " is-warn" : ""}`;
    state.toastTimer = setTimeout(() => {
      ui.toast.className = "toast";
    }, duration);
  }

  function paintRange(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const percent = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--fill", `${percent}%`);
  }

  function routeStatusText(route) {
    switch (route.status) {
      case "queued":
        return `${route.countdown.toFixed(1)} s`;
      case "moving":
        return `${route.speed.toFixed(1)} m/s`;
      case "stalled":
        return "悬挂 · 需回收";
      case "recovering":
        return "回收中";
      case "delivered":
        return "已送达";
      case "crashed":
        return "撞毁";
      default:
        return "待发";
    }
  }

  function syncConsole() {
    const route = selectedRoute();
    ui.selectedLetter.textContent = route.id;
    ui.selectedName.textContent = route.name;
    ui.cargoTag.textContent = `${route.cargo} ${route.mass} kg`;
    ui.factSag.textContent = `${route.sag} m`;
    ui.factWind.textContent = route.windExposure > 0.8 ? "高" : route.windExposure > 0.5 ? "中" : "低";
    ui.delay.value = route.delay;
    ui.brake.value = route.brake;
    ui.delayOutput.textContent = `${Number(route.delay).toFixed(1)} s`;
    ui.brakeOutput.textContent = `${route.brake}%`;
    paintRange(ui.delay);
    paintRange(ui.brake);

    $$(".route-card").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.route === route.id);
    });
  }

  function setSelectedRoute(id) {
    const route = routeById(id);
    if (!route || route.id === state.selected) return;
    state.selected = id;
    syncConsole();
    updateUI();
  }

  function updateUI() {
    const route = selectedRoute();
    const signal = windAt(state.elapsed, route.windPhase);
    ui.windSpeed.textContent = `${signal >= 0 ? "+" : ""}${(signal * 4.6).toFixed(1)} m/s`;
    ui.windNeedle.style.left = `${clamp(50 + signal * 34, 8, 92)}%`;

    ui.delivered.textContent = String(state.delivered);
    ui.progress.style.width = `${(state.delivered / 3) * 100}%`;
    ui.speed.textContent =
      route.status === "moving" || route.status === "queued"
        ? route.speed.toFixed(1)
        : "0.0";

    if (route.status === "delivered" || route.status === "crashed") {
      ui.arrival.textContent = `${route.arrivalSpeed.toFixed(1)} m/s`;
      ui.arrival.style.color = route.arrivalSpeed > SAFE_MAX ? "#ff7a5c" : "#d8ef91";
    } else {
      const estimate = estimateArrival(route);
      if (estimate.stalled) {
        ui.arrival.textContent = "将停滞";
        ui.arrival.style.color = "#ffbd68";
      } else if (estimate.speed > SAFE_MAX) {
        ui.arrival.textContent = `≈ ${estimate.speed.toFixed(1)} · 过速`;
        ui.arrival.style.color = "#ff7a5c";
      } else {
        ui.arrival.textContent = `≈ ${estimate.speed.toFixed(1)} m/s`;
        ui.arrival.style.color =
          estimate.speed < SAFE_MIN ? "#ffbd68" : "#d8ef91";
      }
    }

    $$(".route-card").forEach((card) => {
      const item = routeById(card.dataset.route);
      const status = card.querySelector(".route-status");
      status.textContent = routeStatusText(item);
      card.classList.toggle("is-busy", ["queued", "moving", "recovering"].includes(item.status));
      card.classList.toggle("is-done", item.status === "delivered");
      card.classList.toggle("is-failed", item.status === "crashed");
    });

    const locked = route.status !== "ready" || state.failed || state.modalOpen;
    ui.delay.disabled = locked;
    ui.brake.disabled = locked;
    ui.recover.hidden = route.status !== "stalled" || state.failed;
    ui.dispatch.disabled = state.failed || state.modalOpen;

    if (route.status === "ready") {
      ui.dispatchLabel.textContent = "放行急救包";
      ui.dispatchNote.textContent = "按下后开始延时计时";
      ui.dispatchIcon.textContent = "↗";
    } else if (route.status === "queued") {
      ui.dispatchLabel.textContent = "取消延时";
      ui.dispatchNote.textContent = `${route.countdown.toFixed(1)} 秒后自动脱离`;
      ui.dispatchIcon.textContent = "×";
    } else if (route.status === "moving") {
      ui.dispatch.disabled = true;
      ui.dispatchLabel.textContent = "吊包滑行中";
      ui.dispatchNote.textContent = `到站余量 ${Math.max(0, ((1 - route.progress) * route.length)).toFixed(1)} m · 制动 ${route.brake}%`;
      ui.dispatchIcon.textContent = "◎";
    } else if (route.status === "stalled") {
      ui.dispatch.disabled = true;
      ui.dispatchLabel.textContent = "等待回收";
      ui.dispatchNote.textContent = "回收绳可把吊包拉回出发点";
      ui.dispatchIcon.textContent = "!";
    } else if (route.status === "recovering") {
      ui.dispatch.disabled = true;
      ui.dispatchLabel.textContent = "回收中";
      ui.dispatchNote.textContent = "队友正在拉动回收绳";
      ui.dispatchIcon.textContent = "↙";
    } else if (route.status === "delivered") {
      ui.dispatch.disabled = true;
      ui.dispatchLabel.textContent = "已送达";
      ui.dispatchNote.textContent = `到站速度 ${route.arrivalSpeed.toFixed(1)} m/s`;
      ui.dispatchIcon.textContent = "✓";
    } else if (route.status === "crashed") {
      ui.dispatch.disabled = true;
      ui.dispatchLabel.textContent = "吊包撞毁";
      ui.dispatchNote.textContent = `${route.arrivalSpeed.toFixed(1)} m/s 超过结构限速`;
      ui.dispatchIcon.textContent = "×";
    }
  }

  function handleDispatch() {
    const route = selectedRoute();
    if (state.failed || state.modalOpen) return;
    if (route.status === "queued") {
      route.status = "ready";
      route.countdown = 0;
      showToast(`${route.id} 线已取消放行`, "info", 1700);
      return;
    }
    if (route.status !== "ready") return;
    route.brake = Number(ui.brake.value);
    route.delay = Number(ui.delay.value);
    if (route.delay > 0) {
      route.status = "queued";
      route.countdown = route.delay;
      showToast(`${route.id} 线已挂载，${route.delay.toFixed(1)} 秒后放行`, "info", 1900);
    } else {
      launchRoute(route);
    }
  }

  function openModal(kind) {
    if (state.modalOpen) return;
    state.modalOpen = true;
    ui.modal.hidden = false;
    if (kind === "success") {
      ui.modalKicker.textContent = "DELIVERY COMPLETE";
      ui.modalTitle.textContent = "三包全部送达";
      ui.modalCopy.textContent =
        "救护站补给已补齐。三条滑索的最后一包均低于平台结构限速，树冠平台保持完好。";
      ui.modalStats.innerHTML = `
        <span>总用时<b>${state.finishTime.toFixed(1)} s</b></span>
        <span>回收次数<b>${state.totalRecoveries}</b></span>
        <span>撞击次数<b>${state.totalCrashes}</b></span>`;
      ui.modalAction.textContent = "再来一次";
    } else {
      const crashed = routes.find((route) => route.status === "crashed") || selectedRoute();
      ui.modalKicker.textContent = "IMPACT REPORT";
      ui.modalTitle.textContent = "树冠平台撞击";
      ui.modalCopy.textContent =
        `${crashed.id} 线到达时速度 ${crashed.arrivalSpeed.toFixed(1)} m/s，超过 ${SAFE_MAX.toFixed(1)} m/s 的结构限速。需要更强的制动或换一个风隙放行。`;
      ui.modalStats.innerHTML = `
        <span>到站速度<b>${crashed.arrivalSpeed.toFixed(1)} m/s</b></span>
        <span>已送达<b>${state.delivered} / 3</b></span>
        <span>制动设定<b>${crashed.brake}%</b></span>`;
      ui.modalAction.textContent = "重新布置三包";
    }
  }

  function resetRun() {
    routes.forEach((route) => {
      route.status = "ready";
      route.progress = 0;
      route.speed = 0;
      route.countdown = 0;
      route.brake = route.defaultBrake;
      route.delay = 0;
      route.attempts = 0;
      route.arrivalSpeed = 0;
      route.sway = 0;
    });
    Object.assign(state, {
      selected: "A",
      delivered: 0,
      totalCrashes: 0,
      totalRecoveries: 0,
      failed: false,
      modalOpen: false,
      modalTimer: 0,
      modalKind: "",
      finishTime: 0,
      runActive: false,
      runStartElapsed: 0,
      shake: 0,
    });
    sparks.splice(0);
    splashes.splice(0);
    ui.modal.hidden = true;
    syncConsole();
    updateUI();
    showToast("三个急救包已重新挂载", "info", 1800);
  }

  function bindEvents() {
    $$(".route-card").forEach((card) => {
      card.addEventListener("click", () => setSelectedRoute(card.dataset.route));
    });

    ui.delay.addEventListener("input", () => {
      const route = selectedRoute();
      route.delay = Number(ui.delay.value);
      ui.delayOutput.textContent = `${route.delay.toFixed(1)} s`;
      paintRange(ui.delay);
    });

    ui.brake.addEventListener("input", () => {
      const route = selectedRoute();
      route.brake = Number(ui.brake.value);
      ui.brakeOutput.textContent = `${route.brake}%`;
      paintRange(ui.brake);
    });

    ui.dispatch.addEventListener("click", handleDispatch);
    ui.recover.addEventListener("click", () => beginRecovery(selectedRoute()));
    ui.modalAction.addEventListener("click", resetRun);

    ui.audioButton.addEventListener("click", () => {
      setAudioEnabled(!state.audioEnabled).catch(() => {
        showToast("音频初始化失败，请检查浏览器权限", "warn");
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        setSelectedRoute(["A", "B", "C"][Number(event.key) - 1]);
      } else if (event.code === "Space") {
        event.preventDefault();
        handleDispatch();
      }
    });

    window.addEventListener("resize", resizeCanvas);
  }

  function drawFrame() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(
      viewport.scale,
      0,
      0,
      viewport.scale,
      viewport.offsetX,
      viewport.offsetY
    );
    ctx.save();
    if (state.shake > 0.01) {
      ctx.translate(
        (Math.random() - 0.5) * state.shake * 13,
        (Math.random() - 0.5) * state.shake * 9
      );
    }
    drawScene();
    ctx.restore();
  }

  function frame(now) {
    const dt = clamp((now - state.lastTime) / 1000, 0, 0.045);
    state.lastTime = now;
    state.elapsed += dt;
    updateAmbient(dt);
    updateRoutes(dt);
    updateAudio();

    if (state.modalTimer > 0) {
      state.modalTimer -= dt;
      if (state.modalTimer <= 0 && !state.modalOpen) {
        openModal(state.modalKind);
      }
    }
    state.shake = Math.max(0, state.shake - dt * 2.8);
    updateUI();
    drawFrame();
    requestAnimationFrame(frame);
  }

  function snapshot() {
    return {
      delivered: state.delivered,
      failed: state.failed,
      modalOpen: state.modalOpen,
      modalKind: state.modalKind,
      selected: state.selected,
      totalRecoveries: state.totalRecoveries,
      totalCrashes: state.totalCrashes,
      finishTime: state.finishTime,
      audioEnabled: state.audioEnabled,
      audioContextState: audio.context?.state || "uninitialized",
      routes: routes.map((route) => ({
        id: route.id,
        status: route.status,
        progress: route.progress,
        speed: route.speed,
        brake: route.brake,
        delay: route.delay,
        arrivalSpeed: route.arrivalSpeed,
      })),
    };
  }

  window.__canopyGame = {
    snapshot,
    selectRoute: setSelectedRoute,
    dispatch: handleDispatch,
    recover: () => beginRecovery(selectedRoute()),
    reset: resetRun,
    setAudio: setAudioEnabled,
    constants: { SAFE_MIN, SAFE_MAX },
  };

  resizeCanvas();
  bindEvents();
  syncConsole();
  updateUI();
  requestAnimationFrame(frame);
})();
