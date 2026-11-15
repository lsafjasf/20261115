const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class WindAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.windGain = null;
    this.windFilter = null;
    this.noiseSource = null;
    this.tone = null;
    this.enabled = false;
  }

  async enable() {
    if (!this.context) this.createGraph();
    await this.context.resume();
    this.enabled = true;
    this.master.gain.setTargetAtTime(0.72, this.context.currentTime, 0.08);
    return true;
  }

  createGraph() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);

    const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      samples[index] = last * 2.7 + white * 0.18;
    }

    this.noiseSource = this.context.createBufferSource();
    this.noiseSource.buffer = buffer;
    this.noiseSource.loop = true;
    this.windFilter = this.context.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 620;
    this.windFilter.Q.value = 0.72;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.016;
    this.noiseSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.noiseSource.start();

    this.tone = this.context.createOscillator();
    this.tone.type = "sine";
    this.tone.frequency.value = 58;
    const toneGain = this.context.createGain();
    toneGain.gain.value = 0.012;
    this.tone.connect(toneGain);
    toneGain.connect(this.master);
    this.tone.start();
    this.toneGain = toneGain;
  }

  update(flight) {
    if (!this.enabled || !flight || !this.context) return;
    const now = this.context.currentTime;
    const windMagnitude = Math.hypot(flight.wind?.x ?? 0, flight.wind?.y ?? 0);
    const relativeSpeed = flight.speed ?? 0;
    const gust = clamp(windMagnitude / 10, 0, 1);
    const speed = clamp(relativeSpeed / 42, 0, 1);
    const active = flight.status === "flying";

    this.windGain.gain.setTargetAtTime(active ? 0.01 + speed * 0.026 + gust * 0.018 : 0.006, now, 0.12);
    this.windFilter.frequency.setTargetAtTime(320 + relativeSpeed * 21 + gust * 240, now, 0.16);
    this.windFilter.Q.setTargetAtTime(0.55 + gust * 0.7, now, 0.2);
    this.tone.frequency.setTargetAtTime(48 + relativeSpeed * 1.1, now, 0.22);
    this.toneGain.gain.setTargetAtTime(active ? 0.006 + speed * 0.012 : 0.004, now, 0.2);
  }

  async disable() {
    this.enabled = false;
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
    }
  }

  setMuted(muted) {
    if (!this.context) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.context.currentTime, 0.08);
  }
}
