import { PRE_ROLL } from "./transitions.js";

export class TransitionAudio {
  constructor() {
    this.context = null;
    this.nodes = [];
    this.runId = 0;
    this.enabled = true;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      this.context = new AudioContextClass();
    }
    if (this.context.state === "suspended") this.context.resume();
    return this.context;
  }

  start({ clock, duration, totalTime, preRoll = PRE_ROLL }) {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (!context) return;

    this.stop();
    const runId = this.runId;
    const now = context.currentTime;
    const master = context.createGain();
    const gainA = context.createGain();
    const gainB = context.createGain();
    const oscA = context.createOscillator();
    const oscB = context.createOscillator();
    const shimmer = context.createOscillator();
    const shimmerGain = context.createGain();

    oscA.type = "triangle";
    oscA.frequency.value = 174.6;
    oscB.type = "sine";
    oscB.frequency.value = 261.6;
    shimmer.type = "sine";
    shimmer.frequency.value = 523.2;
    shimmer.detune.value = 7;

    gainA.gain.value = 0;
    gainB.gain.value = 0;
    shimmerGain.gain.value = 0.12;
    master.gain.value = 0.032;

    oscA.connect(gainA).connect(master);
    oscB.connect(gainB).connect(master);
    shimmer.connect(shimmerGain).connect(gainB);
    master.connect(context.destination);

    const end = preRoll + duration;
    const phase = Math.max(0, Math.min(1, (clock - preRoll) / duration));
    const initialA = clock >= end ? 0 : clock >= preRoll ? 1 - phase : 1;
    const initialB = clock >= end ? 1 : clock >= preRoll ? phase : 0;
    gainA.gain.setValueAtTime(initialA, now);
    gainB.gain.setValueAtTime(initialB, now);

    if (clock < preRoll) {
      const startAt = now + (preRoll - clock);
      gainA.gain.setValueAtTime(1, startAt);
      gainB.gain.setValueAtTime(0, startAt);
      gainA.gain.linearRampToValueAtTime(0, startAt + duration);
      gainB.gain.linearRampToValueAtTime(1, startAt + duration);
    } else if (clock < end) {
      gainA.gain.linearRampToValueAtTime(0, now + (end - clock));
      gainB.gain.linearRampToValueAtTime(1, now + (end - clock));
    }

    const fadeStart = Math.max(0, totalTime - clock - 0.7);
    if (fadeStart > 0) {
      gainA.gain.setValueAtTime(0, now + fadeStart);
      gainB.gain.setValueAtTime(1, now + fadeStart);
      gainB.gain.linearRampToValueAtTime(0, now + fadeStart + 0.65);
    }
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(0.032, now + 0.25);

    this.nodes = [master, gainA, gainB, oscA, oscB, shimmer, shimmerGain];
    oscA.start(now);
    oscB.start(now);
    shimmer.start(now);

    const stopAt = Math.max(0.05, totalTime - clock + 0.1);
    const timeout = window.setTimeout(() => {
      if (runId !== this.runId) return;
      this.stop();
    }, stopAt * 1000);
    this.nodes.push({ timeout });
  }

  stop() {
    this.runId += 1;
    const nodes = this.nodes;
    this.nodes = [];
    if (!nodes.length) return;

    for (const node of nodes) {
      if (node && node.timeout) window.clearTimeout(node.timeout);
    }
    const context = this.context;
    if (!context) return;
    for (const node of nodes) {
      if (!node || !(node instanceof AudioNode)) continue;
      try {
        node.disconnect();
      } catch {
        // Node may already be detached.
      }
    }
  }
}
