import { MASKING_THRESHOLD } from "./constants.js";
import { midiToFreq } from "./notes.js";

// 金属齿片：多个非谐和泛音 + 快速起音、指数衰减包络，经共享延迟混响输出。
const PARTIALS = [
  { ratio: 1.0, gain: 0.55, decay: 1.0 },
  { ratio: 2.76, gain: 0.22, decay: 0.5 },
  { ratio: 5.4, gain: 0.12, decay: 0.28 },
  { ratio: 8.93, gain: 0.06, decay: 0.16 },
];

class Voice {
  constructor(ctx, destination, midi, when) {
    const freq = midiToFreq(midi);
    const baseDecay = Math.max(0.45, 2.6 - (midi - 48) * 0.028);
    const peak = 0.5;
    this.nodes = [];

    this.gain = ctx.createGain();
    this.gain.gain.setValueAtTime(0.0001, when);
    this.gain.gain.exponentialRampToValueAtTime(peak, when + 0.006);
    this.gain.gain.exponentialRampToValueAtTime(0.0001, when + baseDecay * 1.6);
    this.gain.connect(destination);

    for (const p of PARTIALS) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * p.ratio;
      const pg = ctx.createGain();
      pg.gain.value = p.gain;
      const pd = ctx.createGain();
      pd.gain.setValueAtTime(1, when);
      pd.gain.exponentialRampToValueAtTime(0.0001, when + baseDecay * p.decay);
      osc.connect(pg).connect(pd).connect(this.gain);
      osc.start(when);
      osc.stop(when + baseDecay * p.decay + 0.05);
      this.nodes.push(osc);
    }
    this.doneAt = when + baseDecay * 1.6;
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.maskGain = null;
    this.voices = new Map(); // midi -> Voice
    this.onResonance = null; // (count, masked) => void
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = new Ctx();

    this.maskGain = this.ctx.createGain();
    this.maskGain.gain.value = 1;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.maskGain.connect(this.master);

    const delay = this.ctx.createDelay(1);
    delay.delayTime.value = 0.23;
    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.28;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.32;
    this.master.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(this.ctx.destination);
    this.master.connect(this.ctx.destination);
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  prune(now) {
    for (const [midi, v] of this.voices) {
      if (v.doneAt <= now) this.voices.delete(midi);
    }
  }

  resonanceCount(now) {
    this.prune(now);
    return this.voices.size;
  }

  // step 上触发的齿片一次命中；simultaneous 为该步同时触发数。
  pluck(midi, simultaneous = 1) {
    this.ensure();
    const now = this.now;
    this.prune(now);
    const existing = this.voices.get(midi);
    if (existing) {
      try {
        existing.gain.gain.cancelScheduledValues(now);
        existing.gain.gain.setTargetAtTime(0.0001, now, 0.01);
      } catch {
        /* 已释放的节点直接忽略 */
      }
      this.voices.delete(midi);
    }
    const voice = new Voice(this.ctx, this.maskGain, midi, now + 0.001);
    this.voices.set(midi, voice);

    const count = this.voices.size;
    const masked = simultaneous > MASKING_THRESHOLD;
    // 掩蔽：超过阈值的齿片越多，整体自动收得越紧
    const overload = Math.max(0, simultaneous - MASKING_THRESHOLD);
    const target = masked ? Math.max(0.35, 1 - overload * 0.18) : 1;
    this.maskGain.gain.cancelScheduledValues(now);
    this.maskGain.gain.setTargetAtTime(target, now, 0.03);
    this.maskGain.gain.setTargetAtTime(1, now + 0.35, 0.25);

    if (this.onResonance) this.onResonance(count, masked);
  }

  async suspend() {
    if (this.ctx && this.ctx.state === "running") await this.ctx.suspend();
  }

  async resume() {
    if (this.ctx) await this.ctx.resume();
  }
}
