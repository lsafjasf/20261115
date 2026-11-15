// 节奏提示音合成：每条字幕入点“叮”、出点“咚”，断句相接处自然形成双音。
// 输出 48kHz 单声道 16-bit PCM；音频是工程的纯函数，编辑后重新合成。

const SAMPLE_RATE = 48000;

// 入点提示：明亮短音；出点提示：低沉短音。
const ON_BEEP = { freq: 880, durationMs: 90, gain: 0.5 };
const OFF_BEEP = { freq: 520, durationMs: 70, gain: 0.4 };
const FADE_MS = 6;

function renderPcmFloat(durationMs, cues) {
  const totalSamples = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const buffer = new Float64Array(totalSamples);
  const eventMap = new Map();
  for (const cue of cues) {
    if (!eventMap.has(cue.start)) eventMap.set(cue.start, []);
    if (!eventMap.has(cue.end)) eventMap.set(cue.end, []);
    eventMap.get(cue.start).push(ON_BEEP);
    eventMap.get(cue.end).push(OFF_BEEP);
  }
  const events = [...eventMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([atMs, specs]) => ({ atMs, specs }));

  for (const event of events) {
    for (const spec of event.specs) {
      const startSample = Math.round((event.atMs / 1000) * SAMPLE_RATE);
      const length = Math.round((spec.durationMs / 1000) * SAMPLE_RATE);
      const fadeLength = Math.max(1, Math.round((FADE_MS / 1000) * SAMPLE_RATE));
      for (let i = 0; i < length && startSample + i < totalSamples; i += 1) {
        const t = i / SAMPLE_RATE;
        const fadeIn = Math.min(1, i / fadeLength);
        const fadeOut = Math.min(1, (length - 1 - i) / fadeLength);
        const envelope = Math.min(fadeIn, fadeOut);
        buffer[startSample + i] +=
          Math.sin(2 * Math.PI * spec.freq * t) * spec.gain * envelope;
      }
    }
  }
  // 防止理论叠加溢出，做软限幅。
  for (let i = 0; i < buffer.length; i += 1) {
    buffer[i] = Math.tanh(buffer[i]);
  }
  return { sampleRate: SAMPLE_RATE, buffer };
}

function pcmFloatTo16(buffer) {
  const pcm = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, buffer[i]));
    pcm[i] = Math.round(sample * 32767);
  }
  return pcm;
}

function encodeWav(pcm16, sampleRate = SAMPLE_RATE) {
  const dataSize = pcm16.length * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < pcm16.length; i += 1) {
    view.setInt16(offset, pcm16[i], true);
    offset += 2;
  }
  return bytes;
}

function synthesizeWav(durationMs, cues) {
  const { buffer, sampleRate } = renderPcmFloat(durationMs, cues);
  return encodeWav(pcmFloatTo16(buffer), sampleRate);
}

module.exports = {
  SAMPLE_RATE,
  ON_BEEP,
  OFF_BEEP,
  renderPcmFloat,
  pcmFloatTo16,
  encodeWav,
  synthesizeWav,
};
