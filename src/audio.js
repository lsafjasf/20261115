export class SnowAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this.muted = false;
    this.nodes = {};
    this.lastClick = 0;
  }

  async start() {
    if (this.ready) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return true;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    this.ctx = new AudioContextClass();
    await this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.78;
    this.master.connect(this.ctx.destination);
    this.buildEngine();
    this.buildChains();
    this.buildWind();
    this.ready = true;
    return true;
  }

  buildEngine() {
    const ctx = this.ctx;
    const engineBus = ctx.createGain();
    engineBus.gain.value = 0.02;
    engineBus.connect(this.master);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 245;
    lowpass.Q.value = 0.8;
    lowpass.connect(engineBus);

    const fundamental = ctx.createOscillator();
    fundamental.type = "sawtooth";
    fundamental.frequency.value = 54;
    fundamental.connect(lowpass);

    const rumble = ctx.createOscillator();
    rumble.type = "triangle";
    rumble.frequency.value = 31;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.38;
    rumble.connect(rumbleGain);
    rumbleGain.connect(lowpass);

    const harmonic = ctx.createOscillator();
    harmonic.type = "square";
    harmonic.frequency.value = 108;
    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.09;
    harmonic.connect(harmonicGain);
    harmonicGain.connect(lowpass);

    fundamental.start();
    rumble.start();
    harmonic.start();
    this.nodes.engine = { bus: engineBus, filter: lowpass, fundamental, rumble, harmonic };
  }

  buildChains() {
    const ctx = this.ctx;
    const chainBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const chainData = chainBuffer.getChannelData(0);
    let ring = 0;
    for (let index = 0; index < chainData.length; index += 1) {
      const phase = index % (ctx.sampleRate * 0.032);
      if (phase < 22 && index > ctx.sampleRate * 0.08) {
        ring = (Math.random() * 2 - 1) * 0.9;
      }
      ring *= 0.93;
      chainData[index] = ring + (Math.random() * 2 - 1) * 0.045;
    }
    const source = ctx.createBufferSource();
    source.buffer = chainBuffer;
    source.loop = true;
    const highpass = ctx.createBiquadFilter();
    highpass.type = "bandpass";
    highpass.frequency.value = 1050;
    highpass.Q.value = 1.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(highpass);
    highpass.connect(gain);
    gain.connect(this.master);
    source.start();
    this.nodes.chains = { source, filter: highpass, gain };
  }

  buildWind() {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      brown = brown * 0.972 + white * 0.028;
      data[index] = brown * 2.8 + white * 0.18;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 620;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();

    const whistleSource = ctx.createBufferSource();
    whistleSource.buffer = buffer;
    whistleSource.loop = true;
    const whistleFilter = ctx.createBiquadFilter();
    whistleFilter.type = "bandpass";
    whistleFilter.frequency.value = 1450;
    whistleFilter.Q.value = 0.65;
    const whistleGain = ctx.createGain();
    whistleGain.gain.value = 0.008;
    whistleSource.connect(whistleFilter);
    whistleFilter.connect(whistleGain);
    whistleGain.connect(this.master);
    whistleSource.start();
    this.nodes.wind = { source, filter, gain, whistleFilter, whistleGain };
  }

  update({ speed, throttle, onRoad, wind, brake, strapTension, time }) {
    if (!this.ready) return;
    const nodes = this.nodes;
    const rpm = Math.min(1, speed / 18.5);
    const engineFreq = 52 + rpm * 76 + Math.abs(throttle) * 15;
    nodes.engine.fundamental.frequency.setTargetAtTime(engineFreq, time, 0.06);
    nodes.engine.rumble.frequency.setTargetAtTime(engineFreq * 0.52, time, 0.06);
    nodes.engine.harmonic.frequency.setTargetAtTime(engineFreq * 1.91, time, 0.04);
    nodes.engine.filter.frequency.setTargetAtTime(210 + rpm * 530 + Math.abs(throttle) * 130, time, 0.08);
    const engineLevel = 0.011 + Math.abs(throttle) * 0.044 + rpm * 0.022;
    nodes.engine.bus.gain.setTargetAtTime(engineLevel, time, 0.08);

    const chainLevel = (0.004 + rpm * 0.055) * (onRoad ? 1 : 0.55);
    nodes.chains.gain.gain.setTargetAtTime(chainLevel, time, 0.06);
    nodes.chains.filter.frequency.setTargetAtTime(620 + rpm * 1180, time, 0.08);
    nodes.chains.source.playbackRate.setTargetAtTime(0.36 + rpm * 0.9, time, 0.1);

    nodes.wind.gain.gain.setTargetAtTime(0.018 + wind * 0.068, time, 0.2);
    nodes.wind.whistleGain.gain.setTargetAtTime(0.006 + wind * 0.023, time, 0.2);
    nodes.wind.filter.frequency.setTargetAtTime(430 + wind * 360, time, 0.2);
    nodes.wind.whistleFilter.frequency.setTargetAtTime(1180 + wind * 720, time, 0.2);
    nodes.wind.source.playbackRate.setTargetAtTime(0.48 + wind * 0.24, time, 0.25);
    if (brake > 0.1) nodes.chains.filter.frequency.setTargetAtTime(1800, time, 0.04);
  }

  ratchet() {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastClick < 0.23) return;
    this.lastClick = now;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(760, now);
    oscillator.frequency.exponentialRampToValueAtTime(380, now + 0.028);
    gain.gain.setValueAtTime(0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.06);
  }

  chime(kind = "station") {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    const frequencies = kind === "complete" ? [620, 790, 1040] : kind === "warning" ? [340, 280] : [540, 720];
    frequencies.forEach((frequency, index) => {
      const oscillator = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + index * 0.1);
      gain.gain.linearRampToValueAtTime(0.028, now + index * 0.1 + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.1 + 0.26);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now + index * 0.1);
      oscillator.stop(now + index * 0.1 + 0.3);
    });
  }

  impact(strength = 1) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(125, now);
    oscillator.frequency.exponentialRampToValueAtTime(43, now + 0.2);
    gain.gain.setValueAtTime(Math.min(0.09, 0.025 + strength * 0.02), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.3);
  }

  brakeSqueal() {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(950, now);
    oscillator.frequency.linearRampToValueAtTime(720, now + 0.36);
    gain.gain.setValueAtTime(0.018, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.42);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.78, this.ctx.currentTime, 0.08);
  }
}
