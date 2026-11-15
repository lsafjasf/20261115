function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function addSoundscape(context, destination, seed = 1837) {
  const random = seededRandom(seed);
  const bus = context.createGain();
  bus.gain.value = 0.68;
  bus.connect(destination);

  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 520;
  lowpass.Q.value = 0.35;
  lowpass.connect(bus);

  const noiseBuffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  let smooth = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = random() * 2 - 1;
    smooth = smooth * 0.985 + white * 0.015;
    data[i] = smooth * 3.2;
  }
  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  const noiseGain = context.createGain();
  noiseGain.gain.value = 0.022;
  noise.connect(noiseGain).connect(lowpass);
  noise.start(0);

  const voices = [
    { frequency: 110, gain: 0.018, type: "sine", detune: -4 },
    { frequency: 164.81, gain: 0.011, type: "sine", detune: 3 },
    { frequency: 246.94, gain: 0.0055, type: "triangle", detune: -6 },
  ];
  voices.forEach((voice, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = voice.type;
    oscillator.frequency.value = voice.frequency;
    oscillator.detune.value = voice.detune;
    const gain = context.createGain();
    gain.gain.value = voice.gain;
    oscillator.connect(gain).connect(lowpass);

    const breathe = context.createOscillator();
    breathe.frequency.value = 0.045 + index * 0.017;
    const breatheDepth = context.createGain();
    breatheDepth.gain.value = voice.gain * 0.5;
    breathe.connect(breatheDepth).connect(gain.gain);
    breathe.start(0);
    oscillator.start(0);
  });

  const filterLfo = context.createOscillator();
  filterLfo.frequency.value = 0.035;
  const filterDepth = context.createGain();
  filterDepth.gain.value = 130;
  filterLfo.connect(filterDepth).connect(lowpass.frequency);
  filterLfo.start(0);
}

export class AmbientEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.destination = null;
    this.started = false;
    this.muted = false;
  }

  async ensure() {
    if (this.context) return this.context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not supported");

    const context = new AudioContextClass({ latencyHint: "playback" });
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0.0001;
    this.destination = context.createMediaStreamDestination();
    this.master.connect(context.destination);
    this.master.connect(this.destination);
    addSoundscape(context, this.master, 1837);
    this.started = true;
    return context;
  }

  async renderOffline(duration) {
    const sampleRate = 48000;
    const context = new OfflineAudioContext(2, Math.round(duration * sampleRate), sampleRate);
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, 0);
    master.gain.linearRampToValueAtTime(1.25, 0.8);
    master.gain.setValueAtTime(1.25, Math.max(0.8, duration - 0.32));
    master.gain.linearRampToValueAtTime(0.0001, duration);
    master.connect(context.destination);
    addSoundscape(context, master, 1837);
    return context.startRendering();
  }

  async resume() {
    await this.ensure();
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async setPlaying(playing) {
    if (!playing) {
      if (this.context && this.master) {
        this.master.gain.cancelScheduledValues(this.context.currentTime);
        this.master.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.18);
      }
      return;
    }
    await this.resume();
    const target = this.muted ? 0.0001 : 1.2;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.65);
  }

  async prepareExport() {
    await this.resume();
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(1.2, this.context.currentTime, 0.3);
  }

  async finishExport() {
    if (!this.context || !this.master) return;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    const target = this.muted ? 0.0001 : 0.42;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.35);
  }

  async toggleMute() {
    this.muted = !this.muted;
    await this.resume();
    const target = this.muted ? 0.0001 : 1.2;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.08);
    return this.muted;
  }

  getAudioTrack() {
    if (!this.destination) return null;
    return this.destination.stream.getAudioTracks()[0] || null;
  }

  get level() {
    return this.muted ? 0 : 1.2;
  }
}
