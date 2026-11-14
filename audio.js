// Web Audio 磁浮音效：推进/制动磁场嗡鸣随速度与磁力变化，碰撞/急停有冲击音。
(function (root) {
  'use strict';

  function MaglevAudio() {
    this.ctx = null;
    this.master = null;
    this.osc = null;
    this.gain = null;
    this.lfo = null;
    this.lfoGain = null;
    this.enabled = true;
  }

  MaglevAudio.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(this.ctx.destination);

    // 磁场基频振荡器（锯齿波 -> 低通，模拟电磁嗡鸣）
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 70;
    var filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    this.filter = filter;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.12;
    this.osc.connect(filter);
    filter.connect(this.gain);
    this.gain.connect(this.master);

    // 磁场脉动 LFO
    this.lfo = this.ctx.createOscillator();
    this.lfo.frequency.value = 6;
    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.value = 18;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.osc.frequency);
    this.osc.start();
    this.lfo.start();
  };

  // speedRatio: 0..1；magnet: -1 制动 / 0 滑行 / 1 推进
  MaglevAudio.prototype.update = function (speedRatio, magnet, active) {
    if (!this.ctx || !this.enabled) return;
    var t = this.ctx.currentTime;
    var base = 60 + speedRatio * 150;             // 速度越高频率越高
    if (magnet < 0) base += 40;                   // 制动磁轨升频
    this.osc.frequency.setTargetAtTime(base, t, 0.08);
    this.lfo.frequency.setTargetAtTime(4 + speedRatio * 10, t, 0.1);
    this.filter.frequency.setTargetAtTime(400 + speedRatio * 1400 + (magnet < 0 ? 500 : 0), t, 0.1);
    var target = active ? 0.0001 + speedRatio * 0.09 + Math.abs(magnet) * 0.03 : 0.0001;
    this.master.gain.setTargetAtTime(target, t, 0.12);
  };

  MaglevAudio.prototype.blip = function (kind) {
    if (!this.ctx || !this.enabled) return;
    var t = this.ctx.currentTime;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.connect(g);
    g.connect(this.master);
    if (kind === 'switch') {
      o.type = 'square';
      o.frequency.setValueAtTime(880, t);
      o.frequency.exponentialRampToValueAtTime(440, t + 0.12);
    } else if (kind === 'stop') {
      o.type = 'sine';
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(260, t + 0.18);
    } else {
      // 冲突/急停/碰撞：噪声式下沉冲击
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    }
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.start(t);
    o.stop(t + 0.5);
  };

  MaglevAudio.prototype.suspend = function () {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  };

  root.MaglevAudio = MaglevAudio;
})(window);
