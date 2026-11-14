/*
 * Web Audio 音效引擎：
 * - 水流声：滤波白噪声，音量 / 截止频率随水速变化
 * - 缆绳张力：低频正弦，频率随张力变化
 * - 事件音：裂管、撞壁、卸货、胜利；超压 / 失衡告警
 * 所有节点在首次用户手势后创建，未初始化时静默降级。
 */
(function (global) {
  'use strict';

  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.waterGain = null;
    this.waterFilter = null;
    this.tensionOsc = null;
    this.tensionGain = null;
    this.muted = false;
  }

  AudioEngine.prototype.init = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this._buildWater();
    this._buildTension();
  };

  AudioEngine.prototype._buildWater = function () {
    const ctx = this.ctx;
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = 'lowpass';
    this.waterFilter.frequency.value = 400;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    src.connect(this.waterFilter).connect(this.waterGain).connect(this.master);
    src.start();
  };

  AudioEngine.prototype._buildTension = function () {
    const ctx = this.ctx;
    this.tensionOsc = ctx.createOscillator();
    this.tensionOsc.type = 'sine';
    this.tensionOsc.frequency.value = 60;
    this.tensionGain = ctx.createGain();
    this.tensionGain.gain.value = 0;
    this.tensionOsc.connect(this.tensionGain).connect(this.master);
    this.tensionOsc.start();
  };

  // 每帧根据模拟量调制连续音效
  AudioEngine.prototype.update = function (flowSpeed, tension, levelRate, warnings) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const flow = Math.min(1, flowSpeed / 3);
    this.waterGain.gain.setTargetAtTime(0.02 + flow * 0.18, t, 0.15);
    this.waterFilter.frequency.setTargetAtTime(300 + flow * 1100 + Math.abs(levelRate) * 200, t, 0.1);
    const t01 = Math.min(1, Math.max(0, (tension - 0.8) / 0.8));
    this.tensionGain.gain.setTargetAtTime(t01 * 0.12, t, 0.1);
    this.tensionOsc.frequency.setTargetAtTime(55 + t01 * 130, t, 0.1);
    if (warnings && warnings.pressure) this._beep(660, 0.05, 0.04);
    if (warnings && warnings.tilt) this._beep(220, 0.07, 0.05);
  };

  AudioEngine.prototype._beep = function (freq, dur, vol) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  };

  AudioEngine.prototype.event = function (name) {
    if (!this.ctx) return;
    if (name === 'rupture') return this._noiseBurst(0.6, 1800);
    if (name === 'wall') return this._noiseBurst(0.45, 900);
    if (name === 'deliver') return this._beep(880, 0.18, 0.08);
    if (name === 'win') { this._beep(523, 0.15, 0.08); setTimeout(() => this._beep(784, 0.3, 0.08), 160); }
  };

  AudioEngine.prototype._noiseBurst = function (dur, cutoff) {
    const ctx = this.ctx;
    const length = ctx.sampleRate * dur;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  };

  AudioEngine.prototype.setMuted = function (muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.9;
  };

  global.ShaftAudio = AudioEngine;
})(typeof self !== 'undefined' ? self : this);
