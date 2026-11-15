export class TideAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.filter = null;
    this.drone = null;
    this.edge = null;
    this.enabled = false;
    this.lastTone = 0;
  }

  async enable() {
    if (!this.context) this.createGraph();
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = true;
    this.master.gain.setTargetAtTime(0.075, this.context.currentTime, 0.25);
  }

  disable() {
    if (!this.context || !this.master) return;
    this.enabled = false;
    this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
  }

  createGraph() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.filter = this.context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 420;
    this.filter.Q.value = 1.8;

    this.drone = this.context.createOscillator();
    this.drone.type = "sine";
    this.drone.frequency.value = 76;
    this.droneGain = this.context.createGain();
    this.droneGain.gain.value = 0.46;
    this.drone.connect(this.droneGain).connect(this.filter);

    this.edge = this.context.createOscillator();
    this.edge.type = "triangle";
    this.edge.frequency.value = 142;
    this.edgeGain = this.context.createGain();
    this.edgeGain.gain.value = 0.09;
    this.edge.connect(this.edgeGain).connect(this.filter);

    this.noise = this.context.createBufferSource();
    this.noise.buffer = this.oceanNoise();
    this.noise.loop = true;
    this.noiseGain = this.context.createGain();
    this.noiseGain.gain.value = 0.055;
    this.noise.connect(this.noiseGain).connect(this.filter);
    this.filter.connect(this.master).connect(this.context.destination);

    this.drone.start();
    this.edge.start();
    this.noise.start();
  }

  oceanNoise() {
    const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let value = 0;
    for (let index = 0; index < data.length; index += 1) {
      value = value * 0.985 + (Math.random() * 2 - 1) * 0.015;
      data[index] = value;
    }
    return buffer;
  }

  update(tension, speed, active = true) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const normalizedSpeed = Math.min(Math.max((speed - 20) / 58, 0), 1);
    this.drone.frequency.setTargetAtTime(62 + normalizedSpeed * 36 + tension * 8, now, 0.14);
    this.edge.frequency.setTargetAtTime(126 + tension * 154 + normalizedSpeed * 22, now, 0.11);
    this.filter.frequency.setTargetAtTime(240 + normalizedSpeed * 390 + tension * 440, now, 0.12);
    this.droneGain.gain.setTargetAtTime(active ? 0.38 - tension * 0.12 : 0.1, now, 0.18);
    this.edgeGain.gain.setTargetAtTime(active ? 0.055 + tension * 0.16 : 0.02, now, 0.15);
    this.noiseGain.gain.setTargetAtTime(active ? 0.035 + normalizedSpeed * 0.055 : 0.015, now, 0.18);
  }

  blip(type) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    if (type === "checkpoint" && now - this.lastTone < 0.08) return;
    this.lastTone = now;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const isCollision = type === "collision";
    oscillator.type = isCollision ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(isCollision ? 92 : 660, now);
    oscillator.frequency.exponentialRampToValueAtTime(isCollision ? 42 : 990, now + (isCollision ? 0.3 : 0.13));
    gain.gain.setValueAtTime(isCollision ? 0.1 : 0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (isCollision ? 0.4 : 0.2));
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.45);
  }
}
