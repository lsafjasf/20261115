export class QuarryAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    this.lastToneAt = 0;
    this.lastImpactAt = 0;
  }

  ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.82;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      this.context.resume().catch(() => {});
    }
    return this.context;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : 0.82,
        this.context.currentTime,
        0.04
      );
    }
  }

  noiseBuffer(context, seconds = 1) {
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i += 1) {
      brown = brown * 0.96 + (Math.random() * 2 - 1) * 0.045;
      data[i] = brown + (Math.random() * 2 - 1) * 0.12;
    }
    return buffer;
  }

  blast() {
    const context = this.ensureContext();
    if (!context || this.muted) return;
    const now = context.currentTime;
    const noise = context.createBufferSource();
    noise.buffer = this.noiseBuffer(context, 1.8);
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(780, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(90, now + 1.3);
    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.8, now + 0.045);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    noise.connect(noiseFilter).connect(noiseGain).connect(this.master);

    const boom = context.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(68, now);
    boom.frequency.exponentialRampToValueAtTime(27, now + 0.8);
    const boomGain = context.createGain();
    boomGain.gain.setValueAtTime(0.0001, now);
    boomGain.gain.exponentialRampToValueAtTime(0.55, now + 0.02);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    boom.connect(boomGain).connect(this.master);

    noise.start(now);
    noise.stop(now + 1.8);
    boom.start(now);
    boom.stop(now + 1.15);
  }

  impact(strength = 0.4) {
    const context = this.ensureContext();
    if (!context || this.muted) return;
    const now = context.currentTime;
    if (now - this.lastImpactAt < 0.045) return;
    this.lastImpactAt = now;
    const level = Math.min(0.55, 0.08 + strength * 0.45);
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context, 0.18);
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 260 + strength * 330;
    filter.Q.value = 1.2;
    const gain = context.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.18);
  }

  tension(value, dragging = false) {
    const context = this.ensureContext();
    if (!context || this.muted) return;
    const now = context.currentTime;
    if (!dragging && now - this.lastToneAt < 0.065) return;
    this.lastToneAt = now;
    const danger = Math.max(0, Math.abs(value - 55) - 11) / 45;
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 185 + value * 2.3;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 440 + value * 7;
    filter.Q.value = dragging ? 4.5 : 2.2;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(
      0.04 + danger * 0.06,
      now + 0.02
    );
    gain.gain.exponentialRampToValueAtTime(0.001, now + (dragging ? 0.13 : 0.22));
    oscillator.connect(filter).connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.25);
  }

  tear() {
    const context = this.ensureContext();
    if (!context || this.muted) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer(context, 0.6);
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1200;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.58, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.6);
  }

  result(success) {
    const context = this.ensureContext();
    if (!context || this.muted) return;
    const now = context.currentTime;
    const frequencies = success ? [392, 523, 659] : [190, 138, 92];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = success ? 'sine' : 'sawtooth';
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      const start = now + index * 0.075;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(success ? 0.15 : 0.08, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + 0.4);
    });
  }
}
