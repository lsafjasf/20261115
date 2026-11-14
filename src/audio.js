/*
 * Web Audio 音效引擎：
 *  - 泵机：三台泵各有一个低频振荡 + 共同嗡鸣，开启越多基频层越厚
 *  - 水流：带通滤波白噪声，响度/亮度随总流量变化
 *  - 水锤：低频正弦快速下扫 + 噪声爆发
 *  - 破裂：白噪声爆发 + 持续泄漏嘶声
 *  - 扑灭：上行双音；胜负：简短琶音
 */
(function (root) {
  'use strict';

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.pumpNodes = [];
      this.leakGain = null;
    }

    ensure() {
      if (this.ctx) return;
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(ctx.destination);

      // 水流噪声层（常驻，随流量调增益）
      const noise = ctx.createBufferSource();
      noise.buffer = this.makeNoise(2);
      noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.7;
      this.waterGain = ctx.createGain();
      this.waterGain.gain.value = 0;
      noise.connect(bp).connect(this.waterGain).connect(this.master);
      noise.start();
      this.waterFilter = bp;

      // 泄漏嘶声（破裂时常驻）
      const leakNoise = ctx.createBufferSource();
      leakNoise.buffer = this.makeNoise(2);
      leakNoise.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2600;
      this.leakGain = ctx.createGain();
      this.leakGain.gain.value = 0;
      leakNoise.connect(hp).connect(this.leakGain).connect(this.master);
      leakNoise.start();
    }

    makeNoise(seconds) {
      const ctx = this.ctx;
      const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return buf;
    }

    resume() { this.ensure(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

    setMuted(muted) {
      this.muted = muted;
      if (this.master) this.master.gain.value = muted ? 0 : 0.9;
    }

    // pumpStates: [{on}], totalFlow: L/s
    update(pumpStates, totalFlow, leakFlow) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      pumpStates.forEach((pump, i) => {
        if (pump.on && !this.pumpNodes[i]) {
          const osc = ctx.createOscillator();
          osc.type = i === 2 ? 'triangle' : 'sawtooth';
          osc.frequency.value = 46 + i * 12;
          const g = ctx.createGain();
          g.gain.value = 0;
          g.gain.linearRampToValueAtTime(0.05 + i * 0.012, t + 0.4);
          osc.connect(g).connect(this.master);
          osc.start();
          this.pumpNodes[i] = { osc, g };
        } else if (!pump.on && this.pumpNodes[i]) {
          const node = this.pumpNodes[i];
          node.g.gain.linearRampToValueAtTime(0, t + 0.25);
          const osc = node.osc;
          setTimeout(() => { try { osc.stop(); } catch (e) {} }, 300);
          this.pumpNodes[i] = null;
        }
      });
      const flowLevel = Math.min(1, totalFlow / 40);
      this.waterGain.gain.setTargetAtTime(flowLevel * 0.16, t, 0.15);
      this.waterFilter.frequency.setTargetAtTime(500 + flowLevel * 900, t, 0.2);
      if (this.leakGain) {
        this.leakGain.gain.setTargetAtTime(Math.min(0.18, leakFlow * 0.006), t, 0.1);
      }
    }

    blip(freq, dur, type, gainVal, when = 0) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime + when;
      const osc = ctx.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gainVal || 0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + dur);
    }

    hammer(strength) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(0.5, 0.2 + strength / 800), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + 0.5);
      this.noiseBurst(0.25, 1200);
    }

    noiseBurst(dur, cutoff) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.makeNoise(dur);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = cutoff;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filt).connect(g).connect(this.master);
      src.start(t);
    }

    rupture() {
      if (!this.ctx) return;
      this.noiseBurst(0.7, 3000);
      this.blip(90, 0.6, 'sawtooth', 0.25);
    }

    extinguished() { this.blip(660, 0.12, 'triangle', 0.14); this.blip(880, 0.18, 'triangle', 0.12, 0.1); }
    win() { [523, 659, 784, 1046].forEach((f, i) => this.blip(f, 0.25, 'triangle', 0.14, i * 0.14)); }
    lose() { [392, 330, 262].forEach((f, i) => this.blip(f, 0.3, 'sawtooth', 0.12, i * 0.18)); }
    click() { this.blip(440, 0.05, 'square', 0.06); }
  }

  root.AudioEngine = AudioEngine;
})(typeof self !== 'undefined' ? self : this);
