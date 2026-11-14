export class StudioAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    this.started = false;
    this.beatEventCount = 0;
  }

  async start() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.72;
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 5;
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.started = true;
    return true;
  }

  async suspend() {
    if (this.context?.state === "running") {
      await this.context.suspend();
    }
  }

  async resume() {
    if (this.context?.state === "suspended") {
      await this.context.resume();
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.context.currentTime, 0.015);
    }
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  tick(beatIndex) {
    if (!this.context || this.muted || this.context.state !== "running") return;
    this.beatEventCount += 1;
    const now = this.context.currentTime;
    const accent = beatIndex % 4 === 0;

    this.ping(accent ? 880 : 660, now, 0.055, accent ? 0.13 : 0.075, "triangle");
    this.ping(accent ? 220 : 165, now, 0.095, accent ? 0.07 : 0.038, "sine");
    this.click(now, accent ? 0.05 : 0.028);
  }

  ping(frequency, start, duration, volume, type = "sine") {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.82, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.012);
  }

  click(start, volume) {
    const length = Math.max(1, Math.floor(this.context.sampleRate * 0.028));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      channel[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 4;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = "highpass";
    filter.frequency.value = 1800;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.03);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
  }

  shutter() {
    if (!this.context || this.muted || this.context.state !== "running") return;
    const now = this.context.currentTime;
    this.click(now, 0.16);
    this.click(now + 0.07, 0.09);
    this.ping(72, now, 0.08, 0.05, "square");
  }

  success() {
    if (!this.context || this.muted || this.context.state !== "running") return;
    const now = this.context.currentTime;
    [440, 554.37, 659.25, 880].forEach((frequency, index) => {
      this.ping(frequency, now + index * 0.07, 0.16, 0.055, "sine");
    });
  }

  failure() {
    if (!this.context || this.muted || this.context.state !== "running") return;
    const now = this.context.currentTime;
    this.ping(146.83, now, 0.12, 0.07, "sawtooth");
    this.ping(110, now + 0.1, 0.16, 0.06, "sawtooth");
  }
}
