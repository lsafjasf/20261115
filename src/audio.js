const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function makeNoiseBuffer(context, seconds = 2) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = last * 0.78 + white * 0.22;
    data[i] = last;
  }
  return buffer;
}

export class GlassAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.enabled = true;
    this.nodes = null;
    this.lastBubbleCount = 0;
  }

  async start() {
    if (!this.context) this.build();
    if (this.context.state === "suspended") await this.context.resume();
    this.master.gain.setTargetAtTime(this.enabled ? 0.64 : 0, this.context.currentTime, 0.1);
  }

  build() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.connect(context.destination);

    const noise = makeNoiseBuffer(context);
    const furnaceNoise = context.createBufferSource();
    furnaceNoise.buffer = noise;
    furnaceNoise.loop = true;
    const furnaceFilter = context.createBiquadFilter();
    furnaceFilter.type = "lowpass";
    furnaceFilter.frequency.value = 145;
    furnaceFilter.Q.value = 0.8;
    const furnaceGain = context.createGain();
    furnaceGain.gain.value = 0.07;
    furnaceNoise.connect(furnaceFilter).connect(furnaceGain).connect(this.master);

    const furnaceTone = context.createOscillator();
    furnaceTone.type = "sawtooth";
    furnaceTone.frequency.value = 48;
    const furnaceToneFilter = context.createBiquadFilter();
    furnaceToneFilter.type = "lowpass";
    furnaceToneFilter.frequency.value = 110;
    const furnaceToneGain = context.createGain();
    furnaceToneGain.gain.value = 0.022;
    furnaceTone.connect(furnaceToneFilter).connect(furnaceToneGain).connect(furnaceGain);

    const blowNoise = context.createBufferSource();
    blowNoise.buffer = noise;
    blowNoise.loop = true;
    const blowFilter = context.createBiquadFilter();
    blowFilter.type = "bandpass";
    blowFilter.frequency.value = 620;
    blowFilter.Q.value = 0.72;
    const blowGain = context.createGain();
    blowGain.gain.value = 0;
    blowNoise.connect(blowFilter).connect(blowGain).connect(this.master);

    const spinTone = context.createOscillator();
    spinTone.type = "triangle";
    spinTone.frequency.value = 42;
    const spinFilter = context.createBiquadFilter();
    spinFilter.type = "lowpass";
    spinFilter.frequency.value = 280;
    const spinGain = context.createGain();
    spinGain.gain.value = 0;
    spinTone.connect(spinFilter).connect(spinGain).connect(this.master);

    const spinWobble = context.createOscillator();
    spinWobble.type = "sine";
    spinWobble.frequency.value = 7;
    const wobbleGain = context.createGain();
    wobbleGain.gain.value = 2.4;
    spinWobble.connect(wobbleGain).connect(spinTone.frequency);

    const shimmer = context.createOscillator();
    shimmer.type = "sine";
    shimmer.frequency.value = 880;
    const shimmerGain = context.createGain();
    shimmerGain.gain.value = 0;
    shimmer.connect(shimmerGain).connect(this.master);

    furnaceNoise.start();
    furnaceTone.start();
    blowNoise.start();
    spinTone.start();
    spinWobble.start();
    shimmer.start();

    this.nodes = {
      furnaceFilter,
      furnaceGain,
      furnaceTone,
      blowFilter,
      blowGain,
      spinTone,
      spinGain,
      shimmer,
      shimmerGain,
    };
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!this.context) return;
    if (enabled) this.context.resume();
    this.master.gain.setTargetAtTime(enabled ? 0.64 : 0, this.context.currentTime, 0.08);
  }

  update(sim) {
    if (!this.context || !this.nodes) return;
    const now = this.context.currentTime;
    const temperature = clamp((sim.temperature - 360) / 680, 0, 1);
    const alignment = sim.heaterAlignment;
    const pressure = clamp(sim.pressure, 0, 1.2);
    const rotation = clamp(sim.rpm / 64, 0, 1);

    this.nodes.furnaceGain.gain.setTargetAtTime(
      0.028 + alignment * 0.11 + temperature * 0.022,
      now,
      0.18,
    );
    this.nodes.furnaceFilter.frequency.setTargetAtTime(105 + alignment * 95, now, 0.22);
    this.nodes.furnaceTone.frequency.setTargetAtTime(42 + temperature * 13, now, 0.28);

    const blowLevel = pressure > 0.11 ? pressure * 0.11 : 0;
    this.nodes.blowGain.gain.setTargetAtTime(blowLevel, now, 0.035);
    this.nodes.blowFilter.frequency.setTargetAtTime(460 + pressure * 630, now, 0.06);

    this.nodes.spinGain.gain.setTargetAtTime(sim.rpm > 2 ? 0.008 + rotation * 0.017 : 0, now, 0.12);
    this.nodes.spinTone.frequency.setTargetAtTime(34 + sim.rpm * 1.65, now, 0.08);

    const shimmerLevel = clamp((sim.temperature - 650) / 420, 0, 1) * 0.005;
    this.nodes.shimmerGain.gain.setTargetAtTime(shimmerLevel, now, 0.22);
    this.nodes.shimmer.frequency.setTargetAtTime(680 + temperature * 520, now, 0.35);

    if (sim.bubbles.length > this.lastBubbleCount) this.bubble();
    this.lastBubbleCount = sim.bubbles.length;
  }

  bubble() {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(520, now);
    oscillator.frequency.exponentialRampToValueAtTime(170, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.18);
  }

  playFailure() {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(220, now);
    oscillator.frequency.exponentialRampToValueAtTime(58, now + 1.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 1.35);

    const noise = this.context.createBufferSource();
    noise.buffer = makeNoiseBuffer(this.context, 0.5);
    const filter = this.context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1500;
    const noiseGain = this.context.createGain();
    noiseGain.gain.setValueAtTime(0.07, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    noise.connect(filter).connect(noiseGain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.45);
  }

  playSuccess() {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    [392, 523.25, 659.25].forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const start = now + index * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.2);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + 1.25);
    });
  }
}
