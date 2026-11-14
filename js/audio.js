/* 声音引擎：曝气驱动的水流气泡声，强度改变滤波与音量 */
(function (global) {
  "use strict";

  function PondAudio() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.noiseGain = null;
    this.filter = null;
    this.humOsc = null;
    this.humGain = null;
  }

  PondAudio.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    var bufferSize = this.ctx.sampleRate * 2;
    var buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    var noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "bandpass";
    this.filter.frequency.value = 400;
    this.filter.Q.value = 0.8;

    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.value = 0;

    this.humOsc = this.ctx.createOscillator();
    this.humOsc.type = "sine";
    this.humOsc.frequency.value = 70;
    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0;

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;

    noise.connect(this.filter);
    this.filter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    this.humOsc.connect(this.humGain);
    this.humGain.connect(this.master);
    this.master.connect(this.ctx.destination);

    noise.start();
    this.humOsc.start();
  };

  // intensity: 0-100 曝气强度
  PondAudio.prototype.targets = function (intensity) {
    var k = Math.max(0, Math.min(100, intensity)) / 100;
    return {
      noiseGain: k * 0.32,
      humGain: k * 0.10,
      filterFreq: 300 + k * 1600,
      humFreq: 60 + k * 90
    };
  };

  PondAudio.prototype.update = function (intensity) {
    if (!this.ctx || !this.enabled) return;
    var t = this.ctx.currentTime;
    var v = this.targets(intensity);
    this.noiseGain.gain.setTargetAtTime(v.noiseGain, t, 0.15);
    this.humGain.gain.setTargetAtTime(v.humGain, t, 0.15);
    this.filter.frequency.setTargetAtTime(v.filterFreq, t, 0.2);
    this.humOsc.frequency.setTargetAtTime(v.humFreq, t, 0.2);
  };

  PondAudio.prototype.blip = function (freq, duration) {
    if (!this.ctx || !this.enabled) return;
    var osc = this.ctx.createOscillator();
    var gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, this.ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.master || this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration + 0.02);
  };

  PondAudio.prototype.win = function () {
    this.blip(523, 0.18);
    setTimeout(function () { this.blip(659, 0.18); }.bind(this), 160);
    setTimeout(function () { this.blip(784, 0.32); }.bind(this), 320);
  };

  PondAudio.prototype.lose = function () {
    this.blip(330, 0.25);
    setTimeout(function () { this.blip(220, 0.45); }.bind(this), 200);
  };

  PondAudio.prototype.toggle = function () {
    this.enabled = !this.enabled;
    if (!this.enabled && this.ctx) {
      this.noiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      this.humGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
    return this.enabled;
  };

  global.PondAudio = PondAudio;
})(typeof window !== "undefined" ? window : globalThis);
