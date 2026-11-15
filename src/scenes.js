const TAU = Math.PI * 2;

export const SCENE_META = {
  a: { name: "SCENE A", color: "#ffb09f", badge: "#ffb09f" },
  b: { name: "SCENE B", color: "#83d9ff", badge: "#83d9ff" },
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawBadge(ctx, x, y, text, accent) {
  ctx.save();
  ctx.font = '600 12px "SFMono-Regular", Consolas, monospace';
  const width = Math.ceil(ctx.measureText(text).width) + 18;
  roundRect(ctx, x, y, width, 25, 4);
  ctx.fillStyle = "rgba(5, 10, 20, 0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 9, y + 13);
  ctx.restore();
}

function drawGrain(ctx, width, height, time, amount = 0.035) {
  ctx.save();
  ctx.globalAlpha = amount;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 48; i += 1) {
    const x = ((i * 97 + time * 11) % width + width) % width;
    const y = ((i * 53 + time * 7) % height + height) % height;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

export function drawSceneA(ctx, time, width, height) {
  const t = Math.max(0, time);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#361127");
  bg.addColorStop(0.48, "#74243a");
  bg.addColorStop(1, "#c9533f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(
    width * (0.68 + Math.sin(t * 0.42) * 0.08),
    height * (0.35 + Math.cos(t * 0.34) * 0.06),
    0,
    width * 0.68,
    height * 0.35,
    width * 0.46,
  );
  glow.addColorStop(0, "rgba(255, 190, 146, 0.28)");
  glow.addColorStop(1, "rgba(255, 190, 146, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.58;
  for (let band = 0; band < 5; band += 1) {
    const base = height * (0.2 + band * 0.16);
    ctx.beginPath();
    for (let x = -20; x <= width + 20; x += 12) {
      const wave =
        Math.sin(x * 0.011 + t * (0.55 + band * 0.06) + band) * height * 0.035 +
        Math.cos(x * 0.024 - t * 0.3 + band * 1.7) * height * 0.016;
      const y = base + wave;
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(width + 20, height);
    ctx.lineTo(-20, height);
    ctx.closePath();
    ctx.fillStyle =
      band % 2 === 0 ? "rgba(255, 163, 123, 0.11)" : "rgba(44, 8, 32, 0.16)";
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  const cols = 6;
  const rows = 4;
  const cellW = width / cols;
  const cellH = height / rows;
  ctx.lineWidth = Math.max(1.2, width * 0.0017);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const phase = t * (0.52 + (row + col) * 0.025) + col * 0.55 + row * 0.9;
      const x = (col + 0.5) * cellW + Math.sin(phase) * cellW * 0.12;
      const y = (row + 0.5) * cellH + Math.cos(phase * 0.8) * cellH * 0.12;
      const size = Math.min(cellW, cellH) * (0.22 + 0.035 * Math.sin(phase * 1.4));
      const rotation = phase * 0.42 + Math.PI * 0.5;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.88, size * 0.65);
      ctx.lineTo(-size * 0.88, size * 0.65);
      ctx.closePath();
      ctx.strokeStyle = `rgba(255, 189, 160, ${0.23 + 0.12 * Math.sin(phase)})`;
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();

  const orbX = width * (0.5 + Math.sin(t * 0.38) * 0.18);
  const orbY = height * (0.44 + Math.cos(t * 0.31) * 0.16);
  const orb = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, width * 0.08);
  orb.addColorStop(0, "rgba(255, 242, 218, 0.95)");
  orb.addColorStop(0.16, "rgba(255, 204, 148, 0.55)");
  orb.addColorStop(1, "rgba(255, 173, 121, 0)");
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, width, height);

  drawGrain(ctx, width, height, t);
  drawBadge(ctx, 14, 14, `SCENE A   localT=${t.toFixed(2)}s`, SCENE_META.a.badge);
  ctx.restore();
}

export function drawSceneB(ctx, time, width, height) {
  const t = Math.max(0, time);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  const bg = ctx.createLinearGradient(width, 0, 0, height);
  bg.addColorStop(0, "#07172f");
  bg.addColorStop(0.48, "#153f72");
  bg.addColorStop(1, "#43a4d1");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const auroraX = width * (0.3 + Math.sin(t * 0.5) * 0.12);
  const aurora = ctx.createRadialGradient(
    auroraX,
    height * 0.4,
    0,
    auroraX,
    height * 0.4,
    width * 0.54,
  );
  aurora.addColorStop(0, "rgba(92, 224, 255, 0.25)");
  aurora.addColorStop(1, "rgba(92, 224, 255, 0)");
  ctx.fillStyle = aurora;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  for (let band = 0; band < 4; band += 1) {
    ctx.beginPath();
    const baseY = height * (0.5 + band * 0.11);
    for (let x = -20; x <= width + 20; x += 14) {
      const y =
        baseY +
        Math.sin(x * 0.008 - t * 0.62 + band * 1.15) * height * 0.045 +
        Math.cos(x * 0.022 + t * 0.35) * height * 0.012;
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(144, 226, 255, ${0.14 - band * 0.018})`;
    ctx.lineWidth = height * 0.038;
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  const cols = 6;
  const rows = 4;
  const cellW = width / cols;
  const cellH = height / rows;
  ctx.lineWidth = Math.max(1.2, width * 0.0016);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const phase = t * (0.6 + col * 0.018) - row * 0.52 + col * 0.76;
      const x = (col + 0.5) * cellW + Math.cos(phase) * cellW * 0.14;
      const y = (row + 0.5) * cellH + Math.sin(phase * 0.7) * cellH * 0.16;
      const size = Math.min(cellW, cellH) * (0.2 + 0.04 * Math.cos(phase));
      const rotation = -phase * 0.5;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.moveTo(-size, -size * 0.8);
      ctx.lineTo(size * 0.94, 0);
      ctx.lineTo(-size, size * 0.8);
      ctx.closePath();
      ctx.strokeStyle = `rgba(146, 226, 255, ${0.2 + 0.13 * Math.cos(phase)})`;
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();

  const pulseX = width * (0.74 + Math.sin(t * 0.7) * 0.06);
  const pulseY = height * (0.23 + Math.cos(t * 0.53) * 0.05);
  const pulseRadius = width * (0.055 + Math.sin(t * 1.2) * 0.008);
  const pulse = ctx.createRadialGradient(
    pulseX,
    pulseY,
    0,
    pulseX,
    pulseY,
    pulseRadius,
  );
  pulse.addColorStop(0, "rgba(235, 255, 255, 0.98)");
  pulse.addColorStop(0.18, "rgba(125, 233, 255, 0.7)");
  pulse.addColorStop(1, "rgba(66, 188, 255, 0)");
  ctx.fillStyle = pulse;
  ctx.fillRect(0, 0, width, height);

  drawGrain(ctx, width, height, t + 10);
  drawBadge(ctx, 14, 14, `SCENE B   localT=${t.toFixed(2)}s`, SCENE_META.b.badge);
  ctx.restore();
}

const SCENE_DRAWERS = {
  a: drawSceneA,
  b: drawSceneB,
};

export function renderScene(ctx, sceneId, time, width, height) {
  const draw = SCENE_DRAWERS[sceneId];
  if (!draw) throw new Error(`Unknown scene: ${sceneId}`);
  draw(ctx, time, width, height);
}
