import { spawnSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const artifacts = join(process.cwd(), "artifacts");
const webmPath = join(artifacts, "eight-flash-demo.webm");
const jsonPath = join(artifacts, "eight-flash-offset.json");
const reportPath = join(artifacts, "verification.json");

function runFfmpeg(args, maxBuffer = 50 * 1024 * 1024) {
  const result = spawnSync(ffmpegPath, args, { maxBuffer });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(result.stderr.toString());
  }
  return result;
}

const offsetDocument = JSON.parse(await readFile(jsonPath, "utf8"));
const fileInfo = await stat(webmPath);

const decodeResult = runFfmpeg([
  "-hide_banner",
  "-i",
  webmPath,
  "-map",
  "0:v:0",
  "-map",
  "0:a:0",
  "-f",
  "null",
  "-",
]);
const decodeLog = decodeResult.stderr.toString();
const frameMatches = [...decodeLog.matchAll(/frame=\s*(\d+)/g)];
const durationMatches = [...decodeLog.matchAll(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/g)];
const frameCount = Number(frameMatches.at(-1)?.[1]);
const decodedDuration = durationMatches.at(-1)?.[1];

const metadataResult = runFfmpeg([
  "-hide_banner",
  "-i",
  webmPath,
  "-an",
  "-vf",
  "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
  "-f",
  "null",
  "-",
]);
const metadataLog = metadataResult.stderr.toString();
const brightFrames = [];
let currentTime = null;
for (const line of metadataLog.split("\n")) {
  const timeMatch = line.match(/pts_time:([0-9.]+)/);
  if (timeMatch) currentTime = Number(timeMatch[1]);
  const valueMatch = line.match(/YAVG=([0-9.]+)/);
  if (valueMatch && Number(valueMatch[1]) > 80 && currentTime !== null) {
    brightFrames.push(currentTime);
  }
}
const flashTimes = [];
for (const time of brightFrames) {
  if (!flashTimes.length || time - flashTimes.at(-1) > 0.2) {
    flashTimes.push(time);
  }
}

const audioResult = runFfmpeg(
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    webmPath,
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
);
const audioBytes = audioResult.stdout;
const samples = new Float32Array(
  audioBytes.buffer,
  audioBytes.byteOffset,
  audioBytes.byteLength / 4,
);
const sampleRate = 48_000;
const rmsWindow = 240;
const audioStarts = [];
let activeGroup = null;
for (let index = 0; index + rmsWindow < samples.length; index += rmsWindow) {
  let energy = 0;
  for (let offset = 0; offset < rmsWindow; offset += 1) {
    energy += samples[index + offset] ** 2;
  }
  const rms = Math.sqrt(energy / rmsWindow);
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

const measuredOffsetsMs = flashTimes.map((time, index) =>
  Number(((time - audioStarts[index].start) * 1000).toFixed(3)),
);
const expectedOffsetMs = offsetDocument.alignment.offsetMs;
const maxErrorMs = Math.max(
  ...measuredOffsetsMs.map((value) => Math.abs(value - expectedOffsetMs)),
);
const passed =
  frameCount === offsetDocument.timeline.totalFrames &&
  decodedDuration === "00:00:30.00" &&
  flashTimes.length === 8 &&
  audioStarts.length === 8 &&
  maxErrorMs <= 40;

const report = {
  checkedAt: new Date().toISOString(),
  source: {
    webm: "artifacts/eight-flash-demo.webm",
    offsetJson: "artifacts/eight-flash-offset.json",
    sizeBytes: fileInfo.size,
  },
  container: {
    format: "WebM",
    fullDecodePassed: decodeResult.status === 0,
    decodedDuration,
    frameCount,
  },
  video: {
    codec: "VP8",
    width: 960,
    height: 540,
    fps: 30,
    flashes: flashTimes.length,
    flashOnsetTimesSec: flashTimes,
  },
  audio: {
    codec: "Opus",
    sampleRate,
    channels: 2,
    accents: audioStarts.length,
    accentOnsetTimesSec: audioStarts.map((group) =>
      Number(group.start.toFixed(3)),
    ),
  },
  alignment: {
    offsetFrames: offsetDocument.alignment.offsetFrames,
    expectedOffsetMs,
    measuredOffsetsMs,
    maxErrorMs: Number(maxErrorMs.toFixed(3)),
    toleranceMs: 40,
  },
  passed,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;
