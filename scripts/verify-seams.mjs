import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  SIZE,
  buildBrokenControl,
  generateTexture,
  repairAt,
  seamReport,
  tileTexture,
} from "../src/texture-engine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });

function encodePng(data, width, height) {
  const png = new PNG({ width, height, colorType: 6 });
  png.data = Buffer.from(data);
  return PNG.sync.write(png);
}

function writePng(name, data, width, height) {
  const file = path.join(artifacts, name);
  fs.writeFileSync(file, encodePng(data, width, height));
  return file;
}

function seamExtremes(data, size, axis) {
  const values = [];
  for (let i = 0; i < size; i += 1) {
    const a = axis === "x" ? (i * size) * 4 : i * 4;
    const b =
      axis === "x"
        ? (i * size + size - 1) * 4
        : ((size - 1) * size + i) * 4;
    values.push(
      (Math.abs(data[a] - data[b]) +
        Math.abs(data[a + 1] - data[b + 1]) +
        Math.abs(data[a + 2] - data[b + 2])) /
        3,
    );
  }
  return {
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function changedPixels(before, after) {
  let count = 0;
  for (let index = 0; index < before.length; index += 4) {
    if (
      before[index] !== after[index] ||
      before[index + 1] !== after[index + 1] ||
      before[index + 2] !== after[index + 2]
    ) {
      count += 1;
    }
  }
  return count;
}

function edgeProbeHits(before, after, size) {
  const probes = {
    left: false,
    right: false,
    top: false,
    bottom: false,
  };
  for (let i = 0; i < size; i += 1) {
    for (const [x, y] of [
      [0, i],
      [size - 1, i],
      [i, 0],
      [i, size - 1],
    ]) {
      const index = (y * size + x) * 4;
      if (
        before[index] !== after[index] ||
        before[index + 1] !== after[index + 1] ||
        before[index + 2] !== after[index + 2]
      ) {
        if (x === 0) probes.left = true;
        if (x === size - 1) probes.right = true;
        if (y === 0) probes.top = true;
        if (y === size - 1) probes.bottom = true;
      }
    }
  }
  return probes;
}

function runRetouchProbe(base, tool) {
  const target = new Uint8ClampedArray(base);
  const source = new Uint8ClampedArray(base);
  repairAt(target, SIZE, 8.37, 8.64, 24, {
    tool,
    source,
    angle: Math.PI * 0.25,
    strength: 0.95,
    seed: tool === "clone" ? 41 : 73,
  });
  repairAt(target, SIZE, SIZE - 8.41, SIZE - 8.13, 18, {
    tool,
    source,
    angle: Math.PI * 1.25,
    strength: 0.9,
    seed: tool === "clone" ? 43 : 79,
  });

  const probes = edgeProbeHits(base, target, SIZE);
  const report = seamReport(target, SIZE);
  return {
    changedPixels: changedPixels(base, target),
    edgeProbes: probes,
    allProbesHit: Object.values(probes).every(Boolean),
    seamRatioAfter: report.ratio,
    seamPassedAfter: report.passed,
  };
}

function buildMaterialReport(material) {
  const data = generateTexture({ material, size: SIZE, seed: 266 });
  const report = seamReport(data, SIZE);
  const broken = seamReport(buildBrokenControl(data, SIZE), SIZE);
  const tile = tileTexture(data, SIZE);
  const tileReport = seamReport(tile.data, tile.size);
  const imageFile = writePng(`${material}_512.png`, data, SIZE, SIZE);
  const tileFile = writePng(
    `${material}_512_tile2x2.png`,
    tile.data,
    tile.size,
    tile.size,
  );

  const heal = runRetouchProbe(data, "heal");
  const clone = runRetouchProbe(data, "clone");
  const negativeDetected = broken.ratio > report.ratio * 1.35;

  return {
    imageFile: path.basename(imageFile),
    tileFile: path.basename(tileFile),
    image: { width: SIZE, height: SIZE, colorType: "RGBA8" },
    seam: {
      vertical: seamExtremes(data, SIZE, "x"),
      horizontal: seamExtremes(data, SIZE, "y"),
    },
    secondDiff: {
      innerMean: report.innerSecondDiff,
      seamMean: report.seamSecondDiff,
      ratio: report.ratio,
      passed: report.passed,
    },
    tile: {
      width: tile.size,
      height: tile.size,
      ratio: tileReport.ratio,
      passed: tileReport.passed,
    },
    retouch: {
      heal,
      clone,
      allProbesHit: heal.allProbesHit && clone.allProbesHit,
      healEdgeMismatch: heal.seamPassedAfter ? 0 : 1,
      cloneEdgeMismatch: clone.seamPassedAfter ? 0 : 1,
    },
    negativeControlRatio: broken.ratio,
    negativeControlDetected: negativeDetected,
  };
}

const materials = {};
for (const material of ["stone", "fabric", "wood"]) {
  materials[material] = buildMaterialReport(material);
}

const allPassed = Object.values(materials).every(
  (entry) =>
    entry.secondDiff.passed &&
    entry.tile.passed &&
    entry.retouch.allProbesHit &&
    entry.retouch.healEdgeMismatch === 0 &&
    entry.retouch.cloneEdgeMismatch === 0 &&
    entry.negativeControlDetected,
);

const output = {
  generatedAt: new Date().toISOString(),
  method:
    "Integer-wave periodic sampling; 2x2 self-tiling; modulo-wrapped repair probes.",
  size: SIZE,
  allPassed,
  ...materials,
  negativeControl: {
    brokenRatio: materials.stone.negativeControlRatio,
    detected: materials.stone.negativeControlDetected,
  },
};

fs.writeFileSync(
  path.join(artifacts, "verification-report.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);

console.log(
  JSON.stringify(
    {
      allPassed,
      stone: {
        seamRatio: materials.stone.secondDiff.ratio.toFixed(3),
        tileRatio: materials.stone.tile.ratio.toFixed(3),
        retouch: materials.stone.retouch.allProbesHit,
      },
      fabric: {
        seamRatio: materials.fabric.secondDiff.ratio.toFixed(3),
        tileRatio: materials.fabric.tile.ratio.toFixed(3),
        retouch: materials.fabric.retouch.allProbesHit,
      },
      wood: {
        seamRatio: materials.wood.secondDiff.ratio.toFixed(3),
        tileRatio: materials.wood.tile.ratio.toFixed(3),
        retouch: materials.wood.retouch.allProbesHit,
      },
      negativeControl: output.negativeControl,
    },
    null,
    2,
  ),
);

if (!allPassed) process.exitCode = 1;
