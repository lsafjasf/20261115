const BPM = 112;
const STEPS_PER_BEAT = 4;
const SCHEDULE_AHEAD = 0.12;
const TIMER_MS = 25;

export class BeatEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.recordingDestination = null;
    this.timer = null;
    this.nextStepTime = 0;
    this.step = 0;
    this.running = false;
  }

  async ensure() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('当前浏览器不支持 Web Audio');

      this.context = new AudioContextClass();
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 12;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;

      this.master = this.context.createGain();
      this.master.gain.value = 0.42;
      this.recordingDestination = this.context.createMediaStreamDestination();
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
      compressor.connect(this.recordingDestination);
    }

    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }

  async start() {
    await this.ensure();
    this.stop();
    this.running = true;
    this.step = 0;
    this.nextStepTime = this.context.currentTime + 0.06;
    this.timer = window.setInterval(() => this.schedule(), TIMER_MS);
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStream() {
    return this.recordingDestination?.stream ?? null;
  }

  schedule() {
    if (!this.running || !this.context) return;
    const stepDuration = 60 / BPM / STEPS_PER_BEAT;

    while (this.nextStepTime < this.context.currentTime + SCHEDULE_AHEAD) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.step = (this.step + 1) % (STEPS_PER_BEAT * 4);
      this.nextStepTime += stepDuration;
    }
  }

  scheduleStep(step, time) {
    if (step % 8 === 0) this.kick(time, 0.7);
    if (step % 8 === 6) this.kick(time, 0.36);
    if (step === 4 || step === 12) this.snare(time);
    if (step % 2 === 0) this.hat(time, step % 4 === 0 ? 0.1 : 0.055);
    if (step === 0 || step === 6 || step === 10) this.bass(time, step === 0 ? 55 : 73.42);
  }

  kick(time, amount) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(150, time);
    oscillator.frequency.exponentialRampToValueAtTime(44, time + 0.16);
    gain.gain.setValueAtTime(amount, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.34);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(time);
    oscillator.stop(time + 0.36);
  }

  snare(time) {
    const length = Math.floor(this.context.sampleRate * 0.16);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 2;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(0.18, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(time);
  }

  hat(time, amount) {
    const length = Math.floor(this.context.sampleRate * 0.035);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    gain.gain.setValueAtTime(amount, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(time);
  }

  bass(time, frequency) {
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(360, time);
    filter.frequency.exponentialRampToValueAtTime(90, time + 0.42);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.14, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
    oscillator.connect(filter).connect(gain).connect(this.master);
    oscillator.start(time);
    oscillator.stop(time + 0.48);
  }
}
