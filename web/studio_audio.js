// 浏览器版节奏提示音合成与 WAV 编码（与 Node 端 audio.js 同算法）。
(function (global) {
  const SAMPLE_RATE = 48000;
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
    for (const [atMs, specs] of [...eventMap.entries()].sort((a, b) => a[0] - b[0])) {
      for (const spec of specs) {
        const startSample = Math.round((atMs / 1000) * SAMPLE_RATE);
        const length = Math.round((spec.durationMs / 1000) * SAMPLE_RATE);
        const fadeLength = Math.max(1, Math.round((FADE_MS / 1000) * SAMPLE_RATE));
        for (let i = 0; i < length && startSample + i < totalSamples; i += 1) {
          const t = i / SAMPLE_RATE;
          const envelope = Math.min(i / fadeLength, (length - 1 - i) / fadeLength, 1);
          buffer[startSample + i] +=
            Math.sin(2 * Math.PI * spec.freq * t) * spec.gain * envelope;
        }
      }
    }
    for (let i = 0; i < buffer.length; i += 1) buffer[i] = Math.tanh(buffer[i]);
    return { sampleRate: SAMPLE_RATE, buffer };
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
    const { buffer } = renderPcmFloat(durationMs, cues);
    const pcm = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i += 1) {
      pcm[i] = Math.round(Math.max(-1, Math.min(1, buffer[i])) * 32767);
    }
    return encodeWav(pcm);
  }

  // 供实时预览：把当前工程渲染成 AudioBuffer，播放头 seek 后从同一时刻起播。
  function renderAudioBuffer(ctx, durationMs, cues) {
    const { buffer } = renderPcmFloat(durationMs, cues);
    const audioBuffer = ctx.createBuffer(1, buffer.length, SAMPLE_RATE);
    audioBuffer.copyToChannel(Float32Array.from(buffer), 0);
    return audioBuffer;
  }

  global.StudioCore = global.StudioCore || {};
  Object.assign(global.StudioCore, {
    SAMPLE_RATE, ON_BEEP, OFF_BEEP, renderPcmFloat,
    encodeWav, synthesizeWav, renderAudioBuffer,
  });
})(typeof window !== 'undefined' ? window : globalThis);
