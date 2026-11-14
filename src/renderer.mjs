import { CONFIG } from "./game-model.mjs";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (start, end, amount) => start + (end - start) * amount;

const COLORS = {
  ink: "#dcece8",
  muted: "#829b97",
  dim: "#526a68",
  teal: "#61e8cf",
  cyan: "#6cc9ef",
  amber: "#f1b45a",
  orange: "#f27e4d",
  red: "#f05c5c",
  lime: "#b9e178",
  map: "#0a191a",
  land: "#102526",
  road: "#152b2c",
};

const MONO_FAMILY = '"SFMono-Regular", "Liberation Mono", "Harbor Sans SC", monospace';

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function panelFrame(ctx, x, y, width, height, label) {
  ctx.save();
  ctx.fillStyle = "rgba(8, 23, 24, 0.72)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(112, 177, 170, 0.2)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.fillStyle = COLORS.teal;
  ctx.font = `600 10px ${MONO_FAMILY}`;
  ctx.fillText(label, x + 14, y + 19);
  ctx.restore();
}

function levelY(level, bottom, span) {
  return bottom - clamp(level, 0, 1.08) * span;
}

export class HarborRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = canvas.width;
    this.height = canvas.height;
    this.samples = [];
    this.lastSampleTime = -1;
    this.rain = Array.from({ length: 94 }, (_, index) => ({
      x: (index * 137.7) % this.width,
      y: (index * 73.1) % 480,
      speed: 34 + (index % 9) * 4.5,
      length: 5 + (index % 5) * 2.2,
    }));
    this.particles = Array.from({ length: 18 }, (_, index) => ({
      offset: index / 18,
      y: 475 + ((index * 7) % 9),
    }));
  }

  reset() {
    this.samples = [];
    this.lastSampleTime = -1;
  }

  recordSample(state) {
    if (state.status === "ready" || state.time < this.lastSampleTime) {
      this.samples = [];
    }
    if (state.status === "ready" || state.time - this.lastSampleTime < 0.55) {
      return;
    }
    this.samples.push({
      time: state.time,
      tide: state.tide,
      water: state.water,
    });
    this.lastSampleTime = state.time;
    if (this.samples.length > 420) {
      this.samples.shift();
    }
  }

  render(state, now = performance.now() / 1000) {
    const ctx = this.ctx;
    this.recordSample(state);
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop(ctx, now, state.storm);
    this.drawMap(ctx, state, now);
    this.drawChart(ctx, state, now);
    this.drawRain(ctx, state, now);
    if (state.status === "lost") {
      this.drawFailureGlitch(ctx, now, state.fail?.code);
    }
    this.drawFrameMarks(ctx, state, now);
  }

  drawBackdrop(ctx, now, storm) {
    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, "#081617");
    gradient.addColorStop(0.55, "#071415");
    gradient.addColorStop(1, "#061112");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.strokeStyle = "#769c97";
    ctx.lineWidth = 0.6;
    for (let x = 0; x < this.width; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, this.height);
      ctx.stroke();
    }
    for (let y = 0; y < this.height; y += 36) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(this.width, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    const glow = ctx.createRadialGradient(640, 342, 30, 640, 342, 580);
    glow.addColorStop(0, `rgba(38, 117, 108, ${0.035 + storm * 0.035})`);
    glow.addColorStop(1, "rgba(4, 12, 13, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, 510);
    void now;
  }

  drawMap(ctx, state, now) {
    panelFrame(ctx, 24, 24, 1152, 484, "SECTOR MAP / LIVE");
    this.drawMapSea(ctx, state, now);
    this.drawPortLand(ctx, state);
    this.drawWarehouses(ctx);
    this.drawRoad(ctx, state, now);
    this.drawSafeZone(ctx, now);
    for (const gate of state.gates) {
      this.drawGate(ctx, gate, state, now);
    }
    this.drawPump(ctx, state, now);
    for (const vehicle of state.vehicles) {
      if (vehicle.status === "safe") {
        continue;
      }
      this.drawVehicle(ctx, vehicle, state, now);
    }
    this.drawMapCaption(ctx, state);
  }

  drawMapSea(ctx, state, now) {
    const tideRise = clamp((state.tide - CONFIG.tideStart) / 0.35, 0, 1);
    const seaX = 42;
    const seaY = 48;
    const seaW = 180;
    const seaH = 443;
    const seaGradient = ctx.createLinearGradient(seaX, seaY, seaX, seaY + seaH);
    seaGradient.addColorStop(0, "rgba(49, 126, 141, 0.22)");
    seaGradient.addColorStop(1, `rgba(12, 43, 51, ${0.66 + tideRise * 0.18})`);
    ctx.fillStyle = seaGradient;
    ctx.fillRect(seaX, seaY, seaW, seaH);

    ctx.save();
    ctx.strokeStyle = "rgba(108, 201, 239, 0.24)";
    ctx.lineWidth = 1;
    for (let band = 0; band < 8; band += 1) {
      const y = seaY + 48 + band * 47 + Math.sin(now * 1.4 + band) * 4;
      ctx.beginPath();
      for (let x = seaX + 7; x <= seaX + seaW - 5; x += 9) {
        const wave = Math.sin(x * 0.07 + now * 1.8 + band * 0.4) * 3;
        ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    const foam = ctx.createLinearGradient(220, 0, 250, 0);
    foam.addColorStop(0, "rgba(124, 225, 222, 0.03)");
    foam.addColorStop(1, "rgba(124, 225, 222, 0.22)");
    ctx.fillStyle = foam;
    ctx.fillRect(218, 48, 26, 443);
    ctx.strokeStyle = "rgba(124, 225, 222, 0.35)";
    for (let y = 60; y < 480; y += 25) {
      const drift = (now * 23 + y * 2.3) % 32;
      ctx.beginPath();
      ctx.arc(225 + drift, y, 2.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPortLand(ctx, state) {
    const gradient = ctx.createLinearGradient(244, 48, 244, 491);
    gradient.addColorStop(0, "#102324");
    gradient.addColorStop(0.7, "#0a1b1c");
    gradient.addColorStop(1, "#071617");
    ctx.fillStyle = gradient;
    ctx.fillRect(244, 48, 912, 443);

    ctx.save();
    ctx.strokeStyle = "rgba(117, 169, 160, 0.11)";
    ctx.lineWidth = 0.8;
    for (let x = 260; x < 1140; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 48);
      ctx.lineTo(x + 0.5, 491);
      ctx.stroke();
    }
    for (let y = 58; y < 490; y += 24) {
      ctx.beginPath();
      ctx.moveTo(244, y + 0.5);
      ctx.lineTo(1156, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(58, 103, 98, 0.3)";
    ctx.fillRect(244, 300, 912, 10);
    ctx.fillStyle = "rgba(97, 232, 207, 0.08)";
    ctx.fillRect(244, 310, 912, 2);

    const submerged = clamp((state.water - 0.48) / 0.32, 0, 0.24);
    ctx.fillStyle = `rgba(21, 87, 87, ${submerged})`;
    ctx.fillRect(250, 462, 900, 29);
  }

  drawWarehouses(ctx) {
    const blocks = [
      { x: 278, y: 75, w: 148, h: 76, label: "散货仓 02" },
      { x: 450, y: 75, w: 112, h: 76, label: "冷链 04" },
      { x: 590, y: 75, w: 164, h: 76, label: "集装箱堆场" },
      { x: 780, y: 75, w: 142, h: 76, label: "维修库" },
      { x: 950, y: 75, w: 166, h: 76, label: "高地转运站" },
    ];
    ctx.save();
    for (const block of blocks) {
      ctx.fillStyle = "#10292a";
      ctx.fillRect(block.x, block.y, block.w, block.h);
      ctx.strokeStyle = "rgba(129, 182, 173, 0.24)";
      ctx.strokeRect(block.x + 0.5, block.y + 0.5, block.w - 1, block.h - 1);
      ctx.fillStyle = "rgba(97, 232, 207, 0.08)";
      ctx.fillRect(block.x + 7, block.y + 9, block.w - 14, 3);
      ctx.fillRect(block.x + 7, block.y + 16, block.w * 0.42, 2);
      ctx.fillStyle = "rgba(177, 211, 204, 0.34)";
      ctx.font = `500 9px ${MONO_FAMILY}`;
      ctx.fillText(block.label, block.x + 8, block.y + block.h - 10);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(108, 201, 239, 0.18)";
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(278, 183);
    ctx.lineTo(1116, 183);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(130, 165, 159, 0.5)";
    ctx.font = `500 8px ${MONO_FAMILY}`;
    ctx.fillText("QUAY LINE / 码头作业边界", 282, 199);
    ctx.restore();
  }

  drawRoad(ctx, state, now) {
    const x = 244;
    const y = 334;
    const width = 912;
    const height = 116;
    const roadGradient = ctx.createLinearGradient(0, y, 0, y + height);
    roadGradient.addColorStop(0, "#122526");
    roadGradient.addColorStop(0.5, "#172e2f");
    roadGradient.addColorStop(1, "#102223");
    ctx.fillStyle = roadGradient;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = "rgba(220, 238, 232, 0.16)";
    ctx.fillRect(x, y, width, 1);
    ctx.fillRect(x, y + height - 1, width, 1);

    ctx.save();
    ctx.strokeStyle = "rgba(216, 233, 221, 0.18)";
    ctx.lineWidth = 1;
    ctx.setLineDash([19, 15]);
    ctx.lineDashOffset = -(now * (12 + state.storm * 8)) % 34;
    ctx.beginPath();
    ctx.moveTo(250, 392);
    ctx.lineTo(1156, 392);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(190, 217, 210, 0.21)";
    ctx.font = `500 8px ${MONO_FAMILY}`;
    ctx.fillText("EVACUATION ROUTE 04  →  HIGH GROUND", 258, 348);
    ctx.fillStyle = "rgba(129, 164, 159, 0.35)";
    ctx.fillText("OUTBOUND ONLY", 258, 437);
    ctx.restore();

    const surface = clamp((state.water - 0.56) / 0.3, 0, 0.22);
    if (surface > 0) {
      const wash = ctx.createLinearGradient(0, 334, 0, 450);
      wash.addColorStop(0, "rgba(49, 154, 149, 0)");
      wash.addColorStop(1, `rgba(49, 154, 149, ${surface})`);
      ctx.fillStyle = wash;
      ctx.fillRect(x, y, width, height);
    }
  }

  drawSafeZone(ctx, now) {
    const x = CONFIG.vehicleSafeX;
    ctx.save();
    ctx.fillStyle = "rgba(185, 225, 120, 0.055)";
    ctx.fillRect(x, 334, 24, 116);
    ctx.strokeStyle = "rgba(185, 225, 120, 0.76)";
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(x, 334);
    ctx.lineTo(x, 450);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(1161, 393);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "rgba(185, 225, 120, 0.8)";
    ctx.font = `600 8px ${MONO_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillText("SAFE / 高地", 0, 0);
    ctx.restore();
    const pulse = 0.4 + Math.sin(now * 2.4) * 0.18;
    ctx.fillStyle = `rgba(185, 225, 120, ${pulse})`;
    ctx.fillRect(x - 2, 334, 2, 116);
    ctx.restore();
  }

  drawGate(ctx, gate, state, now) {
    const top = 330;
    const bottom = 451;
    const span = bottom - top;
    const leafTop = bottom - gate.progress * span;
    const isActive = gate.state === "closing";
    const trapped = state.status === "lost" && state.fail?.gateId === gate.id;
    const color = trapped ? COLORS.red : gate.state === "closed" ? COLORS.teal : isActive ? COLORS.amber : COLORS.muted;

    ctx.save();
    ctx.fillStyle = "#081617";
    ctx.fillRect(gate.x - 15, 286, 30, 43);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(gate.x - 14.5, 286.5, 29, 42);
    ctx.fillStyle = color;
    ctx.font = `600 11px ${MONO_FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillText(gate.id, gate.x, 303);
    ctx.fillStyle = "rgba(145, 181, 175, 0.54)";
    ctx.font = `500 7px ${MONO_FAMILY}`;
    ctx.fillText(`${gate.closeDuration}s`, gate.x, 318);

    ctx.fillStyle = "#203839";
    ctx.fillRect(gate.x - 9, 326, 18, 7);
    ctx.fillRect(gate.x - 9, 449, 18, 7);
    ctx.strokeStyle = "rgba(156, 201, 193, 0.26)";
    ctx.beginPath();
    ctx.moveTo(gate.x, top);
    ctx.lineTo(gate.x, bottom);
    ctx.stroke();

    if (gate.progress > 0) {
      const leafGradient = ctx.createLinearGradient(gate.x - 4, 0, gate.x + 4, 0);
      leafGradient.addColorStop(0, "rgba(50, 82, 80, 0.35)");
      leafGradient.addColorStop(0.5, color);
      leafGradient.addColorStop(1, "rgba(50, 82, 80, 0.35)");
      ctx.fillStyle = leafGradient;
      ctx.fillRect(gate.x - 2.5, leafTop, 5, bottom - leafTop);
      ctx.strokeStyle = color;
      ctx.globalAlpha = isActive ? 0.45 + Math.sin(now * 7) * 0.2 : 0.5;
      ctx.beginPath();
      ctx.moveTo(gate.x - 7, leafTop + 2);
      ctx.lineTo(gate.x + 7, leafTop + 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (isActive) {
      const blink = Math.sin(now * 8) > 0 ? 1 : 0.28;
      ctx.fillStyle = `rgba(241, 180, 90, ${blink})`;
      ctx.beginPath();
      ctx.arc(gate.x, 280, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (gate.state === "closed") {
      ctx.fillStyle = "rgba(97, 232, 207, 0.8)";
      ctx.beginPath();
      ctx.arc(gate.x, 280, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (trapped) {
      ctx.strokeStyle = `rgba(240, 92, 92, ${0.5 + Math.sin(now * 10) * 0.3})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(gate.x - 12, top - 7, 24, span + 14);
    }
    ctx.restore();
  }

  drawPump(ctx, state, now) {
    const active = state.pumpOn && state.power > 0;
    const stationX = 1041;
    const stationY = 456;
    const pipeY = 474;
    ctx.save();
    ctx.strokeStyle = active ? "rgba(185, 225, 120, 0.56)" : "rgba(112, 157, 150, 0.22)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(250, pipeY);
    ctx.lineTo(1024, pipeY);
    ctx.stroke();
    ctx.strokeStyle = "#081718";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(250, pipeY);
    ctx.lineTo(1024, pipeY);
    ctx.stroke();

    ctx.fillStyle = "#10292a";
    ctx.fillRect(stationX, stationY, 91, 37);
    ctx.strokeStyle = active ? COLORS.lime : "#365754";
    ctx.strokeRect(stationX + 0.5, stationY + 0.5, 90, 36);
    ctx.fillStyle = active ? COLORS.lime : COLORS.muted;
    ctx.font = `600 9px ${MONO_FAMILY}`;
    ctx.fillText("PUMP P-01", stationX + 8, stationY + 13);
    ctx.fillStyle = "rgba(174, 202, 195, 0.55)";
    ctx.font = `500 7px ${MONO_FAMILY}`;
    ctx.fillText(active ? "DISCHARGING TO SEA" : "STANDBY", stationX + 8, stationY + 25);

    ctx.translate(stationX + 72, stationY + 19);
    ctx.rotate(active ? now * 7 : 0);
    ctx.strokeStyle = active ? COLORS.lime : COLORS.dim;
    ctx.lineWidth = 2;
    for (let blade = 0; blade < 3; blade += 1) {
      const angle = (blade / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * 8, Math.sin(angle) * 8);
      ctx.stroke();
    }
    ctx.restore();

    if (active) {
      ctx.save();
      for (const particle of this.particles) {
        const progress = (particle.offset + now * 0.18) % 1;
        const x = lerp(1018, 268, progress);
        const alpha = Math.sin(progress * Math.PI) * 0.9;
        ctx.fillStyle = `rgba(185, 225, 120, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, pipeY + Math.sin(now * 6 + particle.offset * 20) * 2.5, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawVehicle(ctx, vehicle, state, now) {
    if (vehicle.status === "pending") {
      return;
    }
    const laneY = vehicle.lane === 0 ? 365 : 418;
    const isTrapped = vehicle.status === "trapped";
    const width = 35;
    const height = 15;
    ctx.save();
    ctx.translate(vehicle.x, laneY);
    ctx.fillStyle = "rgba(0, 0, 0, 0.36)";
    roundedRect(ctx, -width / 2 + 2, 4, width, height, 3);
    ctx.fill();

    const body = ctx.createLinearGradient(-width / 2, 0, width / 2, 0);
    if (isTrapped) {
      body.addColorStop(0, "#f05c5c");
      body.addColorStop(1, "#6e2425");
    } else {
      body.addColorStop(0, "#ce9c50");
      body.addColorStop(1, "#77582f");
    }
    ctx.fillStyle = body;
    roundedRect(ctx, -width / 2, -height / 2, width, height, 3);
    ctx.fill();
    ctx.strokeStyle = isTrapped ? "rgba(255, 156, 150, 0.9)" : "rgba(246, 214, 151, 0.5)";
    ctx.stroke();

    ctx.fillStyle = "rgba(14, 35, 36, 0.82)";
    roundedRect(ctx, -7, -height / 2 + 2.4, 13, height - 4.8, 1.5);
    ctx.fill();
    ctx.fillStyle = isTrapped ? "#ffd2cb" : "#e9d5aa";
    ctx.fillRect(width / 2 - 3, -4, 2, 8);
    ctx.fillStyle = "rgba(7, 17, 18, 0.92)";
    ctx.fillRect(-12, -height / 2 - 1, 6, 2);
    ctx.fillRect(-12, height / 2 - 1, 6, 2);
    ctx.fillRect(7, -height / 2 - 1, 6, 2);
    ctx.fillRect(7, height / 2 - 1, 6, 2);

    ctx.fillStyle = isTrapped ? "rgba(255, 117, 107, 0.9)" : "rgba(241, 180, 90, 0.72)";
    ctx.beginPath();
    ctx.arc(width / 2 - 1, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();

    if (isTrapped) {
      const pulse = 0.5 + Math.sin(now * 10) * 0.25;
      ctx.strokeStyle = `rgba(240, 92, 92, ${pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 27 + Math.sin(now * 5) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ffd7d1";
      ctx.font = `600 8px ${MONO_FAMILY}`;
      ctx.textAlign = "center";
      ctx.fillText("TRAPPED", 0, -18);
    } else {
      const gateNear = state.gates.some((gate) => Math.abs(gate.x - vehicle.x) < 80);
      if (gateNear) {
        ctx.fillStyle = "rgba(225, 235, 224, 0.65)";
        ctx.font = `500 7px ${MONO_FAMILY}`;
        ctx.textAlign = "center";
        ctx.fillText(vehicle.id, 0, -13);
      }
    }
    ctx.restore();
  }

  drawMapCaption(ctx, state) {
    const next = state.gates.find((gate) => gate.state !== "closed");
    ctx.save();
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(125, 160, 154, 0.72)";
    ctx.font = `500 9px ${MONO_FAMILY}`;
    ctx.fillText(
      next ? `NEXT GATE / ${next.id}` : "GATE LINE / SEALED",
      1134,
      49,
    );
    ctx.fillStyle = state.warning ? COLORS.orange : "rgba(97, 232, 207, 0.7)";
    ctx.font = `600 9px ${MONO_FAMILY}`;
    ctx.fillText(
      state.warning ? "PORT WATER / ABOVE ALERT" : "PORT WATER / NOMINAL",
      1134,
      65,
    );
    ctx.restore();
  }

  drawChart(ctx, state, now) {
    panelFrame(ctx, 24, 518, 1152, 180, "HYDRAULIC PROFILE / 0—180s");
    const plotX = 282;
    const plotRight = 1148;
    const plotW = plotRight - plotX;
    const top = 541;
    const bottom = 675;
    const span = 132;
    const seaX = 48;
    const seaW = 194;
    const tideY = levelY(state.tide, bottom, span);
    const waterY = levelY(state.water, bottom, span);

    ctx.save();
    const seaSky = ctx.createLinearGradient(0, top, 0, bottom);
    seaSky.addColorStop(0, "rgba(22, 57, 65, 0.16)");
    seaSky.addColorStop(1, "rgba(9, 28, 34, 0.58)");
    ctx.fillStyle = seaSky;
    ctx.fillRect(seaX, top, seaW, bottom - top);
    const seaFill = ctx.createLinearGradient(0, tideY, 0, bottom);
    seaFill.addColorStop(0, "rgba(108, 201, 239, 0.36)");
    seaFill.addColorStop(1, "rgba(30, 95, 124, 0.13)");
    ctx.fillStyle = seaFill;
    ctx.fillRect(seaX, tideY, seaW, bottom - tideY);
    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = seaX; x <= seaX + seaW; x += 6) {
      const wave = Math.sin(x * 0.1 + now * 2.1) * 2.2;
      ctx.lineTo(x, tideY + wave);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(143, 208, 219, 0.72)";
    ctx.font = `600 8px ${MONO_FAMILY}`;
    ctx.fillText("外海 / SEA", seaX + 8, top + 15);
    ctx.fillStyle = COLORS.cyan;
    ctx.textAlign = "right";
    ctx.fillText(`${state.tide.toFixed(2)} m`, seaX + seaW - 6, tideY - 7);
    ctx.textAlign = "left";

    ctx.fillStyle = "rgba(13, 42, 42, 0.38)";
    ctx.fillRect(plotX, top, plotW, bottom - top);
    const waterFill = ctx.createLinearGradient(0, waterY, 0, bottom);
    waterFill.addColorStop(0, "rgba(97, 232, 207, 0.28)");
    waterFill.addColorStop(1, "rgba(24, 96, 91, 0.06)");
    ctx.fillStyle = waterFill;
    ctx.fillRect(plotX, waterY, plotW, bottom - waterY);
    ctx.strokeStyle = COLORS.teal;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = plotX; x <= plotRight; x += 7) {
      const wave = Math.sin(x * 0.08 + now * 1.7) * 1.7;
      ctx.lineTo(x, waterY + wave);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(129, 173, 166, 0.13)";
    ctx.lineWidth = 0.7;
    for (let level = 0; level <= 1; level += 0.2) {
      const y = levelY(level, bottom, span);
      ctx.beginPath();
      ctx.moveTo(plotX, y + 0.5);
      ctx.lineTo(plotRight, y + 0.5);
      ctx.stroke();
    }

    this.drawThresholdLine(ctx, plotX, plotRight, CONFIG.warningLevel, bottom, span, COLORS.orange, "警戒 0.68", "warning");
    this.drawThresholdLine(ctx, plotX, plotRight, CONFIG.dangerLevel, bottom, span, COLORS.red, "危险 0.91", "danger");

    ctx.save();
    ctx.strokeStyle = "rgba(108, 201, 239, 0.28)";
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    for (let time = 0; time <= CONFIG.duration; time += 3) {
      const x = plotX + (time / CONFIG.duration) * plotW;
      const y = levelY(
        CONFIG.tideStart
          + CONFIG.tideRange * Math.pow(time / CONFIG.duration, 1.12)
          + Math.sin(time * 0.075) * 0.014 * (time / CONFIG.duration),
        bottom,
        span,
      );
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (this.samples.length > 1) {
      this.drawSampleCurve(ctx, "tide", COLORS.cyan, plotX, plotW, bottom, span, 1.15);
      this.drawSampleCurve(ctx, "water", COLORS.teal, plotX, plotW, bottom, span, 1.7);
    }
    ctx.restore();

    const currentX = plotX + clamp(state.time / CONFIG.duration, 0, 1) * plotW;
    ctx.strokeStyle = "rgba(220, 236, 229, 0.25)";
    ctx.beginPath();
    ctx.moveTo(currentX, top);
    ctx.lineTo(currentX, bottom);
    ctx.stroke();
    ctx.fillStyle = COLORS.teal;
    ctx.beginPath();
    ctx.arc(currentX, waterY, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.cyan;
    ctx.beginPath();
    ctx.arc(currentX, tideY, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(131, 166, 159, 0.55)";
    ctx.font = `500 8px ${MONO_FAMILY}`;
    for (const second of [0, 60, 120, 180]) {
      const x = plotX + (second / CONFIG.duration) * plotW;
      ctx.textAlign = second === 0 ? "left" : second === 180 ? "right" : "center";
      ctx.fillText(second === 0 ? "T+00" : `+${second}s`, x, bottom + 14);
    }

    ctx.textAlign = "left";
    ctx.fillStyle = state.warning ? COLORS.orange : COLORS.teal;
    ctx.font = `600 10px ${MONO_FAMILY}`;
    ctx.fillText(`PORT BASIN  ${state.water.toFixed(2)} m`, plotX + 14, top + 15);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(142, 176, 169, 0.7)";
    ctx.font = `500 8px ${MONO_FAMILY}`;
    ctx.fillText(
      state.pumpOn && state.power > 0 ? "PUMP FLOW → SEA" : "PUMP FLOW / 0",
      plotRight - 9,
      top + 15,
    );
    ctx.restore();
  }

  drawThresholdLine(ctx, startX, endX, level, bottom, span, color, label, kind) {
    const y = levelY(level, bottom, span);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = kind === "danger" ? 0.52 : 0.42;
    ctx.setLineDash(kind === "danger" ? [3, 4] : [7, 5]);
    ctx.beginPath();
    ctx.moveTo(startX, y + 0.5);
    ctx.lineTo(endX, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.82;
    ctx.font = `600 7px ${MONO_FAMILY}`;
    ctx.textAlign = "right";
    ctx.fillText(label, endX - 4, y - 4);
    ctx.restore();
  }

  drawSampleCurve(ctx, key, color, startX, width, bottom, span, lineWidth) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let index = 0; index < this.samples.length; index += 1) {
      const sample = this.samples[index];
      const x = startX + (sample.time / CONFIG.duration) * width;
      const y = levelY(sample[key], bottom, span);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  drawRain(ctx, state, now) {
    const intensity = clamp(state.storm, 0, 1);
    ctx.save();
    ctx.strokeStyle = `rgba(132, 190, 186, ${0.05 + intensity * 0.08})`;
    ctx.lineWidth = 0.7;
    const count = Math.floor(this.rain.length * (0.35 + intensity * 0.65));
    for (let index = 0; index < count; index += 1) {
      const drop = this.rain[index];
      const y = 44 + ((drop.y + now * drop.speed * (0.7 + intensity * 0.6)) % 448);
      const x = drop.x - y * 0.11;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2.8, y + drop.length);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFailureGlitch(ctx, now, code) {
    ctx.save();
    const pulse = 0.055 + Math.sin(now * 3.2) * 0.025;
    const wash = ctx.createLinearGradient(0, 0, 0, this.height);
    wash.addColorStop(0, `rgba(240, 92, 92, ${pulse})`);
    wash.addColorStop(0.5, "rgba(240, 92, 92, 0.008)");
    wash.addColorStop(1, `rgba(240, 92, 92, ${pulse * 0.7})`);
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, this.width, this.height);
    if (code === "vehicle-trapped") {
      ctx.fillStyle = "rgba(240, 92, 92, 0.16)";
      const bandY = 326 + ((now * 40) % 128);
      ctx.fillRect(0, bandY, this.width, 2);
    }
    ctx.restore();
  }

  drawFrameMarks(ctx, state, now) {
    ctx.save();
    const statusColor = state.status === "lost"
      ? COLORS.red
      : state.warning
        ? COLORS.orange
        : COLORS.teal;
    ctx.fillStyle = statusColor;
    ctx.globalAlpha = 0.44 + Math.sin(now * 2) * 0.08;
    ctx.fillRect(24, 24, 5, 24);
    ctx.fillRect(this.width - 29, this.height - 48, 5, 24);
    ctx.globalAlpha = 0.55;
    ctx.font = `500 8px ${MONO_FAMILY}`;
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("RENDER / 60Hz", 30, this.height - 8);
    ctx.textAlign = "right";
    ctx.fillText(`STORM ${(state.storm * 100).toFixed(0)}%`, this.width - 30, this.height - 8);
    ctx.restore();
  }

  gateAtPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * this.width;
    const y = ((clientY - rect.top) / rect.height) * this.height;
    if (y < 270 || y > 465) {
      return -1;
    }
    return CONFIG.gates.findIndex((gate) => Math.abs(x - gate.x) <= 34);
  }
}
