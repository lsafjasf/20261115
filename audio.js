export class StormAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.playing = false;
    this.master = null;
    this.rainGain = null;
    this.rainFilter = null;
    this.waterGain = null;
    this.waterFilter = null;
    this.rumbleGain = null;
    this.lastUpdate = 0;
  }

  async ensure() {
    if (!this.enabled) return false;
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      this.context = new AudioContext();
      this.buildGraph();
    }
    if (this.context.state === "suspended") {
      try {
        await this.context.resume();
      } catch {
        return false;
      }
    }
    return this.context.state === "running";
  }

  buildGraph() {
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const rainBuffer = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
    const waterBuffer = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const rainData = rainBuffer.getChannelData(channel);
      const waterData = waterBuffer.getChannelData(channel);
      let brown = 0;
      for (let i = 0; i < rainData.length; i += 1) {
        const white = Math.random() * 2 - 1;
        brown = (brown + 0.018 * white) / 1.018;
        rainData[i] = white * 0.42;
        waterData[i] = brown * 2.8;
      }
    }

    const rainSource = ctx.createBufferSource();
    rainSource.buffer = rainBuffer;
    rainSource.loop = true;
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = "bandpass";
    this.rainFilter.frequency.value = 1450;
    this.rainFilter.Q.value = 0.52;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSource.connect(this.rainFilter).connect(this.rainGain).connect(this.master);
    rainSource.start();

    const rainAir = ctx.createBufferSource();
    rainAir.buffer = rainBuffer;
    rainAir.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "highpass";
    airFilter.frequency.value = 4200;
    this.rainAirGain = ctx.createGain();
    this.rainAirGain.gain.value = 0;
    rainAir.connect(airFilter).connect(this.rainAirGain).connect(this.master);
    rainAir.start();

    const waterSource = ctx.createBufferSource();
    waterSource.buffer = waterBuffer;
    waterSource.loop = true;
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = "lowpass";
    this.waterFilter.frequency.value = 220;
    this.waterFilter.Q.value = 0.9;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    const waterPan = ctx.createStereoPanner();
    waterPan.pan.value = -0.2;
    waterSource.connect(this.waterFilter).connect(this.waterGain).connect(waterPan).connect(this.master);
    waterSource.start();

    const rumble = ctx.createOscillator();
    rumble.type = "sine";
    rumble.frequency.value = 43;
    const rumbleOvertone = ctx.createOscillator();
    rumbleOvertone.type = "triangle";
    rumbleOvertone.frequency.value = 64;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(this.rumbleGain);
    rumbleOvertone.connect(this.rumbleGain);
    this.rumbleGain.connect(this.master);
    rumble.start();
    rumbleOvertone.start();
  }

  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      await this.ensure();
      if (this.master) {
        this.master.gain.setTargetAtTime(this.playing ? 0.58 : 0.2, this.context.currentTime, 0.1);
      }
    } else if (this.master && this.context) {
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.05);
    }
    return this.enabled;
  }

  update(rain, pressure, paused = false, now = performance.now()) {
    if (!this.context || !this.rainGain || !this.waterGain) return;
    if (now - this.lastUpdate < 80) return;
    this.lastUpdate = now;
    const t = this.context.currentTime;
    const level = paused ? 0.035 : 0.2 + rain * 0.15;
    this.master.gain.setTargetAtTime(this.enabled ? level : 0, t, 0.12);
    this.rainGain.gain.setTargetAtTime(paused ? 0.015 : 0.09 + rain * 0.33, t, 0.18);
    this.rainAirGain.gain.setTargetAtTime(paused ? 0.002 : rain * 0.035, t, 0.2);
    this.rainFilter.frequency.setTargetAtTime(760 + rain * 2100, t, 0.22);
    const pressureValue = Math.max(0, Math.min(1, pressure));
    this.waterGain.gain.setTargetAtTime(0.015 + pressureValue * 0.23, t, 0.16);
    this.waterFilter.frequency.setTargetAtTime(105 + pressureValue * 310, t, 0.18);
    this.rumbleGain.gain.setTargetAtTime(0.006 + pressureValue * 0.055, t, 0.2);
  }

  async start() {
    this.playing = true;
    const ready = await this.ensure();
    if (ready && this.master) {
      this.master.gain.setTargetAtTime(0.2, this.context.currentTime, 0.3);
    }
    return ready;
  }

  tone(frequency, duration = 0.12, volume = 0.08, type = "sine") {
    if (!this.enabled || !this.context || this.context.state !== "running") return;
    const t = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(t);
    oscillator.stop(t + duration);
  }

  gate(open) {
    this.tone(open ? 440 : 250, 0.17, 0.06, "triangle");
    window.setTimeout(() => this.tone(open ? 620 : 190, 0.12, 0.04, "sine"), 90);
  }

  bag() {
    this.tone(95, 0.1, 0.055, "triangle");
  }

  outcome(success) {
    if (!this.enabled) return;
    const notes = success ? [392, 523, 659] : [220, 185, 147];
    notes.forEach((note, index) => {
      window.setTimeout(() => this.tone(note, 0.32, 0.045, "sine"), index * 170);
    });
  }
}
