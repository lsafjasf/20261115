export class MechanicalAudio {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.context = null;
    this.master = null;
    this.noise = null;
    this.lastTick = 0;
  }

  ensureContext() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.12;
      this.master.connect(this.context.destination);
      this.noise = this.createNoiseBuffer(0.12);
    }
    if (this.context.state === "suspended") this.context.resume();
    return this.enabled ? this.context : null;
  }

  createNoiseBuffer(duration) {
    const length = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    return buffer;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) this.ensureContext();
    if (this.master) {
      this.master.gain.setTargetAtTime(enabled ? 0.12 : 0, this.context.currentTime, 0.025);
    }
  }

  click(strength = 0.5) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastTick < 0.018) return;
    this.lastTick = now;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    filter.type = "bandpass";
    filter.frequency.value = 920 + Math.random() * 260;
    filter.Q.value = 2.3;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.11 * strength, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.04);
  }

  ratchet() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.click(0.55);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(420, now);
    oscillator.frequency.exponentialRampToValueAtTime(275, now + 0.045);
    gain.gain.setValueAtTime(0.025, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.055);
  }

  latch() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.click(0.7);
    [0, 0.045].forEach((delay, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = index ? 238 : 315;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.024, now + delay + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.032);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(now + delay);
      oscillator.stop(now + delay + 0.04);
    });
  }

  sweep(intensity = 1) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastTick < 0.06) return;
    this.lastTick = now;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = this.noise;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(520 + intensity * 280, now);
    gain.gain.setValueAtTime(0.015 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.06);
  }

  shutter() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    [0, 0.065].forEach((delay, index) => {
      const now = ctx.currentTime + delay;
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      source.buffer = this.noise;
      filter.type = "bandpass";
      filter.frequency.value = index ? 680 : 1450;
      filter.Q.value = 1.25;
      gain.gain.setValueAtTime(index ? 0.10 : 0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(now);
      source.stop(now + 0.075);
    });
  }
}
