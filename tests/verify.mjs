import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = resolve(root, "artifacts");
let baseUrl = "";
const report = {
  generatedAt: new Date().toISOString(),
  checks: [],
  exports: [],
  metrics: {},
  pass: false,
};

mkdirSync(artifacts, { recursive: true });

function record(name, pass, details = {}) {
  report.checks.push({ name, pass, ...details });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`, Object.keys(details).length ? details : "");
}

async function waitForServer(url, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 180));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function availablePort() {
  return new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolvePromise(port));
    });
  });
}

function runFfmpeg(args, maxBuffer = 100 * 1024 * 1024) {
  const result = spawnSync(ffmpegPath, args, {
    encoding: "utf8",
    maxBuffer,
  });
  if (result.error) throw result.error;
  return result;
}

function inspectVideo(file) {
  const probe = runFfmpeg(["-hide_banner", "-i", file, "-f", "null", "-"]);
  const text = `${probe.stdout}\n${probe.stderr}`;
  if (probe.status !== 0) throw new Error(`FFmpeg failed for ${file}: ${text.slice(-800)}`);
  const durationMatch = text.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;
  const frameMatch = [...text.matchAll(/frame=\s*(\d+)/g)].at(-1);
  return {
    text,
    duration,
    frames: frameMatch ? Number(frameMatch[1]) : 0,
    hasVp9: /Video: vp9/.test(text),
    hasVp8: /Video: vp8/.test(text),
    has30fps: /30 fps, 30 tbr/.test(text),
    hasOpus: /Audio: opus, 48000 Hz, stereo/.test(text),
    hasResolution: /1280x720/.test(text),
  };
}

function measureFrameDeltas(file) {
  const width = 320;
  const height = 180;
  const result = spawnSync(
    ffmpegPath,
    [
      "-loglevel",
      "error",
      "-i",
      file,
      "-vf",
      `fps=30,scale=${width}:${height}`,
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 80 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  const frameBytes = width * height * 3;
  const frameCount = Math.floor(result.stdout.length / frameBytes);
  const differences = [];
  for (let index = 1; index < frameCount; index += 1) {
    let sum = 0;
    const current = (index * frameBytes);
    const previous = ((index - 1) * frameBytes);
    for (let byte = 0; byte < frameBytes; byte += 1) {
      sum += Math.abs(result.stdout[current + byte] - result.stdout[previous + byte]);
    }
    differences.push(sum / frameBytes);
  }
  differences.sort((a, b) => a - b);
  return {
    frames: frameCount,
    maxDelta: differences.at(-1) || 0,
    p99Delta: differences[Math.floor(differences.length * 0.99)] || 0,
  };
}

function contactSheet(file, output, tag) {
  const result = runFfmpeg([
    "-y",
    "-loglevel",
    "error",
    "-i",
    file,
    "-vf",
    "fps=1,scale=480:-1,tile=4x2:padding=6:margin=6",
    "-frames:v",
    "1",
    output,
  ], 8 * 1024 * 1024);
  if (result.status !== 0) throw new Error(`Contact sheet failed for ${tag}`);
}

async function main() {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(
    resolve(root, "node_modules/.bin/vite"),
    ["--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let serverLog = "";
  server.stdout.on("data", (chunk) => {
    serverLog += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverLog += chunk.toString();
  });

  let browser;
  const pageErrors = [];
  try {
    await waitForServer(baseUrl);
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });

    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__focal?.ready);
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(artifacts, "app-initial.png"), fullPage: true });
    record("应用载入且无运行时错误", pageErrors.length === 0, { errors: pageErrors });

    const continuity = await page.evaluate(() => {
      const result = {};
      for (const sceneId of ["grove", "harbor"]) {
        let previous = null;
        let maxFocusStep = 0;
        let maxBlurStep = 0;
        let maxOpacityStep = 0;
        for (let index = 0; index <= 8000; index += 1) {
          const composition = window.__focal.getComposition(index / 1000, sceneId);
          if (previous) {
            maxFocusStep = Math.max(
              maxFocusStep,
              Math.hypot(
                composition.focus.x - previous.focus.x,
                composition.focus.y - previous.focus.y,
              ),
            );
            composition.layers.forEach((layer, layerIndex) => {
              const before = previous.layers[layerIndex];
              maxBlurStep = Math.max(maxBlurStep, Math.abs(layer.blur - before.blur));
              maxOpacityStep = Math.max(
                maxOpacityStep,
                Math.abs(layer.opacity - before.opacity),
              );
            });
          }
          previous = composition;
        }
        const end = window.__focal.getComposition(8, sceneId);
        result[sceneId] = {
          maxFocusStep,
          maxBlurStep,
          maxOpacityStep,
          order: end.layers.map((layer) => [layer.id, layer.z]),
          finalFocus: end.focus,
        };
      }
      return result;
    });
    report.metrics.continuity = continuity;
    const continuityPass = Object.values(continuity).every(
      (scene) =>
        scene.maxFocusStep < 0.01 &&
        scene.maxBlurStep < 0.05 &&
        scene.maxOpacityStep < 0.02,
    );
    record("两景焦点、模糊与淡入均连续", continuityPass, continuity);

    const orderPass = Object.values(continuity).every(
      (scene) =>
        JSON.stringify(scene.order) ===
        JSON.stringify([
          ["background", 0],
          ["midground", 1],
          ["foreground", 2],
        ]),
    );
    record("合成层序固定为背景→中景→前景", orderPass);

    const setRange = async (id, value) => {
      await page.evaluate(
        ([inputId, nextValue]) => {
          const input = document.querySelector(`#${inputId}`);
          input.value = String(nextValue);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        },
        [id, value],
      );
    };

    await setRange("blur-foreground", 9.5);
    await page.locator('[data-scene-id="harbor"]').click();
    const harborForeground = await page.evaluate(
      () => window.__focal.getState().scenes.find((scene) => scene.id === "harbor").layers.foreground.blur,
    );
    await setRange("blur-background", 18);
    await page.locator('[data-scene-id="grove"]').click();
    const isolated = await page.evaluate(() => {
      const state = window.__focal.getState();
      const grove = state.scenes.find((scene) => scene.id === "grove");
      const harbor = state.scenes.find((scene) => scene.id === "harbor");
      return {
        groveForeground: grove.layers.foreground.blur,
        groveBackground: grove.layers.background.blur,
        harborForeground: harbor.layers.foreground.blur,
        harborBackground: harbor.layers.background.blur,
      };
    });
    report.metrics.isolation = isolated;
    record(
      "切换场景后图层参数不串场",
      isolated.groveForeground === 9.5 &&
        isolated.groveBackground === 12 &&
        isolated.harborForeground === 3.5 &&
        harborForeground === 3.5 &&
        isolated.harborBackground === 18,
      isolated,
    );

    await page.locator('[data-scene-id="harbor"]').click();
    const canvasBox = await page.locator("#stage").boundingBox();
    await page.mouse.move(
      canvasBox.x + canvasBox.width * 0.21,
      canvasBox.y + canvasBox.height * 0.72,
    );
    await page.mouse.down();
    await page.mouse.move(
      canvasBox.x + canvasBox.width * 0.35,
      canvasBox.y + canvasBox.height * 0.61,
      { steps: 8 },
    );
    await page.mouse.up();
    const movedHarborPath = await page.evaluate(() => {
      const state = window.__focal.getState();
      return state.scenes.find((scene) => scene.id === "harbor").focus.points[0];
    });
    await page.locator('[data-scene-id="grove"]').click();
    const pathsAfterDrag = await page.evaluate((harborStart) => {
      const state = window.__focal.getState();
      const grove = state.scenes.find((scene) => scene.id === "grove");
      return { groveStart: grove.focus.points[0], harborStart };
    }, movedHarborPath);
    report.metrics.focusIsolation = pathsAfterDrag;
    record(
      "焦点曲线按场景独立存储",
      pathsAfterDrag.groveStart.x === 0.2 &&
        pathsAfterDrag.groveStart.y === 0.7 &&
        Math.abs(pathsAfterDrag.harborStart.x - 0.35) < 0.015 &&
        Math.abs(pathsAfterDrag.harborStart.y - 0.61) < 0.015,
      pathsAfterDrag,
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__focal?.ready);
    const groveDownloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await page.click("#export-webm");
    const groveDownload = await groveDownloadPromise;
    const groveFile = resolve(artifacts, "focal-grove-8s.webm");
    await groveDownload.saveAs(groveFile);
    await page.waitForFunction(
      () => !document.querySelector("#export-overlay").classList.contains("is-visible"),
      { timeout: 15000 },
    );
    record("导出第一景 WebM", existsSync(groveFile), {
      filename: groveDownload.suggestedFilename(),
      bytes: existsSync(groveFile) ? readFileSync(groveFile).byteLength : 0,
    });

    await page.locator('[data-scene-id="harbor"]').click();
    const harborDownloadPromise = page.waitForEvent("download", { timeout: 90000 });
    await page.click("#export-webm");
    const harborDownload = await harborDownloadPromise;
    const harborFile = resolve(artifacts, "focal-harbor-8s.webm");
    await harborDownload.saveAs(harborFile);
    await page.waitForFunction(
      () => !document.querySelector("#export-overlay").classList.contains("is-visible"),
      { timeout: 15000 },
    );
    record("导出第二景 WebM", existsSync(harborFile), {
      filename: harborDownload.suggestedFilename(),
      bytes: existsSync(harborFile) ? readFileSync(harborFile).byteLength : 0,
    });

    const jsonDownloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.click("#export-json");
    const jsonDownload = await jsonDownloadPromise;
    const jsonFile = resolve(artifacts, "focal-drift-project.json");
    await jsonDownload.saveAs(jsonFile);
    const project = JSON.parse(readFileSync(jsonFile, "utf8"));
    record("导出工程 JSON 且包含两景", project.scenes?.length === 2, {
      format: project.format,
      duration: project.duration,
      scenes: project.scenes?.map((scene) => scene.id),
    });

    for (const [tag, file] of [
      ["grove", groveFile],
      ["harbor", harborFile],
    ]) {
      const info = inspectVideo(file);
      const deltas = measureFrameDeltas(file);
      contactSheet(file, resolve(artifacts, `contact-${tag}.png`), tag);
      const { text: probeText, ...videoInfo } = info;
      report.exports.push({ tag, file, ...videoInfo, ...deltas });
      record(
        `${tag} WebM 为精确 8 秒 / 30 fps / VP9 / Opus`,
        Math.abs(info.duration - 8) <= 0.03 &&
          info.frames === 240 &&
          (info.hasVp9 || info.hasVp8) &&
          info.has30fps &&
          info.hasOpus &&
          info.hasResolution,
        videoInfo,
      );
      record(`${tag} 帧间无硬切`, deltas.maxDelta < 24, deltas);

      const audioProbe = runFfmpeg([
        "-hide_banner",
        "-i",
        file,
        "-vn",
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
      ]);
      const audioText = `${audioProbe.stdout}\n${audioProbe.stderr}`;
      const meanVolume = Number(audioText.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/)?.[1]);
      const maxVolume = Number(audioText.match(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/)?.[1]);
      record(
        `${tag} 含可听见的轻氛围声`,
        meanVolume > -50 && meanVolume < -15 && maxVolume < -3,
        { meanVolume, maxVolume },
      );
    }

    const playbackPage = await context.newPage();
    playbackPage.on("pageerror", (error) => pageErrors.push(error.message));
    await playbackPage.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    const playback = await playbackPage.evaluate(async () => {
      document.body.innerHTML = `
        <style>
          html,body{margin:0;height:100%;background:#000;display:grid;place-items:center}
          video{width:100%;height:100%;object-fit:contain}
        </style>
        <video id="proof" src="/artifacts/focal-grove-8s.webm" playsinline></video>`;
      const video = document.querySelector("#proof");
      await new Promise((resolvePromise, reject) => {
        video.addEventListener("loadedmetadata", resolvePromise, { once: true });
        video.addEventListener("error", () => reject(new Error("WebM 回放加载失败")), {
          once: true,
        });
      });
      video.muted = true;
      await video.play();
      await new Promise((resolvePromise) => {
        const timer = setInterval(() => {
          if (video.currentTime >= 1.6 || video.ended) {
            clearInterval(timer);
            resolvePromise();
          }
        }, 25);
      });
      const playedTime = video.currentTime;
      video.pause();
      video.currentTime = 7.5;
      await new Promise((resolvePromise) => {
        video.addEventListener("seeked", resolvePromise, { once: true });
      });
      return {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        playedTime,
        seekedTime: video.currentTime,
        readyState: video.readyState,
      };
    });
    await playbackPage.screenshot({ path: resolve(artifacts, "playback-7.5s.png") });
    report.metrics.playback = playback;
    record(
      "导出文件在 Chromium 中实际播放和定位",
      playback.duration >= 7.98 &&
        playback.duration <= 8.05 &&
        playback.width === 1280 &&
        playback.height === 720 &&
        playback.playedTime >= 1.5 &&
        playback.seekedTime === 7.5 &&
        playback.readyState >= 2,
      playback,
    );

    record("全流程无页面运行时错误", pageErrors.length === 0, { errors: pageErrors });
    report.pass = report.checks.every((check) => check.pass);
  } catch (error) {
    report.error = error.stack || error.message;
    record("验证脚本执行", false, { error: report.error });
    if (serverLog) console.error(serverLog.slice(-2000));
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    writeFileSync(
      resolve(artifacts, "verification-report.json"),
      JSON.stringify(report, null, 2),
    );
  }
  if (!report.pass) process.exitCode = 1;
}

await main();
