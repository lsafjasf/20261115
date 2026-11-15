// Web Audio engine: synthesized source, per-speaker delay/gain, three routing modes.
import {
  SPEAKERS, SPEAKER_IDS, MODES, QUAD_CHANNEL_INDEX,
  MAX_DELAY_MS, computeField
} from './acoustics.js';

// Convert world coordinates (y forward) to Web Audio coordinates (z negative = front).
function toAudioPosition(p) {
  return [p.x, 0, -p.y];
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.mode = 'stereo';
    this.listener = { x: 0, y: 0 };
    this.voices = new Map();
    this.outputNode = null;
    this.quadCapture = null;
    this.monitor = null;
    this.started = false;
  }

  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.buildSynth();
    this.buildVoices();
    const listener = this.ctx.listener;
    if (listener.forwardX) {
      listener.forwardX.value = 0;
      listener.forwardY.value = 0;
      listener.forwardZ.value = -1;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    } else if ('orientation' in listener) {
      listener.setOrientation(0, 0, -1, 0, 1, 0);
    }
    this.applyMode(this.mode);
    this.update(this.listener);
    this.started = true;
  }

  // Fully synthesized signal: two detuned oscillators through a low-pass plus
  // filtered noise, mixed on one mono bus. No audio files are ever loaded.
  buildSynth() {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.7;
    filter.connect(this.master);

    const oscA = ctx.createOscillator();
    oscA.type = 'triangle';
    oscA.frequency.value = 220;
    const oscB = ctx.createOscillator();
    oscB.type = 'sine';
    oscB.frequency.value = 330;
    const oscC = ctx.createOscillator();
    oscC.type = 'sine';
    oscC.frequency.value = 220 * 1.005;
    oscA.connect(filter);
    oscB.connect(filter);
    oscC.connect(filter);

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 800;
    noiseFilter.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.08;
    noise.connect(noiseFilter).connect(noiseGain).connect(filter);

    oscA.start();
    oscB.start();
    oscC.start();
    noise.start();
    this.sourceBus = filter;
  }

  // One voice per speaker: bus -> delay -> gain -> mode-specific processor.
  buildVoices() {
    const ctx = this.ctx;
    SPEAKER_IDS.forEach((id) => {
      const input = ctx.createGain();
      const delay = ctx.createDelay(MAX_DELAY_MS / 1000);
      const gain = ctx.createGain();
      input.connect(delay).connect(gain);
      this.sourceBus.connect(input);
      this.voices.set(id, { id, input, delay, gain, tails: [] });
    });
  }

  disposeVoiceTails(voice) {
    voice.tails.forEach((node) => {
      try { node.disconnect(); } catch { /* already disconnected */ }
    });
    voice.tails = [];
  }

  // Rebuild only the routing after the shared delay/gain stage.
  applyMode(modeId) {
    this.mode = modeId;
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.voices.forEach((voice) => this.disposeVoiceTails(voice));
    if (this.monitor) { this.monitor.disconnect(); this.monitor = null; }

    if (modeId === 'stereo' || modeId === 'binaural') {
      this.quadCapture = null;
      this.outputNode = this.master;
      this.voices.forEach((voice) => {
        if (modeId === 'stereo') {
          const pan = ctx.createStereoPanner();
          voice.gain.connect(pan).connect(this.master);
          voice.tails.push(pan);
        } else {
          const panner = ctx.createPanner();
          panner.panningModel = 'HRTF';
          panner.distanceModel = 'inverse';
          panner.refDistance = 1;
          panner.maxDistance = 50;
          panner.rolloffFactor = 0;
          const pos = toAudioPosition(SPEAKERS[voice.id]);
          panner.positionX.value = pos[0];
          panner.positionY.value = pos[1];
          panner.positionZ.value = pos[2];
          voice.gain.connect(panner).connect(this.master);
          voice.tails.push(panner);
        }
      });
    } else {
      // Quad: explicit 4-channel capture, one channel per speaker.
      const merger = ctx.createChannelMerger(4);
      const capture = ctx.createMediaStreamDestination();
      capture.channelCount = 4;
      capture.channelCountMode = 'explicit';
      capture.channelInterpretation = 'discrete';
      merger.connect(capture);
      this.voices.forEach((voice) => {
        const channel = QUAD_CHANNEL_INDEX[voice.id];
        voice.gain.connect(merger, 0, channel);
      });
      this.quadCapture = capture;
      // Down-mix for local monitoring without changing the captured channel count.
      this.monitor = ctx.createGain();
      this.monitor.gain.value = 0.9;
      this.voices.forEach((voice) => voice.gain.connect(this.monitor));
      this.monitor.connect(this.master);
      this.outputNode = capture;
    }
    this.update(this.listener);
  }

  // Push the acoustic model into the live graph with smoothed parameters.
  update(listener) {
    this.listener = { ...listener };
    if (!this.ctx) return;
    const field = computeField(listener, this.mode);
    const t = this.ctx.currentTime;
    this.activeIds = field.speakers.filter((s) => s.active).map((s) => s.id);
    field.speakers.forEach((model) => {
      const voice = this.voices.get(model.id);
      const active = model.active;
      voice.input.gain.setTargetAtTime(active ? 1 : 0, t, 0.05);
      voice.delay.delayTime.setTargetAtTime(model.delayMs / 1000, t, 0.05);
      voice.gain.gain.setTargetAtTime(model.gain, t, 0.05);
      if (this.mode === 'stereo') {
        const panner = voice.tails[0];
        panner.pan.setTargetAtTime(this.stereoPan(model.id), t, 0.05);
      }
    });
    return field;
  }

  // Fixed speaker placement pan: right speakers to +1, left speakers to -1.
  stereoPan(id) {
    if (id === 'FR' || id === 'RR') return 1;
    if (id === 'FL' || id === 'RL') return -1;
    return 0;
  }

  // Introspection used by the self-test panel to verify channel counts.
  describeRouting() {
    const mode = MODES[this.mode];
    return {
      mode: this.mode,
      declaredOutputChannels: mode.outputChannels,
      activeSpeakers: mode.activeSpeakers,
      activeVoiceCount: (this.activeIds || mode.activeSpeakers).length,
      tailKinds: [...this.voices.values()].map((v) =>
        v.tails[0] ? v.tails[0].constructor.name : 'none'),
      capturedChannels: this.quadCapture
        ? (this.quadCapture.stream.getAudioTracks()[0].getSettings().channelCount
          || this.quadCapture.channelCount)
        : 2,
      destinationChannels: this.ctx.destination.maxChannelCount
    };
  }
}
