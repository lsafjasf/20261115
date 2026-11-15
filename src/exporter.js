import {
  LEVEL_META,
  SAMPLE_STEP,
  WORLD_SIZE,
  colorAt,
  heightAt
} from "./terrain.js";

const GRID_STEPS = WORLD_SIZE / SAMPLE_STEP;
let cachedHeightGrid = null;

function getHeightGrid() {
  if (cachedHeightGrid) return cachedHeightGrid;
  const size = GRID_STEPS + 1;
  const values = new Float32Array(size * size);
  for (let iz = 0; iz < size; iz += 1) {
    const z = iz * SAMPLE_STEP - WORLD_SIZE * 0.5;
    for (let ix = 0; ix < size; ix += 1) {
      const x = ix * SAMPLE_STEP - WORLD_SIZE * 0.5;
      values[iz * size + ix] = heightAt(x, z);
    }
  }
  cachedHeightGrid = { size, values };
  return cachedHeightGrid;
}

function sampleBilinear(grid, u, v) {
  const px = u * GRID_STEPS;
  const pz = v * GRID_STEPS;
  const x0 = Math.max(0, Math.min(GRID_STEPS - 1, Math.floor(px)));
  const z0 = Math.max(0, Math.min(GRID_STEPS - 1, Math.floor(pz)));
  const tx = Math.min(1, Math.max(0, px - x0));
  const tz = Math.min(1, Math.max(0, pz - z0));
  const a = grid.values[z0 * grid.size + x0];
  const b = grid.values[z0 * grid.size + x0 + 1];
  const c = grid.values[(z0 + 1) * grid.size + x0];
  const d = grid.values[(z0 + 1) * grid.size + x0 + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

function renderTerrain(level, size) {
  const grid = getHeightGrid();
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const image = context.createImageData(size, size);
  const rgba = image.data;
  const lightX = -0.74;
  const lightZ = 0.67;
  const lightY = 0.72;

  for (let py = 0; py < size; py += 1) {
    const v = py / (size - 1);
    const z = v * WORLD_SIZE - WORLD_SIZE * 0.5;
    for (let px = 0; px < size; px += 1) {
      const u = px / (size - 1);
      const x = u * WORLD_SIZE - WORLD_SIZE * 0.5;
      const h = sampleBilinear(grid, u, v);
      const hx =
        sampleBilinear(grid, Math.min(1, u + 1 / GRID_STEPS), v) -
        sampleBilinear(grid, Math.max(0, u - 1 / GRID_STEPS), v);
      const hz =
        sampleBilinear(grid, u, Math.min(1, v + 1 / GRID_STEPS)) -
        sampleBilinear(grid, u, Math.max(0, v - 1 / GRID_STEPS));
      const slope = Math.sqrt(hx * hx + hz * hz) / (SAMPLE_STEP * 2);
      const [r, g, b] = colorAt(x, z, h, slope);
      const normalLength = Math.sqrt(hx * hx + hz * hz + SAMPLE_STEP * SAMPLE_STEP);
      const shade =
        0.76 +
        Math.max(
          0,
          ((-hx / normalLength) * lightX +
            (SAMPLE_STEP / normalLength) * lightY +
            (-hz / normalLength) * lightZ) *
            0.3
        );
      const offset = (py * size + px) * 4;
      rgba[offset] = Math.min(255, r * shade);
      rgba[offset + 1] = Math.min(255, g * shade);
      rgba[offset + 2] = Math.min(255, b * shade);
      rgba[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function drawTileGrid(context, level, size, offsetY) {
  const step = size / level.grid;
  context.save();
  context.translate(0, offsetY);
  context.strokeStyle = "rgba(213, 241, 221, 0.31)";
  context.lineWidth = 1;
  for (let i = 0; i <= level.grid; i += 1) {
    const p = Math.round(i * step) + 0.5;
    context.beginPath();
    context.moveTo(p, 0);
    context.lineTo(p, size);
    context.stroke();
    context.beginPath();
    context.moveTo(0, p);
    context.lineTo(size, p);
    context.stroke();
  }

  if (step >= 72) {
    context.fillStyle = "rgba(9, 15, 13, 0.68)";
    context.font = "10px SFMono-Regular, Consolas, monospace";
    for (let z = 0; z < level.grid; z += 1) {
      for (let x = 0; x < level.grid; x += 1) {
        const label = `${level.label}:${x}:${z}`;
        const width = context.measureText(label).width + 8;
        context.fillRect(x * step + 6, z * step + 6, width, 16);
        context.fillStyle = "rgba(222, 234, 220, 0.72)";
        context.fillText(label, x * step + 10, z * step + 17);
        context.fillStyle = "rgba(9, 15, 13, 0.68)";
      }
    }
  }
  context.restore();
}

function drawHeader(context, width, level) {
  const pad = 22;
  context.save();
  context.fillStyle = "#0b1110";
  context.fillRect(0, 0, width, 42);
  context.fillStyle = "#e9e6db";
  context.font = "600 12px SFMono-Regular, Consolas, monospace";
  context.fillText(
    `${level.label} / ${level.grid}×${level.grid} / ${level.totalTiles} TILES`,
    pad,
    26
  );
  context.textAlign = "right";
  context.fillStyle = "rgba(170, 180, 168, 0.85)";
  context.font = "9px SFMono-Regular, Consolas, monospace";
  context.fillText(
    `WORLD ${WORLD_SIZE}M · SAMPLE ${SAMPLE_STEP}M · EPSG-LOCAL`,
    width - pad,
    26
  );
  context.strokeStyle = "rgba(220, 232, 218, 0.22)";
  context.beginPath();
  context.moveTo(0, 42.5);
  context.lineTo(width, 42.5);
  context.stroke();
  context.restore();
}

function drawFooter(context, width, height, size) {
  const pad = 22;
  const top = size + 42;
  context.save();
  context.fillStyle = "#0b1110";
  context.fillRect(0, top, width, height - top);
  context.strokeStyle = "rgba(220, 232, 218, 0.22)";
  context.beginPath();
  context.moveTo(0, top + 0.5);
  context.lineTo(width, top + 0.5);
  context.stroke();
  const legend = context.createLinearGradient(pad + 14, 0, pad + 244, 0);
  legend.addColorStop(0, "rgb(22, 49, 56)");
  legend.addColorStop(0.28, "rgb(57, 96, 64)");
  legend.addColorStop(0.62, "rgb(139, 123, 71)");
  legend.addColorStop(0.84, "rgb(143, 116, 103)");
  legend.addColorStop(1, "rgb(237, 236, 225)");
  context.fillStyle = legend;
  context.fillRect(pad, top + 19, 280, 6);
  context.fillStyle = "rgba(170, 180, 168, 0.75)";
  context.font = "8px SFMono-Regular, Consolas, monospace";
  context.fillText("-90 M", pad, top + 35);
  context.textAlign = "right";
  context.fillText("+210 M", pad + 280, top + 35);
  context.textAlign = "left";
  context.fillStyle = "rgba(235, 232, 221, 0.78)";
  context.font = "600 10px SFMono-Regular, Consolas, monospace";
  context.fillText("ABSOLUTE HYPSOMETRIC RAMP", pad, top + 55);

  const scaleWidth = width > 1000 ? 136 : 100;
  const scaleX = width - pad - scaleWidth;
  context.fillStyle = "rgba(235, 232, 221, 0.74)";
  context.font = "9px SFMono-Regular, Consolas, monospace";
  context.textAlign = "left";
  context.fillText("SEAMLESS EDGE SAMPLES", scaleX, top + 22);
  context.font = "9px SFMono-Regular, Consolas, monospace";
  context.fillStyle = "rgba(170, 180, 168, 0.7)";
  context.font = "8px SFMono-Regular, Consolas, monospace";
  context.fillText("TERRAIN / LOD ATLAS", scaleX, top + 37);
  context.strokeStyle = "rgba(220, 232, 218, 0.3)";
  context.beginPath();
  context.moveTo(scaleX, top + 52);
  context.lineTo(scaleX + scaleWidth, top + 52);
  context.stroke();
  context.fillStyle = "rgba(235, 232, 221, 0.8)";
  context.font = "8px SFMono-Regular, Consolas, monospace";
  context.fillText("0", scaleX, top + 63);
  context.textAlign = "right";
  context.fillText(`${WORLD_SIZE} M`, scaleX + scaleWidth, top + 63);
  context.restore();
}

function drawFrame(context, width, height) {
  context.save();
  context.strokeStyle = "rgba(225, 187, 126, 0.7)";
  context.lineWidth = 2;
  const inset = 8;
  const length = 38;
  const points = [
    [inset, inset, 1, 1],
    [width - inset, inset, -1, 1],
    [width - inset, height - inset, -1, -1],
    [inset, height - inset, 1, -1]
  ];
  for (const [x, y, dx, dy] of points) {
    context.beginPath();
    context.moveTo(x + dx * length, y);
    context.lineTo(x, y);
    context.lineTo(x, y + dy * length);
    context.stroke();
  }
  context.restore();
}

export function renderLevelOverview(levelIndex) {
  const level = LEVEL_META[levelIndex];
  const size = Math.min(1500, Math.max(768, level.grid * 112));
  const headerHeight = 42;
  const footerHeight = 70;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size + headerHeight + footerHeight;
  const context = canvas.getContext("2d");
  const terrain = renderTerrain(level, size);
  context.fillStyle = "#0b1110";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(terrain, 0, headerHeight);
  drawTileGrid(context, level, size, headerHeight);
  drawHeader(context, size, level);
  drawFooter(context, size, canvas.height, size);
  drawFrame(context, canvas.width, canvas.height);
  return { canvas, size, level };
}

export async function exportLevelOverview(levelIndex) {
  const result = renderLevelOverview(levelIndex);
  const blob = await new Promise((resolve) =>
    result.canvas.toBlob(resolve, "image/png", 0.94)
  );
  if (!blob) throw new Error("PNG encoding failed");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `terrain-overview-L${levelIndex}-${result.size}px.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return {
    size: result.size,
    level: result.level,
    bytes: blob.size
  };
}
