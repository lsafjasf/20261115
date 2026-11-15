/* WebAudio sound cues: siren, confirm beep, warning and result fanfare. */

class SoundBoard {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  _ensure() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  _tone(frequency, start, duration, type = "sine", gainValue = 0.08) {
    const ctx = this._ensure();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + start);
    gain.gain.setValueAtTime(gainValue, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(ctx.currentTime + start);
    oscillator.stop(ctx.currentTime + start + duration);
  }

  siren() {
    if (this.muted) return;
    for (let i = 0; i < 3; i += 1) {
      this._tone(720, i * 0.45, 0.22, "sawtooth", 0.05);
      this._tone(520, i * 0.45 + 0.22, 0.22, "sawtooth", 0.05);
    }
  }

  confirm() {
    if (this.muted) return;
    this._tone(660, 0, 0.12, "triangle", 0.07);
    this._tone(880, 0.1, 0.16, "triangle", 0.07);
  }

  warn() {
    if (this.muted) return;
    this._tone(300, 0, 0.18, "square", 0.05);
    this._tone(220, 0.2, 0.22, "square", 0.05);
  }

  deliver() {
    if (this.muted) return;
    this._tone(523, 0, 0.14, "triangle", 0.08);
    this._tone(659, 0.12, 0.14, "triangle", 0.08);
    this._tone(784, 0.24, 0.22, "triangle", 0.08);
  }

  result(success) {
    if (this.muted) return;
    if (success) {
      [523, 659, 784, 1047].forEach((freq, index) => this._tone(freq, index * 0.15, 0.25, "triangle", 0.08));
    } else {
      [392, 330, 262].forEach((freq, index) => this._tone(freq, index * 0.22, 0.3, "sawtooth", 0.06));
    }
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.__SOUND__ = { SoundBoard };
}
