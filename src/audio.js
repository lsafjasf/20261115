export class SyncAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.sync = 0;
    this.phase = "feed";
    this.nodes = null;
  }

  async start() {
    if (!this.enabled) return;
    if (!this.context) this.build();
    if (this.context?.state === "suspended") {
      try {
        await this.context.resume();
      } catch {
        return;
      }
    }
  }

  build() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const context = new AudioContext();
    const master = context.createGain();
    const filter = context.createBiquadFilter();
    const analyser = context.createAnalyser();

    master.gain.value = 0.75;
    filter.type = "lowpass";
    filter.frequency.value = 540;
    filter.Q.value = 0.7;
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.72;
    filter.connect(master);
    master.connect(analyser);
    analyser.connect(context.destination);

    const fixtureTone = context.createOscillator();
    const fixtureGain = context.createGain();
    fixtureTone.type = "sine";
    fixtureTone.frequency.value = 196;
    fixtureGain.gain.value = 0.024;
    fixtureTone.connect(fixtureGain);
    fixtureGain.connect(filter);

    const torchTone = context.createOscillator();
    const torchGain = context.createGain();
    torchTone.type = "triangle";
    torchTone.frequency.value = 214;
    torchGain.gain.value = 0.018;
    torchTone.connect(torchGain);
    torchGain.connect(filter);

    const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    let seed = 0x2f6e2b1;
    for (let i = 0; i < noiseData.length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noiseData[i] = ((seed / 0xffffffff) * 2 - 1) * 0.42;
    }
    const noise = context.createBufferSource();
    const noiseGain = context.createGain();
    const noiseFilter = context.createBiquadFilter();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    noiseGain.gain.value = 0;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1380;
    noiseFilter.Q.value = 0.52;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);

    fixtureTone.start();
    torchTone.start();
    noise.start();

    this.context = context;
    this.nodes = {
      master,
      filter,
      analyser,
      fixtureTone,
      torchTone,
      torchGain,
      noiseGain,
      noiseFilter
    };
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.nodes) {
      const target = enabled ? 0.75 : 0;
      this.nodes.master.gain.setTargetAtTime(target, this.context.currentTime, 0.08);
    }
  }

  update(sync, phase, vibration = 0) {
    this.sync = sync;
    this.phase = phase;
    if (!this.nodes || !this.context) return;

    const now = this.context.currentTime;
    const welding = phase === "welding" || phase === "complete";
    const beat = (1 - sync) * 21 + vibration * 900;
    const harmonic = 208 + sync * 34;

    this.nodes.fixtureTone.frequency.setTargetAtTime(196 + vibration * 800, now, 0.05);
    this.nodes.torchTone.frequency.setTargetAtTime(harmonic + beat, now, 0.05);
    this.nodes.torchGain.gain.setTargetAtTime(
      welding ? 0.012 : 0.02 + sync * 0.012,
      now,
      0.08
    );
    this.nodes.filter.frequency.setTargetAtTime(
      410 + sync * 780 + (welding ? 480 : 0),
      now,
      0.08
    );
    this.nodes.noiseGain.gain.setTargetAtTime(
      welding ? 0.035 + sync * 0.045 : Math.max(0, sync - 0.88) * 0.012,
      now,
      0.06
    );
    this.nodes.noiseFilter.frequency.setTargetAtTime(
      welding ? 1180 + sync * 540 : 940,
      now,
      0.1
    );
  }

  pulse(kind, detail = {}) {
    if (!this.context || !this.nodes || !this.enabled) return;
    if (kind === "fail") this.playFailure();
    if (kind === "complete") this.playComplete();
    if (kind === "weld-start") this.playIgnition(detail.sync || 0);
    if (kind === "align-start") this.playCue(720, 0.06);
    if (kind === "countdown-start") this.playCue(520, 0.04);
  }

  playCue(frequency, volume) {
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain);
    gain.connect(this.nodes.master);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  }

  playIgnition(sync) {
    const now = this.context.currentTime;
    const buzz = this.context.createOscillator();
    const gain = this.context.createGain();
    buzz.type = "sawtooth";
    buzz.frequency.setValueAtTime(88, now);
    buzz.frequency.exponentialRampToValueAtTime(138 + sync * 20, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    buzz.connect(gain);
    gain.connect(this.nodes.master);
    buzz.start(now);
    buzz.stop(now + 0.28);
  }

  playComplete() {
    const now = this.context.currentTime;
    [0, 0.12, 0.25].forEach((delay, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = [523, 659, 784][index];
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.034, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.3);
      oscillator.connect(gain);
      gain.connect(this.nodes.master);
      oscillator.start(now + delay);
      oscillator.stop(now + delay + 0.32);
    });
  }

  playFailure() {
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(310, now);
    oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.44);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    oscillator.connect(gain);
    gain.connect(this.nodes.master);
    oscillator.start(now);
    oscillator.stop(now + 0.5);
  }

  waveform(points = 64) {
    if (!this.nodes) {
      return Array.from({ length: points }, (_, i) =>
        Math.sin(i * 0.17 + this.sync * 2) *
        (0.18 + this.sync * 0.82) *
        Math.sin(i * 0.028 + this.phase.length)
      );
    }
    const data = new Uint8Array(this.nodes.analyser.frequencyBinCount);
    this.nodes.analyser.getByteTimeDomainData(data);
    return Array.from({ length: points }, (_, i) => {
      const index = Math.floor((i / points) * data.length);
      return (data[index] - 128) / 128;
    });
  }
}
