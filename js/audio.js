// 实时合成音频引擎:所有声音均由 Web Audio 实时合成,无音频素材。
// - 漏水声: 白噪声 -> 带通滤波(每个漏点主频不同) -> 立体声声像 -> 距离增益
// - 发动机: 低通噪声 + 低频振荡,音量随速度增大,掩蔽微弱水声
// - 阀门室: 低频脉冲振动(间歇"咚"声),干扰判断
import { leakGain, panGains, valveGain, engineGain } from './world.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.leakNodes = [];
    this.valveNodes = [];
    this.started = false;
  }

  start(world) {
    if (this.started) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.world = world;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    // 左右声道分析器,驱动声压表
    this.splitter = ctx.createChannelSplitter(2);
    this.master.connect(this.splitter);
    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    this.analyserL.fftSize = 512;
    this.analyserR.fftSize = 512;
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);
    this.bufL = new Float32Array(this.analyserL.fftSize);
    this.bufR = new Float32Array(this.analyserR.fftSize);

    const noiseBuf = this.makeNoiseBuffer(ctx);

    // 发动机:低通噪声 + 低频嗡鸣
    this.engineGainNode = ctx.createGain();
    const engNoise = ctx.createBufferSource();
    engNoise.buffer = noiseBuf; engNoise.loop = true;
    const engLp = ctx.createBiquadFilter();
    engLp.type = 'lowpass'; engLp.frequency.value = 320;
    engNoise.connect(engLp).connect(this.engineGainNode).connect(this.master);
    engNoise.start();
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 45;
    this.engineOscGain = ctx.createGain();
    this.engineOscGain.gain.value = 0;
    this.engineOsc.connect(this.engineOscGain).connect(this.master);
    this.engineOsc.start();
    this.engineGainNode.gain.value = 0.03;

    // 漏点声源
    for (const leak of world.leaks) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = leak.freq; bp.Q.value = 2.5;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 300;
      const gL = ctx.createGain(), gR = ctx.createGain();
      gL.gain.value = 0; gR.gain.value = 0;
      const merger = ctx.createChannelMerger(2);
      src.connect(bp).connect(hp);
      hp.connect(gL); hp.connect(gR);
      gL.connect(merger, 0, 0);
      gR.connect(merger, 0, 1);
      merger.connect(this.master);
      src.start();
      this.leakNodes.push({ leak, gL, gR });
    }

    // 阀门室:低频脉冲
    for (const valve of world.valves) {
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = 55;
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      osc.connect(g).connect(pan).connect(this.master);
      osc.start();
      this.valveNodes.push({ valve, g, pan });
    }

    this.started = true;
  }

  makeNoiseBuffer(ctx) {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 关闭当前上下文(开新局时调用)
  stop() {
    if (!this.started) return;
    this.ctx.close();
    this.started = false;
    this.leakNodes = [];
    this.valveNodes = [];
  }

  // 每帧根据车位置/朝向/速度更新全部声源参数
  update(car, maxSpeed, time) {
    if (!this.started) return;
    const t = this.ctx.currentTime;

    const eng = engineGain(car.speed, maxSpeed);
    this.engineGainNode.gain.setTargetAtTime(eng * 0.5, t, 0.05);
    this.engineOscGain.gain.setTargetAtTime(eng * 0.25, t, 0.05);
    this.engineOsc.frequency.setTargetAtTime(45 + 90 * Math.abs(car.speed) / maxSpeed, t, 0.05);

    for (const n of this.leakNodes) {
      if (n.leak.found) {
        n.gL.gain.setTargetAtTime(0, t, 0.1);
        n.gR.gain.setTargetAtTime(0, t, 0.1);
        continue;
      }
      const g = leakGain(n.leak, car.x, car.y) * 0.9;
      const [pl, pr] = panGains(n.leak, car.x, car.y, car.heading);
      n.gL.gain.setTargetAtTime(g * pl, t, 0.05);
      n.gR.gain.setTargetAtTime(g * pr, t, 0.05);
    }

    for (const n of this.valveNodes) {
      const g = valveGain(n.valve, car.x, car.y, time) * 0.7;
      n.g.gain.setTargetAtTime(g, t, 0.03);
      const dx = n.valve.x - car.x;
      n.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, dx / 200)), t, 0.1);
    }
  }

  // 读取左右声道 RMS,驱动声压表
  levels() {
    if (!this.started) return [0, 0];
    this.analyserL.getFloatTimeDomainData(this.bufL);
    this.analyserR.getFloatTimeDomainData(this.bufR);
    const rms = (b) => {
      let s = 0;
      for (let i = 0; i < b.length; i++) s += b[i] * b[i];
      return Math.sqrt(s / b.length);
    };
    return [rms(this.bufL), rms(this.bufR)];
  }
}
