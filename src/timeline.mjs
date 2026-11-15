import {
  FPS, TOTAL_FRAMES, SHOTS, CROSSFADE_FRAMES, frameToTime,
  frameDistanceToPeak, PEAK_TOLERANCE_FRAMES,
} from './editor-core.mjs';

const LANE_H = 44;
const PAD_L = 122;
const PAD_R = 24;
const PAD_T = 16;
const OUT_H = 58;

export class Timeline {
  constructor(canvas, cuts, onChanged) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cuts = cuts;
    this.onChanged = onChanged;
    this.playheadFrame = 0;
    this.dragging = null;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.resize();
    this.bindPointer();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = PAD_T * 2 + SHOTS.length * LANE_H + OUT_H + 26;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.trackLeft = PAD_L;
    this.trackWidth = this.width - PAD_L - PAD_R;
  }

  frameToX(frame) {
    return this.trackLeft + (frame / TOTAL_FRAMES) * this.trackWidth;
  }

  xToFrame(x) {
    const ratio = (x - this.trackLeft) / this.trackWidth;
    return Math.max(1, Math.min(TOTAL_FRAMES - 1, Math.round(ratio * TOTAL_FRAMES)));
  }

  cutHandleY() {
    return PAD_T + SHOTS.length * LANE_H + OUT_H / 2;
  }

  bindPointer() {
    const hitTest = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const handleY = this.cutHandleY();
      for (let i = 0; i < this.cuts.length; i += 1) {
        const hx = this.frameToX(this.cuts[i].frame);
        if (Math.abs(x - hx) <= 12 && Math.abs(y - handleY) <= 22) return i;
      }
      return null;
    };

    this.canvas.addEventListener('pointerdown', (event) => {
      const index = hitTest(event);
      if (index === null) return;
      this.dragging = index;
      this.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (this.dragging === null) {
        this.canvas.style.cursor = hitTest(event) === null ? 'default' : 'ew-resize';
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      const raw = this.xToFrame(event.clientX - rect.left);
      const index = this.dragging;
      const lower = index === 0 ? 1 : this.cuts[index - 1].frame + 1;
      const upper = index === this.cuts.length - 1
        ? TOTAL_FRAMES - 1
        : this.cuts[index + 1].frame - 1;
      this.cuts[index].frame = Math.max(lower, Math.min(upper, raw));
      this.onChanged();
    });
    const release = () => {
      if (this.dragging !== null) {
        this.dragging = null;
        this.onChanged();
      }
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
  }

  // Double click a handle toggles hard cut <-> crossfade.
  bindModeToggle(onToggle) {
    this.canvas.addEventListener('dblclick', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const handleY = this.cutHandleY();
      for (let i = 0; i < this.cuts.length; i += 1) {
        const hx = this.frameToX(this.cuts[i].frame);
        if (Math.abs(x - hx) <= 12 && Math.abs(y - handleY) <= 22) onToggle(i);
      }
    });
  }

  setPlayhead(frame) {
    this.playheadFrame = frame;
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.font = '12px "Noto Sans SC Subset", system-ui, sans-serif';

    SHOTS.forEach((shot, shotIndex) => {
      const y = PAD_T + shotIndex * LANE_H;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(this.trackLeft, y, this.trackWidth, LANE_H - 8);
      ctx.fillStyle = '#c8d4ea';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(shot.label, this.trackLeft - 10, y + (LANE_H - 8) / 2);

      // Peak markers: every bounce impact across the 12s source.
      const period = 45;
      for (let frame = 0; frame <= TOTAL_FRAMES; frame += period) {
        const x = this.frameToX(frame);
        ctx.strokeStyle = `hsla(${shot.ringHue} 90% 70% / 0.75)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y + 4);
        ctx.lineTo(x, y + LANE_H - 12);
        ctx.stroke();
        if (frame === 0) continue;
        ctx.fillStyle = `hsla(${shot.ringHue} 90% 75% / 0.9)`;
        ctx.beginPath();
        ctx.arc(x, y + LANE_H - 12, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      this.drawRuler(y);
    });

    this.drawOutputTrack();
    this.drawCutHandles();
    this.drawPlayhead();
  }

  drawRuler(y) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let sec = 0; sec <= 12; sec += 1) {
      const x = this.frameToX(sec * FPS);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(x, y - 2);
      ctx.lineTo(x, y + LANE_H - 8);
      ctx.stroke();
      if (sec % 2 === 0) {
        ctx.fillStyle = 'rgba(220,230,250,0.75)';
        ctx.fillText(`${sec}s`, x, y + LANE_H - 6);
      }
    }
  }

  drawOutputTrack() {
    const ctx = this.ctx;
    const y = PAD_T + SHOTS.length * LANE_H;
    const boundaries = [0, ...this.cuts.map((cut) => cut.frame), TOTAL_FRAMES]
      .sort((a, b) => a - b);
    const segmentShots = [0, 1, 2, 0];
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c8d4ea';
    ctx.textBaseline = 'middle';
    ctx.fillText('成片 Output', this.trackLeft - 10, y + OUT_H / 2);

    for (let i = 0; i < boundaries.length - 1; i += 1) {
      const x0 = this.frameToX(boundaries[i]);
      const x1 = this.frameToX(boundaries[i + 1]);
      const shot = SHOTS[segmentShots[Math.min(i, 3)]];
      ctx.fillStyle = `hsla(${shot.hue} 70% 45% / 0.85)`;
      ctx.fillRect(x0, y, x1 - x0, OUT_H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px "Noto Sans SC Subset", system-ui, sans-serif';
      ctx.fillText(shot.id, x0 + 8, y + OUT_H / 2);
      ctx.font = '12px "Noto Sans SC Subset", system-ui, sans-serif';
    }

    // Crossfade overlap shading.
    this.cuts.forEach((cut) => {
      if (cut.mode !== 'crossfade') return;
      const half = CROSSFADE_FRAMES / 2;
      const x0 = this.frameToX(cut.frame - half);
      const x1 = this.frameToX(cut.frame + half);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x0, y, x1 - x0, OUT_H);
    });
  }

  drawCutHandles() {
    const ctx = this.ctx;
    const handleY = this.cutHandleY();
    this.cuts.forEach((cut, index) => {
      const x = this.frameToX(cut.frame);
      const distance = frameDistanceToPeak(cut.frame);
      const ok = distance <= PEAK_TOLERANCE_FRAMES;
      const color = ok ? '#4ade80' : '#f87171';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(cut.mode === 'crossfade' ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, handleY + OUT_H / 2 - 6);
      ctx.stroke();
      ctx.setLineDash([]);

      // Diamond handle.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, handleY - 11);
      ctx.lineTo(x + 9, handleY);
      ctx.lineTo(x, handleY + 11);
      ctx.lineTo(x - 9, handleY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0b1220';
      ctx.font = 'bold 11px "Noto Sans SC Subset", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), x, handleY);

      ctx.fillStyle = color;
      ctx.font = '11px "Noto Sans SC Subset", system-ui, sans-serif';
      const tag = cut.mode === 'hard' ? '硬切' : '淡化';
      ctx.fillText(`${tag} ${frameToTime(cut.frame).toFixed(2)}s`, x, handleY + 26);
    });
  }

  drawPlayhead() {
    const ctx = this.ctx;
    const x = this.frameToX(this.playheadFrame);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, PAD_T - 4);
    ctx.lineTo(x, this.height - 8);
    ctx.stroke();
  }
}
