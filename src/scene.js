import { LANES, clamp } from "./simulation.js";

const DESIGN_WIDTH = 1200;
const DESIGN_HEIGHT = 700;
const LANE_X = 178;
const LANE_WIDTH = 802;
const LANE_HEIGHT = 90;
const LANE_TOPS = [286, 404, 522];

const seeded = (index, salt = 0) => {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

export class SnowScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.particles = [];
    this.drift = [];
    this.emissionCarry = 0;
    this.lastFrame = 0;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  laneTop(index) {
    return LANE_TOPS[index];
  }

  laneCenter(index) {
    return LANE_TOPS[index] + LANE_HEIGHT / 2;
  }

  nozzlePosition(index, angle = 34) {
    const pivotX = 131;
    const pivotY = this.laneCenter(index) - 30;
    const rotation = -((angle - 18) * Math.PI) / 180 * 0.72;
    return {
      x: pivotX + 103 * Math.cos(rotation),
      y: pivotY + 103 * Math.sin(rotation),
      rotation,
    };
  }

  draw(snapshot, timestamp) {
    const context = this.context;
    const scaleX = this.canvas.width / DESIGN_WIDTH;
    const scaleY = this.canvas.height / DESIGN_HEIGHT;
    const dt = this.lastFrame
      ? Math.min(0.05, Math.max(0, (timestamp - this.lastFrame) / 1000))
      : 0.016;
    this.lastFrame = timestamp;

    context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    context.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.drawSky(context, snapshot, timestamp);
    this.drawMountains(context);
    this.drawSnowfield(context, snapshot, timestamp);
    LANES.forEach((_, index) => this.drawLane(context, snapshot, index, timestamp));
    LANES.forEach((_, index) => this.drawCannon(context, snapshot, index, timestamp));
    this.updateParticles(snapshot, dt);
    this.drawWind(context, snapshot, timestamp);
    this.drawParticles(context);
    this.drawForeground(context, timestamp);
  }

  drawSky(context, snapshot, timestamp) {
    const sky = context.createLinearGradient(0, 0, 0, 330);
    sky.addColorStop(0, "#071621");
    sky.addColorStop(0.52, "#123345");
    sky.addColorStop(1, "#316071");
    context.fillStyle = sky;
    context.fillRect(0, 0, DESIGN_WIDTH, 360);

    const warm = snapshot.environment.warmFront.intensity;
    if (warm > 0.01) {
      const glow = context.createLinearGradient(0, 0, DESIGN_WIDTH, 300);
      glow.addColorStop(0, `rgba(232, 145, 91, ${warm * 0.06})`);
      glow.addColorStop(0.65, `rgba(238, 173, 112, ${warm * 0.2})`);
      glow.addColorStop(1, `rgba(250, 196, 137, ${warm * 0.26})`);
      context.fillStyle = glow;
      context.fillRect(0, 0, DESIGN_WIDTH, 360);
    }

    context.save();
    for (let index = 0; index < 54; index += 1) {
      const x = seeded(index, 1) * DESIGN_WIDTH;
      const y = 24 + seeded(index, 2) * 220;
      const shimmer = 0.25 + Math.sin(timestamp * 0.0008 + index) * 0.16;
      context.globalAlpha = shimmer;
      context.fillStyle = index % 7 === 0 ? "#ffdca4" : "#cfedf5";
      context.beginPath();
      context.arc(x, y, scaled(index, 0.5, 1.4), 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    const moonX = 1058;
    const moonY = 104;
    const halo = context.createRadialGradient(moonX, moonY, 8, moonX, moonY, 115);
    halo.addColorStop(0, "rgba(203, 237, 243, 0.25)");
    halo.addColorStop(0.4, "rgba(166, 218, 231, 0.07)");
    halo.addColorStop(1, "rgba(166, 218, 231, 0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(moonX, moonY, 115, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(225, 244, 246, 0.72)";
    context.beginPath();
    context.arc(moonX, moonY, 27, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(43, 83, 94, 0.28)";
    context.beginPath();
    context.arc(moonX - 7, moonY - 4, 7, 0, Math.PI * 2);
    context.arc(moonX + 9, moonY + 7, 5, 0, Math.PI * 2);
    context.fill();
  }

  drawMountains(context) {
    context.save();
    context.translate(0, 4);
    context.fillStyle = "#294956";
    context.beginPath();
    context.moveTo(0, 270);
    context.lineTo(0, 198);
    context.lineTo(130, 155);
    context.lineTo(250, 228);
    context.lineTo(365, 154);
    context.lineTo(525, 254);
    context.lineTo(680, 167);
    context.lineTo(805, 240);
    context.lineTo(993, 143);
    context.lineTo(1110, 224);
    context.lineTo(1200, 187);
    context.lineTo(1200, 300);
    context.closePath();
    context.fill();

    context.fillStyle = "rgba(193, 222, 229, 0.62)";
    for (let index = 0; index < 7; index += 1) {
      const peaks = [130, 365, 680, 993, 1200, 525, 805];
      const x = peaks[index];
      const y = [155, 154, 167, 143, 187, 254, 240][index];
      context.beginPath();
      context.moveTo(x - 35, y + 21);
      context.lineTo(x, y);
      context.lineTo(x + 27, y + 18);
      context.lineTo(x + 12, y + 23);
      context.lineTo(x - 2, y + 17);
      context.lineTo(x - 15, y + 28);
      context.closePath();
      context.fill();
    }

    context.fillStyle = "#163645";
    context.beginPath();
    context.moveTo(0, 278);
    context.lineTo(0, 215);
    context.lineTo(116, 254);
    context.lineTo(239, 198);
    context.lineTo(390, 274);
    context.lineTo(568, 218);
    context.lineTo(706, 281);
    context.lineTo(854, 203);
    context.lineTo(1006, 277);
    context.lineTo(1138, 221);
    context.lineTo(1200, 246);
    context.lineTo(1200, 310);
    context.closePath();
    context.fill();
    context.restore();
  }

  drawSnowfield(context, snapshot, timestamp) {
    const field = context.createLinearGradient(0, 250, 0, DESIGN_HEIGHT);
    field.addColorStop(0, "#3e6874");
    field.addColorStop(0.33, "#274d5b");
    field.addColorStop(1, "#102937");
    context.fillStyle = field;
    context.fillRect(0, 240, DESIGN_WIDTH, DESIGN_HEIGHT - 240);

    context.save();
    context.globalAlpha = 0.16;
    for (let index = 0; index < 34; index += 1) {
      const x = seeded(index, 7) * DESIGN_WIDTH;
      const y = 270 + seeded(index, 8) * 390;
      const radius = 10 + seeded(index, 9) * 58;
      const patch = context.createRadialGradient(x, y, 0, x, y, radius);
      patch.addColorStop(0, "#d2e8ed");
      patch.addColorStop(1, "rgba(210, 232, 237, 0)");
      context.fillStyle = patch;
      context.beginPath();
      context.ellipse(x, y, radius * 2.2, radius * 0.55, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    context.save();
    context.fillStyle = "#0c2531";
    for (let index = 0; index < 23; index += 1) {
      const x = 12 + index * 56 + seeded(index, 10) * 24;
      const y = 258 + seeded(index, 11) * 19;
      const height = 18 + seeded(index, 12) * 24;
      context.beginPath();
      context.moveTo(x, y - height);
      context.lineTo(x - height * 0.33, y);
      context.lineTo(x + height * 0.33, y);
      context.closePath();
      context.fill();
    }
    context.fillStyle = "rgba(244, 194, 126, 0.72)";
    for (let index = 0; index < 7; index += 1) {
      const x = 110 + index * 148;
      const pulse = 0.55 + Math.sin(timestamp * 0.0013 + index) * 0.25;
      context.globalAlpha = pulse;
      context.beginPath();
      context.arc(x, 291 + (index % 2) * 5, 1.7, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    if (snapshot.environment.warmFront.intensity > 0.02) {
      const haze = context.createLinearGradient(0, 240, DESIGN_WIDTH, 360);
      haze.addColorStop(
        0,
        `rgba(244, 182, 122, ${snapshot.environment.warmFront.intensity * 0.04})`,
      );
      haze.addColorStop(
        0.75,
        `rgba(244, 182, 122, ${snapshot.environment.warmFront.intensity * 0.11})`,
      );
      haze.addColorStop(1, "rgba(244, 182, 122, 0)");
      context.fillStyle = haze;
      context.fillRect(0, 250, DESIGN_WIDTH, 320);
    }
  }

  lanePath(context, index, inset = 0) {
    const x = LANE_X + inset;
    const y = LANE_TOPS[index] + inset;
    const width = LANE_WIDTH - inset * 2;
    const height = LANE_HEIGHT - inset * 2;
    const radius = 12 - inset * 0.4;
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
  }

  drawLane(context, snapshot, index, timestamp) {
    const lane = LANES[index];
    const data = snapshot.lanes[index];
    const active = snapshot.activeLane === index;
    const x = LANE_X;
    const y = LANE_TOPS[index];
    const progress = clamp(data.thickness / lane.targetThickness, 0, 1);

    context.save();
    this.lanePath(context, index);
    context.clip();

    const base = context.createLinearGradient(x, y, x + LANE_WIDTH, y + LANE_HEIGHT);
    base.addColorStop(0, active ? "#244657" : "#193845");
    base.addColorStop(1, "#102b38");
    context.fillStyle = base;
    context.fillRect(x, y, LANE_WIDTH, LANE_HEIGHT);

    for (let lineIndex = 0; lineIndex < 13; lineIndex += 1) {
      const lineX = x + lineIndex * 67 - 25;
      context.strokeStyle = "rgba(187, 224, 234, 0.055)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(lineX, y);
      context.lineTo(lineX + 32, y + LANE_HEIGHT);
      context.stroke();
    }

    const snowWidth = progress * LANE_WIDTH;
    if (snowWidth > 0) {
      const snowGradient = context.createLinearGradient(
        x + LANE_WIDTH - snowWidth,
        y,
        x + LANE_WIDTH,
        y,
      );
      snowGradient.addColorStop(0, "rgba(199, 229, 236, 0.18)");
      snowGradient.addColorStop(0.32, "rgba(219, 240, 245, 0.52)");
      snowGradient.addColorStop(1, "rgba(244, 251, 252, 0.82)");
      context.fillStyle = snowGradient;
      context.fillRect(x + LANE_WIDTH - snowWidth, y, snowWidth, LANE_HEIGHT);

      context.globalAlpha = 0.32;
      context.strokeStyle = "#ffffff";
      context.lineWidth = 0.8;
      for (let ridge = 0; ridge < 8; ridge += 1) {
        const ridgeY = y + 13 + ridge * 9;
        context.beginPath();
        context.moveTo(x + LANE_WIDTH - snowWidth + 8, ridgeY);
        context.bezierCurveTo(
          x + LANE_WIDTH - snowWidth * 0.6,
          ridgeY - 5,
          x + LANE_WIDTH - snowWidth * 0.3,
          ridgeY + 6,
          x + LANE_WIDTH,
          ridgeY - 2,
        );
        context.stroke();
      }
      context.globalAlpha = 1;
    }

    this.drawIceZones(context, index, data, timestamp);
    context.restore();

    this.lanePath(context, index);
    context.strokeStyle = active
      ? "rgba(255, 190, 117, 0.86)"
      : data.certified
        ? "rgba(142, 220, 203, 0.46)"
        : "rgba(184, 221, 235, 0.2)";
    context.lineWidth = active ? 1.6 : 1;
    context.stroke();

    if (active) {
      context.save();
      context.shadowColor = "rgba(255, 177, 96, 0.45)";
      context.shadowBlur = 12;
      this.lanePath(context, index, -1);
      context.strokeStyle = "rgba(255, 192, 120, 0.2)";
      context.stroke();
      context.restore();
    }

    context.fillStyle = "rgba(4, 16, 23, 0.64)";
    context.beginPath();
    context.roundRect(x + 13, y + 12, 132, 23, 6);
    context.fill();
    context.fillStyle = active ? "#ffd29b" : "#d8edf2";
    context.font = "600 11px 'Noto Sans SC Variable', 'PingFang SC', sans-serif";
    context.fillText(`${lane.code}  ${lane.name}`, x + 24, y + 28);
    if (data.certified) {
      context.fillStyle = "#90ddc9";
      context.beginPath();
      context.arc(x + 128, y + 23, 3, 0, Math.PI * 2);
      context.fill();
    }

    this.drawLaneGauge(context, index, data, active);
  }

  drawIceZones(context, index, data, timestamp) {
    if (data.ice < 0.015) return;
    const y = LANE_TOPS[index];
    const count = 2 + (index % 2);
    context.save();
    context.globalAlpha = clamp(0.12 + data.ice * 0.54, 0.12, 0.68);
    for (let patchIndex = 0; patchIndex < count; patchIndex += 1) {
      const x = LANE_X + 240 + seeded(patchIndex + index * 9, 13) * 580;
      const centerY = y + 25 + seeded(patchIndex + index * 3, 14) * 45;
      const radius = 18 + seeded(patchIndex + index, 15) * 38;
      const iceGradient = context.createRadialGradient(
        x,
        centerY,
        2,
        x,
        centerY,
        radius,
      );
      iceGradient.addColorStop(0, "rgba(118, 226, 239, 0.84)");
      iceGradient.addColorStop(0.5, "rgba(67, 167, 189, 0.4)");
      iceGradient.addColorStop(1, "rgba(54, 130, 151, 0)");
      context.fillStyle = iceGradient;
      context.beginPath();
      for (let point = 0; point < 9; point += 1) {
        const angle = (point / 9) * Math.PI * 2;
        const jag = radius * (0.58 + seeded(point + patchIndex * 11, 16) * 0.45);
        const pointX = x + Math.cos(angle) * jag * 1.6;
        const pointY = centerY + Math.sin(angle) * jag * 0.54;
        if (point === 0) context.moveTo(pointX, pointY);
        else context.lineTo(pointX, pointY);
      }
      context.closePath();
      context.fill();
      context.strokeStyle = `rgba(188, 245, 250, ${0.18 + data.ice * 0.24})`;
      context.lineWidth = 0.7;
      context.stroke();
    }
    context.globalAlpha = 1;
    context.fillStyle = "rgba(194, 249, 252, 0.72)";
    context.font = "600 8px 'Noto Sans SC Variable', 'PingFang SC', sans-serif";
    if (data.ice > 0.18) {
      context.fillText(
        index === 2 ? "冰晶发育" : "湿雪结冰",
        LANE_X + 775,
        y + 73,
      );
    }
    context.restore();
  }

  drawLaneGauge(context, index, data, active) {
    const lane = LANES[index];
    const x = 1012;
    const y = LANE_TOPS[index] + 7;
    const width = 154;
    const height = 76;

    context.save();
    context.fillStyle = active ? "rgba(34, 44, 44, 0.44)" : "rgba(7, 23, 31, 0.38)";
    context.beginPath();
    context.roundRect(x, y, width, height, 9);
    context.fill();
    context.strokeStyle = active
      ? "rgba(244, 178, 105, 0.26)"
      : "rgba(180, 219, 232, 0.1)";
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = "rgba(208, 234, 241, 0.54)";
    context.font = "500 8px 'Noto Sans SC Variable', 'PingFang SC', sans-serif";
    context.fillText("厚度", x + 12, y + 17);
    context.fillText("硬度", x + 89, y + 17);
    context.fillStyle = "#effafc";
    context.font = "500 17px 'Noto Sans SC Variable', 'PingFang SC', sans-serif";
    context.fillText(data.thickness.toFixed(1), x + 12, y + 36);
    context.font = "500 14px 'Noto Sans SC Variable', 'PingFang SC', sans-serif";
    context.fillStyle = data.hardnessOk ? "#effafc" : "#ffb48c";
    context.fillText(data.thickness > 0 ? data.hardness.toFixed(0) : "—", x + 89, y + 35);
    context.fillStyle = "rgba(208, 234, 241, 0.46)";
    context.font = "500 8px 'Noto Sans SC Variable', 'PingFang SC', sans-serif";
    context.fillText(`/ ${lane.targetThickness}`, x + 43, y + 36);
    context.fillText(`± ${lane.tolerance}`, x + 109, y + 36);

    const barX = x + 12;
    const barY = y + 47;
    const barWidth = width - 24;
    context.fillStyle = "rgba(255, 255, 255, 0.09)";
    context.beginPath();
    context.roundRect(barX, barY, barWidth, 4, 3);
    context.fill();
    const fillWidth = clamp(
      (data.thickness / (lane.targetThickness * 1.24)) * barWidth,
      0,
      barWidth,
    );
    context.fillStyle = data.certified
      ? "#8bdbca"
      : active
        ? "#f5b06f"
        : "#8fcbd9";
    context.beginPath();
    context.roundRect(barX, barY, fillWidth, 4, 3);
    context.fill();
    context.fillStyle = "rgba(255, 255, 255, 0.55)";
    context.fillRect(barX + barWidth * (1 / 1.24), barY - 2, 1, 8);

    context.fillStyle = data.certified
      ? "#8bdbca"
      : data.ice > 0.38
        ? "#7ae0ec"
        : "rgba(208, 234, 241, 0.55)";
    context.font = "500 8px 'Noto Sans SC Variable', 'PingFang SC', sans-serif";
    context.fillText(data.certified ? "✓ 验收通过" : data.issue, x + 12, y + 66);
    context.textAlign = "right";
    context.fillStyle = data.qualityOk
      ? "rgba(145, 214, 207, 0.72)"
      : "rgba(255, 160, 126, 0.86)";
    context.fillText(
      data.thickness > 0 ? `雪质 ${Math.round(data.quality * 100)}` : "无雪层",
      x + width - 12,
      y + 66,
    );
    context.restore();
  }

  drawCannon(context, snapshot, index, timestamp) {
    const active = snapshot.activeLane === index;
    const center = this.laneCenter(index);
    const rotation = -((snapshot.controls.angle - 18) * Math.PI) / 180 * 0.72;
    const pivotX = 131;
    const pivotY = center - 30;

    context.save();
    context.globalAlpha = active ? 1 : 0.72;

    const shadow = context.createRadialGradient(116, center + 48, 2, 116, center + 48, 65);
    shadow.addColorStop(0, "rgba(0, 0, 0, 0.32)");
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = shadow;
    context.beginPath();
    context.ellipse(116, center + 48, 65, 13, 0, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = active ? "#d99b5e" : "#315462";
    context.lineWidth = 5;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(91, center + 43);
    context.lineTo(104, center + 7);
    context.lineTo(pivotX, pivotY + 10);
    context.moveTo(145, center + 43);
    context.lineTo(135, center + 13);
    context.lineTo(pivotX, pivotY + 10);
    context.stroke();
    context.strokeStyle = active ? "#f0bd7e" : "#4b7180";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(83, center + 49);
    context.lineTo(153, center + 49);
    context.stroke();

    context.save();
    context.translate(pivotX, pivotY);
    context.rotate(rotation);

    if (active && snapshot.controls.spraying) {
      const plume = context.createLinearGradient(18, 0, LANE_WIDTH - 20, 60);
      plume.addColorStop(0, "rgba(206, 245, 252, 0.2)");
      plume.addColorStop(0.45, "rgba(196, 239, 248, 0.055)");
      plume.addColorStop(1, "rgba(196, 239, 248, 0)");
      context.fillStyle = plume;
      context.beginPath();
      context.moveTo(15, -7);
      context.quadraticCurveTo(500, -35, 820, 66);
      context.lineTo(760, 106);
      context.quadraticCurveTo(420, 60, 15, 7);
      context.closePath();
      context.fill();
    }

    const barrel = context.createLinearGradient(0, -16, 0, 16);
    barrel.addColorStop(0, active ? "#7d9fab" : "#496977");
    barrel.addColorStop(0.48, active ? "#d1d8d8" : "#73909a");
    barrel.addColorStop(1, active ? "#415a63" : "#2d4b58");
    context.fillStyle = barrel;
    context.beginPath();
    context.roundRect(-21, -14, 130, 28, 13);
    context.fill();

    context.strokeStyle = active ? "#f1b46f" : "#5c7d88";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(8, -13);
    context.lineTo(101, -13);
    context.stroke();

    for (let ring = 0; ring < 4; ring += 1) {
      context.strokeStyle = "rgba(8, 28, 37, 0.28)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(55 + ring * 11, -12);
      context.lineTo(55 + ring * 11, 12);
      context.stroke();
    }

    context.fillStyle = active ? "#ffd09b" : "#90aeb7";
    context.beginPath();
    context.roundRect(98, -16, 14, 32, 5);
    context.fill();
    context.fillStyle = "#102934";
    context.beginPath();
    context.ellipse(111, 0, 3, 11, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = active ? "#234d59" : "#1b3945";
    context.beginPath();
    context.arc(-31, 0, 24, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = active ? "#e6ad6a" : "#547885";
    context.lineWidth = 3;
    context.stroke();

    context.save();
    context.rotate(timestamp * 0.004);
    context.fillStyle = active ? "rgba(212, 232, 234, 0.58)" : "rgba(111, 145, 154, 0.42)";
    for (let blade = 0; blade < 5; blade += 1) {
      context.rotate((Math.PI * 2) / 5);
      context.beginPath();
      context.ellipse(-43, 0, 15, 4, 0.38, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    context.fillStyle = active ? "#f4bc74" : "#537681";
    context.beginPath();
    context.arc(-31, 0, 5, 0, Math.PI * 2);
    context.fill();
    context.restore();

    const hose = context.createLinearGradient(32, center + 20, 64, center + 68);
    hose.addColorStop(0, active ? "#dd9958" : "#334f59");
    hose.addColorStop(1, "#172f3a");
    context.strokeStyle = hose;
    context.lineWidth = 6;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(50, center + 22);
    context.bezierCurveTo(11, center + 37, 18, center + 65, 55, center + 68);
    context.bezierCurveTo(79, center + 70, 103, center + 55, 95, center + 45);
    context.stroke();

    if (active) {
      const pulse = 0.68 + Math.sin(timestamp * 0.0035) * 0.18;
      context.globalAlpha = pulse;
      context.strokeStyle = snapshot.controls.spraying ? "#86ddca" : "#f4b66e";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(pivotX, pivotY, 31, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  updateParticles(snapshot, dt) {
    const active = snapshot.activeLane;
    if (snapshot.controls.spraying && snapshot.forecast.depositRate > 0.01) {
      const water = snapshot.controls.water / 100;
      this.emissionCarry += dt * (25 + water * 45);
      const tip = this.nozzlePosition(active, snapshot.controls.angle);
      while (this.emissionCarry >= 1) {
        this.emissionCarry -= 1;
        const angle = snapshot.controls.angle;
        const wetness = snapshot.forecast.wetness;
        const windPush = snapshot.environment.wind * 4.2;
        this.particles.push({
          x: tip.x + Math.random() * 9,
          y: tip.y - 5 + Math.random() * 10,
          vx: 300 + water * 110 + Math.random() * 90 + windPush,
          vy: -18 - Math.max(0, angle - 16) * 1.25 + Math.random() * 22,
          age: 0,
          life: 1.65 + Math.random() * 0.9,
          size: 0.75 + Math.random() * (wetness > 0.6 ? 2.2 : 1.35),
          wetness,
        });
      }
    } else {
      this.emissionCarry = Math.min(this.emissionCarry, 0.8);
    }

    this.particles.forEach((particle) => {
      particle.age += dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 64 * dt;
      particle.vx *= 1 - 0.055 * dt;
    });
    this.particles = this.particles
      .filter(
        (particle) =>
          particle.age < particle.life &&
          particle.x < LANE_X + LANE_WIDTH + 150 &&
          particle.y < DESIGN_HEIGHT,
      )
      .slice(-700);
  }

  drawParticles(context) {
    context.save();
    context.lineCap = "round";
    for (const particle of this.particles) {
      const progress = particle.age / particle.life;
      const alpha = Math.sin(Math.min(1, progress) * Math.PI) * 0.82;
      context.globalAlpha = alpha;
      context.strokeStyle =
        particle.wetness > 0.68 ? "rgba(198, 244, 250, 0.85)" : "rgba(239, 250, 252, 0.9)";
      context.lineWidth = Math.max(0.6, particle.size * 0.9);
      context.beginPath();
      context.moveTo(particle.x, particle.y);
      context.lineTo(
        particle.x - particle.vx * 0.018,
        particle.y - particle.vy * 0.018,
      );
      context.stroke();
      if (particle.size > 1.8) {
        context.fillStyle = "rgba(224, 249, 252, 0.35)";
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size * 0.8, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  drawWind(context, snapshot, timestamp) {
    const { wind, windAngle, warmFront } = snapshot.environment;
    const slope = Math.sin((windAngle * Math.PI) / 180) * 12;
    context.save();
    context.strokeStyle =
      warmFront.intensity > 0.03
        ? `rgba(249, 191, 128, ${0.18 + warmFront.intensity * 0.22})`
        : "rgba(204, 237, 243, 0.22)";
    context.fillStyle = context.strokeStyle;
    context.lineWidth = 1;
    const speed = 18 + wind * 7;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const x = ((timestamp * 0.001 * speed + column * 310 + row * 97) % 1320) - 90;
        const y = 68 + row * 64 + column * 11;
        const length = 27 + wind * 3.2;
        context.globalAlpha = 0.45 - row * 0.09;
        context.beginPath();
        context.moveTo(x, y);
        context.quadraticCurveTo(
          x + length * 0.52,
          y + slope * 0.65,
          x + length,
          y + slope,
        );
        context.stroke();
        context.beginPath();
        context.moveTo(x + length, y + slope);
        context.lineTo(x + length - 6, y + slope - 3.5);
        context.lineTo(x + length - 5, y + slope + 4);
        context.closePath();
        context.fill();
      }
    }

    for (let index = 0; index < 46; index += 1) {
      const x =
        ((timestamp * 0.001 * (14 + wind * 2.2) + seeded(index, 20) * 1300) %
          1300) -
        40;
      const y = 254 + seeded(index, 21) * 380;
      context.globalAlpha = 0.1 + seeded(index, 22) * 0.22;
      context.fillStyle = "#dff3f6";
      context.beginPath();
      context.ellipse(
        x,
        y,
        3 + wind * 0.45,
        0.65,
        slope * 0.01,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.restore();
  }

  drawForeground(context, timestamp) {
    const bank = context.createLinearGradient(0, 620, 0, DESIGN_HEIGHT);
    bank.addColorStop(0, "rgba(13, 38, 50, 0)");
    bank.addColorStop(0.42, "#0f2b39");
    bank.addColorStop(1, "#071b27");
    context.fillStyle = bank;
    context.beginPath();
    context.moveTo(0, 658);
    context.bezierCurveTo(260, 632, 530, 674, 780, 650);
    context.bezierCurveTo(950, 635, 1060, 652, 1200, 630);
    context.lineTo(1200, DESIGN_HEIGHT);
    context.lineTo(0, DESIGN_HEIGHT);
    context.closePath();
    context.fill();

    context.save();
    context.fillStyle = "rgba(112, 164, 177, 0.16)";
    context.beginPath();
    context.moveTo(0, 659);
    context.bezierCurveTo(260, 633, 530, 675, 780, 651);
    context.bezierCurveTo(950, 636, 1060, 653, 1200, 631);
    context.stroke();

    context.strokeStyle = "rgba(5, 20, 28, 0.9)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(20, 700);
    context.lineTo(24, 650);
    context.moveTo(90, 700);
    context.lineTo(86, 641);
    context.moveTo(1120, 700);
    context.lineTo(1117, 646);
    context.stroke();
    this.drawPine(context, 23, 662, 47, timestamp);
    this.drawPine(context, 88, 652, 37, timestamp + 9);
    this.drawPine(context, 1118, 655, 43, timestamp + 3);
    context.restore();
  }

  drawPine(context, x, baseY, height, timestamp) {
    context.save();
    context.translate(x, baseY);
    context.fillStyle = "#08202c";
    for (let tier = 0; tier < 4; tier += 1) {
      const tierY = -height + tier * height * 0.2;
      const halfWidth = 10 + tier * height * 0.12;
      context.beginPath();
      context.moveTo(0, tierY - 12);
      context.lineTo(-halfWidth, tierY + height * 0.28);
      context.lineTo(halfWidth, tierY + height * 0.28);
      context.closePath();
      context.fill();
    }
    context.fillStyle = "rgba(210, 237, 242, 0.32)";
    const shimmer = 0.2 + Math.sin(timestamp * 0.001 + x) * 0.08;
    context.globalAlpha = shimmer;
    context.beginPath();
    context.moveTo(-5, -height - 4);
    context.lineTo(-1, -height + 13);
    context.lineTo(5, -height + 12);
    context.closePath();
    context.fill();
    context.restore();
  }
}

function scaled(index, minimum, maximum) {
  return minimum + seeded(index, 4) * (maximum - minimum);
}
