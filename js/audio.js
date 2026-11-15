export class DrumSynth {
  constructor() {
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  async unlock() {
    if (!this.context) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.88;
      this.master.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer();
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    return this.context.state === "running";
  }

  createNoiseBuffer() {
    const length = Math.floor(this.context.sampleRate * 0.25);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  play(id) {
    if (!this.context || this.context.state !== "running") return;
    const start = this.context.currentTime + 0.012;
    if (id === 0) this.playKick(start);
    if (id === 1) this.playSnare(start);
    if (id === 2) this.playHat(start);
    if (id === 3) this.playTom(start);
  }

  playKick(start) {
    const { context } = this;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const pitch = context.createBiquadFilter();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(138, start);
    oscillator.frequency.exponentialRampToValueAtTime(42, start + 0.24);
    pitch.type = "lowpass";
    pitch.frequency.value = 720;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.8, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
    oscillator.connect(pitch).connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + 0.36);

    const click = context.createOscillator();
    const clickGain = context.createGain();
    click.type = "triangle";
    click.frequency.value = 96;
    clickGain.gain.setValueAtTime(0.16, start);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);
    click.connect(clickGain).connect(this.master);
    click.start(start);
    click.stop(start + 0.08);
  }

  playSnare(start) {
    const { context } = this;
    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noise.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = 1650;
    filter.Q.value = 0.72;
    noiseGain.gain.setValueAtTime(0.0001, start);
    noiseGain.gain.exponentialRampToValueAtTime(0.55, start + 0.008);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);
    noise.connect(filter).connect(noiseGain).connect(this.master);
    noise.start(start);
    noise.stop(start + 0.21);

    const body = context.createOscillator();
    const bodyGain = context.createGain();
    body.type = "triangle";
    body.frequency.setValueAtTime(185, start);
    body.frequency.exponentialRampToValueAtTime(92, start + 0.12);
    bodyGain.gain.setValueAtTime(0.28, start);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    body.connect(bodyGain).connect(this.master);
    body.start(start);
    body.stop(start + 0.18);
  }

  playHat(start) {
    const { context } = this;
    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    noise.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.value = 5200;
    filter.Q.value = 0.55;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.075);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(start);
    noise.stop(start + 0.09);
  }

  playTom(start) {
    const { context } = this;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(225, start);
    oscillator.frequency.exponentialRampToValueAtTime(82, start + 0.26);
    filter.type = "lowpass";
    filter.frequency.value = 980;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.48, start + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.31);
    oscillator.connect(filter).connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + 0.33);
  }
}
