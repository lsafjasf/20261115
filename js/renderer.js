import { WORLD } from "./physics.js";

const COLORS = {
  void: "#071118",
  floor: "#0a171d",
  floorLight: "#10242b",
  grid: "rgba(99, 173, 177, 0.09)",
  gridHot: "rgba(99, 173, 177, 0.15)",
  cyan: "#62ead8",
  cyanDeep: "#1b8f8b",
  amber: "#ffbf69",
  amberDeep: "#87602e",
  red: "#ff6e62",
  green: "#8fe388",
  muted: "#75949a",
  line: "rgba(139, 202, 209, 0.18)"
};

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

function gatePassCount(state, gateIndex) {
  return state.cars.reduce((count, car) => count + Number(car.gates[gateIndex]), 0);
}

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = WORLD.width * this.dpr;
    canvas.height = WORLD.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  render(state, view = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    this.drawBackground(state, view);

    const shake = state.cable.tension > 1100 ? Math.min(2.4, state.cable.tension / 750) : 0;
    ctx.translate(
      Math.sin(state.step * 1.7) * shake,
      Math.cos(state.step * 2.1) * shake * 0.5
    );
    this.drawRoute(state);
    this.drawGates(state);
    this.drawFinish(state, view);
    this.drawCable(state);
    this.drawCar(state.cars[1], 1, state);
    this.drawCar(state.cars[0], 0, state);
    this.drawStressParticles(state);
    ctx.restore();
  }

  drawBackground(state, view) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
    gradient.addColorStop(0, "#09171e");
    gradient.addColorStop(0.55, "#071219");
    gradient.addColorStop(1, "#061017");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.fillStyle = COLORS.floor;
    roundedRect(ctx, 30, WORLD.top, 940, WORLD.bottom - WORLD.top, 18);
    ctx.fill();

    ctx.save();
    roundedRect(ctx, 30, WORLD.top, 940, WORLD.bottom - WORLD.top, 18);
    ctx.clip();
    for (let x = 50; x < 980; x += 40) {
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, WORLD.top);
      ctx.lineTo(x, WORLD.bottom);
      ctx.stroke();
    }
    for (let y = WORLD.top; y < WORLD.bottom; y += 40) {
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.lineTo(970, y);
      ctx.stroke();
    }

    ctx.strokeStyle = COLORS.gridHot;
    ctx.setLineDash([2, 10]);
    ctx.beginPath();
    ctx.moveTo(470, WORLD.bottom - 6);
    ctx.lineTo(470, WORLD.finishY + 18);
    ctx.stroke();
    ctx.setLineDash([]);

    const sweep = (state.elapsed * 45) % 260;
    ctx.fillStyle = view.mode === "replay"
      ? "rgba(255,191,105,0.025)"
      : "rgba(98,234,216,0.024)";
    ctx.fillRect(30, WORLD.bottom - sweep, 940, 50);
    ctx.restore();

    ctx.strokeStyle = "rgba(98,234,216,0.15)";
    ctx.lineWidth = 1;
    roundedRect(ctx, 30, WORLD.top, 940, WORLD.bottom - WORLD.top, 18);
    ctx.stroke();

    this.drawSideRails();
    this.drawStartPad(state);
  }

  drawSideRails() {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(98, 234, 216, 0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(47, WORLD.bottom - 40);
    ctx.lineTo(47, WORLD.top + 28);
    ctx.moveTo(953, WORLD.bottom - 40);
    ctx.lineTo(953, WORLD.top + 28);
    ctx.stroke();

    ctx.fillStyle = "rgba(98, 234, 216, 0.16)";
    for (let y = WORLD.top + 34; y < WORLD.bottom - 42; y += 42) {
      ctx.fillRect(43, y, 8, 2);
      ctx.fillRect(949, y, 8, 2);
    }
  }

  drawStartPad(state) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(117, 148, 154, 0.26)";
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(65, 596);
    ctx.lineTo(935, 596);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(117, 148, 154, 0.48)";
    ctx.font = "700 9px 'Courier New', 'Noto Sans SC Variable', monospace";
    ctx.fillText("DEPLOY / 双车编组", 66, 588);
    ctx.fillStyle = state.status === "live" ? COLORS.cyan : COLORS.muted;
    ctx.beginPath();
    ctx.arc(920, 591, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawRoute(state) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(98, 234, 216, 0.045)";
    ctx.lineWidth = 86;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(450, 570);
    ctx.bezierCurveTo(435, 470, 440, 390, 540, 335);
    ctx.bezierCurveTo(660, 275, 680, 230, 680, 170);
    ctx.stroke();
    ctx.restore();
  }

  drawGates(state) {
    const ctx = this.ctx;
    WORLD.gates.forEach((gate, index) => {
      const bothPassed = gatePassCount(state, index) === 2;
      const pulse = 0.55 + Math.sin(state.elapsed * 3 + index) * 0.15;
      const gateColor = bothPassed ? COLORS.green : COLORS.amber;
      ctx.save();

      ctx.fillStyle = "rgba(6, 16, 21, 0.78)";
      ctx.fillRect(30, gate.y - 9, gate.left - 30, 18);
      ctx.fillRect(gate.right, gate.y - 9, 970 - gate.right, 18);

      ctx.strokeStyle = "rgba(255, 191, 105, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(30, gate.y - 9);
      ctx.lineTo(gate.left, gate.y - 9);
      ctx.moveTo(gate.right, gate.y - 9);
      ctx.lineTo(970, gate.y - 9);
      ctx.moveTo(30, gate.y + 9);
      ctx.lineTo(gate.left, gate.y + 9);
      ctx.moveTo(gate.right, gate.y + 9);
      ctx.lineTo(970, gate.y + 9);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 191, 105, ${pulse * 0.32})`;
      ctx.lineWidth = 1;
      for (let x = 44; x < 950; x += 20) {
        if (x > gate.left - 14 && x < gate.right + 14) continue;
        ctx.beginPath();
        ctx.moveTo(x, gate.y - 7);
        ctx.lineTo(x + 8, gate.y + 7);
        ctx.stroke();
      }

      this.drawGatePylon(gate.left, gate.y, gateColor, gate.label, index, state);
      this.drawGatePylon(gate.right, gate.y, gateColor, gate.label, index, state);

      ctx.strokeStyle = bothPassed
        ? "rgba(143, 227, 136, 0.36)"
        : "rgba(255, 191, 105, 0.2)";
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(gate.left + 12, gate.y);
      ctx.lineTo(gate.right - 12, gate.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = bothPassed ? COLORS.green : "rgba(255, 191, 105, 0.66)";
      ctx.font = "700 9px 'Courier New', 'Noto Sans SC Variable', monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        bothPassed ? `GATE ${gate.label} CLEAR` : `GATE ${gate.label} / 双车感应`,
        (gate.left + gate.right) / 2,
        gate.y - 19
      );
      ctx.restore();
    });
  }

  drawGatePylon(x, y, color, label, gateIndex, state) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(4, 12, 16, 0.96)";
    roundedRect(ctx, -8, -17, 16, 34, 4);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(-4, -13, 8, 3);
    ctx.fillRect(-4, 10, 8, 3);

    const passed = state.cars.map((car) => car.gates[gateIndex]);
    ctx.fillStyle = "rgba(4, 12, 16, 0.9)";
    roundedRect(ctx, -20, 20, 40, 14, 4);
    ctx.fill();
    ctx.font = "700 7px 'Courier New', 'Noto Sans SC Variable', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(183, 210, 210, 0.7)";
    ctx.fillText(label, 0, 29);
    ctx.fillStyle = passed[0] ? COLORS.cyan : "rgba(117, 148, 154, 0.4)";
    ctx.beginPath();
    ctx.arc(-7, 39, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = passed[1] ? COLORS.amber : "rgba(117, 148, 154, 0.4)";
    ctx.beginPath();
    ctx.arc(7, 39, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawFinish(state, view) {
    const ctx = this.ctx;
    const y = WORLD.finishY;
    ctx.save();
    const successGlow = state.success ? 0.12 : 0.025;
    const zone = ctx.createLinearGradient(0, WORLD.top, 0, y);
    zone.addColorStop(0, `rgba(143, 227, 136, ${successGlow * 1.5})`);
    zone.addColorStop(1, "rgba(143, 227, 136, 0)");
    ctx.fillStyle = zone;
    ctx.fillRect(31, WORLD.top + 1, 938, y - WORLD.top);

    const size = 13;
    for (let x = 40, index = 0; x < 960; x += size, index += 1) {
      ctx.fillStyle = index % 2 === 0 ? "rgba(207, 234, 227, 0.74)" : "rgba(7, 18, 24, 0.9)";
      ctx.fillRect(x, y - 7, size, 7);
      ctx.fillStyle = index % 2 === 0 ? "rgba(7, 18, 24, 0.9)" : "rgba(207, 234, 227, 0.74)";
      ctx.fillRect(x, y, size, 7);
    }

    ctx.fillStyle = state.success ? COLORS.green : "rgba(143, 227, 136, 0.64)";
    ctx.font = "700 9px 'Courier New', 'Noto Sans SC Variable', monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      state.success ? "FINISH / COMPLETE" : "FINISH / 双车抵达",
      WORLD.width / 2,
      y + 24
    );

    if (view.mode === "replay") {
      ctx.fillStyle = "rgba(255, 191, 105, 0.76)";
      ctx.font = "700 8px 'Courier New', 'Noto Sans SC Variable', monospace";
      ctx.textAlign = "right";
      ctx.fillText("REPLAY", 952, WORLD.top + 22);
    }
    ctx.restore();
  }

  drawCable(state) {
    const ctx = this.ctx;
    const [carA, carB] = state.cars;
    const ax = carA.x;
    const ay = carA.y;
    const bx = carB.x;
    const by = carB.y;
    const dx = bx - ax;
    const dy = by - ay;
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    let nx = -dy / distance;
    let ny = dx / distance;
    if (ny < 0) {
      nx *= -1;
      ny *= -1;
    }
    const slack = Math.max(0, state.cable.slack);
    const sag = 5 + Math.min(76, slack * 0.34);
    const mx = (ax + bx) / 2 + nx * sag;
    const my = (ay + by) / 2 + ny * sag;
    const tensionRatio = Math.min(1, state.cable.tension / 1450);
    const hot = state.cable.tension > 850;
    const cableColor = hot ? COLORS.red : COLORS.cyan;
    const segments = 28;

    ctx.save();
    ctx.lineCap = "round";
    ctx.shadowColor = hot ? "rgba(255, 110, 98, 0.55)" : "rgba(98, 234, 216, 0.42)";
    ctx.shadowBlur = hot ? 15 : 9;
    ctx.strokeStyle = "rgba(4, 10, 13, 0.92)";
    ctx.lineWidth = 7;
    this.strokeCableCurve(ax, ay, mx, my, bx, by, segments);

    for (let index = 0; index < segments; index += 1) {
      const p0 = this.cablePoint(ax, ay, mx, my, bx, by, index / segments);
      const p1 = this.cablePoint(ax, ay, mx, my, bx, by, (index + 1) / segments);
      const progress = index / segments;
      ctx.strokeStyle = hot
        ? `rgba(255, ${Math.round(165 - progress * 60)}, ${Math.round(105 - progress * 35)}, ${0.72 + tensionRatio * 0.28})`
        : `rgba(98, 234, 216, ${0.58 + tensionRatio * 0.25})`;
      ctx.lineWidth = 2.4 + tensionRatio * 1.3;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    this.drawTensionTicks(ax, ay, mx, my, bx, by, state.cable.tension, state.step);

    const flowCount = 4;
    for (let index = 0; index < flowCount; index += 1) {
      if (state.cable.tension < 120) break;
      const progress = ((state.elapsed * (0.35 + tensionRatio * 0.6) + index / flowCount) % 1);
      const point = this.cablePoint(ax, ay, mx, my, bx, by, progress);
      ctx.fillStyle = hot ? "rgba(255, 191, 105, 0.72)" : "rgba(143, 239, 222, 0.55)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = cableColor;
    for (const [x, y] of [[ax, ay], [bx, by]]) {
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.cable.stretch > 28) {
      const tx = (ax + bx) / 2 + nx * 12;
      const ty = (ay + by) / 2 + ny * 12;
      ctx.fillStyle = hot ? COLORS.red : COLORS.amber;
      ctx.font = "700 8px 'Courier New', 'Noto Sans SC Variable', monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${state.cable.stretch.toFixed(0)}px 形变`, tx, ty);
    }
    ctx.restore();
  }

  cablePoint(ax, ay, mx, my, bx, by, t) {
    const inverse = 1 - t;
    return {
      x: inverse * inverse * ax + 2 * inverse * t * mx + t * t * bx,
      y: inverse * inverse * ay + 2 * inverse * t * my + t * t * by
    };
  }

  strokeCableCurve(ax, ay, mx, my, bx, by, segments) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let index = 0; index <= segments; index += 1) {
      const point = this.cablePoint(ax, ay, mx, my, bx, by, index / segments);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }

  drawTensionTicks(ax, ay, mx, my, bx, by, tension, step) {
    if (tension < 130) return;
    const ctx = this.ctx;
    const count = Math.min(16, Math.floor(tension / 85));
    const length = Math.min(9, 2 + tension / 240);
    for (let index = 1; index < count; index += 1) {
      const t = index / count;
      const point = this.cablePoint(ax, ay, mx, my, bx, by, t);
      const before = this.cablePoint(ax, ay, mx, my, bx, by, Math.max(0, t - 0.002));
      const after = this.cablePoint(ax, ay, mx, my, bx, by, Math.min(1, t + 0.002));
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const length2 = Math.hypot(dx, dy) || 1;
      const nx = -dy / length2;
      const ny = dx / length2;
      const pulse = 0.4 + 0.25 * Math.sin(step * 0.18 + index);
      ctx.strokeStyle = tension > 850
        ? `rgba(255, 110, 98, ${pulse})`
        : `rgba(255, 191, 105, ${pulse * 0.6})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(point.x - nx * length, point.y - ny * length);
      ctx.lineTo(point.x + nx * length, point.y + ny * length);
      ctx.stroke();
    }
  }

  drawCar(car, index, state) {
    const ctx = this.ctx;
    const color = index === 0 ? COLORS.cyan : COLORS.amber;
    const deep = index === 0 ? COLORS.cyanDeep : COLORS.amberDeep;
    const isAnchored = index === 1 && state.cars[1].anchor;

    ctx.save();
    ctx.translate(car.x, car.y);

    if (isAnchored) {
      const pulse = 22 + Math.sin(state.elapsed * 6) * 3;
      ctx.strokeStyle = "rgba(255, 191, 105, 0.27)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const angle = (spoke / 6) * Math.PI * 2 + state.elapsed;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * 20, Math.sin(angle) * 20);
        ctx.lineTo(Math.cos(angle) * 27, Math.sin(angle) * 27);
        ctx.stroke();
      }
    }

    ctx.rotate(car.angle + Math.PI / 2);
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    roundedRect(ctx, -21, -27, 42, 54, 11);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = "#040b0f";
    roundedRect(ctx, -23, -19, 7, 14, 3);
    ctx.fill();
    roundedRect(ctx, 16, -19, 7, 14, 3);
    ctx.fill();
    roundedRect(ctx, -23, 7, 7, 14, 3);
    ctx.fill();
    roundedRect(ctx, 16, 7, 7, 14, 3);
    ctx.fill();

    const body = ctx.createLinearGradient(-20, -24, 20, 24);
    body.addColorStop(0, "#1d343a");
    body.addColorStop(0.46, "#13262d");
    body.addColorStop(1, "#0a161c");
    ctx.fillStyle = body;
    roundedRect(ctx, -18, -25, 36, 50, 8);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.84;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = deep;
    ctx.globalAlpha = 0.44;
    roundedRect(ctx, -12, -20, 24, 11, 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(194, 238, 233, 0.34)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(10, -4);
    ctx.stroke();

    ctx.fillStyle = "rgba(3, 9, 12, 0.75)";
    roundedRect(ctx, -11, -15, 22, 12, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.34;
    ctx.fillRect(-9, -13, 18, 2);
    ctx.globalAlpha = 1;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 17, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    ctx.fillRect(-7, 21, 14, 2);
    ctx.shadowBlur = 0;

    ctx.strokeStyle = index === 0 ? "rgba(98,234,216,0.7)" : "rgba(255,191,105,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, -21, 3, Math.PI, Math.PI * 2);
    ctx.stroke();

    if (car.damage > 12) {
      ctx.strokeStyle = "rgba(255, 110, 98, 0.72)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-12, 1);
      ctx.lineTo(-7, 4);
      ctx.lineTo(-9, 8);
      ctx.moveTo(11, -7);
      ctx.lineTo(6, -4);
      ctx.lineTo(9, 0);
      ctx.stroke();
    }
    ctx.restore();

    this.drawCarLabel(car, index, color, isAnchored, state);
  }

  drawCarLabel(car, index, color, anchored, state) {
    const ctx = this.ctx;
    const offsetY = index === 0 ? 42 : -42;
    const x = car.x;
    const y = car.y + offsetY;
    ctx.save();
    ctx.fillStyle = "rgba(4, 12, 16, 0.78)";
    roundedRect(ctx, x - 32, y - 9, 64, 18, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(139, 202, 209, 0.13)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "700 8px 'Courier New', 'Noto Sans SC Variable', monospace";
    ctx.textAlign = "center";
    const status = anchored ? "ANCHOR" : car.finished ? "FINISH" : `P${index + 1}`;
    ctx.fillText(`${index === 0 ? "A" : "B"} / ${status}`, x, y + 3);
    ctx.restore();

    if (state.cars[index].finished) {
      ctx.save();
      ctx.strokeStyle = "rgba(143, 227, 136, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(car.x, car.y, 31 + Math.sin(state.elapsed * 4) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawStressParticles(state) {
    if (state.cable.tension < 720) return;
    const ctx = this.ctx;
    const [a, b] = state.cars;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const intensity = Math.min(1, (state.cable.tension - 720) / 800);
    ctx.save();
    for (let index = 0; index < 12; index += 1) {
      const phase = state.step * (0.045 + index * 0.003) + index * 1.71;
      const radius = 7 + ((index * 13 + state.step * 0.7) % 28);
      const x = mx + Math.cos(phase) * radius;
      const y = my + Math.sin(phase * 1.4) * radius * 0.6;
      ctx.fillStyle = index % 3 === 0
        ? `rgba(255, 191, 105, ${intensity * 0.6})`
        : `rgba(255, 110, 98, ${intensity * 0.4})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.restore();
  }
}
