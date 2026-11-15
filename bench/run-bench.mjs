import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 4319);
const OUT_DIR = join(process.cwd(), "artifacts", "bench");

// Repeat the full 10 s replay several times per config to reduce GC /
// scheduler noise; the harness aggregates the repetitions.
const REPEAT = Number(process.env.REPEAT || 5);

function printTable(rows) {
  const header = [
    "config".padEnd(10),
    "avgMs".padStart(8),
    "minMs".padStart(8),
    "p50".padStart(8),
    "p95".padStart(8),
    "layout".padStart(8),
    "draw".padStart(8),
    "calls".padStart(7),
    "visible".padStart(8),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of rows) {
    console.log([
      r.configId.padEnd(10),
      r.avgFrameMs.toFixed(3).padStart(8),
      r.minAvgFrameMs.toFixed(3).padStart(8),
      r.avgP50.toFixed(3).padStart(8),
      r.avgP95.toFixed(3).padStart(8),
      r.avgLayoutMs.toFixed(3).padStart(8),
      r.avgDrawMs.toFixed(3).padStart(8),
      r.avgDrawCalls.toFixed(0).padStart(7),
      r.avgVisible.toFixed(0).padStart(8),
    ].join(" "));
  }
}

function summarizeSuite(scenarioReports) {
  const byConfig = new Map();
  for (const report of scenarioReports) {
    for (const result of report.results) {
      if (!byConfig.has(result.configId)) byConfig.set(result.configId, []);
      byConfig.get(result.configId).push(result);
    }
  }
  const rows = [];
  for (const [configId, runs] of byConfig) {
    const avg = (key) => runs.reduce((a, r) => a + r[key], 0) / runs.length;
    const min = (key) => Math.min(...runs.map((r) => r[key]));
    rows.push({
      configId,
      label: runs[0].label,
      repetitions: runs.length,
      avgFrameMs: avg("avgFrameMs"),
      minAvgFrameMs: min("avgFrameMs"),
      avgP50: avg("p50FrameMs"),
      avgP95: avg("p95FrameMs"),
      avgLayoutMs: avg("avgLayoutMs"),
      avgDrawMs: avg("avgDrawMs"),
      avgDrawCalls: avg("avgDrawCalls"),
      avgVisible: avg("avgVisible"),
    });
  }
  return rows;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const port = PORT;
  const server = spawn(process.execPath, [join(process.cwd(), "bench", "server.mjs")], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const timer = setInterval(() => {
      fetch(`http://localhost:${port}/`).then(() => {
        clearInterval(timer);
        resolve();
      }).catch(() => {
        if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error("server did not start"));
        }
      });
    }, 100);
  });

  const browser = await chromium.launch({
    args: ["--disable-gpu", "--no-sandbox", "--enable-precise-memory-info"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("console", (msg) => console.log("[browser]", msg.text()));
  page.on("pageerror", (err) => console.error("[pageerror]", err.message));
  await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__profiler, { timeout: 10_000 });

  const reports = [];
  for (let i = 0; i < REPEAT; i++) {
    const report = await page.evaluate(async () => {
      return window.__profiler.runBenchmarkSuite({
        seed: 42,
        includeShadowReference: true,
      });
    });
    reports.push(report);
    console.log(`repetition ${i + 1}/${REPEAT} done`);
  }

  const scenarioNames = reports[0].map((s) => s.name);
  const perScenario = scenarioNames.map((name, idx) => {
    const scenarioReports = reports.map((rep) => rep[idx]);
    const rows = summarizeSuite(scenarioReports);
    console.log(`\n=== scenario: ${name} (${scenarioReports[0].shapeCount} objects, ${scenarioReports[0].viewport.width}x${scenarioReports[0].viewport.height}) ===`);
    printTable(rows);
    return rows;
  });

  const first = reports[0][0];
  const parity = first.parity;
  const pixelDiff = first.pixelDiff;
  const allParityOk = reports.flat().every((s) => s.parity.every((p) => p.identical));
  const allPixelsIdentical = reports.flat().every((s) => s.pixelDiff.every((d) => d.differingPixels === 0));
  console.log("\nParity (hash):", allParityOk ? "ALL IDENTICAL" : "MISMATCH");
  console.log("Parity (exact pixels):", allPixelsIdentical ? "ALL IDENTICAL" : "MISMATCH");

  const output = {
    generatedAt: new Date().toISOString(),
    environment: {
      userAgent: first.userAgent,
      gpu: "disabled (--disable-gpu, software rasterization)",
      viewport: "per-scenario, see scenarios",
      replayFrames: first.replayFrames,
      replayDurationMs: first.replayDurationMs,
      repetitions: REPEAT,
    },
    scenarios: reports[0].map((s, idx) => ({
      name: s.name,
      shapeCount: s.shapeCount,
      viewport: s.viewport,
      summary: perScenario[idx],
      parity: s.parity,
      pixelDiff: s.pixelDiff,
    })),
    parity,
    pixelDiff,
    rawReports: reports,
  };
  const file = join(OUT_DIR, "benchmark.json");
  writeFileSync(file, JSON.stringify(output, null, 2));
  console.log("\nwrote", file);

  await page.screenshot({ path: join(OUT_DIR, "app.png") });
  await browser.close();
  server.kill();

  if (!allParityOk || !allPixelsIdentical) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
