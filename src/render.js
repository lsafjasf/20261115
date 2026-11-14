import { ROWS, SIM, getCycle, getLighting } from "./sim.js";

export const VIEW = Object.freeze({
  width: 1180,
  height: 590,
  left: 76,
  right: 1104,
  floorY: 506,
  benchY: 407,
  roofPeakY: 28,
  roofEdgeY: 142,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const FONT = '"Greenhouse Sans", "Avenir Next", "PingFang SC", sans-serif';
const mapX = (x) => VIEW.left + (x / SIM.rackMax) * (VIEW.right - VIEW.left);
const mapRackY = (height) => 320 - height * 180;

function rounded(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function tempColor(temp) {
  if (temp >= 44) return "#ff7768";
  if (temp >= 40) return "#ffc75d";
  return "#a9d9a7";
}

function drawBackground(ctx, sim) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW.height);
  sky.addColorStop(0, "#314743");
  sky.addColorStop(0.58, "#263a34");
  sky.addColorStop(1, "#1b2923");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);

  const glow = ctx.createRadialGradient(690, 50, 10, 690, 50, 500);
  glow.addColorStop(0, "rgba(195, 218, 190, 0.2)");
  glow.addColorStop(1, "rgba(195, 218, 190, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, VIEW.width, 430);

  ctx.fillStyle = "rgba(209, 225, 211, 0.07)";
  for (const [x, y, rx, ry] of [
    [150, 76, 90, 25],
    [238, 67, 65, 23],
    [750, 55, 120, 28],
    [836, 68, 72, 19],
    [1010, 91, 95, 21],
  ]) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const wall = ctx.createLinearGradient(0, 120, 0, VIEW.floorY);
  wall.addColorStop(0, "rgba(54, 79, 68, 0.76)");
  wall.addColorStop(0.68, "rgba(31, 51, 42, 0.92)");
  wall.addColorStop(1, "#21362c");
  ctx.fillStyle = wall;
  ctx.fillRect(44, 135, 1092, VIEW.floorY - 135);

  ctx.save();
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = "#cbe2c8";
  ctx.lineWidth = 1;
  for (let x = 72; x < 1110; x += 52) {
    ctx.beginPath();
    ctx.moveTo(x, 140);
    ctx.lineTo(x, VIEW.floorY);
    ctx.stroke();
  }
  ctx.restore();

  const floor = ctx.createLinearGradient(0, VIEW.floorY - 20, 0, VIEW.height);
  floor.addColorStop(0, "#314237");
  floor.addColorStop(1, "#1a2821");
  ctx.fillStyle = floor;
  ctx.fillRect(0, VIEW.floorY - 20, VIEW.width, VIEW.height - VIEW.floorY + 20);

  ctx.strokeStyle = "rgba(205, 227, 196, 0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(44, VIEW.floorY - 20);
  ctx.lineTo(1136, VIEW.floorY - 20);
  ctx.stroke();

  const mist = ctx.createLinearGradient(0, 420, 0, 508);
  mist.addColorStop(0, "rgba(167, 200, 181, 0)");
  mist.addColorStop(1, "rgba(167, 200, 181, 0.06)");
  ctx.fillStyle = mist;
  ctx.fillRect(44, 420, 1092, 88);
  void sim;
}

function drawStructure(ctx) {
  const { left, right, roofPeakY, roofEdgeY, floorY } = VIEW;
  const peak = (left + right) / 2;

  ctx.save();
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#506e60";
  ctx.beginPath();
  ctx.moveTo(left, roofEdgeY);
  ctx.lineTo(peak, roofPeakY);
  ctx.lineTo(right, roofEdgeY);
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(181, 208, 192, 0.38)";
  for (let step = 0; step <= 6; step += 1) {
    const t = step / 6;
    const x = left + (right - left) * t;
    const y = step <= 3 ? roofEdgeY + (roofPeakY - roofEdgeY) * (t * 2) : roofPeakY + (roofEdgeY - roofPeakY) * ((t - 0.5) * 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (peak - x) * 0.03, y + 22);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(183, 209, 196, 0.26)";
  ctx.lineWidth = 1;
  for (const x of [left, peak, right]) {
    ctx.beginPath();
    ctx.moveTo(x, x === peak ? roofPeakY : roofEdgeY);
    ctx.lineTo(x, floorY - 18);
    ctx.stroke();
  }

  ctx.strokeStyle = "#466256";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(left, roofEdgeY);
  ctx.lineTo(left, floorY - 18);
  ctx.moveTo(right, roofEdgeY);
  ctx.lineTo(right, floorY - 18);
  ctx.stroke();

  ctx.strokeStyle = "rgba(191, 217, 199, 0.22)";
  ctx.lineWidth = 2;
  for (const y of [208, 316, 420]) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(218, 234, 216, 0.1)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(left + 12, roofEdgeY + 20);
  ctx.lineTo(peak, roofPeakY + 17);
  ctx.lineTo(right - 12, roofEdgeY + 20);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(10, 20, 15, 0.44)";
  ctx.fillRect(left + 3, VIEW.floorY - 20, right - left - 6, 13);
}

function drawLampLight(ctx, sim, rackY) {
  const cycle = getCycle(sim);
  const rackX = mapX(sim.control.rackX);
  const meter = (VIEW.right - VIEW.left) / SIM.rackMax;

  for (let index = 0; index < ROWS.length; index += 1) {
    const light = getLighting(sim, index);
    const rowX = mapX(ROWS[index].x);
    const halfWidth = Math.max(28, light.spread * meter * 1.1);
    const strength = clamp(light.coverage * sim.control.duty, 0, 1);
    if (!cycle.dark && strength > 0.03) {
      const beam = ctx.createLinearGradient(0, rackY, 0, VIEW.benchY);
      beam.addColorStop(0, `rgba(255, 219, 131, ${0.13 * strength})`);
      beam.addColorStop(0.72, `rgba(255, 226, 157, ${0.09 * strength})`);
      beam.addColorStop(1, "rgba(255, 226, 157, 0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(rackX - 46, rackY + 8);
      ctx.lineTo(rackX + 46, rackY + 8);
      ctx.lineTo(rowX + halfWidth, VIEW.benchY);
      ctx.lineTo(rowX - halfWidth, VIEW.benchY);
      ctx.closePath();
      ctx.fill();
    }

    if (!cycle.dark && light.coverage > 0.02) {
      const spot = ctx.createRadialGradient(
        rowX,
        VIEW.benchY - 8,
        4,
        rowX,
        VIEW.benchY - 8,
        halfWidth,
      );
      spot.addColorStop(0, `rgba(255, 247, 190, ${0.55 * strength})`);
      spot.addColorStop(0.5, `rgba(255, 213, 105, ${0.22 * strength})`);
      spot.addColorStop(1, "rgba(255, 203, 80, 0)");
      ctx.save();
      ctx.translate(0, 2);
      ctx.scale(1, 0.3);
      ctx.fillStyle = spot;
      ctx.beginPath();
      ctx.arc(rowX, (VIEW.benchY - 8) / 0.3, halfWidth, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (light.shadow > 0.12) {
      const shade = ctx.createLinearGradient(rowX - 100, 0, rowX + 100, 0);
      shade.addColorStop(0, "rgba(5, 14, 10, 0)");
      shade.addColorStop(0.5, `rgba(5, 14, 10, ${light.shadow * 0.4})`);
      shade.addColorStop(1, "rgba(5, 14, 10, 0)");
      ctx.fillStyle = shade;
      ctx.fillRect(rowX - 110, VIEW.benchY - 96, 220, 108);
    }
  }
}

function drawShadowBands(ctx, sim) {
  const rackX = mapX(sim.control.rackX);
  const reach = (1.08 / SIM.rackMax) * (VIEW.right - VIEW.left);
  const gradient = ctx.createLinearGradient(rackX - reach, 0, rackX + reach, 0);
  gradient.addColorStop(0, "rgba(3, 10, 7, 0)");
  gradient.addColorStop(0.32, "rgba(3, 10, 7, 0.2)");
  gradient.addColorStop(0.5, "rgba(3, 10, 7, 0.34)");
  gradient.addColorStop(0.68, "rgba(3, 10, 7, 0.2)");
  gradient.addColorStop(1, "rgba(3, 10, 7, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(rackX - 36, VIEW.benchY - 12);
  ctx.lineTo(rackX + 36, VIEW.benchY - 12);
  ctx.lineTo(rackX + reach, VIEW.floorY);
  ctx.lineTo(rackX - reach, VIEW.floorY);
  ctx.closePath();
  ctx.fill();
}

function drawBed(ctx, sim, rowIndex) {
  const row = ROWS[rowIndex];
  const state = sim.rows[rowIndex];
  const x = mapX(row.x);
  const width = 168;
  const trayTop = VIEW.benchY - 2;
  const trayBottom = VIEW.benchY + 37;

  ctx.save();
  ctx.fillStyle = "rgba(4, 12, 8, 0.28)";
  ctx.beginPath();
  ctx.ellipse(x, VIEW.floorY - 13, width * 0.62, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#3c5142";
  ctx.fillRect(x - width / 2 + 18, trayBottom, 9, 44);
  ctx.fillRect(x + width / 2 - 27, trayBottom, 9, 44);
  ctx.fillStyle = "#54705d";
  ctx.fillRect(x - width / 2, trayTop, width, 7);
  ctx.fillStyle = "#26382e";
  rounded(ctx, x - width / 2, trayTop + 5, width, 35, 5);
  ctx.fill();
  ctx.fillStyle = "#6b5540";
  rounded(ctx, x - width / 2 + 5, trayTop + 4, width - 10, 9, 4);
  ctx.fill();

  ctx.strokeStyle = "rgba(192, 219, 184, 0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - width / 2 + 8, trayTop + 21);
  ctx.lineTo(x + width / 2 - 8, trayTop + 21);
  ctx.stroke();
  ctx.restore();

  const plantBase = VIEW.benchY - 17;
  for (let plant = 0; plant < 6; plant += 1) {
    const plantX = x - 63 + plant * 25;
    const lean = Math.sin(plant * 2.7 + rowIndex) * 4;
    drawPlant(ctx, plantX, plantBase, rowIndex, plant, lean, state);
  }

  drawGrowthBar(ctx, sim, rowIndex, x);
}

function drawPlant(ctx, x, baseY, rowIndex, plantIndex, lean, state) {
  const growthScale = 0.48 + state.growth / 100;
  const height = (22 + Math.min(state.growth, 100) * 0.68) * (0.9 + plantIndex * 0.035);
  const topY = baseY - height;
  const burned = state.burned;
  const heat = clamp((state.temp - 38) / 7, 0, 1);
  const stemColor = burned ? "#514437" : heat > 0.55 ? "#8b9857" : "#6fa866";
  const leafColor = burned ? "#6b5947" : heat > 0.55 ? "#b2b969" : "#8ecb76";

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = stemColor;
  ctx.lineWidth = Math.max(2, growthScale * 2.5);
  ctx.beginPath();
  ctx.moveTo(x, baseY + 8);
  ctx.quadraticCurveTo(x + lean, baseY - height * 0.45, x + lean * 0.7, topY);
  ctx.stroke();

  const leafLevels = 3;
  for (let level = 0; level < leafLevels; level += 1) {
    const t = (level + 1) / (leafLevels + 0.4);
    const leafY = topY + height * t * 0.78;
    const leafX = x + lean * (1 - t) * 0.7;
    const spread = 10 + growthScale * 6 + level * 2;
    ctx.fillStyle = leafColor;
    ctx.globalAlpha = 0.82 + level * 0.05;
    ctx.beginPath();
    ctx.ellipse(leafX - spread * 0.62, leafY, spread, 4.5, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(leafX + spread * 0.62, leafY + 3, spread * 0.9, 4.2, 0.32, 0, Math.PI * 2);
    ctx.fill();
  }

  if (burned) {
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#362d22";
    ctx.beginPath();
    ctx.ellipse(x + lean * 0.6, topY + 3, 6, 10, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGrowthBar(ctx, sim, rowIndex, x) {
  const row = sim.rows[rowIndex];
  const barX = x - 76;
  const barY = 473;
  const barWidth = 152;
  ctx.save();
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = "rgba(232, 242, 220, 0.7)";
  ctx.fillText(`生长 ${Math.round(row.growth)}%`, barX, barY - 6);
  ctx.fillStyle = "rgba(235, 245, 222, 0.12)";
  rounded(ctx, barX, barY, barWidth, 7, 4);
  ctx.fill();
  const growthGradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
  growthGradient.addColorStop(0, row.burned ? "#89584c" : "#c8f27b");
  growthGradient.addColorStop(1, row.burned ? "#ff7768" : "#73c885");
  ctx.fillStyle = growthGradient;
  rounded(ctx, barX, barY, barWidth * (row.growth / 100), 7, 4);
  ctx.fill();

  ctx.fillStyle = tempColor(row.temp);
  ctx.beginPath();
  ctx.arc(barX + barWidth + 14, barY + 3.5, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `700 10px ${FONT}`;
  ctx.fillText(`${row.temp.toFixed(1)}°`, barX + barWidth + 22, barY + 7);

  ctx.font = `800 11px ${FONT}`;
  ctx.fillStyle = row.burned ? "#ff7768" : "#e7f0d5";
  ctx.fillText(`${row.id} · ${row.name}`, barX, barY + 30);
  ctx.restore();
}

function drawRack(ctx, sim, rackY) {
  const x = mapX(sim.control.rackX);
  const cycle = getCycle(sim);
  const lampOn = !cycle.dark;
  const duty = sim.control.duty;

  ctx.save();
  ctx.strokeStyle = "rgba(154, 184, 168, 0.42)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(VIEW.left - 18, 94);
  ctx.lineTo(VIEW.right + 18, 94);
  ctx.stroke();
  ctx.strokeStyle = "rgba(207, 229, 213, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(VIEW.left - 18, 88);
  ctx.lineTo(VIEW.right + 18, 88);
  ctx.stroke();
  for (let railX = VIEW.left + 20; railX < VIEW.right; railX += 220) {
    ctx.strokeStyle = "rgba(174, 202, 186, 0.24)";
    ctx.beginPath();
    ctx.moveTo(railX, 94);
    ctx.lineTo(railX + 16, 141);
    ctx.stroke();
  }

  ctx.fillStyle = "#718b7b";
  rounded(ctx, x - 37, 83, 74, 18, 5);
  ctx.fill();
  ctx.fillStyle = "#24372e";
  ctx.beginPath();
  ctx.arc(x - 23, 103, 7, 0, Math.PI * 2);
  ctx.arc(x + 23, 103, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#a3bdaa";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 33, 92);
  ctx.lineTo(x - 33, rackY - 31);
  ctx.moveTo(x + 33, 92);
  ctx.lineTo(x + 33, rackY - 31);
  ctx.stroke();

  if (lampOn) {
    const halo = ctx.createRadialGradient(x, rackY, 5, x, rackY, 120);
    halo.addColorStop(0, `rgba(255, 234, 158, ${0.22 * duty})`);
    halo.addColorStop(0.45, `rgba(255, 215, 108, ${0.08 * duty})`);
    halo.addColorStop(1, "rgba(255, 206, 93, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, rackY, 120, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#17251f";
  ctx.beginPath();
  ctx.moveTo(x - 70, rackY - 35);
  ctx.lineTo(x + 70, rackY - 35);
  ctx.lineTo(x + 84, rackY - 18);
  ctx.lineTo(x - 84, rackY - 18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = lampOn ? "rgba(255, 221, 139, 0.72)" : "rgba(150, 170, 156, 0.3)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#34483d";
  rounded(ctx, x - 88, rackY - 21, 176, 19, 5);
  ctx.fill();

  for (let bulb = -1; bulb <= 1; bulb += 1) {
    const bulbX = x + bulb * 48;
    ctx.fillStyle = lampOn ? "#ffe099" : "#59675d";
    ctx.shadowColor = lampOn ? "rgba(255, 216, 118, 0.9)" : "transparent";
    ctx.shadowBlur = lampOn ? 17 : 0;
    rounded(ctx, bulbX - 24, rackY - 8, 48, 6, 3);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = lampOn ? "#fff6cf" : "#28352e";
    ctx.fillRect(bulbX - 19, rackY - 3, 38, 12);
  }

  ctx.strokeStyle = "rgba(207, 227, 205, 0.26)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(x + 102, rackY);
  ctx.lineTo(x + 102, VIEW.benchY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(229, 240, 218, 0.68)";
  ctx.font = `600 10px ${FONT}`;
  ctx.fillText(`${Math.round(sim.control.height * 100)} cm`, x + 108, (rackY + VIEW.benchY) / 2);

  if (!lampOn) {
    ctx.fillStyle = "rgba(16, 31, 24, 0.9)";
    rounded(ctx, x - 42, rackY - 53, 84, 19, 9);
    ctx.fill();
    ctx.fillStyle = "#9ec9c0";
    ctx.font = `700 9px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(`暗周期 ${Math.ceil(cycle.untilLight)}s`, x, rackY - 40);
    ctx.textAlign = "left";
  }

  drawHeatHaze(ctx, sim, x, rackY);
  ctx.restore();
}

function drawHeatHaze(ctx, sim, x, rackY) {
  const hottest = Math.max(...sim.rows.map((row) => row.temp));
  if (hottest < 40 || getCycle(sim).dark) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 163, 111, 0.18)";
  ctx.lineWidth = 1.3;
  const intensity = clamp((hottest - 40) / 5, 0, 1);
  for (let line = 0; line < 4; line += 1) {
    ctx.beginPath();
    for (let step = 0; step <= 12; step += 1) {
      const px = x - 60 + line * 34 + step * 4;
      const py =
        VIEW.benchY -
        26 -
        step * 6 +
        Math.sin(sim.time * 2.4 + step * 0.8 + line) * (1 + intensity * 2);
      if (step === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.globalAlpha = 0.3 + intensity * 0.4;
    ctx.stroke();
  }
  ctx.restore();

  void rackY;
}

function drawBedTags(ctx, sim) {
  const cycle = getCycle(sim);
  for (let index = 0; index < ROWS.length; index += 1) {
    const x = mapX(ROWS[index].x);
    const active = Math.abs(sim.control.rackX - ROWS[index].x) < 0.18;
    ctx.save();
    ctx.strokeStyle = active
      ? cycle.dark
        ? "rgba(158, 201, 192, 0.64)"
        : "rgba(200, 242, 123, 0.75)"
      : "rgba(206, 225, 208, 0.12)";
    ctx.lineWidth = active ? 1.5 : 1;
    ctx.setLineDash(active ? [6, 5] : [3, 7]);
    rounded(ctx, x - 91, VIEW.benchY - 96, 182, 102, 7);
    ctx.stroke();
    if (active) {
      ctx.fillStyle = cycle.dark ? "#9ec9c0" : "#c8f27b";
      rounded(ctx, x - 24, VIEW.benchY - 106, 48, 16, 8);
      ctx.fill();
      ctx.fillStyle = "#15231a";
      ctx.font = `800 9px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("补光位", x, VIEW.benchY - 95);
      ctx.textAlign = "left";
    }
    ctx.restore();
  }
}

function drawCornerLabels(ctx, sim) {
  const cycle = getCycle(sim);
  ctx.save();
  ctx.font = `700 9px ${FONT}`;
  ctx.fillStyle = "rgba(208, 225, 208, 0.42)";
  ctx.fillText("SECTION  B-02   /   OVERCAST", 66, 128);
  ctx.fillStyle = "rgba(208, 225, 208, 0.3)";
  ctx.fillText("拖拽灯架 · 观察叶温", 948, 128);
  ctx.fillStyle = cycle.dark ? "#9ec9c0" : "#ffd57a";
  rounded(ctx, 989, 551, 124, 24, 12);
  ctx.fill();
  ctx.fillStyle = "#17251d";
  ctx.font = `800 10px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(
    cycle.dark ? `暗周期 ${Math.ceil(cycle.untilLight)}s` : `补光中 · ${Math.round(sim.control.duty * 100)}%`,
    1051,
    567,
  );
  ctx.textAlign = "left";
  ctx.restore();
}

export function drawGreenhouse(ctx, sim) {
  ctx.clearRect(0, 0, VIEW.width, VIEW.height);
  drawBackground(ctx, sim);
  drawStructure(ctx);
  const rackY = mapRackY(sim.control.height);
  drawShadowBands(ctx, sim);
  drawLampLight(ctx, sim, rackY);
  for (let index = 0; index < ROWS.length; index += 1) drawBed(ctx, sim, index);
  drawRack(ctx, sim, rackY);
  drawBedTags(ctx, sim);
  drawCornerLabels(ctx, sim);
}
