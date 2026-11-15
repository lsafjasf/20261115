import { LEFT_TINES, RIGHT_TINES } from "./notes.js";
import { BARS, TOTAL_STEPS } from "./constants.js";

const GOLD = "#d8b36a";
const GOLD_LIGHT = "#f3d9a0";
const TEAL = "#7fc7b8";
const CREAM = "#ece0c8";

export class MechanismView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.shaftAngle = 0;
    this.keyAngle = 0;
    this.vibrating = new Map(); // midi -> 剩余能量 0..1
    this.masked = false;
    this.lastFrame = performance.now();
    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  trigger(midi, masked) {
    this.vibrating.set(midi, 1);
    this.masked = masked;
  }

  clearVibration() {
    this.vibrating.clear();
  }

  draw(song, floatStep, playing, bpm) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const speed = bpm / 117;
    if (playing) {
      this.shaftAngle += dt * 2.2 * speed;
      this.keyAngle += dt * 3.2 * speed;
    }
    for (const [midi, e] of this.vibrating) {
      const next = e - dt * 1.8;
      if (next <= 0) this.vibrating.delete(midi);
      else this.vibrating.set(midi, next);
    }

    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    this._grid(c);
    this._shaft(c);
    this._comb(c, LEFT_TINES, this.w * 0.06, this.w * 0.47, "left", playing);
    this._comb(c, RIGHT_TINES, this.w * 0.53, this.w * 0.94, "right", playing);
    this._scoreStrip(c, song, floatStep, playing);
    this._badge(c, playing);
  }

  _grid(c) {
    c.save();
    c.strokeStyle = "rgba(216,179,106,0.055)";
    c.lineWidth = 1;
    for (let x = 0; x < this.w; x += 28) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, this.h);
      c.stroke();
    }
    for (let y = 0; y < this.h; y += 28) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(this.w, y);
      c.stroke();
    }
    c.restore();
  }

  _shaft(c) {
    const y = this.h * 0.2;
    const r = this.h * 0.055;
    const x0 = this.w * 0.04;
    const x1 = this.w * 0.96;
    const grad = c.createLinearGradient(0, y - r, 0, y + r);
    grad.addColorStop(0, "#8a6a35");
    grad.addColorStop(0.25, GOLD_LIGHT);
    grad.addColorStop(0.5, GOLD);
    grad.addColorStop(0.8, "#9c7a40");
    grad.addColorStop(1, "#5e4620");
    c.fillStyle = grad;
    c.fillRect(x0, y - r, x1 - x0, r * 2);

    // 旋转的分节箍
    const bands = 40;
    for (let i = 0; i < bands; i++) {
      const t = i / bands;
      const phase = this.shaftAngle + t * Math.PI * 4;
      const light = (Math.sin(phase) + 1) / 2;
      c.fillStyle = `rgba(60,42,16,${0.25 + light * 0.35})`;
      const x = x0 + ((x1 - x0) * i) / bands;
      c.fillRect(x, y - r, 2, r * 2);
    }
    for (const x of [x0, x1]) {
      c.beginPath();
      c.arc(x, y, r * 1.35, 0, Math.PI * 2);
      c.fillStyle = "#1c2420";
      c.fill();
      c.strokeStyle = GOLD;
      c.lineWidth = 2;
      c.stroke();
      c.beginPath();
      c.arc(x, y, r * 0.55, 0, Math.PI * 2);
      c.fillStyle = GOLD;
      c.fill();
    }
    // 发条钥匙（左侧）
    c.save();
    c.translate(x0 - r * 1.9, y);
    c.rotate(this.keyAngle);
    c.strokeStyle = GOLD;
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(-r * 0.9, 0);
    c.lineTo(r * 0.9, 0);
    c.stroke();
    c.beginPath();
    c.arc(-r * 0.9, 0, r * 0.4, 0, Math.PI * 2);
    c.arc(r * 0.9, 0, r * 0.4, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  _comb(c, tines, x0, x1, track, playing) {
    const baseY = this.h * 0.6;
    const color = track === "left" ? GOLD : TEAL;
    c.strokeStyle = "rgba(216,179,106,0.55)";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x0, baseY);
    c.lineTo(x1, baseY);
    c.stroke();

    const n = tines.length;
    const maxH = this.h * 0.3;
    for (let i = 0; i < n; i++) {
      const tine = tines[i];
      const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
      const h = maxH * (1 - (i / (n - 1)) * 0.45);
      const energy = this.vibrating.get(tine.midi) || 0;
      const wobble = energy ? Math.sin(performance.now() * 0.05 + i) * 3 * energy : 0;
      c.save();
      c.strokeStyle = energy ? (track === "left" ? GOLD_LIGHT : "#b6ece1") : color;
      c.lineWidth = energy ? 3 : 2;
      if (energy) {
        c.shadowColor = color;
        c.shadowBlur = 14 * energy;
      }
      c.beginPath();
      c.moveTo(x, baseY);
      c.lineTo(x + wobble, baseY - h);
      c.stroke();
      c.beginPath();
      c.arc(x + wobble, baseY - h, 2.2, 0, Math.PI * 2);
      c.fillStyle = c.strokeStyle;
      c.fill();
      c.restore();
    }
    c.fillStyle = "rgba(236,224,200,0.55)";
    c.font = "9px ui-monospace, monospace";
    c.fillText(track === "left" ? "LEFT COMB / LOW" : "RIGHT COMB / HIGH", x0, baseY + 14);
  }

  _scoreStrip(c, song, floatStep) {
    const y = this.h * 0.66;
    const stripH = this.h * 0.27;
    const stripW = this.w * 0.88;
    const x0 = (this.w - stripW) / 2;
    c.fillStyle = CREAM;
    c.fillRect(x0, y, stripW, stripH);
    c.strokeStyle = "rgba(94,70,32,0.6)";
    c.strokeRect(x0, y, stripW, stripH);

    const laneH = stripH / 2;
    const pxPerStep = stripW / TOTAL_STEPS;
    const playX = x0 + stripW * 0.12;

    // 小节线与节拍刻度
    c.strokeStyle = "rgba(94,70,32,0.35)";
    c.lineWidth = 1;
    for (let s = 0; s <= TOTAL_STEPS; s++) {
      const x = playX + (s - floatStep) * pxPerStep;
      if (x < x0 - 2 || x > x0 + stripW + 2) continue;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x, y + stripH);
      c.stroke();
      if (s % 16 === 0) {
        c.fillStyle = "rgba(94,70,32,0.7)";
        c.font = "8px ui-monospace, monospace";
        c.fillText(`B${String(s / 16 + 1).padStart(2, "0")}`, x + 2, y + 10);
      }
    }
    c.strokeStyle = "rgba(94,70,32,0.25)";
    c.beginPath();
    c.moveTo(x0, y + laneH);
    c.lineTo(x0 + stripW, y + laneH);
    c.stroke();

    // 音符（卷轴随转轴同步滚动）
    for (const n of song.notes) {
      const x = playX + (n.step - floatStep) * pxPerStep;
      if (x < x0 - 8 || x > x0 + stripW + 8) continue;
      const isLeft = n.track === "left";
      const cy = y + (isLeft ? laneH * 1.5 : laneH * 0.5);
      c.fillStyle = isLeft ? "#b07a3c" : TEAL;
      c.beginPath();
      c.arc(x, cy, 3.4, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = c.fillStyle;
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(x, cy);
      c.lineTo(x, cy + (isLeft ? -8 : 8));
      c.stroke();
    }

    // 触发位置红线
    c.strokeStyle = this.masked ? "#d97062" : "#c0564a";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(playX, y - 4);
    c.lineTo(playX, y + stripH + 4);
    c.stroke();
  }

  _badge(c, playing) {
    const label = !playing ? "PAUSED" : this.masked ? "MASKING" : "PLAYING";
    const col = !playing ? GOLD : this.masked ? "#d97062" : TEAL;
    c.font = "10px ui-monospace, monospace";
    const tw = c.measureText(label).width + 16;
    c.fillStyle = "rgba(12,18,15,0.85)";
    c.fillRect(this.w - tw - 10, 10, tw, 20);
    c.strokeStyle = col;
    c.strokeRect(this.w - tw - 10, 10, tw, 20);
    c.fillStyle = col;
    c.fillText(label, this.w - tw - 2, 24);
  }

  barOf(step) {
    return Math.floor(step / 16) + 1;
  }

  get barCount() {
    return BARS;
  }
}
