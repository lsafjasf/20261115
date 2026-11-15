/* Procedural footstep audio: everything is synthesized with Web Audio.
   No samples are loaded or played. */

const MATERIALS = [
  { id: "wood",   name: "木板", code: "WD", rvb: 0.24, dmp: 0.28, color: "#b07a45",
    hp: 320, lp: 3200, noise: 0.5, thump: 0.9, thumpFreq: 110, decay: 0.11, pan: -0.25 },
  { id: "gravel", name: "碎石", code: "GR", rvb: 0.14, dmp: 0.38, color: "#9aa08f",
    hp: 900, lp: 5200, noise: 1.0, thump: 0.25, thumpFreq: 90, decay: 0.07, pan: 0.22 },
  { id: "metal",  name: "铁板", code: "MT", rvb: 0.30, dmp: 0.78, color: "#9fb4c4",
    hp: 500, lp: 7800, noise: 0.7, thump: 0.7, thumpFreq: 240, decay: 0.26, pan: -0.1, ring: 1850 },
  { id: "stone",  name: "石板", code: "ST", rvb: 0.32, dmp: 0.42, color: "#8d938a",
    hp: 240, lp: 4200, noise: 0.65, thump: 0.8, thumpFreq: 95, decay: 0.16, pan: 0.12 },
  { id: "sand",   name: "沙地", code: "SD", rvb: 0.08, dmp: 0.13, color: "#d6b779",
    hp: 1400, lp: 3400, noise: 0.85, thump: 0.15, thumpFreq: 70, decay: 0.05, pan: 0.3 },
  { id: "moss",   name: "苔藓", code: "MS", rvb: 0.19, dmp: 0.62, color: "#6f9a5e",
    hp: 180, lp: 1500, noise: 0.35, thump: 0.5, thumpFreq: 80, decay: 0.13, pan: -0.35 }
];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.convolver = null;
    this.wetGain = null;
    this.dryGain = null;
    this.playing = false;
    this.stopToken = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this._impulse(2.4, 2.6);
    this.wetGain = this.ctx.createGain();
    this.wetGain.gain.value = 0.5;
    this.convolver.connect(this.wetGain).connect(this.master);

    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.value = 1;
    this.dryGain.connect(this.master);
  }

  /* Exponentially decaying stereo noise impulse response for the convolution reverb. */
  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  _noiseBuffer(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* One footstep: filtered noise burst + body thump + optional metallic ring,
     routed through the shared convolver whose wet level follows the material. */
  step(mat, when = 0, level = 1) {
    this.ensure();
    const ctx = this.ctx;
    const t = when || ctx.currentTime;

    const panner = ctx.createStereoPanner();
    panner.pan.value = mat.pan;

    const dry = ctx.createGain();
    dry.gain.value = (1 - mat.dmp) * 0.9 + 0.1;
    panner.connect(dry).connect(this.dryGain);

    const wet = ctx.createGain();
    wet.gain.value = mat.rvb * 2.2;
    panner.connect(wet).connect(this.convolver);

    const out = ctx.createGain();
    out.gain.value = level;
    out.connect(panner);

    if (mat.noise > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer(mat.decay + 0.05);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = mat.hp;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = mat.lp;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.5 * mat.noise, t + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, t + mat.decay);
      src.connect(hp).connect(lp).connect(env).connect(out);
      src.start(t);
      src.stop(t + mat.decay + 0.06);
    }

    if (mat.thump > 0) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(mat.thumpFreq * 1.4, t);
      osc.frequency.exponentialRampToValueAtTime(mat.thumpFreq * 0.7, t + 0.09);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.6 * mat.thump, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + 0.16);
    }

    if (mat.ring) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = mat.ring;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + mat.decay + 0.12);
      osc.connect(env).connect(out);
      osc.start(t);
      osc.stop(t + mat.decay + 0.14);
    }
  }

  /* A single material preview: three quick steps so its reverb character is audible. */
  preview(mat) {
    this.ensure();
    const base = this.ctx.currentTime + 0.02;
    this.step(mat, base, 0.9);
    this.step(mat, base + 0.24, 0.8);
    this.step(mat, base + 0.48, 0.7);
    return base + 0.7;
  }

  /* Full six-source playback. Each segment is a cluster of steps on one material,
     in the actual path order. onSegment/onTick drive the waveform monitor. */
  async playSequence(order, hooks) {
    this.ensure();
    const token = ++this.stopToken;
    this.playing = true;
    const segGap = 0.16;
    const stepsPerSeg = 3;
    const stepGap = 0.27;
    const segDur = (stepsPerSeg - 1) * stepGap + 0.55;
    const total = order.length * segDur + (order.length - 1) * segGap;
    let cursor = this.ctx.currentTime + 0.08;
    const starts = [];
    order.forEach((mat, i) => {
      starts.push(cursor);
      for (let s = 0; s < stepsPerSeg; s++) this.step(mat, cursor + s * stepGap, 1 - s * 0.12);
      cursor += segDur + segGap;
    });
    const begin = this.ctx.currentTime;
    hooks && hooks.onStart && hooks.onStart(total, order);
    while (this.ctx) {
      const elapsed = this.ctx.currentTime - begin;
      if (token !== this.stopToken || elapsed >= total) break;
      let seg = 0;
      for (let i = 0; i < starts.length; i++) if (this.ctx.currentTime >= starts[i]) seg = i;
      hooks && hooks.onTick && hooks.onTick(elapsed, total, seg);
      await new Promise(r => setTimeout(r, 40));
    }
    this.playing = false;
    hooks && hooks.onEnd && hooks.onEnd(token === this.stopToken);
  }

  stop() {
    this.stopToken++;
    this.playing = false;
  }
}

window.AudioEngine = AudioEngine;
window.MATERIALS = MATERIALS;
