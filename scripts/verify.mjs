import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  DEFAULT_CHAIN,
  cloneChain,
  synthesizeTestRecording,
  renderChain,
  analyzeSignal,
  detectClipping,
  encodeGuardedWav,
} from "../js/dsp.js";
import { ClippingError, inspectWav } from "../js/wav.js";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });

function writeWav(name, bytes) {
  const target = path.join(artifacts, name);
  fs.writeFileSync(target, bytes);
  return target;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const startedAt = new Date();
const source = synthesizeTestRecording();
const sourceAnalysis = analyzeSignal(source);
const sourceExport = encodeGuardedWav(source);
const inputPath = writeWav("test-input.wav", sourceExport.bytes);
const inputHeader = inspectWav(sourceExport.bytes);

const denoiseChain = cloneChain(DEFAULT_CHAIN);
const denoised = renderChain(source, denoiseChain);
const denoiseAnalysis = analyzeSignal(denoised);
const denoiseClipping = detectClipping(denoised);
const denoiseExport = encodeGuardedWav(denoised, { bitDepth: 24 });
const outputPath = writeWav("denoised-output.wav", denoiseExport.bytes);
const outputHeader = inspectWav(denoiseExport.bytes);
const noiseImprovement = sourceAnalysis.noiseFloorDb - denoiseAnalysis.noiseFloorDb;

const clippingChain = cloneChain(DEFAULT_CHAIN);
const outputTrim = clippingChain.find((module) => module.type === "gain");
outputTrim.params.gain = 18;
const clippedRender = renderChain(source, clippingChain);
const clippingResult = detectClipping(clippedRender);
let clippingBlocked = false;
let clippingError = null;
try {
  encodeGuardedWav(clippedRender);
} catch (error) {
  if (!(error instanceof ClippingError)) throw error;
  clippingBlocked = true;
  clippingError = error.info;
}

const wavPass = outputHeader.valid
  && outputHeader.channels === 2
  && outputHeader.bitsPerSample === 24
  && outputHeader.frames === source.frameCount
  && Math.abs(outputHeader.duration - source.duration) < 1e-9;
const denoisePass = noiseImprovement >= 3 && !denoiseClipping.clipped;
const clipPass = clippingResult.clipped && clippingBlocked;

assert(inputHeader.valid, "Input WAV header is invalid");
assert(denoisePass, "Denoise test did not reduce the noise floor by 3 dB");
assert(clipPass, "Intentional clipping was not blocked");
assert(wavPass, "Exported WAV length or channel count mismatch");
assert(!fs.existsSync(path.join(artifacts, "clipped-export.wav")), "Clipped file unexpectedly exists");

const report = {
  generatedAt: new Date().toISOString(),
  source: {
    file: path.relative(root, inputPath),
    duration: inputHeader.duration,
    channels: inputHeader.channels,
    sampleRate: inputHeader.sampleRate,
    bitsPerSample: inputHeader.bitsPerSample,
    frames: inputHeader.frames,
    peakDbFS: Number(sourceAnalysis.peakDb.toFixed(3)),
    noiseFloorDbFS: Number(sourceAnalysis.noiseFloorDb.toFixed(3)),
    sha256: sha256(sourceExport.bytes),
  },
  denoise: {
    file: path.relative(root, outputPath),
    chain: denoiseChain.map(({ type, enabled, params }) => ({ type, enabled, params })),
    noiseFloorBeforeDbFS: Number(sourceAnalysis.noiseFloorDb.toFixed(3)),
    noiseFloorAfterDbFS: Number(denoiseAnalysis.noiseFloorDb.toFixed(3)),
    noiseReductionDb: Number(noiseImprovement.toFixed(3)),
    peakDbFS: Number(denoiseAnalysis.peakDb.toFixed(3)),
    clippedSamples: denoiseClipping.clippedSamples,
    pass: denoisePass,
  },
  deliberateClipping: {
    injectedOutputGainDb: 18,
    peakDbFS: Number(clippingResult.peakDb.toFixed(3)),
    clippedSamples: clippingResult.clippedSamples,
    firstClip: clippingResult.first,
    guardTripped: clippingResult.clipped,
    fileWriteBlocked: clippingBlocked,
    blockedPeakDbFS: Number(clippingError?.peakDb.toFixed(3)),
    pass: clipPass,
  },
  exportedWavCheck: {
    file: path.relative(root, outputPath),
    durationSeconds: outputHeader.duration,
    channels: outputHeader.channels,
    sampleRate: outputHeader.sampleRate,
    bitsPerSample: outputHeader.bitsPerSample,
    frames: outputHeader.frames,
    dataBytes: outputHeader.dataSize,
    sha256: sha256(denoiseExport.bytes),
    pass: wavPass,
  },
  overallPass: denoisePass && clipPass && wavPass,
  elapsedSeconds: Number(((Date.now() - startedAt.getTime()) / 1000).toFixed(3)),
};

const reportPath = path.join(artifacts, "verification-report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`PHASE / 302 acceptance: ${report.overallPass ? "PASS" : "FAIL"}`);
console.log(`Input:   ${path.relative(root, inputPath)} · ${inputHeader.duration.toFixed(3)} s · ${inputHeader.channels} ch`);
console.log(`Denoise: ${noiseImprovement.toFixed(2)} dB noise reduction · peak ${denoiseAnalysis.peakDb.toFixed(2)} dBFS`);
console.log(`Clipping: +18 dB → peak ${clippingResult.peakDb.toFixed(2)} dBFS · ${clippingResult.clippedSamples} samples · blocked=${clippingBlocked}`);
console.log(`Export:  ${path.relative(root, outputPath)} · ${outputHeader.duration.toFixed(3)} s · ${outputHeader.channels} ch · ${outputHeader.bitsPerSample}-bit`);
console.log(`Report:  ${path.relative(root, reportPath)}`);
