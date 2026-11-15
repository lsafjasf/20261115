import { createScene } from "./scene.js";
import { buildScript, applyFrame } from "./replay.js";
import { Renderer } from "./renderer.js";

export const CONFIGS = [
  { id: "all_off", label: "优化全关（线性遍历/不裁剪）", shadows: true, spatialSort: false, culling: false },
  { id: "cull_only", label: "离屏裁剪（线性遍历+裁剪）", shadows: true, spatialSort: false, culling: true },
  { id: "all_on", label: "全部优化（网格排序+裁剪）", shadows: true, spatialSort: true, culling: true },
];

export const REFERENCE_CONFIG = { id: "no_shadow", label: "参考：关闭阴影（画面不同，仅测阴影成本）", shadows: false, spatialSort: true, culling: true };

const HASH_FRAMES = [0, 120, 300, 480, 599];

function average(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// Deterministic fixed-step replay. Every configuration gets a freshly
// regenerated scene from the same seed, so all runs start identical.
export function runConfig(config, seed, shapeCount, viewW, viewH, canvas, { warmup = 60 } = {}) {
  const scene = createScene(seed, shapeCount);
  const script = buildScript(scene, seed + 1000);
  const ctx = canvas.getContext("2d");
  const renderer = new Renderer(ctx);
  const camera = { x: 0, y: 0 };
  const options = {
    shadows: config.shadows,
    spatialSort: config.spatialSort,
    culling: config.culling,
  };

  for (let frame = 0; frame < warmup; frame++) {
    applyFrame(scene, camera, script, frame);
    renderer.renderFrame(scene, camera, viewW, viewH, options);
  }

  const frameMs = [];
  const layoutMs = [];
  const drawMs = [];
  const drawCalls = [];
  const visibleCounts = [];
  const hashes = new Map();

  for (let frame = 0; frame < script.frames; frame++) {
    applyFrame(scene, camera, script, frame);
    const result = renderer.renderFrame(scene, camera, viewW, viewH, options);
    frameMs.push(result.layoutMs + result.drawMs);
    layoutMs.push(result.layoutMs);
    drawMs.push(result.drawMs);
    drawCalls.push(result.drawCalls);
    visibleCounts.push(renderer.lastFrameCount.visible);
    if (HASH_FRAMES.includes(frame)) {
      hashes.set(frame, hashCanvas(canvas));
    }
  }

  const sorted = [...frameMs].sort((a, b) => a - b);
  return {
    configId: config.id,
    label: config.label,
    frames: script.frames,
    avgFrameMs: average(frameMs),
    p50FrameMs: percentile(sorted, 50),
    p95FrameMs: percentile(sorted, 95),
    avgLayoutMs: average(layoutMs),
    avgDrawMs: average(drawMs),
    avgDrawCalls: average(drawCalls),
    avgVisible: average(visibleCounts),
    shapeCount,
    hashes: Object.fromEntries(hashes),
  };
}

// Small FNV-1a hash over the raw canvas pixels. Used only to prove that
// parity-safe configurations produce byte-identical frames.
export function hashCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Exact pixel diff against a baseline ImageData: number of differing
// pixels and the largest per-channel delta. Zero means identical frames.
export function diffImageData(base, other) {
  const a = base.data;
  const b = other.data;
  let differingPixels = 0;
  let maxDelta = 0;
  const step = 4;
  for (let i = 0; i < a.length; i += step) {
    let pixelDiffers = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(a[i + c] - b[i + c]);
      if (delta > maxDelta) maxDelta = delta;
      if (delta !== 0) pixelDiffers = true;
    }
    if (pixelDiffers) differingPixels++;
  }
  return {
    totalPixels: a.length / 4,
    differingPixels,
    maxChannelDelta: maxDelta,
  };
}

// Compare every measured frame's hash against the baseline configuration.
export function checkParity(results) {
  const baseline = results.find((r) => r.configId === "all_off");
  return results.map((r) => {
    const frames = Object.keys(baseline.hashes);
    const mismatches = frames.filter((f) => r.hashes[f] !== baseline.hashes[f]);
    return {
      configId: r.configId,
      identical: mismatches.length === 0,
      comparedFrames: frames.map(Number),
      mismatches: mismatches.map(Number),
    };
  });
}

export function runBenchmark({
  seed = 42,
  shapeCount = 600,
  viewW = 960,
  viewH = 600,
  canvas = null,
  includeShadowReference = true,
} = {}) {
  // Dedicated offscreen canvas keeps the headless/on-screen DPR transform
  // out of the measurement and guarantees identical backing-store size.
  const benchCanvas = canvas || document.createElement("canvas");
  benchCanvas.width = viewW;
  benchCanvas.height = viewH;
  benchCanvas.getContext("2d", { willReadFrequently: true });
  const configs = includeShadowReference ? [...CONFIGS, REFERENCE_CONFIG] : CONFIGS;
  const results = configs.map((config) =>
    runConfig(config, seed, shapeCount, viewW, viewH, benchCanvas)
  );
  const parity = checkParity(results.filter((r) => r.configId !== "no_shadow"));
  const pixelDiff = measurePixelDiff(benchCanvas, seed, shapeCount, viewW, viewH);
  return {
    seed,
    shapeCount,
    viewport: { width: viewW, height: viewH },
    replayFrames: 600,
    replayDurationMs: 10_000,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    results,
    parity,
    pixelDiff,
  };
}

// Run the full comparison under several workloads so the report reflects
// both sparse (heavy culling) and dense (mostly visible) scenarios.
export function runBenchmarkSuite({ seed = 42, scenarios, includeShadowReference = true } = {}) {
  const suite = scenarios || [
    { name: "sparse", shapeCount: 600, viewW: 960, viewH: 600 },
    { name: "dense", shapeCount: 1500, viewW: 1400, viewH: 900 },
    { name: "large", shapeCount: 4000, viewW: 1400, viewH: 900 },
  ];
  return suite.map((scenario) => ({
    name: scenario.name,
    ...runBenchmark({
      seed,
      shapeCount: scenario.shapeCount,
      viewW: scenario.viewW,
      viewH: scenario.viewH,
      includeShadowReference,
    }),
  }));
}

function measurePixelDiff(canvas, seed, shapeCount, viewW, viewH) {
  const ctx = canvas.getContext("2d");
  const sampleFrames = [0, 150, 300, 450, 599];
  const out = [];
  for (const frame of sampleFrames) {
    const rendered = new Map();
    for (const config of CONFIGS) {
      const scene = createScene(seed, shapeCount);
      const script = buildScript(scene, seed + 1000);
      const renderer = new Renderer(ctx);
      const camera = { x: 0, y: 0 };
      const options = {
        shadows: config.shadows,
        spatialSort: config.spatialSort,
        culling: config.culling,
      };
      for (let f = 0; f <= frame; f++) {
        applyFrame(scene, camera, script, f);
        renderer.renderFrame(scene, camera, viewW, viewH, options);
      }
      rendered.set(config.id, ctx.getImageData(0, 0, viewW, viewH));
    }
    const base = rendered.get("all_off");
    for (const config of CONFIGS) {
      if (config.id === "all_off") continue;
      const diff = diffImageData(base, rendered.get(config.id));
      out.push({ frame, configId: config.id, ...diff });
    }
  }
  return out;
}
