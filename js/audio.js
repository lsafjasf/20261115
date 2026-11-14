// Web Audio 合成：无外部音频文件。马达频率随轮速，滤波随载荷；打滑用白噪声。
export class RoverAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.motorOsc = null;
    this.motorOsc2 = null;
    this.motorGain = null;
    this.noiseNode = null;
    this.noiseGain = null;
    this.noiseFilter = null;
    this.enabled = false;
    this._noiseBuffer = null;
  }

  async start() {
    if (this.enabled) return;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error('当前环境不支持 Web Audio');
    this.ctx = new AC();
    await this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    this.motorGain = this.ctx.createGain();
    this.motorGain.gain.value = 0.0;
    this.motorOsc = this.ctx.createOscillator();
    this.motorOsc.type = 'sawtooth';
    this.motorOsc.frequency.value = 60;
    this.motorOsc2 = this.ctx.createOscillator();
    this.motorOsc2.type = 'triangle';
    this.motorOsc2.frequency.value = 90;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    this.motorFilter = lp;
    this.motorOsc.connect(this.motorFilter);
    this.motorOsc2.connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain);
    this.motorGain.connect(this.master);
    this.motorOsc.start();
    this.motorOsc2.start();

    // 白噪声缓冲：打滑时的轮下摩擦声
    const len = this.ctx.sampleRate * 1.5;
    this._noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this._noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseNode = this.ctx.createBufferSource();
    this.noiseNode.buffer = this._noiseBuffer;
    this.noiseNode.loop = true;
    this.noiseFilter = this.ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 1800;
    this.noiseFilter.Q.value = 0.8;
    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseNode.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    this.noiseNode.start();
    this.enabled = true;
  }

  // rover 状态每帧驱动：speed 0..MAX_SPEED，jars 0..3，slip bool
  update(speed, maxSpeed, jars, slip, airborne) {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, speed / maxSpeed);
    this.motorOsc.frequency.setTargetAtTime(55 + s * 230, t, 0.08);
    this.motorOsc2.frequency.setTargetAtTime(82 + s * 340, t, 0.08);
    // 载荷越重，滤波截止频率越低，声音更闷；音量略增表现吃力。
    this.motorFilter.frequency.setTargetAtTime(1100 - jars * 180, t, 0.15);
    this.motorGain.gain.setTargetAtTime(0.04 + s * (0.10 + jars * 0.015), t, 0.1);
    const noiseTarget = slip ? 0.22 : airborne ? 0.05 : 0.012 * s;
    this.noiseGain.gain.setTargetAtTime(noiseTarget, t, 0.05);
    this.noiseFilter.frequency.setTargetAtTime(slip ? 2400 : 1200, t, 0.1);
  }

  blip(freq = 440, dur = 0.12, type = 'square', vol = 0.18) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  pickup(jar) { this.blip(520 + jar * 160, 0.18, 'triangle', 0.22); }
  landslide() { this.blip(110, 0.5, 'sawtooth', 0.3); }
  hop() { this.blip(300, 0.15, 'sine', 0.14); }
  land(impact) { this.blip(160 + impact * 20, 0.2, 'square', 0.16); }
  abort() { this.blip(70, 0.9, 'sawtooth', 0.32); }
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, 'triangle', 0.22), i * 150)); }

  suspend() { if (this.ctx) this.ctx.suspend(); }
}
