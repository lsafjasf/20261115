export class GreenhouseAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.hum = null;
    this.humGain = null;
    this.warning = null;
    this.warningGain = null;
    this.noiseGain = null;
    this.muted = false;
    this.active = false;
  }

  async ensureStarted() {
    if (!this.context) this.createGraph();
    if (this.context.state === "suspended") await this.context.resume();
    this.active = true;
  }

  createGraph() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.18;
    this.master.connect(this.context.destination);

    this.hum = this.context.createOscillator();
    this.hum.type = "sawtooth";
    this.hum.frequency.value = 48;
    this.humGain = this.context.createGain();
    this.humGain.gain.value = 0;
    const humFilter = this.context.createBiquadFilter();
    humFilter.type = "lowpass";
    humFilter.frequency.value = 260;
    this.hum.connect(humFilter).connect(this.humGain).connect(this.master);
    this.hum.start();

    this.warning = this.context.createOscillator();
    this.warning.type = "triangle";
    this.warning.frequency.value = 640;
    this.warningGain = this.context.createGain();
    this.warningGain.gain.value = 0;
    this.warning.connect(this.warningGain).connect(this.master);
    this.warning.start();

    const noiseBuffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    const noise = this.context.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = this.context.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 420;
    noiseFilter.Q.value = 0.35;
    this.noiseGain = this.context.createGain();
    this.noiseGain.gain.value = 0.08;
    noise.connect(noiseFilter).connect(this.noiseGain).connect(this.master);
    noise.start();
  }

  update({ moving, rackSpeed, maxTemp, running, muted }) {
    if (!this.context || !this.hum) return;
    const now = this.context.currentTime;
    const hot = Math.max(0, maxTemp - 38);
    const move = Math.min(1, rackSpeed / 1.1);
    this.hum.frequency.setTargetAtTime(50 + move * 92 + hot * 7.5, now, 0.09);
    this.humGain.gain.setTargetAtTime(
      running ? (muted ? 0 : 0.055 + move * 0.12 + hot * 0.012) : 0,
      now,
      0.12,
    );
    const warning = running && !muted && maxTemp > 43.3;
    this.warningGain.gain.setTargetAtTime(warning ? 0.016 + hot * 0.004 : 0, now, 0.08);
    this.warning.frequency.setTargetAtTime(560 + Math.sin(now * 5) * 65, now, 0.03);
    this.noiseGain.gain.setTargetAtTime(running && !muted ? 0.07 : 0, now, 0.2);
  }

  toggle() {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.18, this.context.currentTime, 0.05);
    }
    return !this.muted;
  }
}
