export class WatchAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.friction = null;
    this.enabled = true;
  }

  async ensure() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.72;
      this.master.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer();
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  createNoiseBuffer() {
    const length = this.context.sampleRate;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[index] = last;
    }
    return buffer;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.stopFriction();
    if (this.master) {
      this.master.gain.setTargetAtTime(enabled ? 0.72 : 0, this.context.currentTime, 0.03);
    }
  }

  tone({ frequency, endFrequency, duration, gain, type = "sine", delay = 0 }) {
    if (!this.enabled || !this.context || this.context.state !== "running") return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    }
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  noiseBurst({ duration = 0.04, gain = 0.08, frequency = 1600, delay = 0 }) {
    if (!this.enabled || !this.context || this.context.state !== "running") return;
    const start = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    source.start(start, Math.random() * 0.7, duration);
  }

  tick(accent = false) {
    this.tone({
      frequency: accent ? 2180 : 1660,
      endFrequency: accent ? 1420 : 1120,
      duration: 0.035,
      gain: accent ? 0.11 : 0.075,
      type: "triangle"
    });
    this.noiseBurst({ duration: 0.022, gain: 0.036, frequency: 3400 });
  }

  wind(level = 0.2) {
    this.tone({
      frequency: 280 + level * 130,
      endFrequency: 170,
      duration: 0.055,
      gain: 0.055,
      type: "square"
    });
    this.noiseBurst({ duration: 0.065, gain: 0.045, frequency: 780 });
  }

  select() {
    this.tone({ frequency: 1240, endFrequency: 1580, duration: 0.06, gain: 0.045, type: "sine" });
  }

  install() {
    this.tone({ frequency: 410, endFrequency: 660, duration: 0.1, gain: 0.07, type: "triangle" });
    this.noiseBurst({ duration: 0.04, gain: 0.05, frequency: 2100 });
  }

  remove() {
    this.tone({ frequency: 720, endFrequency: 330, duration: 0.09, gain: 0.04, type: "triangle" });
  }

  startFriction() {
    if (!this.enabled || !this.context || this.friction || this.context.state !== "running") return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const low = this.context.createOscillator();
    const lowGain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 680;
    gain.gain.value = 0.028;
    low.type = "sawtooth";
    low.frequency.value = 58;
    lowGain.gain.value = 0.012;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    low.connect(lowGain);
    lowGain.connect(this.master);
    source.start();
    low.start();
    this.friction = { source, low, gain, lowGain };
  }

  stopFriction() {
    if (!this.friction || !this.context) return;
    const { source, low, gain, lowGain } = this.friction;
    const now = this.context.currentTime;
    gain.gain.setTargetAtTime(0, now, 0.04);
    lowGain.gain.setTargetAtTime(0, now, 0.04);
    source.stop(now + 0.2);
    low.stop(now + 0.2);
    this.friction = null;
  }

  jam() {
    this.stopFriction();
    this.tone({ frequency: 180, endFrequency: 72, duration: 0.32, gain: 0.13, type: "sawtooth" });
    this.noiseBurst({ duration: 0.28, gain: 0.12, frequency: 440 });
  }

  fail() {
    this.stopFriction();
    this.tone({ frequency: 520, endFrequency: 340, duration: 0.16, gain: 0.1, type: "triangle" });
    this.tone({ frequency: 390, endFrequency: 220, duration: 0.22, gain: 0.08, type: "triangle", delay: 0.15 });
  }

  success() {
    this.stopFriction();
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      this.tone({
        frequency,
        endFrequency: frequency * 1.02,
        duration: 0.42,
        gain: 0.075 - index * 0.008,
        type: "triangle",
        delay: index * 0.16
      });
    });
    this.noiseBurst({ duration: 0.18, gain: 0.04, frequency: 2400, delay: 0.58 });
  }
}
