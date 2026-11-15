(function (root) {
  "use strict";

  class ShipAudio {
    constructor() {
      this.context = null;
      this.master = null;
      this.enabled = false;
      this.noiseBuffer = null;
    }

    async setEnabled(enabled) {
      if (enabled) await this.ensureContext();
      this.enabled = Boolean(enabled);
      if (this.master && this.context) {
        this.master.gain.setTargetAtTime(
          this.enabled ? 0.24 : 0,
          this.context.currentTime,
          0.03,
        );
      }
      return this.enabled;
    }

    async ensureContext() {
      if (!this.context) {
        const AudioCtor = root.AudioContext || root.webkitAudioContext;
        if (!AudioCtor) return null;
        this.context = new AudioCtor();
        this.master = this.context.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.context.destination);
        this.noiseBuffer = this.createNoiseBuffer(1.4);
      }
      if (this.context.state === "suspended") await this.context.resume();
      return this.context;
    }

    createNoiseBuffer(seconds) {
      const length = Math.floor(this.context.sampleRate * seconds);
      const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let index = 0; index < length; index += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.82 + white * 0.18;
        data[index] = last;
      }
      return buffer;
    }

    valve(duration = 0.8, pressure = 1) {
      if (!this.enabled || !this.context) return;
      const now = this.context.currentTime;
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      source.buffer = this.noiseBuffer;
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(820 + pressure * 420, now);
      filter.frequency.exponentialRampToValueAtTime(210, now + duration);
      filter.Q.value = 2.2;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.32, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(now);
      source.stop(now + duration + 0.04);

      const tone = this.context.createOscillator();
      const toneGain = this.context.createGain();
      tone.type = "sine";
      tone.frequency.setValueAtTime(420, now);
      tone.frequency.exponentialRampToValueAtTime(130, now + duration);
      toneGain.gain.setValueAtTime(0.0001, now);
      toneGain.gain.exponentialRampToValueAtTime(0.055, now + 0.04);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.9);
      tone.connect(toneGain).connect(this.master);
      tone.start(now);
      tone.stop(now + duration);
    }

    motor(duration = 1, intensity = 1) {
      if (!this.enabled || !this.context) return;
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const high = this.context.createOscillator();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      const tremolo = this.context.createOscillator();
      const tremoloGain = this.context.createGain();
      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(54 + intensity * 9, now);
      oscillator.frequency.linearRampToValueAtTime(68 + intensity * 13, now + duration);
      high.type = "square";
      high.frequency.value = 112 + intensity * 18;
      filter.type = "lowpass";
      filter.frequency.value = 260;
      filter.Q.value = 5;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.08);
      gain.gain.setValueAtTime(0.12, now + Math.max(0.1, duration - 0.18));
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      tremolo.type = "sine";
      tremolo.frequency.value = 8.4;
      tremoloGain.gain.value = 0.025;
      tremolo.connect(tremoloGain).connect(gain.gain);
      oscillator.connect(filter);
      high.connect(filter);
      filter.connect(gain).connect(this.master);
      oscillator.start(now);
      high.start(now);
      tremolo.start(now);
      oscillator.stop(now + duration);
      high.stop(now + duration);
      tremolo.stop(now + duration);
    }

    hatch() {
      if (!this.enabled || !this.context) return;
      const now = this.context.currentTime;
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      source.buffer = this.noiseBuffer;
      filter.type = "highpass";
      filter.frequency.value = 950;
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(now);
      source.stop(now + 0.15);
    }

    complete() {
      if (!this.enabled || !this.context) return;
      const now = this.context.currentTime;
      [392, 523.25, 659.25].forEach((frequency, index) => {
        const tone = this.context.createOscillator();
        const gain = this.context.createGain();
        tone.type = "sine";
        tone.frequency.value = frequency;
        const start = now + index * 0.13;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.075, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
        tone.connect(gain).connect(this.master);
        tone.start(start);
        tone.stop(start + 0.52);
      });
    }
  }

  root.ShipAudio = ShipAudio;
})(typeof globalThis !== "undefined" ? globalThis : this);
