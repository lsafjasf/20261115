// Web Audio 全合成音频引擎：无任何采样文件
// 脚步声按所在材质选择频段/混响；环境声源按相对位置做距离衰减与立体声声像
import { MATERIALS } from './maze.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.reverbs = {}; // material -> { convolver, input }
    this.nextDripAt = new Map();
    this.nextBeaconAt = 0;
    this.suspended = false;
  }

  ensure() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    // 每种材质一条混响总线（脉冲响应由噪声指数衰减生成）
    for (const [key, m] of Object.entries(MATERIALS)) {
      const conv = ctx.createConvolver();
      conv.buffer = this.makeImpulse(m.reverbTime);
      const input = ctx.createGain();
      input.gain.value = m.wetMix;
      input.connect(conv).connect(this.master);
      this.reverbs[key] = { convolver: conv, input };
    }
  }

  makeImpulse(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++)
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
    return buf;
  }

  resume() { this.ensure(); this.suspended = false; this.ctx.resume(); }
  suspend() { if (this.ctx) { this.suspended = true; this.ctx.suspend(); } }

  // 干声 + 对应材质混响
  route(node, material, wetAmount = 1) {
    node.connect(this.master);
    const rev = this.reverbs[material] || this.reverbs.stone;
    const g = this.ctx.createGain();
    g.gain.value = wetAmount;
    node.connect(g).connect(rev.input);
  }

  noiseBurst(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this.ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return buf;
  }

  // 脚步：短噪声脉冲 → 材质带通滤波 → 干/混响
  footstep(material) {
    if (!this.ctx || this.suspended) return;
    const m = MATERIALS[material] || MATERIALS.stone;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBurst(m.decay + 0.03);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = m.band * (0.92 + Math.random() * 0.16);
    bp.Q.value = m.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + m.decay + 0.05);
    src.connect(bp).connect(g);
    this.route(g, material);
    src.start(t);
  }

  // 撞墙：按墙面材质滤波的低频砰击，pan ∈ [-1,1] 指示墙在左/右
  bump(pan, material) {
    if (!this.ctx || this.suspended) return;
    const m = MATERIALS[material] || MATERIALS.stone;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBurst(0.12);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(900, m.band);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(lp).connect(g).connect(panner);
    this.route(panner, material, 0.7);
    src.start(t);
  }

  // 滴水：短促正弦"滴答"，音高下滑
  drip(pan, gainVal) {
    if (!this.ctx || this.suspended) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = 1800 + Math.random() * 900;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(g).connect(panner);
    this.route(panner, 'wet', 1.2);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  // 芯片信标：双音"哔"，距离越近间隔越短（由 update 调度）
  beacon(pan, gainVal) {
    if (!this.ctx || this.suspended) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [i, f] of [1320, 1760].entries()) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t0 = t + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gainVal, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      osc.connect(g).connect(panner).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    }
  }

  // 机械噪声：持续的滤波锯齿 + 慢速 LFO，每帧更新声像/音量
  startMachine() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55 + Math.random() * 25;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.7 + Math.random() * 0.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(lp.frequency);
    const g = ctx.createGain();
    g.gain.value = 0;
    const panner = ctx.createStereoPanner();
    osc.connect(lp).connect(g).connect(panner).connect(this.master);
    osc.start();
    lfo.start();
    return { osc, lfo, gain: g, panner };
  }

  // 出口：低频气流声（循环滤波噪声）
  startExitDrone() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBurst(2);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 320;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0;
    const panner = ctx.createStereoPanner();
    src.connect(bp).connect(g).connect(panner).connect(this.master);
    src.start();
    return { src, gain: g, panner };
  }

  jingle(freqs, dur = 0.14, gap = 0.1) {
    if (!this.ctx || this.suspended) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t0 = t + i * gap;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });
  }

  chipPickup() { this.jingle([880, 1174, 1568]); }
  win() { this.jingle([523, 659, 784, 1046], 0.3, 0.16); }
  fail() { this.jingle([392, 311, 233], 0.35, 0.22); }

  // 每帧根据听者位姿更新所有持续声源，并调度滴水/信标
  // spatial(x, y) → { pan, gain, dist }
  spatial(state, sx, sy, maxDist = 8) {
    const p = state.player;
    const dx = sx - p.x, dy = sy - p.y;
    const dist = Math.hypot(dx, dy);
    const rel = Math.atan2(dy, dx) - p.angle;
    const pan = Math.max(-1, Math.min(1, Math.sin(rel)));
    const gain = Math.max(0, 1 - dist / maxDist) ** 2;
    return { pan, gain, dist };
  }

  startAmbience(state) {
    this.ensure();
    this.stopAmbience();
    this.machines = state.maze.sources
      .filter((s) => s.kind === 'machine')
      .map((s) => ({ ...s, node: this.startMachine() }));
    this.exitDrone = this.startExitDrone();
    this.drips = state.maze.sources.filter((s) => s.kind === 'drip');
  }

  stopAmbience() {
    for (const m of this.machines || []) {
      try { m.node.osc.stop(); m.node.lfo.stop(); } catch {}
    }
    if (this.exitDrone) { try { this.exitDrone.src.stop(); } catch {} }
    this.machines = [];
    this.exitDrone = null;
    this.drips = [];
  }

  update(state) {
    if (!this.ctx || this.suspended || state.status !== 'playing') return;
    const now = this.ctx.currentTime;
    for (const m of this.machines || []) {
      const s = this.spatial(state, m.x + 0.5, m.y + 0.5, 7);
      m.node.gain.gain.value = s.gain * 0.5;
      m.node.panner.pan.value = s.pan;
    }
    if (this.exitDrone) {
      const e = state.maze.exit;
      const s = this.spatial(state, e.x + 0.5, e.y + 0.5, 9);
      this.exitDrone.gain.gain.value = s.gain * 0.6;
      this.exitDrone.panner.pan.value = s.pan;
    }
    for (const d of this.drips || []) {
      const s = this.spatial(state, d.x + 0.5, d.y + 0.5, 6);
      const due = this.nextDripAt.get(d.id) || 0;
      if (s.gain > 0.01 && now >= due) {
        this.drip(s.pan, 0.15 + s.gain * 0.5);
        this.nextDripAt.set(d.id, now + 0.9 + Math.random() * 1.6);
      }
    }
    // 最近未收集芯片的信标，距离越近响得越急
    let nearest = null;
    for (const c of state.chips) {
      if (c.taken) continue;
      const s = this.spatial(state, c.x + 0.5, c.y + 0.5, 10);
      if (!nearest || s.dist < nearest.s.dist) nearest = { c, s };
    }
    if (nearest && now >= this.nextBeaconAt) {
      this.beacon(nearest.s.pan, 0.12 + nearest.s.gain * 0.4);
      this.nextBeaconAt = now + 0.35 + Math.min(2.2, nearest.s.dist * 0.35);
    }
  }
}
