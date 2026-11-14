// 纯 Web Audio 合成：警笛、广播提示音、操作确认音，无外部资源
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sirenNodes = null;
    this.sirenOn = false;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  resume() {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  // 双音调警笛：LFO 调制方波频率，620Hz <-> 760Hz 循环
  startSiren() {
    this.ensure();
    if (this.sirenOn) return;
    this.sirenOn = true;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.9;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 70;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.frequency.value = 690;

    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    lfo.start();
    this.sirenNodes = { osc, lfo, gain };
  }

  stopSiren() {
    if (!this.sirenOn) return;
    this.sirenOn = false;
    const { osc, lfo, gain } = this.sirenNodes;
    const ctx = this.ctx;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    setTimeout(() => {
      try { osc.stop(); lfo.stop(); } catch { /* 已停止 */ }
    }, 120);
    this.sirenNodes = null;
  }

  // 广播提示音：两声短促双音（叮-咚），随后语音播报占位
  broadcast(message) {
    this.ensure();
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = [[880, 0], [660, 0.18]];
    for (const [freq, offset] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    }
    if ('speechSynthesis' in window && message) {
      const utter = new SpeechSynthesisUtterance(message);
      utter.lang = 'zh-CN';
      utter.rate = 1.05;
      utter.volume = 0.9;
      window.speechSynthesis.speak(utter);
    }
  }

  // 操作确认音：短促上行音
  click() {
    this.ensure();
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(780, now + 0.08);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  // 胜利/失败音
  fanfare(win) {
    this.ensure();
    const ctx = this.ctx;
    const seq = win ? [523, 659, 784, 1047] : [392, 330, 262, 196];
    seq.forEach((freq, i) => {
      const now = ctx.currentTime + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.25);
    });
  }
}
