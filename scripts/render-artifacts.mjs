import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  DEFAULT_CONFIG,
  DEFAULT_SAMPLE_RATE,
  encodeWav,
  extractSlice,
  makeExportConfig,
  normalizeConfig,
  renderSequence,
  resolveSample,
  synthesizeDrumLoop,
} from "../src/audio-model.js";

const outputDirectory = new URL("../artifacts/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });

const sampleRate = DEFAULT_SAMPLE_RATE;
const config = normalizeConfig(structuredClone(DEFAULT_CONFIG), sampleRate);
const source = synthesizeDrumLoop(sampleRate, config.loopLength);
const exportedConfig = makeExportConfig(config);
const generated = [];

function analyze(pcm) {
  let peak = 0;
  let energy = 0;
  let firstNonZero = -1;
  let lastNonZero = -1;
  for (let index = 0; index < pcm.length; index += 1) {
    const value = pcm[index];
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
    if (Math.abs(value) > 1e-5) {
      if (firstNonZero < 0) firstNonZero = index;
      lastNonZero = index;
    }
  }
  return {
    frames: pcm.length,
    duration: pcm.length / sampleRate,
    peak: Number(peak.toFixed(6)),
    rms: Number(Math.sqrt(energy / Math.max(1, pcm.length)).toFixed(6)),
    firstNonZero,
    lastNonZero,
  };
}

async function writeWav(name, pcm) {
  const wav = encodeWav(pcm, sampleRate);
  await writeFile(new URL(name, outputDirectory), new Uint8Array(wav));
  const analysis = analyze(pcm);
  generated.push({
    file: name,
    bytes: wav.byteLength,
    sha256: createHash("sha256").update(new Uint8Array(wav)).digest("hex"),
    ...analysis,
  });
}

for (const sample of config.samples) {
  const resolved = resolveSample(sample, config.loopLength);
  const slice = extractSlice(source, sampleRate, sample);
  await writeWav(`slice-${sample.name}.wav`, slice.pcm);
  generated.at(-1).sample = {
    id: sample.id,
    name: sample.name,
    key: sample.key,
    requestedEnd: resolved.requestedEnd,
    resolvedEnd: resolved.end,
    fadeIn: resolved.fadeIn,
    fadeOut: resolved.fadeOut,
    truncatedAtLoop: resolved.truncatedAtLoop,
  };
}

const sequence = renderSequence(source, sampleRate, config);
await writeWav("sequence.wav", sequence.pcm);
generated.at(-1).sequence = {
  events: sequence.events,
  priorityCuts: sequence.priorityCuts.map((event) => ({
    sampleId: event.sampleId,
    chokedBy: event.chokedBy,
    at: event.playedEnd,
  })),
  truncatedSamples: sequence.truncatedSamples.map((sample) => sample.name),
};

await writeFile(
  new URL("sampler-config.json", outputDirectory),
  `${JSON.stringify(exportedConfig, null, 2)}\n`,
);

const seamSample = sequence.truncatedSamples[0];
const checks = {
  fourSlices: config.samples.length === 4,
  fourSliceFiles: generated.filter((item) => item.sample).length === 4,
  seamTruncated: Boolean(seamSample) && seamSample.duration < 0.3,
  seamFrames: generated.find((item) => item.sample?.name === "XSeam")?.frames === 6615,
  sequenceDuration: sequence.duration === config.loopLength,
  sequenceNonSilent: analyze(sequence.pcm).rms > 0.01,
  priorityCuts: sequence.priorityCuts.length === 2,
};

await writeFile(
  new URL("verification.json", outputDirectory),
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    sampleRate,
    loopLength: config.loopLength,
    checks,
    passed: Object.values(checks).every(Boolean),
    files: generated,
  }, null, 2)}\n`,
);

if (!Object.values(checks).every(Boolean)) {
  throw new Error(`产物验证失败: ${JSON.stringify(checks)}`);
}

console.log(`Generated ${generated.length} WAV files and sampler-config.json`);
console.log(`Sequence: ${sequence.pcm.length} frames, ${sequence.priorityCuts.length} priority cuts`);
console.log(`Seam sample: ${seamSample.name} ${seamSample.start}-${seamSample.end}s requested=${seamSample.requestedEnd}s`);
