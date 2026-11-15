import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import ffmpegPath from "ffmpeg-static";

const artifacts = join(process.cwd(), "artifacts");
const exportPath = join(artifacts, "eight-flash-demo.webm");
const jsonPath = join(artifacts, "eight-flash-offset.json");
const accentTimes = [1.2, 4.8, 8.4, 12.0, 15.6, 19.2, 22.8, 26.4];

test.beforeAll(async () => {
  await mkdir(artifacts, { recursive: true });
});

async function openStudio(page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__syncStudio)))
    .toBe(true);
}

function runFfmpeg(args, maxBuffer = 50 * 1024 * 1024) {
  const result = spawnSync(ffmpegPath, args, { maxBuffer });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(result.stderr?.toString() || "ffmpeg failed");
  }
  return result;
}

test("renders eight audio accents and eight linked flash markers", async ({ page }) => {
  await openStudio(page);
  const state = await page.evaluate(() => window.__syncStudio.getState());
  expect(state.projectId).toBe("eight-flash-30s-v1");
  expect(state.durationSec).toBe(30);
  expect(state.fps).toBe(30);
  expect(state.totalFrames).toBe(900);
  expect(state.flashCount).toBe(8);
  expect(state.audioAccentCount).toBe(8);
  expect(state.offsetFrames).toBe(0);

  await expect(page.locator(".visual-marker")).toHaveCount(8);
  await expect(page.locator(".audio-marker")).toHaveCount(8);
  await expect(page.locator(".event-card")).toHaveCount(8);
  await expect(page.locator("#frameNumber")).toHaveText("0000");
  await expect(page.locator("#canvasOffsetValue")).toHaveText("0 ms");
});

test("uses one global frame offset for all eight flashes", async ({ page }) => {
  await openStudio(page);
  await page.evaluate(async () => window.__syncStudio.ensureAudio());

  const flashesAtZero = await page.evaluate((times) =>
    times.map((time, index) => ({
      ...window.__syncStudio.getSceneAt(time),
      expectedIndex: index,
    })),
  accentTimes);
  flashesAtZero.forEach((flash) => {
    expect(flash.flashIndex).toBe(flash.expectedIndex);
    expect(flash.flashIntensity).toBeGreaterThan(0.8);
  });

  const markersAtZero = await page.evaluate(
    () => window.__syncStudio.getVisualMarkerPositions(),
  );
  await page.evaluate(() => window.__syncStudio.setOffsetFrames(3));
  const state = await page.evaluate(() => window.__syncStudio.getState());
  const markersAtThree = await page.evaluate(
    () => window.__syncStudio.getVisualMarkerPositions(),
  );

  expect(state.offsetFrames).toBe(3);
  expect(state.offsetMs).toBeCloseTo(100, 5);
  markersAtThree.forEach((position, index) => {
    expect(position - markersAtZero[index]).toBeCloseTo((0.1 / 30) * 100, 3);
  });

  const shiftedFlash = await page.evaluate(() => window.__syncStudio.getSceneAt(4.9));
  expect(shiftedFlash.flashIndex).toBe(1);
  expect(shiftedFlash.flashIntensity).toBe(1);
  await page.evaluate(() => window.__syncStudio.seek(4.9));
  await expect(page.locator("#frameNumber")).toHaveText("0144");
  await expect(page.locator("#offsetMs")).toHaveText("100");
  await expect(page.locator("#offsetFramesLabel")).toHaveText("3 帧");

  await page.evaluate(() => window.__syncStudio.setOffsetFrames(100));
  await expect(page.locator("#offsetMs")).toHaveText("300");
  await expect(page.locator("#nudgeForward")).toBeDisabled();
  await page.evaluate(() => window.__syncStudio.setOffsetFrames(-100));
  await expect(page.locator("#offsetMs")).toHaveText("300");
  await expect(page.locator("#nudgeBack")).toBeDisabled();
});

test("pauses on a stable frame and restores an identical canvas after reload", async ({
  page,
}) => {
  await openStudio(page);
  await page.evaluate(() => {
    window.__syncStudio.setOffsetFrames(3);
    window.__syncStudio.seek(8.4333);
  });
  const before = await page.evaluate(() => ({
    state: window.__syncStudio.getState(),
    canvas: window.__syncStudio.getCanvasDataUrl(),
  }));

  await page.evaluate(() => window.__syncStudio.play());
  await page.waitForTimeout(650);
  await page.evaluate(() => window.__syncStudio.pause());
  const paused = await page.evaluate(() => window.__syncStudio.getState());
  await page.waitForTimeout(450);
  const stillPaused = await page.evaluate(() => window.__syncStudio.getState());
  expect(paused.isPlaying).toBe(false);
  expect(stillPaused.currentTime).toBe(paused.currentTime);

  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => window.__syncStudio.seek(8.4333));
  const after = await page.evaluate(() => ({
    state: window.__syncStudio.getState(),
    canvas: window.__syncStudio.getCanvasDataUrl(),
  }));
  expect(after.state.offsetFrames).toBe(3);
  expect(after.state.reproduceKey).toBe(before.state.reproduceKey);
  expect(after.state.currentFrame).toBe(before.state.currentFrame);
  expect(after.canvas).toBe(before.canvas);
});

test("exports matching JSON and a playable fixed-30fps WebM", async ({ page }) => {
  await openStudio(page);
  await page.evaluate(() => {
    window.__syncStudio.setOffsetFrames(2);
    window.__syncStudio.seek(4.9);
  });

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.click("#jsonButton");
  const jsonDownload = await jsonDownloadPromise;
  await jsonDownload.saveAs(jsonPath);

  const offsetDocument = JSON.parse(await readFile(jsonPath, "utf8"));
  expect(offsetDocument.schema).toBe("eight-flash/offset@1");
  expect(offsetDocument.alignment.scope).toBe("global");
  expect(offsetDocument.alignment.perFrameOffsets).toBe(false);
  expect(offsetDocument.alignment.offsetFrames).toBe(2);
  expect(offsetDocument.alignment.offsetMs).toBeCloseTo(66.666667, 5);
  expect(offsetDocument.audioEvents).toHaveLength(8);
  expect(offsetDocument.flashes).toHaveLength(8);
  expect(offsetDocument.flashes[0].playbackTimeMs).toBeCloseTo(1266.666667, 5);

  const webmDownloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.click("#exportButton");
  const webmDownload = await webmDownloadPromise;
  await webmDownload.saveAs(exportPath);
  const exportState = await page.evaluate(() => window.__syncStudio.getState());
  expect(exportState.offsetFrames).toBe(2);
  expect(exportState.lastExport.exporter).toBe("webcodecs-fixed-fps");
  expect(exportState.lastExport.frameRate).toBe(30);
  expect(exportState.lastExport.frameCount).toBe(900);
  expect(exportState.lastExport.size).toBeGreaterThan(1_000_000);

  const decode = runFfmpeg(
    [
      "-hide_banner",
      "-i",
      exportPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-f",
      "null",
      "-",
    ],
  ).stderr.toString();
  expect(decode).toMatch(/frame=\s*900/);
  expect(decode).toMatch(/time=00:00:30\.00/);
  expect(decode).toMatch(/Video: vp8/);
  expect(decode).toMatch(/Audio: opus/);

  const browserPlayback = await page.evaluate(async () => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = "/artifacts/eight-flash-demo.webm";
    document.body.append(video);
    await new Promise((resolve, reject) => {
      video.addEventListener("loadedmetadata", resolve, { once: true });
      video.addEventListener("error", () => reject(video.error), { once: true });
      window.setTimeout(() => reject(new Error("video metadata timeout")), 10_000);
    });
    const metadata = {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    await video.play();
    await new Promise((resolve) => window.setTimeout(resolve, 550));
    video.pause();
    const result = {
      ...metadata,
      playedTo: video.currentTime,
      readyState: video.readyState,
    };
    video.remove();
    return result;
  });
  expect(browserPlayback.duration).toBeCloseTo(30, 1);
  expect(browserPlayback.width).toBe(960);
  expect(browserPlayback.height).toBe(540);
  expect(browserPlayback.playedTo).toBeGreaterThan(0.2);
  expect(browserPlayback.readyState).toBeGreaterThanOrEqual(2);

  const rawAudio = runFfmpeg(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      exportPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-f",
      "f32le",
      "-",
    ],
    20 * 1024 * 1024,
  ).stdout;
  const samples = new Float32Array(
    rawAudio.buffer,
    rawAudio.byteOffset,
    rawAudio.byteLength / 4,
  );
  const sampleRate = 48_000;
  const windowFrames = 240;
  const audioStarts = [];
  let activeGroup = null;
  for (let index = 0; index + windowFrames < samples.length; index += windowFrames) {
    let energy = 0;
    for (let offset = 0; offset < windowFrames; offset += 1) {
      energy += samples[index + offset] ** 2;
    }
    const rms = Math.sqrt(energy / windowFrames);
    const time = index / sampleRate;
    if (rms > 0.12) {
      if (!activeGroup || time - activeGroup.end > 0.08) {
        activeGroup = { start: time, end: time };
        audioStarts.push(activeGroup);
      } else {
        activeGroup.end = time;
      }
    }
  }
  expect(audioStarts).toHaveLength(8);
  audioStarts.forEach((group, index) => {
    expect(group.start).toBeCloseTo(accentTimes[index], 2);
  });

  const videoMetadata = runFfmpeg(
    [
      "-hide_banner",
      "-i",
      exportPath,
      "-an",
      "-vf",
      "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
      "-f",
      "null",
      "-",
    ],
  ).stderr.toString();
  const brightFrames = [];
  let currentTime = null;
  for (const line of videoMetadata.split("\n")) {
    const timeMatch = line.match(/pts_time:([0-9.]+)/);
    if (timeMatch) currentTime = Number(timeMatch[1]);
    const valueMatch = line.match(/YAVG=([0-9.]+)/);
    if (valueMatch && Number(valueMatch[1]) > 80 && currentTime !== null) {
      brightFrames.push(currentTime);
    }
  }
  const flashStarts = [];
  for (const time of brightFrames) {
    if (!flashStarts.length || time - flashStarts.at(-1) > 0.2) {
      flashStarts.push(time);
    }
  }
  expect(flashStarts).toHaveLength(8);
  flashStarts.forEach((time, index) => {
    expect(time - audioStarts[index].start).toBeCloseTo(2 / 30, 2);
  });
});
