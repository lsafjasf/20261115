const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, amount) => from + (to - from) * amount;
const easeOut = (value) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.resize = this.resize.bind(this);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
  }

  draw(state, time, waveform) {
    const context = this.context;
    const { width: w, height: h } = this;
    if (!w || !h) return;

    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, w, h);
    this.drawBackdrop(state, time);
    this.drawCellArchitecture(state, time);
    this.drawAlignmentGauge(state, time);
    this.drawWaveform(state, time, waveform);
    this.drawAssembly(state, time);
    this.drawStationDetails(state, time);
  }

  drawBackdrop(state, time) {
    const context = this.context;
    const { width: w, height: h } = this;
    const floorY = h * 0.69;

    const base = context.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, "#081015");
    base.addColorStop(0.6, "#060b0e");
    base.addColorStop(1, "#04080a");
    context.fillStyle = base;
    context.fillRect(0, 0, w, h);

    const cyanGlow = context.createRadialGradient(
      w * 0.27,
      floorY,
      0,
      w * 0.27,
      floorY,
      w * 0.32
    );
    cyanGlow.addColorStop(0, "rgba(41, 174, 158, 0.09)");
    cyanGlow.addColorStop(1, "rgba(41, 174, 158, 0)");
    context.fillStyle = cyanGlow;
    context.fillRect(0, 0, w, h);

    const orangeGlow = context.createRadialGradient(
      w * 0.73,
      floorY,
      0,
      w * 0.73,
      floorY,
      w * 0.3
    );
    orangeGlow.addColorStop(0, "rgba(217, 119, 47, 0.075)");
    orangeGlow.addColorStop(1, "rgba(217, 119, 47, 0)");
    context.fillStyle = orangeGlow;
    context.fillRect(0, 0, w, h);

    context.save();
    context.strokeStyle = "rgba(92, 125, 132, 0.085)";
    context.lineWidth = 1;
    const grid = 36;
    for (let x = (w / 2) % grid; x < w; x += grid) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, floorY);
      context.stroke();
    }
    for (let y = 0; y < floorY; y += grid) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(w, y);
      context.stroke();
    }

    context.strokeStyle = "rgba(111, 145, 148, 0.06)";
    for (let x = -w; x < w * 2; x += 92) {
      context.beginPath();
      context.moveTo(w / 2, floorY);
      context.lineTo(x, h);
      context.stroke();
    }
    for (let y = floorY; y < h; y += 25) {
      const depth = (y - floorY) / (h - floorY);
      context.globalAlpha = 0.16 + depth * 0.34;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(w, y);
      context.stroke();
    }
    context.restore();

    const floor = context.createLinearGradient(0, floorY, 0, h);
    floor.addColorStop(0, "rgba(9, 16, 19, 0.2)");
    floor.addColorStop(1, "rgba(2, 5, 7, 0.72)");
    context.fillStyle = floor;
    context.fillRect(0, floorY, w, h - floorY);

    const pulse = 0.035 + Math.sin(time * 0.9) * 0.008;
    const topWash = context.createRadialGradient(
      w / 2,
      h * 0.15,
      0,
      w / 2,
      h * 0.15,
      w * 0.38
    );
    topWash.addColorStop(0, `rgba(86, 148, 148, ${pulse})`);
    topWash.addColorStop(1, "rgba(86, 148, 148, 0)");
    context.fillStyle = topWash;
    context.fillRect(0, 0, w, h);
  }

  drawCellArchitecture(state, time) {
    const context = this.context;
    const { width: w, height: h } = this;
    const floorY = h * 0.69;
    const left = w * 0.22;
    const right = w * 0.78;

    context.save();
    context.strokeStyle = "rgba(75, 103, 110, 0.23)";
    context.fillStyle = "rgba(75, 103, 110, 0.2)";
    context.lineWidth = 1;
    context.setLineDash([3, 7]);
    [left, right].forEach((x) => {
      context.beginPath();
      context.moveTo(x, 238);
      context.lineTo(x, floorY + 55);
      context.stroke();
    });
    context.setLineDash([]);

    [left, right].forEach((x) => {
      context.beginPath();
      context.moveTo(x - 8, 244);
      context.lineTo(x, 236);
      context.lineTo(x + 8, 244);
      context.stroke();
    });

    context.strokeStyle = "rgba(61, 84, 91, 0.24)";
    context.beginPath();
    context.moveTo(0, floorY + 55);
    context.lineTo(w, floorY + 55);
    context.stroke();

    context.fillStyle = "rgba(107, 135, 139, 0.34)";
    context.font = "8px 'DIN Alternate', 'Bahnschrift', monospace";
    context.letterSpacing = "1.5px";
    context.fillText("SAFETY CURTAIN", left + 8, 226);
    context.textAlign = "right";
    context.fillText("SAFETY CURTAIN", right - 8, 226);
    context.textAlign = "left";

    const dotAlpha = 0.22 + (Math.sin(time * 2.1) + 1) * 0.11;
    context.fillStyle = `rgba(66, 226, 192, ${dotAlpha})`;
    context.beginPath();
    context.arc(left, floorY + 55, 2, 0, TAU);
    context.arc(right, floorY + 55, 2, 0, TAU);
    context.fill();
    context.restore();
  }

  drawAlignmentGauge(state, time) {
    const context = this.context;
    const { width: w, height: h } = this;
    const cx = w / 2;
    const y = Math.max(169, h * 0.32);
    const panelW = 410;
    const x = cx - panelW / 2;
    const scale = 1380;
    const tolerance = 0.025;
    const gaugeY = y + 35;
    const good = state.inTolerance && state.phase !== "failed";
    const weld = state.phase === "welding" || state.phase === "complete";

    context.save();
    context.fillStyle = "rgba(6, 12, 15, 0.72)";
    roundedRect(context, x, y, panelW, 64, 2);
    context.fill();
    context.strokeStyle = good ? "rgba(66, 226, 192, 0.32)" : "rgba(64, 87, 94, 0.28)";
    context.lineWidth = 1;
    context.stroke();

    context.font = "7px 'DIN Alternate', 'Bahnschrift', monospace";
    context.fillStyle = "rgba(131, 157, 160, 0.68)";
    context.textAlign = "left";
    context.fillText("DUAL POSITION / X AXIS", x + 12, y + 14);
    context.textAlign = "right";
    context.fillStyle = good ? "#77e6cc" : "rgba(170, 184, 183, 0.5)";
    context.fillText("±25 μm WINDOW", x + panelW - 12, y + 14);
    context.textAlign = "left";

    context.strokeStyle = "rgba(84, 114, 120, 0.34)";
    context.beginPath();
    context.moveTo(cx - 176, gaugeY);
    context.lineTo(cx + 176, gaugeY);
    context.stroke();

    const bandW = tolerance * scale * 2;
    const bandGradient = context.createLinearGradient(
      cx - bandW / 2,
      0,
      cx + bandW / 2,
      0
    );
    bandGradient.addColorStop(0, "rgba(66, 226, 192, 0)");
    bandGradient.addColorStop(0.22, "rgba(66, 226, 192, 0.16)");
    bandGradient.addColorStop(0.5, "rgba(180, 243, 107, 0.22)");
    bandGradient.addColorStop(0.78, "rgba(66, 226, 192, 0.16)");
    bandGradient.addColorStop(1, "rgba(66, 226, 192, 0)");
    context.fillStyle = bandGradient;
    context.fillRect(cx - bandW / 2, gaugeY - 9, bandW, 18);
    context.strokeStyle = "rgba(159, 229, 118, 0.5)";
    context.setLineDash([2, 3]);
    context.strokeRect(cx - bandW / 2, gaugeY - 9, bandW, 18);
    context.setLineDash([]);

    context.strokeStyle = "rgba(180, 222, 208, 0.55)";
    context.beginPath();
    context.moveTo(cx, gaugeY - 11);
    context.lineTo(cx, gaugeY + 11);
    context.stroke();

    for (let tick = -100; tick <= 100; tick += 25) {
      const px = cx + (tick / 1000) * scale;
      const major = tick === 0;
      context.strokeStyle = major
        ? "rgba(171, 201, 193, 0.32)"
        : "rgba(85, 111, 116, 0.23)";
      context.beginPath();
      context.moveTo(px, gaugeY + 10);
      context.lineTo(px, gaugeY + (major ? 8 : 12));
      context.stroke();
    }

    const aX = cx + state.fixtureError * scale;
    const bX = cx + state.torchError * scale;
    this.drawNeedle(aX, gaugeY - 4, "#42e2c0", "A", true);
    this.drawNeedle(bX, gaugeY + 4, "#ff9b4c", "B", false);

    if (weld) {
      const pulse = 0.4 + Math.sin(time * 18) * 0.2;
      context.fillStyle = `rgba(255, 155, 76, ${pulse})`;
      context.fillRect(cx - bandW / 2, gaugeY - 11, bandW, 22);
    }
    context.restore();
  }

  drawNeedle(x, y, color, label, above) {
    const context = this.context;
    const direction = above ? -1 : 1;
    context.save();
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 8;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - 4, y + direction * 7);
    context.lineTo(x + 4, y + direction * 7);
    context.closePath();
    context.fill();
    context.shadowBlur = 0;
    context.font = "7px 'DIN Alternate', 'Bahnschrift', monospace";
    context.fillStyle = color;
    context.textAlign = x < this.width / 2 ? "right" : "left";
    context.fillText(label, x + (x < this.width / 2 ? -7 : 7), y + direction * 16);
    context.restore();
  }

  drawWaveform(state, time, waveform) {
    const context = this.context;
    const { width: w, height: h } = this;
    const cx = w / 2;
    const y = Math.max(252, h * 0.48);
    const width = 372;
    const points = waveform?.length ? waveform : [];
    const active = state.phase !== "failed";

    context.save();
    context.font = "7px 'DIN Alternate', 'Bahnschrift', monospace";
    context.fillStyle = "rgba(100, 127, 131, 0.55)";
    context.textAlign = "left";
    context.fillText("AUDIO LINK", cx - width / 2, y - 8);

    context.textAlign = "right";
    const beat = Math.max(0, 1 - state.sync) * 21;
    context.fillStyle =
      state.sync > 0.78 ? "rgba(66, 226, 192, 0.7)" : "rgba(255, 198, 91, 0.68)";
    context.fillText(`Δ ${beat.toFixed(1)} Hz`, cx + width / 2, y - 8);

    context.strokeStyle = "rgba(56, 81, 88, 0.25)";
    context.beginPath();
    context.moveTo(cx - width / 2, y);
    context.lineTo(cx + width / 2, y);
    context.stroke();

    if (points.length) {
      context.strokeStyle = active
        ? state.sync > 0.76
          ? "rgba(66, 226, 192, 0.58)"
          : "rgba(255, 173, 95, 0.5)"
        : "rgba(255, 90, 82, 0.45)";
      context.lineWidth = 1;
      context.beginPath();
      points.forEach((value, index) => {
        const px = cx - width / 2 + (index / (points.length - 1)) * width;
        const py = y + value * (9 + state.sync * 6);
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.stroke();
    }

    const scanX = cx - width / 2 + ((time * 34) % width);
    context.strokeStyle = "rgba(173, 235, 211, 0.18)";
    context.beginPath();
    context.moveTo(scanX, y - 12);
    context.lineTo(scanX, y + 12);
    context.stroke();
    context.restore();
  }

  drawAssembly(state, time) {
    const context = this.context;
    const { width: w, height: h } = this;
    const cx = w / 2;
    const tableY = h * 0.78;
    const partBottom = tableY - 11;
    const partHeight = clamp(h * 0.132, 58, 78);
    const partY = partBottom - partHeight;
    const partWidth = clamp(w * 0.158, 150, 205);
    const errorScale = 700;
    const feed = state.phase === "feed"
      ? easeOut(state.phaseElapsed / 0.82)
      : 1;
    const weld = state.phase === "welding" || state.phase === "complete";
    const failed = state.phase === "failed";
    const leftEdge = cx - 2 + state.fixtureError * errorScale;
    const rightEdge = cx + 2;
    const leftX = lerp(-partWidth - 45, leftEdge - partWidth, feed);
    const rightX = lerp(w + 45, rightEdge, feed);
    const seamX = cx + ((state.fixtureError + state.torchError) / 2) * errorScale;

    this.drawTable(cx, tableY, time, state);

    context.save();
    if (failed) {
      const shake = Math.sin(time * 72) * 1.6 * Math.max(0, 1 - state.phaseElapsed * 1.5);
      context.translate(shake, 0);
    }

    this.drawPart({
      x: leftX,
      y: partY,
      width: partWidth,
      height: partHeight,
      side: "left",
      time,
      heat: state.phase === "welding" ? state.weldProgress : 0,
      damaged: failed
    });

    this.drawPart({
      x: rightX,
      y: partY,
      width: partWidth,
      height: partHeight,
      side: "right",
      time,
      heat: state.phase === "welding" ? state.weldProgress : 0,
      damaged: failed
    });

    this.drawTargetLine(cx, partY, partBottom, state, time);
    this.drawFixture(leftX + partWidth, partY, partHeight, state, time);

    if (weld || failed) {
      this.drawWeldPath(seamX, partY, partBottom, state, time);
    }

    this.drawTorch(seamX, partY, partBottom, state, time, weld);
    if (weld) this.drawSparks(seamX, partY, partBottom, state, time);
    if (failed) this.drawDamage(seamX, partY, partBottom, time);
    context.restore();

    this.drawAssemblyLabels(leftX, rightX, partY, partWidth, state, feed);
  }

  drawTable(cx, tableY, time, state) {
    const context = this.context;
    const { width: w, height: h } = this;
    const tableW = clamp(w * 0.53, 500, 670);

    const floorGlow = context.createRadialGradient(cx, tableY + 20, 0, cx, tableY + 20, tableW * 0.55);
    const active = state.phase === "welding";
    floorGlow.addColorStop(
      0,
      active ? "rgba(255, 145, 62, 0.11)" : "rgba(67, 140, 139, 0.075)"
    );
    floorGlow.addColorStop(0.55, "rgba(48, 94, 96, 0.035)");
    floorGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = floorGlow;
    context.beginPath();
    context.ellipse(cx, tableY + 22, tableW * 0.62, 46, 0, 0, TAU);
    context.fill();

    context.fillStyle = "#0b1216";
    context.beginPath();
    context.moveTo(cx - tableW * 0.45, tableY);
    context.lineTo(cx + tableW * 0.45, tableY);
    context.lineTo(cx + tableW * 0.34, tableY + 19);
    context.lineTo(cx - tableW * 0.34, tableY + 19);
    context.closePath();
    context.fill();
    context.strokeStyle = "#33454b";
    context.lineWidth = 1;
    context.stroke();

    const topGradient = context.createLinearGradient(0, tableY - 3, 0, tableY + 5);
    topGradient.addColorStop(0, "#344247");
    topGradient.addColorStop(0.32, "#1b272c");
    topGradient.addColorStop(1, "#111b20");
    context.fillStyle = topGradient;
    context.beginPath();
    context.moveTo(cx - tableW / 2, tableY - 3);
    context.lineTo(cx + tableW / 2, tableY - 3);
    context.lineTo(cx + tableW * 0.45, tableY);
    context.lineTo(cx - tableW * 0.45, tableY);
    context.closePath();
    context.fill();

    context.strokeStyle = "rgba(112, 144, 145, 0.25)";
    context.beginPath();
    context.moveTo(cx - tableW / 2, tableY - 3);
    context.lineTo(cx + tableW / 2, tableY - 3);
    context.stroke();

    const stripeY = tableY + 4;
    const stripeW = 17;
    context.save();
    context.beginPath();
    context.moveTo(cx - tableW * 0.4, stripeY);
    context.lineTo(cx + tableW * 0.4, stripeY);
    context.lineTo(cx + tableW * 0.38, stripeY + 7);
    context.lineTo(cx - tableW * 0.38, stripeY + 7);
    context.closePath();
    context.clip();
    for (let x = cx - tableW / 2; x < cx + tableW / 2; x += stripeW * 2) {
      context.fillStyle = "#262f31";
      context.fillRect(x, stripeY, stripeW, 7);
      context.fillStyle = "rgba(255, 194, 90, 0.38)";
      context.fillRect(x + stripeW, stripeY, stripeW, 7);
    }
    context.restore();

    context.fillStyle = "#0b1317";
    context.fillRect(cx - tableW * 0.34, tableY + 19, 12, 49);
    context.fillRect(cx + tableW * 0.34 - 12, tableY + 19, 12, 49);
    context.fillStyle = "#172328";
    context.fillRect(cx - tableW * 0.34 + 2, tableY + 19, 2, 49);
    context.fillRect(cx + tableW * 0.34 - 4, tableY + 19, 2, 49);
  }

  drawPart({ x, y, width, height, side, time, heat, damaged }) {
    const context = this.context;
    const leftSide = side === "left";
    const bevel = 7;
    const start = leftSide ? "#277b8c" : "#9f5f32";
    const mid = leftSide ? "#164957" : "#693d28";
    const end = leftSide ? "#0c2b34" : "#42271e";
    const edge = leftSide ? "#53bfc0" : "#f4a45c";

    context.save();
    context.shadowColor = "rgba(0, 0, 0, 0.55)";
    context.shadowBlur = 18;
    context.shadowOffsetY = 8;
    context.beginPath();
    if (leftSide) {
      context.moveTo(x + bevel, y);
      context.lineTo(x + width, y);
      context.lineTo(x + width, y + height - bevel);
      context.lineTo(x + width - bevel, y + height);
      context.lineTo(x, y + height);
      context.lineTo(x, y + bevel);
    } else {
      context.moveTo(x, y);
      context.lineTo(x + width - bevel, y);
      context.lineTo(x + width, y + bevel);
      context.lineTo(x + width, y + height);
      context.lineTo(x + bevel, y + height);
      context.lineTo(x, y + height - bevel);
    }
    context.closePath();
    const gradient = context.createLinearGradient(x, y, x, y + height);
    gradient.addColorStop(0, start);
    gradient.addColorStop(0.38, mid);
    gradient.addColorStop(1, end);
    context.fillStyle = gradient;
    context.fill();
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;

    context.strokeStyle = damaged ? "rgba(255, 93, 73, 0.9)" : "rgba(199, 231, 226, 0.16)";
    context.lineWidth = 1;
    context.stroke();

    const faceX = leftSide ? x + width - 12 : x + 2;
    context.fillStyle = "rgba(5, 12, 15, 0.42)";
    context.fillRect(faceX, y + 7, 10, height - 14);
    context.fillStyle = edge;
    context.globalAlpha = 0.7;
    context.fillRect(leftSide ? x + width - 3 : x, y + 5, 3, height - 10);
    context.globalAlpha = 1;

    context.strokeStyle = "rgba(216, 240, 236, 0.12)";
    context.beginPath();
    context.moveTo(x + (leftSide ? 15 : 20), y + 13);
    context.lineTo(x + width - (leftSide ? 20 : 15), y + 13);
    context.stroke();

    for (let i = 0; i < 3; i += 1) {
      const holeX = x + 28 + i * (width - 62) / 2;
      context.beginPath();
      context.arc(holeX, y + height * 0.59, 3.2, 0, TAU);
      context.fillStyle = "rgba(4, 10, 12, 0.56)";
      context.fill();
      context.strokeStyle = "rgba(197, 224, 219, 0.14)";
      context.stroke();
    }

    context.fillStyle = "rgba(227, 242, 239, 0.34)";
    context.font = "7px 'DIN Alternate', 'Bahnschrift', monospace";
    context.textAlign = leftSide ? "left" : "right";
    context.fillText(leftSide ? "HALF / 01-L" : "HALF / 01-R", leftSide ? x + 17 : x + width - 17, y + height - 13);

    if (heat > 0) {
      const glow = context.createRadialGradient(
        leftSide ? x + width : x,
        y + height * 0.5,
        0,
        leftSide ? x + width : x,
        y + height * 0.5,
        52
      );
      const intensity = damaged ? 0.42 : 0.22;
      glow.addColorStop(0, `rgba(255, 158, 55, ${intensity * heat})`);
      glow.addColorStop(1, "rgba(255, 110, 35, 0)");
      context.fillStyle = glow;
      context.fillRect(
        leftSide ? x + width - 54 : x - 2,
        y - 15,
        57,
        height + 30
      );
    }
    context.restore();
  }

  drawTargetLine(cx, partY, partBottom, state, time) {
    const context = this.context;
    context.save();
    context.strokeStyle = state.inTolerance
      ? "rgba(180, 243, 107, 0.35)"
      : "rgba(255, 198, 91, 0.34)";
    context.setLineDash([4, 6]);
    context.beginPath();
    context.moveTo(cx, partY - 28);
    context.lineTo(cx, partBottom + 14);
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = "rgba(170, 198, 194, 0.45)";
    context.font = "7px 'DIN Alternate', 'Bahnschrift', monospace";
    context.textAlign = "center";
    context.fillText("X 0.000", cx, partY - 34);

    const arrowAlpha = 0.2 + (Math.sin(time * 4) + 1) * 0.12;
    context.fillStyle = `rgba(180, 243, 107, ${arrowAlpha})`;
    context.beginPath();
    context.moveTo(cx, partBottom + 9);
    context.lineTo(cx - 3, partBottom + 14);
    context.lineTo(cx + 3, partBottom + 14);
    context.closePath();
    context.fill();
    context.restore();
  }

  drawFixture(edgeX, partY, partHeight, state, time) {
    const context = this.context;
    const centerY = partY + partHeight * 0.52;
    const active = state.phase === "welding";
    const pulse = active ? 0.7 : 0.44 + Math.sin(time * 2.4) * 0.08;

    context.save();
    context.strokeStyle = `rgba(66, 226, 192, ${pulse})`;
    context.fillStyle = "rgba(21, 71, 71, 0.72)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(edgeX - 13, centerY - 23);
    context.lineTo(edgeX + 7, centerY - 23);
    context.lineTo(edgeX + 7, centerY - 9);
    context.lineTo(edgeX - 2, centerY - 9);
    context.lineTo(edgeX - 2, centerY + 11);
    context.lineTo(edgeX + 7, centerY + 11);
    context.lineTo(edgeX + 7, centerY + 24);
    context.lineTo(edgeX - 13, centerY + 24);
    context.stroke();

    context.fillStyle = "rgba(66, 226, 192, 0.16)";
    context.fillRect(edgeX - 11, centerY - 6, 7, 12);
    context.strokeStyle = "rgba(121, 235, 209, 0.65)";
    context.lineWidth = 1;
    context.strokeRect(edgeX - 11, centerY - 6, 7, 12);

    context.strokeStyle = "rgba(72, 113, 114, 0.36)";
    context.beginPath();
    context.moveTo(edgeX - 13, centerY);
    context.lineTo(edgeX - 66, centerY + 12);
    context.stroke();
    context.fillStyle = "rgba(66, 226, 192, 0.52)";
    context.font = "7px 'DIN Alternate', 'Bahnschrift', monospace";
    context.textAlign = "right";
    context.fillText("HYD. CLAMP", edgeX - 38, centerY + 26);
    context.restore();
  }

  drawTorch(seamX, partY, partBottom, state, time, weld) {
    const context = this.context;
    const { width: w, height: h } = this;
    const progress = clamp(state.weldProgress, 0, 1);
    const tipY = weld
      ? lerp(partBottom - 1, partY + 5, progress)
      : partY - 22 + Math.sin(time * 2.6) * 1.3;
    const anchorX = Math.min(w - 300, seamX + 128);
    const anchorY = Math.max(235, partY - 100);
    const elbowX = seamX + 59;
    const elbowY = tipY - 48;

    context.save();
    context.strokeStyle = "rgba(121, 75, 42, 0.55)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(anchorX + 16, anchorY - 20);
    context.bezierCurveTo(
      anchorX + 48,
      anchorY + 5,
      elbowX + 30,
      elbowY - 20,
      elbowX + 4,
      elbowY
    );
    context.stroke();

    context.strokeStyle = "#7d5738";
    context.lineWidth = 7;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(anchorX, anchorY);
    context.lineTo(elbowX, elbowY);
    context.lineTo(seamX, tipY - 5);
    context.stroke();
    context.strokeStyle = "rgba(240, 186, 119, 0.55)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(anchorX, anchorY - 1);
    context.lineTo(elbowX, elbowY - 1);
    context.lineTo(seamX, tipY - 6);
    context.stroke();

    context.fillStyle = "#1a272b";
    context.strokeStyle = "#53686c";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(anchorX, anchorY, 13, 0, TAU);
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(anchorX, anchorY, 4, 0, TAU);
    context.fillStyle = "#10191c";
    context.fill();

    context.beginPath();
    context.moveTo(seamX - 5, tipY + 8);
    context.lineTo(seamX - 3, tipY - 3);
    context.lineTo(seamX + 3, tipY - 3);
    context.lineTo(seamX + 5, tipY + 8);
    context.closePath();
    context.fillStyle = "#b97842";
    context.shadowColor = "rgba(255, 138, 55, 0.55)";
    context.shadowBlur = weld ? 16 : 6;
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = "#f9bd78";
    context.stroke();

    if (weld) {
      const arc = context.createRadialGradient(seamX, tipY + 7, 0, seamX, tipY + 7, 34);
      arc.addColorStop(0, "rgba(255, 255, 222, 0.95)");
      arc.addColorStop(0.16, "rgba(255, 205, 100, 0.62)");
      arc.addColorStop(0.5, "rgba(255, 112, 36, 0.22)");
      arc.addColorStop(1, "rgba(255, 96, 26, 0)");
      context.fillStyle = arc;
      context.beginPath();
      context.arc(seamX, tipY + 7, 34, 0, TAU);
      context.fill();
    }

    context.fillStyle = "rgba(255, 164, 89, 0.62)";
    context.font = "7px 'DIN Alternate', 'Bahnschrift', monospace";
    context.textAlign = "left";
    context.fillText("TORCH / 02", anchorX + 18, anchorY + 3);
    context.restore();
  }

  drawWeldPath(seamX, partY, partBottom, state, time) {
    const context = this.context;
    const failed = state.phase === "failed";
    const progress = failed ? 0.16 : clamp(state.weldProgress, 0, 1);
    const top = partY + 4;
    const bottom = partBottom - 3;
    const points = [];
    const count = 34;
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      points.push({
        x: seamX + Math.sin(i * 2.35) * (2.2 + Math.sin(i * 0.7) * 0.7),
        y: lerp(bottom, top, t),
        t
      });
    }

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowColor = failed ? "rgba(255, 74, 43, 0.75)" : "rgba(255, 132, 44, 0.85)";
    context.shadowBlur = 14;
    context.strokeStyle = failed ? "#8b291e" : "rgba(255, 112, 31, 0.8)";
    context.lineWidth = 5;
    context.beginPath();
    points.forEach((point, index) => {
      if (point.t > progress) return;
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();

    context.shadowBlur = 6;
    context.strokeStyle = failed ? "#ff6651" : "rgba(255, 229, 159, 0.95)";
    context.lineWidth = 1.4;
    context.beginPath();
    points.forEach((point, index) => {
      if (point.t > progress) return;
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
    context.shadowBlur = 0;

    if (!failed) {
      const tipIndex = Math.floor(progress * (points.length - 1));
      const tip = points[Math.max(0, tipIndex)];
      if (tip && progress > 0 && progress < 1) {
        context.fillStyle = "#fff5c7";
        context.beginPath();
        context.arc(tip.x, tip.y, 2.4 + Math.sin(time * 31) * 0.5, 0, TAU);
        context.fill();
      }
    }
    context.restore();
  }

  drawSparks(seamX, partY, partBottom, state, time) {
    const context = this.context;
    const progress = clamp(state.weldProgress, 0, 1);
    const tipY = lerp(partBottom - 1, partY + 5, progress);
    context.save();
    context.lineCap = "round";
    for (let i = 0; i < 24; i += 1) {
      const phase = (time * (1.35 + (i % 5) * 0.13) + i * 0.173) % 1;
      const spread = ((i * 37) % 11) / 10 - 0.5;
      const dx = spread * 46 * phase;
      const dy = -Math.sin(phase * Math.PI) * (22 + (i % 7) * 6) + phase * 26;
      const alpha = (1 - phase) * (0.35 + (i % 4) * 0.12);
      context.strokeStyle = `rgba(255, ${140 + (i % 6) * 12}, 68, ${alpha})`;
      context.lineWidth = i % 3 === 0 ? 1.5 : 1;
      context.beginPath();
      context.moveTo(seamX + dx * 0.18, tipY + dy * 0.12);
      context.lineTo(seamX + dx, tipY + dy);
      context.stroke();
    }
    context.restore();
  }

  drawDamage(seamX, partY, partBottom, time) {
    const context = this.context;
    const centerY = (partY + partBottom) / 2;
    context.save();
    const glow = context.createRadialGradient(seamX, centerY, 0, seamX, centerY, 88);
    glow.addColorStop(0, "rgba(255, 93, 57, 0.22)");
    glow.addColorStop(1, "rgba(255, 34, 20, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(seamX, centerY, 88, 0, TAU);
    context.fill();

    context.strokeStyle = "rgba(255, 93, 66, 0.8)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(seamX, partY + 7);
    context.lineTo(seamX - 12, partY + 25);
    context.lineTo(seamX + 8, partY + 37);
    context.lineTo(seamX - 14, partY + 53);
    context.stroke();

    for (let i = 0; i < 5; i += 1) {
      const rise = (time * 22 + i * 13) % 48;
      context.fillStyle = `rgba(138, 149, 146, ${0.13 * (1 - rise / 48)})`;
      context.beginPath();
      context.arc(seamX + Math.sin(i * 2 + time) * 13, partY - 2 - rise, 5 + rise * 0.13, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  drawAssemblyLabels(leftX, rightX, partY, partWidth, state, feed) {
    const context = this.context;
    const { width: w } = this;
    context.save();
    context.font = "7px 'DIN Alternate', 'Bahnschrift', monospace";
    context.fillStyle = "rgba(111, 139, 141, 0.52)";
    context.textAlign = "right";
    context.fillText("SERVO FEED / L", Math.max(292, leftX - 14), partY - 8);
    context.textAlign = "left";
    context.fillText(
      "SERVO FEED / R",
      Math.min(w - 292, rightX + partWidth + 14),
      partY - 8
    );

    if (feed < 1) {
      const alpha = 0.34 + Math.sin(feed * Math.PI * 8) * 0.12;
      context.strokeStyle = `rgba(66, 226, 192, ${alpha})`;
      context.beginPath();
      context.moveTo(Math.max(275, leftX - 54), partY + 27);
      context.lineTo(Math.max(295, leftX - 14), partY + 27);
      context.stroke();
      context.strokeStyle = `rgba(255, 155, 76, ${alpha})`;
      context.beginPath();
      context.moveTo(Math.min(w - 275, rightX + partWidth + 54), partY + 27);
      context.lineTo(Math.min(w - 295, rightX + partWidth + 14), partY + 27);
      context.stroke();
    }
    context.restore();
  }

  drawStationDetails(state, time) {
    const context = this.context;
    const { width: w, height: h } = this;
    const cx = w / 2;
    const tableY = h * 0.78;
    const xPad = Math.max(282, (w - 670) / 2 - 94);
    const leftX = xPad;
    const rightX = w - xPad;
    const meterY = tableY + 47;

    context.save();
    context.font = "7px 'DIN Alternate', 'Bahnschrift', monospace";
    context.fillStyle = "rgba(104, 130, 134, 0.52)";
    context.textAlign = "left";
    context.fillText("VIBRATION", leftX, meterY);
    context.textAlign = "right";
    context.fillText("GAS PRESSURE", rightX, meterY);

    const vibration = state.phase === "countdown" ? 0.74 : 0.2 + state.vibration * 45;
    for (let i = 0; i < 8; i += 1) {
      const active = i / 8 < vibration;
      context.fillStyle = active
        ? "rgba(66, 226, 192, 0.58)"
        : "rgba(67, 91, 96, 0.25)";
      context.fillRect(leftX + i * 7, meterY + 9, 4, 3);
    }
    for (let i = 0; i < 8; i += 1) {
      context.fillStyle =
        i < 6 ? "rgba(255, 155, 76, 0.48)" : "rgba(67, 91, 96, 0.25)";
      context.fillRect(rightX - 59 + i * 7, meterY + 9, 4, 3);
    }

    context.fillStyle = "rgba(109, 135, 136, 0.4)";
    context.textAlign = "center";
    context.fillText(
      `CELL 03  //  CYCLE ${String(state.completed).padStart(2, "0")}  //  ${state.phase.toUpperCase()}`,
      cx,
      h - 48
    );
    context.restore();
  }
}
