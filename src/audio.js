const BEAT_INTERVAL = 0.5;
const TOTAL_BEATS = 24;

export class BeatEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.exportDestination = null;
    this.previewNodes = new Set();
    this.previewTimer = null;
    this.enabled = true;
    this.previewing = false;
  }

  async ensure() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return this.context;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");

    this.context = new AudioContextClass({ latencyHint: "interactive" });
    this.master = this.context.createGain();
    this.master.gain.value = 0.56;

    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -22;
    this.compressor.knee.value = 20;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.008;
    this.compressor.release.value = 0.22;

    this.master.connect(this.compressor);
    this.compressor.connect(this.context.destination);

    this.exportDestination = this.context.createMediaStreamDestination();
    this.exportDestination.channelCount = 2;
    this.compressor.connect(this.exportDestination);

    return this.context;
  }

  trackPreviewNode(node) {
    this.previewNodes.add(node);
    node.onended = () => this.previewNodes.delete(node);
  }

  playKick(when, accent = false, outputScale = 1) {
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const body = ctx.createGain();
    const click = ctx.createOscillator();
    const clickGain = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(accent ? 142 : 118, when);
    oscillator.frequency.exponentialRampToValueAtTime(
      accent ? 43 : 49,
      when + (accent ? 0.19 : 0.14),
    );
    body.gain.setValueAtTime(0.0001, when);
    body.gain.exponentialRampToValueAtTime(
      (accent ? 0.95 : 0.62) * outputScale,
      when + 0.007,
    );
    body.gain.exponentialRampToValueAtTime(0.0001, when + 0.36);

    click.type = "triangle";
    click.frequency.setValueAtTime(880, when);
    click.frequency.exponentialRampToValueAtTime(240, when + 0.032);
    clickGain.gain.setValueAtTime(0.18 * outputScale, when);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.042);

    oscillator.connect(body);
    body.connect(this.master);
    click.connect(clickGain);
    clickGain.connect(this.master);

    oscillator.start(when);
    oscillator.stop(when + 0.42);
    click.start(when);
    click.stop(when + 0.055);

    if (this.previewing) {
      this.trackPreviewNode(oscillator);
      this.trackPreviewNode(click);
    }
  }

  playSubBoom(when, duration = 0.8, outputScale = 1) {
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(66, when);
    oscillator.frequency.exponentialRampToValueAtTime(37, when + duration);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(150, when);
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.38 * outputScale, when + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.03);

    if (this.previewing) this.trackPreviewNode(oscillator);
  }

  playTick(when, accent, outputScale = 1) {
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(accent ? 1640 : 1190, when);
    gain.gain.setValueAtTime(0.012 * outputScale, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.028);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + 0.035);
    if (this.previewing) this.trackPreviewNode(oscillator);
  }

  scheduleBeat(when, beatIndex, outputScale = 1) {
    const accent = beatIndex % 4 === 0;
    this.playKick(when, accent, outputScale);
    this.playTick(when, accent, outputScale);
    if (beatIndex === 0 || beatIndex === 6 || beatIndex === 12 || beatIndex === 18) {
      this.playSubBoom(when, 0.94, outputScale);
    }
  }

  startPreviewCycle(cycleStart, fromTime = 0) {
    const lastBeat = Math.ceil((12 - fromTime) / BEAT_INTERVAL);
    for (let beatIndex = 0; beatIndex < lastBeat; beatIndex += 1) {
      const timelineTime = beatIndex * BEAT_INTERVAL;
      if (timelineTime < fromTime - 0.0001) continue;
      const delay = timelineTime - fromTime;
      this.scheduleBeat(cycleStart + delay, beatIndex);
    }
    return 12 - fromTime;
  }

  startPreview(time = 0) {
    this.stopPreview();
    if (!this.enabled) return;
    this.previewing = true;
    const ctx = this.context;
    const startAt = ctx.currentTime + 0.045;
    let nextCycleAt = startAt + this.startPreviewCycle(startAt, time);
    this.previewTimer = window.setInterval(() => {
      if (ctx.currentTime > nextCycleAt - 0.34) {
        this.startPreviewCycle(nextCycleAt, 0);
        nextCycleAt += 12;
      }
    }, 100);
    return startAt;
  }

  stopPreview() {
    this.previewing = false;
    if (this.previewTimer) {
      window.clearInterval(this.previewTimer);
      this.previewTimer = null;
    }
    this.previewNodes.forEach((node) => {
      try {
        node.stop(0);
      } catch {
        // Already stopped by its scheduled end time.
      }
    });
    this.previewNodes.clear();
  }

  scheduleExport(startAt, outputScale = 1) {
    this.stopPreview();
    this.previewing = false;
    for (let beatIndex = 0; beatIndex < TOTAL_BEATS; beatIndex += 1) {
      this.scheduleBeat(startAt + beatIndex * BEAT_INTERVAL, beatIndex, outputScale);
    }
  }

  getStream() {
    return this.exportDestination.stream;
  }

  setEnabled(value) {
    this.enabled = value;
    if (!value) this.stopPreview();
  }
}

export function drawWaveform(container, count = 34) {
  container.replaceChildren();
  for (let index = 0; index < count; index += 1) {
    const bar = document.createElement("span");
    const env = 0.28 + Math.abs(Math.sin(index * 0.71)) * 0.58;
    const accent = index % 6 === 0 ? 0.24 : 0;
    bar.style.height = `${Math.round((env + accent) * 100)}%`;
    bar.style.setProperty("--i", String(index % 12));
    container.append(bar);
  }
}
