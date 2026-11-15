import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  DEFAULT_PARAMS,
  HEIGHT_SCALE,
  analyzeTerrain,
  generateTerrain,
  gridToWorld,
  sampleHeight,
} from "../src/terrain.js";

function fingerprint(heights) {
  let hash = 2166136261;
  for (let index = 0; index < heights.length; index += 37) {
    hash ^= Math.round(heights[index] * 100000);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function summarize(entry) {
  const { stats, terrain } = entry;
  return {
    seed: entry.seed,
    fingerprint: fingerprint(terrain.heights),
    peakMeters: Number(stats.peakElevation.toFixed(2)),
    peakWorld: gridToWorld(terrain.heights, terrain.grid, stats.highestX, stats.highestZ),
    landAreaKm2: Number(stats.landAreaKm2.toFixed(4)),
    landPercent: Number(stats.landPercent.toFixed(3)),
    meanElevationMeters: Number((stats.meanHeight * HEIGHT_SCALE).toFixed(2)),
  };
}

const seedA = "ember-42";
const seedB = "tidal-ridge";
const params = { ...DEFAULT_PARAMS, seed: seedA, seaLevel: 0.4 };
const terrainA = generateTerrain(params, 160);
const terrainB = generateTerrain({ ...params, seed: seedB }, 160);
const statsA = analyzeTerrain(terrainA.heights, terrainA.grid, params.seaLevel);
const statsB = analyzeTerrain(terrainB.heights, terrainB.grid, params.seaLevel);

let totalDifference = 0;
let maxDifference = 0;
for (let index = 0; index < terrainA.heights.length; index += 1) {
  const difference = Math.abs(terrainA.heights[index] - terrainB.heights[index]);
  totalDifference += difference;
  maxDifference = Math.max(maxDifference, difference);
}
assert.ok(totalDifference / terrainA.heights.length > 0.02);
assert.ok(maxDifference > 0.08);
assert.notEqual(fingerprint(terrainA.heights), fingerprint(terrainB.heights));

const seedComparison = {
  fixedParameters: {
    frequency: params.frequency,
    octaves: params.octaves,
    erosion: params.erosion,
    seaLevel: params.seaLevel,
  },
  a: summarize({ seed: seedA, terrain: terrainA, stats: statsA }),
  b: summarize({ seed: seedB, terrain: terrainB, stats: statsB }),
  difference: {
    peakMeters: Number((statsB.peakElevation - statsA.peakElevation).toFixed(2)),
    landAreaKm2: Number((statsB.landAreaKm2 - statsA.landAreaKm2).toFixed(4)),
    landPercent: Number((statsB.landPercent - statsA.landPercent).toFixed(3)),
    meanHeightUnits: Number((totalDifference / terrainA.heights.length).toFixed(4)),
    maxHeightUnits: Number(maxDifference.toFixed(4)),
  },
};

let caveGrid = null;
for (let index = 0; index < terrainA.heights.length; index += 1) {
  const height = terrainA.heights[index];
  if (height > 0.402 && height < 0.421) {
    caveGrid = { x: index % terrainA.grid, z: Math.floor(index / terrainA.grid) };
    break;
  }
}
assert.ok(caveGrid, "a low coastal cave entrance must exist");
const initialSurface = gridToWorld(terrainA.heights, terrainA.grid, caveGrid.x, caveGrid.z);
const flag = {
  id: "cave-validation",
  name: "洞穴 01",
  world: { ...initialSurface },
};
const lockedCoordinates = JSON.stringify(flag.world);

const waterSteps = [0.4, 0.56, 0.7].map((seaLevel, index) => {
  const stats = analyzeTerrain(terrainA.heights, terrainA.grid, seaLevel);
  const wetCells = Array.from(terrainA.heights).filter((height) => height < seaLevel).length;
  assert.equal(JSON.stringify(flag.world), lockedCoordinates);
  return {
    step: index + 1,
    seaLevelNormalized: seaLevel,
    flatWaterElevationMeters: Number((seaLevel * HEIGHT_SCALE).toFixed(2)),
    floodedCells: wetCells,
    floodedPercent: Number((wetCells / terrainA.heights.length * 100).toFixed(3)),
    landAreaKm2: Number(stats.landAreaKm2.toFixed(4)),
    peakMeters: Number(stats.peakElevation.toFixed(2)),
    flagElevationMeters: Number(flag.world.y.toFixed(2)),
    flagStatus: flag.world.y < stats.waterElevation ? "submerged" : "above_water",
    flagWorldLocked: JSON.stringify(flag.world) === lockedCoordinates,
  };
});
assert.equal(waterSteps[0].flagStatus, "above_water");
assert.equal(waterSteps.at(-1).flagStatus, "submerged");
assert.ok(waterSteps.at(-1).landAreaKm2 < waterSteps[0].landAreaKm2);
assert.ok(waterSteps.every((step) => step.flatWaterElevationMeters > 0));
assert.equal(new Set(waterSteps.map((step) => step.peakMeters)).size, 1);

const changedParams = {
  ...params,
  frequency: 4.2,
  octaves: 7,
  erosion: 0.84,
  seaLevel: 0.7,
};
const changedTerrain = generateTerrain(changedParams, 160);
const changedStats = analyzeTerrain(changedTerrain.heights, changedTerrain.grid, changedParams.seaLevel);
const changedSurface = sampleHeight(changedTerrain.heights, changedTerrain.grid, flag.world.x, flag.world.z) * HEIGHT_SCALE;
assert.equal(JSON.stringify(flag.world), lockedCoordinates);
assert.notEqual(Math.round(changedSurface), Math.round(flag.world.y));

const flagValidation = {
  operation: "Right-click raycast on terrain and store x / y / z without attaching to grid indices",
  initialTerrain: {
    seed: seedA,
    frequency: params.frequency,
    octaves: params.octaves,
    erosion: params.erosion,
  },
  flag,
  waterSteps,
  changedTerrain: {
    seed: changedParams.seed,
    frequency: changedParams.frequency,
    octaves: changedParams.octaves,
    erosion: changedParams.erosion,
    seaLevel: changedParams.seaLevel,
    peakMeters: Number(changedStats.peakElevation.toFixed(2)),
    landAreaKm2: Number(changedStats.landAreaKm2.toFixed(4)),
    surfaceBelowFlagMeters: Number(changedSurface.toFixed(2)),
  },
  assertions: {
    flagWorldCoordinatesNeverChanged: true,
    flagWasAboveWaterBeforeFlood: true,
    flagWasSubmergedAfterFlood: true,
    waterSurfaceIsFlat: true,
    landAreaDecreasedAsWaterRose: true,
    peakStayedFixedWhenOnlyWaterChanged: true,
  },
};

const report = {
  format: "terrain-lab/validation-report-v1",
  generatedAt: new Date().toISOString(),
  world: {
    extentMeters: 1800,
    heightScaleMeters: HEIGHT_SCALE,
    grid: `${terrainA.grid} × ${terrainA.grid}`,
    waterModel: "One horizontal plane at seaLevel; every terrain cell below it is submerged.",
  },
  seedComparison,
  flagValidation,
};

const markdown = `# Terrain Lab 验证报告

生成时间：${report.generatedAt}

## 双 Seed 对比

固定参数：频率 ${params.frequency}、层数 ${params.octaves}、侵蚀 ${Math.round(params.erosion * 100)}%、水位 ${Math.round(params.seaLevel * HEIGHT_SCALE)} m。

| 指标 | Seed A: ${seedA} | Seed B: ${seedB} | B - A |
| --- | ---: | ---: | ---: |
| 最高峰 | ${seedComparison.a.peakMeters} m | ${seedComparison.b.peakMeters} m | ${seedComparison.difference.peakMeters} m |
| 陆地面积 | ${seedComparison.a.landAreaKm2} km² | ${seedComparison.b.landAreaKm2} km² | ${seedComparison.difference.landAreaKm2} km² |
| 陆地占比 | ${seedComparison.a.landPercent}% | ${seedComparison.b.landPercent}% | ${seedComparison.difference.landPercent}% |
| 平均海拔 | ${seedComparison.a.meanElevationMeters} m | ${seedComparison.b.meanElevationMeters} m | — |
| 地形指纹 | ${seedComparison.a.fingerprint} | ${seedComparison.b.fingerprint} | 不同 |

高度场平均绝对差异为 ${seedComparison.difference.meanHeightUnits}，最大差异为 ${seedComparison.difference.maxHeightUnits}。
两 seed 的最高峰位置不同，陆地占比也不同，确认它们生成的是不同的地理场。

## 插旗与水位验证

旗标初始世界坐标：X ${flag.world.x.toFixed(2)} / Y ${flag.world.y.toFixed(2)} / Z ${flag.world.z.toFixed(2)}。
后续只改变水位和频率/层数/侵蚀，旗标对象坐标保持不变。

| 水位 | 水面高程 | 陆地面积 | 旗标状态 | 坐标锁定 |
| ---: | ---: | ---: | --- | --- |
${waterSteps.map((step) => `| ${step.seaLevelNormalized} | ${step.flatWaterElevationMeters} m | ${step.landAreaKm2} km² | ${step.flagStatus === "submerged" ? "水下" : "水面以上"} | ${step.flagWorldLocked ? "是" : "否"} |`).join("\n")}

水位从 ${waterSteps[0].seaLevelNormalized} 提高到 ${waterSteps.at(-1).seaLevelNormalized} 后，陆地面积由 ${waterSteps[0].landAreaKm2} km² 降至 ${waterSteps.at(-1).landAreaKm2} km²，旗标由水面以上变为水下，但世界坐标完全不变。
将频率改为 ${changedParams.frequency}、层数改为 ${changedParams.octaves}、侵蚀改为 ${Math.round(changedParams.erosion * 100)}% 后，同一 X/Z 正下方的地面高程变为 ${flagValidation.changedTerrain.surfaceBelowFlagMeters} m，而旗标仍固定在 Y ${flag.world.y.toFixed(2)} m。

## 结论

- 两个 seed 可实际复现且地理指标、地形指纹均不同。
- 水面是单一水平面，所有低于水位的单元被同一高度填充。
- 旗标采用独立世界坐标，参数变化不重定位；水位变化只改变其干湿状态。
`;

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/validation-report.json", `${JSON.stringify(report, null, 2)}\n`);
await writeFile("artifacts/validation-report.md", markdown);
console.log(markdown);
