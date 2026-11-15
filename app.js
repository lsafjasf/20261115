(() => {
  "use strict";

  const canvas = document.querySelector("#skyCanvas");
  const ctx = canvas.getContext("2d");
  const sceneCard = document.querySelector("#sceneCard");

  const ui = {
    livePill: document.querySelector("#livePill"),
    liveLabel: document.querySelector("#liveLabel"),
    simClock: document.querySelector("#simClock"),
    targetHint: document.querySelector("#targetHint"),
    targetHintText: document.querySelector("#targetHintText"),
    pauseCurtain: document.querySelector("#pauseCurtain"),
    pauseButton: document.querySelector("#pauseButton"),
    pauseButtonText: document.querySelector("#pauseButtonText"),
    pauseIcon: document.querySelector("#pauseIcon"),
    startButton: document.querySelector("#startButton"),
    startButtonText: document.querySelector("#startButtonText"),
    finishButton: document.querySelector("#finishButton"),
    resetButton: document.querySelector("#resetButton"),
    measurementTitle: document.querySelector("#measurementTitle"),
    trialBadge: document.querySelector("#trialBadge"),
    displacementValue: document.querySelector("#displacementValue"),
    displacementMeta: document.querySelector("#displacementMeta"),
    timeValue: document.querySelector("#timeValue"),
    speedValue: document.querySelector("#speedValue"),
    formulaText: document.querySelector("#formulaText"),
    trialRows: [...document.querySelectorAll(".trial-row")],
    toleranceValue: document.querySelector("#toleranceValue"),
    toleranceCopy: document.querySelector("#toleranceCopy"),
    progressBar: document.querySelector("#progressBar"),
    progressText: document.querySelector("#progressText"),
    progressState: document.querySelector("#progressState"),
    verdict: document.querySelector("#verdict"),
    verdictMark: document.querySelector("#verdictMark"),
    verdictTitle: document.querySelector("#verdictTitle"),
    verdictCopy: document.querySelector("#verdictCopy"),
    reticle: document.querySelector(".camera-reticle"),
  };

  const CONFIG = {
    metersPerPixel: 0.32,
    tolerancePct: 6,
    minDuration: 1.4,
    targetTrials: 3,
    cloudSpeedMin: 22,
    cloudSpeedMax: 26,
  };

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    paused: false,
    simTime: 0,
    lastFrame: performance.now(),
    clouds: [],
    noiseTiles: [],
    mode: "idle",
    selectedCloudId: null,
    drawRect: null,
    drag: null,
    measurement: null,
    trials: [],
    toastTimer: 0,
    toastText: "",
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function mulberry32(seed) {
    return function random() {
      let value = (seed += 0x6d2b79f5);
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function formatClock(seconds) {
    const whole = Math.max(0, seconds);
    const minutes = Math.floor(whole / 60);
    const secs = whole % 60;
    return `${String(minutes).padStart(2, "0")}:${secs.toFixed(1).padStart(4, "0")}`;
  }

  function rounded(value, digits) {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
  }

  function speedFromPixels(pixels, seconds) {
    if (seconds <= 0) return 0;
    return Math.abs(pixels) * CONFIG.metersPerPixel * 3.6 / seconds;
  }

  function makeNoiseTile(seed, width, height) {
    const tile = document.createElement("canvas");
    tile.width = width;
    tile.height = height;
    const noiseCtx = tile.getContext("2d");
    const image = noiseCtx.createImageData(width, height);
    const random = mulberry32(seed);

    for (let index = 0; index < image.data.length; index += 4) {
      const grain = Math.floor(random() * 255);
      image.data[index] = grain;
      image.data[index + 1] = grain;
      image.data[index + 2] = grain;
      image.data[index + 3] = Math.floor(random() * 24);
    }

    noiseCtx.putImageData(image, 0, 0);
    return tile;
  }

  function buildCloudSprite(seed, variant) {
    const sprite = document.createElement("canvas");
    sprite.width = 420;
    sprite.height = 220;
    const spriteCtx = sprite.getContext("2d");
    const random = mulberry32(seed);
    const puffCount = 8 + Math.floor(random() * 5);
    const coreX = 210 + (random() - 0.5) * 35;
    const coreY = 126 + (random() - 0.5) * 10;

    spriteCtx.save();
    spriteCtx.filter = "blur(7px)";

    for (let index = 0; index < puffCount; index += 1) {
      const spread = index / (puffCount - 1) - 0.5;
      const radiusX = 36 + random() * 58;
      const radiusY = 32 + random() * 45;
      const x = coreX + spread * 230 + (random() - 0.5) * 18;
      const y = coreY - Math.abs(spread) * 35 + (random() - 0.5) * 20;
      const shade = 212 + Math.floor(random() * 34);
      const alpha = 0.48 + random() * 0.32;
      const gradient = spriteCtx.createRadialGradient(x, y - 8, 2, x, y, radiusX);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      gradient.addColorStop(0.46, `rgba(${shade}, ${shade + 6}, ${shade + 9}, ${alpha * 0.9})`);
      gradient.addColorStop(1, "rgba(196, 210, 216, 0)");
      spriteCtx.fillStyle = gradient;
      spriteCtx.beginPath();
      spriteCtx.ellipse(x, y, radiusX, radiusY, (random() - 0.5) * 0.2, 0, Math.PI * 2);
      spriteCtx.fill();
    }

    const lowerShade = spriteCtx.createLinearGradient(0, 112, 0, 178);
    lowerShade.addColorStop(0, "rgba(124, 145, 153, 0)");
    lowerShade.addColorStop(0.65, "rgba(112, 132, 141, 0.24)");
    lowerShade.addColorStop(1, "rgba(92, 112, 123, 0)");
    spriteCtx.fillStyle = lowerShade;
    spriteCtx.fillRect(55, 80, 320, 110);

    spriteCtx.filter = "none";
    spriteCtx.globalCompositeOperation = "source-atop";
    const topLight = spriteCtx.createLinearGradient(0, 42, 0, 190);
    topLight.addColorStop(0, "rgba(255, 253, 237, 0.5)");
    topLight.addColorStop(0.52, "rgba(255, 255, 255, 0.08)");
    topLight.addColorStop(1, "rgba(84, 110, 122, 0.24)");
    spriteCtx.fillStyle = topLight;
    spriteCtx.fillRect(20, 20, 380, 190);

    if (variant === "wispy") {
      spriteCtx.globalCompositeOperation = "destination-out";
      spriteCtx.filter = "blur(8px)";
      for (let index = 0; index < 7; index += 1) {
        const x = 110 + random() * 210;
        const y = 74 + random() * 95;
        spriteCtx.fillStyle = "rgba(0, 0, 0, 0.08)";
        spriteCtx.beginPath();
        spriteCtx.ellipse(x, y, 48 + random() * 55, 5 + random() * 8, (random() - 0.5) * 0.22, 0, Math.PI * 2);
        spriteCtx.fill();
      }
    }

    spriteCtx.restore();
    return sprite;
  }

  function createClouds() {
    state.clouds = [];
    const random = mulberry32(73191);
    const count = Math.max(7, Math.min(11, Math.round(state.width / 170)));

    for (let index = 0; index < count; index += 1) {
      const scale = 0.66 + random() * 0.7;
      const width = 225 * scale;
      const height = 118 * scale;
      const speed = CONFIG.cloudSpeedMin + random() * (CONFIG.cloudSpeedMax - CONFIG.cloudSpeedMin);
      const x = (index / count) * (state.width + width * 1.6) - width * 0.8 + random() * 50;
      const y = state.height * (0.12 + random() * 0.48);

      state.clouds.push({
        id: `cloud-${index + 1}`,
        x,
        y,
        width,
        height,
        scale,
        speed,
        opacity: 0.48 + scale * 0.3,
        depth: 0.7 + scale * 0.42,
        sprite: buildCloudSprite(9021 + index * 991, index % 4 === 1 ? "wispy" : "solid"),
      });
    }

    state.clouds.sort((a, b) => a.scale - b.scale);
  }

  function updateClouds(delta) {
    const wrapWidth = state.width + 260;
    for (const cloud of state.clouds) {
      cloud.x += cloud.speed * delta;
      if (cloud.x > state.width + cloud.width * 0.55) {
        cloud.x = -cloud.width * 1.25;
        cloud.y = state.height * (0.1 + Math.random() * 0.5);
      }
      if (cloud.x < -cloud.width * 1.4) {
        cloud.x = state.width + cloud.width * 0.45;
      }
      if (Math.abs(cloud.x - wrapWidth) > wrapWidth) {
        cloud.x = 0;
      }
    }
  }

  function resizeCanvas() {
    const bounds = sceneCard.getBoundingClientRect();
    const previousWidth = state.width;
    const previousHeight = state.height;

    state.width = Math.max(1, Math.round(bounds.width));
    state.height = Math.max(1, Math.round(bounds.height));
    state.dpr = Math.min(2, window.devicePixelRatio || 1);

    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    if (state.clouds.length && previousWidth && previousHeight) {
      const xRatio = state.width / previousWidth;
      const yRatio = state.height / previousHeight;
      for (const cloud of state.clouds) {
        cloud.x *= xRatio;
        cloud.y *= yRatio;
      }
    }

    if (!state.clouds.length && state.width > 0) {
      createClouds();
    }
    createNoiseTiles();
  }

  function createNoiseTiles() {
    state.noiseTiles = [];
    for (let index = 0; index < 5; index += 1) {
      state.noiseTiles.push(makeNoiseTile(4100 + index * 57, 180, 130));
    }
  }

  function drawSky() {
    const slowLight = Math.sin(state.simTime * 0.085) * 0.5 + 0.5;
    const driftLight = Math.sin(state.simTime * 0.023 + 1.8) * 0.18;
    const topHue = 194 - slowLight * 6;
    const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
    gradient.addColorStop(0, `hsl(${topHue} 30% ${19 + slowLight * 3}%)`);
    gradient.addColorStop(0.42, `hsl(${topHue + 8} 22% ${31 + slowLight * 4}%)`);
    gradient.addColorStop(0.77, `hsl(38 18% ${62 + driftLight * 9}%)`);
    gradient.addColorStop(1, `hsl(30 15% ${50 + driftLight * 7}%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, state.width, state.height);

    const sunX = state.width * 0.79 + Math.sin(state.simTime * 0.012) * 22;
    const sunY = state.height * (0.19 + Math.sin(state.simTime * 0.02) * 0.01);
    const glowRadius = Math.max(180, state.width * 0.34);
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, glowRadius);
    sunGlow.addColorStop(0, `rgba(255, 246, 207, ${0.42 + slowLight * 0.12})`);
    sunGlow.addColorStop(0.18, "rgba(255, 232, 174, 0.15)");
    sunGlow.addColorStop(0.56, "rgba(255, 210, 145, 0.05)");
    sunGlow.addColorStop(1, "rgba(255, 210, 145, 0)");
    ctx.fillStyle = sunGlow;
    ctx.fillRect(0, 0, state.width, state.height);

    ctx.save();
    ctx.globalAlpha = 0.1 + slowLight * 0.05;
    ctx.fillStyle = "rgba(246, 238, 213, 0.55)";
    ctx.beginPath();
    ctx.ellipse(sunX, sunY, 52, 21, -0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const lightSweep = ctx.createLinearGradient(0, 0, state.width, state.height);
    lightSweep.addColorStop(0, "rgba(152, 213, 230, 0.05)");
    lightSweep.addColorStop(0.48, "rgba(255, 236, 194, 0.055)");
    lightSweep.addColorStop(1, "rgba(245, 167, 119, 0.035)");
    ctx.fillStyle = lightSweep;
    ctx.fillRect(0, 0, state.width, state.height);
  }

  function drawClouds() {
    for (const cloud of state.clouds) {
      const breathe = 1 + Math.sin(state.simTime * 0.35 + cloud.depth * 8) * 0.004;
      const drawWidth = cloud.width * breathe;
      const drawHeight = cloud.height * breathe;
      ctx.save();
      ctx.globalAlpha = cloud.opacity;
      ctx.drawImage(
        cloud.sprite,
        cloud.x - drawWidth * 0.1,
        cloud.y - drawHeight * 0.08,
        drawWidth * 1.2,
        drawHeight * 1.2,
      );
      ctx.restore();
    }
  }

  function drawHorizon() {
    const horizon = state.height * 0.85;
    const mist = ctx.createLinearGradient(0, horizon - 90, 0, state.height);
    mist.addColorStop(0, "rgba(232, 226, 205, 0)");
    mist.addColorStop(0.55, "rgba(232, 220, 195, 0.24)");
    mist.addColorStop(1, "rgba(193, 179, 158, 0.34)");
    ctx.fillStyle = mist;
    ctx.fillRect(0, horizon - 90, state.width, state.height - horizon + 90);

    const ridge = ctx.createLinearGradient(0, horizon - 30, 0, state.height);
    ridge.addColorStop(0, "rgba(49, 65, 70, 0)");
    ridge.addColorStop(0.2, "rgba(44, 58, 63, 0.48)");
    ridge.addColorStop(1, "rgba(25, 36, 41, 0.84)");
    ctx.fillStyle = ridge;
    ctx.beginPath();
    ctx.moveTo(0, state.height);
    ctx.lineTo(0, horizon + 22);
    ctx.lineTo(state.width * 0.11, horizon - 15);
    ctx.lineTo(state.width * 0.19, horizon + 17);
    ctx.lineTo(state.width * 0.33, horizon - 33);
    ctx.lineTo(state.width * 0.47, horizon + 12);
    ctx.lineTo(state.width * 0.61, horizon - 23);
    ctx.lineTo(state.width * 0.78, horizon + 16);
    ctx.lineTo(state.width * 0.91, horizon - 9);
    ctx.lineTo(state.width, horizon + 9);
    ctx.lineTo(state.width, state.height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(220, 229, 220, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, horizon + 17);
    ctx.lineTo(state.width, horizon + 17);
    ctx.stroke();
  }

  function drawNoise() {
    if (!state.noiseTiles.length) return;
    const frame = Math.floor(state.simTime * 7) % state.noiseTiles.length;
    const tile = state.noiseTiles[frame];
    const pattern = ctx.createPattern(tile, "repeat");
    const shift = frame * 13;
    const matrix = new DOMMatrix().translate(shift, -frame * 9);
    pattern.setTransform(matrix);
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.restore();

    const flicker = Math.sin(state.simTime * 2.7) * 0.011 + Math.sin(state.simTime * 0.71) * 0.008;
    if (flicker > 0) {
      ctx.save();
      ctx.globalAlpha = flicker;
      ctx.fillStyle = "#fffdf1";
      ctx.fillRect(0, 0, state.width, state.height);
      ctx.restore();
    }
  }

  function drawSelectionRect() {
    if (!state.drawRect) return;
    const rect = state.drawRect;
    const left = Math.min(rect.startX, rect.endX);
    const top = Math.min(rect.startY, rect.endY);
    const width = Math.abs(rect.endX - rect.startX);
    const height = Math.abs(rect.endY - rect.startY);

    ctx.save();
    ctx.fillStyle = "rgba(217, 255, 114, 0.06)";
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = "rgba(217, 255, 114, 0.88)";
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(left + 0.5, top + 0.5, width, height);
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(217, 255, 114, 0.7)";
    ctx.beginPath();
    ctx.moveTo(rect.endX - 8, rect.endY);
    ctx.lineTo(rect.endX + 8, rect.endY);
    ctx.moveTo(rect.endX, rect.endY - 8);
    ctx.lineTo(rect.endX, rect.endY + 8);
    ctx.stroke();
    ctx.restore();
  }

  function cloudCenter(cloud) {
    return {
      x: cloud.x + cloud.width * 0.5,
      y: cloud.y + cloud.height * 0.5,
    };
  }

  function pointInBox(point, box) {
    return (
      point.x >= box.cx - box.w / 2 &&
      point.x <= box.cx + box.w / 2 &&
      point.y >= box.cy - box.h / 2 &&
      point.y <= box.cy + box.h / 2
    );
  }

  function getHandles(box) {
    const left = box.cx - box.w / 2;
    const right = box.cx + box.w / 2;
    const top = box.cy - box.h / 2;
    const bottom = box.cy + box.h / 2;
    return [
      { part: "nw", x: left, y: top },
      { part: "ne", x: right, y: top },
      { part: "se", x: right, y: bottom },
      { part: "sw", x: left, y: bottom },
    ];
  }

  function hitTest(point) {
    const measurement = state.measurement;
    if (!measurement) return null;
    const boxes = [
      { name: "end", box: measurement.end },
      { name: "start", box: measurement.start },
    ];

    for (const entry of boxes) {
      for (const handle of getHandles(entry.box)) {
        if (Math.hypot(point.x - handle.x, point.y - handle.y) <= 13) {
          return { kind: "handle", box: entry.name, part: handle.part };
        }
      }
      if (pointInBox(point, entry.box)) {
        return { kind: "move", box: entry.name, part: "move" };
      }
    }
    return null;
  }

  function syncEndToCloud(measurement) {
    if (!measurement || measurement.frozen) return;
    const cloud = state.clouds.find((item) => item.id === measurement.cloudId);
    if (!cloud) return;
    const center = cloudCenter(cloud);
    measurement.end.cx = center.x + measurement.endOffset.x;
    measurement.end.cy = center.y + measurement.endOffset.y;
  }

  function createMeasurement(cloud) {
    const center = cloudCenter(cloud);
    const width = Math.max(132, cloud.width * 1.12);
    const height = Math.max(66, cloud.height * 1.1);
    const box = { cx: center.x, cy: center.y, w: width, h: height };

    state.selectedCloudId = cloud.id;
    state.measurement = {
      cloudId: cloud.id,
      start: { ...box },
      end: { ...box },
      endOffset: { x: 0, y: 0 },
      startTime: state.simTime,
      duration: 0,
      displacement: 0,
      speed: 0,
      referenceSpeed: cloud.speed * CONFIG.metersPerPixel * 3.6,
      errorPct: 0,
      frozen: false,
      result: null,
    };
    state.mode = "measuring";
    state.drawRect = null;
    showToast("测量已开始 · 拖动角点可修正选框");
    updateInterface();
  }

  function pickCloud(rect) {
    const left = Math.min(rect.startX, rect.endX);
    const right = Math.max(rect.startX, rect.endX);
    const top = Math.min(rect.startY, rect.endY);
    const bottom = Math.max(rect.startY, rect.endY);
    const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
    let best = null;
    let bestScore = Infinity;

    for (const cloud of state.clouds) {
      const cloudPoint = cloudCenter(cloud);
      const cloudLeft = cloud.x - cloud.width * 0.08;
      const cloudRight = cloud.x + cloud.width * 1.08;
      const cloudTop = cloud.y - cloud.height * 0.05;
      const cloudBottom = cloud.y + cloud.height * 1.05;
      const intersects =
        right >= cloudLeft && left <= cloudRight && bottom >= cloudTop && top <= cloudBottom;
      if (!intersects) continue;

      const inside =
        cloudPoint.x >= left &&
        cloudPoint.x <= right &&
        cloudPoint.y >= top &&
        cloudPoint.y <= bottom;
      const distance = Math.hypot(cloudPoint.x - center.x, cloudPoint.y - center.y);
      const score = distance - (inside ? 40 : 0) - cloud.scale * 10;

      if (score < bestScore) {
        best = cloud;
        bestScore = score;
      }
    }
    return best;
  }

  function drawBox(box, role, selected) {
    const left = box.cx - box.w / 2;
    const top = box.cy - box.h / 2;
    const isEnd = role === "end";
    const color = isEnd ? "127, 224, 208" : "217, 255, 114";

    ctx.save();
    ctx.fillStyle = `rgba(${color}, ${selected ? 0.065 : 0.035})`;
    ctx.fillRect(left, top, box.w, box.h);
    ctx.strokeStyle = `rgba(${color}, ${isEnd ? 0.92 : 0.66})`;
    ctx.lineWidth = isEnd ? 1.5 : 1;
    ctx.setLineDash(isEnd ? [] : [7, 5]);
    ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, box.w - 1), Math.max(0, box.h - 1));
    ctx.setLineDash([]);

    const label = isEnd ? "终点 B" : "起点 A";
    const labelWidth = isEnd ? 54 : 54;
    ctx.fillStyle = "rgba(9, 16, 20, 0.74)";
    ctx.beginPath();
    ctx.roundRect(left, top - 24, labelWidth, 18, 5);
    ctx.fill();
    ctx.fillStyle = `rgba(${color}, 0.96)`;
    ctx.font = "600 9px 'Lab Sans SC', ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(label, left + 8, top - 15);

    if (isEnd) {
      ctx.fillStyle = "rgba(127, 224, 208, 0.9)";
      ctx.beginPath();
      ctx.arc(left + box.w - 8, top - 15, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const handle of getHandles(box)) {
      ctx.fillStyle = "rgba(7, 14, 17, 0.9)";
      ctx.strokeStyle = `rgba(${color}, 0.98)`;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.rect(handle.x - 5, handle.y - 5, 10, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = `rgba(${color}, 0.9)`;
      ctx.fillRect(handle.x - 1, handle.y - 1, 2, 2);
    }

    ctx.restore();
  }

  function drawConnector(measurement) {
    const start = measurement.start;
    const end = measurement.end;
    const y = Math.min(start.cy, end.cy) - Math.max(start.h, end.h) / 2 - 42;
    const delta = end.cx - start.cx;
    const midX = (start.cx + end.cx) / 2;

    ctx.save();
    ctx.strokeStyle = "rgba(231, 241, 238, 0.58)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(start.cx, start.cy - start.h / 2);
    ctx.lineTo(start.cx, y);
    ctx.moveTo(end.cx, end.cy - end.h / 2);
    ctx.lineTo(end.cx, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(217, 255, 114, 0.9)";
    ctx.fillStyle = "rgba(217, 255, 114, 0.9)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(start.cx, y);
    ctx.lineTo(end.cx, y);
    ctx.stroke();

    const direction = Math.sign(delta) || 1;
    ctx.beginPath();
    ctx.moveTo(end.cx, y);
    ctx.lineTo(end.cx - direction * 7, y - 4);
    ctx.lineTo(end.cx - direction * 7, y + 4);
    ctx.closePath();
    ctx.fill();

    const text = `Δx ${Math.abs(delta).toFixed(1)} px`;
    ctx.font = "600 10px 'Lab Sans SC', ui-monospace, monospace";
    const textWidth = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(9, 16, 20, 0.86)";
    ctx.beginPath();
    ctx.roundRect(midX - textWidth / 2 - 8, y - 27, textWidth + 16, 20, 7);
    ctx.fill();
    ctx.fillStyle = "#e4ff9a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, midX, y - 17);
    ctx.restore();
  }

  function drawMeasurement() {
    const measurement = state.measurement;
    if (!measurement) return;
    syncEndToCloud(measurement);
    drawConnector(measurement);
    drawBox(measurement.start, "start", true);
    drawBox(measurement.end, "end", true);
  }

  function drawToast() {
    if (!state.toastText) return;
    ctx.save();
    ctx.font = "500 11px 'Lab Sans SC', sans-serif";
    const width = ctx.measureText(state.toastText).width + 30;
    const x = (state.width - width) / 2;
    const y = state.height - 92;
    ctx.fillStyle = "rgba(10, 17, 21, 0.86)";
    ctx.beginPath();
    ctx.roundRect(x, y, width, 32, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(217, 255, 114, 0.22)";
    ctx.stroke();
    ctx.fillStyle = "rgba(239, 247, 242, 0.9)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.toastText, state.width / 2, y + 16);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, state.width, state.height);
    drawSky();
    drawClouds();
    drawHorizon();
    drawNoise();
    drawSelectionRect();
    drawMeasurement();
    drawToast();
  }

  function frame(now) {
    const delta = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;

    if (!state.paused) {
      state.simTime += delta;
      updateClouds(delta);
      if (state.mode === "measuring") {
        syncEndToCloud(state.measurement);
      }
    }

    if (state.toastTimer > 0) {
      state.toastTimer -= delta;
      if (state.toastTimer <= 0) {
        state.toastText = "";
      }
    }

    draw();
    updateLiveInterface();
    requestAnimationFrame(frame);
  }

  function showToast(text) {
    state.toastText = text;
    state.toastTimer = 2.4;
  }

  function measurementValues(measurement) {
    const elapsed = measurement.frozen
      ? measurement.duration
      : Math.max(0, state.simTime - measurement.startTime);
    const displacement = measurement.end.cx - measurement.start.cx;
    const speed = speedFromPixels(displacement, elapsed);
    const errorPct =
      measurement.referenceSpeed > 0
        ? (Math.abs(speed - measurement.referenceSpeed) / measurement.referenceSpeed) * 100
        : 0;
    const valid = elapsed >= CONFIG.minDuration && errorPct <= CONFIG.tolerancePct;

    return {
      elapsed,
      displacement,
      speed,
      errorPct,
      valid,
    };
  }

  function updateFinishedMeasurement() {
    const measurement = state.measurement;
    if (!measurement || state.mode !== "review" || !measurement.result) return;
    const values = measurementValues(measurement);
    measurement.displacement = values.displacement;
    measurement.speed = values.speed;
    measurement.errorPct = values.errorPct;
    measurement.result.displacement = values.displacement;
    measurement.result.speed = values.speed;
    measurement.result.errorPct = values.errorPct;
    measurement.result.valid = values.valid;
    updateTrialUI();
    updateReadout();
  }

  function updateReadout() {
    const measurement = state.measurement;
    let title = "等待下一次测量";

    if (!measurement) {
      ui.displacementValue.textContent = "—";
      ui.timeValue.textContent = "—";
      ui.speedValue.textContent = "—";
      ui.displacementMeta.textContent = "等待框选云团";
      ui.measurementTitle.textContent = state.mode === "armed" ? "请框选目标云团" : title;
      return;
    }

    const values = measurement.frozen
      ? {
          duration: measurement.duration,
          displacement: measurement.displacement,
          speed: measurement.speed,
          errorPct: measurement.errorPct,
        }
      : measurementValues(measurement);
    const elapsed = measurement.frozen ? measurement.duration : values.elapsed;
    const direction = values.displacement >= 0 ? "右移" : "左移";
    const trialNumber = measurement.frozen
      ? measurement.result?.trialNo || state.trials.length
      : state.trials.length + 1;

    title =
      state.mode === "review"
        ? `第 ${Math.max(1, trialNumber)} 次测量 · 已记录`
        : `第 ${trialNumber} 次测量 · 进行中`;
    ui.measurementTitle.textContent = title;
    ui.displacementValue.textContent = Math.abs(values.displacement).toFixed(1);
    ui.timeValue.textContent = elapsed.toFixed(1);
    ui.speedValue.textContent = values.speed.toFixed(1);

    if (state.mode === "review") {
      const valid = measurement.result?.valid ?? measurementValues(measurement).valid;
      ui.displacementMeta.textContent = `${direction} · 偏差 ${values.errorPct.toFixed(1)}% · ${
        valid ? "容差内" : "超出容差"
      }`;
    } else {
      const remaining = Math.max(0, CONFIG.minDuration - elapsed);
      ui.displacementMeta.textContent =
        remaining > 0
          ? `${direction} · 再测量 ${remaining.toFixed(1)} s 可记录`
          : `${direction} · 可拖拽角点修正后记录`;
    }
  }

  function updateButtonState() {
    const elapsed = state.measurement
      ? Math.max(0, state.simTime - state.measurement.startTime)
      : 0;
    ui.finishButton.disabled =
      state.mode !== "measuring" || elapsed < CONFIG.minDuration || state.trials.length >= 3;
    ui.startButton.disabled =
      state.mode === "measuring" || state.mode === "armed" || state.trials.length >= 3;
    ui.startButton.style.opacity = ui.startButton.disabled ? "0.45" : "";
    ui.startButton.style.cursor = ui.startButton.disabled ? "not-allowed" : "";
    if (state.trials.length >= CONFIG.targetTrials) {
      ui.startButtonText.textContent = "已完成";
    } else if (state.mode === "measuring") {
      ui.startButtonText.textContent = "测量中";
    } else if (state.mode === "armed") {
      ui.startButtonText.textContent = "请框选";
    } else if (state.mode === "review") {
      ui.startButtonText.textContent = "下一次测量";
    } else {
      ui.startButtonText.textContent = "开始测量";
    }
  }

  function updateLiveInterface() {
    ui.simClock.textContent = `SIM ${formatClock(state.simTime)}`;
    if (state.mode === "measuring" || state.mode === "review") {
      updateReadout();
    }
    updateButtonState();
  }

  function updateTrialUI() {
    const completed = state.trials.length;
    const validCount = state.trials.filter((trial) => trial.valid).length;
    const allPass = completed === CONFIG.targetTrials && validCount === CONFIG.targetTrials;

    ui.trialBadge.textContent = `${completed} / ${CONFIG.targetTrials}`;
    ui.progressBar.style.width = `${(validCount / CONFIG.targetTrials) * 100}%`;
    ui.progressText.textContent = `${validCount} / ${CONFIG.targetTrials} 次有效`;
    ui.progressState.textContent =
      completed < CONFIG.targetTrials ? "采样中" : allPass ? "已通过" : "未通过";

    ui.trialRows.forEach((row, index) => {
      const trial = state.trials[index];
      row.classList.remove("trial-empty", "is-filled", "is-pass", "is-fail");
      row.classList.add(trial ? "is-filled" : "trial-empty");
      if (trial) row.classList.add(trial.valid ? "is-pass" : "is-fail");

      const status = row.querySelector(".trial-status");
      const data = row.querySelector(".trial-data");
      const error = row.querySelector(".trial-error");
      if (!trial) {
        status.textContent = "待测量";
        data.textContent = "—";
        error.textContent = "—";
        return;
      }
      status.textContent = trial.valid ? "有效" : "超差";
      data.textContent = `${Math.abs(trial.displacement).toFixed(1)}px / ${trial.duration.toFixed(1)}s`;
      error.textContent = `${trial.errorPct.toFixed(1)}%`;
    });

    ui.verdict.classList.toggle("is-pass", allPass);
    if (allPass) {
      ui.verdictMark.textContent = "✓";
      ui.verdictTitle.textContent = "测量验收通过";
      ui.verdictCopy.textContent = "三次测量均在 ±6.0% 容差内";
    } else if (completed === CONFIG.targetTrials) {
      ui.verdictMark.textContent = "!";
      ui.verdictTitle.textContent = "三次测量未通过";
      ui.verdictCopy.textContent = "存在超差记录，请重置后重新测量";
    } else {
      ui.verdictMark.textContent = "✓";
      ui.verdictTitle.textContent = "验收待完成";
      ui.verdictCopy.textContent =
        completed === 0 ? "完成三次测量后自动判定" : `还需 ${CONFIG.targetTrials - completed} 次有效测量`;
    }
  }

  function updateInterface() {
    updateTrialUI();
    updateReadout();
    updateButtonState();

    if (state.mode === "armed") {
      ui.targetHintText.textContent = "拖拽框选一朵云团，释放即开始计时";
      ui.reticle.style.opacity = "0.72";
    } else if (state.mode === "measuring") {
      ui.targetHintText.textContent = "测量进行中 · 可拖拽八个角点修正选框";
      ui.reticle.style.opacity = "0.28";
    } else if (state.mode === "review") {
      ui.targetHintText.textContent = "记录已冻结 · 仍可拖拽角点修正，数据会同步更新";
      ui.reticle.style.opacity = "0.2";
    } else {
      ui.targetHintText.textContent = "拖拽框选一朵云团，释放即开始计时";
      ui.reticle.style.opacity = "0.42";
    }
  }

  function startSelection() {
    if (state.trials.length >= CONFIG.targetTrials) {
      showToast("三次测量已完成，点击右侧“重置”后复测");
      return;
    }
    if (state.mode === "measuring") {
      showToast("请先点击“结束记录”");
      return;
    }
    if (state.mode === "armed") return;
    if (state.paused) setPaused(false);
    state.mode = "armed";
    state.measurement = null;
    state.selectedCloudId = null;
    state.drawRect = null;
    updateInterface();
  }

  function finishMeasurement() {
    const measurement = state.measurement;
    if (!measurement || state.mode !== "measuring") return;
    const values = measurementValues(measurement);
    if (values.elapsed < CONFIG.minDuration) {
      showToast(`至少测量 ${CONFIG.minDuration.toFixed(1)} 秒后才能记录`);
      return;
    }
    if (state.trials.length >= CONFIG.targetTrials) {
      showToast("本次验收已满三次测量");
      return;
    }

    measurement.frozen = true;
    measurement.duration = values.elapsed;
    measurement.displacement = values.displacement;
    measurement.speed = values.speed;
    measurement.errorPct = values.errorPct;
    measurement.result = {
      trialNo: state.trials.length + 1,
      duration: values.elapsed,
      displacement: values.displacement,
      speed: values.speed,
      errorPct: values.errorPct,
      valid: values.valid,
      referenceSpeed: measurement.referenceSpeed,
    };
    state.trials.push(measurement.result);
    state.mode = "review";
    state.drawRect = null;

    if (values.valid) {
      showToast(`第 ${state.trials.length} 次测量已记录 · 偏差 ${values.errorPct.toFixed(1)}%`);
    } else {
      showToast(`第 ${state.trials.length} 次测量超出容差，可拖拽角点修正`);
    }
    updateInterface();
  }

  function resetMeasurements() {
    state.trials = [];
    state.measurement = null;
    state.selectedCloudId = null;
    state.mode = "idle";
    state.drawRect = null;
    state.drag = null;
    showToast("测量记录已重置");
    updateInterface();
  }

  function setPaused(paused) {
    state.paused = paused;
    state.lastFrame = performance.now();
    ui.pauseCurtain.hidden = !paused;
    ui.livePill.classList.toggle("is-paused", paused);
    ui.liveLabel.textContent = paused ? "观测暂停" : "实时观测";
    ui.pauseButtonText.textContent = paused ? "继续观测" : "暂停观测";
    ui.pauseIcon.classList.toggle("is-play", paused);
    if (paused && state.drag) state.drag = null;
    updateLiveInterface();
  }

  function pointerPosition(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  }

  function beginDrag(hit, point) {
    const measurement = state.measurement;
    if (!measurement) return;
    const box = measurement[hit.box];
    state.drag = {
      ...hit,
      origin: point,
      snapshot: { ...box },
    };
    canvas.style.cursor = hit.kind === "move" ? "grabbing" : "nwse-resize";
  }

  function updateDrag(point) {
    const drag = state.drag;
    const measurement = state.measurement;
    if (!drag || !measurement) return;
    const box = measurement[drag.box];
    const snapshot = drag.snapshot;
    const deltaX = point.x - drag.origin.x;
    const deltaY = point.y - drag.origin.y;

    if (drag.part === "move") {
      box.cx = clamp(snapshot.cx + deltaX, 10, state.width - 10);
      box.cy = clamp(snapshot.cy + deltaY, 10, state.height - 10);
    } else {
      const minWidth = 64;
      const minHeight = 36;
      let left = snapshot.cx - snapshot.w / 2;
      let right = snapshot.cx + snapshot.w / 2;
      let top = snapshot.cy - snapshot.h / 2;
      let bottom = snapshot.cy + snapshot.h / 2;

      if (drag.part.includes("w")) left = clamp(left + deltaX, 3, right - minWidth);
      if (drag.part.includes("e")) right = clamp(right + deltaX, left + minWidth, state.width - 3);
      if (drag.part.includes("n")) top = clamp(top + deltaY, 3, bottom - minHeight);
      if (drag.part.includes("s")) bottom = clamp(bottom + deltaY, top + minHeight, state.height - 3);

      box.w = right - left;
      box.h = bottom - top;
      box.cx = (left + right) / 2;
      box.cy = (top + bottom) / 2;
    }

    if (drag.box === "end" && state.mode === "measuring") {
      const cloud = state.clouds.find((item) => item.id === measurement.cloudId);
      if (cloud) {
        const center = cloudCenter(cloud);
        measurement.endOffset.x = box.cx - center.x;
        measurement.endOffset.y = box.cy - center.y;
      }
    }

    if (state.mode === "review") {
      updateFinishedMeasurement();
    } else {
      updateReadout();
    }
  }

  function updateCursor(point) {
    if (state.drawRect || state.mode === "armed" || state.mode === "idle") {
      canvas.style.cursor = "crosshair";
      return;
    }
    const hit = hitTest(point);
    if (!hit) {
      canvas.style.cursor = "default";
    } else if (hit.kind === "move") {
      canvas.style.cursor = "grab";
    } else {
      const vertical = hit.part === "n" || hit.part === "s";
      canvas.style.cursor = vertical ? "ns-resize" : "nwse-resize";
    }
  }

  function onPointerDown(event) {
    if (state.paused || event.button !== 0) return;
    const point = pointerPosition(event);
    const hit = hitTest(point);

    if (hit && state.measurement && state.mode !== "armed") {
      beginDrag(hit, point);
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (state.mode === "idle") {
      startSelection();
    }
    if (state.mode !== "armed") return;

    state.drawRect = {
      startX: point.x,
      startY: point.y,
      endX: point.x,
      endY: point.y,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "crosshair";
    event.preventDefault();
  }

  function onPointerMove(event) {
    const point = pointerPosition(event);
    if (state.drag) {
      updateDrag(point);
      return;
    }
    if (state.drawRect) {
      state.drawRect.endX = clamp(point.x, 0, state.width);
      state.drawRect.endY = clamp(point.y, 0, state.height);
      return;
    }
    if (!state.paused) updateCursor(point);
  }

  function onPointerUp(event) {
    const point = pointerPosition(event);
    if (state.drag) {
      state.drag = null;
      if (state.mode === "review") {
        updateFinishedMeasurement();
        if (state.measurement.result) {
          showToast(`角点已修正 · 偏差 ${state.measurement.result.errorPct.toFixed(1)}%`);
        }
      }
      updateCursor(point);
      return;
    }
    if (!state.drawRect) return;

    state.drawRect.endX = clamp(point.x, 0, state.width);
    state.drawRect.endY = clamp(point.y, 0, state.height);
    const width = Math.abs(state.drawRect.endX - state.drawRect.startX);
    const height = Math.abs(state.drawRect.endY - state.drawRect.startY);

    if (width < 26 || height < 24) {
      state.drawRect = null;
      showToast("框选范围过小，请重新框住一朵云");
      return;
    }

    const cloud = pickCloud(state.drawRect);
    if (!cloud) {
      state.drawRect = null;
      showToast("未找到云团，请重新框选");
      return;
    }
    createMeasurement(cloud);
  }

  function init() {
    resizeCanvas();
    updateInterface();
    setPaused(false);

    ui.startButton.addEventListener("click", startSelection);
    ui.finishButton.addEventListener("click", finishMeasurement);
    ui.pauseButton.addEventListener("click", () => setPaused(!state.paused));
    ui.resetButton.addEventListener("click", resetMeasurements);

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", () => {
      state.drag = null;
      state.drawRect = null;
    });
    canvas.addEventListener("pointerleave", () => {
      if (!state.drawRect && !state.drag) {
        canvas.style.cursor = state.mode === "armed" ? "crosshair" : "default";
      }
    });

    window.addEventListener("resize", resizeCanvas);
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(() => resizeCanvas());
      observer.observe(sceneCard);
    }

    window.cloudLab = {
      getSnapshot() {
        return {
          paused: state.paused,
          simTime: state.simTime,
          mode: state.mode,
          selectedCloudId: state.selectedCloudId,
          clouds: state.clouds.map((cloud) => ({
            id: cloud.id,
            x: cloud.x,
            y: cloud.y,
            width: cloud.width,
            height: cloud.height,
            speed: cloud.speed,
            center: cloudCenter(cloud),
          })),
          measurement: state.measurement
            ? {
                cloudId: state.measurement.cloudId,
                startTime: state.measurement.startTime,
                duration: state.measurement.duration,
                displacement: state.measurement.displacement,
                speed: state.measurement.speed,
                errorPct: state.measurement.errorPct,
                frozen: state.measurement.frozen,
                start: { ...state.measurement.start },
                end: { ...state.measurement.end },
              }
            : null,
          trials: state.trials.map((trial) => ({ ...trial })),
        };
      },
    };

    state.lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  init();
})();




