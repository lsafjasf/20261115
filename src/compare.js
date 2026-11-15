import {
  HEIGHT_SCALE,
  analyzeTerrain,
  generateTerrain,
  hashSeed,
} from "./terrain.js";

const MAP_SIZE = 540;

const stops = [
  [0.0, [18, 43, 49]],
  [0.16, [41, 78, 76]],
  [0.34, [74, 105, 75]],
  [0.58, [118, 128, 82]],
  [0.78, [128, 127, 111]],
  [1.0, [218, 224, 214]],
];

function mixColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function terrainColor(height, seaLevel) {
  if (height < seaLevel) {
    const depth = Math.min(1, (seaLevel - height) / Math.max(0.12, 1 - seaLevel));
    return mixColor([72, 127, 128], [13, 53, 67], Math.pow(depth, 0.55));
  }
  const t = Math.min(1, (height - seaLevel) / Math.max(0.14, 1 - seaLevel));
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i][0]) {
      const start = stops[i - 1];
      const end = stops[i];
      return mixColor(start[1], end[1], (t - start[0]) / (end[0] - start[0]));
    }
  }
  return stops.at(-1)[1];
}

function fingerprint(heights) {
  let hash = 2166136261;
  for (let i = 0; i < heights.length; i += 37) {
    hash ^= Math.round(heights[i] * 100000);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function runSeedComparison(seedA, seedB, baseParams) {
  const a = generateTerrain({ ...baseParams, seed: seedA });
  const b = generateTerrain({ ...baseParams, seed: seedB });
  const statsA = analyzeTerrain(a.heights, a.grid, a.params.seaLevel);
  const statsB = analyzeTerrain(b.heights, b.grid, b.params.seaLevel);
  let difference = 0;
  for (let i = 0; i < a.heights.length; i += 1) {
    difference += Math.abs(a.heights[i] - b.heights[i]);
  }
  return {
    a: {
      seed: a.params.seed,
      terrain: a,
      stats: statsA,
      fingerprint: fingerprint(a.heights),
    },
    b: {
      seed: b.params.seed,
      terrain: b,
      stats: statsB,
      fingerprint: fingerprint(b.heights),
    },
    meanDifference: difference / a.heights.length,
  };
}

function drawMap(canvas, result) {
  const { terrain, stats } = result;
  const { heights, grid } = terrain;
  const seaLevel = terrain.params.seaLevel;
  const source = document.createElement("canvas");
  source.width = grid;
  source.height = grid;
  const sourceContext = source.getContext("2d");
  const image = sourceContext.createImageData(grid, grid);

  for (let z = 0; z < grid; z += 1) {
    for (let x = 0; x < grid; x += 1) {
      const index = z * grid + x;
      const left = heights[z * grid + Math.max(0, x - 1)];
      const right = heights[z * grid + Math.min(grid - 1, x + 1)];
      const top = heights[Math.max(0, z - 1) * grid + x];
      const bottom = heights[Math.min(grid - 1, z + 1) * grid + x];
      const shade = Math.max(0.66, Math.min(1.24, 1 + (left - right + top - bottom) * 4.2));
      const color = terrainColor(heights[index], seaLevel);
      const contour = Math.floor(heights[index] * 40) !== Math.floor(right * 40)
        || Math.floor(heights[index] * 40) !== Math.floor(bottom * 40);
      const edge = (heights[index] > seaLevel)
        && (left <= seaLevel || right <= seaLevel || top <= seaLevel || bottom <= seaLevel);
      const pixel = (z * grid + x) * 4;
      image.data[pixel] = Math.min(255, color[0] * shade * (edge ? 1.17 : 1) + (contour ? 5 : 0));
      image.data[pixel + 1] = Math.min(255, color[1] * shade * (edge ? 1.17 : 1) + (contour ? 5 : 0));
      image.data[pixel + 2] = Math.min(255, color[2] * shade * (edge ? 1.17 : 1) + (contour ? 5 : 0));
      image.data[pixel + 3] = 255;
    }
  }
  sourceContext.putImageData(image, 0, 0);

  const context = canvas.getContext("2d");
  context.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
  context.imageSmoothingEnabled = true;
  context.drawImage(source, 0, 0, MAP_SIZE, MAP_SIZE);

  const vignette = context.createRadialGradient(
    MAP_SIZE / 2,
    MAP_SIZE / 2,
    MAP_SIZE * 0.25,
    MAP_SIZE / 2,
    MAP_SIZE / 2,
    MAP_SIZE * 0.74,
  );
  vignette.addColorStop(0, "rgba(3, 10, 11, 0)");
  vignette.addColorStop(1, "rgba(3, 10, 11, 0.4)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

  const peakX = (stats.highestX / (grid - 1)) * MAP_SIZE;
  const peakY = (stats.highestZ / (grid - 1)) * MAP_SIZE;
  context.strokeStyle = "rgba(231, 255, 133, 0.95)";
  context.fillStyle = "rgba(231, 255, 133, 0.95)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(peakX, peakY, 13, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(peakX, peakY, 3.5, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(peakX - 20, peakY);
  context.lineTo(peakX - 15, peakY);
  context.moveTo(peakX + 15, peakY);
  context.lineTo(peakX + 20, peakY);
  context.stroke();

  context.fillStyle = "rgba(230, 243, 235, 0.82)";
  context.font = '500 11px "Ubuntu Mono", monospace';
  context.fillText("PEAK", peakX + 18, peakY - 15);
  context.fillStyle = "rgba(143, 169, 163, 0.68)";
  context.font = '400 8px "Ubuntu Mono", monospace';
  context.fillText(
    `${Math.round(stats.peakElevation)} M`,
    peakX + 18,
    peakY - 3,
  );

  context.strokeStyle = "rgba(209, 232, 224, 0.16)";
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, MAP_SIZE - 1, MAP_SIZE - 1);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

export function renderComparison(comparison) {
  drawMap(document.getElementById("compare-canvas-a"), comparison.a);
  drawMap(document.getElementById("compare-canvas-b"), comparison.b);
  setText("compare-name-a", comparison.a.seed);
  setText("compare-name-b", comparison.b.seed);
  setText("compare-peak-a", `${Math.round(comparison.a.stats.peakElevation)} m`);
  setText("compare-peak-b", `${Math.round(comparison.b.stats.peakElevation)} m`);
  setText("compare-land-a", `${comparison.a.stats.landAreaKm2.toFixed(2)} km²`);
  setText("compare-land-b", `${comparison.b.stats.landAreaKm2.toFixed(2)} km²`);
  setText("compare-share-a", `${comparison.a.stats.landPercent.toFixed(1)}%`);
  setText("compare-share-b", `${comparison.b.stats.landPercent.toFixed(1)}%`);
  setText("compare-mean-a", `${Math.round(comparison.a.stats.meanHeight * HEIGHT_SCALE)} m`);
  setText("compare-mean-b", `${Math.round(comparison.b.stats.meanHeight * HEIGHT_SCALE)} m`);

  const peakDelta = comparison.b.stats.peakElevation - comparison.a.stats.peakElevation;
  const areaDelta = comparison.b.stats.landAreaKm2 - comparison.a.stats.landAreaKm2;
  const direction = peakDelta >= 0 ? "高" : "低";
  const areaDirection = areaDelta >= 0 ? "多" : "少";
  setText(
    "compare-summary",
    `Seed B 的最高峰比 A ${direction} ${Math.abs(Math.round(peakDelta))} m，陆地${areaDirection} `
      + `${Math.abs(areaDelta).toFixed(2)} km²；高度场平均差异 ${comparison.meanDifference.toFixed(3)}。`
      + ` 指纹 A:${comparison.a.fingerprint} / B:${comparison.b.fingerprint}`,
  );
}

export function seedSignature(seed) {
  return hashSeed(seed).toString(16).padStart(8, "0");
}
