/*
 * audio.js — Web Audio 实时合成金属风铃音。
 * 每根管 = 一组非谐泛音（近似金属棒的弯曲振动模态）+ 指数衰减包络 + 轻噪声敲击。
 * 声部掩盖：全局最大声部数 + 同管快速重触发时旧声部快速淡出。
 */
(function (root) {
  'use strict';

  // 金属管的非谐泛音比（近似圆柱棒的弯曲振动模态）
  var PARTIALS = [
    { ratio: 1.0, gain: 1.0, decay: 3.8 },
    { ratio: 2.76, gain: 0.42, decay: 2.4 },
    { ratio: 5.40, gain: 0.22, decay: 1.5 },
    { ratio: 8.93, gain: 0.10, decay: 0.9 }
  ];

  var MAX_VOICES = 14;        // 全局最大并发声部
  var SAME_CHIME_FADE = 0.06; // 同管重触发时旧声部淡出时间

  function ChimeSynth(audioCtx, freqs) {
    this.ctx = audioCtx;
    this.freqs = freqs;
    this.master = audioCtx.createGain();
    this.master.gain.value = 0.7;
    // 简单混响感：反馈延迟
    this.delay = audioCtx.createDelay(1.0);
    this.delay.delayTime.value = 0.23;
    this.feedback = audioCtx.createGain();
    this.feedback.gain.value = 0.28;
    this.wet = audioCtx.createGain();
    this.wet.gain.value = 0.22;
    this.master.connect(audioCtx.destination);
    this.master.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.wet);
    this.wet.connect(audioCtx.destination);
    this.voices = []; // {chime, gains, nodes}
  }

  ChimeSynth.prototype._stealIfNeeded = function (now) {
    // 超过最大声部数时，偷走最老的声部（快速淡出）
    while (this.voices.length >= MAX_VOICES) {
      var oldest = this.voices.shift();
      this._fadeOut(oldest, now, 0.05);
    }
  };

  ChimeSynth.prototype._fadeOut = function (voice, now, fade) {
    for (var i = 0; i < voice.gains.length; i++) {
      var g = voice.gains[i].gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(0, now, fade / 3);
    }
  };

  // 触发一根管。time 为 AudioContext 时间；velocity 0..1
  ChimeSynth.prototype.strike = function (chime, time, velocity) {
    var ctx = this.ctx;
    var f0 = this.freqs[chime];
    // 同管重触发：旧声部快速淡出，避免叠加浑浊
    for (var i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].chime === chime) {
        this._fadeOut(this.voices[i], time, SAME_CHIME_FADE);
        this.voices.splice(i, 1);
      }
    }
    this._stealIfNeeded(time);

    var gains = [];
    var nodes = [];
    for (var p = 0; p < PARTIALS.length; p++) {
      var partial = PARTIALS[p];
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f0 * partial.ratio;
      var g = ctx.createGain();
      var peak = velocity * partial.gain * 0.24;
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(peak, time + 0.004);
      g.gain.setTargetAtTime(0, time + 0.004, partial.decay / 3);
      osc.connect(g);
      g.connect(this.master);
      osc.start(time);
      osc.stop(time + partial.decay + 1.5);
      gains.push(g);
      nodes.push(osc);
    }
    // 敲击瞬态：短噪声脉冲
    var noiseLen = Math.floor(ctx.sampleRate * 0.03);
    var buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var n = 0; n < noiseLen; n++) data[n] = (Math.random() * 2 - 1) * (1 - n / noiseLen);
    var noise = ctx.createBufferSource();
    noise.buffer = buf;
    var ng = ctx.createGain();
    ng.gain.value = velocity * 0.12;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = f0 * 0.8;
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(this.master);
    noise.start(time);
    nodes.push(noise);

    var voice = { chime: chime, gains: gains, nodes: nodes };
    this.voices.push(voice);
    // 清理已结束的声部记录
    var self = this;
    setTimeout(function () {
      var idx = self.voices.indexOf(voice);
      if (idx !== -1) self.voices.splice(idx, 1);
    }, 6000);
  };

  root.ChimeSynth = ChimeSynth;
})(typeof self !== 'undefined' ? self : globalThis);
