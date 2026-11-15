import { AUDIO_EVENTS, BEAT_EVENTS, PROJECT } from "./project.js";

const TAU = Math.PI * 2;

function noiseAt(index, seed = 0) {
  const value = Math.sin((index + seed * 1009) * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function addClick(samples, sampleRate, timeSec, strength = 1) {
  const start = Math.round(timeSec * sampleRate);
  const duration = Math.round(0.075 * sampleRate);
  for (let index = 0; index < duration; index += 1) {
    const sampleIndex = start + index;
    if (sampleIndex >= samples.length) break;
    const time = index / sampleRate;
    const attack = Math.min(1, time * 1100);
    const envelope = attack * Math.exp(-time * 62);
    const tone =
      Math.sin(TAU * 980 * time) * 0.62 +
      Math.sin(TAU * 1460 * time) * 0.2 +
      noiseAt(index, timeSec) * 0.16;
    samples[sampleIndex] += tone * envelope * 0.065 * strength;
  }
}

function addAccent(samples, sampleRate, timeSec, eventIndex) {
  const start = Math.round(timeSec * sampleRate);
  const duration = Math.round(0.82 * sampleRate);
  const fundamental = 76 + eventIndex * 3;
  for (let index = 0; index < duration; index += 1) {
    const sampleIndex = start + index;
    if (sampleIndex >= samples.length) break;
    const time = index / sampleRate;
    const attack = Math.min(1, time * 900);
    const lowEnvelope = attack * Math.exp(-time * 6.8);
    const transientEnvelope = attack * Math.exp(-time * 48);
    const tailEnvelope = attack * Math.exp(-time * 3.3);
    const low =
      Math.sin(TAU * fundamental * time) * 0.48 +
      Math.sin(TAU * fundamental * 2 * time + 0.4) * 0.24 +
      Math.sin(TAU * fundamental * 4 * time + 1.1) * 0.1;
    const transient =
      noiseAt(index, timeSec + eventIndex) * 0.24 +
      Math.sin(TAU * 1320 * time) * 0.2;
    const tail = Math.sin(TAU * (235 + eventIndex * 7) * time) * 0.08;
    samples[sampleIndex] +=
      low * lowEnvelope * 0.42 +
      transient * transientEnvelope * 0.28 +
      tail * tailEnvelope;
  }
}

export function buildBeatTrack(audioContext) {
  const sampleRate = audioContext.sampleRate;
  const length = Math.round(PROJECT.durationSec * sampleRate);
  const mono = new Float32Array(length);

  for (const beat of BEAT_EVENTS) {
    addClick(mono, sampleRate, beat.timeSec, beat.isBar ? 1.2 : 0.72);
  }
  for (const accent of AUDIO_EVENTS) {
    addAccent(mono, sampleRate, accent.timeSec, accent.index);
  }

  let peak = 0;
  for (let index = 0; index < mono.length; index += 1) {
    peak = Math.max(peak, Math.abs(mono[index]));
  }
  const scale = peak > 0 ? 0.86 / peak : 1;

  const buffer = audioContext.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let index = 0; index < mono.length; index += 1) {
    const sample = mono[index] * scale;
    left[index] = sample;
    right[index] = sample;
  }

  return buffer;
}

export function getAccentEnergy(audioBuffer, timeSec, windowSec = 0.09) {
  const sampleRate = audioBuffer.sampleRate;
  const start = Math.max(0, Math.round((timeSec - windowSec) * sampleRate));
  const end = Math.min(
    audioBuffer.length,
    Math.round((timeSec + windowSec) * sampleRate),
  );
  const channel = audioBuffer.getChannelData(0);
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    sum += channel[index] * channel[index];
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}
