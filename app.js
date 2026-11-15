const GELS = {
  amber: { name: "琥珀", hex: "#ffad53", rgb: [255, 173, 83] },
  steel: { name: "钢蓝", hex: "#8db6d9", rgb: [141, 182, 217] },
  rose: { name: "玫瑰", hex: "#f06b94", rgb: [240, 107, 148] },
  cyan: { name: "青绿", hex: "#50d9d2", rgb: [80, 217, 210] },
  gold: { name: "旧金", hex: "#d8b85d", rgb: [216, 184, 93] },
  white: { name: "柔白", hex: "#e9e2d3", rgb: [233, 226, 211] },
};

const GOALS = [
  {
    name: "晨雾开场",
    subtitle: "柔和前缘 / 琥珀",
    hint: "让主光与色片先暖起来",
    text: "压低主光与轮廓，把琥珀色洗在前区。两束光都不要抢戏。",
    difficulty: "默契",
    gel: "amber",
    ranges: {
      keyIntensity: [48, 60],
      keyPan: [-30, 0],
      rimIntensity: [24, 36],
      rimHeight: [40, 62],
      gelDensity: [55, 70],
    },
  },
  {
    name: "冷色独白",
    subtitle: "高位勾边 / 钢蓝",
    hint: "轮廓升高，主光退半步",
    text: "换钢蓝并抬高轮廓灯。主光落在演员前侧，留出一条冷色边界。",
    difficulty: "换位",
    gel: "steel",
    ranges: {
      keyIntensity: [36, 46],
      keyPan: [-20, 15],
      rimIntensity: [62, 75],
      rimHeight: [72, 90],
      gelDensity: [42, 60],
    },
  },
  {
    name: "玫瑰高潮",
    subtitle: "正面冲光 / 玫瑰",
    hint: "让主光站到玫瑰里",
    text: "把主光推向右前区并抬高，轮廓略收。注意总曝光仍在安全线内。",
    difficulty: "差之毫厘",
    gel: "rose",
    ranges: {
      keyIntensity: [78, 90],
      keyPan: [25, 60],
      rimIntensity: [50, 64],
      rimHeight: [42, 62],
      gelDensity: [65, 82],
    },
  },
  {
    name: "蓝调静场",
    subtitle: "低角侧洗 / 青绿",
    hint: "收光，把轮廓放低",
    text: "切青绿后整体收光。轮廓降到腰线以下，让蓝调从侧后方漫出来。",
    difficulty: "收束",
    gel: "cyan",
    ranges: {
      keyIntensity: [24, 36],
      keyPan: [-10, 25],
      rimIntensity: [44, 58],
      rimHeight: [25, 45],
      gelDensity: [32, 50],
    },
  },
  {
    name: "金色谢幕",
    subtitle: "双灯并肩 / 旧金",
    hint: "把光位交给舞台左侧",
    text: "最后切旧金，主光左移，轮廓与主光强度并肩。让两束光一起落在演员身上。",
    difficulty: "终帧",
    gel: "gold",
    ranges: {
      keyIntensity: [62, 74],
      keyPan: [-60, -20],
      rimIntensity: [62, 74],
      rimHeight: [52, 72],
      gelDensity: [70, 88],
    },
  },
];

const ROLE_NAMES = { key: "主光", rim: "轮廓", gel: "色片" };
const EXPOSURE_LIMIT = 0.78;
const HOLD_REQUIRED = 1.35;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const pad2 = (value) => String(value).padStart(2, "0");
const formatTime = (seconds, withTenths = false) => {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const whole = Math.floor(safe % 60);
  const text = `${pad2(minutes)}:${pad2(whole)}`;
  return withTenths ? `${text}.${Math.floor((safe % 1) * 10)}` : text;
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const controls = {
  keyIntensity: $("#keyIntensity"),
  keyPan: $("#keyPan"),
  rimIntensity: $("#rimIntensity"),
  rimHeight: $("#rimHeight"),
  gelDensity: $("#gelDensity"),
};

const ui = {
  app: $("#app"),
  liveLight: $("#liveLight"),
  sessionState: $("#sessionState"),
  sessionClock: $("#sessionClock"),
  goalCounter: $("#goalCounter"),
  goalCount: $("#goalCount"),
  goalList: $("#goalList"),
  goalDifficulty: $("#goalDifficulty"),
  briefTitle: $("#briefTitle"),
  briefText: $("#briefText"),
  targetGrid: $("#targetGrid"),
  currentGoalName: $("#currentGoalName"),
  exposureValue: $("#exposureValue"),
  wearValue: $("#wearValue"),
  exposureAlert: $("#exposureAlert"),
  exposureHint: $("#exposureHint"),
  exposureNeedle: $("#exposureNeedle"),
  goalHoldBar: $("#goalHoldBar"),
  goalHoldValue: $("#goalHoldValue"),
  stageTip: $("#stageTip"),
  eventFeed: $("#eventFeed"),
  pauseBtn: $("#pauseBtn"),
  pauseLabel: $("#pauseLabel"),
  pauseOverlay: $("#pauseOverlay"),
  replayBtn: $("#replayBtn"),
  replayLabel: $("#replayLabel"),
  replayHud: $("#replayHud"),
  replayAction: $("#replayAction"),
  replayTime: $("#replayTime"),
  soundBtn: $("#soundBtn"),
  soundLabel: $("#soundLabel"),
  helpDrawer: $("#helpDrawer"),
  completionDialog: $("#completionDialog"),
  gelatinPalette: $("#gelPalette"),
  gelWearBar: $("#gelWearBar"),
  gelWearReadout: $("#gelWearReadout"),
  wearHint: $("#wearHint"),
  wearMeter: $(".wear-meter"),
  toastStack: $("#toastStack"),
};

const initialState = () => ({
  key: { connected: true, intensity: 68, pan: 12 },
  rim: { connected: true, intensity: 52, height: 58 },
  gel: { connected: true, color: "amber", density: 68, wear: 0 },
});

const state = {
  ...initialState(),
  goalIndex: 0,
  completedGoals: [],
  goalTimes: [],
  holdTime: 0,
  elapsed: 0,
  paused: false,
  completed: false,
  replaying: false,
  overexposed: false,
  overexposureCount: 0,
  wasOverexposed: false,
  lastGelSwitchAt: -99,
  lastActionAt: -99,
  events: [],
  replayPosition: 0,
  replayDuration: 0,
  replayPaused: false,
  lastFrame: performance.now(),
  frameTime: 0,
};

function cloneRoles(source = state) {
  return {
    key: { ...source.key },
    rim: { ...source.rim },
    gel: { ...source.gel },
  };
}

function currentGoal() {
  return GOALS[Math.min(state.goalIndex, GOALS.length - 1)];
}

function roleMovement(stateSnapshot) {
  return {
    key: stateSnapshot.key.intensity / 100 + stateSnapshot.key.pan * 0.15,
    rim: stateSnapshot.rim.intensity / 100 + stateSnapshot.rim.height * 0.25,
  };
}

function computeExposure(roles) {
  const keyAim = 1 - Math.abs(roles.key.pan) / 100 * 0.12;
  const rimAim = 1 - Math.abs(roles.rim.height - 62) / 100 * 0.16;
  const wearLoss = 1 - clamp((roles.gel.wear - 68) / 32) * 0.16;
  const keyPower = (roles.key.intensity / 100) * 0.61 * keyAim;
  const rimPower = (roles.rim.intensity / 100) * 0.39 * rimAim;
  const gelPower = (roles.gel.density / 100) * 0.075;
  return clamp((keyPower + rimPower + gelPower) * wearLoss);
}

function mixRgb(a, b, amount) {
  return a.map((channel, index) => Math.round(lerp(channel, b[index], amount)));
}

class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.moteSeed = Array.from({ length: 74 }, (_, index) => ({
      x: ((index * 47) % 100) / 100,
      y: ((index * 71) % 100) / 100,
      size: 0.4 + ((index * 13) % 10) / 9,
      speed: 0.15 + ((index * 17) % 20) / 45,
    }));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(roles, exposure, time, paused = false) {
    const ctx = this.context;
    const w = this.width;
    const h = this.height;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    const gel = GELS[roles.gel.color] || GELS.amber;
    const keyPoint = {
      x: w * (0.48 + roles.key.pan / 100 * 0.17),
      y: h * 0.715,
    };
    const rimPoint = {
      x: w * (0.58 + (roles.rim.height - 50) / 100 * 0.08),
      y: h * 0.70,
    };
    const gelPoint = { x: w * 0.515, y: h * 0.72 };

    this.drawBackdrop(ctx, w, h, gel);
    this.drawFloor(ctx, w, h, exposure, gel);
    this.drawTruss(ctx, w, h);
    this.drawExposureZones(ctx, w, h, exposure, keyPoint, gel);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    this.drawBeam(ctx, w * 0.255 + roles.key.pan * w * 0.0007, h * 0.115, keyPoint.x, keyPoint.y, 0.21, "#ffc67d", roles.key.intensity / 100);
    this.drawBeam(ctx, w * 0.785, h * 0.13, rimPoint.x, rimPoint.y, 0.17, "#7fe8f0", roles.rim.intensity / 100);
    this.drawBeam(ctx, w * 0.52, h * 0.075, gelPoint.x, gelPoint.y, 0.14, gel.hex, roles.gel.density / 100 * 0.84);
    ctx.restore();

    this.drawMotes(ctx, w, h, time, paused, roles, gel);
    this.drawPerformer(ctx, w, h, time, exposure, gel, roles);
    this.drawFixture(ctx, w * 0.255 + roles.key.pan * w * 0.0007, h * 0.105, "#ffc67d", "K");
    this.drawFixture(ctx, w * 0.785, h * 0.12, "#7fe8f0", "R");
    this.drawFixture(ctx, w * 0.52, h * 0.065, gel.hex, "G");
    this.drawCanvasLabels(ctx, w, h, exposure, gel, roles);
    this.drawVignette(ctx, w, h);
  }

  drawBackdrop(ctx, w, h, gel) {
    const background = ctx.createLinearGradient(0, 0, 0, h);
    background.addColorStop(0, "#07090b");
    background.addColorStop(0.58, "#0b0d0f");
    background.addColorStop(1, "#050607");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);

    const haze = ctx.createRadialGradient(w * 0.52, h * 0.58, 4, w * 0.52, h * 0.58, w * 0.48);
    haze.addColorStop(0, `rgba(${gel.rgb.join(",")},0.09)`);
    haze.addColorStop(0.55, "rgba(33,40,43,0.045)");
    haze.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    for (let index = 1; index < 8; index += 1) {
      const x = (w / 8) * index;
      ctx.beginPath();
      ctx.moveTo(x, h * 0.12);
      ctx.lineTo(x + (x - w / 2) * 0.12, h * 0.63);
      ctx.stroke();
    }
    for (let index = 1; index < 5; index += 1) {
      const y = h * (0.18 + index * 0.07);
      ctx.beginPath();
      ctx.moveTo(w * 0.08, y);
      ctx.lineTo(w * 0.92, y);
      ctx.stroke();
    }
  }

  drawFloor(ctx, w, h, exposure, gel) {
    const floorY = h * 0.665;
    const floorGradient = ctx.createLinearGradient(0, floorY, 0, h);
    floorGradient.addColorStop(0, "rgba(29,31,31,0.64)");
    floorGradient.addColorStop(1, "rgba(5,6,7,0.96)");
    ctx.fillStyle = floorGradient;
    ctx.beginPath();
    ctx.moveTo(w * 0.055, floorY);
    ctx.lineTo(w * 0.945, floorY);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.055)";
    ctx.lineWidth = 1;
    for (let index = -3; index <= 3; index += 1) {
      ctx.beginPath();
      ctx.moveTo(w * 0.5 + index * w * 0.055, floorY);
      ctx.lineTo(w * 0.5 + index * w * 0.27, h);
      ctx.stroke();
    }
    for (let index = 0; index < 6; index += 1) {
      const y = floorY + (h - floorY) * (index / 6) ** 1.65;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const pool = ctx.createRadialGradient(w * 0.5, h * 0.71, 2, w * 0.5, h * 0.71, w * 0.3);
    pool.addColorStop(0, `rgba(${gel.rgb.join(",")},${0.09 + exposure * 0.16})`);
    pool.addColorStop(0.35, "rgba(238,225,200,0.055)");
    pool.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pool;
    ctx.fillRect(0, floorY, w, h - floorY);
  }

  drawTruss(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = "rgba(220,225,224,0.10)";
    ctx.lineWidth = 1;
    const y = h * 0.055;
    ctx.beginPath();
    ctx.moveTo(w * 0.07, y);
    ctx.lineTo(w * 0.93, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w * 0.07, y + 9);
    ctx.lineTo(w * 0.93, y + 9);
    ctx.stroke();
    for (let x = w * 0.075; x < w * 0.93; x += 19) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 19, y + 9);
      ctx.moveTo(x + 19, y);
      ctx.lineTo(x, y + 9);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.055)";
    ctx.beginPath();
    ctx.moveTo(w * 0.13, y);
    ctx.lineTo(w * 0.13, 0);
    ctx.moveTo(w * 0.87, y);
    ctx.lineTo(w * 0.87, 0);
    ctx.stroke();
    ctx.restore();
  }

  drawExposureZones(ctx, w, h, exposure, point, gel) {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.scale(1, 0.28);
    for (let index = 0; index < 3; index += 1) {
      const radius = 47 + index * 32;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius, 0, 0, Math.PI * 2);
      ctx.strokeStyle = exposure > EXPOSURE_LIMIT
        ? `rgba(255,101,95,${0.33 - index * 0.075})`
        : `rgba(${gel.rgb.join(",")},${0.16 - index * 0.035})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    const radius = 74 + exposure * 70;
    const hot = ctx.createRadialGradient(point.x, point.y, 2, point.x, point.y, radius);
    hot.addColorStop(0, `rgba(255,248,222,${0.1 + exposure * 0.27})`);
    hot.addColorStop(0.45, `rgba(${gel.rgb.join(",")},${0.07 + exposure * 0.15})`);
    hot.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = hot;
    ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
    ctx.restore();

    if (exposure > EXPOSURE_LIMIT) {
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = `rgba(255,101,95,${0.4 + Math.sin(performance.now() / 180) * 0.12})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(point.x, point.y, 116, 32, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawBeam(ctx, sx, sy, tx, ty, spread, color, intensity) {
    if (intensity <= 0.005) return;
    const dx = tx - sx;
    const dy = ty - sy;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const targetWidth = this.width * spread;
    const sourceWidth = 5;

    const gradient = ctx.createLinearGradient(sx, sy, tx, ty);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.2, color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");

    for (let layer = 0; layer < 3; layer += 1) {
      const layerScale = 1 - layer * 0.24;
      const alpha = (0.06 + intensity * 0.075) * (1 + layer * 0.28);
      ctx.beginPath();
      ctx.moveTo(sx + nx * sourceWidth, sy + ny * sourceWidth);
      ctx.quadraticCurveTo(
        sx + dx * 0.56 + nx * targetWidth * 0.34,
        sy + dy * 0.56 + ny * targetWidth * 0.34,
        tx + nx * targetWidth * layerScale,
        ty + ny * targetWidth * layerScale,
      );
      ctx.lineTo(tx - nx * targetWidth * layerScale, ty - ny * targetWidth * layerScale);
      ctx.quadraticCurveTo(
        sx + dx * 0.56 - nx * targetWidth * 0.34,
        sy + dy * 0.56 - ny * targetWidth * 0.34,
        sx - nx * sourceWidth,
        sy - ny * sourceWidth,
      );
      ctx.closePath();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.globalAlpha = intensity * 0.13;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawMotes(ctx, w, h, time, paused, roles, gel) {
    const points = [
      { x: w * 0.43, y: h * 0.4, color: "#ffd39a", amount: roles.key.intensity / 100 },
      { x: w * 0.64, y: h * 0.37, color: "#9af1f4", amount: roles.rim.intensity / 100 },
      { x: w * 0.53, y: h * 0.32, color: gel.hex, amount: roles.gel.density / 100 },
    ];
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    this.moteSeed.forEach((mote, index) => {
      const source = points[index % points.length];
      const drift = paused ? 0 : time * mote.speed;
      const x = source.x + (mote.x - 0.5) * w * 0.22 + Math.sin(drift + index) * 5;
      const y = h * 0.18 + mote.y * (h * 0.49) + Math.cos(drift * 0.7 + index) * 4;
      const alpha = source.amount * (0.12 + (index % 5) * 0.035);
      ctx.fillStyle = source.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, mote.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  drawPerformer(ctx, w, h, time, exposure, gel, roles) {
    const floorY = h * 0.70;
    const x = w * 0.5 + roles.key.pan / 100 * w * 0.01;
    const sway = Math.sin(time * 0.7) * 1.5;
    const scale = Math.min(w / 1100, h / 500);
    ctx.save();
    ctx.translate(x + sway, floorY);
    ctx.scale(scale, scale);

    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 50, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    const glow = ctx.createRadialGradient(0, -80, 5, 0, -80, 95);
    glow.addColorStop(0, `rgba(${gel.rgb.join(",")},${0.08 + exposure * 0.13})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-110, -180, 220, 190);

    ctx.fillStyle = "#07090a";
    ctx.strokeStyle = "rgba(255,198,125,0.34)";
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.arc(0, -142, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-2, -130);
    ctx.bezierCurveTo(-15, -122, -17, -100, -12, -76);
    ctx.bezierCurveTo(-7, -52, -9, -38, -16, -18);
    ctx.lineTo(-2, -7);
    ctx.lineTo(8, -8);
    ctx.bezierCurveTo(13, -33, 12, -49, 19, -70);
    ctx.bezierCurveTo(25, -96, 21, -117, 5, -130);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(132,235,239,0.42)";
    ctx.beginPath();
    ctx.moveTo(3, -127);
    ctx.bezierCurveTo(19, -118, 26, -112, 37, -128);
    ctx.bezierCurveTo(44, -137, 50, -149, 58, -157);
    ctx.moveTo(-2, -125);
    ctx.bezierCurveTo(-16, -117, -27, -112, -38, -123);
    ctx.bezierCurveTo(-45, -132, -51, -139, -57, -155);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,198,125,0.31)";
    ctx.beginPath();
    ctx.moveTo(-13, -18);
    ctx.lineTo(-25, 1);
    ctx.moveTo(8, -8);
    ctx.lineTo(22, 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(140,240,242,0.28)";
    ctx.beginPath();
    ctx.moveTo(8, -125);
    ctx.bezierCurveTo(18, -114, 19, -91, 17, -72);
    ctx.stroke();
    ctx.restore();
  }

  drawFixture(ctx, x, y, color, label) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.24);
    ctx.fillStyle = "#191c1e";
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-8, -4, 16, 21, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.86;
    ctx.beginPath();
    ctx.ellipse(0, 16, 5.5, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(8,10,11,0.92)";
    ctx.beginPath();
    ctx.roundRect(-5, 6, 10, 6, 1);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "5px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, 0, 11);
    ctx.restore();
  }

  drawCanvasLabels(ctx, w, h, exposure, gel, roles) {
    const x = w * 0.5;
    const y = h * 0.90;
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.26)";
    ctx.font = "7px ui-monospace, monospace";
    ctx.letterSpacing = "1.4px";
    ctx.fillText(`EXPOSURE ZONE / ${Math.round(exposure * 100)}%`, x, y);
    ctx.fillStyle = exposure > EXPOSURE_LIMIT ? "rgba(255,101,95,0.66)" : "rgba(255,255,255,0.20)";
    ctx.beginPath();
    ctx.moveTo(x - 52, y + 7);
    ctx.lineTo(x + 52, y + 7);
    ctx.strokeStyle = exposure > EXPOSURE_LIMIT ? "rgba(255,101,95,0.38)" : "rgba(255,255,255,0.09)";
    ctx.stroke();
    ctx.fillStyle = `rgba(${gel.rgb.join(",")},0.50)`;
    ctx.fillRect(x - 10, y + 6, 20, 2);
    ctx.fillStyle = "rgba(255,255,255,0.27)";
    ctx.font = "7px ui-monospace, monospace";
    ctx.fillText(`GEL ${gel.name} / KEY ${Math.round(roles.key.intensity)} / RIM ${Math.round(roles.rim.intensity)}`, x, y + 20);
    ctx.restore();
  }

  drawVignette(ctx, w, h) {
    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.52, w * 0.18, w * 0.5, h * 0.52, w * 0.68);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.75, "rgba(0,0,0,0.18)");
    vignette.addColorStop(1, "rgba(0,0,0,0.58)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }
}

class LightAudio {
  constructor() {
    this.context = null;
    this.started = false;
    this.muted = false;
    this.nodes = null;
    this.previous = null;
    this.motion = 0;
  }

  async enable() {
    if (this.muted) return false;
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      this.context = new AudioContextClass();
      this.buildGraph();
    }
    try {
      await this.context.resume();
      this.started = this.context.state === "running";
    } catch {
      this.started = false;
    }
    return this.started;
  }

  buildGraph() {
    const ctx = this.context;
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    const panner = ctx.createStereoPanner();
    const filter = ctx.createBiquadFilter();
    const drone = ctx.createGain();
    const motionBus = ctx.createGain();

    master.gain.value = 0.0001;
    compressor.threshold.value = -22;
    compressor.knee.value = 15;
    compressor.ratio.value = 3;
    filter.type = "lowpass";
    filter.frequency.value = 650;
    filter.Q.value = 0.7;
    drone.gain.value = 0.58;
    panner.pan.value = 0;
    motionBus.gain.value = 0.06;

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = "sine";
    oscA.frequency.value = 48;
    oscB.type = "triangle";
    oscB.frequency.value = 96;

    const subGain = ctx.createGain();
    subGain.gain.value = 0.34;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.11;
    oscA.connect(subGain).connect(drone);
    oscB.connect(bodyGain).connect(drone);
    drone.connect(filter).connect(panner).connect(master);
    master.connect(compressor).connect(ctx.destination);

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = (Math.random() * 2 - 1) * 0.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 520;
    noiseFilter.Q.value = 0.6;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.018;
    noise.connect(noiseFilter).connect(noiseGain).connect(panner);

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.17;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 5;
    lfo.connect(lfoGain).connect(filter.frequency);

    const motionOsc = ctx.createOscillator();
    motionOsc.type = "sawtooth";
    motionOsc.frequency.value = 73;
    const motionFilter = ctx.createBiquadFilter();
    motionFilter.type = "bandpass";
    motionFilter.frequency.value = 840;
    motionFilter.Q.value = 4;
    motionOsc.connect(motionFilter).connect(motionBus).connect(panner);

    [oscA, oscB, noise, lfo, motionOsc].forEach((node) => node.start());
    this.nodes = {
      master, panner, filter, drone, motionBus, noiseFilter,
      oscA, oscB, motionOsc, lfoGain,
    };
  }

  update(roles, exposure, paused) {
    if (!this.started || !this.context || !this.nodes) return;
    const now = this.context.currentTime;
    const previous = this.previous || roles;
    const delta = Math.abs(roles.key.intensity - previous.key.intensity) / 100
      + Math.abs(roles.key.pan - previous.key.pan) / 100
      + Math.abs(roles.rim.intensity - previous.rim.intensity) / 100
      + Math.abs(roles.rim.height - previous.rim.height) / 100;
    this.motion = lerp(this.motion, clamp(delta * 8), 0.08);
    this.previous = cloneRoles({ ...state, ...roles });

    const keyFrequency = 42 + roles.key.intensity * 0.52 + Math.abs(roles.key.pan) * 0.08;
    const bodyFrequency = keyFrequency * 2.02 + roles.rim.height * 0.18;
    const filterFrequency = 220 + roles.rim.height * 10 + exposure * 850 + this.motion * 700;
    const gain = paused ? 0.0001 : 0.012 + exposure * 0.068 + this.motion * 0.02;
    const pan = clamp(roles.key.pan / 100 * 0.9, -0.9, 0.9);

    this.nodes.oscA.frequency.setTargetAtTime(keyFrequency, now, 0.09);
    this.nodes.oscB.frequency.setTargetAtTime(bodyFrequency, now, 0.09);
    this.nodes.motionOsc.frequency.setTargetAtTime(58 + this.motion * 94 + roles.rim.height * 0.45, now, 0.07);
    this.nodes.noiseFilter.frequency.setTargetAtTime(320 + roles.rim.height * 7 + this.motion * 1000, now, 0.12);
    this.nodes.filter.frequency.setTargetAtTime(filterFrequency, now, 0.1);
    this.nodes.panner.pan.setTargetAtTime(pan, now, 0.12);
    this.nodes.master.gain.setTargetAtTime(gain, now, paused ? 0.03 : 0.12);
    this.nodes.motionBus.gain.setTargetAtTime(0.025 + this.motion * 0.09, now, 0.08);
    this.nodes.lfoGain.gain.setTargetAtTime(2.5 + this.motion * 14, now, 0.1);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.nodes) {
      this.nodes.master.gain.setTargetAtTime(muted ? 0.0001 : 0.012, this.context.currentTime, 0.03);
    }
  }

  snapshot() {
    return {
      started: this.started,
      muted: this.muted,
      state: this.context?.state || "uninitialized",
      motion: Number(this.motion.toFixed(3)),
      frequency: this.nodes ? Number(this.nodes.filter.frequency.value.toFixed(1)) : 0,
    };
  }
}

const renderer = new StageRenderer($("#stageCanvas"));
const audio = new LightAudio();
const heldKeys = new Map();
const sliderTimers = new Map();
let completionTimeout = null;

function currentDisplayRoles() {
  return state.replaying ? replayRolesAt(state.replayPosition) : cloneRoles();
}

function setRangeFill(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const percent = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--range-fill", `${clamp(percent, 0, 100)}%`);
}

function addEventToFeed(event) {
  const empty = $(".event-empty", ui.eventFeed);
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = `event-row${event.kind === "warn" ? " is-warn" : event.kind === "link" ? " is-link" : ""}`;
  row.innerHTML = `<time>${formatTime(event.t, true)}</time><span>${event.label}</span><i></i>`;
  ui.eventFeed.prepend(row);
  while (ui.eventFeed.children.length > 6) {
    ui.eventFeed.lastElementChild.remove();
  }
}

function recordEvent(label, kind = "action", options = {}) {
  if (state.replaying) return;
  const last = state.events[state.events.length - 1];
  if (last && last.label === label && state.elapsed - last.t < 0.12 && !options.force) return;
  const event = {
    t: Number(state.elapsed.toFixed(3)),
    label,
    kind,
    roles: cloneRoles(),
    goalIndex: state.goalIndex,
  };
  state.events.push(event);
  addEventToFeed(event);
  state.lastActionAt = state.elapsed;
}

function showToast(message, kind = "") {
  const toast = document.createElement("div");
  toast.className = `toast${kind ? ` is-${kind}` : ""}`;
  toast.innerHTML = message;
  ui.toastStack.append(toast);
  window.setTimeout(() => toast.classList.add("is-out"), 2500);
  window.setTimeout(() => toast.remove(), 2750);
  while (ui.toastStack.children.length > 3) {
    ui.toastStack.firstElementChild.remove();
  }
}

function mutateRole(role, field, value, record = false, label = "") {
  if (!state[role].connected && !state.replaying) return;
  const limits = {
    intensity: [0, 100],
    pan: [-100, 100],
    height: [0, 100],
    density: [0, 100],
  };
  state[role][field] = clamp(value, ...(limits[field] || [0, 100]));
  if (record && label) recordEvent(label);
}

function setRoleFromInput(role, field, value, input, record = true) {
  if (state.paused || state.replaying || state.completed) {
    applyRolesToControls(currentDisplayRoles());
    return;
  }
  mutateRole(role, field, value);
  setRangeFill(input);
  if (!record) return;
  const action = `${ROLE_NAMES[role]}${field === "intensity" ? "强度" : field === "pan" ? "灯位" : field === "height" ? "高度" : "浓度"}`;
  window.clearTimeout(sliderTimers.get(input.id));
  sliderTimers.set(input.id, window.setTimeout(() => {
    const displayValue = field === "pan" ? panLabel(Number(input.value)) : `${Math.round(Number(input.value))}%`;
    recordEvent(`${action} → ${displayValue}`);
  }, 140));
}

function changeGel(color, source = "pointer") {
  if (state.paused || state.replaying || state.completed) return;
  if (!state.gel.connected) {
    showToast("<b>色片控制器未接入</b> · 最后光位仍被保持", "warn");
    return;
  }
  if (!GELS[color] || state.gel.color === color) return;
  const interval = state.elapsed - state.lastGelSwitchAt;
  const hotSwitch = interval < 1.05;
  const increment = hotSwitch ? 7 : 3;
  const previous = GELS[state.gel.color].name;
  state.gel.color = color;
  state.gel.wear = clamp(state.gel.wear + increment, 0, 100);
  state.lastGelSwitchAt = state.elapsed;
  recordEvent(`色片 ${previous} → ${GELS[color].name} · 磨损 +${increment}%`, hotSwitch ? "warn" : "action", { force: true });
  if (hotSwitch) {
    showToast("<b>热切换磨损</b> · 连续换色会加快机械老化", "warn");
  }
  if (state.gel.wear >= 68) {
    showToast("<b>色片透光率下降</b> · 最终光场开始轻微衰减", "warn");
  }
  refreshGelPalette();
}

function refreshGelPalette() {
  $$(".gel-swatch", ui.gelatinPalette).forEach((button) => {
    const active = button.dataset.gel === state.gel.color;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = !state.gel.connected || state.paused || state.replaying || state.completed;
  });
}

function panLabel(value) {
  if (Math.abs(value) < 8) return "中";
  return value < 0 ? `L${Math.abs(Math.round(value))}` : `R${Math.round(value)}`;
}

function applyRolesToControls(roles) {
  controls.keyIntensity.value = Math.round(roles.key.intensity);
  controls.keyPan.value = Math.round(roles.key.pan);
  controls.rimIntensity.value = Math.round(roles.rim.intensity);
  controls.rimHeight.value = Math.round(roles.rim.height);
  controls.gelDensity.value = Math.round(roles.gel.density);
  Object.values(controls).forEach(setRangeFill);
  $("#keyReadout").innerHTML = `${Math.round(roles.key.intensity)}<small>%</small>`;
  $("#rimReadout").innerHTML = `${Math.round(roles.rim.intensity)}<small>%</small>`;
  $("#keyIntensityValue").textContent = Math.round(roles.key.intensity);
  $("#keyPanValue").textContent = panLabel(roles.key.pan);
  $("#rimIntensityValue").textContent = Math.round(roles.rim.intensity);
  $("#rimHeightValue").textContent = Math.round(roles.rim.height);
  $("#gelDensityValue").textContent = Math.round(roles.gel.density);
  $$(".gel-swatch", ui.gelatinPalette).forEach((button) => {
    button.classList.toggle("is-active", button.dataset.gel === roles.gel.color);
  });
}

function updateControlAvailability(roles = currentDisplayRoles()) {
  const locked = state.paused || state.replaying || state.completed;
  Object.entries(controls).forEach(([name, input]) => {
    const role = name.startsWith("key") ? "key" : name.startsWith("rim") ? "rim" : "gel";
    input.disabled = locked || !state[role].connected;
  });
  $$(".gel-swatch", ui.gelatinPalette).forEach((button) => {
    button.disabled = locked || !state.gel.connected;
  });
  $$(".link-toggle").forEach((button) => {
    button.disabled = state.replaying;
  });
  applyRolesToControls(roles);
}

function setConnectionUI(role, connected) {
  const card = $(`#console${role[0].toUpperCase()}${role.slice(1)}`);
  const status = $(`#${role}Status`);
  const toggle = $(`[data-disconnect="${role}"]`);
  const chip = $(`[data-focus-role="${role}"]`);
  card?.classList.toggle("is-offline", !connected);
  status?.classList.toggle("is-offline", !connected);
  if (status) status.innerHTML = `<i></i>${connected ? "已接入" : "已断开"}`;
  if (toggle) toggle.textContent = connected ? "断开" : "接入";
  chip?.classList.toggle("is-offline", !connected);
  chip?.classList.toggle("is-online", connected);
}

function toggleConnection(role) {
  if (state.replaying) return;
  const connected = !state[role].connected;
  state[role].connected = connected;
  setConnectionUI(role, connected);
  updateControlAvailability();
  if (connected) {
    recordEvent(`${ROLE_NAMES[role]}控制器重新接入`, "link", { force: true });
    showToast(`<b>${ROLE_NAMES[role]}控制器已接入</b> · 光场恢复实时响应`);
  } else {
    state.holdTime = 0;
    recordEvent(`${ROLE_NAMES[role]}控制器断开 · 保持最后光位`, "link", { force: true });
    showToast(`<b>${ROLE_NAMES[role]}控制器断开</b> · 最后光位被锁定，其余控制仍可继续`, "warn");
  }
}

function goalMatches(roles, goal) {
  if (!roles.key.connected || !roles.rim.connected || !roles.gel.connected) return false;
  if (roles.gel.color !== goal.gel) return false;
  return Object.entries(goal.ranges).every(([field, [min, max]]) => {
    const [role, key] = field.startsWith("key")
      ? ["key", field.replace("key", "").replace(/^./, (letter) => letter.toLowerCase())]
      : field.startsWith("rim")
        ? ["rim", field.replace("rim", "").replace(/^./, (letter) => letter.toLowerCase())]
        : ["gel", field.replace("gel", "").replace(/^./, (letter) => letter.toLowerCase())];
    return roles[role][key] >= min && roles[role][key] <= max;
  });
}

function targetFieldStatus(roles, goal, field) {
  const map = {
    keyIntensity: roles.key.intensity,
    keyPan: roles.key.pan,
    rimIntensity: roles.rim.intensity,
    rimHeight: roles.rim.height,
    gelDensity: roles.gel.density,
  };
  const value = map[field];
  const [min, max] = goal.ranges[field];
  return { value, good: value >= min && value <= max, min, max };
}

function renderGoalBrief() {
  const goal = currentGoal();
  ui.goalDifficulty.textContent = goal.difficulty;
  ui.briefTitle.textContent = goal.hint;
  ui.briefText.textContent = goal.text;
  ui.currentGoalName.textContent = goal.name;
  ui.targetGrid.innerHTML = [
    ["keyIntensity", "主光强度", "%"],
    ["rimIntensity", "轮廓强度", "%"],
    ["keyPan", "主光灯位", ""],
    ["rimHeight", "轮廓高度", "%"],
    ["gelDensity", "色片浓度", "%"],
  ].map(([field, label, suffix]) => {
    const [min, max] = goal.ranges[field];
    const range = field === "keyPan" ? `${min > 0 ? "+" : ""}${min}…${max > 0 ? "+" : ""}${max}` : `${min}–${max}${suffix}`;
    return `<div class="target-cell" data-target="${field}"><span>${label}</span><b>${range}</b></div>`;
  }).concat([
    `<div class="target-cell" data-target="gel"><span>色片</span><b>${GELS[goal.gel].name}</b></div>`,
    `<div class="target-cell" data-target="exposure"><span>曝光上限</span><b>≤${Math.round(EXPOSURE_LIMIT * 100)}%</b></div>`,
  ]).join("");
  ui.goalCounter.textContent = Math.min(state.goalIndex + 1, 5);
  ui.goalCount.textContent = `${pad2(Math.min(state.goalIndex + 1, 5))} — 05`;
}

function renderGoalList() {
  ui.goalList.innerHTML = GOALS.map((goal, index) => {
    const done = index < state.goalIndex || state.completedGoals.includes(index);
    const current = index === state.goalIndex && !state.completed;
    const time = state.goalTimes[index];
    return `
      <li class="goal-item${done ? " is-done" : ""}${current ? " is-current" : ""}" data-goal="${index}">
        <span class="goal-state">${done ? "✓" : pad2(index + 1)}</span>
        <span class="goal-copy"><strong>${goal.name}</strong><small>${goal.subtitle}</small></span>
        <span class="goal-time">${time !== undefined ? formatTime(time) : current ? "NOW" : "--:--"}</span>
      </li>`;
  }).join("");
}

function updateTargetGrid(roles, goal) {
  $$(".target-cell", ui.targetGrid).forEach((cell) => {
    const field = cell.dataset.target;
    let good = false;
    if (field === "gel") good = roles.gel.color === goal.gel;
    else if (field === "exposure") good = computeExposure(roles) <= EXPOSURE_LIMIT;
    else good = targetFieldStatus(roles, goal, field).good;
    cell.classList.toggle("is-good", good);
  });
}

function updateMetrics(roles, exposure) {
  const percent = Math.round(exposure * 100);
  const hot = exposure > EXPOSURE_LIMIT;
  ui.exposureValue.textContent = `${percent}%`;
  ui.exposureValue.classList.toggle("is-hot", hot);
  ui.wearValue.textContent = `${Math.round(roles.gel.wear)}%`;
  ui.wearValue.classList.toggle("is-hot", roles.gel.wear >= 68);
  ui.exposureNeedle.style.left = `${clamp(exposure * 100, 0, 100)}%`;
  ui.exposureAlert.classList.toggle("is-visible", hot);
  ui.exposureHint.textContent = hot ? "过曝区" : exposure > 0.66 ? "接近上限" : "安全区";
  ui.exposureHint.classList.toggle("is-hot", hot);
  ui.gelWearBar.style.width = `${clamp(roles.gel.wear, 0, 100)}%`;
  ui.gelWearReadout.textContent = `${Math.round(roles.gel.wear)}%`;
  ui.wearMeter.classList.toggle("is-worn", roles.gel.wear >= 68);
  ui.wearHint.textContent = roles.gel.wear >= 68
    ? "透光率衰减 · 避免继续热切换"
    : roles.gel.wear >= 35
      ? "磨损累积 · 放慢切色节奏"
      : "色片切换将累积磨损";

  if (state.replaying) {
    state.overexposed = hot;
    return;
  }

  const wasHot = state.overexposed;
  state.overexposed = hot && !state.paused && !state.completed;
  if (state.overexposed && !wasHot) {
    state.wasOverexposed = true;
    state.overexposureCount += 1;
    recordEvent(`光场过曝 ${percent}% · 任一光束需要回调`, "warn", { force: true });
    showToast("<b>过曝</b> · 三束光叠加超出安全阈值，降低任一强度", "warn");
  }
}

function elapsedForDisplay() {
  return state.replaying ? state.replayPosition : state.elapsed;
}

function updateHud(roles, exposure) {
  ui.sessionClock.textContent = formatTime(elapsedForDisplay());
  if (state.replaying) {
    ui.sessionState.textContent = state.replayPaused ? "回放暂停" : "操作序列回放";
    ui.goalCounter.textContent = "REPLAY";
    ui.replayAction.textContent = replayEventAt(state.replayPosition)?.label || "正在还原操作序列";
    ui.replayTime.textContent = `${formatTime(state.replayPosition)} / ${formatTime(state.replayDuration)}`;
  } else if (state.completed) {
    ui.sessionState.textContent = "五帧完成";
  } else if (state.paused) {
    ui.sessionState.textContent = "排演暂停";
  } else {
    ui.sessionState.textContent = "联合排演中";
  }
  ui.liveLight.classList.toggle("is-paused", state.paused || state.replayPaused || state.completed);
  const goal = currentGoal();
  if (!state.replaying) updateTargetGrid(roles, goal);

  const progress = state.replaying ? 0 : clamp(state.holdTime / HOLD_REQUIRED, 0, 1);
  ui.goalHoldBar.style.width = `${progress * 100}%`;
  ui.goalHoldValue.textContent = `${state.holdTime.toFixed(1)}s`;

  if (state.replaying) {
    ui.stageTip.textContent = state.replayPaused ? "回放已暂停 · 按 P 继续" : "正在回放整段操作序列";
  } else if (state.paused) {
    ui.stageTip.textContent = "光场冻结 · 所有控制响应暂停";
  } else if (!roles.key.connected || !roles.rim.connected || !roles.gel.connected) {
    const offline = Object.entries(roles).filter(([, role]) => !role.connected).map(([role]) => ROLE_NAMES[role]);
    ui.stageTip.textContent = `${offline.join("、")}控制器已断开 · 最后光位保持中`;
  } else if (state.overexposed) {
    ui.stageTip.textContent = "过曝区正在扩大 · 回调任一光束";
  } else if (goalMatches(roles, goal)) {
    ui.stageTip.textContent = "构图成立 · 保持住，不要松手";
  } else {
    ui.stageTip.textContent = goal.hint;
  }

}

function completeGoal() {
  const goal = currentGoal();
  state.completedGoals.push(state.goalIndex);
  state.goalTimes[state.goalIndex] = state.elapsed;
  recordEvent(`构图成立 · ${goal.name}`, "good", { force: true });
  showToast(`<b>第 ${state.goalIndex + 1} 帧完成</b> · ${goal.name}`, "good");
  state.goalIndex += 1;
  state.holdTime = 0;
  if (state.goalIndex >= GOALS.length) {
    completeSession();
    return;
  }
  renderGoalList();
  renderGoalBrief();
  updateControlAvailability();
}

function completeSession() {
  state.completed = true;
  state.paused = true;
  state.holdTime = HOLD_REQUIRED;
  state.replayDuration = Math.max(state.elapsed, 1);
  recordEvent("五帧完成 · 操作序列已封存", "good", { force: true });
  ui.replayBtn.disabled = false;
  ui.replayBtn.classList.add("action-button--accent");
  ui.sessionState.textContent = "五帧完成";
  ui.pauseOverlay.hidden = true;
  $("#finalDuration").textContent = formatTime(state.elapsed);
  $("#finalWear").textContent = `${Math.round(state.gel.wear)}%`;
  $("#finalOverexposure").textContent = String(state.overexposureCount);
  renderGoalList();
  updateControlAvailability();
  completionTimeout = window.setTimeout(() => openCompletion(), 620);
}

function openCompletion() {
  ui.completionDialog.classList.add("is-open");
  ui.completionDialog.setAttribute("aria-hidden", "false");
}

function closeCompletion() {
  ui.completionDialog.classList.remove("is-open");
  ui.completionDialog.setAttribute("aria-hidden", "true");
}

function replayEventAt(position) {
  let found = state.events[0] || null;
  for (const event of state.events) {
    if (event.t > position) break;
    found = event;
  }
  return found;
}

function replayRolesAt(position) {
  if (!state.events.length) return cloneRoles();
  let previous = state.events[0];
  let next = null;
  for (const event of state.events) {
    if (event.t > position) {
      next = event;
      break;
    }
    previous = event;
  }
  if (!next) return { key: { ...previous.roles.key }, rim: { ...previous.roles.rim }, gel: { ...previous.roles.gel } };
  const span = Math.max(0.001, next.t - previous.t);
  const amount = clamp((position - previous.t) / span, 0, 1);
  return {
    key: {
      ...previous.roles.key,
      intensity: lerp(previous.roles.key.intensity, next.roles.key.intensity, amount),
      pan: lerp(previous.roles.key.pan, next.roles.key.pan, amount),
    },
    rim: {
      ...previous.roles.rim,
      intensity: lerp(previous.roles.rim.intensity, next.roles.rim.intensity, amount),
      height: lerp(previous.roles.rim.height, next.roles.rim.height, amount),
    },
    gel: {
      ...previous.roles.gel,
      density: lerp(previous.roles.gel.density, next.roles.gel.density, amount),
      wear: Math.round(lerp(previous.roles.gel.wear, next.roles.gel.wear, amount)),
    },
  };
}

function setPauseUI(paused, replay = false) {
  const activePaused = replay ? state.replayPaused : paused;
  ui.pauseOverlay.hidden = !activePaused;
  const pauseTitle = $("strong", ui.pauseOverlay);
  const pauseHint = $("small", ui.pauseOverlay);
  if (state.replaying) {
    pauseTitle.textContent = "回放已暂停";
    pauseHint.textContent = "操作序列停在当前帧 · 按 P 继续";
  } else {
    pauseTitle.textContent = "光场已冻结";
    pauseHint.textContent = "所有控制器暂停响应 · 按 P 继续";
  }
  ui.pauseLabel.textContent = replay
    ? (state.replayPaused ? "继续回放" : "暂停回放")
    : (state.paused ? "继续" : "暂停");
  $(".pause-icon", ui.pauseBtn).classList.toggle("is-play", activePaused);
  if (replay) {
    ui.replayLabel.textContent = "退出回放";
    ui.replayBtn.classList.add("is-active");
  } else {
    ui.replayLabel.textContent = "回放";
    ui.replayBtn.classList.remove("is-active");
  }
  updateControlAvailability();
}

function clearHeldKeys(recordFinal = true) {
  for (const [code, action] of heldKeys) {
    if (recordFinal && action.changed) {
      const value = state.key && action.role === "key" && action.field === "pan"
        ? panLabel(state.key.pan)
        : `${Math.round(state[action.role][action.field])}%`;
      recordEvent(`${action.name} → ${value}`);
    }
    heldKeys.delete(code);
  }
}

function togglePause() {
  audio.enable().catch(() => {});
  if (state.replaying) {
    if (state.replayPosition >= state.replayDuration - 0.01 && state.replayPaused) {
      state.replayPosition = 0;
    }
    state.replayPaused = !state.replayPaused;
    setPauseUI(state.paused, true);
    return;
  }
  if (state.completed) {
    openCompletion();
    return;
  }
  state.paused = !state.paused;
  if (state.paused) {
    clearHeldKeys();
    recordEvent("排演暂停 · 光场冻结", "link", { force: true });
  } else {
    recordEvent("排演继续 · 控制器恢复响应", "link", { force: true });
  }
  setPauseUI(state.paused, false);
  showToast(state.paused ? "<b>排演已暂停</b> · 光场与计时冻结" : "<b>排演继续</b> · 三路输入恢复");
}

function startReplay() {
  if (!state.completed || !state.events.length) return;
  window.clearTimeout(completionTimeout);
  closeCompletion();
  state.replaying = true;
  state.replayPaused = false;
  state.paused = false;
  state.replayPosition = 0;
  state.replayDuration = Math.max(state.replayDuration || 0, state.elapsed, state.events[state.events.length - 1].t, 1);
  ui.replayHud.hidden = false;
  ui.pauseOverlay.hidden = true;
  $$(".console-card").forEach((card) => card.classList.add("is-replay"));
  setPauseUI(false, true);
  ui.liveLight.classList.remove("is-paused");
  audio.enable().catch(() => {});
  showToast("<b>正在回放完整操作序列</b> · 按 P 可随时暂停", "good");
}

function exitReplay() {
  state.replaying = false;
  state.replayPaused = false;
  state.paused = true;
  ui.replayHud.hidden = true;
  $$(".console-card").forEach((card) => card.classList.remove("is-replay"));
  setPauseUI(true, false);
  openCompletion();
}

function toggleReplay() {
  if (state.replaying) exitReplay();
  else if (state.completed) startReplay();
}

function updateReplay(delta) {
  if (!state.replayPaused) {
    state.replayPosition = Math.min(state.replayDuration, state.replayPosition + delta);
    if (state.replayPosition >= state.replayDuration) {
      state.replayPaused = true;
      setPauseUI(false, true);
      showToast("<b>回放结束</b> · 按 P 从头再看，或按 R 返回完成页");
    }
  }
  const roles = replayRolesAt(state.replayPosition);
  const exposure = computeExposure(roles);
  updateMetrics(roles, exposure);
  updateHud(roles, exposure);
  if (!state.paused) applyRolesToControls(roles);
  renderer.draw(roles, exposure, state.frameTime, state.replayPaused);
  audio.update(roles, exposure, state.replayPaused);
}

const KEY_ACTIONS = {
  KeyW: { role: "key", field: "intensity", direction: 1, rate: 28, name: "主光强度" },
  KeyS: { role: "key", field: "intensity", direction: -1, rate: 28, name: "主光强度" },
  KeyA: { role: "key", field: "pan", direction: -1, rate: 86, name: "主光灯位" },
  KeyD: { role: "key", field: "pan", direction: 1, rate: 86, name: "主光灯位" },
  KeyI: { role: "rim", field: "intensity", direction: 1, rate: 25, name: "轮廓强度" },
  KeyK: { role: "rim", field: "intensity", direction: -1, rate: 25, name: "轮廓强度" },
  KeyJ: { role: "rim", field: "height", direction: -1, rate: 58, name: "轮廓高度" },
  KeyL: { role: "rim", field: "height", direction: 1, rate: 58, name: "轮廓高度" },
  KeyQ: { role: "gel", field: "density", direction: -1, rate: 24, name: "色片浓度" },
  KeyE: { role: "gel", field: "density", direction: 1, rate: 24, name: "色片浓度" },
};

const GEL_KEYS = ["amber", "steel", "rose", "cyan", "gold", "white"];
let lastKeyboardWarning = 0;
let audioAttempted = false;

function tryEnableAudio() {
  if (audioAttempted || audio.muted) return;
  audioAttempted = true;
  audio.enable().then((started) => {
    if (started) {
      ui.soundBtn.classList.add("is-on");
      ui.soundBtn.setAttribute("aria-pressed", "true");
      ui.soundLabel.textContent = "声场开";
    }
  }).catch(() => {});
}

function releaseKey(code) {
  const action = heldKeys.get(code);
  if (!action) return;
  if (action.changed) {
    let value;
    if (action.role === "key" && action.field === "pan") value = panLabel(state.key.pan);
    else value = `${Math.round(state[action.role][action.field])}%`;
    recordEvent(`${action.name} → ${value}`);
  }
  heldKeys.delete(code);
}

function beginHeldKey(code, mapping) {
  if (heldKeys.has(code)) return;
  if (!state[mapping.role].connected) {
    if (performance.now() - lastKeyboardWarning > 1800) {
      lastKeyboardWarning = performance.now();
      showToast(`<b>${ROLE_NAMES[mapping.role]}控制器未接入</b> · 无法响应键盘输入`, "warn");
    }
    return;
  }
  heldKeys.set(code, { ...mapping, changed: false });
  recordEvent(`${mapping.name}${mapping.direction > 0 ? "开始上调" : "开始下调"}`);
  const initial = mapping.rate * 0.035 * mapping.direction;
  mutateRole(mapping.role, mapping.field, state[mapping.role][mapping.field] + initial);
  heldKeys.get(code).changed = true;
}

function updateHeldInput(delta) {
  if (!heldKeys.size || state.paused || state.replaying || state.completed) return;
  heldKeys.forEach((action) => {
    if (!state[action.role].connected) return;
    const step = action.rate * delta * action.direction;
    mutateRole(action.role, action.field, state[action.role][action.field] + step);
    action.changed = true;
  });
}

function toggleHelp(force) {
  const open = typeof force === "boolean" ? force : !ui.helpDrawer.classList.contains("is-open");
  ui.helpDrawer.classList.toggle("is-open", open);
  ui.helpDrawer.setAttribute("aria-hidden", String(!open));
}

function handleKeydown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  tryEnableAudio();
  if (event.code === "KeyP") {
    if (event.repeat) return;
    event.preventDefault();
    togglePause();
    return;
  }
  if (event.code === "KeyR") {
    if (event.repeat) return;
    event.preventDefault();
    toggleReplay();
    return;
  }
  if (event.key === "?" || (event.code === "Slash" && event.shiftKey)) {
    if (event.repeat) return;
    event.preventDefault();
    toggleHelp();
    return;
  }
  if (event.code === "Escape") {
    toggleHelp(false);
    return;
  }
  if (state.paused || state.replaying || state.completed || ui.helpDrawer.classList.contains("is-open")) return;

  const digit = /^Digit([1-6])$/.exec(event.code);
  if (digit) {
    event.preventDefault();
    if (!event.repeat) changeGel(GEL_KEYS[Number(digit[1]) - 1], "keyboard");
    return;
  }
  const mapping = KEY_ACTIONS[event.code];
  if (!mapping) return;
  event.preventDefault();
  if (event.repeat) return;
  beginHeldKey(event.code, mapping);
}

function handleKeyup(event) {
  if (KEY_ACTIONS[event.code]) releaseKey(event.code);
}

function tick(now) {
  const delta = Math.min((now - state.lastFrame) / 1000, 0.05);
  state.lastFrame = now;

  if (state.replaying) {
    if (!state.replayPaused) state.frameTime += delta;
    updateReplay(delta);
    window.requestAnimationFrame(tick);
    return;
  }

  const active = !state.paused && !state.completed;
  if (active) {
    state.frameTime += delta;
    state.elapsed += delta;
    updateHeldInput(delta);
  }

  const roles = cloneRoles();
  const exposure = computeExposure(roles);
  updateMetrics(roles, exposure);

  if (active) {
    const goal = currentGoal();
    const matches = goalMatches(roles, goal);
    state.holdTime = matches && !state.overexposed
      ? Math.min(HOLD_REQUIRED, state.holdTime + delta)
      : Math.max(0, state.holdTime - delta * 3.2);
    if (state.holdTime >= HOLD_REQUIRED) completeGoal();
  }

  updateHud(roles, exposure);
  applyRolesToControls(roles);
  renderer.draw(roles, exposure, state.frameTime, state.paused);
  audio.update(roles, exposure, state.paused || state.completed);
  window.requestAnimationFrame(tick);
}

function init() {
  renderGoalList();
  renderGoalBrief();
  applyRolesToControls(cloneRoles());
  ["key", "rim", "gel"].forEach((role) => setConnectionUI(role, true));
  updateControlAvailability();
  setPauseUI(false, false);
  recordEvent("三路控制器接入 · 共享光场同步", "link", { force: true });

  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("keyup", handleKeyup);
  window.addEventListener("blur", () => clearHeldKeys());

  Object.entries(controls).forEach(([name, input]) => {
    const role = name.startsWith("key") ? "key" : name.startsWith("rim") ? "rim" : "gel";
    const field = name.startsWith("key")
      ? name.slice(3).replace(/^./, (letter) => letter.toLowerCase())
      : name.startsWith("rim")
        ? name.slice(3).replace(/^./, (letter) => letter.toLowerCase())
        : name.slice(3).replace(/^./, (letter) => letter.toLowerCase());
    input.addEventListener("input", () => setRoleFromInput(role, field, Number(input.value), input));
    input.addEventListener("pointerdown", tryEnableAudio);
  });

  ui.gelatinPalette.addEventListener("click", (event) => {
    const button = event.target.closest(".gel-swatch");
    if (!button) return;
    tryEnableAudio();
    changeGel(button.dataset.gel);
  });
  $$(".link-toggle").forEach((button) => {
    button.addEventListener("click", () => toggleConnection(button.dataset.disconnect));
  });
  $$(".crew-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const role = chip.dataset.focusRole;
      const card = $(`#console${role[0].toUpperCase()}${role.slice(1)}`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.animate(
        [{ boxShadow: "0 0 0 1px transparent" }, { boxShadow: `0 0 0 1px ${getComputedStyle(card).getPropertyValue("--role-color")}` }, { boxShadow: "0 0 0 1px transparent" }],
        { duration: 900, easing: "ease-out" },
      );
    });
  });

  ui.pauseBtn.addEventListener("click", togglePause);
  ui.replayBtn.addEventListener("click", toggleReplay);
  ui.soundBtn.addEventListener("click", async () => {
    if (!audio.started) {
      audioAttempted = true;
      await audio.enable();
    } else {
      audio.setMuted(!audio.muted);
    }
    const on = audio.started && !audio.muted;
    ui.soundBtn.classList.toggle("is-on", on);
    ui.soundBtn.setAttribute("aria-pressed", String(on));
    ui.soundLabel.textContent = on ? "声场开" : "声场关";
  });
  $("#helpBtn").addEventListener("click", () => toggleHelp(true));
  $("#closeHelpBtn").addEventListener("click", () => toggleHelp(false));
  $("#helpDoneBtn").addEventListener("click", () => toggleHelp(false));
  $("#startReplayBtn").addEventListener("click", startReplay);
  $("#restartBtn").addEventListener("click", () => window.location.reload());
  ui.helpDrawer.addEventListener("click", (event) => {
    if (event.target === ui.helpDrawer) toggleHelp(false);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("#soundBtn")) tryEnableAudio();
  }, true);

  window.__lumen = {
    getState: () => ({
      roles: cloneRoles(),
      goalIndex: state.goalIndex,
      goal: currentGoal().name,
      completedGoals: [...state.completedGoals],
      holdTime: Number(state.holdTime.toFixed(2)),
      elapsed: Number(state.elapsed.toFixed(2)),
      paused: state.paused,
      completed: state.completed,
      replaying: state.replaying,
      replayPaused: state.replayPaused,
      replayPosition: Number(state.replayPosition.toFixed(2)),
      replayDuration: Number(state.replayDuration.toFixed(2)),
      overexposed: state.overexposed,
      overexposureCount: state.overexposureCount,
      exposure: Number(computeExposure(cloneRoles()).toFixed(3)),
      events: state.events.map((event) => ({ t: event.t, label: event.label, kind: event.kind })),
    }),
    setControl: (role, field, value) => {
      mutateRole(role, field, value, true, `${ROLE_NAMES[role]}调整至 ${Math.round(value)}`);
      applyRolesToControls(cloneRoles());
      refreshGelPalette();
    },
    selectGel: (color) => changeGel(color),
    toggleConnection,
    togglePause,
    startReplay,
    exitReplay,
    getAudio: () => audio.snapshot(),
    getUi: () => ({
      pauseOverlay: !ui.pauseOverlay.hidden,
      replayHud: !ui.replayHud.hidden,
      completionOpen: ui.completionDialog.classList.contains("is-open"),
      exposureAlert: ui.exposureAlert.classList.contains("is-visible"),
      statuses: {
        key: $("#keyStatus").textContent.trim(),
        rim: $("#rimStatus").textContent.trim(),
        gel: $("#gelStatus").textContent.trim(),
      },
      disabled: Object.fromEntries(Object.entries(controls).map(([name, input]) => [name, input.disabled])),
    }),
  };

  state.lastFrame = performance.now();
  window.requestAnimationFrame(tick);
}

init();
