export class TensionAudio {
  constructor() {
    this.context = null;
    this.oscillator = null;
    this.harmonic = null;
    this.gain = null;
    this.harmonicGain = null;
    this.muted = false;
    this.lastFrequency = 0;
  }

  async ensure() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    this.context = new AudioContextClass();
    this.oscillator = this.context.createOscillator();
    this.harmonic = this.context.createOscillator();
    this.gain = this.context.createGain();
    this.harmonicGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const compressor = this.context.createDynamicsCompressor();

    this.oscillator.type = "triangle";
    this.harmonic.type = "sine";
    this.oscillator.frequency.value = 110;
    this.harmonic.frequency.value = 220;
    this.gain.gain.value = 0;
    this.harmonicGain.gain.value = 0;
    filter.type = "lowpass";
    filter.frequency.value = 1250;
    filter.Q.value = 0.7;
    compressor.threshold.value = -22;
    compressor.knee.value = 14;
    compressor.ratio.value = 4;

    this.oscillator.connect(this.gain);
    this.harmonic.connect(this.harmonicGain);
    this.harmonicGain.connect(this.gain);
    this.gain.connect(filter);
    filter.connect(compressor);
    compressor.connect(this.context.destination);
    this.oscillator.start();
    this.harmonic.start();
  }

  setMuted(muted) {
    this.muted = muted;
  }

  update(tension, status = "live") {
    if (!this.context) {
      this.lastFrequency = 128 + Math.min(1, tension / 1450) * 590;
      return this.lastFrequency;
    }
    const ratio = Math.max(0, Math.min(1, tension / 1450));
    const frequency = 128 + ratio * 590;
    const danger = Math.max(0, tension - 850) / 700;
    const active = status === "live" || status === "success";
    const baseGain = active ? 0.025 + ratio * 0.065 : 0.006;
    const gain = this.muted ? 0 : baseGain;
    const now = this.context.currentTime;
    const timeConstant = 0.06;

    this.lastFrequency = frequency;
    this.oscillator.frequency.setTargetAtTime(frequency, now, timeConstant);
    this.harmonic.frequency.setTargetAtTime(frequency * 2.02, now, timeConstant);
    this.gain.gain.setTargetAtTime(gain, now, timeConstant);
    this.harmonicGain.gain.setTargetAtTime(
      this.muted ? 0 : (0.006 + danger * 0.035) * Math.min(1, ratio * 2),
      now,
      timeConstant
    );
    return frequency;
  }
}
