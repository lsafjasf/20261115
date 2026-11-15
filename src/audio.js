export class CameraAudio {
  constructor() {
    this.enabled = true;
    this.context = null;
  }

  ensureContext() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      this.context = new AudioContext();
    }
    if (this.context.state === "suspended") this.context.resume();
    return this.context;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) this.ensureContext();
  }

  noiseBurst(duration, volume, frequency, type = "bandpass") {
    const ctx = this.ensureContext();
    if (!ctx || !this.enabled) return;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const fade = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * fade * fade;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
  }

  tone(frequency, duration, volume = 0.035, delay = 0, type = "sine") {
    const ctx = this.ensureContext();
    if (!ctx || !this.enabled) return;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
  }

  shutter() {
    this.noiseBurst(0.055, 0.17, 2800, "highpass");
    this.tone(135, 0.06, 0.06, 0, "square");
    window.setTimeout(() => {
      this.noiseBurst(0.075, 0.12, 1300, "bandpass");
      this.tone(88, 0.07, 0.045, 0, "triangle");
    }, 72);
  }

  tick(accent = false) {
    this.tone(accent ? 640 : 490, 0.045, accent ? 0.034 : 0.023, 0, "sine");
    this.noiseBurst(0.015, 0.012, 3300, "highpass");
  }

  finish() {
    this.noiseBurst(0.055, 0.13, 2400, "highpass");
    this.tone(523.25, 0.2, 0.025, 0.02);
    this.tone(783.99, 0.26, 0.021, 0.11);
  }
}
