// Canvas renderer: hexagon carpet, SPL heat map, speakers, draggable listener.
import {
  HEX_VERTICES, HEX_RADIUS, SPEAKERS, SPEAKER_IDS, SPEAKER_LABELS,
  coverageGrid, insideHex, MODES
} from './acoustics.js';

const COLOR_STEPS = [
  [32, 96, 168],   // blue, quiet
  [46, 160, 120],
  [210, 180, 60],
  [210, 96, 50]    // red, loud
];

export class FieldView {
  constructor(canvas, onMove) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onMove = onMove;
    this.mode = 'quad';
    this.listener = { x: 0, y: 0 };
    this.trail = [];
    this.gridCache = null;
    this.dragging = false;
    this.bindPointer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this.scale = Math.min(this.width, this.height) / (2 * HEX_RADIUS) * 0.92;
    this.gridCache = null;
    this.draw();
  }

  toScreen(p) {
    return {
      x: this.width / 2 + p.x * this.scale,
      y: this.height / 2 - p.y * this.scale
    };
  }

  toWorld(s) {
    return {
      x: (s.x - this.width / 2) / this.scale,
      y: -(s.y - this.height / 2) / this.scale
    };
  }

  bindPointer() {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.emitMove(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.emitMove(e);
    });
    this.canvas.addEventListener('pointerup', () => { this.dragging = false; });
    this.canvas.addEventListener('pointercancel', () => { this.dragging = false; });
  }

  emitMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const world = this.toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (insideHex(world)) this.onMove(world);
  }

  setMode(mode) {
    this.mode = mode;
    this.gridCache = null;
    this.draw();
  }

  setListener(p, recordTrail = true) {
    this.listener = { ...p };
    if (recordTrail) {
      this.trail.push({ ...p });
      if (this.trail.length > 400) this.trail.shift();
    }
    this.draw();
  }

  clearTrail() {
    this.trail = [];
    this.draw();
  }

  draw() {
    const c = this.ctx;
    c.clearRect(0, 0, this.width, this.height);
    this.drawHeatMap();
    this.drawHex();
    this.drawTrail();
    this.drawSpeakers();
    this.drawListener();
  }

  drawHex() {
    const c = this.ctx;
    c.beginPath();
    HEX_VERTICES.forEach((v, i) => {
      const s = this.toScreen(v);
      if (i === 0) c.moveTo(s.x, s.y);
      else c.lineTo(s.x, s.y);
    });
    c.closePath();
    c.save();
    c.clip();
    c.fillStyle = 'rgba(245, 247, 250, 0.55)';
    c.fillRect(0, 0, this.width, this.height);
    c.restore();
    c.strokeStyle = '#23303c';
    c.lineWidth = 2;
    c.stroke();
  }

  drawHeatMap() {
    if (!this.gridCache) this.gridCache = coverageGrid(26, this.mode);
    const { cells, min, max } = this.gridCache;
    const c = this.ctx;
    c.save();
    c.beginPath();
    HEX_VERTICES.forEach((v, i) => {
      const s = this.toScreen(v);
      if (i === 0) c.moveTo(s.x, s.y);
      else c.lineTo(s.x, s.y);
    });
    c.closePath();
    c.clip();
    const cellSize = (2 * HEX_RADIUS / 26) * this.scale;
    cells.forEach((cell) => {
      const ratio = (cell.spl - min) / (max - min || 1);
      const s = this.toScreen(cell);
      c.fillStyle = colorFor(ratio, 0.34);
      c.fillRect(s.x - cellSize / 2, s.y - cellSize / 2,
        cellSize + 0.6, cellSize + 0.6);
    });
    c.restore();
  }

  drawSpeakers() {
    const c = this.ctx;
    const active = MODES[this.mode].activeSpeakers;
    SPEAKER_IDS.forEach((id) => {
      const s = this.toScreen(SPEAKERS[id]);
      const on = active.includes(id);
      c.beginPath();
      c.arc(s.x, s.y, 11, 0, Math.PI * 2);
      c.fillStyle = on ? '#1f6feb' : '#9aa7b2';
      c.fill();
      c.strokeStyle = '#0d1b2a';
      c.lineWidth = 1.5;
      c.stroke();
      c.fillStyle = '#0d1b2a';
      c.font = '11px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(SPEAKER_LABELS[id], s.x, s.y - 16);
      c.fillStyle = on ? '#0d1b2a' : '#5b6770';
      c.font = '10px system-ui, sans-serif';
      c.fillText(id, s.x, s.y + 25);
    });
  }

  drawTrail() {
    if (this.trail.length < 2) return;
    const c = this.ctx;
    c.beginPath();
    this.trail.forEach((p, i) => {
      const s = this.toScreen(p);
      if (i === 0) c.moveTo(s.x, s.y);
      else c.lineTo(s.x, s.y);
    });
    c.strokeStyle = 'rgba(200, 60, 60, 0.55)';
    c.lineWidth = 2;
    c.setLineDash([5, 4]);
    c.stroke();
    c.setLineDash([]);
  }

  drawListener() {
    const c = this.ctx;
    const s = this.toScreen(this.listener);
    c.beginPath();
    c.arc(s.x, s.y, 9, 0, Math.PI * 2);
    c.fillStyle = '#e84545';
    c.fill();
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.stroke();
    // Nose marker showing the facing direction (+y world = front).
    const nose = this.toScreen({ x: this.listener.x, y: this.listener.y + 0.45 });
    c.beginPath();
    c.moveTo(s.x, s.y);
    c.lineTo(nose.x, nose.y);
    c.strokeStyle = '#e84545';
    c.lineWidth = 2.5;
    c.stroke();
  }
}

function colorFor(ratio, alpha) {
  const scaled = Math.min(1, Math.max(0, ratio)) * (COLOR_STEPS.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = COLOR_STEPS[i];
  const b = COLOR_STEPS[Math.min(i + 1, COLOR_STEPS.length - 1)];
  const mix = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgba(${mix[0]}, ${mix[1]}, ${mix[2]}, ${alpha})`;
}
