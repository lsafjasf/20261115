/**
 * Web Audio 提示音：调角滴答、信号建立、信号丢失、过热警告、锁定、解锁、胜利。
 * 浏览器环境专用；所有方法在 AudioContext 不可用时静默降级。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CanyonAudio = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class SoundFX {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
    }

    // 浏览器自动播放策略要求用户手势后才能启动
    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        return;
      }
      const AC = (typeof window !== 'undefined') &&
        (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch (err) {
        this.ctx = null;
      }
    }

    tone(freq, duration, type, when, gainPeak) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + (when || 0);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gainPeak || 0.3, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    }

    step() { this.tone(520, 0.05, 'square', 0, 0.12); }

    signal(index) {
      const base = [660, 880, 1108][index] || 660;
      this.tone(base, 0.12, 'sine', 0, 0.28);
      this.tone(base * 1.5, 0.16, 'sine', 0.09, 0.2);
    }

    signalLost() {
      this.tone(300, 0.18, 'sawtooth', 0, 0.18);
      this.tone(180, 0.22, 'sawtooth', 0.1, 0.14);
    }

    overheat() {
      // 双音交替警报
      this.tone(880, 0.14, 'square', 0, 0.22);
      this.tone(620, 0.14, 'square', 0.16, 0.22);
      this.tone(880, 0.14, 'square', 0.32, 0.22);
    }

    lock() {
      this.tone(160, 0.35, 'sawtooth', 0, 0.25);
      this.tone(90, 0.4, 'triangle', 0.08, 0.22);
    }

    unlock() {
      this.tone(440, 0.1, 'triangle', 0, 0.2);
      this.tone(587, 0.14, 'triangle', 0.08, 0.2);
    }

    win() {
      [523, 659, 784, 1046].forEach((f, i) =>
        this.tone(f, 0.22, 'sine', i * 0.13, 0.26));
    }

    // 由游戏事件驱动
    handle(events) {
      for (const e of events) {
        switch (e.type) {
          case 'step': this.step(); break;
          case 'signal': this.signal(e.index); break;
          case 'signalLost': this.signalLost(); break;
          case 'overheat': this.overheat(); this.lock(); break;
          case 'unlock': this.unlock(); break;
          case 'win': this.win(); break;
        }
      }
    }

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
    }
  }

  return { SoundFX };
});
