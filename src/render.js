import { CANVAS, SLOTS, SLOT_ORDER, radiusForTeeth } from "./config.js";

const TAU = Math.PI * 2;
const W = CANVAS.width;
const H = CANVAS.height;

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function screw(ctx, x, y, radius = 5, angle = 0.4) {
  ctx.save();
  ctx.translate(x, y);
  const gradient = ctx.createRadialGradient(-2, -2, 0, 0, 0, radius);
  gradient.addColorStop(0, "#c9b28a");
  gradient.addColorStop(0.45, "#6e6554");
  gradient.addColorStop(1, "#25241f");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(10, 10, 8, 0.7)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.rotate(angle);
  ctx.strokeStyle = "rgba(16, 15, 12, 0.9)";
  ctx.lineWidth = 1.3;
  line(ctx, -radius * 0.62, 0, radius * 0.62, 0);
  ctx.restore();
}

function jewel(ctx, x, y, radius = 5, color = "#b64f45") {
  const glow = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, radius * 2.4);
  glow.addColorStop(0, "rgba(255, 206, 165, 0.9)");
  glow.addColorStop(0.32, color);
  glow.addColorStop(1, "rgba(84, 31, 29, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius * 2.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#4d1f1c";
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.55, 0, TAU);
  ctx.fill();
}

function drawGearPath(ctx, radius, teeth) {
  const step = TAU / teeth;
  const root = radius - Math.max(3.5, radius * 0.07);
  const tip = radius + Math.max(2.5, radius * 0.055);
  ctx.beginPath();
  for (let index = 0; index < teeth; index += 1) {
    const center = index * step;
    const points = [
      [center - step * 0.5, root],
      [center - step * 0.26, tip],
      [center + step * 0.24, tip],
      [center + step * 0.5, root]
    ];
    points.forEach(([angle, distance], pointIndex) => {
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      if (index === 0 && pointIndex === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  }
  ctx.closePath();
}

function drawSpokes(ctx, radius, color, count = 5, phase = 0) {
  const inner = Math.max(8, radius * 0.21);
  const outer = radius * 0.67;
  const gap = 0.13;
  for (let index = 0; index < count; index += 1) {
    const angle = phase + (index / count) * TAU;
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(inner, -Math.max(2, radius * 0.055));
    ctx.lineTo(outer - radius * 0.1, -Math.max(3, radius * 0.085));
    ctx.quadraticCurveTo(outer, 0, outer - radius * 0.1, Math.max(3, radius * 0.085));
    ctx.lineTo(inner, Math.max(2, radius * 0.055));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 226, 169, 0.11)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = "rgba(19, 15, 9, 0.42)";
  ctx.lineWidth = Math.max(1, radius * 0.025);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.7, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = "rgba(238, 205, 142, 0.18)";
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.79, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawEmptyCutouts(ctx, radius, count = 5, phase = 0) {
  const inner = radius * 0.31;
  const outer = radius * 0.65;
  for (let index = 0; index < count; index += 1) {
    const start = phase + (index / count) * TAU + 0.15;
    const end = phase + ((index + 1) / count) * TAU - 0.15;
    ctx.beginPath();
    ctx.arc(0, 0, outer, start, end);
    ctx.arc(0, 0, inner, end, start, true);
    ctx.closePath();
    ctx.fillStyle = "rgba(5, 9, 7, 0.74)";
    ctx.fill();
  }
}

export function renderGear(ctx, x, y, radius, teeth, angle, options = {}) {
  const {
    finish = "brass",
    alpha = 1,
    holes = true,
    glow = 0,
    hubColor = null,
    scale = 1
  } = options;
  const metal = finish === "steel"
    ? ["#b7b4a7", "#72766f", "#303632", "#d5d0bd"]
    : ["#f1d18f", "#b78b4f", "#5e4323", "#ffe8b1"];

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  if (glow > 0) {
    ctx.shadowBlur = glow;
    ctx.shadowColor = "rgba(240, 206, 137, 0.55)";
  }

  drawGearPath(ctx, radius, teeth);
  const gradient = ctx.createLinearGradient(-radius, -radius, radius * 0.8, radius);
  gradient.addColorStop(0, metal[0]);
  gradient.addColorStop(0.34, metal[1]);
  gradient.addColorStop(0.72, metal[2]);
  gradient.addColorStop(1, metal[3]);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(24, 18, 10, 0.76)";
  ctx.lineWidth = 1.25;
  ctx.stroke();

  if (holes) {
    ctx.save();
    ctx.rotate(-angle * 0.22);
    drawEmptyCutouts(ctx, radius, teeth > 40 ? 6 : 5, 0.14);
    const spokeColor = finish === "steel" ? "rgba(138, 143, 132, 0.75)" : "rgba(181, 140, 77, 0.67)";
    drawSpokes(ctx, radius, spokeColor, teeth > 40 ? 6 : 5, 0.14);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(0, 0, Math.max(7, radius * 0.185), 0, TAU);
  const hub = ctx.createRadialGradient(-3, -3, 1, 0, 0, radius * 0.2);
  hub.addColorStop(0, "#e9ce98");
  hub.addColorStop(0.6, hubColor || "#7a5b33");
  hub.addColorStop(1, "#241b11");
  ctx.fillStyle = hub;
  ctx.fill();
  ctx.strokeStyle = "rgba(12, 10, 7, 0.8)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#08100d";
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2.4, radius * 0.056), 0, TAU);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.restore();
}

export class WatchRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.staticLayer = document.createElement("canvas");
    this.dpr = 1;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = W * this.dpr;
    this.canvas.height = H * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.staticLayer.width = this.canvas.width;
    this.staticLayer.height = this.canvas.height;
    this.buildStaticLayer();
  }

  buildStaticLayer() {
    const ctx = this.staticLayer.getContext("2d");
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#080c0a";
    ctx.fillRect(0, 0, W, H);
    this.drawBackdrop(ctx);
    this.drawMainPlate(ctx);
    this.drawTrainBridges(ctx);
    this.drawDial(ctx);
    this.drawCornerDetails(ctx);
  }

  drawBackdrop(ctx) {
    const leftGlow = ctx.createRadialGradient(355, 330, 20, 355, 330, 560);
    leftGlow.addColorStop(0, "rgba(57, 83, 68, 0.25)");
    leftGlow.addColorStop(0.5, "rgba(25, 37, 31, 0.12)");
    leftGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = leftGlow;
    ctx.fillRect(0, 0, W, H);

    const rightGlow = ctx.createRadialGradient(1005, 350, 80, 1005, 350, 340);
    rightGlow.addColorStop(0, "rgba(128, 98, 48, 0.19)");
    rightGlow.addColorStop(0.54, "rgba(57, 45, 25, 0.09)");
    rightGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = rightGlow;
    ctx.fillRect(600, 0, 600, H);

    const random = mulberry32(913);
    for (let index = 0; index < 280; index += 1) {
      const x = random() * W;
      const y = random() * H;
      const radius = random() * 1.25 + 0.15;
      ctx.fillStyle = `rgba(227, 205, 166, ${random() * 0.018 + 0.004})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(204, 184, 145, 0.045)";
    ctx.lineWidth = 1;
    for (let x = 24; x < W; x += 24) line(ctx, x, 0, x, H);
    for (let y = 24; y < H; y += 24) line(ctx, 0, y, W, y);
  }

  drawMainPlate(ctx) {
    roundedRect(ctx, 34, 34, 724, 650, 32);
    const plate = ctx.createLinearGradient(80, 50, 690, 680);
    plate.addColorStop(0, "#26302c");
    plate.addColorStop(0.3, "#1d2723");
    plate.addColorStop(0.72, "#151d1a");
    plate.addColorStop(1, "#0f1513");
    ctx.fillStyle = plate;
    ctx.fill();
    ctx.strokeStyle = "rgba(209, 188, 146, 0.2)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    roundedRect(ctx, 42, 42, 708, 634, 27);
    ctx.strokeStyle = "rgba(231, 213, 177, 0.06)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const random = mulberry32(442);
    ctx.strokeStyle = "rgba(218, 203, 167, 0.03)";
    for (let x = 61; x < 730; x += 16) {
      for (let y = 61; y < 665; y += 16) {
        const offset = (Math.floor(y / 16) % 2) * 8;
        ctx.beginPath();
        ctx.arc(x + offset + random(), y + random(), 6.8 + random() * 2, 0, TAU);
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.fillStyle = "rgba(224, 211, 181, 0.31)";
    ctx.font = "9px 'Courier New', monospace";
    ctx.letterSpacing = "2px";
    ctx.fillText("ATELIER NO.30", 78, 78);
    ctx.fillStyle = "rgba(212, 170, 97, 0.28)";
    ctx.font = "italic 12px Georgia, serif";
    ctx.fillText("Calibre 30", 78, 94);
    ctx.fillStyle = "rgba(219, 205, 175, 0.15)";
    ctx.font = "7px 'Courier New', monospace";
    ctx.fillText("SEVENTEEN JEWELS · ADJUSTED TO 3 POSITIONS", 78, 114);
    ctx.restore();

    screw(ctx, 57, 57, 5.5, 0.7);
    screw(ctx, 57, 639, 5.5, 0.1);
    screw(ctx, 728, 57, 5.5, 1.2);
    screw(ctx, 728, 639, 5.5, 0.3);
    screw(ctx, 708, 356, 4.5, 0.9);
    screw(ctx, 91, 593, 4.2, 0.2);

    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = "rgba(210, 192, 154, 0.11)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(1005, 350, 207, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawTrainBridges(ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(188, 290);
    ctx.bezierCurveTo(198, 212, 228, 172, 306, 174);
    ctx.bezierCurveTo(372, 176, 405, 208, 438, 256);
    ctx.bezierCurveTo(472, 306, 540, 293, 573, 323);
    ctx.bezierCurveTo(611, 357, 590, 398, 552, 425);
    ctx.bezierCurveTo(508, 456, 464, 434, 446, 397);
    ctx.bezierCurveTo(422, 344, 380, 323, 324, 336);
    ctx.bezierCurveTo(255, 352, 207, 335, 188, 290);
    ctx.closePath();
    const bridge = ctx.createLinearGradient(180, 170, 580, 440);
    bridge.addColorStop(0, "rgba(111, 126, 111, 0.19)");
    bridge.addColorStop(0.45, "rgba(45, 60, 53, 0.23)");
    bridge.addColorStop(1, "rgba(17, 25, 21, 0.08)");
    ctx.fillStyle = bridge;
    ctx.fill();
    ctx.strokeStyle = "rgba(210, 195, 159, 0.1)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(224, 512);
    ctx.bezierCurveTo(278, 448, 352, 430, 421, 467);
    ctx.bezierCurveTo(472, 493, 475, 545, 437, 571);
    ctx.bezierCurveTo(381, 609, 291, 593, 244, 554);
    ctx.bezierCurveTo(220, 534, 212, 520, 224, 512);
    ctx.closePath();
    const balanceBridge = ctx.createLinearGradient(230, 450, 420, 590);
    balanceBridge.addColorStop(0, "rgba(91, 100, 89, 0.14)");
    balanceBridge.addColorStop(1, "rgba(25, 34, 29, 0.2)");
    ctx.fillStyle = balanceBridge;
    ctx.fill();
    ctx.strokeStyle = "rgba(205, 190, 157, 0.08)";
    ctx.stroke();
    ctx.restore();

    screw(ctx, 283, 192, 4.3, 0.3);
    screw(ctx, 557, 337, 4.2, 1.1);
    screw(ctx, 449, 542, 4.2, 0.6);

    ctx.strokeStyle = "rgba(225, 207, 169, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(461, 412);
    ctx.lineTo(475, 447);
    ctx.lineTo(450, 500);
    ctx.stroke();
  }

  drawDial(ctx) {
    const cx = 1005;
    const cy = 350;
    const outer = 189;
    const dial = 160;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, TAU);
    ctx.fillStyle = "#473822";
    ctx.fill();
    ctx.restore();

    const caseGradient = ctx.createLinearGradient(cx - outer, cy - outer, cx + outer, cy + outer);
    caseGradient.addColorStop(0, "#d6b77d");
    caseGradient.addColorStop(0.18, "#765a32");
    caseGradient.addColorStop(0.48, "#c8a568");
    caseGradient.addColorStop(0.7, "#5f4728");
    caseGradient.addColorStop(1, "#c09a61");
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, TAU);
    ctx.fillStyle = caseGradient;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, outer - 7, 0, TAU);
    ctx.strokeStyle = "rgba(42, 30, 16, 0.75)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, dial + 7, 0, TAU);
    ctx.fillStyle = "#0b1512";
    ctx.fill();
    ctx.strokeStyle = "rgba(231, 200, 138, 0.36)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const dialGradient = ctx.createRadialGradient(cx - 52, cy - 72, 15, cx, cy, dial);
    dialGradient.addColorStop(0, "#25342c");
    dialGradient.addColorStop(0.42, "#18231e");
    dialGradient.addColorStop(0.8, "#0d1714");
    dialGradient.addColorStop(1, "#09110f");
    ctx.beginPath();
    ctx.arc(cx, cy, dial, 0, TAU);
    ctx.fillStyle = dialGradient;
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    for (let index = 0; index < 60; index += 1) {
      const angle = (index / 60) * TAU - Math.PI / 2;
      const major = index % 5 === 0;
      const inner = major ? dial - 16 : dial - 8;
      const outerTick = dial - 4;
      ctx.strokeStyle = major ? "rgba(235, 221, 189, 0.73)" : "rgba(202, 193, 168, 0.3)";
      ctx.lineWidth = major ? 1.35 : 0.75;
      line(
        ctx,
        Math.cos(angle) * inner,
        Math.sin(angle) * inner,
        Math.cos(angle) * outerTick,
        Math.sin(angle) * outerTick
      );
    }

    ctx.fillStyle = "rgba(235, 225, 199, 0.72)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "15px Georgia, serif";
    [
      ["XII", 0, -118],
      ["III", 120, 0],
      ["VI", 0, 119],
      ["IX", -120, 0]
    ].forEach(([label, x, y]) => ctx.fillText(label, x, y));

    ctx.fillStyle = "rgba(203, 174, 116, 0.56)";
    ctx.font = "7px 'Courier New', monospace";
    ctx.fillText("CALIBRE 30", 0, 47);
    ctx.fillStyle = "rgba(196, 195, 175, 0.32)";
    ctx.font = "6px 'Courier New', monospace";
    ctx.fillText("AUTOMATIC", 0, 59);
    ctx.fillStyle = "rgba(198, 173, 120, 0.4)";
    ctx.fillText("SWISS MADE", 0, 113);
    ctx.restore();

    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * TAU + Math.PI / 4;
      screw(ctx, cx + Math.cos(angle) * 181, cy + Math.sin(angle) * 181, 3.6, angle);
    }

    const sheen = ctx.createLinearGradient(cx - 140, cy - 140, cx + 120, cy + 140);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.075)");
    sheen.addColorStop(0.36, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(1, "rgba(255, 255, 255, 0.015)");
    ctx.beginPath();
    ctx.arc(cx, cy, dial - 1, 0, TAU);
    ctx.fillStyle = sheen;
    ctx.fill();
  }

  drawCornerDetails(ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(212, 170, 97, 0.2)";
    ctx.lineWidth = 1;
    roundedRect(ctx, 775, 42, 392, 616, 10);
    ctx.stroke();
    ctx.setLineDash([1, 7]);
    roundedRect(ctx, 786, 53, 370, 594, 7);
    ctx.strokeStyle = "rgba(209, 191, 155, 0.075)";
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(211, 184, 133, 0.32)";
    ctx.font = "7px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText("BENCH TEST · 30 SECONDS", 1005, 568);
    ctx.fillStyle = "rgba(190, 195, 177, 0.2)";
    ctx.fillText("NO. 04 / ESCAPEMENT", 1005, 581);
    ctx.textAlign = "left";
  }

  draw(state) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.staticLayer, 0, 0, W, H);

    this.drawBarrel(ctx, state);
    this.drawSlots(ctx, state);
    this.drawEscapement(ctx, state);
    this.drawBalance(ctx, state);
    this.drawHands(ctx, state);
    this.drawOverlays(ctx, state);
  }

  drawBarrel(ctx, state) {
    const x = 247.5;
    const y = 182.7;
    const radius = 82;
    const angle = state.barrelAngle;

    renderGear(ctx, x, y, radius, 64, angle, {
      finish: "brass",
      alpha: 0.9,
      holes: false,
      glow: state.mode === "running" ? 8 : 0
    });

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle * 0.18);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.72, 0, TAU);
    const barrel = ctx.createRadialGradient(-13, -16, 5, 0, 0, radius * 0.72);
    barrel.addColorStop(0, "#7a633c");
    barrel.addColorStop(0.55, "#2f2c22");
    barrel.addColorStop(1, "#151813");
    ctx.fillStyle = barrel;
    ctx.fill();
    ctx.strokeStyle = "rgba(235, 205, 142, 0.38)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = "rgba(218, 183, 112, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let index = 0; index < 175; index += 1) {
      const progress = index / 175;
      const theta = progress * TAU * 2.2;
      const distance = 8 + progress * radius * 0.53;
      const px = Math.cos(theta) * distance;
      const py = Math.sin(theta) * distance;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    jewel(ctx, 0, 0, 5.5);
    ctx.restore();

    ctx.fillStyle = "rgba(214, 190, 146, 0.42)";
    ctx.font = "7px 'Courier New', monospace";
    ctx.textAlign = "right";
    ctx.fillText("BARREL / 64T", x + 42, y + 103);
    ctx.textAlign = "left";
  }

  drawSlots(ctx, state) {
    for (const slotId of SLOT_ORDER) {
      const slot = SLOTS[slotId];
      const installed = state.installed[slotId];
      const targetRadius = radiusForTeeth(slot.target);
      const ping = state.pulse?.slot === slotId ? state.pulse.value : 0;

      ctx.save();
      ctx.translate(slot.x, slot.y);
      ctx.setLineDash([3, 7]);
      ctx.strokeStyle = `rgba(202, 183, 145, ${0.15 + ping * 0.21})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, targetRadius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(7, 12, 10, 0.84)";
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(11, targetRadius * 0.17), 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(179, 151, 98, 0.35)";
      ctx.stroke();
      jewel(ctx, 0, 0, 4.5);
      ctx.restore();

      if (installed) {
        const radius = radiusForTeeth(installed.teeth);
        const rotation = state.gearAngles[slotId];
        renderGear(ctx, slot.x, slot.y, radius, installed.teeth, rotation, {
          finish: installed.finish,
          glow: state.mode === "running" ? 9 : 0,
          alpha: state.mode === "failed" ? 0.84 : 1
        });
      } else {
        this.drawEmptySlot(ctx, slot, targetRadius);
      }

      this.drawSlotLabel(ctx, slot, installed, targetRadius);
    }
  }

  drawEmptySlot(ctx, slot, radius) {
    ctx.save();
    ctx.translate(slot.x, slot.y);
    ctx.strokeStyle = "rgba(212, 170, 97, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(17, radius * 0.34), 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(7, 0);
    ctx.moveTo(0, -7);
    ctx.lineTo(0, 7);
    ctx.stroke();
    ctx.fillStyle = "rgba(229, 206, 163, 0.5)";
    ctx.textAlign = "center";
    ctx.font = "9px 'Courier New', monospace";
    ctx.fillText(`${slot.target}T`, 0, Math.max(17, radius * 0.34) + 16);
    ctx.restore();
  }

  drawSlotLabel(ctx, slot, installed, targetRadius) {
    const below = slot.id === "third" ? 65 : targetRadius + 23;
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(220, 207, 178, 0.33)";
    ctx.font = "7px 'Courier New', monospace";
    ctx.fillText(`${slot.label} / ${slot.sublabel}`, slot.x, slot.y + below);
    if (installed && installed.teeth !== slot.target) {
      ctx.fillStyle = installed.teeth > slot.target ? "rgba(224, 123, 95, 0.88)" : "rgba(232, 192, 101, 0.84)";
      ctx.font = "8px 'Courier New', monospace";
      ctx.fillText(`${installed.teeth}T ≠ ${slot.target}T`, slot.x, slot.y + below + 12);
    }
    ctx.restore();
  }

  drawEscapement(ctx, state) {
    const x = 510;
    const y = 410;
    const radius = 37;
    renderGear(ctx, x, y, radius, 18, state.escapeAngle, {
      finish: "steel",
      holes: true,
      glow: state.mode === "running" ? 7 : 0
    });

    ctx.save();
    ctx.translate(425, 465);
    ctx.rotate(state.palletAngle);
    ctx.strokeStyle = "rgba(213, 190, 143, 0.78)";
    ctx.fillStyle = "rgba(125, 105, 66, 0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, -5);
    ctx.quadraticCurveTo(-29, 28, 8, 35);
    ctx.quadraticCurveTo(35, 22, 53, 14);
    ctx.moveTo(8, 35);
    ctx.quadraticCurveTo(32, 46, 52, 35);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, 0, TAU);
    ctx.fillStyle = "#2d2b23";
    ctx.fill();
    ctx.stroke();
    jewel(ctx, 0, 0, 3.2);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(205, 185, 145, 0.27)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(x, y, radius + 10, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(211, 190, 151, 0.3)";
    ctx.font = "7px 'Courier New', monospace";
    ctx.fillText("ESCAPE / 18T", x + 48, y + 40);
  }

  drawBalance(ctx, state) {
    const x = 345;
    const y = 495;
    const radius = 89;
    const amplitude = state.mode === "running"
      ? Math.sin(state.balancePhase) * 0.19
      : Math.sin(state.now * 0.0004) * 0.018;

    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "rgba(211, 192, 153, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 12, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(amplitude);
    ctx.strokeStyle = "#b18c52";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(246, 219, 163, 0.65)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 3.5, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(51, 37, 20, 0.82)";
    ctx.beginPath();
    ctx.arc(0, 0, radius - 4.5, 0, TAU);
    ctx.stroke();

    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI / 2 + Math.PI / 4;
      ctx.save();
      ctx.rotate(angle);
      ctx.strokeStyle = "rgba(189, 155, 94, 0.62)";
      ctx.lineWidth = 3;
      line(ctx, 18, 0, radius - 6, 0);
      ctx.restore();
    }

    for (let index = 0; index < 3; index += 1) {
      const angle = index * TAU / 3 + 0.35;
      screw(ctx, Math.cos(angle) * radius, Math.sin(angle) * radius, 3.8, angle);
    }
    ctx.fillStyle = "#33291b";
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, TAU);
    ctx.fill();
    jewel(ctx, 0, 0, 4.6);
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(state.now * 0.00005);
    ctx.strokeStyle = "rgba(227, 202, 149, 0.42)";
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (let index = 0; index < 250; index += 1) {
      const progress = index / 250;
      const theta = progress * TAU * 5.3;
      const distance = 15 + progress * 58;
      const px = Math.cos(theta) * distance;
      const py = Math.sin(theta) * distance;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(211, 190, 151, 0.3)";
    ctx.font = "7px 'Courier New', monospace";
    ctx.fillText("BALANCE / 28,800", x - 74, y + 116);
  }

  drawHands(ctx, state) {
    const cx = 1005;
    const cy = 350;
    const secondsAngle = -Math.PI / 2 + (state.secondsAngle * Math.PI) / 180;
    const minuteAngle = -Math.PI / 2 + (state.minuteAngle * Math.PI) / 180;
    const hourAngle = -Math.PI / 2 + (state.hourAngle * Math.PI) / 180;

    const progress = Math.min(1, Math.max(0, state.runTime / 30));
    if (state.mode === "running" || state.mode === "failed" || state.mode === "success") {
      ctx.save();
      ctx.strokeStyle = state.failure === "fast" ? "rgba(224, 123, 95, 0.9)" : "rgba(150, 205, 165, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, 177, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 3;

    ctx.save();
    ctx.rotate(hourAngle);
    ctx.beginPath();
    ctx.moveTo(-8, 8);
    ctx.lineTo(-4, -66);
    ctx.lineTo(4, -66);
    ctx.lineTo(8, 8);
    ctx.closePath();
    const hourMetal = ctx.createLinearGradient(0, -66, 0, 8);
    hourMetal.addColorStop(0, "#f0dfb7");
    hourMetal.addColorStop(0.5, "#ad9564");
    hourMetal.addColorStop(1, "#615338");
    ctx.fillStyle = hourMetal;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.rotate(minuteAngle);
    ctx.beginPath();
    ctx.moveTo(-5, 12);
    ctx.lineTo(-2.5, -103);
    ctx.lineTo(2.5, -103);
    ctx.lineTo(5, 12);
    ctx.closePath();
    ctx.fillStyle = "#e3cea0";
    ctx.fill();
    ctx.strokeStyle = "rgba(85, 68, 39, 0.5)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();

    ctx.rotate(secondsAngle);
    ctx.strokeStyle = "#d56d56";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 25);
    ctx.lineTo(0, -131);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -114, 4.6, 0, TAU);
    ctx.fillStyle = "#d56d56";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 7.5, 0, TAU);
    ctx.fillStyle = "#2d271a";
    ctx.fill();
    ctx.strokeStyle = "#c4aa72";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#d56d56";
    ctx.beginPath();
    ctx.arc(0, 0, 3.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawOverlays(ctx, state) {
    const moving = state.mode === "running" || state.mode === "success";
    if (moving) {
      ctx.save();
      ctx.strokeStyle = state.failure === "fast"
        ? "rgba(219, 117, 91, 0.4)"
        : "rgba(146, 198, 164, 0.32)";
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 8]);
      ctx.beginPath();
      ctx.arc(365, 265, 76 + Math.sin(state.now * 0.004) * 2, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = "rgba(208, 186, 145, 0.26)";
    ctx.font = "7px 'Courier New', monospace";
    ctx.fillText(state.mode === "running" || state.mode === "success" ? "TRAIN LIVE" : "TRAIN OPEN", 77, 363);
    ctx.strokeStyle = moving ? "rgba(150, 201, 171, 0.52)" : "rgba(210, 190, 153, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(77, 371);
    ctx.lineTo(126, 371);
    ctx.stroke();
    ctx.restore();

    if (state.mode === "running" && state.failure === "fast") {
      const speed = Math.min(1, (state.speedFactor - 1) * 2.4);
      ctx.save();
      for (let index = 0; index < 9; index += 1) {
        const angle = index * 0.71 + state.now * 0.012;
        const radius = 180 + index * 10;
        ctx.strokeStyle = `rgba(224, 118, 91, ${0.12 + speed * 0.2})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(359, 297, radius, angle, angle + 0.38);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(238, 134, 109, 0.84)";
      ctx.font = "8px 'Courier New', monospace";
      ctx.fillText("RATIO ERROR / FAST", 450, 500);
      ctx.restore();
    }

    if (state.mode === "failed" && state.failure === "jam") {
      ctx.save();
      ctx.fillStyle = "rgba(224, 123, 95, 0.13)";
      ctx.strokeStyle = "rgba(224, 123, 95, 0.78)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(state.failureSlot.x, state.failureSlot.y, 25, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(state.failureSlot.x - 12, state.failureSlot.y - 12);
      ctx.lineTo(state.failureSlot.x + 12, state.failureSlot.y + 12);
      ctx.moveTo(state.failureSlot.x + 12, state.failureSlot.y - 12);
      ctx.lineTo(state.failureSlot.x - 12, state.failureSlot.y + 12);
      ctx.stroke();
      ctx.restore();
    }

    if (state.hoveredSlot) {
      const slot = SLOTS[state.hoveredSlot];
      const radius = radiusForTeeth(slot.target) + 10;
      ctx.save();
      ctx.strokeStyle = "rgba(240, 206, 137, 0.59)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.arc(slot.x, slot.y, radius, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (state.selectedPart && state.hoveredSlot) {
      const slot = SLOTS[state.hoveredSlot];
      const radius = radiusForTeeth(state.selectedPart.teeth);
      renderGear(ctx, slot.x, slot.y, radius, state.selectedPart.teeth, state.now * 0.0003, {
        finish: state.selectedPart.finish,
        alpha: 0.35,
        holes: true
      });
      ctx.save();
      ctx.fillStyle = "rgba(244, 218, 168, 0.92)";
      ctx.font = "8px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillText(`SET ${state.selectedPart.teeth}T`, slot.x, slot.y - radius - 13);
      ctx.restore();
    }

    if (state.mode === "success") {
      ctx.save();
      ctx.translate(365, 265);
      ctx.rotate(-0.08);
      ctx.strokeStyle = "rgba(240, 206, 137, 0.63)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, 90, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 82, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "rgba(240, 206, 137, 0.82)";
      ctx.font = "bold 15px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("ACCEPTED", 0, -3);
      ctx.font = "7px 'Courier New', monospace";
      ctx.fillText("30 SEC · STABLE", 0, 10);
      ctx.restore();
    }

    if (state.mode === "failed") {
      ctx.save();
      ctx.fillStyle = "rgba(9, 12, 11, 0.84)";
      roundedRect(ctx, 72, 594, 260, 42, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(224, 123, 95, 0.35)";
      ctx.stroke();
      ctx.fillStyle = "rgba(238, 146, 120, 0.88)";
      ctx.font = "8px 'Courier New', monospace";
      ctx.fillText("BENCH FAILURE / STOP", 86, 610);
      ctx.fillStyle = "rgba(213, 206, 189, 0.55)";
      ctx.fillText(
        state.failure === "jam" ? "AXLE CLEARANCE TOO TIGHT" : "RATIO EXCEEDS SPEC",
        86,
        625
      );
      ctx.restore();
    }
  }
}
