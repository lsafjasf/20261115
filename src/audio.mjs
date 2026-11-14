function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class StormAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.noiseGain = null;
    this.noiseFilter = null;
    this.rumbleGain = null;
    this.pumpGain = null;
    this.ready = false;
    this.pumpValue = 0;
  }

  async start() {
    if (this.ready) {
      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      return true;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return false;
    }

    this.context = new AudioContextClass();
    await this.context.resume();
    this.master = this.context.createGain();
    this.master.gain.value = 0.34;
    this.master.connect(this.context.destination);

    const noiseBuffer = this.context.createBuffer(
      1,
      this.context.sampleRate * 2,
      this.context.sampleRate,
    );
    const channel = noiseBuffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < channel.length; index += 1) {
      brown = (brown + Math.random() * 2 - 1) * 0.72;
      channel[index] = clamp(brown, -1, 1);
    }

    this.noiseFilter = this.context.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.frequency.value = 460;
    this.noiseFilter.Q.value = 0.52;
    this.noiseGain = this.context.createGain();
    this.noiseGain.gain.value = 0.04;
    const noise = this.context.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    noise.start();

    const rumble = this.context.createOscillator();
    rumble.type = "sine";
    rumble.frequency.value = 43;
    this.rumbleGain = this.context.createGain();
    this.rumbleGain.gain.value = 0.025;
    rumble.connect(this.rumbleGain).connect(this.master);
    rumble.start();

    const pump = this.context.createOscillator();
    pump.type = "triangle";
    pump.frequency.value = 168;
    this.pumpGain = this.context.createGain();
    this.pumpGain.gain.value = 0;
    pump.connect(this.pumpGain).connect(this.master);
    pump.start();

    this.ready = true;
    return true;
  }

  update({ storm = 0.4, pumpFlow = 0, pumpOn = false, status = "ready" } = {}) {
    if (!this.ready) {
      return;
    }
    const now = this.context.currentTime;
    const active = status === "running" || status === "won" || status === "lost";
    const targetNoise = active ? 0.028 + storm * 0.14 : 0.014;
    const targetRumble = active ? 0.018 + storm * 0.07 : 0.012;
    this.noiseGain.gain.setTargetAtTime(targetNoise, now, 0.35);
    this.noiseFilter.frequency.setTargetAtTime(300 + storm * 1180, now, 0.45);
    this.rumbleGain.gain.setTargetAtTime(targetRumble, now, 0.4);
    this.pumpValue = pumpOn ? 0.008 + pumpFlow * 0.28 : 0;
    this.pumpGain.gain.setTargetAtTime(this.pumpValue, now, 0.12);
  }

  tone({ frequency, duration, gain = 0.08, type = "sine", slide = 0 }) {
    if (!this.ready) {
      return;
    }
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (slide) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(30, frequency + slide),
        now + duration,
      );
    }
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  burst({ duration = 0.18, gain = 0.08, cutoff = 1800 } = {}) {
    if (!this.ready) {
      return;
    }
    const length = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    envelope.gain.value = gain;
    source.buffer = buffer;
    source.connect(filter).connect(envelope).connect(this.master);
    source.start();
  }

  playEvent(event) {
    if (!this.ready || !event) {
      return;
    }
    switch (event.type) {
      case "gate-start":
        this.burst({ duration: 0.32, gain: 0.1, cutoff: 900 });
        this.tone({ frequency: 118, duration: 0.45, gain: 0.045, type: "sawtooth", slide: -36 });
        break;
      case "gate-closed":
        this.burst({ duration: 0.26, gain: 0.16, cutoff: 520 });
        this.tone({ frequency: 72, duration: 0.7, gain: 0.06, type: "sine", slide: -18 });
        break;
      case "warning":
        [520, 390, 520].forEach((frequency, index) => {
          setTimeout(() => {
            this.tone({ frequency, duration: 0.16, gain: 0.045, type: "square" });
          }, index * 180);
        });
        break;
      case "vehicle-trapped":
        this.burst({ duration: 0.7, gain: 0.17, cutoff: 700 });
        this.tone({ frequency: 190, duration: 0.9, gain: 0.07, type: "sawtooth", slide: -120 });
        break;
      case "won":
        [392, 523, 659].forEach((frequency, index) => {
          setTimeout(() => {
            this.tone({ frequency, duration: 0.7, gain: 0.055, type: "triangle" });
          }, index * 170);
        });
        break;
      case "lost":
        this.tone({ frequency: 96, duration: 1.4, gain: 0.1, type: "sawtooth", slide: -50 });
        break;
      case "battery-empty":
        this.tone({ frequency: 210, duration: 0.35, gain: 0.05, type: "square", slide: -70 });
        break;
      default:
        break;
    }
  }
}
