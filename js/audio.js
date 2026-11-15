/* 音频引擎：Web Audio 合成短脉冲，支持模拟输出延迟（DelayNode）。 */
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.delay = null;
    this.analyser = null;
    this.simLatencyMs = 0;
    this.clickBuffer = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;

    // 模拟设备输出延迟：脉冲先经过 DelayNode 再到扬声器。
    this.delay = this.ctx.createDelay(2.0);
    this.delay.delayTime.value = this.simLatencyMs / 1000;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    this.master.connect(this.delay);
    this.delay.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.clickBuffer = this.buildClickBuffer();
    return this.ctx;
  }

  buildClickBuffer() {
    const sr = this.ctx.sampleRate;
    const dur = 0.045;
    const buf = this.ctx.createBuffer(1, Math.ceil(sr * dur), sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 160);
      const tone = Math.sin(2 * Math.PI * 1900 * t);
      const transient = i < sr * 0.002 ? (Math.random() * 2 - 1) * 0.6 : 0;
      data[i] = (tone * 0.9 + transient) * env;
    }
    return buf;
  }

  setSimLatency(ms) {
    this.simLatencyMs = Math.max(0, Math.min(1500, ms));
    if (this.delay) {
      this.delay.delayTime.setTargetAtTime(this.simLatencyMs / 1000, this.ctx.currentTime, 0.01);
    }
  }

  async resume() {
    this.ensure();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx.state;
  }

  /* 在指定的 AudioContext 时间播放一次脉冲，返回实际调度时间。 */
  scheduleClick(when) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.clickBuffer;
    src.connect(this.master);
    src.start(when);
    return when;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /* AudioContext 时钟 → performance.now() 毫秒，用于同步视觉闪烁。 */
  audioToPerfMs(audioTime) {
    return performance.now() + (audioTime - this.ctx.currentTime) * 1000;
  }

  state() {
    return this.ctx ? this.ctx.state : 'closed';
  }
}

window.audioEngine = new AudioEngine();
