export const DEFAULT_SAMPLE_RATE = 44100;
export const DEFAULT_LOOP_LENGTH = 2;
export const DEFAULT_BPM = 120;
export const PRIORITY_FADE_SECONDS = 0.008;

export const TRIGGER_KEYS = [
  "A", "S", "D", "F", "G", "H", "J", "K", "L", "Q", "W", "E", "R", "T",
  "Y", "U", "I", "O", "P", "Z", "X", "C", "V", "B", "N", "M", "1", "2",
  "3", "4", "5", "6", "7", "8", "9",
];

export const PRESET_SAMPLES = [
  { id: 1, name: "Kick", start: 0, requestedEnd: 0.3, fadeIn: 0.003, fadeOut: 0.06, key: "A" },
  { id: 2, name: "Snare", start: 0.5, requestedEnd: 0.72, fadeIn: 0.003, fadeOut: 0.05, key: "S" },
  { id: 3, name: "Hat", start: 0.25, requestedEnd: 0.31, fadeIn: 0.002, fadeOut: 0.02, key: "D" },
  { id: 4, name: "XSeam", start: 1.85, requestedEnd: 2.15, fadeIn: 0.01, fadeOut: 0.08, key: "F" },
];

export const PRESET_SEQUENCE = [
  { time: 0, sampleId: 1 },
  { time: 0.22, sampleId: 2 },
  { time: 0.75, sampleId: 3 },
  { time: 0.79, sampleId: 4 },
];

export const DEFAULT_CONFIG = {
  version: 1,
  bpm: DEFAULT_BPM,
  loopLength: DEFAULT_LOOP_LENGTH,
  sampleRate: DEFAULT_SAMPLE_RATE,
  samples: PRESET_SAMPLES,
  sequence: PRESET_SEQUENCE,
};

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundTime(value) {
  return Math.round(value * 1e6) / 1e6;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function wrapIndex(index, frameCount) {
  return ((index % frameCount) + frameCount) % frameCount;
}

export function resolveSample(sample, loopLength = DEFAULT_LOOP_LENGTH) {
  const requestedStart = Number.isFinite(Number(sample.start)) ? Number(sample.start) : 0;
  const requestedEnd = Number.isFinite(Number(sample.requestedEnd ?? sample.end))
    ? Number(sample.requestedEnd ?? sample.end)
    : requestedStart;
  const start = clamp(requestedStart, 0, loopLength);
  const end = clamp(requestedEnd, start, loopLength);
  const duration = Math.max(0, end - start);
  const fadeIn = clamp(Number(sample.fadeIn) || 0, 0, duration);
  const fadeOut = clamp(Number(sample.fadeOut) || 0, 0, duration);
  return {
    ...sample,
    start: roundTime(start),
    end: roundTime(end),
    requestedStart: roundTime(requestedStart),
    requestedEnd: roundTime(requestedEnd),
    duration: roundTime(duration),
    fadeIn: roundTime(fadeIn),
    fadeOut: roundTime(fadeOut),
    truncatedAtLoop: requestedStart < loopLength && requestedEnd > loopLength,
    outsideLoop: requestedStart >= loopLength,
  };
}

function addKick(target, sampleRate, start, gain, seed) {
  const length = Math.floor(sampleRate * 0.36);
  const first = Math.floor(start * sampleRate);
  for (let offset = 0; offset < length; offset += 1) {
    const time = offset / sampleRate;
    const envelope = Math.exp(-time * 26) * gain;
    const phase = 2 * Math.PI * (52 * time + 11 * (1 - Math.exp(-time * 16)));
    target[wrapIndex(first + offset, target.length)] += Math.sin(phase) * envelope;
    if (offset < 8) {
      target[wrapIndex(first + offset, target.length)] += (1 - offset / 8) * gain * 0.28;
    }
  }
  return seed + 17;
}

function addSnare(target, sampleRate, start, gain, seed) {
  const random = mulberry32(seed);
  const length = Math.floor(sampleRate * 0.24);
  const first = Math.floor(start * sampleRate);
  let previousNoise = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const time = offset / sampleRate;
    const noise = random() * 2 - 1;
    const brightNoise = noise - previousNoise * 0.55;
    previousNoise = noise;
    const envelope = Math.exp(-time * 15) * gain;
    const body = Math.sin(2 * Math.PI * 182 * time) * Math.exp(-time * 34) * 0.28;
    target[wrapIndex(first + offset, target.length)] += (brightNoise * 0.56 + body) * envelope;
  }
  return seed + 31;
}

function addHat(target, sampleRate, start, gain, seed) {
  const random = mulberry32(seed);
  const length = Math.floor(sampleRate * 0.11);
  const first = Math.floor(start * sampleRate);
  let previousNoise = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const time = offset / sampleRate;
    const noise = random() * 2 - 1;
    const highPassed = noise - previousNoise;
    previousNoise = noise;
    const metallic = Math.sin(2 * Math.PI * 2380 * time) + Math.sin(2 * Math.PI * 3170 * time) * 0.35;
    const envelope = Math.exp(-time * 48) * gain;
    target[wrapIndex(first + offset, target.length)] += (highPassed * 0.42 + metallic * 0.18) * envelope;
  }
  return seed + 47;
}

function addSeamTail(target, sampleRate, start, gain, seed) {
  const random = mulberry32(seed);
  const length = Math.floor(sampleRate * 0.31);
  const first = Math.floor(start * sampleRate);
  let previousNoise = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const time = offset / sampleRate;
    const noise = random() * 2 - 1;
    const highPassed = noise - previousNoise * 0.7;
    previousNoise = noise;
    const envelope = Math.exp(-time * 14) * gain;
    const lowTail = Math.sin(2 * Math.PI * (43 + 18 * Math.exp(-time * 10)) * time);
    target[wrapIndex(first + offset, target.length)] +=
      (lowTail * 0.54 + highPassed * 0.32) * envelope;
  }
  return seed + 59;
}

export function synthesizeDrumLoop(
  sampleRate = DEFAULT_SAMPLE_RATE,
  loopLength = DEFAULT_LOOP_LENGTH,
) {
  const frameCount = Math.max(1, Math.round(sampleRate * loopLength));
  const target = new Float32Array(frameCount);
  let seed = 0x275a;
  const hits = [
    ["kick", 0, 0.84],
    ["hat", 0.25, 0.34],
    ["snare", 0.5, 0.73],
    ["hat", 0.75, 0.28],
    ["kick", 1.0, 0.78],
    ["hat", 1.25, 0.33],
    ["snare", 1.5, 0.7],
    ["hat", 1.75, 0.3],
    ["seam", 1.84, 0.82],
  ];
  for (const [kind, start, gain] of hits) {
    if (kind === "kick") seed = addKick(target, sampleRate, start, gain, seed);
    if (kind === "snare") seed = addSnare(target, sampleRate, start, gain, seed);
    if (kind === "hat") seed = addHat(target, sampleRate, start, gain, seed);
    if (kind === "seam") seed = addSeamTail(target, sampleRate, start, gain, seed);
  }
  let peak = 0;
  for (let index = 0; index < frameCount; index += 1) {
    target[index] = Math.tanh(target[index] * 1.15);
    peak = Math.max(peak, Math.abs(target[index]));
  }
  const scale = peak > 0 ? 0.9 / peak : 1;
  for (let index = 0; index < frameCount; index += 1) target[index] *= scale;
  return target;
}

export function sampleEnvelopeAt(time, duration, fadeIn, fadeOut) {
  if (time < 0 || time >= duration) return 0;
  let gain = 1;
  if (fadeIn > 0 && time < fadeIn) gain *= time / fadeIn;
  const fromEnd = duration - time;
  if (fadeOut > 0 && fromEnd < fadeOut) gain *= Math.max(0, fromEnd / fadeOut);
  return Math.max(0, gain);
}

export function extractSlice(source, sampleRate, sample) {
  const resolved = resolveSample(sample, source.length / sampleRate);
  const firstFrame = Math.round(resolved.start * sampleRate);
  const frameCount = Math.max(0, Math.round(resolved.end * sampleRate) - firstFrame);
  const pcm = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate;
    pcm[frame] = source[firstFrame + frame] *
      sampleEnvelopeAt(time, resolved.duration, resolved.fadeIn, resolved.fadeOut);
  }
  if (frameCount > 0 && resolved.fadeOut > 0) pcm[frameCount - 1] = 0;
  return { pcm, sample: resolved, firstFrame, frameCount, sampleRate };
}

export function resolveSequence(sequence, samples, loopLength = DEFAULT_LOOP_LENGTH) {
  const byId = new Map(samples.map((sample) => [Number(sample.id), sample]));
  const normalized = [];
  for (const event of sequence) {
    const sample = byId.get(Number(event.sampleId));
    const time = Number(event.time);
    if (!sample || !Number.isFinite(time) || time < 0 || time >= loopLength) continue;
    normalized.push({ time: roundTime(time), sampleId: Number(event.sampleId), sample });
  }
  return normalized.sort((a, b) => a.time - b.time || a.sampleId - b.sampleId);
}

export function renderSequence(source, sampleRate, config) {
  const loopLength = Number(config.loopLength) || source.length / sampleRate;
  const samples = config.samples.map((sample) => resolveSample(sample, loopLength));
  const events = resolveSequence(config.sequence, samples, loopLength);
  const totalFrames = Math.round(loopLength * sampleRate);
  const pcm = new Float32Array(totalFrames);
  const voiceReport = [];

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    const nextEvent = events[eventIndex + 1];
    const eventFrame = Math.round(event.time * sampleRate);
    const slice = extractSlice(source, sampleRate, event.sample);
    const naturalEnd = event.time + slice.sample.duration;
    const nextTime = nextEvent ? nextEvent.time : loopLength;
    const isChoked = Boolean(nextEvent && nextTime < naturalEnd);
    const playDuration = Math.min(slice.sample.duration, Math.max(0, nextTime - event.time));
    const playFrames = Math.min(
      slice.frameCount,
      Math.round(playDuration * sampleRate),
      totalFrames - eventFrame,
    );
    const chokeFrames = isChoked ? Math.min(playFrames, Math.round(PRIORITY_FADE_SECONDS * sampleRate)) : 0;

    for (let frame = 0; frame < playFrames; frame += 1) {
      let gain = 1;
      if (chokeFrames > 0 && frame >= playFrames - chokeFrames) {
        gain = Math.max(0, (playFrames - frame - 1) / chokeFrames);
      }
      pcm[eventFrame + frame] += slice.pcm[frame] * gain;
    }

    voiceReport.push({
      eventIndex,
      sampleId: event.sampleId,
      name: event.sample.name,
      start: roundTime(event.time),
      naturalEnd: roundTime(naturalEnd),
      playedEnd: roundTime(event.time + playFrames / sampleRate),
      frameCount: playFrames,
      chokedBy: isChoked ? nextEvent.sampleId : null,
      priorityFadeFrames: chokeFrames,
    });
  }

  return {
    pcm,
    sampleRate,
    duration: totalFrames / sampleRate,
    events: voiceReport,
    priorityCuts: voiceReport.filter((event) => event.chokedBy !== null),
    truncatedSamples: samples.filter((sample) => sample.truncatedAtLoop),
    samples,
  };
}

export function normalizeConfig(input, sampleRateFallback = DEFAULT_SAMPLE_RATE) {
  if (!input || typeof input !== "object") throw new Error("配置不是有效对象");
  const loopLength = Number(input.loopLength);
  const bpm = Number(input.bpm);
  const sampleRate = Number(input.sampleRate) || sampleRateFallback;
  if (!Number.isFinite(loopLength) || loopLength <= 0) throw new Error("loopLength 必须大于 0");
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("bpm 必须大于 0");
  if (!Array.isArray(input.samples) || input.samples.length === 0) {
    throw new Error("samples 不能为空");
  }
  const ids = new Set();
  const keys = new Set();
  const samples = input.samples.map((sample, index) => {
    const id = Number(sample.id) || index + 1;
    if (ids.has(id)) throw new Error(`采样 id ${id} 重复`);
    ids.add(id);
    const key = String(sample.key || TRIGGER_KEYS[index] || "").toUpperCase();
    if (key.length !== 1) throw new Error(`采样 ${id} 的触发键无效`);
    if (keys.has(key)) throw new Error(`触发键 ${key} 重复`);
    keys.add(key);
    return resolveSample({
      id,
      name: String(sample.name || `Sample ${id}`),
      start: Number(sample.start),
      requestedEnd: Number(sample.requestedEnd ?? sample.end),
      fadeIn: Number(sample.fadeIn) || 0,
      fadeOut: Number(sample.fadeOut) || 0,
      key,
    }, loopLength);
  });
  const sequence = Array.isArray(input.sequence)
    ? input.sequence
      .map((event) => ({ time: Number(event.time), sampleId: Number(event.sampleId) }))
      .filter((event) => Number.isFinite(event.time) && ids.has(event.sampleId))
    : [];
  return {
    version: Number(input.version) || 1,
    bpm: roundTime(bpm),
    loopLength: roundTime(loopLength),
    sampleRate,
    samples,
    sequence,
  };
}

export function makeExportConfig(config) {
  return {
    version: 1,
    bpm: config.bpm,
    loopLength: config.loopLength,
    sampleRate: config.sampleRate,
    samples: config.samples.map((sample) => {
      const resolved = resolveSample(sample, config.loopLength);
      const exported = {
        id: sample.id,
        name: sample.name,
        start: resolved.start,
        end: resolved.end,
        fadeIn: resolved.fadeIn,
        fadeOut: resolved.fadeOut,
        key: sample.key,
      };
      if (resolved.truncatedAtLoop) {
        exported.requestedEnd = resolved.requestedEnd;
        exported.truncatedAtLoop = true;
      }
      return exported;
    }),
    sequence: config.sequence.map((event) => ({
      time: roundTime(Number(event.time)),
      sampleId: Number(event.sampleId),
    })),
  };
}

export function encodeWav(pcm, sampleRate = DEFAULT_SAMPLE_RATE) {
  const bytesPerSample = 2;
  const dataLength = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < pcm.length; index += 1) {
    const value = clamp(pcm[index], -1, 1);
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return buffer;
}


