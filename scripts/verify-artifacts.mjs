import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const artifactUrl = (name) => new URL(`../artifacts/${name}`, import.meta.url);

function parsePcmWav(buffer, filename) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF", `${filename}: 缺少 RIFF`);
  assert.equal(buffer.toString("ascii", 8, 12), "WAVE", `${filename}: 缺少 WAVE`);
  assert.equal(buffer.toString("ascii", 12, 16), "fmt ", `${filename}: 缺少 fmt 块`);
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const dataLength = buffer.readUInt32LE(40);
  const frameCount = dataLength / (channels * (bitsPerSample / 8));
  const dataOffset = 44;
  let peak = 0;
  let energy = 0;
  let nonZero = 0;
  for (let index = 0; index < frameCount; index += 1) {
    const value = buffer.readInt16LE(dataOffset + index * 2) / 32768;
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
    if (Math.abs(value) > 1e-4) nonZero += 1;
  }
  return {
    channels,
    sampleRate,
    bitsPerSample,
    frames: frameCount,
    duration: frameCount / sampleRate,
    peak,
    rms: Math.sqrt(energy / Math.max(1, frameCount)),
    nonZero,
  };
}

const config = JSON.parse(await readFile(artifactUrl("sampler-config.json"), "utf8"));
const verification = JSON.parse(await readFile(artifactUrl("verification.json"), "utf8"));

assert.equal(config.samples.length, 4, "配置必须包含四段采样");
assert.equal(verification.checks.fourSlices, true);
assert.equal(verification.passed, true, "生成阶段检查未通过");

const seamSample = config.samples.find((sample) => sample.name === "XSeam");
assert.ok(seamSample, "缺少 XSeam 采样");
assert.equal(seamSample.requestedEnd, 2.15);
assert.equal(seamSample.end, 2);
assert.equal(seamSample.truncatedAtLoop, true);
assert.equal(seamSample.key, "F");

const results = [];
for (const sample of config.samples) {
  const filename = `slice-${sample.name}.wav`;
  const wav = parsePcmWav(await readFile(artifactUrl(filename)), filename);
  assert.equal(wav.channels, 1, `${filename}: 必须为单声道`);
  assert.equal(wav.sampleRate, 44100, `${filename}: 采样率必须为 44100`);
  assert.equal(wav.bitsPerSample, 16, `${filename}: 必须为 16-bit PCM`);
  assert.ok(wav.peak > 0.05, `${filename}: 切片静音`);
  assert.ok(wav.rms > 0.005, `${filename}: 切片能量过低`);
  results.push({ filename, ...wav });
}

const seamWav = results.find((result) => result.filename === "slice-XSeam.wav");
assert.equal(seamWav.frames, 6615, "接缝切片应恰好保留 1.85s-2.00s");
assert.ok(Math.abs(seamWav.duration - 0.15) < 1e-9, "接缝切片时长必须为 0.15s");
assert.ok(seamWav.duration < 0.3, "接缝之外的 0.15s 必须被截断");

const sequenceWav = parsePcmWav(await readFile(artifactUrl("sequence.wav")), "sequence.wav");
assert.equal(sequenceWav.channels, 1);
assert.equal(sequenceWav.sampleRate, 44100);
assert.equal(sequenceWav.frames, 88200, "音序长度必须等于 2 秒循环");
assert.ok(Math.abs(sequenceWav.duration - 2) < 1e-9);
assert.ok(sequenceWav.peak > 0.3, "音序回放无峰值");
assert.ok(sequenceWav.rms > 0.01, "音序回放能量过低");
assert.ok(sequenceWav.nonZero > 10000, "音序回放有效采样过少");
assert.equal(verification.files.at(-1).sequence.priorityCuts.length, 2, "应记录两次最新触发抢占");
assert.deepEqual(
  verification.files.at(-1).sequence.priorityCuts.map((event) => event.sampleId),
  [1, 3],
);

console.log(JSON.stringify({
  ok: true,
  samples: results.map(({ filename, frames, duration, peak, rms }) => ({
    filename,
    frames,
    duration,
    peak: Number(peak.toFixed(4)),
    rms: Number(rms.toFixed(4)),
  })),
  sequence: {
    frames: sequenceWav.frames,
    duration: sequenceWav.duration,
    peak: Number(sequenceWav.peak.toFixed(4)),
    rms: Number(sequenceWav.rms.toFixed(4)),
    priorityCuts: verification.files.at(-1).sequence.priorityCuts,
  },
}, null, 2));
