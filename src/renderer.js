import { targetRadius } from "./profiles.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

function rgba(r, g, b, a) {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

function mixColor(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

export class GlassRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.embers = Array.from({ length: 22 }, (_, index) => ({
      phase: (index * 0.371) % 1,
      drift: ((index * 17) % 23) / 23 - 0.5,
      size: 0.8 + ((index * 7) % 13) / 9,
    }));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  getLayout() {
    const w = this.width;
    const h = this.height;
    const narrow = w < 560;
    const targetHeight = Math.min(h * 0.59, 390);
    const radiusScale = targetHeight * (narrow ? 0.41 : 0.44);
    return {
      w,
      h,
      targetHeight,
      radiusScale,
      centerX: w * (narrow ? 0.55 : 0.54),
      bottomY: h * 0.82,
      topY: h * 0.82 - targetHeight,
      heaterX: lerp(w * 0.095, w * 0.91, 0.1),
    };
  }

  render(sim, time, options = {}) {
    this.resize();
    const ctx = this.ctx;
    const layout = this.getLayout();
    const heat = clamp((sim.temperature - 320) / 700, 0, 1);
    layout.heaterX = lerp(layout.w * 0.095, layout.w * 0.9, sim.heaterPosition);

    ctx.clearRect(0, 0, layout.w, layout.h);
    this.drawBackdrop(layout, time, heat);
    this.drawWorkbench(layout);
    this.drawFurnace(layout, sim, time, heat);
    this.drawTarget(layout, sim, options.showTarget !== false);
    this.drawPipe(layout, sim);
    this.drawGlass(layout, sim, time, heat);
    this.drawForeground(layout, sim, time);

    if (sim.phase === "failed") this.drawColdWarning(layout, time);
    if (sim.phase === "success") this.drawSuccessGlow(layout, time, sim);
  }

  drawBackdrop(layout, time, heat) {
    const ctx = this.ctx;
    const { w, h } = layout;
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#151916");
    bg.addColorStop(0.52, "#101310");
    bg.addColorStop(1, "#15110d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const fireGlow = ctx.createRadialGradient(
      layout.heaterX,
      h * 0.72,
      5,
      layout.heaterX,
      h * 0.72,
      w * 0.42,
    );
    fireGlow.addColorStop(0, rgba(255, 117, 32, 0.18 + heat * 0.09));
    fireGlow.addColorStop(0.46, rgba(190, 70, 24, 0.055));
    fireGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fireGlow;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255, 238, 208, 0.025)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 46) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h * 0.17, h);
      ctx.stroke();
    }
    for (let y = h * 0.16; y < h * 0.8; y += 42) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(7, 9, 8, 0.56)";
    ctx.beginPath();
    ctx.ellipse(w * 0.2, h * 0.48, w * 0.2, h * 0.34, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(237, 218, 185, 0.055)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(w * 0.2, h * 0.47, w * 0.165, Math.PI * 0.12, Math.PI * 1.15);
    ctx.stroke();

    this.drawAtmosphere(layout, time);
  }

  drawAtmosphere(layout, time) {
    const ctx = this.ctx;
    const { w, h } = layout;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 9; i += 1) {
      const x = w * 0.12 + ((i * 0.117 + time * 0.004) % 0.8) * w;
      const y = h * (0.2 + ((i * 0.173) % 0.52));
      const radius = 15 + ((i * 13) % 38);
      const smoke = ctx.createRadialGradient(x, y, 0, x, y, radius);
      smoke.addColorStop(0, "rgba(210, 205, 185, 0.013)");
      smoke.addColorStop(1, "rgba(210, 205, 185, 0)");
      ctx.fillStyle = smoke;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawWorkbench(layout) {
    const ctx = this.ctx;
    const { w, h } = layout;
    const floorY = h * 0.76;

    const floor = ctx.createLinearGradient(0, floorY, 0, h);
    floor.addColorStop(0, "rgba(49, 48, 41, 0.22)");
    floor.addColorStop(0.45, "rgba(25, 25, 21, 0.78)");
    floor.addColorStop(1, "#090b0a");
    ctx.fillStyle = floor;
    ctx.fillRect(0, floorY, w, h - floorY);

    ctx.strokeStyle = "rgba(218, 202, 170, 0.055)";
    ctx.lineWidth = 1;
    const vanishingX = layout.centerX;
    for (let x = -w; x < w * 2; x += w * 0.11) {
      ctx.beginPath();
      ctx.moveTo(vanishingX + (x - vanishingX) * 0.26, floorY);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = floorY; y < h; y += 22) {
      const t = (y - floorY) / (h - floorY);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.strokeStyle = `rgba(218, 202, 170, ${0.018 + t * 0.025})`;
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(9, 11, 9, 0.7)";
    ctx.beginPath();
    ctx.roundRect(w * 0.065, h * 0.87, w * 0.87, h * 0.022, 4);
    ctx.fill();

    ctx.strokeStyle = "rgba(207, 185, 145, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.045, h * 0.902);
    ctx.lineTo(w * 0.94, h * 0.902);
    ctx.stroke();

    ctx.fillStyle = "rgba(224, 211, 184, 0.07)";
    for (let index = 0; index < 7; index += 1) {
      const x = w * (0.075 + index * 0.025);
      ctx.beginPath();
      ctx.moveTo(x, h * 0.912);
      ctx.lineTo(x + 2, h * 0.923);
      ctx.lineTo(x + 6, h * 0.925);
      ctx.lineTo(x + 9, h * 0.914);
      ctx.closePath();
      ctx.fill();
    }

    this.drawTools(layout);
  }

  drawTools(layout) {
    const ctx = this.ctx;
    const { w, h } = layout;
    ctx.save();
    ctx.translate(w * 0.075, h * 0.13);
    ctx.rotate(-0.12);
    ctx.strokeStyle = "rgba(212, 192, 151, 0.11)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(8, h * 0.22);
    ctx.lineTo(4, h * 0.29);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(1, h * 0.055, 16, 0.2, Math.PI * 1.6);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(w * 0.915, h * 0.18);
    ctx.strokeStyle = "rgba(212, 192, 151, 0.09)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, h * 0.35);
    ctx.moveTo(-14, h * 0.035);
    ctx.lineTo(14, h * 0.035);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(229, 218, 192, 0.13)";
    ctx.font = "8px 'Noto Sans SC', monospace";
    ctx.letterSpacing = "1px";
    ctx.fillText("BENCH 04 / 1200°C", w * 0.075, h * 0.113);
  }

  drawFurnace(layout, sim, time, heat) {
    const ctx = this.ctx;
    const { w, h } = layout;
    const x = layout.heaterX;
    const mouthY = h * 0.825;
    const alignment = sim.heaterAlignment;

    const glow = ctx.createRadialGradient(x, mouthY, 2, x, mouthY, w * 0.19);
    glow.addColorStop(0, rgba(255, 153, 54, 0.36 + alignment * 0.12));
    glow.addColorStop(0.3, rgba(232, 84, 25, 0.15));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, mouthY, w * 0.19, 0, Math.PI * 2);
    ctx.fill();

    this.drawFire(layout, x, mouthY, time, alignment, heat);

    const bodyY = h * 0.872;
    const bodyW = Math.min(124, w * 0.145);
    const bodyH = h * 0.093;
    ctx.save();
    ctx.translate(x, bodyY);
    ctx.fillStyle = "#171612";
    ctx.strokeStyle = "rgba(235, 214, 179, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-bodyW / 2, 0, bodyW, bodyH, 5);
    ctx.fill();
    ctx.stroke();

    const metal = ctx.createLinearGradient(-bodyW / 2, 0, bodyW / 2, 0);
    metal.addColorStop(0, "#28231c");
    metal.addColorStop(0.45, "#5a4730");
    metal.addColorStop(0.65, "#3b3125");
    metal.addColorStop(1, "#1c1b17");
    ctx.fillStyle = metal;
    ctx.fillRect(-bodyW / 2 + 5, 8, bodyW - 10, bodyH - 13);

    ctx.fillStyle = rgba(255, 125, 35, 0.22 + alignment * 0.18);
    ctx.fillRect(-bodyW / 2 + 12, 12, bodyW - 24, 4);

    const wheelY = bodyH + 6;
    for (const direction of [-1, 1]) {
      ctx.fillStyle = "#0c0d0b";
      ctx.beginPath();
      ctx.arc(direction * bodyW * 0.28, wheelY, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(231, 211, 174, 0.22)";
      ctx.stroke();
      ctx.fillStyle = "rgba(225, 205, 166, 0.12)";
      ctx.beginPath();
      ctx.arc(direction * bodyW * 0.28, wheelY, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(239, 226, 203, 0.35)";
    ctx.font = "7px 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText("移动炉口 / GLORY HOLE", x, h * 0.985);
    ctx.textAlign = "start";

    ctx.strokeStyle = rgba(255, 185, 91, alignment > 0.55 ? 0.55 : 0.2);
    ctx.setLineDash([3, 7]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, mouthY - 5);
    ctx.lineTo(x, mouthY - 36);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(16, 14, 11, 0.82)";
    ctx.strokeStyle = "rgba(229, 207, 169, 0.16)";
    ctx.beginPath();
    ctx.ellipse(x, mouthY + 1, 34, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = rgba(255, 142, 47, 0.35 + alignment * 0.3);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, mouthY, 24, 5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawFire(layout, x, baseY, time, alignment, heat) {
    const ctx = this.ctx;
    const h = layout.height;
    const intensity = 0.46 + alignment * 0.4 + heat * 0.12;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (let layer = 0; layer < 4; layer += 1) {
      for (let tongue = 0; tongue < 3; tongue += 1) {
        const width = 9 + layer * 5 + tongue * 2;
        const height = (30 + layer * 17 + tongue * 9) * intensity;
        const bob = Math.sin(time * (1.8 + layer * 0.33) + tongue * 2.1 + layer) * 4;
        const sway = Math.sin(time * 1.1 + layer + tongue * 1.7) * (7 - layer);
        const tipX = x + sway + (tongue - 1) * (8 + layer * 2);
        const tipY = baseY - 8 - height + bob;
        const gradient = ctx.createLinearGradient(x, baseY, tipX, tipY);
        gradient.addColorStop(0, rgba(255, 229, 151, 0.2 + intensity * 0.2));
        gradient.addColorStop(0.35, rgba(255, 131, 45, 0.18));
        gradient.addColorStop(1, rgba(219, 56, 18, 0));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(x - width + (tongue - 1) * 8, baseY);
        ctx.quadraticCurveTo(x - width * 0.6, baseY - height * 0.5, tipX, tipY);
        ctx.quadraticCurveTo(x + width * 0.7, baseY - height * 0.48, x + width + (tongue - 1) * 8, baseY);
        ctx.closePath();
        ctx.fill();
      }
    }

    const core = ctx.createLinearGradient(x, baseY - 8, x, baseY - 68 * intensity);
    core.addColorStop(0, "rgba(255, 246, 210, 0.42)");
    core.addColorStop(0.4, "rgba(255, 186, 76, 0.22)");
    core.addColorStop(1, "rgba(255, 111, 32, 0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(x - 11, baseY);
    ctx.quadraticCurveTo(x - 7, baseY - 35, x, baseY - 68 * intensity);
    ctx.quadraticCurveTo(x + 8, baseY - 32, x + 11, baseY);
    ctx.closePath();
    ctx.fill();

    for (const ember of this.embers) {
      const progress = (ember.phase + time * (0.08 + ember.size * 0.018)) % 1;
      const ex = x + ember.drift * 46 * progress;
      const ey = baseY - progress * 67 * intensity;
      const alpha = Math.max(0, (1 - progress) * 0.58);
      ctx.fillStyle = rgba(255, 191 + ember.size * 20, 78, alpha);
      ctx.beginPath();
      ctx.arc(ex, ey, ember.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(255, 209, 124, 0.04)";
    ctx.fillRect(x - 18, baseY - h * 0.0, 36, 2);
  }

  drawTarget(layout, sim, visible) {
    if (!visible) return;
    const ctx = this.ctx;
    const { centerX, bottomY, targetHeight, radiusScale } = layout;

    ctx.save();
    ctx.translate(centerX, bottomY);
    const left = [];
    const right = [];
    for (let i = 0; i <= 60; i += 1) {
      const y = i / 60;
      const r = targetRadius(y) * radiusScale;
      const sy = -y * targetHeight;
      left.push([-r, sy]);
      right.push([r, sy]);
    }

    ctx.beginPath();
    for (let i = 0; i < left.length; i += 1) {
      const [x, y] = left[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = right.length - 1; i >= 0; i -= 1) {
      const [x, y] = right[i];
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 213, 136, 0.018)";
    ctx.fill();

    ctx.setLineDash([3, 6]);
    ctx.strokeStyle = "rgba(255, 213, 136, 0.24)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(255, 227, 175, 0.16)";
    ctx.beginPath();
    ctx.moveTo(radiusScale * 0.9, 0);
    ctx.lineTo(radiusScale * 0.9, -targetHeight);
    ctx.stroke();
    for (let i = 0; i <= 6; i += 1) {
      const y = -(i / 6) * targetHeight;
      const major = i === 0 || i === 6;
      ctx.strokeStyle = `rgba(255, 227, 175, ${major ? 0.2 : 0.11})`;
      ctx.beginPath();
      ctx.moveTo(radiusScale * 0.87, y);
      ctx.lineTo(radiusScale * (major ? 0.95 : 0.91), y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPipe(layout, sim) {
    const ctx = this.ctx;
    const { centerX, bottomY, targetHeight } = layout;
    const profile = sim.profile;
    const topY = bottomY - profile.height * targetHeight;
    const mouthDrift = Math.sin(sim.tilt) * profile.height * targetHeight;
    const topX = centerX + mouthDrift;
    const pipeTop = Math.max(12, layout.h * 0.055);

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(8, 9, 8, 0.7)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(centerX, pipeTop);
    ctx.lineTo(topX, topY + 8);
    ctx.stroke();

    const metal = ctx.createLinearGradient(centerX - 6, 0, centerX + 7, 0);
    metal.addColorStop(0, "#342e25");
    metal.addColorStop(0.42, "#ad9469");
    metal.addColorStop(0.64, "#66583f");
    metal.addColorStop(1, "#211f1a");
    ctx.strokeStyle = metal;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(centerX - 1, pipeTop);
    ctx.lineTo(topX - 1, topY + 3);
    ctx.stroke();

    ctx.fillStyle = "#85704d";
    ctx.beginPath();
    ctx.ellipse(topX, topY + 4, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(222, 205, 169, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX - 22, pipeTop + 2);
    ctx.lineTo(centerX + 18, pipeTop + 2);
    ctx.moveTo(centerX - 17, pipeTop + 2);
    ctx.lineTo(centerX + 17, pipeTop + 32);
    ctx.stroke();
    ctx.restore();
  }

  drawGlass(layout, sim, time, heat) {
    const ctx = this.ctx;
    const profile = sim.profile;
    const { centerX, bottomY, targetHeight, radiusScale } = layout;
    const wallPx = clamp(radiusScale * 0.036, 4.5, 8.5);
    const points = profile.points;
    const hot = clamp((sim.temperature - 500) / 500, 0, 1);
    const topColor = mixColor([255, 183, 83], [255, 225, 149], hot);
    const bottomColor = mixColor([147, 48, 24], [239, 91, 31], hot);

    ctx.save();
    ctx.translate(centerX, bottomY);
    ctx.rotate(sim.tilt * 0.78);

    const outerPath = (scale = 1) => {
      ctx.beginPath();
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const x = -point.radius * radiusScale * scale;
        const y = -point.y * targetHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = points.length - 1; i >= 0; i -= 1) {
        const point = points[i];
        ctx.lineTo(point.radius * radiusScale * scale, -point.y * targetHeight);
      }
      ctx.closePath();
    };

    const innerPath = () => {
      ctx.beginPath();
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const thickness = this.wallPxAt(point.y, wallPx, sim);
        const x = -(Math.max(0.001, point.radius * radiusScale - thickness));
        const y = -point.y * targetHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = points.length - 1; i >= 0; i -= 1) {
        const point = points[i];
        const thickness = this.wallPxAt(point.y, wallPx, sim);
        ctx.lineTo(Math.max(0.001, point.radius * radiusScale - thickness), -point.y * targetHeight);
      }
      ctx.closePath();
    };

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const bloom = ctx.createLinearGradient(0, -targetHeight, 0, 0);
    bloom.addColorStop(0, rgba(topColor[0], topColor[1], topColor[2], 0.16 + hot * 0.1));
    bloom.addColorStop(0.7, rgba(bottomColor[0], bottomColor[1], bottomColor[2], 0.12));
    bloom.addColorStop(1, "rgba(0,0,0,0)");
    outerPath(1.035);
    ctx.fillStyle = bloom;
    ctx.fill();
    ctx.restore();

    const glass = ctx.createLinearGradient(0, -targetHeight, 0, 0);
    glass.addColorStop(0, rgba(topColor[0], topColor[1], topColor[2], 0.42 + hot * 0.12));
    glass.addColorStop(0.34, "rgba(255, 138, 53, 0.38)");
    glass.addColorStop(0.78, rgba(bottomColor[0], bottomColor[1], bottomColor[2], 0.3));
    glass.addColorStop(1, "rgba(98, 34, 18, 0.24)");
    outerPath();
    ctx.fillStyle = glass;
    ctx.fill();

    innerPath();
    const cavity = ctx.createLinearGradient(0, -targetHeight * 0.78, 0, 0);
    cavity.addColorStop(0, "rgba(28, 13, 8, 0.42)");
    cavity.addColorStop(0.7, "rgba(68, 18, 8, 0.24)");
    cavity.addColorStop(1, "rgba(12, 10, 8, 0.5)");
    ctx.fillStyle = cavity;
    ctx.fill();

    this.drawWallBands(points, sim, layout, wallPx, hot);

    ctx.strokeStyle = `rgba(255, 213, 139, ${0.26 + hot * 0.3})`;
    ctx.lineWidth = 1;
    outerPath();
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 228, 178, ${0.08 + hot * 0.12})`;
    ctx.lineWidth = 1;
    innerPath();
    ctx.stroke();

    const highlight = ctx.createLinearGradient(-radiusScale * 0.53, 0, radiusScale * 0.15, 0);
    highlight.addColorStop(0, "rgba(255,255,240,0)");
    highlight.addColorStop(0.42, `rgba(255,248,213,${0.07 + hot * 0.09})`);
    highlight.addColorStop(0.65, "rgba(255,255,240,0.02)");
    highlight.addColorStop(1, "rgba(255,255,240,0)");
    outerPath(0.99);
    ctx.fillStyle = highlight;
    ctx.fill();

    for (const bubble of sim.bubbles) {
      const sample = clamp(Math.round(bubble.y * (points.length - 1)), 0, points.length - 1);
      const radius = points[sample].radius * radiusScale;
      const y = -bubble.y * targetHeight;
      const x = bubble.x * radius * 1.15;
      const size = bubble.size * radiusScale * 1.05;
      ctx.fillStyle = "rgba(28, 11, 8, 0.34)";
      ctx.strokeStyle = "rgba(255, 222, 171, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 240, 205, 0.28)";
      ctx.beginPath();
      ctx.arc(x - size * 0.3, y - size * 0.32, Math.max(1, size * 0.26), 0, Math.PI * 2);
      ctx.fill();
    }

    if (profile.height > 0.88) {
      ctx.strokeStyle = "rgba(255, 221, 155, 0.42)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(0, -targetHeight * 0.995, points[points.length - 1].radius * radiusScale * 0.88, 4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
    this.drawWallCaption(layout, sim, time);
  }

  wallPxAt(y, base, sim) {
    const pulse = Math.sin(y * 35 + sim.elapsed * 2.2) * 0.5 + Math.sin(y * 13 - 1.8) * 0.5;
    const variation = sim.wallDelta * (0.35 + (pulse + 1) * 0.24);
    return base * (0.76 + variation * 0.9);
  }

  drawWallBands(points, sim, layout, wallPx, hot) {
    const ctx = this.ctx;
    const { targetHeight, radiusScale } = layout;
    const thinColor = [108, 202, 207];
    const midColor = [239, 184, 95];
    const thickColor = [211, 86, 48];

    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (a.radius <= 0.002 && b.radius <= 0.002) continue;
      const ya = -a.y * targetHeight;
      const yb = -b.y * targetHeight;
      const oa = a.radius * radiusScale;
      const ob = b.radius * radiusScale;
      const wa = this.wallPxAt(a.y, wallPx, sim);
      const wb = this.wallPxAt(b.y, wallPx, sim);
      const ia = Math.max(0.001, oa - wa);
      const ib = Math.max(0.001, ob - wb);
      const pulse = Math.sin(a.y * 29 + sim.elapsed * 1.6) * 0.16;
      const norm = clamp(0.26 + sim.wallDelta * 0.72 + pulse, 0, 1);
      let color;
      if (norm < 0.52) color = mixColor(thinColor, midColor, norm / 0.52);
      else color = mixColor(midColor, thickColor, (norm - 0.52) / 0.48);
      const warmth = 0.68 + hot * 0.24;

      ctx.globalAlpha = 0.7;
      ctx.fillStyle = rgba(color[0] * warmth, color[1] * warmth, color[2] * warmth, 1);
      ctx.beginPath();
      ctx.moveTo(-oa, ya);
      ctx.lineTo(-ob, yb);
      ctx.lineTo(-ib, yb);
      ctx.lineTo(-ia, ya);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(oa, ya);
      ctx.lineTo(ob, yb);
      ctx.lineTo(ib, yb);
      ctx.lineTo(ia, ya);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawWallCaption(layout, sim, time) {
    if (layout.w < 650) return;
    const ctx = this.ctx;
    const x = layout.centerX + layout.radiusScale * 0.86;
    const y = layout.bottomY - layout.targetHeight * 0.53;
    const delta = sim.wallDelta;

    ctx.strokeStyle = "rgba(235, 222, 198, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 18, y);
    ctx.lineTo(x + 48, y);
    ctx.stroke();

    const labels = [
      ["#6ccacf", "薄"],
      ["#efb85f", "匀"],
      ["#d35630", "厚"],
    ];
    labels.forEach(([color, label], index) => {
      const bx = x + 54 + index * 27;
      ctx.fillStyle = color;
      ctx.fillRect(bx, y - 3, 5, 6);
      ctx.fillStyle = "rgba(232, 225, 207, 0.4)";
      ctx.font = "7px 'Noto Sans SC', monospace";
      ctx.fillText(label, bx + 8, y + 3);
    });
    ctx.fillStyle = "rgba(232, 225, 207, 0.27)";
    ctx.font = "8px 'Noto Sans SC', monospace";
    ctx.fillText(`WALL Δ ${delta.toFixed(2)}`, x + 54, y - 11);
    ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
    ctx.fillRect(x + 54, y + 8, 74, 1);
    const drift = ((time * 0.4) % 1) * 74;
    ctx.fillStyle = "rgba(150, 215, 184, 0.28)";
    ctx.fillRect(x + 54 + drift, y + 8, 14, 1);
  }

  drawForeground(layout, sim, time) {
    const ctx = this.ctx;
    const { w, h } = layout;
    const mouthY = h * 0.825;
    const alignment = sim.heaterAlignment;

    if (alignment > 0.1) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 10; i += 1) {
        const offset = ((i / 10 + time * 0.34) % 1) * (h * 0.2);
        const x = layout.heaterX + Math.sin(time * 2.1 + i * 1.7) * (8 + i * 1.3);
        const y = mouthY - 20 - offset;
        const alpha = Math.max(0, 0.15 - offset / (h * 0.2) * 0.15);
        ctx.fillStyle = rgba(255, 180, 73, alpha * alignment * 2.2);
        ctx.beginPath();
        ctx.arc(x, y, 1 + (i % 3) * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.fillStyle = "rgba(234, 226, 208, 0.14)";
    ctx.font = "7px monospace";
    ctx.textAlign = "right";
    ctx.fillText("TEMP → COLOR / WALL → BANDS", w - 18, h - 18);
    ctx.textAlign = "left";

    ctx.fillStyle = "rgba(234, 226, 208, 0.18)";
    ctx.fillRect(18, h - 25, 10, 1);
    ctx.fillText("07", 34, h - 21);
  }

  drawColdWarning(layout, time) {
    const ctx = this.ctx;
    const { w, h } = layout;
    const vignette = ctx.createRadialGradient(w * 0.55, h * 0.47, h * 0.18, w * 0.55, h * 0.47, w * 0.72);
    vignette.addColorStop(0, "rgba(21, 54, 62, 0)");
    vignette.addColorStop(0.62, "rgba(16, 51, 61, 0.15)");
    vignette.addColorStop(1, "rgba(8, 24, 33, 0.55)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(layout.centerX + layout.radiusScale * 0.4, layout.bottomY - 42);
    ctx.strokeStyle = "rgba(160, 219, 227, 0.24)";
    ctx.lineWidth = 1;
    const pulse = 0.5 + Math.sin(time * 2.5) * 0.15;
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.moveTo(-30, -10);
    ctx.lineTo(-14, -18);
    ctx.lineTo(-6, -4);
    ctx.lineTo(10, -15);
    ctx.lineTo(27, -2);
    ctx.stroke();
    ctx.restore();
  }

  drawSuccessGlow(layout, time, sim) {
    const ctx = this.ctx;
    const { centerX, bottomY, targetHeight } = layout;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const glow = ctx.createRadialGradient(
      centerX,
      bottomY - targetHeight * 0.46,
      10,
      centerX,
      bottomY - targetHeight * 0.46,
      targetHeight * 0.5,
    );
    glow.addColorStop(0, "rgba(255, 213, 132, 0.16)");
    glow.addColorStop(0.55, "rgba(255, 163, 63, 0.08)");
    glow.addColorStop(1, "rgba(255, 138, 53, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(centerX, bottomY - targetHeight * 0.46, targetHeight * 0.5, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 15; i += 1) {
      const angle = i * 2.4 + time * 0.06;
      const radius = targetHeight * (0.24 + ((i * 0.19) % 0.32));
      const x = centerX + Math.cos(angle) * radius * 0.74;
      const y = bottomY - targetHeight * 0.48 + Math.sin(angle) * radius;
      const alpha = 0.22 + Math.sin(time * 1.7 + i) * 0.16;
      ctx.fillStyle = rgba(255, 229, 171, Math.max(0.02, alpha));
      ctx.beginPath();
      ctx.arc(x, y, 1 + (i % 3) * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
