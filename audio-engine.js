import { DEFAULT_SETTINGS, SCENE_DURATION_MS, TRACKS } from "./scene-config.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class SceneAudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.nodes = new Map();
    this.voices = [];
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.isPlaying = false;
    this.positionSeconds = 0;
    this.startPosition = 0;
    this.startContextTime = 0;
    this.schedule = [];
    this.plan = TRACKS.map((track) => this.createPlan(track));
  }

  createPlan(track) {
    const offsetMs = track.baseOffsetMs + this.settings.delaysMs[track.id];
    const interval = track.intervalMs / 1000;
    const duration = track.durationMs / 1000;
    const offset = offsetMs / 1000;
    const eventTimes = [];
    for (let local = 0; local < duration; local += interval) {
      eventTimes.push(offset + local);
    }
    return {
      id: track.id,
      actualOffsetMs: offsetMs,
      firstEventMs: Math.round(eventTimes[0] * 1000),
      lastEventMs: Math.round(eventTimes.at(-1) * 1000),
      eventTimesMs: eventTimes.map((time) => Math.round(time * 1000))
    };
  }

  rebuildPlan() {
    this.plan = TRACKS.map((track) => this.createPlan(track));
    return this.plan;
  }

  async ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = this.settings.masterVolume;
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 18;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.012;
      compressor.release.value = 0.2;
      this.master.connect(compressor);
      compressor.connect(this.context.destination);

      TRACKS.forEach((track, index) => {
        const bus = this.context.createGain();
        const analyser = this.context.createAnalyser();
        const mute = this.context.createGain();
        const panner = this.context.createStereoPanner();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.28;
        bus.gain.value = 0.9;
        mute.gain.value = this.settings.muted[track.id] ? 0 : 1;
        panner.pan.value = [-0.25, 0.34, -0.14, 0.16][index];
        bus.connect(analyser);
        analyser.connect(mute);
        mute.connect(panner);
        panner.connect(this.master);
        this.nodes.set(track.id, {
          bus,
          analyser,
          mute,
          panner,
          meterBuffer: new Float32Array(analyser.fftSize),
          level: 0
        });
      });
    }

    if (this.context.state !== "running") {
      await this.context.resume();
    }
    return this.context;
  }

  updateSettings(settings) {
    this.settings = structuredClone(settings);
    this.rebuildPlan();
    if (this.master) {
      this.master.gain.setTargetAtTime(this.settings.masterVolume, this.context.currentTime, 0.03);
    }
    TRACKS.forEach((track) => this.setTrackMute(track.id, this.settings.muted[track.id]));
  }

  setMasterVolume(value) {
    this.settings.masterVolume = clamp(value, 0, 1);
    if (this.master) {
      this.master.gain.setTargetAtTime(this.settings.masterVolume, this.context.currentTime, 0.02);
    }
  }

  setTrackMute(id, muted) {
    this.settings.muted[id] = Boolean(muted);
    const nodes = this.nodes.get(id);
    if (!nodes) return;
    nodes.mute.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.018);
  }

  getPosition() {
    if (!this.isPlaying || !this.context) return this.positionSeconds;
    if (this.context.state !== "running") return this.startPosition;
    const elapsed = Math.max(0, this.context.currentTime - this.startContextTime);
    return clamp(this.startPosition + elapsed, 0, SCENE_DURATION_MS / 1000);
  }

  async play(fromSeconds = this.positionSeconds) {
    await this.ensureContext();
    this.stopVoices();
    this.rebuildPlan();
    const from = clamp(fromSeconds, 0, SCENE_DURATION_MS / 1000);
    this.positionSeconds = from;
    this.startPosition = from;
    this.startContextTime = this.context.currentTime;
    this.isPlaying = true;
    this.schedule = [];
    TRACKS.forEach((track) => this.scheduleTrack(track, from));
    return true;
  }

  pause() {
    if (this.isPlaying) this.positionSeconds = this.getPosition();
    this.isPlaying = false;
    this.stopVoices();
  }

  seek(positionSeconds) {
    const position = clamp(positionSeconds, 0, SCENE_DURATION_MS / 1000);
    const wasPlaying = this.isPlaying;
    this.stopVoices();
    this.positionSeconds = position;
    this.isPlaying = false;
    if (wasPlaying) return this.play(position);
    this.rebuildPlan();
    return Promise.resolve(false);
  }

  scheduleTrack(track, fromSeconds) {
    const plan = this.plan.find((item) => item.id === track.id);
    const nodes = this.nodes.get(track.id);
    if (!nodes) return;
    plan.eventTimesMs.forEach((eventMs, index) => {
      const eventSeconds = eventMs / 1000;
      if (eventSeconds < fromSeconds) return;
      const startAt = this.startContextTime + (eventSeconds - fromSeconds);
      if (track.id === "ember") this.scheduleEmber(nodes, startAt, index);
      if (track.id === "air") this.scheduleAir(nodes, startAt, index);
      if (track.id === "tide") this.scheduleTide(nodes, startAt, index);
      if (track.id === "prism") this.schedulePrism(nodes, startAt, index);
      this.schedule.push({
        trackId: track.id,
        sceneTimeMs: eventMs,
        contextTime: startAt
      });
    });
  }

  remember(nodes, oscillators) {
    oscillators.forEach((oscillator) => {
      const voice = { oscillator, trackId: null };
      this.voices.push(voice);
      oscillator.addEventListener("ended", () => {
        const index = this.voices.indexOf(voice);
        if (index >= 0) this.voices.splice(index, 1);
      }, { once: true });
    });
  }

  stopVoices() {
    this.voices.forEach(({ oscillator }) => {
      try {
        oscillator.stop();
      } catch {
        // A voice may already have ended.
      }
    });
    this.voices = [];
  }

  scheduleEmber(nodes, startAt, index) {
    const context = this.context;
    const frequencies = [74, 69, 62, 74, 69, 62, 74, 69];
    const frequency = frequencies[index % frequencies.length];
    const oscillator = context.createOscillator();
    const overtone = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = "sine";
    overtone.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.76, startAt + 0.38);
    overtone.frequency.setValueAtTime(frequency * 2.03, startAt);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(240, startAt);
    filter.frequency.exponentialRampToValueAtTime(115, startAt + 0.32);
    filter.Q.value = 1.1;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(0.3, startAt + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.46);
    const overtoneGain = context.createGain();
    overtoneGain.gain.setValueAtTime(0.0001, startAt);
    overtoneGain.gain.linearRampToValueAtTime(0.052, startAt + 0.012);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.18);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(nodes.bus);
    overtone.connect(overtoneGain);
    overtoneGain.connect(nodes.bus);
    oscillator.start(startAt);
    overtone.start(startAt);
    oscillator.stop(startAt + 0.5);
    overtone.stop(startAt + 0.22);
    this.remember(nodes, [oscillator, overtone]);
  }

  scheduleAir(nodes, startAt, index) {
    const context = this.context;
    const frequencies = [784, 1046.5, 880, 1318.5, 987.8, 1174.7, 698.5];
    const frequency = frequencies[index % frequencies.length];
    const oscillator = context.createOscillator();
    const shimmer = context.createOscillator();
    const gain = context.createGain();
    const shimmerGain = context.createGain();
    const panner = context.createStereoPanner();
    oscillator.type = "sine";
    shimmer.type = "sine";
    oscillator.frequency.setValueAtTime(frequency * 1.012, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(frequency, startAt + 0.12);
    shimmer.frequency.setValueAtTime(frequency * 2.004, startAt);
    panner.pan.value = Math.sin(index * 1.63 + 0.4) * 0.5;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(0.12, startAt + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.52);
    shimmerGain.gain.setValueAtTime(0.0001, startAt);
    shimmerGain.gain.linearRampToValueAtTime(0.026, startAt + 0.006);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.26);
    oscillator.connect(gain);
    shimmer.connect(shimmerGain);
    gain.connect(panner);
    shimmerGain.connect(panner);
    panner.connect(nodes.bus);
    oscillator.start(startAt);
    shimmer.start(startAt);
    oscillator.stop(startAt + 0.58);
    shimmer.stop(startAt + 0.3);
    this.remember(nodes, [oscillator, shimmer]);
  }

  scheduleTide(nodes, startAt, index) {
    const context = this.context;
    const roots = [110, 98, 123.47, 87.31, 110, 98];
    const root = roots[index % roots.length];
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    const oscillators = [];
    filter.type = "lowpass";
    filter.Q.value = 1.6;
    filter.frequency.setValueAtTime(290, startAt);
    filter.frequency.exponentialRampToValueAtTime(760, startAt + 0.22);
    filter.frequency.exponentialRampToValueAtTime(220, startAt + 0.8);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.linearRampToValueAtTime(0.145, startAt + 0.18);
    envelope.gain.setValueAtTime(0.145, startAt + 0.43);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.88);
    [1, 1.5, 2.01].forEach((ratio, voiceIndex) => {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(root * ratio, startAt);
      oscillator.frequency.linearRampToValueAtTime(root * ratio * 0.992, startAt + 0.8);
      voiceGain.gain.value = [0.44, 0.3, 0.16][voiceIndex];
      oscillator.connect(voiceGain);
      voiceGain.connect(filter);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.92);
      oscillators.push(oscillator);
    });
    filter.connect(envelope);
    envelope.connect(nodes.bus);
    this.remember(nodes, oscillators);
  }

  schedulePrism(nodes, startAt, index) {
    const context = this.context;
    const frequencies = [523.25, 659.25, 783.99, 1046.5, 880, 698.46];
    const frequency = frequencies[index % frequencies.length];
    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modulation = context.createGain();
    const overtone = context.createOscillator();
    const envelope = context.createGain();
    const overtoneGain = context.createGain();
    carrier.type = "sine";
    modulator.type = "sine";
    overtone.type = "sine";
    carrier.frequency.value = frequency;
    modulator.frequency.value = frequency * 2.014;
    modulation.gain.setValueAtTime(frequency * 2.25, startAt);
    modulation.gain.exponentialRampToValueAtTime(frequency * 0.12, startAt + 0.54);
    modulator.connect(modulation);
    modulation.connect(carrier.frequency);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.linearRampToValueAtTime(0.16, startAt + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.82);
    overtone.frequency.value = frequency * 2.005;
    overtoneGain.gain.setValueAtTime(0.0001, startAt);
    overtoneGain.gain.linearRampToValueAtTime(0.04, startAt + 0.004);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.42);
    carrier.connect(envelope);
    envelope.connect(nodes.bus);
    overtone.connect(overtoneGain);
    overtoneGain.connect(nodes.bus);
    [carrier, modulator, overtone].forEach((oscillator) => oscillator.start(startAt));
    carrier.stop(startAt + 0.88);
    modulator.stop(startAt + 0.88);
    overtone.stop(startAt + 0.46);
    this.remember(nodes, [carrier, modulator, overtone]);
  }

  getLevels() {
    const levels = {};
    TRACKS.forEach((track) => {
      const nodes = this.nodes.get(track.id);
      if (!nodes || !this.isPlaying) {
        levels[track.id] = { level: 0, db: -Infinity };
        if (nodes) nodes.level *= 0.82;
        return;
      }
      nodes.analyser.getFloatTimeDomainData(nodes.meterBuffer);
      let peak = 0;
      for (const sample of nodes.meterBuffer) peak = Math.max(peak, Math.abs(sample));
      const db = peak > 0.00001 ? 20 * Math.log10(peak) : -Infinity;
      const normalized = clamp((db + 54) / 48, 0, 1);
      nodes.level = nodes.level * 0.55 + normalized * 0.45;
      levels[track.id] = { level: nodes.level, db };
    });
    return levels;
  }

  getPlanSnapshot() {
    return this.rebuildPlan().map((item) => ({
      ...item,
      eventTimesMs: [...item.eventTimesMs]
    }));
  }
}
