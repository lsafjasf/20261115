const DB_FLOOR = -66;

export class Visualizers {
  constructor(tailCanvas, specCanvas, engineRef, getAcoustics) {
    this.tailCv = tailCanvas;
    this.specCv = specCanvas;
    this.tc = tailCanvas.getContext("2d");
    this.sc = specCanvas.getContext("2d");
    this.engineRef = engineRef;
    this.getAcoustics = getAcoustics;
    this.windowSec = 4.5;
    this.history = []; // {t, db}
    this.measureMark = null; // {t0, rt60}
    this.lastBeat = null;
    requestAnimationFrame(() => this.loop());
  }

  markPulse() {
    const e = this.engineRef();
    this.measureMark = { t0: e.ctx.currentTime, rt60: this.getAcoustics().rt60 };
  }

  loop() {
    const e = this.engineRef();
    const now = e ? e.ctx.currentTime : performance.now() / 1000;
    if (e) {
      const buf = new Float32Array(e.masterAnalyser.fftSize);
      e.masterAnalyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const db = Math.max(DB_FLOOR, 20 * Math.log10(rms + 1e-6));
      this.history.push({ t: now, db });
      const cutoff = now - this.windowSec;
      while (this.history.length && this.history[0].t < cutoff) this.history.shift();
    }
    this.drawTail(now);
    this.drawSpectrum(e);
    requestAnimationFrame(() => this.loop());
  }

  drawTail(now) {
    const c = this.tc, w = this.tailCv.width, h = this.tailCv.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#0b0f15";
    c.fillRect(0, 0, w, h);

    // 网格（每 10 dB / 每 1 秒）
    c.strokeStyle = "#1b2532";
    c.lineWidth = 1;
    c.fillStyle = "#5c6b80";
    c.font = "10px monospace";
    for (let db = 0; db >= DB_FLOOR; db -= 10) {
      const y = h - ((db - DB_FLOOR) / -DB_FLOOR) * h;
      c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
      c.fillText(`${db}dB`, 4, y - 2);
    }
    for (let s = 0; s <= this.windowSec; s += 1) {
      const x = (s / this.windowSec) * w;
      c.fillText(`-${this.windowSec - s}s`, x + 2, h - 4);
    }

    const xOf = (t) => ((t - (now - this.windowSec)) / this.windowSec) * w;
    const yOf = (db) => h - ((Math.max(db, DB_FLOOR) - DB_FLOOR) / -DB_FLOOR) * h;

    // 电平历史
    c.strokeStyle = "#8be0a0";
    c.lineWidth = 1.6;
    c.beginPath();
    this.history.forEach((p, i) => {
      const x = xOf(p.t), y = yOf(p.db);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.stroke();

    // RT60 理论衰减参考线（从脉冲标记处 -6 dB 起，斜率 -60dB/RT60）
    if (this.measureMark) {
      const m = this.measureMark;
      const x0 = xOf(m.t0);
      if (x0 > -20) {
        c.strokeStyle = "#ffce6b";
        c.setLineDash([6, 4]);
        c.beginPath();
        for (let dt = 0; dt <= this.windowSec; dt += 0.05) {
          const db = -6 - (60 * dt) / m.rt60;
          const x = x0 + (dt / this.windowSec) * w;
          const y = yOf(db);
          dt === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = "#ffce6b";
        c.fillText(`理论 RT60=${m.rt60.toFixed(2)}s`, Math.max(6, x0 + 6), 14);
      }
      if (now - m.t0 > this.windowSec) this.measureMark = null;
    }
  }

  drawSpectrum(engine) {
    const c = this.sc, w = this.specCv.width, h = this.specCv.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#0b0f15";
    c.fillRect(0, 0, w, h);
    if (!engine) return;

    const bins = new Uint8Array(engine.wetAnalyser.frequencyBinCount);
    engine.wetAnalyser.getByteFrequencyData(bins);
    const sr = engine.ctx.sampleRate;
    const fMin = 40, fMax = sr / 2;
    const xOf = (f) => Math.log(f / fMin) / Math.log(fMax / fMin) * w;

    c.fillStyle = "#4cc2ff";
    for (let x = 0; x < w; x++) {
      const f = fMin * Math.pow(fMax / fMin, x / w);
      const idx = Math.min(bins.length - 1, Math.round((f / sr) * engine.wetAnalyser.fftSize));
      const v = bins[idx] / 255;
      c.fillRect(x, h - v * h, 1, v * h);
    }
    c.fillStyle = "#5c6b80";
    c.font = "10px monospace";
    [100, 300, 1000, 3000, 10000].forEach((f) => {
      if (f < fMax) c.fillText(`${f >= 1000 ? f / 1000 + "k" : f}Hz`, xOf(f) + 2, h - 5);
    });
  }
}
