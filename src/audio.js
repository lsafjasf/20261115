export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.running = false;
    this.nodes = null;
  }

  async unlock() {
    if (!this.enabled) return;
    if (!this.ctx) this.build();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.setRunning(this.running);
  }

  build() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = this.enabled ? 1 : 0;
    master.connect(ctx.destination);

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineGain.connect(master);
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 260;
    engineFilter.Q.value = 2.4;
    engineFilter.connect(engineGain);

    const engineA = ctx.createOscillator();
    engineA.type = "sawtooth";
    engineA.frequency.value = 48;
    engineA.connect(engineFilter);
    const engineB = ctx.createOscillator();
    engineB.type = "triangle";
    engineB.frequency.value = 93;
    engineB.connect(engineFilter);

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < noiseData.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.82 + white * 0.18;
      noiseData[index] = previous;
    }
    const roadNoise = ctx.createBufferSource();
    roadNoise.buffer = noiseBuffer;
    roadNoise.loop = true;
    const roadFilter = ctx.createBiquadFilter();
    roadFilter.type = "bandpass";
    roadFilter.frequency.value = 510;
    roadFilter.Q.value = 0.7;
    const roadGain = ctx.createGain();
    roadGain.gain.value = 0;
    roadNoise.connect(roadFilter);
    roadFilter.connect(roadGain);
    roadGain.connect(master);

    const saltNoise = ctx.createBufferSource();
    saltNoise.buffer = noiseBuffer;
    saltNoise.loop = true;
    const saltFilter = ctx.createBiquadFilter();
    saltFilter.type = "bandpass";
    saltFilter.frequency.value = 1850;
    saltFilter.Q.value = 1.3;
    const saltGain = ctx.createGain();
    saltGain.gain.value = 0;
    saltNoise.connect(saltFilter);
    saltFilter.connect(saltGain);
    saltGain.connect(master);

    engineA.start();
    engineB.start();
    roadNoise.start();
    saltNoise.start();
    this.ctx = ctx;
    this.nodes = {
      master,
      engineGain,
      engineFilter,
      engineA,
      engineB,
      roadGain,
      roadFilter,
      saltGain,
      saltFilter,
    };
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!this.nodes) return;
    const target = enabled ? 1 : 0;
    this.nodes.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.nodes.master.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.15);
  }

  setRunning(running) {
    this.running = running;
    if (!this.nodes || !this.enabled) return;
    const now = this.ctx.currentTime;
    const speed = this.nodes.engineA.frequency.value;
    this.nodes.engineGain.gain.linearRampToValueAtTime(running ? 0.055 : 0, now + 0.2);
    this.nodes.roadGain.gain.linearRampToValueAtTime(running ? 0.018 : 0, now + 0.2);
    this.nodes.engineA.frequency.linearRampToValueAtTime(
      running ? speed : 38,
      now + 0.2,
    );
  }

  update(controls, running) {
    if (!this.nodes || !this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const speedNorm = (controls.speed - 8) / 22;
    const engineFrequency = 45 + speedNorm * 48;
    this.nodes.engineA.frequency.setTargetAtTime(engineFrequency, now, 0.1);
    this.nodes.engineB.frequency.setTargetAtTime(engineFrequency * 1.83, now, 0.1);
    this.nodes.engineFilter.frequency.setTargetAtTime(165 + speedNorm * 260, now, 0.12);
    this.nodes.roadFilter.frequency.setTargetAtTime(390 + speedNorm * 410, now, 0.12);
    const active = running ? 1 : 0;
    this.nodes.engineGain.gain.setTargetAtTime(active * (0.036 + speedNorm * 0.045), now, 0.12);
    this.nodes.roadGain.gain.setTargetAtTime(active * (0.009 + speedNorm * 0.025), now, 0.1);
    this.nodes.saltGain.gain.setTargetAtTime(active * controls.outlet * 0.085, now, 0.08);
    this.nodes.saltFilter.frequency.setTargetAtTime(
      1250 + controls.outlet * 1250 + speedNorm * 240,
      now,
      0.08,
    );
  }
}
