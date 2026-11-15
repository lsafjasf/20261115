import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  DEFAULT_SAMPLE_RATE,
  encodeWav,
  extractSlice,
  normalizeConfig,
  renderSequence,
  resolveSample,
  synthesizeDrumLoop,
} from "../src/audio-model.js";

const sampleRate = DEFAULT_SAMPLE_RATE;
const source = synthesizeDrumLoop(sampleRate, 2);
const config = normalizeConfig(structuredClone(DEFAULT_CONFIG), sampleRate);

function peakOf(pcm) {
  let peak = 0;
  for (const value of pcm) peak = Math.max(peak, Math.abs(value));
  return peak;
}

function rmsOf(pcm, startFrame = 0, endFrame = pcm.length) {
  let sum = 0;
  for (let index = startFrame; index < endFrame; index += 1) sum += pcm[index] ** 2;
  return Math.sqrt(sum / Math.max(1, endFrame - startFrame));
}

test("synthesizes a deterministic 2 second drum loop", () => {
  assert.equal(source.length, 88200);
  assert.ok(peakOf(source) > 0.8);
  assert.ok(peakOf(source) <= 0.9);
  const secondPass = synthesizeDrumLoop(sampleRate, 2);
  assert.deepEqual(secondPass, source);
});

test("resolves four named samples and truncates XSeam at the loop seam", () => {
  assert.deepEqual(config.samples.map((sample) => sample.name), ["Kick", "Snare", "Hat", "XSeam"]);
  assert.deepEqual(config.samples.map((sample) => sample.key), ["A", "S", "D", "F"]);
  const seam = resolveSample(config.samples[3], config.loopLength);
  assert.equal(seam.start, 1.85);
  assert.equal(seam.requestedEnd, 2.15);
  assert.equal(seam.end, 2);
  assert.equal(seam.duration, 0.15);
  assert.equal(seam.truncatedAtLoop, true);
  const slice = extractSlice(source, sampleRate, config.samples[3]);
  assert.equal(slice.frameCount, 6615);
  assert.ok(peakOf(slice.pcm) > 0.1);
  assert.ok(Math.abs(slice.pcm[0]) < 1e-5, "fade-in must start at zero");
  assert.ok(Math.abs(slice.pcm.at(-1)) < 1e-5, "fade-out must end at zero");
});

test("produces four non-silent 16-bit mono slices with fades", () => {
  for (const sample of config.samples) {
    const slice = extractSlice(source, sampleRate, sample);
    assert.ok(slice.frameCount > 1000);
    assert.ok(peakOf(slice.pcm) > 0.05);
    assert.ok(rmsOf(slice.pcm) > 0.005);
    const wav = new DataView(encodeWav(slice.pcm, sampleRate));
    assert.equal(String.fromCharCode(...new Uint8Array(wav.buffer, 0, 4)), "RIFF");
    assert.equal(wav.getUint16(22, true), 1, "mono");
    assert.equal(wav.getUint16(34, true), 16, "16-bit");
    assert.equal(wav.getUint32(40, true), slice.frameCount * 2);
  }
});

test("renders a 2 second sequence and reports latest-trigger priority cuts", () => {
  const rendered = renderSequence(source, sampleRate, config);
  assert.equal(rendered.pcm.length, 88200);
  assert.equal(rendered.duration, 2);
  assert.ok(peakOf(rendered.pcm) > 0.3);
  assert.ok(rmsOf(rendered.pcm) > 0.01);
  assert.deepEqual(rendered.priorityCuts.map((event) => event.sampleId), [1, 3]);
  assert.deepEqual(rendered.priorityCuts.map((event) => event.chokedBy), [2, 4]);
  assert.ok(Math.abs(rendered.events[0].playedEnd - 0.22) < 1e-6);
  assert.ok(Math.abs(rendered.events[2].playedEnd - 0.79) < 1e-6);
  assert.ok(Math.abs(rendered.events[3].playedEnd - 0.94) < 1e-6);
  rendered.events.forEach((event) => {
    const start = Math.round(event.start * sampleRate);
    const end = Math.round(event.playedEnd * sampleRate);
    assert.ok(rmsOf(rendered.pcm, start, end) > 0.005, `${event.name} event must be audible`);
  });
  const tailStart = Math.round(0.95 * sampleRate);
  assert.ok(rmsOf(rendered.pcm, tailStart) < 1e-6, "sequence tail must be silent");
});

test("clamps edits beyond the seam to the playable loop", () => {
  const edited = resolveSample({
    id: 9,
    name: "Edited",
    start: 1.9,
    requestedEnd: 2.4,
    fadeIn: 0.03,
    fadeOut: 0.2,
    key: "G",
  }, 2);
  assert.equal(edited.end, 2);
  assert.equal(edited.duration, 0.1);
  assert.equal(edited.truncatedAtLoop, true);
  assert.ok(edited.fadeIn <= edited.duration);
  assert.ok(edited.fadeOut <= edited.duration);
});

test("rejects malformed or conflicting imported config", () => {
  assert.throws(() => normalizeConfig({ ...config, loopLength: 0 }), /loopLength/);
  const duplicate = structuredClone(DEFAULT_CONFIG);
  duplicate.samples[1].key = duplicate.samples[0].key;
  assert.throws(() => normalizeConfig(duplicate), /触发键 A 重复/);
});
