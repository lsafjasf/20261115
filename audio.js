// Web Audio 程序化音效：燃烧器轰鸣、排气嘶声、高度风声、投递与结果提示音。

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.burnerGain = null;
    this.ventGain = null;
    this.windGain = null;
    this.windFilter = null;
    this.enabled = true;
  }

  // 必须由用户手势触发后才能创建/恢复 AudioContext
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this._buildBurner();
      this._buildVent();
      this._buildWind();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  _noiseBuffer(seconds = 2) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _buildBurner() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    this.burnerGain = this.ctx.createGain();
    this.burnerGain.gain.value = 0;
    src.connect(filter).connect(this.burnerGain).connect(this.master);
    src.start();
    // 低频脉动，模拟燃烧轰鸣
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 9;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
  }

  _buildVent() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2400;
    this.ventGain = this.ctx.createGain();
    this.ventGain.gain.value = 0;
    src.connect(filter).connect(this.ventGain).connect(this.master);
    src.start();
  }

  _buildWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(3);
    src.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.02;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  // 每帧根据仿真状态更新连续音效
  update(sim) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const burnTarget = sim.controls.burn && sim.fuel > 0 ? 0.34 : 0.0001;
    this.burnerGain.gain.setTargetAtTime(burnTarget, now, 0.08);
    const ventTarget = sim.controls.vent ? 0.22 : 0.0001;
    this.ventGain.gain.setTargetAtTime(ventTarget, now, 0.1);

    // 风声音量与亮度随高度上升、随空速增强
    const altFactor = Math.min(1, sim.altitude / 200);
    const speedFactor = Math.min(1, Math.abs(sim.vx - sim.wind) / 12);
    this.windGain.gain.setTargetAtTime(0.02 + altFactor * 0.1 + speedFactor * 0.05, now, 0.3);
    this.windFilter.frequency.setTargetAtTime(380 + altFactor * 900, now, 0.4);
  }

  _tone(freq, duration, type = "sine", gain = 0.25, when = 0, slideTo = null) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  drop() {
    // 短促木质“咚”声表示邮件离篮
    this._tone(240, 0.18, "triangle", 0.3, 0, 110);
  }

  delivered() {
    this._tone(660, 0.14, "sine", 0.25, 0);
    this._tone(880, 0.16, "sine", 0.25, 0.12);
    this._tone(1175, 0.24, "sine", 0.28, 0.24);
  }

  missed() {
    this._tone(300, 0.25, "sawtooth", 0.18, 0, 150);
  }

  win() {
    [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.3, "triangle", 0.28, i * 0.14));
  }

  crash() {
    this._tone(180, 0.7, "sawtooth", 0.35, 0, 45);
    this._tone(90, 0.9, "square", 0.22, 0.05, 35);
  }
}
