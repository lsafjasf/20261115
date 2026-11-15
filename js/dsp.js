import { ClippingError, encodeWav } from "./wav.js";

export const SAMPLE_RATE = 48000;
export const DURATION = 8;
export const MAX_FREQUENCY = 24000;
export const CLIP_THRESHOLD = 1;

const TAU = Math.PI * 2;

export const MODULE_DEFINITIONS = {
  highpass: { label: "High-pass filter", short: "HPF", glyph: "HP" },
  lowpass: { label: "Low-pass filter", short: "LPF", glyph: "LP" },
  notch: { label: "Narrow notch", short: "NOTCH", glyph: "N" },
  peaking: { label: "Peaking EQ", short: "PEAK", glyph: "EQ" },
  bandpass: { label: "Band-pass filter", short: "BPF", glyph: "BP" },
  gate: { label: "Downward gate", short: "GATE", glyph: "G" },
  gain: { label: "Output trim", short: "TRIM", glyph: "dB" },
};

export const DEFAULT_CHAIN = [
  { id: "hpf", type: "highpass", name: "Rumble filter", enabled: true, params: { frequency: 82, q: 0.707 } },
  { id: "hum-50", type: "notch", name: "Mains hum · 50", enabled: true, params: { frequency: 50, q: 24 } },
  { id: "hum-150", type: "notch", name: "Mains harmonic · 150", enabled: true, params: { frequency: 150, q: 22 } },
  { id: "nb-1180", type: "notch", name: "Narrowband · 1.18k", enabled: true, params: { frequency: 1180, q: 24 } },
  { id: "nb-2950", type: "notch", name: "Narrowband · 2.95k", enabled: true, params: { frequency: 2950, q: 26 } },
  { id: "gate", type: "gate", name: "Downward gate", enabled: true, params: { threshold: -41, range: -30, attack: 7, release: 110 } },
  { id: "trim", type: "gain", name: "Output trim", enabled: true, params: { gain: -2 } },
];

export function cloneChain(chain = DEFAULT_CHAIN) {
  return chain.map((module) => ({
    ...module,
    params: { ...module.params },
  }));
}

export function createModule(type) {
  const id = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  const defaults = {
    highpass: { name: "High-pass filter", params: { frequency: 90, q: 0.707 } },
    lowpass: { name: "Low-pass filter", params: { frequency: 9000, q: 0.707 } },
    notch: { name: "Narrow notch", params: { frequency: 1000, q: 24 } },
    peaking: { name: "Peaking EQ", params: { frequency: 1200, q: 1.2, gain: -6 } },
    bandpass: { name: "Band-pass filter", params: { frequency: 1500, q: 1.2 } },
    gate: { name: "Downward gate", params: { threshold: -42, range: -30, attack: 8, release: 120 } },
    gain: { name: "Output trim", params: { gain: 0 } },
  };
  return { id, type, enabled: true, ...defaults[type] };
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function peakOf(channels) {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index]));
    }
  }
  return peak;
}

function scaleChannels(channels, gain) {
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] *= gain;
    }
  }
}

function normalize(channels, targetPeak) {
  const peak = peakOf(channels);
  if (peak > 0) scaleChannels(channels, targetPeak / peak);
}

function speechEnvelope(t) {
  const phrases = [
    [0.18, 1.62],
    [1.90, 3.28],
    [3.62, 5.18],
    [5.46, 7.72],
  ];
  let envelope = 0;
  for (const [start, end] of phrases) {
    if (t < start || t > end) continue;
    const local = t - start;
    const attack = clamp(local / 0.045, 0, 1);
    const release = clamp((end - t) / 0.1, 0, 1);
    const syllables = 0.58 + 0.42 * Math.abs(Math.sin(Math.PI * (local * 3.25 + 0.1)));
    envelope = Math.max(envelope, Math.min(attack, release) ** 0.45 * syllables);
  }
  return envelope;
}

function voiceFormants(t) {
  const vowels = [
    [760, 1220, 2580],
    [430, 1820, 2520],
    [620, 1050, 2410],
    [350, 2240, 3010],
  ];
  const index = t < 1.75 ? 0 : t < 3.4 ? 1 : t < 5.3 ? 2 : 3;
  return vowels[index];
}

function smoothFormantGain(frequency, formants) {
  let gain = 0;
  for (let index = 0; index < formants.length; index += 1) {
    const width = [105, 165, 250][index];
    const distance = (frequency - formants[index]) / width;
    gain += [1.0, 0.72, 0.34][index] * Math.exp(-0.5 * distance * distance);
  }
  return gain;
}

function fundamentalAt(t) {
  if (t < 1.75) return 132;
  if (t < 3.4) return 146;
  if (t < 5.3) return 119;
  return 154;
}

export function synthesizeTestRecording(options = {}) {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const duration = options.duration ?? DURATION;
  const frameCount = Math.round(sampleRate * duration);
  const speed = sampleRate / SAMPLE_RATE;
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  const random = mulberry32(0x302c0de);

  let phaseL = 0;
  let phaseR = 0.29;
  let previousNoise = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const t = frame / sampleRate;
    const envelope = speechEnvelope(t);
    let voiced = 0;

    if (envelope > 0.0001) {
      const base = fundamentalAt(t);
      const f0 = base * (
        1
        + 0.017 * Math.sin(TAU * 4.6 * t)
        + 0.005 * Math.sin(TAU * 11.7 * t + 0.8)
      );
      phaseL += TAU * f0 / sampleRate;
      phaseR += TAU * f0 / sampleRate;
      const formants = voiceFormants(t);
      let toneL = 0;
      let toneR = 0;
      const stepCosL = Math.cos(phaseL);
      const stepSinL = Math.sin(phaseL);
      const stepCosR = Math.cos(phaseR);
      const stepSinR = Math.sin(phaseR);
      let sinL = stepSinL;
      let cosL = stepCosL;
      let sinR = stepSinR;
      let cosR = stepCosR;

      for (let harmonic = 1; harmonic < 52; harmonic += 1) {
        const frequency = harmonic * f0;
        if (frequency > 7200) break;
        const formantGain = smoothFormantGain(frequency, formants);
        const amplitude = (0.17 / harmonic ** 0.77) * (0.12 + formantGain);
        toneL += amplitude * sinL;
        toneR += amplitude * sinR;
        const nextSinL = sinL * stepCosL + cosL * stepSinL;
        const nextCosL = cosL * stepCosL - sinL * stepSinL;
        const nextSinR = sinR * stepCosR + cosR * stepSinR;
        const nextCosR = cosR * stepCosR - sinR * stepSinR;
        sinL = nextSinL;
        cosL = nextCosL;
        sinR = nextSinR;
        cosR = nextCosR;
      }
      voiced = envelope * 0.55;
      left[frame] += toneL * voiced;
      right[frame] += toneR * voiced * 0.97;
    }

    const white = random() * 2 - 1;
    const breath = (white - previousNoise) * envelope * 0.006;
    previousNoise = white;
    left[frame] += breath;
    right[frame] -= breath * 0.74;
  }

  normalize([left, right], 0.71);

  let pinkL = 0;
  let pinkR = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const t = frame / sampleRate;
    const noiseL = random() * 2 - 1;
    const noiseR = random() * 2 - 1;
    pinkL = pinkL * 0.972 + noiseL * 0.028;
    pinkR = pinkR * 0.968 + noiseR * 0.032;

    const bedL = 0.0022 * noiseL + 0.020 * pinkL;
    const bedR = 0.0020 * noiseR + 0.019 * pinkR;
    const hum = (
      0.018 * Math.sin(TAU * 50 * t)
      + 0.006 * Math.sin(TAU * 100 * t + 0.16)
      + 0.008 * Math.sin(TAU * 150 * t + 0.7)
      + 0.003 * Math.sin(TAU * 200 * t + 1.1)
      + 0.004 * Math.sin(TAU * 250 * t + 0.2)
    );
    const toneA = 0.0145 * Math.sin(TAU * 1180 * t + 0.38 * Math.sin(TAU * 2.3 * t));
    const burst = 0.22 + 0.78 * Math.max(0, Math.sin(TAU * 0.31 * t - 0.7)) ** 2;
    const toneB = 0.0085 * burst * Math.sin(TAU * 2950 * t + 0.12 * Math.sin(TAU * 5.2 * t));
    const mainsPhase = TAU * 50 * t;

    left[frame] += bedL + hum + toneA + toneB;
    right[frame] += bedR + hum * 0.94 + toneA * 0.97 + toneB * 0.92
      + 0.0008 * Math.sin(mainsPhase + 0.4);
  }

  if (peakOf([left, right]) > 0.78) normalize([left, right], 0.78);

  return {
    channels: [left, right],
    sampleRate,
    frameCount,
    duration: frameCount / sampleRate,
    channelsCount: 2,
    name: "field-voice_bed.wav",
    seed: "302c0de",
  };
}

function biquadCoefficients(module, sampleRate) {
  const { type, params } = module;
  const frequency = clamp(params.frequency ?? 1000, 10, sampleRate * 0.47);
  const q = clamp(params.q ?? 1, 0.1, 60);
  const w0 = TAU * frequency / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;

  if (type === "lowpass") {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = b0;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === "highpass") {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = b0;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === "bandpass") {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === "peaking") {
    const amplitude = 10 ** ((params.gain ?? 0) / 40);
    b0 = 1 + alpha * amplitude;
    b1 = -2 * cos;
    b2 = 1 - alpha * amplitude;
    a0 = 1 + alpha / amplitude;
    a1 = -2 * cos;
    a2 = 1 - alpha / amplitude;
  } else {
    b0 = 1;
    b1 = -2 * cos;
    b2 = 1;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function applyBiquad(channels, coefficients) {
  const { b0, b1, b2, a1, a2 } = coefficients;
  for (const channel of channels) {
    let z1 = 0;
    let z2 = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const input = channel[index];
      const output = b0 * input + z1;
      z1 = b1 * input - a1 * output + z2;
      z2 = b2 * input - a2 * output;
      channel[index] = output;
    }
  }
}

function applyGate(channels, params, sampleRate) {
  const threshold = 10 ** ((params.threshold ?? -42) / 20);
  const floorGain = 10 ** (Math.min(0, params.range ?? -30) / 20);
  const attackMs = clamp(params.attack ?? 8, 0.5, 250);
  const releaseMs = clamp(params.release ?? 120, 5, 1200);
  const attackCoefficient = Math.exp(-1 / (sampleRate * attackMs / 1000));
  const releaseCoefficient = Math.exp(-1 / (sampleRate * releaseMs / 1000));
  const left = channels[0];
  const right = channels[1] ?? channels[0];
  let envelope = 0;
  let gateGain = 1;

  for (let index = 0; index < left.length; index += 1) {
    const level = Math.max(Math.abs(left[index]), Math.abs(right[index]));
    const detectorCoefficient = level > envelope ? attackCoefficient : releaseCoefficient;
    envelope = detectorCoefficient * envelope + (1 - detectorCoefficient) * level;
    const target = envelope >= threshold ? 1 : floorGain;
    const gainCoefficient = target > gateGain ? attackCoefficient : releaseCoefficient;
    gateGain = gainCoefficient * gateGain + (1 - gainCoefficient) * target;
    left[index] *= gateGain;
    right[index] *= gateGain;
  }
}

function applyGain(channels, gainDb) {
  const gain = 10 ** (gainDb / 20);
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) channel[index] *= gain;
  }
}

export function renderChain(source, chain, options = {}) {
  const sampleRate = options.sampleRate ?? source.sampleRate ?? SAMPLE_RATE;
  const channels = source.channels.map((channel) => new Float32Array(channel));

  if (!options.bypass) {
    for (const module of chain) {
      if (!module.enabled) continue;
      if (module.type === "gate") {
        applyGate(channels, module.params, sampleRate);
      } else if (module.type === "gain") {
        applyGain(channels, module.params.gain ?? 0);
      } else {
        applyBiquad(channels, biquadCoefficients(module, sampleRate));
      }
    }
  }

  return {
    channels,
    sampleRate,
    frameCount: channels[0].length,
    duration: channels[0].length / sampleRate,
    bypass: Boolean(options.bypass),
  };
}

export function detectClipping(rendered) {
  let clippedSamples = 0;
  let peak = 0;
  let first = null;
  rendered.channels.forEach((channel, channelIndex) => {
    for (let frame = 0; frame < channel.length; frame += 1) {
      const level = Math.abs(channel[frame]);
      if (level > peak) peak = level;
      if (level >= CLIP_THRESHOLD) {
        clippedSamples += 1;
        if (!first) first = { channel: channelIndex, frame };
      }
    }
  });
  return {
    clipped: clippedSamples > 0,
    clippedSamples,
    first,
    peak,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    headroomDb: peak > 0 ? -20 * Math.log10(peak) : Infinity,
  };
}

export function encodeGuardedWav(rendered, options = {}) {
  const clipping = detectClipping(rendered);
  if (clipping.clipped) throw new ClippingError(clipping);
  return {
    bytes: encodeWav(rendered.channels, rendered.sampleRate, options),
    clipping,
  };
}

export function chainFingerprint(chain) {
  const text = JSON.stringify(chain.map(({ type, enabled, params }) => ({ type, enabled, params })));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function fft(real, imaginary) {
  const length = real.length;
  for (let index = 1, reverse = 0; index < length; index += 1) {
    let bit = length >> 1;
    for (; reverse & bit; bit >>= 1) reverse ^= bit;
    reverse ^= bit;
    if (index < reverse) {
      [real[index], real[reverse]] = [real[reverse], real[index]];
      [imaginary[index], imaginary[reverse]] = [imaginary[reverse], imaginary[index]];
    }
  }

  for (let size = 2; size <= length; size <<= 1) {
    const half = size >> 1;
    const angle = -TAU / size;
    const phaseReal = Math.cos(angle);
    const phaseImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += size) {
      let weightReal = 1;
      let weightImaginary = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const oddReal = real[odd] * weightReal - imaginary[odd] * weightImaginary;
        const oddImaginary = real[odd] * weightImaginary + imaginary[odd] * weightReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = weightReal * phaseReal - weightImaginary * phaseImaginary;
        weightImaginary = weightReal * phaseImaginary + weightImaginary * phaseReal;
        weightReal = nextReal;
      }
    }
  }
}

export function computeSpectrum(rendered, options = {}) {
  const fftSize = options.fftSize ?? 2048;
  const hop = options.hop ?? fftSize;
  const sampleRate = rendered.sampleRate;
  const channels = rendered.channels;
  const frameCount = rendered.frameCount ?? channels[0].length;
  const window = new Float32Array(fftSize);
  let windowSum = 0;
  for (let index = 0; index < fftSize; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos(TAU * index / (fftSize - 1));
    windowSum += window[index];
  }

  const bins = fftSize / 2;
  const power = new Float64Array(bins);
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  let segments = 0;

  for (let start = 0; start + fftSize <= frameCount; start += hop) {
    for (let index = 0; index < fftSize; index += 1) {
      let sample = 0;
      for (let channel = 0; channel < channels.length; channel += 1) {
        sample += channels[channel][start + index];
      }
      real[index] = (sample / channels.length) * window[index];
      imaginary[index] = 0;
    }
    fft(real, imaginary);
    for (let bin = 0; bin < bins; bin += 1) {
      power[bin] += real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
    }
    segments += 1;
  }

  const db = new Float32Array(bins);
  const frequencies = new Float32Array(bins);
  const scale = segments * windowSum * 0.5;
  for (let bin = 0; bin < bins; bin += 1) {
    const amplitude = scale > 0 ? Math.sqrt(power[bin]) / scale : 0;
    db[bin] = 20 * Math.log10(Math.max(1e-9, amplitude));
    frequencies[bin] = bin * sampleRate / fftSize;
  }

  return { db, frequencies, fftSize, sampleRate, segments };
}

function percentile(values, ratio) {
  if (values.length === 0) return -Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))];
}

export function analyzeSignal(rendered) {
  let peak = 0;
  let squareSum = 0;
  let sampleCount = 0;
  for (const channel of rendered.channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index];
      peak = Math.max(peak, Math.abs(sample));
      squareSum += sample * sample;
      sampleCount += 1;
    }
  }

  const frameSize = 2048;
  const frameLevels = [];
  const frameCount = rendered.frameCount ?? rendered.channels[0].length;
  for (let start = 0; start + frameSize <= frameCount; start += frameSize) {
    let sum = 0;
    for (let channel = 0; channel < rendered.channels.length; channel += 1) {
      const data = rendered.channels[channel];
      for (let index = 0; index < frameSize; index += 1) {
        sum += data[start + index] ** 2;
      }
    }
    const rms = Math.sqrt(sum / (frameSize * rendered.channels.length));
    frameLevels.push(20 * Math.log10(Math.max(1e-7, rms)));
  }

  const peakDb = 20 * Math.log10(Math.max(1e-9, peak));
  const rmsDb = 10 * Math.log10(Math.max(1e-12, squareSum / Math.max(1, sampleCount)));
  const noiseFloorDb = percentile(frameLevels, 0.10);
  return {
    peak,
    peakDb,
    rmsDb,
    noiseFloorDb,
    snrDb: peakDb - noiseFloorDb,
    headroomDb: -peakDb,
  };
}

export function findSpectralPeak(spectrum, center, tolerance = 50) {
  let bestBin = -1;
  let bestDb = -Infinity;
  for (let bin = 1; bin < spectrum.db.length; bin += 1) {
    const frequency = spectrum.frequencies[bin];
    if (Math.abs(frequency - center) > tolerance) continue;
    if (spectrum.db[bin] > bestDb) {
      bestDb = spectrum.db[bin];
      bestBin = bin;
    }
  }
  return bestBin < 0 ? null : {
    frequency: spectrum.frequencies[bestBin],
    db: bestDb,
  };
}

export function bufferFingerprint(rendered) {
  let hash = 2166136261;
  const stride = 193;
  rendered.channels.forEach((channel, channelIndex) => {
    hash ^= channelIndex + 1;
    hash = Math.imul(hash, 16777619);
    for (let frame = 0; frame < channel.length; frame += stride) {
      const value = Math.round(clamp(channel[frame], -1, 1) * 8388607);
      hash ^= value & 0xff;
      hash = Math.imul(hash, 16777619);
      hash ^= (value >> 8) & 0xff;
      hash = Math.imul(hash, 16777619);
      hash ^= (value >> 16) & 0xff;
      hash = Math.imul(hash, 16777619);
    }
  });
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}
