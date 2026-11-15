// Web Audio：风力噪声（连续）+ 供电/报警事件音
// 浏览器自动播放策略要求首次声音必须由用户手势触发，因此用 ensureAudio() 懒初始化。

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.windGain = null;
    this.windFilter = null;
    this.muted = false;
  }

  ensureAudio() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    // 风力：白噪声 -> 带通滤波 -> 增益，循环播放，音量随风力变化
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 480;
    this.windFilter.Q.value = 0.8;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(this.windFilter).connect(this.windGain).connect(this.ctx.destination);
    noise.start();
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ctx) return;
    if (muted) {
      this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    } else if (this._lastWindLevel !== undefined) {
      this.updateWind(this._lastWindLevel);
    }
  }

  // windLevel: 0..1
  updateWind(windLevel) {
    this._lastWindLevel = windLevel;
    if (!this.ctx || this.muted) return;
    const volume = 0.015 + windLevel * 0.12;
    this._lastWindVolume = volume;
    this.windGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + windLevel * 700, this.ctx.currentTime, 0.2);
  }

  _beep(freq, duration, type = 'sine', volume = 0.12) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration + 0.05);
  }

  powerOn() {
    this._beep(660, 0.18, 'triangle', 0.1);
    setTimeout(() => this._beep(880, 0.22, 'triangle', 0.1), 110);
  }

  powerOff() {
    this._beep(320, 0.25, 'sawtooth', 0.07);
  }

  alarm() {
    this._beep(980, 0.12, 'square', 0.08);
    setTimeout(() => this._beep(740, 0.14, 'square', 0.08), 150);
  }

  linkDown() {
    this._beep(180, 0.5, 'sawtooth', 0.1);
  }

  pin() {
    this._beep(520, 0.08, 'square', 0.09);
  }

  win() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._beep(f, 0.3, 'triangle', 0.11), i * 160));
  }

  lose() {
    [400, 300, 200].forEach((f, i) => setTimeout(() => this._beep(f, 0.35, 'sawtooth', 0.1), i * 200));
  }
}
