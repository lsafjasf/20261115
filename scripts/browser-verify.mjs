import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const port = Number(process.env.BROWSER_VERIFY_PORT) || 43721;
const baseUrl = `http://127.0.0.1:${port}/`;
const candidates = [
  process.env.CHROME_HEADLESS_SHELL,
  join(homedir(), ".cache/puppeteer/chrome-headless-shell/linux-137.0.7151.55/chrome-headless-shell-linux64/chrome-headless-shell"),
].filter(Boolean);

async function findChrome() {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known location.
    }
  }
  throw new Error("未找到 chrome-headless-shell；先运行 npx puppeteer browsers install chrome-headless-shell");
}

const { default: puppeteer } = await import("puppeteer-core");
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: new URL("..", import.meta.url),
  stdio: "ignore",
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("静态服务器启动超时");
}

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    executablePath: await findChrome(),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("requestfailed", (request) => runtimeErrors.push(`REQUEST ${request.url()} ${request.failure()?.errorText}`));
  page.on("response", (response) => {
    if (!response.ok()) runtimeErrors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  await page.goto(baseUrl, { waitUntil: "networkidle0" });
  try {
    await page.waitForFunction(() => window.__SEAM_SAMPLER__, { timeout: 6000 });
  } catch {
    const diagnostics = await page.evaluate(() => ({
      readyState: document.readyState,
      scripts: [...document.scripts].map((script) => script.src),
      body: document.body.innerText.slice(0, 200),
    }));
    throw new Error(`应用未启动: ${runtimeErrors.join(" | ") || "无控制台错误"} :: ${JSON.stringify(diagnostics)}`);
  }

  assert.equal(await page.$$eval(".sample-card", (nodes) => nodes.length), 4, "应显示四段采样");
  assert.deepEqual(
    await page.$$eval(".sample-key", (nodes) => nodes.map((node) => node.textContent.trim())),
    ["A", "S", "D", "F"],
  );
  const canvasMetrics = await page.evaluate(() => {
    const waveform = document.querySelector("#waveformCanvas").getBoundingClientRect();
    const keyboard = document.querySelector("#keyboardCanvas").getBoundingClientRect();
    return { waveform: { width: waveform.width, height: waveform.height }, keyboard: { width: keyboard.width, height: keyboard.height } };
  });
  assert.ok(canvasMetrics.waveform.width > 700 && canvasMetrics.waveform.height > 250, "波形 Canvas 尺寸异常");
  assert.ok(canvasMetrics.keyboard.width > 500 && canvasMetrics.keyboard.height > 100, "键盘 Canvas 尺寸异常");

  const initial = await page.evaluate(() => window.__SEAM_SAMPLER__.getState());
  assert.equal(initial.samples.length, 4);
  assert.equal(initial.samples[3].end, 2);
  assert.equal(initial.samples[3].requestedEnd, 2.15);
  assert.equal(initial.samples[3].truncatedAtLoop, true);

  await page.evaluate(() => window.__SEAM_SAMPLER__.selectSample(4));
  const seamNotice = await page.$eval("#seamNotice", (node) => node.textContent);
  assert.match(seamNotice, /接缝截断/);
  assert.match(seamNotice, /2\.150s/);
  await page.screenshot({ path: new URL("../artifacts/ui-seam.png", import.meta.url).pathname, fullPage: true });

  await page.evaluate(() => window.__SEAM_SAMPLER__.selectSample(1));
  const box = await page.$eval("#waveformCanvas", (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const xStart = Math.min(52, box.width * 0.12);
  const xEnd = Math.max(18, box.width * 0.025);
  const plotWidth = box.width - xStart - xEnd;
  const viewEnd = 2.35;
  const xAt = (time) => box.x + xStart + (time / viewEnd) * plotWidth;
  const endHandleY = box.y + box.height - 21;
  await page.mouse.move(xAt(0.3), endHandleY);
  await page.mouse.down();
  await page.mouse.move(xAt(0.35), endHandleY, { steps: 8 });
  await page.mouse.up();
  const afterEndDrag = await page.evaluate(() => window.__SEAM_SAMPLER__.getState().samples[0]);
  assert.ok(afterEndDrag.end >= 0.34 && afterEndDrag.end <= 0.36, `拖拽终点失败: ${afterEndDrag.end}`);

  const fadeHandleY = box.y + 50;
  await page.mouse.move(xAt(afterEndDrag.end - afterEndDrag.fadeOut), fadeHandleY);
  await page.mouse.down();
  await page.mouse.move(xAt(afterEndDrag.end - 0.09), fadeHandleY, { steps: 8 });
  await page.mouse.up();
  const afterFadeDrag = await page.evaluate(() => window.__SEAM_SAMPLER__.getState().samples[0]);
  assert.ok(afterFadeDrag.fadeOut >= 0.085 && afterFadeDrag.fadeOut <= 0.095, `拖拽淡化失败: ${afterFadeDrag.fadeOut}`);

  await page.keyboard.press("f");
  await page.waitForFunction(() => window.__SEAM_SAMPLER__.getAudioState().contextState === "running");
  const audioState = await page.evaluate(() => window.__SEAM_SAMPLER__.getAudioState());
  assert.equal(audioState.contextState, "running");
  assert.equal(audioState.sourceFrames, 88200);

  const summary = await page.evaluate(() => window.__SEAM_SAMPLER__.renderSummary());
  assert.equal(summary.frames, 88200);
  assert.equal(summary.duration, 2);
  assert.equal(summary.priorityCuts, 2);
  assert.ok(summary.peak > 0.3);
  assert.ok(summary.rms > 0.01);
  assert.ok(summary.eventEnergy.every((energy) => energy > 0.005));

  await page.click("#playButton");
  await page.waitForFunction(() => window.__SEAM_SAMPLER__.getState().transport.playing === true);
  await new Promise((resolve) => setTimeout(resolve, 450));
  await page.waitForFunction(() => window.__SEAM_SAMPLER__.getState().transport.playing === false, { timeout: 3500 });
  assert.equal(runtimeErrors.length, 0, `浏览器运行时错误: ${runtimeErrors.join(" | ")}`);
  await page.screenshot({ path: new URL("../artifacts/ui.png", import.meta.url).pathname, fullPage: true });

  console.log(JSON.stringify({
    ok: true,
    canvasMetrics,
    kickAfterDrag: { end: afterEndDrag.end, fadeOut: afterFadeDrag.fadeOut },
    webAudio: audioState,
    offlineRender: {
      frames: summary.frames,
      duration: summary.duration,
      priorityCuts: summary.priorityCuts,
      peak: Number(summary.peak.toFixed(4)),
      rms: Number(summary.rms.toFixed(4)),
    },
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
