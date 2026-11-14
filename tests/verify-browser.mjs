import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const outputDir = new URL("../artifacts/", import.meta.url);
const outputPath = (name) => fileURLToPath(new URL(name, outputDir));
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8899/";

async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE
      ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
      : null,
    "playwright",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch {
      continue;
    }
  }
  throw new Error(
    "未找到 Playwright。请安装 playwright，或用 PLAYWRIGHT_MODULE 指向其 index.mjs。"
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const errors = [];

  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const initial = await page.evaluate(() => window.__creditsLab.snapshot());

  assert(initial.lineCount === 10, "示例字幕不是十行");
  assert(initial.validation.safe, "边界校验失败");
  assert(initial.validation.horizontalSafe, "存在横向越界文本");
  assert(initial.cues.reduce((total, cue) => total + cue.lines, 0) === 10, "VTT 未覆盖十行");

  await page.evaluate(() => window.__creditsLab.seek(12.4));
  const vttDownloadEvent = page.waitForEvent("download");
  await page.locator("#vttButton").click();
  const vttDownload = await vttDownloadEvent;
  await vttDownload.saveAs(outputPath("night-flight-end-credits.vtt"));

  const pngDownloadEvent = page.waitForEvent("download");
  await page.locator("#pngButton").click();
  const pngDownload = await pngDownloadEvent;
  await pngDownload.saveAs(outputPath("night-flight-layout.png"));
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.__creditsLab.seek(12.4));
  await page.mouse.move(5, 5);
  await page.screenshot({ path: outputPath("app-preview.png") });

  const slider = await page.locator("#timelineInput").boundingBox();
  await page.mouse.move(slider.x + 4, slider.y + slider.height / 2);
  await page.mouse.down();
  await page.mouse.move(slider.x + slider.width * 0.6, slider.y + slider.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const scrubbed = await page.evaluate(() => window.__creditsLab.snapshot());
  assert(
    scrubbed.playhead / scrubbed.duration > 0.52 && scrubbed.playhead / scrubbed.duration < 0.68,
    "时间轴拖动未生效"
  );

  await page.locator("#playButton").click();
  await page.waitForTimeout(850);
  const playing = await page.evaluate(() => window.__creditsLab.snapshot());
  await page.locator("#playButton").click();
  const paused = await page.evaluate(() => window.__creditsLab.snapshot());

  assert(playing.playhead > scrubbed.playhead, "播放头未推进");
  assert(!paused.playing && Math.abs(paused.playhead - playing.playhead) < 0.2, "暂停状态不正确");
  assert(playing.audio.started, "Web Audio 未启动");

  const loopStart = await page.evaluate(() => {
    const snapshot = window.__creditsLab.snapshot();
    window.__creditsLab.seek(snapshot.duration - 0.35);
    return snapshot.duration - 0.35;
  });
  await page.locator("#playButton").click();
  await page.waitForTimeout(750);
  const looped = await page.evaluate(() => window.__creditsLab.snapshot());
  await page.locator("#playButton").click();
  assert(looped.playing && looped.playhead < 1, "循环播放未从结尾回绕");

  const png = await fs.readFile(outputPath("night-flight-layout.png"));
  const vtt = await fs.readFile(outputPath("night-flight-end-credits.vtt"), "utf8");
  const pngSize = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  assert(pngSize.width === 1280 && pngSize.height === 720, "PNG 尺寸不正确");
  assert(vtt.startsWith("WEBVTT\n"), "VTT 文件头不正确");
  assert((vtt.match(/ --> /g) ?? []).length === 5, "VTT cue 数量不正确");
  assert(errors.length === 0, `浏览器错误：${errors.join(" | ")}`);

  const report = {
    generatedAt: new Date().toISOString(),
    viewport: "1440x900",
    tenLines: initial.lineCount,
    blankSections: initial.blankCount,
    visualRows: initial.rowCount,
    durationSeconds: Number(initial.duration.toFixed(3)),
    durationClock: "00:39.4",
    scrollDistancePx: initial.maxScroll,
    firstLineTopPx: initial.validation.firstTop,
    finalTrackBottomPx: initial.validation.finalTrackBottom,
    horizontalSafe: initial.validation.horizontalSafe,
    maxMeasuredWidthPx: Number(initial.validation.maxTextWidth.toFixed(1)),
    safeTextWidthPx: 930,
    allLinesClearBoundary: initial.validation.safe,
    webvttCueCount: initial.cueCount,
    webvttTextLines: initial.cues.reduce((total, cue) => total + cue.lines, 0),
    webvttBytes: Buffer.byteLength(vtt),
    pngSize,
    timelineScrub: {
      targetPercent: 60,
      resultingSeconds: Number(scrubbed.playhead.toFixed(3)),
    },
    playback: {
      from: Number(scrubbed.playhead.toFixed(3)),
      to: Number(playing.playhead.toFixed(3)),
      advanced: playing.playhead > scrubbed.playhead,
      audioContext: playing.audio.contextState,
      audioStarted: playing.audio.started,
    },
    pauseAtSeconds: Number(paused.playhead.toFixed(3)),
    loop: {
      startedAtSeconds: Number(loopStart.toFixed(3)),
      wrappedToSeconds: Number(looped.playhead.toFixed(3)),
      playing: looped.playing,
    },
    consoleErrors: errors,
  };

  await fs.writeFile(
    outputPath("verification.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
