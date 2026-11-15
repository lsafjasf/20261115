// 纯合成鼓机：振荡器 + 噪声缓冲，不加载任何采样音频

function makeNoiseBuffer(ctx) {
  const len = ctx.sampleRate * 1;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export class DrumMachine {
  constructor(ctx, outBus) {
    this.ctx = ctx;
    this.out = outBus;
    this.noiseBuf = makeNoiseBuffer(ctx);
    this.bpm = 108;
    this.step = 0;
    this.nextNoteTime = 0;
    this.timer = null;

    this.pattern = {
      kick:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    };
  }

  kick(time, velocity = 1) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(48, time + 0.11);
    gain.gain.setValueAtTime(1.0 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
    osc.connect(gain).connect(this.out);
    osc.start(time);
    osc.stop(time + 0.35);
  }

  snare(time, velocity = 1) {
    const ctx = this.ctx;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55 * velocity, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    noise.connect(hp).connect(ng).connect(this.out);
    noise.start(time);
    noise.stop(time + 0.22);

    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 185;
    og.gain.setValueAtTime(0.35 * velocity, time);
    og.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    osc.connect(og).connect(this.out);
    osc.start(time);
    osc.stop(time + 0.14);
  }

  hat(time, velocity = 1) {
    const ctx = this.ctx;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22 * velocity, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    noise.connect(hp).connect(g).connect(this.out);
    noise.start(time);
    noise.stop(time + 0.08);
  }

  triggerStep(step, time) {
    if (this.pattern.kick[step]) this.kick(time, step === 0 ? 1 : 0.9);
    if (this.pattern.snare[step]) this.snare(time, 0.9);
    if (this.pattern.hat[step]) this.hat(time, step % 4 === 2 ? 0.7 : 0.45);
  }

  start() {
    if (this.timer) return;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.scheduler(), 25);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  get playing() { return this.timer !== null; }

  scheduler() {
    const stepDur = 60 / this.bpm / 4; // 16 分音符
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.triggerStep(this.step, this.nextNoteTime);
      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % 16;
    }
  }
}
