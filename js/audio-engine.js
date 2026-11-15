import {
  makeImpulseResponse, inverseDistanceGain, stereoPan, clamp,
} from './acoustics.js';

const REF_DISTANCE = 1;

function setPosition(node, p) {
  if (node.positionX) {
    node.positionX.value = p[0];
    node.positionY.value = p[1];
    node.positionZ.value = p[2];
  } else {
    node.setPosition(p[0], p[1], p[2]);
  }
}

function setListener(listener, pos, forward, up = [0, 1, 0]) {
  if (listener.positionX) {
    listener.positionX.value = pos[0];
    listener.positionY.value = pos[1];
    listener.positionZ.value = pos[2];
    listener.forwardX.value = forward[0];
    listener.forwardY.value = forward[1];
    listener.forwardZ.value = forward[2];
    listener.upX.value = up[0];
    listener.upY.value = up[1];
    listener.upZ.value = up[2];
  } else {
    listener.setPosition(pos[0], pos[1], pos[2]);
    listener.setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.mode = 'binaural';
    this.sourceType = 'sine';
    this.wetMix = 0.35;
  }

  async ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.voiceOut = ctx.createGain();
    this.voiceOut.gain.value = 0.22;

    // 公共混响支路
    this.convolver = ctx.createConvolver();
    this.wetBus = ctx.createGain();
    this.wetBus.gain.value = this.wetMix;
    this.wetAnalyser = ctx.createAnalyser();
    this.wetAnalyser.fftSize = 1024;
    this.convolver.connect(this.wetBus);
    this.wetBus.connect(this.wetAnalyser);

    // 双耳支路：HRTF PannerNode（inverse 距离模型）
    this.binMute = ctx.createGain();
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = REF_DISTANCE;
    this.panner.rolloffFactor = 1;
    this.panner.maxDistance = 100;
    this.binWet = ctx.createGain();
    this.binWet.gain.value = 1;
    this.voiceOut.connect(this.binMute);
    this.binMute.connect(this.panner);
    this.panner.connect(this.binWet);
    this.binWet.connect(this.convolver);

    // 立体声支路：手动 inverse 距离增益 + StereoPannerNode
    this.sterMute = ctx.createGain();
    this.distanceGain = ctx.createGain();
    this.distanceGain.gain.value = 1;
    this.stereoPanner = ctx.createStereoPanner();
    this.sterWet = ctx.createGain();
    this.sterWet.gain.value = 1;
    this.voiceOut.connect(this.sterMute);
    this.sterMute.connect(this.distanceGain);
    this.distanceGain.connect(this.stereoPanner);
    this.stereoPanner.connect(this.sterWet);
    this.sterWet.connect(this.convolver);

    this.dryBus = ctx.createGain();
    this.panner.connect(this.dryBus);
    this.stereoPanner.connect(this.dryBus);

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const splitter = ctx.createChannelSplitter(2);
    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    this.analyserL.fftSize = this.analyserR.fftSize = 1024;
    this.dryBus.connect(this.master);
    this.wetBus.connect(this.master);
    this.master.connect(splitter);
    splitter.connect(this.analyserL, 0);
    splitter.connect(this.analyserR, 1);
    this.master.connect(ctx.destination);

    this.bufL = new Float32Array(this.analyserL.fftSize);
    this.bufR = new Float32Array(this.analyserR.fftSize);
    this._buildVoice();
    this.applyMode();
  }

  _buildVoice() {
    const ctx = this.ctx;
    if (this.voice) {
      try { this.voice.stop(); } catch { /* 已停止 */ }
      this.voice = null;
    }
    const out = ctx.createGain();
    out.connect(this.voiceOut);
    const type = this.sourceType;

    if (type === 'noise') {
      const len = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 600;
      filter.Q.value = 1.2;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.4;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 400;
      lfo.connect(lfoGain).connect(filter.frequency);
      src.connect(filter).connect(out);
      src.start();
      lfo.start();
      this.voice = { stop: () => { src.stop(); lfo.stop(); } };
      return;
    }

    const freqs = type === 'chord' ? [220, 277.18, 329.63] : [330];
    const oscs = freqs.map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = type === 'chord' ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      if (type === 'sine' && i === 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 8;
        lfo.connect(lfoGain).connect(osc.frequency);
        lfo.start();
        osc._vibrato = lfo;
      }
      const g = ctx.createGain();
      g.gain.value = type === 'chord' ? 0.5 : 1;
      osc.connect(g).connect(out);
      osc.start();
      return osc;
    });
    this.voice = {
      stop: () => oscs.forEach((o) => {
        try { o.stop(); if (o._vibrato) o._vibrato.stop(); } catch { /* noop */ }
      }),
    };
  }

  setSourceType(type) {
    this.sourceType = type;
    if (this.ctx) this._buildVoice();
  }

  applyMode() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.binMute.gain.setTargetAtTime(this.mode === 'binaural' ? 1 : 0, t, 0.05);
    this.sterMute.gain.setTargetAtTime(this.mode === 'stereo' ? 1 : 0, t, 0.05);
  }

  setMode(mode) {
    this.mode = mode;
    this.applyMode();
  }

  setWetMix(value) {
    this.wetMix = clamp(value, 0, 1);
    if (this.ctx) this.wetBus.gain.setTargetAtTime(this.wetMix, this.ctx.currentTime, 0.1);
  }

  setReverb(rt60) {
    if (!this.ctx) return;
    this.convolver.buffer = makeImpulseResponse(this.ctx, rt60);
  }

  // 每帧调用：更新声源/监听者位姿、距离增益与声像。
  update(sourcePos, listener) {
    if (!this.ctx) return { distance: 0, gain: 1, pan: 0 };
    const ctx = this.ctx;
    setPosition(this.panner, sourcePos);
    setListener(ctx.listener, listener.position, listener.forward);
    const dx = sourcePos[0] - listener.position[0];
    const dy = sourcePos[1] - listener.position[1];
    const dz = sourcePos[2] - listener.position[2];
    const distance = Math.hypot(dx, dy, dz);
    const gain = inverseDistanceGain(distance, {
      refDistance: REF_DISTANCE, rolloffFactor: 1, maxDistance: 100,
    });
    const pan = stereoPan(sourcePos, listener, listener.forward);
    this.distanceGain.gain.setTargetAtTime(gain, ctx.currentTime, 0.03);
    this.stereoPanner.pan.setTargetAtTime(pan, ctx.currentTime, 0.03);
    return { distance, gain, pan };
  }

  getLevels() {
    if (!this.ctx) return { left: 0, right: 0, wet: 0 };
    this.analyserL.getFloatTimeDomainData(this.bufL);
    this.analyserR.getFloatTimeDomainData(this.bufR);
    const rms = (buf) => {
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.sqrt(sum / buf.length);
    };
    return { left: rms(this.bufL), right: rms(this.bufR) };
  }

  async play() {
    await this.ensureContext();
    await this.ctx.resume();
  }

  pause() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }
}
