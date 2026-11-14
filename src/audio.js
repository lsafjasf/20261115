// WebAudio：风轮机械声随转速变化、水流声随流量变化、水锤低频冲击
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    this.waterGain = null;
    this.windOsc = null;
    this.noiseBuffer = null;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // 风轮：低频正弦 + 二次谐波，频率跟随转速
    this.windOsc = this.ctx.createOscillator();
    this.windOsc.type = 'sine';
    this.windOsc.frequency.value = 30;
    const harm = this.ctx.createOscillator();
    harm.type = 'triangle';
    harm.frequency.value = 60;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.0001;
    const harmGain = this.ctx.createGain();
    harmGain.gain.value = 0.35;
    this.windOsc.connect(this.windGain);
    harm.connect(harmGain).connect(this.windGain);
    this.windGain.connect(this.master);
    this.windOsc.start();
    harm.start();
    this.harm = harm;

    // 水流：白噪声经带通滤波
    const len = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.8;
    this.waterGain = this.ctx.createGain();
    this.waterGain.gain.value = 0.0001;
    noise.connect(filter).connect(this.waterGain).connect(this.master);
    noise.start();
    this.filter = filter;
  }

  update(state) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const rpmFreq = 24 + state.pumpSpeed * 3.2;
    this.windOsc.frequency.setTargetAtTime(rpmFreq, now, 0.12);
    this.harm.frequency.setTargetAtTime(rpmFreq * 2.01, now, 0.12);
    this.windGain.gain.setTargetAtTime(
      0.04 + Math.min(0.12, state.pumpSpeed / 120),
      now,
      0.15
    );
    const totalFlow = state.flow.reduce((a, b) => a + b, 0);
    this.filter.frequency.setTargetAtTime(600 + totalFlow * 180, now, 0.15);
    this.waterGain.gain.setTargetAtTime(
      Math.min(0.16, totalFlow * 0.045),
      now,
      0.15
    );
  }

  hammer(peak) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.5);
    const gain = this.ctx.createGain();
    const level = Math.min(0.6, 0.15 + peak / 70);
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.75);
  }
}
