/* 繁忙车站 · 行李推车 —— 俯视站台 Canvas 小游戏 */
"use strict";

const W = 1000;
const H = 640;
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const overlayEl = document.getElementById("overlay");

const TRAIN_COLORS = ["#e05656", "#4d9de0", "#55b06a"];
const TRAIN_NAMES = ["G101", "D202", "K303"];
const TRAIN_BANDS = [
  { y0: 50, y1: 210 },
  { y0: 250, y1: 410 },
  { y0: 450, y1: 610 },
];
const TRAIN_X = 880;
const DOOR_ZONE = { x0: 800, x1: 880 };
const DEPART_TIMES = [75, 110, 145];
const MAX_HITS = 3;
const TOTAL_LUGGAGE = 5;
const LUGGAGE_ASSIGN = [0, 0, 1, 1, 2];
const TOPPLE_THRESHOLD = 800;
const PICKUP_RADIUS = 30;

const state = {
  phase: "ready", // ready | playing | won | lost
  time: 0,
  cart: {
    x: 120,
    y: 320,
    angle: 0,
    speed: 0,
    steer: 0,
    load: [],
    toppleTimer: 0,
    lean: 0,
  },
  luggage: [],
  passengers: [],
  trains: [],
  hits: 0,
  delivered: 0,
  missed: 0,
  messages: [],
  events: [],
};

const input = { up: false, down: false, left: false, right: false };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function logEvent(type) {
  state.events.push({ type, t: state.time });
}

function pushMessage(text, ttl) {
  state.messages.push({ text, ttl: ttl || 3 });
}

/* ---------- 音频：广播提示音与碰撞提示 ---------- */
const audio = {
  ctx: null,
  log: [],
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, type, gain, when) {
    const ac = this.ensure();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    const t0 = ac.currentTime + (when || 0);
    g.gain.setValueAtTime(gain || 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  },
  noise(dur, gain, freq) {
    const ac = this.ensure();
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq || 400;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain || 0.3, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    src.connect(filter).connect(g).connect(ac.destination);
    src.start();
  },
  announce() {
    this.log.push("announce");
    this.tone(660, 0.25, "sine", 0.18, 0);
    this.tone(520, 0.35, "sine", 0.18, 0.3);
  },
  depart() {
    this.log.push("depart");
    this.tone(520, 0.2, "square", 0.12, 0);
    this.tone(660, 0.2, "square", 0.12, 0.25);
    this.tone(520, 0.4, "square", 0.12, 0.5);
  },
  collision() {
    this.log.push("collision");
    this.noise(0.18, 0.4, 300);
    this.tone(90, 0.25, "sine", 0.35, 0);
  },
  pickup() {
    this.log.push("pickup");
    this.tone(440, 0.08, "triangle", 0.2, 0);
    this.tone(660, 0.1, "triangle", 0.2, 0.08);
  },
  deliver() {
    this.log.push("deliver");
    this.tone(523, 0.12, "triangle", 0.2, 0);
    this.tone(659, 0.12, "triangle", 0.2, 0.12);
    this.tone(784, 0.25, "triangle", 0.2, 0.24);
  },
  topple() {
    this.log.push("topple");
    this.noise(0.4, 0.45, 500);
    this.tone(140, 0.35, "sawtooth", 0.2, 0);
  },
};

/* ---------- 世界初始化 ---------- */
function resetWorld(seed) {
  state.rng = mulberry32(seed === undefined ? (Date.now() % 2147483647) : seed);
  state.phase = "playing";
  state.time = 0;
  state.hits = 0;
  state.delivered = 0;
  state.missed = 0;
  state.messages = [];
  state.events = [];
  state.cart = {
    x: 120, y: 320, angle: 0, speed: 0, steer: 0,
    load: [], toppleTimer: 0, lean: 0,
  };
  state.luggage = LUGGAGE_ASSIGN.map((train, i) => ({
    id: i,
    train,
    x: 60 + (i % 2) * 60,
    y: 140 + Math.floor(i / 2) * 90,
    status: "ground", // ground | cart | delivered | missed
    vx: 0, vy: 0,
  }));
  state.trains = TRAIN_BANDS.map((band, i) => ({
    id: i,
    name: TRAIN_NAMES[i],
    color: TRAIN_COLORS[i],
    y0: band.y0,
    y1: band.y1,
    departAt: DEPART_TIMES[i],
    departed: false,
    warned: false,
    offset: 0,
  }));
  state.passengers = makePassengers();
  audio.announce();
  pushMessage("广播：列车即将进站，请将行李送达对应月台", 4);
  logEvent("start");
}

function makePassengers() {
  const rnd = state.rng;
  const paths = [
    // 横向走廊
    [[240, 230], [760, 230]],
    [[760, 430], [240, 430]],
    // 纵向通道
    [[420, 80], [420, 580]],
    [[620, 580], [620, 80]],
    // 斜穿大厅
    [[260, 120], [740, 120], [740, 540], [260, 540]],
    [[300, 560], [700, 80]],
  ];
  const pax = [];
  let id = 0;
  paths.forEach((path, pi) => {
    const count = pi % 2 === 0 ? 2 : 1; // 共 9 名旅客
    for (let k = 0; k < count; k++) {
      pax.push({
        id: id++,
        path,
        seg: k % path.length,
        prog: rnd(),
        speed: 38 + rnd() * 24,
        x: 0, y: 0,
        hitCooldown: 0,
        hue: Math.floor(rnd() * 360),
      });
    }
  });
  return pax;
}

/* ---------- 更新逻辑 ---------- */
function updatePassenger(p, dt) {
  const path = p.path;
  const a = path[p.seg];
  const b = path[(p.seg + 1) % path.length];
  const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
  p.prog += (p.speed * dt) / segLen;
  if (p.prog >= 1) {
    p.prog = 0;
    p.seg = (p.seg + 1) % path.length;
  }
  const na = path[p.seg];
  const nb = path[(p.seg + 1) % path.length];
  p.x = na[0] + (nb[0] - na[0]) * p.prog;
  p.y = na[1] + (nb[1] - na[1]) * p.prog;
  const nLen = Math.hypot(nb[0] - na[0], nb[1] - na[1]) || 1;
  p.vx = ((nb[0] - na[0]) / nLen) * p.speed;
  p.vy = ((nb[1] - na[1]) / nLen) * p.speed;
  if (p.hitCooldown > 0) p.hitCooldown -= dt;
}

function updateCart(dt) {
  const c = state.cart;
  const load = c.load.length;
  if (c.toppleTimer > 0) {
    c.toppleTimer -= dt;
    c.speed *= Math.max(0, 1 - 4 * dt);
  }
  const maxSpeed = 230 - 14 * load;
  const accel = 150;
  const brakeDecel = Math.max(90, 280 - 34 * load); // 堆得越高制动越差
  const coast = 55;

  if (input.up) c.speed += accel * dt;
  if (input.down) {
    if (c.speed > 0) c.speed -= brakeDecel * dt;
    else c.speed -= accel * 0.5 * dt; // 倒车
  }
  if (!input.up && !input.down) {
    const s = Math.sign(c.speed);
    c.speed -= s * coast * dt;
    if (Math.sign(c.speed) !== s) c.speed = 0;
  }
  c.speed = Math.max(-70, Math.min(maxSpeed, c.speed));

  let steerIn = 0;
  if (input.left) steerIn -= 1;
  if (input.right) steerIn += 1;
  c.steer += (steerIn - c.steer) * Math.min(1, 10 * dt);
  const speedFactor = Math.min(1, Math.abs(c.speed) / 140);
  const angVel = c.steer * 2.6 * speedFactor * Math.sign(c.speed || 1);
  c.angle += angVel * dt;

  // 重心与侧倾：横向加速度随堆高放大倾覆风险
  const latAccel = Math.abs(c.speed * angVel);
  const cogFactor = 0.6 + 0.5 * load;
  c.lean += ((c.steer * Math.min(1, latAccel / 400) * load * 0.25) - c.lean) * Math.min(1, 8 * dt);
  if (load > 0 && latAccel * cogFactor > TOPPLE_THRESHOLD && c.toppleTimer <= 0) {
    toppleLuggage();
  }

  c.x += Math.cos(c.angle) * c.speed * dt;
  c.y += Math.sin(c.angle) * c.speed * dt;
  c.x = Math.max(24, Math.min(W - 130, c.x));
  c.y = Math.max(24, Math.min(H - 24, c.y));
}

function toppleLuggage() {
  const c = state.cart;
  const n = Math.ceil(c.load.length / 2);
  for (let i = 0; i < n; i++) {
    const lug = c.load.pop();
    lug.status = "ground";
    const a = state.rng() * Math.PI * 2;
    lug.x = Math.max(30, Math.min(W - 150, c.x + Math.cos(a) * (30 + state.rng() * 40)));
    lug.y = Math.max(30, Math.min(H - 30, c.y + Math.sin(a) * (30 + state.rng() * 40)));
  }
  c.toppleTimer = 0.8;
  audio.topple();
  pushMessage("行李倒塌！堆叠过高时急转会失去平衡", 3);
  logEvent("topple");
}

function updateInteractions(dt) {
  const c = state.cart;
  // 拾取地面行李
  for (const lug of state.luggage) {
    if (lug.status !== "ground") continue;
    if (Math.hypot(lug.x - c.x, lug.y - c.y) < PICKUP_RADIUS) {
      lug.status = "cart";
      c.load.push(lug);
      audio.pickup();
      pushMessage(`已装上 ${lug.id + 1} 号行李（目的地 ${TRAIN_NAMES[lug.train]}）`, 2.5);
      logEvent("pickup");
    }
  }
  // 交付：进入对应列车车门区域
  for (const train of state.trains) {
    if (train.departed) continue;
    const doorY = (train.y0 + train.y1) / 2;
    const inZone =
      c.x > DOOR_ZONE.x0 && c.x < DOOR_ZONE.x1 &&
      Math.abs(c.y - doorY) < 55;
    if (!inZone) continue;
    const match = c.load.filter((l) => l.train === train.id);
    if (match.length > 0) {
      for (const lug of match) {
        lug.status = "delivered";
        state.delivered++;
      }
      c.load = c.load.filter((l) => l.train !== train.id);
      audio.deliver();
      pushMessage(`${train.name} 收到 ${match.length} 件行李！`, 2.5);
      logEvent("deliver");
    }
  }
  // 撞人
  for (const p of state.passengers) {
    if (p.hitCooldown > 0) continue;
    if (Math.hypot(p.x - c.x, p.y - c.y) < 24) {
      p.hitCooldown = 1.6;
      state.hits++;
      c.speed *= 0.35;
      audio.collision();
      pushMessage(`撞到旅客！（${state.hits}/${MAX_HITS}）`, 2.5);
      logEvent("hit");
      if (state.hits >= MAX_HITS) {
        endGame(false, "撞人过多，车站安全员叫停了推车");
      }
    }
  }
}

function updateTrains(dt) {
  for (const train of state.trains) {
    if (train.departed) {
      train.offset += 260 * dt;
      continue;
    }
    const remain = train.departAt - state.time;
    if (remain <= 10 && !train.warned) {
      train.warned = true;
      audio.announce();
      pushMessage(`广播：${train.name} 即将发车，请尽快送达行李`, 3.5);
      logEvent("warn");
    }
    if (remain <= 0) {
      train.departed = true;
      audio.depart();
      let lost = 0;
      for (const lug of state.luggage) {
        if (lug.train !== train.id) continue;
        if (lug.status === "ground" || lug.status === "cart") {
          if (lug.status === "cart") {
            state.cart.load = state.cart.load.filter((l) => l !== lug);
          }
          lug.status = "missed";
          lost++;
        }
      }
      state.missed += lost;
      pushMessage(lost > 0 ? `${train.name} 已发车，${lost} 件行李未能送达` : `${train.name} 准点发车`, 3.5);
      logEvent("depart");
    }
  }
}

function endGame(won, reason) {
  if (state.phase !== "playing") return;
  state.phase = won ? "won" : "lost";
  state.endReason = reason;
  logEvent(won ? "won" : "lost");
}

function checkGameEnd() {
  if (state.phase !== "playing") return;
  if (state.delivered === TOTAL_LUGGAGE) {
    endGame(true, "全部行李准点送达！");
    return;
  }
  const allGone = state.trains.every((t) => t.departed);
  if (allGone) {
    endGame(state.delivered > 0, `完成 ${state.delivered}/${TOTAL_LUGGAGE} 件行李配送`);
  }
}

function update(dt) {
  if (state.phase !== "playing") return;
  if (typeof window.GAME_HOOK === "function") window.GAME_HOOK(dt);
  state.time += dt;
  updateCart(dt);
  for (const p of state.passengers) updatePassenger(p, dt);
  updateInteractions(dt);
  updateTrains(dt);
  for (const m of state.messages) m.ttl -= dt;
  state.messages = state.messages.filter((m) => m.ttl > 0);
  checkGameEnd();
}

/* ---------- 渲染 ---------- */
function drawPlatform() {
  ctx.fillStyle = "#232a34";
  ctx.fillRect(0, 0, W, H);
  // 地砖纹理
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 50) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 50) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  // 行李提取区
  ctx.fillStyle = "rgba(77,157,224,0.12)";
  ctx.fillRect(20, 80, 160, 480);
  ctx.strokeStyle = "rgba(77,157,224,0.5)";
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(20, 80, 160, 480);
  ctx.setLineDash([]);
  ctx.fillStyle = "#7fb3e0";
  ctx.font = "13px sans-serif";
  ctx.fillText("行李提取区", 30, 72);
  // 黄色安全线
  ctx.strokeStyle = "#c9a53f";
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 8]);
  ctx.beginPath(); ctx.moveTo(790, 0); ctx.lineTo(790, H); ctx.stroke();
  ctx.setLineDash([]);
}

function drawTrains() {
  for (const train of state.trains) {
    const x = TRAIN_X + train.offset;
    const h = train.y1 - train.y0;
    ctx.fillStyle = train.departed ? "rgba(90,96,104,0.6)" : train.color;
    ctx.fillRect(x, train.y0, W - x + train.offset, h);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    for (let wy = train.y0 + 14; wy < train.y1 - 10; wy += 26) {
      ctx.fillRect(x + 8, wy, 22, 12);
    }
    // 车门区域
    const doorY = (train.y0 + train.y1) / 2;
    if (!train.departed) {
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(DOOR_ZONE.x0, doorY - 55, DOOR_ZONE.x1 - DOOR_ZONE.x0, 110);
      ctx.strokeStyle = train.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(DOOR_ZONE.x0, doorY - 55, DOOR_ZONE.x1 - DOOR_ZONE.x0, 110);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(`${train.name} 车门`, DOOR_ZONE.x0 + 6, doorY - 60);
    }
    // 发车倒计时
    ctx.fillStyle = train.departed ? "#888" : (train.departAt - state.time < 10 ? "#ff7b7b" : "#ffd27d");
    ctx.font = "bold 15px monospace";
    const label = train.departed ? "已发车" : `发车 ${Math.max(0, train.departAt - state.time).toFixed(0)}s`;
    ctx.fillText(`${train.name} ${label}`, DOOR_ZONE.x0 - 10, train.y0 + 18);
  }
}

function drawLuggageItem(x, y, train, scale) {
  const s = scale || 1;
  ctx.fillStyle = TRAIN_COLORS[train];
  ctx.fillRect(x - 8 * s, y - 6 * s, 16 * s, 12 * s);
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - 8 * s, y - 6 * s, 16 * s, 12 * s);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.moveTo(x - 4 * s, y - 6 * s);
  ctx.lineTo(x - 4 * s, y - 9 * s);
  ctx.lineTo(x + 4 * s, y - 9 * s);
  ctx.lineTo(x + 4 * s, y - 6 * s);
  ctx.stroke();
}

function drawGroundLuggage() {
  for (const lug of state.luggage) {
    if (lug.status !== "ground") continue;
    drawLuggageItem(lug.x, lug.y, lug.train, 1);
    ctx.fillStyle = "#cfd8e3";
    ctx.font = "10px monospace";
    ctx.fillText(String(lug.id + 1), lug.x - 3, lug.y + 16);
  }
}

function passengerVisible(p) {
  // 堆叠过高时，车头前方锥形区域被行李遮挡
  const c = state.cart;
  const load = c.load.length;
  if (load < 3) return true;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const dist = Math.hypot(dx, dy);
  const range = 80 + 30 * load;
  if (dist > range) return true;
  const ang = Math.atan2(dy, dx);
  let diff = ang - c.angle;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return Math.abs(diff) > 0.6;
}

function drawPassengers() {
  for (const p of state.passengers) {
    if (!passengerVisible(p)) continue;
    ctx.fillStyle = `hsl(${p.hue}, 45%, ${p.hitCooldown > 0 ? 75 : 60}%)`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.arc(p.x, p.y - 2, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCart() {
  const c = state.cart;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.angle);
  // 车身
  ctx.fillStyle = c.toppleTimer > 0 ? "#a08850" : "#c8b06a";
  ctx.fillRect(-20, -14, 40, 28);
  ctx.strokeStyle = "#5a4d2a";
  ctx.lineWidth = 2;
  ctx.strokeRect(-20, -14, 40, 28);
  // 车轮
  ctx.fillStyle = "#222";
  ctx.fillRect(-16, -18, 8, 5);
  ctx.fillRect(8, -18, 8, 5);
  ctx.fillRect(-16, 13, 8, 5);
  ctx.fillRect(8, 13, 8, 5);
  // 推把
  ctx.strokeStyle = "#8a7a4a";
  ctx.beginPath();
  ctx.moveTo(-20, -8);
  ctx.lineTo(-28, -8);
  ctx.moveTo(-20, 8);
  ctx.lineTo(-28, 8);
  ctx.stroke();
  // 堆叠行李：随转向侧倾，直观显示重心偏移
  const leanPx = c.lean * 6;
  c.load.forEach((lug, i) => {
    const off = (i + 1) * leanPx * 0.4;
    ctx.save();
    ctx.translate(off, -off * 0.3);
    drawLuggageItem(0, 0, lug.train, 1 + i * 0.06);
    ctx.restore();
  });
  // 重心标记
  if (c.load.length > 0) {
    const cogX = (c.load.length * leanPx * 0.4) / 2;
    ctx.strokeStyle = "rgba(255,80,80,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cogX, 0, 5, 0, Math.PI * 2);
    ctx.moveTo(cogX - 7, 0); ctx.lineTo(cogX + 7, 0);
    ctx.moveTo(cogX, -7); ctx.lineTo(cogX, 7);
    ctx.stroke();
  }
  ctx.restore();

  // 遮挡视线的行李堆阴影锥（堆高 >= 3 时显示）
  if (c.load.length >= 3) {
    const range = 80 + 30 * c.load.length;
    ctx.fillStyle = "rgba(20,16,8,0.35)";
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.arc(c.x, c.y, range, c.angle - 0.6, c.angle + 0.6);
    ctx.closePath();
    ctx.fill();
  }
}

function drawVignette() {
  const load = state.cart.load.length;
  if (load === 0) return;
  const alpha = Math.min(0.45, load * 0.09);
  const g = ctx.createRadialGradient(W / 2, H / 2, 180, W / 2, H / 2, 620);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawHUD() {
  const c = state.cart;
  ctx.fillStyle = "rgba(10,14,20,0.75)";
  ctx.fillRect(0, 0, W, 34);
  ctx.fillStyle = "#dfe6ee";
  ctx.font = "14px monospace";
  const load = c.load.length;
  const loadWarn = load >= 3 ? " ⚠视线/制动受限" : "";
  ctx.fillText(
    `已送达 ${state.delivered}/${TOTAL_LUGGAGE}  错过 ${state.missed}  撞人 ${state.hits}/${MAX_HITS}` +
    `  车载 ${load} 件${loadWarn}  速度 ${Math.abs(c.speed).toFixed(0)}`,
    12, 22
  );
  // 重心指示条
  ctx.fillStyle = "rgba(10,14,20,0.75)";
  ctx.fillRect(12, H - 34, 220, 24);
  ctx.fillStyle = "#9fb0c3";
  ctx.font = "12px monospace";
  ctx.fillText("重心", 18, H - 18);
  ctx.strokeStyle = "#556";
  ctx.strokeRect(60, H - 29, 160, 14);
  const lean = Math.max(-1, Math.min(1, c.lean));
  const risk = Math.min(1, (load * (0.6 + 0.5 * load)) / 8);
  ctx.fillStyle = risk > 0.6 ? "#e05656" : "#55b06a";
  const cx = 140 + lean * 70;
  ctx.fillRect(cx - 6, H - 27, 12, 10);
  // 消息
  ctx.font = "14px sans-serif";
  state.messages.forEach((m, i) => {
    ctx.fillStyle = "rgba(10,14,20,0.7)";
    ctx.fillRect(240, H - 34 - i * 26, 520, 22);
    ctx.fillStyle = "#ffd27d";
    ctx.fillText(m.text, 248, H - 18 - i * 26);
  });
}

function drawEndScreen() {
  if (state.phase === "playing" || state.phase === "ready") return;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = state.phase === "won" ? "#7de08a" : "#ff7b7b";
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(state.phase === "won" ? "任务完成" : "任务失败", W / 2, H / 2 - 40);
  ctx.fillStyle = "#dfe6ee";
  ctx.font = "20px sans-serif";
  ctx.fillText(state.endReason || "", W / 2, H / 2 + 4);
  ctx.font = "16px sans-serif";
  ctx.fillText(`送达 ${state.delivered}/${TOTAL_LUGGAGE} · 撞人 ${state.hits} 次`, W / 2, H / 2 + 36);
  ctx.fillText("按 回车 重新开始", W / 2, H / 2 + 70);
  ctx.textAlign = "left";
}

function drawReady() {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd27d";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText("繁忙车站 · 行李推车", W / 2, H / 2 - 30);
  ctx.fillStyle = "#dfe6ee";
  ctx.font = "16px sans-serif";
  ctx.fillText("↑↓ 控制速度，←→ 转向。行李颜色对应列车颜色。", W / 2, H / 2 + 6);
  ctx.fillText("堆太高会遮挡视线、削弱制动，急转可能倒塌！", W / 2, H / 2 + 32);
  ctx.fillText("按 回车 开始", W / 2, H / 2 + 66);
  ctx.textAlign = "left";
}

function render() {
  drawPlatform();
  drawTrains();
  drawGroundLuggage();
  drawPassengers();
  drawCart();
  drawVignette();
  drawHUD();
  if (state.phase === "ready") drawReady();
  drawEndScreen();
}

/* ---------- 输入 ---------- */
const KEYMAP = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};

window.addEventListener("keydown", (e) => {
  if (e.code === "Enter" && state.phase !== "playing") {
    audio.ensure();
    resetWorld();
    return;
  }
  const k = KEYMAP[e.code];
  if (k) {
    input[k] = true;
    e.preventDefault();
  }
});

window.addEventListener("keyup", (e) => {
  const k = KEYMAP[e.code];
  if (k) input[k] = false;
});

/* ---------- 主循环（固定步长，支持测试加速） ---------- */
let timeScale = 1;
let lastTs = 0;
let accumulator = 0;
const STEP = 1 / 120;

function frame(ts) {
  if (!lastTs) lastTs = ts;
  let dt = ((ts - lastTs) / 1000) * timeScale;
  lastTs = ts;
  dt = Math.min(dt, 0.25);
  accumulator += dt;
  while (accumulator >= STEP) {
    update(STEP);
    accumulator -= STEP;
  }
  render();
  overlayEl.textContent =
    state.phase === "playing"
      ? `时间 ${state.time.toFixed(1)}s`
      : "";
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- 测试 / 调试 API ---------- */
window.GAME = {
  state,
  input,
  audio,
  start: resetWorld,
  setTimeScale(v) { timeScale = v; },
  setInput(patch) { Object.assign(input, patch); },
  teleport(x, y, angle) {
    state.cart.x = x;
    state.cart.y = y;
    if (angle !== undefined) state.cart.angle = angle;
  },
  debugLoad(n) {
    let added = 0;
    for (const lug of state.luggage) {
      if (added >= n) break;
      if (lug.status === "ground") {
        lug.status = "cart";
        state.cart.load.push(lug);
        added++;
      }
    }
    return added;
  },
  snapshot() {
    return {
      phase: state.phase,
      time: state.time,
      cart: {
        x: state.cart.x,
        y: state.cart.y,
        angle: state.cart.angle,
        speed: state.cart.speed,
        load: state.cart.load.length,
      },
      delivered: state.delivered,
      missed: state.missed,
      hits: state.hits,
      events: state.events.map((e) => e.type),
      audioLog: audio.log.slice(),
      luggage: state.luggage.map((l) => ({ id: l.id, train: l.train, status: l.status, x: l.x, y: l.y })),
      trains: state.trains.map((t) => ({ id: t.id, departed: t.departed, departAt: t.departAt })),
      passengers: state.passengers.map((p) => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy })),
    };
  },
};
