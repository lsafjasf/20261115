import { CONFIG } from "./physics.js";

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.oscillator = null;
    this.gain = null;
    this.enabled = false;
  }

  async start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.oscillator = this.ctx.createOscillator();
      this.gain = this.ctx.createGain();
      this.oscillator.type = "triangle";
      this.oscillator.frequency.value = 110;
      this.gain.gain.value = 0.0001;
      this.oscillator.connect(this.gain).connect(this.ctx.destination);
      this.oscillator.start();
    }
    await this.ctx.resume();
    this.enabled = true;
  }

  stop() {
    this.enabled = false;
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
    }
  }

  // 负载比 0..~1.5 映射到 110Hz..520Hz；超载时加入轻微颤音。
  update(tension, running) {
    if (!this.enabled || !this.ctx || !this.oscillator) return;
    const load = tension / (CONFIG.boxMass * 9.81);
    const ratio = Math.max(0, Math.min(1.6, (tension / CONFIG.maxTension) * 1.2));
    const freq = 110 + ratio * 340 + Math.max(0, load - 1) * 40;
    const now = this.ctx.currentTime;
    this.oscillator.frequency.setTargetAtTime(freq, now, 0.08);
    const target = running ? 0.05 + Math.min(0.1, load * 0.03) : 0.0001;
    this.gain.gain.setTargetAtTime(target, now, 0.1);
  }

  blip(freq = 660) {
    if (!this.enabled || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.18);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }
}
