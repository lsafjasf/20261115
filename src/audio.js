export class HarborAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.engineOsc = null;
    this.engineSub = null;
    this.compactorGain = null;
    this.compactorFilter = null;
    this.noiseSource = null;
    this.muted = false;
    this.alarmClock = 0;
    this.ready = false;
  }

  async init() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.72;
    this.master.connect(this.context.destination);

    this.engineFilter = this.context.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 320;
    this.engineFilter.Q.value = 2.6;

    this.engineGain = this.context.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);

    this.engineOsc = this.context.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 48;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc.start();

    this.engineSub = this.context.createOscillator();
    this.engineSub.type = "square";
    this.engineSub.frequency.value = 24;
    const subGain = this.context.createGain();
    subGain.gain.value = 0.22;
    this.engineSub.connect(subGain);
    subGain.connect(this.engineFilter);
    this.engineSub.start();

    this.createCompactorNoise();
    this.ready = true;
    await this.context.resume();
  }

  createCompactorNoise() {
    const length = this.context.sampleRate * 2;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.82 + white * 0.18;
      data[i] = last;
    }

    this.compactorFilter = this.context.createBiquadFilter();
    this.compactorFilter.type = "bandpass";
    this.compactorFilter.frequency.value = 145;
    this.compactorFilter.Q.value = 2.1;

    this.compactorGain = this.context.createGain();
    this.compactorGain.gain.value = 0;
    this.compactorFilter.connect(this.compactorGain);
    this.compactorGain.connect(this.master);

    this.noiseSource = this.context.createBufferSource();
    this.noiseSource.buffer = buffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.compactorFilter);
    this.noiseSource.start();
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(muted ? 0 : 0.72, now, 0.035);
  }

  status() {
    return {
      ready: this.ready,
      contextState: this.context?.state || "unavailable",
      muted: this.muted,
      engineLevel: Number((this.engineGain?.gain.value || 0).toFixed(4)),
      compactorLevel: Number((this.compactorGain?.gain.value || 0).toFixed(4)),
    };
  }

  update(state, maxSpeed, dt) {
    if (!this.ready || !this.context) return;
    const now = this.context.currentTime;
    const speedRatio = Math.min(1, Math.abs(state.boat.vx) / Math.max(1, maxSpeed));
    const playing = state.mode === "playing";
    const engineTarget = playing ? 0.035 + speedRatio * 0.12 : 0;
    const engineFreq = 42 + speedRatio * 58 + state.boat.mass * 0.34;

    this.engineGain.gain.setTargetAtTime(engineTarget, now, 0.08);
    this.engineOsc.frequency.setTargetAtTime(engineFreq, now, 0.1);
    this.engineSub.frequency.setTargetAtTime(engineFreq * 0.49, now, 0.12);
    this.engineFilter.frequency.setTargetAtTime(250 + speedRatio * 260, now, 0.08);

    const compacting = playing && state.boat.compacting && state.boat.battery > 0;
    this.compactorGain.gain.setTargetAtTime(compacting ? 0.16 : 0, now, compacting ? 0.035 : 0.09);
    this.compactorFilter.frequency.setTargetAtTime(112 + Math.sin(now * 31) * 24, now, 0.04);

    if (playing && state.boat.leak >= 64) {
      this.alarmClock -= dt;
      if (this.alarmClock <= 0) {
        const severe = state.boat.leak >= 86;
        this.alarmClock = severe ? 0.34 : 0.82;
        this.beep(severe ? 690 : 520, 0.09, 0.045, "square");
      }
    } else {
      this.alarmClock = 0;
    }
  }

  tone(frequency, duration, volume = 0.08, type = "sine", delay = 0, endFrequency = null) {
    if (!this.ready || this.muted) return;
    const ctx = this.context;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  beep(frequency, duration, volume, type = "sine") {
    this.tone(frequency, duration, volume, type);
  }

  collect() {
    this.tone(330, 0.1, 0.055, "triangle");
    this.tone(494, 0.15, 0.05, "triangle", 0.08);
  }

  compactStart() {
    this.tone(80, 0.18, 0.06, "sawtooth", 0, 43);
  }

  compactStop() {
    this.tone(54, 0.13, 0.035, "square", 0, 34);
  }

  reject() {
    this.tone(145, 0.13, 0.07, "square");
    this.tone(108, 0.18, 0.055, "square", 0.1);
  }

  deliver() {
    const notes = [262, 330, 392, 523];
    notes.forEach((note, index) => this.tone(note, 0.24, 0.07, "triangle", index * 0.11));
  }

  fail() {
    this.tone(230, 0.55, 0.08, "sawtooth", 0, 92);
    this.tone(180, 0.72, 0.05, "square", 0.24, 61);
  }
}
