export class IceAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.enabled = false;
    this.muted = false;
    this.nodes = {};
    this.noiseBuffer = null;
  }

  async enable() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return true;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.context.destination);
    this.noiseBuffer = this.createNoiseBuffer(2.2);
    this.createWind();
    this.createEngine();
    this.createDrill();
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = true;
    return true;
  }

  createNoiseBuffer(seconds) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[index] = last;
    }
    return buffer;
  }

  makeLoopNoise(filterType, frequency, quality, gainValue) {
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = quality;
    const gain = this.context.createGain();
    gain.gain.value = gainValue;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    return { source, filter, gain };
  }

  createWind() {
    this.nodes.wind = this.makeLoopNoise("lowpass", 380, 0.35, 0.014);
  }

  createEngine() {
    const low = this.context.createOscillator();
    const high = this.context.createOscillator();
    low.type = "sawtooth";
    high.type = "triangle";
    low.frequency.value = 42;
    high.frequency.value = 83;
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 190;
    filter.Q.value = 1.2;
    const gain = this.context.createGain();
    gain.gain.value = 0.0001;
    low.connect(filter);
    high.connect(filter);
    filter.connect(gain).connect(this.master);
    low.start();
    high.start();
    this.nodes.engine = { low, high, filter, gain };
  }

  createDrill() {
    const motor = this.context.createOscillator();
    const whine = this.context.createOscillator();
    motor.type = "square";
    whine.type = "sine";
    motor.frequency.value = 72;
    whine.frequency.value = 240;
    const motorFilter = this.context.createBiquadFilter();
    motorFilter.type = "lowpass";
    motorFilter.frequency.value = 280;
    const motorGain = this.context.createGain();
    motorGain.gain.value = 0.0001;
    const whineGain = this.context.createGain();
    whineGain.gain.value = 0.0001;
    motor.connect(motorFilter).connect(motorGain).connect(this.master);
    whine.connect(whineGain).connect(this.master);
    motor.start();
    whine.start();

    const grit = this.makeLoopNoise("bandpass", 1250, 0.8, 0.0001);
    this.nodes.drill = {
      motor,
      whine,
      motorFilter,
      motorGain,
      whineGain,
      grit,
    };
  }

  setParam(param, value, time = 0.08) {
    if (!this.context) return;
    param.setTargetAtTime(value, this.context.currentTime, time);
  }

  update(state) {
    if (!this.enabled || !this.context) return;
    const running = state.mode !== "title" && state.mode !== "complete";
    const speed = Math.abs(state.speed || 0);
    const engine = this.nodes.engine;
    const drill = this.nodes.drill;
    this.setParam(
      engine.gain.gain,
      running ? 0.018 + (speed / 100) * 0.045 : 0.0001,
    );
    this.setParam(engine.low.frequency, 38 + speed * 0.36);
    this.setParam(engine.high.frequency, 76 + speed * 0.72);
    this.setParam(engine.filter.frequency, 160 + speed * 2.1);

    const drilling = state.mode === "drilling";
    const rpm = state.drilling?.rpm || 0;
    const torque = state.drilling?.torque || 0;
    const jam = state.drilling?.jam;
    this.setParam(drill.motorGain.gain, drilling ? 0.026 : 0.0001);
    this.setParam(drill.whineGain.gain, drilling ? 0.008 + rpm * 0.00009 : 0.0001);
    this.setParam(drill.motor.frequency, 48 + rpm * 0.62);
    this.setParam(drill.whine.frequency, 150 + rpm * 3.7);
    this.setParam(drill.motorFilter.frequency, 220 + rpm * 3.2);
    this.setParam(
      drill.grit.gain.gain,
      drilling && !jam ? 0.003 + (torque / 170) * 0.022 : 0.0001,
    );
    this.setParam(drill.grit.filter.frequency, 920 + torque * 8);
  }

  playEvent(cue) {
    if (!this.enabled || !this.context || this.muted || !cue) return;
    if (cue.sound === "ice-crack") this.iceCrack(cue.intensity || 1);
    if (cue.sound === "bridge") this.bridgeThud(cue.intensity || 1);
    if (cue.sound === "jam") this.jam();
    if (cue.sound === "core") this.coreChime();
    if (cue.sound === "success") this.successChime();
    if (cue.sound === "failure") this.failureTone();
    if (cue.sound === "overheat") this.alarm();
  }

  iceCrack(intensity) {
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(720, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + 0.8);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      Math.min(0.4, 0.13 * intensity),
      now + 0.012,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 1.2);

    const snap = this.context.createOscillator();
    const snapGain = this.context.createGain();
    snap.type = "triangle";
    snap.frequency.setValueAtTime(95, now);
    snap.frequency.exponentialRampToValueAtTime(38, now + 0.3);
    snapGain.gain.setValueAtTime(0.12 * intensity, now);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    snap.connect(snapGain).connect(this.master);
    snap.start(now);
    snap.stop(now + 0.4);
  }

  bridgeThud(intensity) {
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(74, now);
    oscillator.frequency.exponentialRampToValueAtTime(42, now + 0.18);
    gain.gain.setValueAtTime(0.075 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.32);
  }

  jam() {
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(145, now);
    oscillator.frequency.exponentialRampToValueAtTime(34, now + 0.55);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.76);
    this.iceCrack(0.45);
  }

  coreChime() {
    this.toneSequence([440, 660, 880], 0.13, 0.085, "sine");
  }

  successChime() {
    this.toneSequence([330, 495, 660, 990], 0.18, 0.09, "sine");
  }

  failureTone() {
    this.toneSequence([220, 174, 130], 0.25, 0.08, "triangle");
  }

  alarm() {
    this.toneSequence([740, 520, 740], 0.2, 0.07, "square");
  }

  toneSequence(frequencies, spacing, volume, type) {
    const now = this.context.currentTime;
    frequencies.forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      const start = now + index * spacing;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + spacing * 0.95);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + spacing);
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) {
      this.setParam(this.master.gain, this.muted ? 0.0001 : 0.7, 0.04);
    }
    return this.muted;
  }

  getState() {
    return {
      supported: Boolean(window.AudioContext || window.webkitAudioContext),
      enabled: this.enabled,
      state: this.context?.state || "closed",
      muted: this.muted,
    };
  }
}
