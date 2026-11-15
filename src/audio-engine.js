import {
  IR_DURATION,
  SAMPLE_RATE,
  SPEED_OF_SOUND,
} from "./geometry.js";

export const IR_ENGINE = "Web Audio OfflineAudioContext";
const REFERENCE_PEAK_AT_1M = 0.28;
const TAIL_LEVEL = 0.0034;

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function makeClickBuffer(context, frequency = 1850, lengthMs = 9) {
  const length = Math.max(32, Math.floor((lengthMs / 1000) * context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let index = 0; index < length; index += 1) {
    const time = index / context.sampleRate;
    const envelope = Math.exp(-time * 760);
    const value = (
      Math.sin(2 * Math.PI * frequency * time) +
      0.34 * Math.sin(2 * Math.PI * frequency * 1.73 * time)
    ) * envelope;
    data[index] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  if (peak > 0) {
    for (let index = 0; index < length; index += 1) {
      data[index] /= peak;
    }
  }
  return buffer;
}

function scheduleClick(context, destination, buffer, startTime, gainValue) {
  if (startTime < 0 || startTime >= IR_DURATION) return;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = gainValue;
  source.connect(gain).connect(destination);
  source.start(startTime);
}

function createNoiseBuffer(context, seed) {
  const length = Math.floor(context.sampleRate * IR_DURATION);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededRandom(seed);
  for (let index = 0; index < length; index += 1) {
    const white = random() * 2 - 1;
    const tick = random() > 0.992 ? (random() * 2 - 1) * 1.8 : 0;
    data[index] = white * 0.74 + tick;
  }
  return buffer;
}

function scheduleReverbTail(context, destination, startTime, rt60, seed) {
  const noise = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  noise.buffer = createNoiseBuffer(context, seed);
  filter.type = "lowpass";
  filter.frequency.value = 4200;
  filter.Q.value = 0.38;

  const tailStart = Math.max(0, startTime + 0.012);
  const tailEnd = Math.min(IR_DURATION, tailStart + Math.max(rt60, 0.25));
  gain.gain.setValueAtTime(0.000001, 0);
  gain.gain.setValueAtTime(0.000001, tailStart);
  gain.gain.linearRampToValueAtTime(TAIL_LEVEL, tailStart + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.000001, tailEnd);
  gain.gain.setValueAtTime(0.000001, IR_DURATION);

  noise.connect(filter).connect(gain).connect(destination);
  noise.start(0);
}

export async function renderChannelImpulse(channel, spatial, options = {}) {
  if (typeof OfflineAudioContext === "undefined") {
    throw new Error("当前浏览器不支持 OfflineAudioContext");
  }

  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const duration = options.duration ?? IR_DURATION;
  const length = Math.floor(sampleRate * duration);
  const context = new OfflineAudioContext(1, length, sampleRate);
  const master = context.createGain();
  master.gain.value = 1;
  master.connect(context.destination);
  const click = makeClickBuffer(context);

  const totalDistance = Math.max(1, channel.totalDistance);
  const directGain = REFERENCE_PEAK_AT_1M / totalDistance;
  const directTime = channel.diagramDelayMs / 1000;
  scheduleClick(context, master, click, directTime, directGain);

  for (const reflection of channel.reflections) {
    const time = (
      channel.sourceDistance + reflection.distance
    ) / SPEED_OF_SOUND;
    scheduleClick(
      context,
      master,
      click,
      time,
      directGain * reflection.reflectionGain * 0.54,
    );
  }

  const seed = hashString(
    `${channel.id}:${spatial.state.listener.x.toFixed(2)}:${spatial.state.listener.y.toFixed(2)}:${spatial.state.listener.yaw}`,
  );
  scheduleReverbTail(
    context,
    master,
    directTime,
    spatial.rt60,
    seed,
  );

  const buffer = await context.startRendering();
  return {
    channelId: channel.id,
    buffer,
    sampleRate,
    duration,
  };
}

function detectOnset(samples, peak) {
  const threshold = Math.max(peak * 0.055, 0.00035);
  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index]) >= threshold) return index;
  }
  return 0;
}

function calculateRT20(samples, sampleRate, onsetIndex) {
  const startIndex = Math.min(
    samples.length - 1,
    onsetIndex + Math.floor(sampleRate * 0.055),
  );
  let energy = 0;
  const cumulative = new Float64Array(samples.length);
  for (let index = samples.length - 1; index >= startIndex; index -= 1) {
    energy += samples[index] * samples[index];
    cumulative[index] = energy;
  }
  const reference = cumulative[startIndex];
  if (!Number.isFinite(reference) || reference <= 1e-14) return null;

  let start = -1;
  let end = -1;
  for (let index = startIndex; index < samples.length; index += 1) {
    const db = 10 * Math.log10(Math.max(cumulative[index], 1e-18) / reference);
    if (start < 0 && db <= -5) start = index;
    if (start >= 0 && db <= -25) {
      end = index;
      break;
    }
  }
  if (start < 0 || end <= start) return null;

  const points = [];
  const stride = Math.max(1, Math.floor((end - start) / 180));
  for (let index = start; index <= end; index += stride) {
    const db = 10 * Math.log10(Math.max(cumulative[index], 1e-18) / reference);
    points.push({
      time: (index - startIndex) / sampleRate,
      db,
    });
  }
  const count = points.length;
  if (count < 3) return null;
  const meanTime = points.reduce((sum, point) => sum + point.time, 0) / count;
  const meanDb = points.reduce((sum, point) => sum + point.db, 0) / count;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.time - meanTime) * (point.db - meanDb);
    denominator += (point.time - meanTime) ** 2;
  }
  if (denominator <= 1e-12 || numerator >= 0) return null;
  const rt60 = (-60 / (numerator / denominator));
  return Number.isFinite(rt60) && rt60 > 0.05 && rt60 < 6
    ? rt60
    : null;
}

function buildEnvelope(samples, bins = 720) {
  const envelope = new Float32Array(bins);
  const blockSize = samples.length / bins;
  for (let bin = 0; bin < bins; bin += 1) {
    const start = Math.floor(bin * blockSize);
    const end = Math.min(samples.length, Math.floor((bin + 1) * blockSize));
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index]));
    }
    envelope[bin] = peak;
  }
  return envelope;
}

export function analyzeImpulseResponse(rendered) {
  const samples = rendered.buffer.getChannelData(0);
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  const onsetIndex = detectOnset(samples, peak);
  const onsetMs = (onsetIndex / rendered.sampleRate) * 1000;
  const directWindowEnd = Math.min(
    samples.length,
    onsetIndex + Math.floor(rendered.sampleRate * 0.028),
  );
  let directPeak = 0;
  for (let index = onsetIndex; index < directWindowEnd; index += 1) {
    directPeak = Math.max(directPeak, Math.abs(samples[index]));
  }
  const splDb = 94 + 20 * Math.log10(
    Math.max(directPeak, 1e-9) / REFERENCE_PEAK_AT_1M,
  );
  const rt60 = calculateRT20(samples, rendered.sampleRate, onsetIndex);
  return {
    onsetMs,
    splDb,
    rt60,
    peak,
    envelope: buildEnvelope(samples),
  };
}

export async function renderSpatialImpulseResponses(spatial, options = {}) {
  const rendered = await Promise.all(
    spatial.channels.map((channel) => renderChannelImpulse(channel, spatial, options)),
  );
  const channels = rendered.map((response) => ({
    ...response,
    analysis: analyzeImpulseResponse(response),
  }));
  return {
    engine: IR_ENGINE,
    sampleRate: options.sampleRate ?? SAMPLE_RATE,
    duration: options.duration ?? IR_DURATION,
    channels,
  };
}

export function summarizeRenderedIR(rendered) {
  return rendered.channels.map((channel) => ({
    id: channel.channelId,
    onsetMs: channel.analysis.onsetMs,
    splDb: channel.analysis.splDb,
    rt60: channel.analysis.rt60,
    envelope: Array.from(channel.analysis.envelope),
  }));
}
