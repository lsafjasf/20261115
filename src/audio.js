import { clamp } from "./simulation.js";

export class SnowAudio {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.nodes = {};
    this.lastSnapshot = null;
  }

  async enable() {
    if (!this.context) this.createGraph();
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = true;
    this.nodes.master.gain.setTargetAtTime(0.42, this.context.currentTime, 0.08);
    if (this.lastSnapshot) this.update(this.lastSnapshot);
    return this.getState();
  }

  disable() {
    this.enabled = false;
    if (this.context) {
      this.nodes.master.gain.setTargetAtTime(
        0.0001,
        this.context.currentTime,
        0.05,
      );
    }
  }

  createNoiseBuffer(seconds = 2) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.76 + white * 0.24;
      samples[index] = previous;
    }
    return buffer;
  }

  createGraph() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContext();
    const context = this.context;

    const master = context.createGain();
    master.gain.value = 0.0001;
    master.connect(context.destination);

    const pumpGain = context.createGain();
    pumpGain.gain.value = 0.0001;
    const pumpFilter = context.createBiquadFilter();
    pumpFilter.type = "lowpass";
    pumpFilter.frequency.value = 220;
    pumpGain.connect(pumpFilter).connect(master);

    const pumpOscillator = context.createOscillator();
    pumpOscillator.type = "sawtooth";
    pumpOscillator.frequency.value = 46;
    pumpOscillator.connect(pumpGain);
    pumpOscillator.start();

    const pumpHarmonic = context.createOscillator();
    pumpHarmonic.type = "sine";
    pumpHarmonic.frequency.value = 92;
    const harmonicGain = context.createGain();
    harmonicGain.gain.value = 0.22;
    pumpHarmonic.connect(harmonicGain).connect(pumpGain);
    pumpHarmonic.start();

    const airGain = context.createGain();
    airGain.gain.value = 0.0001;
    const airFilter = context.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 980;
    airFilter.Q.value = 0.55;
    airGain.connect(airFilter).connect(master);

    const airSource = context.createBufferSource();
    airSource.buffer = this.createNoiseBuffer();
    airSource.loop = true;
    airSource.connect(airGain);
    airSource.start();

    const sprayGain = context.createGain();
    sprayGain.gain.value = 0.0001;
    const sprayFilter = context.createBiquadFilter();
    sprayFilter.type = "highpass";
    sprayFilter.frequency.value = 1700;
    sprayGain.connect(sprayFilter).connect(master);

    const spraySource = context.createBufferSource();
    spraySource.buffer = this.createNoiseBuffer();
    spraySource.loop = true;
    spraySource.connect(sprayGain);
    spraySource.start();

    const windGain = context.createGain();
    windGain.gain.value = 0.0001;
    const windFilter = context.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 360;
    windGain.connect(windFilter).connect(master);

    const windSource = context.createBufferSource();
    windSource.buffer = this.createNoiseBuffer(3);
    windSource.loop = true;
    windSource.connect(windGain);
    windSource.start();

    this.nodes = {
      master,
      pumpGain,
      pumpFilter,
      pumpOscillator,
      airGain,
      airFilter,
      sprayGain,
      sprayFilter,
      windGain,
      windFilter,
    };
  }

  update(snapshot) {
    this.lastSnapshot = snapshot;
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const { water, air, spraying } = snapshot.controls;
    const { wind } = snapshot.environment;
    const forecast = snapshot.forecast;
    const pumpLevel = water / 100;
    const airLevel = air / 100;

    this.nodes.pumpOscillator.frequency.setTargetAtTime(38 + pumpLevel * 34, now, 0.12);
    this.nodes.pumpFilter.frequency.setTargetAtTime(150 + pumpLevel * 220, now, 0.12);
    this.nodes.pumpGain.gain.setTargetAtTime(0.018 + pumpLevel * 0.065, now, 0.1);
    this.nodes.airFilter.frequency.setTargetAtTime(540 + airLevel * 1700, now, 0.1);
    this.nodes.airGain.gain.setTargetAtTime(0.008 + airLevel * 0.045, now, 0.1);
    this.nodes.windGain.gain.setTargetAtTime(0.008 + (wind / 11.5) * 0.035, now, 0.2);
    this.nodes.windFilter.frequency.setTargetAtTime(
      230 + wind * 28,
      now,
      0.2,
    );
    this.nodes.sprayFilter.frequency.setTargetAtTime(
      1250 + forecast.catchRate * 2200 + pumpLevel * 600,
      now,
      0.08,
    );
    this.nodes.sprayGain.gain.setTargetAtTime(
      spraying ? 0.008 + pumpLevel * 0.035 * (0.4 + forecast.catchRate) : 0.0001,
      now,
      0.06,
    );
  }

  playTone(frequency, offset, duration, volume = 0.055) {
    if (!this.context || !this.enabled) return;
    const start = this.context.currentTime + offset;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.nodes.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  chime() {
    this.playTone(523.25, 0, 0.35);
    this.playTone(783.99, 0.085, 0.42);
    this.playTone(1046.5, 0.17, 0.55, 0.035);
  }

  warmGust() {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const air = this.nodes.airGain.gain;
    const filter = this.nodes.airFilter.frequency;
    air.cancelScheduledValues(now);
    air.setValueAtTime(Math.max(0.025, air.value), now);
    air.linearRampToValueAtTime(0.085, now + 0.7);
    air.linearRampToValueAtTime(0.04, now + 2.6);
    filter.cancelScheduledValues(now);
    filter.setValueAtTime(700, now);
    filter.exponentialRampToValueAtTime(2400, now + 0.8);
    filter.exponentialRampToValueAtTime(620, now + 2.7);
    this.playTone(146.83, 0.1, 1.8, 0.025);
    this.playTone(110, 0.55, 2.2, 0.02);
  }

  getState() {
    return {
      enabled: this.enabled,
      contextState: this.context?.state || "uninitialized",
      sampleRate: this.context?.sampleRate || null,
      levels: this.context
        ? {
            pump: Number(this.nodes.pumpGain.gain.value.toFixed(4)),
            air: Number(this.nodes.airGain.gain.value.toFixed(4)),
            spray: Number(this.nodes.sprayGain.gain.value.toFixed(4)),
            wind: Number(this.nodes.windGain.gain.value.toFixed(4)),
          }
        : null,
      lastWetness: this.lastSnapshot
        ? Number(clamp(this.lastSnapshot.forecast.wetness, 0, 1).toFixed(3))
        : null,
    };
  }
}
