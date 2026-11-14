const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function opacityAt(timeline, time) {
  if (!timeline) return 0;
  const fadeDuration = 0.62;
  if (time < timeline.in || time > timeline.out) return 0;
  if (time < timeline.in + fadeDuration) {
    return smoothstep(timeline.in, timeline.in + fadeDuration, time);
  }
  if (time > timeline.out - fadeDuration) {
    return smoothstep(timeline.out, timeline.out - fadeDuration, time);
  }
  return 1;
}

function roundedPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export class ProjectionRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.grain = this.createGrainTexture();
    this.maskCanvas = document.createElement("canvas");
    this.maskCanvas.width = 248;
    this.maskCanvas.height = 160;
    this.maskCtx = this.maskCanvas.getContext("2d", { willReadFrequently: true });
    this.wallCanvas = document.createElement("canvas");
    this.wallCtx = this.wallCanvas.getContext("2d", { alpha: true });
    this.wallSignature = "";
  }

  createGrainTexture() {
    const grain = document.createElement("canvas");
    grain.width = 160;
    grain.height = 160;
    const ctx = grain.getContext("2d");
    const random = seededRandom(4207);
    for (let i = 0; i < 2600; i += 1) {
      const alpha = random() * 0.11;
      ctx.fillStyle = random() > 0.48
        ? `rgba(47, 30, 18, ${alpha})`
        : `rgba(255, 235, 203, ${alpha * 0.72})`;
      const size = random() > 0.9 ? 1.5 : 0.7;
      ctx.fillRect(random() * 160, random() * 160, size, size);
    }
    return grain;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width === this.width && height === this.height && dpr === this.dpr) return false;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.wallCanvas.width = this.canvas.width;
    this.wallCanvas.height = this.canvas.height;
    this.wallSignature = "";
    return true;
  }

  getLayout(state, width = this.width, height = this.height) {
    const wall = {
      x: width * 0.058,
      y: height * 0.055,
      w: width * 0.712,
      h: height * 0.84,
    };
    wall.right = wall.x + wall.w;
    wall.bottom = wall.y + wall.h;
    wall.cx = wall.x + wall.w / 2;
    wall.cy = wall.y + wall.h / 2;

    const sourceX = clamp(state.light.x * width, wall.right + width * 0.022, width - width * 0.028);
    const sourceY = clamp(state.light.y * height, wall.y + height * 0.06, wall.bottom - height * 0.06);
    const target = {
      x: wall.cx + (sourceX - wall.cx) * -0.045,
      y: wall.cy + (sourceY - wall.cy) * -0.08,
    };
    return { width, height, wall, source: { x: sourceX, y: sourceY }, target };
  }

  render(state, scene, time, now = performance.now()) {
    this.resize();
    const ctx = this.ctx;
    const layout = this.getLayout(state);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawChamber(ctx, layout, state, scene, now);
    this.refreshWallCache(layout, state, scene, time, now);
    ctx.drawImage(this.wallCanvas, 0, 0, this.width, this.height);
    this.drawLightCone(ctx, layout, state);
    this.drawLayerRack(ctx, layout, state, scene);
    this.drawSource(ctx, layout, state, now);
    this.drawLabels(ctx, layout, state, scene);
  }

  refreshWallCache(layout, state, scene, time, now) {
    const opacitySignature = state.timeline.map((fade) => opacityAt(fade, time).toFixed(3)).join(",");
    const signature = [
      state.angles.join(","),
      state.spacings.join(","),
      state.light.distance.toFixed(2),
      state.light.height.toFixed(2),
      layout.source.x.toFixed(2),
      layout.source.y.toFixed(2),
      opacitySignature,
      state.metrics?.silhouette ?? "",
    ].join("|");
    if (signature === this.wallSignature) return;
    this.wallSignature = signature;
    const ctx = this.wallCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawWall(ctx, layout, state, scene, time, now);
  }

  drawChamber(ctx, layout, state, scene, now) {
    const { width, height, wall, source } = layout;
    const background = ctx.createRadialGradient(
      source.x, source.y, 2,
      source.x, source.y, Math.max(width, height) * 0.78,
    );
    background.addColorStop(0, "rgba(126, 77, 42, 0.28)");
    background.addColorStop(0.28, "rgba(54, 34, 23, 0.24)");
    background.addColorStop(0.7, "rgba(17, 12, 10, 0.68)");
    background.addColorStop(1, "#0b0807");
    ctx.fillStyle = "#0b0807";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const frameX = wall.x - width * 0.018;
    const frameY = wall.y - height * 0.028;
    const frameW = wall.w + width * 0.036;
    const frameH = wall.h + height * 0.056;
    const frameGradient = ctx.createLinearGradient(frameX, frameY, frameX + frameW, frameY + frameH);
    frameGradient.addColorStop(0, "#3d2d23");
    frameGradient.addColorStop(0.43, "#241a15");
    frameGradient.addColorStop(1, "#4a3528");
    ctx.save();
    roundedPath(ctx, frameX, frameY, frameW, frameH, 11);
    ctx.fillStyle = frameGradient;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(239, 206, 163, 0.19)";
    ctx.stroke();
    roundedPath(ctx, frameX + 4, frameY + 4, frameW - 8, frameH - 8, 8);
    ctx.strokeStyle = "rgba(6, 4, 3, 0.62)";
    ctx.stroke();

    ctx.strokeStyle = "rgba(230, 197, 153, 0.09)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(frameX + 12, frameY + 14 + i * (frameH - 28) / 3);
      ctx.lineTo(frameX + frameW - 12, frameY + 13 + i * (frameH - 28) / 3 + 2);
      ctx.stroke();
    }
    ctx.restore();

    const cornerGlow = ctx.createRadialGradient(
      source.x, source.y, 0,
      source.x, source.y, Math.max(width, height) * 0.30,
    );
    cornerGlow.addColorStop(0, "rgba(229, 156, 91, 0.11)");
    cornerGlow.addColorStop(1, "rgba(229, 156, 91, 0)");
    ctx.fillStyle = cornerGlow;
    ctx.fillRect(0, 0, width, height);

    const flicker = 0.985 + Math.sin(now * 0.0063) * 0.012 + Math.sin(now * 0.017) * 0.004;
    ctx.fillStyle = `rgba(225, 166, 101, ${0.055 * flicker})`;
    ctx.beginPath();
    ctx.arc(source.x, source.y, Math.max(8, width * 0.016), 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(51, 33, 22, ${clamp((state.light.distance - 52) / 80, 0, 0.11)})`;
    ctx.fillRect(0, 0, width, height);
  }

  drawWall(ctx, layout, state, scene, time, now) {
    const { wall, target, source, width, height } = layout;
    ctx.save();
    roundedPath(ctx, wall.x, wall.y, wall.w, wall.h, 5);
    ctx.clip();

    const paper = ctx.createLinearGradient(wall.x, wall.y, wall.x + wall.w, wall.bottom);
    paper.addColorStop(0, scene.palette.wallTop);
    paper.addColorStop(0.58, scene.palette.wallBottom);
    paper.addColorStop(1, "#6d4930");
    ctx.fillStyle = paper;
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

    const lightWash = ctx.createRadialGradient(
      target.x, target.y, wall.w * 0.02,
      target.x, target.y, wall.w * 0.72,
    );
    lightWash.addColorStop(0, "rgba(255, 245, 217, 0.60)");
    lightWash.addColorStop(0.32, "rgba(255, 221, 164, 0.32)");
    lightWash.addColorStop(0.78, "rgba(171, 102, 59, 0.05)");
    lightWash.addColorStop(1, "rgba(45, 25, 15, 0.23)");
    ctx.fillStyle = lightWash;
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

    this.drawWallTexture(ctx, wall, scene);
    this.drawProjectedLayers(ctx, layout, state, scene, time, now);
    this.drawDustAndGlow(ctx, wall, target, scene, state, now);
    this.drawEdgeBurn(ctx, layout, state, now);

    const vignette = ctx.createRadialGradient(
      wall.cx, wall.cy, wall.h * 0.30,
      wall.cx, wall.cy, wall.w * 0.68,
    );
    vignette.addColorStop(0, "rgba(24, 13, 9, 0)");
    vignette.addColorStop(0.74, "rgba(28, 15, 9, 0.12)");
    vignette.addColorStop(1, "rgba(18, 9, 5, 0.46)");
    ctx.fillStyle = vignette;
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

    if (state.metrics?.silhouette < 58) {
      const haze = ctx.createRadialGradient(wall.cx, wall.cy, 0, wall.cx, wall.cy, wall.w * 0.44);
      haze.addColorStop(0, "rgba(99, 77, 58, 0.13)");
      haze.addColorStop(1, "rgba(99, 77, 58, 0)");
      ctx.fillStyle = haze;
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    }

    roundedPath(ctx, wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1, 4);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 240, 211, 0.18)";
    ctx.stroke();
    ctx.restore();

    const floorShade = ctx.createLinearGradient(0, wall.bottom - 1, 0, wall.bottom + height * 0.045);
    floorShade.addColorStop(0, "rgba(0, 0, 0, 0.30)");
    floorShade.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = floorShade;
    ctx.fillRect(wall.x - 4, wall.bottom, wall.w + 8, height * 0.045);
  }

  drawWallTexture(ctx, wall, scene) {
    const random = seededRandom(891);
    ctx.save();
    for (let i = 0; i < 26; i += 1) {
      const y = wall.y + random() * wall.h;
      ctx.fillStyle = `rgba(47, 28, 17, ${0.015 + random() * 0.021})`;
      ctx.fillRect(wall.x + random() * wall.w * 0.12, y, wall.w * (0.62 + random() * 0.38), 0.6);
    }
    for (let i = 0; i < 105; i += 1) {
      const x = wall.x + random() * wall.w;
      const y = wall.y + random() * wall.h;
      const r = 1 + random() * 7;
      ctx.fillStyle = `rgba(59, 36, 21, ${0.012 + random() * 0.022})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 0.34;
    ctx.globalCompositeOperation = "soft-light";
    const pattern = ctx.createPattern(this.grain, "repeat");
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    }
    ctx.restore();
  }

  projectionTransform(layout, state, index, time) {
    const { wall, source } = layout;
    const spacing = state.spacings[index];
    const depth = index / 3;
    const closeness = clamp((76 - state.light.distance) / 76, 0, 1);
    const lightX = (source.x - wall.cx) / wall.w;
    const lightY = (source.y - wall.cy) / wall.h;
    return {
      x: wall.cx - lightX * (wall.w * 0.16 + depth * wall.w * 0.07),
      y: wall.cy - lightY * (wall.h * 0.13 + depth * wall.h * 0.06),
      angle: state.angles[index] * Math.PI / 180,
      unit: wall.h * (0.86 + closeness * 0.085 + depth * 0.006),
      blur: 0.55 + spacing / 100 * 8.8,
      opacity: opacityAt(state.timeline[index], time),
    };
  }

  drawProjectedLayers(ctx, layout, state, scene, time, now) {
    const { wall } = layout;
    for (let index = 0; index < scene.layers.length; index += 1) {
      const transform = this.projectionTransform(layout, state, index, time);
      if (transform.opacity <= 0.001) continue;
      const layer = scene.layers[index];
      const pressure = state.metrics?.silhouette < 55 ? 0.055 : 0;
      ctx.save();
      ctx.globalAlpha = transform.opacity * (0.73 + pressure);
      ctx.fillStyle = scene.palette.ink[index];
      ctx.strokeStyle = scene.palette.ink[index];
      ctx.filter = `blur(${transform.blur.toFixed(2)}px)`;
      ctx.translate(transform.x, transform.y);
      ctx.rotate(transform.angle);
      ctx.scale(transform.unit, transform.unit);
      layer.draw(ctx);
      ctx.restore();
    }

    const breathing = 0.92 + Math.sin(now * 0.0034) * 0.08;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.20 * breathing;
    ctx.fillStyle = scene.palette.glow;
    ctx.filter = "blur(18px)";
    ctx.beginPath();
    ctx.ellipse(wall.cx, wall.cy - wall.h * 0.24, wall.w * 0.24, wall.h * 0.12, -0.05, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawDustAndGlow(ctx, wall, target, scene, state, now) {
    const random = seededRandom(1729);
    ctx.save();
    for (let i = 0; i < 34; i += 1) {
      const x = wall.x + random() * wall.w;
      const y = wall.y + random() * wall.h;
      const drift = Math.sin(now * 0.0012 + i) * 1.8;
      const alpha = 0.028 + random() * 0.10;
      ctx.fillStyle = `rgba(255, 223, 171, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x + drift, y, random() * 1.15 + 0.35, 0, TAU);
      ctx.fill();
    }

    const glint = ctx.createRadialGradient(
      target.x, target.y, 0,
      target.x, target.y, wall.w * 0.35,
    );
    glint.addColorStop(0, "rgba(255, 244, 213, 0.17)");
    glint.addColorStop(0.42, "rgba(255, 212, 151, 0.06)");
    glint.addColorStop(1, "rgba(255, 212, 151, 0)");
    ctx.fillStyle = glint;
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    ctx.restore();
  }

  drawEdgeBurn(ctx, layout, state, now) {
    const { wall, source, target } = layout;
    const burn = clamp((31 - state.light.distance) / 19, 0, 1);
    if (burn <= 0.015) return;
    const edgeX = source.x < wall.cx ? wall.x : wall.right;
    const edgeY = clamp(target.y, wall.y + wall.h * 0.18, wall.bottom - wall.h * 0.18);
    const pulse = 0.94 + Math.sin(now * 0.021) * 0.06;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const bloom = ctx.createRadialGradient(edgeX, edgeY, 0, edgeX, edgeY, wall.w * 0.30);
    bloom.addColorStop(0, `rgba(255, 225, 179, ${burn * 0.55 * pulse})`);
    bloom.addColorStop(0.23, `rgba(255, 164, 86, ${burn * 0.31})`);
    bloom.addColorStop(0.64, `rgba(186, 72, 31, ${burn * 0.10})`);
    bloom.addColorStop(1, "rgba(129, 46, 22, 0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

    ctx.globalCompositeOperation = "source-over";
    const random = seededRandom(88);
    for (let i = 0; i < Math.round(20 * burn); i += 1) {
      const x = edgeX + (source.x < wall.cx ? 1 : -1) * random() * wall.w * 0.2;
      const y = edgeY + (random() - 0.5) * wall.h * 0.46;
      const radius = 1 + random() * 5;
      ctx.fillStyle = `rgba(76, 29, 14, ${0.10 + random() * 0.22})`;
      ctx.beginPath();
      ctx.arc(clamp(x, wall.x, wall.right), y, radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawLightCone(ctx, layout, state) {
    const { wall, source } = layout;
    const flicker = 0.94 + Math.sin(performance.now() * 0.005) * 0.06;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const cone = ctx.createLinearGradient(source.x, source.y, wall.cx, wall.cy);
    cone.addColorStop(0, `rgba(255, 216, 157, ${0.16 * flicker})`);
    cone.addColorStop(0.5, "rgba(255, 201, 130, 0.055)");
    cone.addColorStop(1, "rgba(255, 201, 130, 0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(source.x - 3, source.y);
    ctx.lineTo(wall.x, wall.y - 5);
    ctx.lineTo(wall.x, wall.bottom + 5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = "rgba(255, 211, 148, 0.16)";
    ctx.lineWidth = 0.7;
    for (let i = 0; i <= 4; i += 1) {
      const y = wall.y + wall.h * i / 4;
      ctx.beginPath();
      ctx.moveTo(source.x - 2, source.y);
      ctx.lineTo(wall.right, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLayerRack(ctx, layout, state, scene) {
    const { wall, source } = layout;
    const start = wall.right + 9;
    const end = source.x - 16;
    const weights = state.spacings.map((spacing) => 0.25 + spacing / 100);
    const total = weights.reduce((sum, value) => sum + value, 0);
    let cumulative = 0;
    const ordered = [];
    for (let i = 0; i < weights.length; i += 1) {
      cumulative += weights[i] / 2;
      ordered.push({ index: i, x: start + (end - start) * (cumulative / total) });
      cumulative += weights[i] / 2;
    }
    ordered.sort((a, b) => b.x - a.x);

    ctx.save();
    ctx.fillStyle = "rgba(9, 7, 6, 0.28)";
    ctx.fillRect(wall.right + 2, wall.y - 2, layout.width - wall.right - 5, wall.h + 10);
    const shelf = ctx.createLinearGradient(wall.right, 0, layout.width, 0);
    shelf.addColorStop(0, "rgba(31, 23, 19, 0.82)");
    shelf.addColorStop(1, "rgba(12, 9, 7, 0.92)");
    ctx.fillStyle = shelf;
    ctx.fillRect(wall.right + 2, wall.y - 2, layout.width - wall.right - 5, wall.h + 10);
    ctx.strokeStyle = "rgba(224, 198, 159, 0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wall.right + 2, wall.y - 2);
    ctx.lineTo(wall.right + 2, wall.bottom + 8);
    ctx.stroke();

    ordered.forEach((sheet, orderIndex) => {
      const index = sheet.index;
      const x = sheet.x;
      const topY = wall.y + wall.h * 0.11 + orderIndex * 3;
      const sheetH = wall.h * 0.73;
      const width = 10;
      const skew = 3.5;
      ctx.save();
      ctx.translate(x, topY);
      ctx.globalAlpha = 0.36;
      const paper = ctx.createLinearGradient(-width, 0, width, 0);
      paper.addColorStop(0, "rgba(247, 225, 190, 0.12)");
      paper.addColorStop(0.48, "rgba(231, 207, 169, 0.28)");
      paper.addColorStop(1, "rgba(151, 126, 93, 0.08)");
      ctx.fillStyle = paper;
      ctx.beginPath();
      ctx.moveTo(-width, skew);
      ctx.lineTo(width, 0);
      ctx.lineTo(width, sheetH);
      ctx.lineTo(-width, sheetH - skew);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(247, 225, 190, 0.20)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "rgba(247, 230, 202, 0.13)";
      ctx.beginPath();
      ctx.moveTo(-1.5, sheetH * 0.17);
      ctx.quadraticCurveTo(width + 3, sheetH * 0.23, 0, sheetH * 0.33);
      ctx.moveTo(-1, sheetH * 0.48);
      ctx.quadraticCurveTo(-width - 2, sheetH * 0.55, 1, sheetH * 0.64);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(198, 177, 146, 0.48)";
      ctx.font = "8px Atelier Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(index + 1).padStart(2, "0"), 0, sheetH + 12);

      ctx.globalAlpha = 0.3 + (index / 3) * 0.23;
      const angle = state.angles[index] * Math.PI / 180;
      ctx.translate(0, sheetH / 2);
      ctx.rotate(angle * 0.32);
      ctx.scale(1, 0.16);
      ctx.fillStyle = scene.palette.ink[index];
      scene.layers[index].draw(ctx);
      ctx.restore();
    });

    ctx.fillStyle = "rgba(198, 177, 146, 0.42)";
    ctx.font = "7px Atelier Sans, sans-serif";
    ctx.letterSpacing = "1px";
    ctx.fillText("PELLICLE STACK", wall.right + 9, wall.y - 12);
    ctx.restore();
  }

  drawSource(ctx, layout, state, now) {
    const { source, wall } = layout;
    const flicker = 0.95 + Math.sin(now * 0.0075) * 0.035 + Math.sin(now * 0.022) * 0.012;
    const radius = clamp(wall.w * 0.056, 17, 30);
    const halo = ctx.createRadialGradient(source.x, source.y, 0, source.x, source.y, radius * 4.8);
    halo.addColorStop(0, `rgba(255, 245, 218, ${0.78 * flicker})`);
    halo.addColorStop(0.13, `rgba(255, 205, 134, ${0.42 * flicker})`);
    halo.addColorStop(0.42, "rgba(229, 137, 67, 0.12)");
    halo.addColorStop(1, "rgba(200, 99, 43, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(source.x, source.y, radius * 4.8, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = `rgba(255, 239, 199, ${0.88 * flicker})`;
    ctx.beginPath();
    ctx.arc(source.x, source.y, radius * 0.24, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 215, 153, 0.46)";
    ctx.beginPath();
    ctx.arc(source.x, source.y, radius, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(240, 200, 142, 0.15)";
    ctx.beginPath();
    ctx.arc(source.x, source.y, radius * 1.4, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 221, 162, 0.82)";
    for (let i = 0; i < 4; i += 1) {
      const angle = i * Math.PI / 2 + Math.PI / 4;
      ctx.fillRect(
        source.x + Math.cos(angle) * radius * 1.55 - 1,
        source.y + Math.sin(angle) * radius * 1.55 - 1,
        2,
        2,
      );
    }
    ctx.fillStyle = "rgba(216, 187, 147, 0.62)";
    ctx.font = "7px Atelier Sans, sans-serif";
    ctx.fillText("LIGHT", source.x - radius, source.y + radius * 2.05);
    ctx.strokeStyle = "rgba(238, 204, 161, 0.12)";
    ctx.beginPath();
    ctx.setLineDash([3, 5]);
    ctx.moveTo(source.x, source.y + radius + 10);
    ctx.lineTo(source.x, wall.bottom + 5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawLabels(ctx, layout, state, scene) {
    const { wall, width, height } = layout;
    ctx.save();
    ctx.fillStyle = "rgba(207, 184, 151, 0.32)";
    ctx.font = "8px Atelier Sans, sans-serif";
    ctx.fillText("PROJECTION CHAMBER · 4 LAYERS", wall.x + 1, height - 7);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(218, 191, 151, 0.42)";
    ctx.fillText(scene.english, width - 9, height - 7);

    ctx.textAlign = "left";
    const plaqueX = wall.x + 5;
    const plaqueY = wall.bottom + 7;
    ctx.fillStyle = "rgba(222, 199, 163, 0.26)";
    ctx.fillRect(plaqueX, plaqueY, 40, 12);
    ctx.fillStyle = "rgba(18, 13, 10, 0.72)";
    ctx.font = "7px Atelier Sans, sans-serif";
    ctx.fillText(scene.accent, plaqueX + 5, plaqueY + 8);

    if (state.light.distance < 31) {
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(244, 139, 94, 0.72)";
      ctx.font = "7px Atelier Sans, sans-serif";
      ctx.fillText("EDGE OVEREXPOSURE", wall.right - 7, wall.y + 14);
    }
    ctx.restore();
  }

  measure(state, scene, time) {
    const maskWidth = this.maskCanvas.width;
    const maskHeight = this.maskCanvas.height;
    const layout = this.getLayout(state, maskWidth, maskHeight);
    const ctx = this.maskCtx;
    const counts = new Uint8Array(maskWidth * maskHeight);
    let activeLayers = 0;

    for (let index = 0; index < scene.layers.length; index += 1) {
      const transform = this.projectionTransform(layout, state, index, time);
      if (transform.opacity < 0.08) continue;
      activeLayers += 1;
      ctx.clearRect(0, 0, maskWidth, maskHeight);
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#fff";
      ctx.translate(transform.x, transform.y);
      ctx.rotate(transform.angle);
      const maskUnit = transform.unit * (maskWidth / this.width);
      ctx.scale(maskUnit, maskUnit);
      scene.layers[index].draw(ctx);
      ctx.restore();
      const pixels = ctx.getImageData(0, 0, maskWidth, maskHeight).data;
      for (let offset = 3, pixel = 0; offset < pixels.length; offset += 4, pixel += 1) {
        if (pixels[offset] > 24) counts[pixel] += 1;
      }
    }

    let union = 0;
    let shared = 0;
    let triple = 0;
    for (let i = 0; i < counts.length; i += 1) {
      if (counts[i] > 0) union += 1;
      if (counts[i] > 1) shared += 1;
      if (counts[i] > 2) triple += 1;
    }
    const overlapRatio = union > 0 ? shared / union : 0;
    const densityRatio = union / (maskWidth * maskHeight);
    const spacingPenalty = Math.max(0, (
      state.spacings.reduce((sum, value) => sum + value, 0) / 4 - 78
    ) * 0.38);
    const silhouette = Math.round(clamp(
      100 - overlapRatio * 116 - densityRatio * 26 - spacingPenalty,
      8,
      98,
    ));
    const burn = Math.round(clamp((31 - state.light.distance) / 19 * 100, 0, 100));
    const exposure = 100 - burn;
    return {
      silhouette,
      overlap: Math.round(overlapRatio * 100),
      density: Math.round(densityRatio * 100),
      exposure,
      burn,
      activeLayers,
      triple: Math.round(triple / Math.max(union, 1) * 100),
    };
  }

  toBlob() {
    return new Promise((resolve) => this.canvas.toBlob(resolve, "image/png"));
  }
}
