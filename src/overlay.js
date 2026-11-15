// Canvas 2D overlay: projected contour lines, markers and elevation labels.

import { projectWorld } from './math3d.js';

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  resize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  visibleAt(renderer, screen) {
    if (screen.z < -1 || screen.z > 1) return false;
    const depth = renderer.depthAt(screen.x, screen.y);
    return depth === 1 ? screen.z <= 1 : screen.z <= depth + 0.004;
  }

  drawChain(ctx, chain, project, renderer, style) {
    const projectPoint = (point) => projectWorld(project.mvp, project.width, project.height, point);
    ctx.lineWidth = style.width;
    ctx.strokeStyle = style.color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let drawing = false;
    let prev = null;
    const points = chain.closed ? [...chain.points, chain.points[0]] : chain.points;
    for (const point of points) {
      const screen = projectPoint(point);
      const visible = this.visibleAt(renderer, screen);
      if (visible && !drawing) {
        ctx.beginPath();
        ctx.moveTo(prev ? prev.x : screen.x, prev ? prev.y : screen.y);
        drawing = true;
      } else if (visible && drawing) {
        ctx.lineTo(screen.x, screen.y);
      } else if (!visible && drawing) {
        ctx.stroke();
        drawing = false;
      }
      prev = screen;
    }
    if (drawing) ctx.stroke();
  }

  labelAnchor(chain, project, renderer) {
    const best = { score: -1 };
    const step = Math.max(1, Math.floor(chain.points.length / 24));
    for (let k = 0; k < chain.points.length; k += step) {
      const point = chain.points[k];
      const screen = projectWorld(project.mvp, project.width, project.height, point);
      if (!this.visibleAt(renderer, screen)) continue;
      const edgeMargin = Math.min(screen.x, project.width - screen.x, screen.y, project.height - screen.y);
      if (edgeMargin > best.score) best.score = edgeMargin, best.screen = screen;
    }
    return best.screen ?? null;
  }

  drawLabel(ctx, text, screen, canvasWidth, accent = '#ffd27a') {
    if (!screen) return;
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    const width = ctx.measureText(text).width + 14;
    const x = Math.max(4, Math.min(canvasWidth, screen.x + 12, canvasWidth - width - 4));
    const y = Math.max(18, screen.y - 26);
    roundedRect(ctx, x, y, width, 20, 6);
    ctx.fillStyle = 'rgba(12, 16, 24, 0.82)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillText(text, x + 7, y + 14);
  }

  drawHover(ctx, hover, project, renderer) {
    const screen = projectWorld(project.mvp, project.width, project.height, hover.point);
    if (!this.visibleAt(renderer, screen)) return;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffb340';
    ctx.fill();
    this.drawLabel(ctx, `标高 ${(hover.height * 1000).toFixed(1)} m`, screen, project.width);
  }

  render(state) {
    const { ctx, canvas } = this;
    const { width, height } = state.project;
    this.resize(width, height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const entry of state.contours) {
      const style = entry.active
        ? { width: 2.4, color: '#ffb340' }
        : { width: 1, color: 'rgba(220, 232, 255, 0.45)' };
      for (const chain of entry.chains) {
        this.drawChain(ctx, chain, state.project, state.renderer, style);
      }
      if (entry.active) {
        for (const chain of entry.chains) {
          if (chain.points.length < 6) continue;
          const anchor = this.labelAnchor(chain, state.project, state.renderer);
          if (anchor) {
            this.drawLabel(ctx, `阈值 ${Math.round(entry.level * 1000)} m`, anchor, width);
          }
        }
      }
    }
    for (const landmark of state.landmarks ?? []) {
      const screen = projectWorld(state.project.mvp, width, height, landmark.point);
      if (!this.visibleAt(state.renderer, screen)) continue;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = landmark.kind === 'peak' ? '#ff7a59' : '#59c8ff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
      this.drawLabel(
        ctx,
        `${landmark.kind === 'peak' ? '山顶' : '山谷'} ${(landmark.point[1] * 1000).toFixed(0)} m`,
        screen, width,
        landmark.kind === 'peak' ? '#ff9d85' : '#8fdcff',
      );
    }
    if (state.hover) this.drawHover(ctx, state.hover, state.project, state.renderer);
  }
}
