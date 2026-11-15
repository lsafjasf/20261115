import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const ffprobePath = require("@ffprobe-installer/ffprobe").path;
const ffmpegPath = require("ffmpeg-static");
const VIDEO_PATH = "artifacts/night-signal-loop.webm";
const PROJECT_PATH = "artifacts/night-signal-project.json";
const API = "http://127.0.0.1:5173";

function probe(file) {
  const output = execFileSync(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,format_name:stream=index,codec_name,codec_type,width,height,channels,sample_rate",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output);
}

function inspectBeatEnvelope(file) {
  const pcm = execFileSync(
    ffmpegPath,
    [
      "-v",
      "error",
      "-i",
      file,
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "s16le",
      "-",
    ],
    { maxBuffer: 8 * 1024 * 1024, encoding: "buffer" },
  );
  const sampleRate = 8000;
  const samplesPerFrame = 80;
  const frameCount = Math.floor(pcm.length / 2 / samplesPerFrame);
  const energy = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let sample = 0; sample < samplesPerFrame; sample += 1) {
      const value = pcm.readInt16LE((frame * samplesPerFrame + sample) * 2) / 32768;
      sum += value * value;
    }
    energy[frame] = Math.sqrt(sum / samplesPerFrame);
  }

  const peak = Math.max(...energy);
  const threshold = Math.max(0.01, peak * 0.11);
  let bestOffset = 0;
  let bestAudible = -1;
  for (let offset = 0; offset <= 0.34; offset += 0.005) {
    let audible = 0;
    for (let beat = 0; beat < 24; beat += 1) {
      const center = Math.floor(((offset + beat * 0.5) * 100));
      let windowPeak = 0;
      for (let frame = center - 8; frame <= center + 10; frame += 1) {
        if (frame >= 0 && frame < energy.length) windowPeak = Math.max(windowPeak, energy[frame]);
      }
      if (windowPeak >= threshold) audible += 1;
    }
    if (audible > bestAudible) {
      bestAudible = audible;
      bestOffset = offset;
    }
  }

  const beats = Array.from({ length: 24 }, (_, beat) => {
    const center = Math.floor((bestOffset + beat * 0.5) * 100);
    let windowPeak = 0;
    for (let frame = center - 8; frame <= center + 10; frame += 1) {
      if (frame >= 0 && frame < energy.length) windowPeak = Math.max(windowPeak, energy[frame]);
    }
    return windowPeak >= threshold;
  });

  return {
    duration: pcm.length / 2 / sampleRate,
    peak: Number(peak.toFixed(4)),
    threshold: Number(threshold.toFixed(4)),
    offset: Number(bestOffset.toFixed(3)),
    audibleBeats: beats.filter(Boolean).length,
    totalBeats: 24,
    allBeatsAudible: beats.every(Boolean),
  };
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-features=AudioServiceOutOfProcess",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => localStorage.clear());
await page.goto(API, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__pulse));

const initial = await page.evaluate(() => ({
  duration: window.__pulse.project.duration,
  layers: window.__pulse.project.layers.map((layer) => ({
    id: layer.id,
    positionKeys: layer.tracks.position.length,
    opacityKeys: layer.tracks.opacity.length,
    colorKeys: layer.tracks.color.length,
  })),
}));

const timelineBox = await page.locator("#timelineMain").boundingBox();
await page.mouse.move(timelineBox.x + timelineBox.width * 0.25, timelineBox.y + 20);
await page.mouse.down();
await page.mouse.move(timelineBox.x + timelineBox.width * 0.42, timelineBox.y + 20, {
  steps: 12,
});
await page.mouse.up();
const draggedTime = await page.evaluate(() => window.__pulse.time);

await page.evaluate(() => {
  window.__pulse.selectLayer("info", "opacity");
  window.__pulse.setTime(4.2);
});
const beforeKeys = await page.evaluate(
  () => window.__pulse.project.layers.find((layer) => layer.id === "info").tracks.opacity.length,
);
await page.locator('[data-keyframe-property="opacity"]').click();
const afterKeys = await page.evaluate(
  () => window.__pulse.project.layers.find((layer) => layer.id === "info").tracks.opacity.length,
);

const jsonDownloadPromise = page.waitForEvent("download");
await page.click("#saveButton");
const jsonDownload = await jsonDownloadPromise;
await jsonDownload.saveAs(PROJECT_PATH);
const savedProject = JSON.parse(await readFile(PROJECT_PATH, "utf8"));

await page.evaluate(() => window.__pulse.setTime(3.4));
await page.screenshot({ path: "artifacts/editor-keyframe.png", fullPage: true });

await page.click("#playButton");
await page.waitForTimeout(550);
const playback = await page.evaluate(() => ({
  time: window.__pulse.time,
  audioState: window.__pulse.audio.context.state,
}));
await page.click("#playButton");

await page.click("#exportButton");
await page.waitForFunction(
  () => window.__pulse.lastExport && window.__pulse.replayVisible,
  null,
  { timeout: 25000 },
);

const replayDownloadPromise = page.waitForEvent("download");
await page.click("#downloadLink");
const replayDownload = await replayDownloadPromise;
await replayDownload.saveAs(VIDEO_PATH);

const replay = await page.evaluate(async () => {
  const video = document.querySelector("#replayVideo");
  await video.play().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1050));
  const playbackTime = video.currentTime;
  let loopDetected = false;
  let crossedEnd = false;
  const onTimeUpdate = () => {
    if (video.currentTime > 11.5) crossedEnd = true;
    if (crossedEnd && video.currentTime < 1.4) loopDetected = true;
  };
  video.addEventListener("timeupdate", onTimeUpdate);
  await new Promise((resolve) => {
    const started = performance.now();
    const timer = setInterval(() => {
      if (loopDetected || performance.now() - started > 14_000) {
        clearInterval(timer);
        resolve();
      }
    }, 80);
  });
  video.removeEventListener("timeupdate", onTimeUpdate);
  await new Promise((resolve) => {
    const done = () => resolve();
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = 4.1;
  });
  return {
    readyState: video.readyState,
    playbackAdvanced: playbackTime > 0.35,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    currentTime: video.currentTime,
    loop: video.loop,
    loopDetected,
  };
});
await page.waitForTimeout(500);
await page.screenshot({ path: "artifacts/export-replay.png", fullPage: true });

await browser.close();

const media = probe(VIDEO_PATH);
const audio = inspectBeatEnvelope(VIDEO_PATH);
const videoStream = media.streams.find((stream) => stream.codec_type === "video");
const audioStream = media.streams.find((stream) => stream.codec_type === "audio");
const decodedDuration = Number(audio.duration.toFixed(2));
const report = {
  initial,
  interactions: {
    draggedTime: Number(draggedTime.toFixed(2)),
    jsonKeysAdded: afterKeys - beforeKeys,
    savedProjectLayers: savedProject.layers.length,
    previewPlaybackAdvanced: playback.time > 0.3,
    audioState: playback.audioState,
  },
  replay,
  media: {
    format: media.format.format_name,
    duration: Number(media.format.duration) || decodedDuration,
    durationSource: Number(media.format.duration) ? "container" : "decoded audio track",
    videoCodec: videoStream?.codec_name,
    width: videoStream?.width,
    height: videoStream?.height,
    audioCodec: audioStream?.codec_name,
    sampleRate: audioStream?.sample_rate,
    channels: audioStream?.channels,
    bytes: (await readFile(VIDEO_PATH)).byteLength,
  },
  beats: audio,
  errors,
};

await writeFile("artifacts/verification.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const checks = [
  initial.duration === 12,
  initial.layers.length === 3,
  Math.abs(draggedTime - 5.04) < 0.35,
  afterKeys === beforeKeys + 1,
  savedProject.layers.length === 3,
  playback.time > 0.3,
  replay.videoWidth === 1080,
  replay.videoHeight === 1350,
  replay.loop,
  replay.loopDetected,
  media.format.format_name.includes("matroska"),
  videoStream?.codec_name === "vp9",
  audioStream?.codec_name === "opus",
  decodedDuration >= 12 && decodedDuration <= 12.4,
  audio.allBeatsAudible,
  errors.length === 0,
];
if (!checks.every(Boolean)) {
  console.error("Verification failed", checks);
  process.exitCode = 1;
}
