import { DURATION, evaluateLayer, normalizeTime } from "./model.js";

const MONO = '"Ubuntu Mono", "DejaVu Sans Mono", monospace';
const DISPLAY = '"Ubuntu Sans", "DejaVu Sans", sans-serif';

function rgba(hex, alpha = 1) {
  const clean = String(hex).replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((character) => character + character).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  const number = Number.parseInt(value, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function setFont(ctx, weight, size, family = DISPLAY, spacing = "0px") {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.letterSpacing = spacing;
}

function drawBackdrop(ctx, time) {
  ctx.fillStyle = "#0e0e0f";
  ctx.fillRect(0, 0, 1080, 1350);

  const glow = ctx.createRadialGradient(760, 505, 30, 760, 505, 770);
  glow.addColorStop(0, "rgba(255, 92, 53, 0.075)");
  glow.addColorStop(0.6, "rgba(255, 92, 53, 0.018)");
  glow.addColorStop(1, "rgba(255, 92, 53, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1080, 1350);

  ctx.save();
  ctx.strokeStyle = "rgba(238, 235, 225, 0.055)";
  ctx.lineWidth = 1;
  for (let x = 72; x < 1080; x += 72) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, 1350);
    ctx.stroke();
  }
  for (let y = 90; y < 1350; y += 90) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(1080, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();

  const sweep = ((time / DURATION) * 1460) - 300;
  const sweepGlow = ctx.createLinearGradient(sweep - 90, 0, sweep + 90, 0);
  sweepGlow.addColorStop(0, "rgba(255,255,255,0)");
  sweepGlow.addColorStop(0.5, "rgba(255,255,255,0.025)");
  sweepGlow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sweepGlow;
  ctx.fillRect(sweep - 90, 0, 180, 1350);

  ctx.save();
  ctx.translate(0, 0);
  ctx.fillStyle = "rgba(242, 238, 227, 0.72)";
  setFont(ctx, 500, 17, MONO, "2px");
  ctx.fillText("PULSE / MOTION POSTER 012", 62, 64);
  ctx.textAlign = "right";
  ctx.fillText("31.2304° N / 121.4737° E", 1018, 64);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(242, 238, 227, 0.32)";
  setFont(ctx, 400, 13, MONO, "1.2px");
  ctx.fillText("A TWELVE SECOND AUDIOVISUAL LOOP", 62, 88);
  ctx.textAlign = "right";
  ctx.fillText("EDITION 01 / 2026", 1018, 88);
  ctx.textAlign = "left";
  ctx.restore();
}

function drawGeometryLayer(ctx, layer, time) {
  if (!layer.visible) return;
  const value = evaluateLayer(layer, time);
  const color = value.color;
  const beatPhase = (time * 2) % 1;
  const beat = Math.exp(-beatPhase * 8.5);
  const drift = Math.sin((time / DURATION) * Math.PI * 2);

  ctx.save();
  ctx.globalAlpha = value.opacity;
  ctx.translate(value.position.x, value.position.y);

  ctx.save();
  ctx.translate(792, 428);
  ctx.scale(1 + beat * 0.024, 1 + beat * 0.024);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 306, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = rgba(color, 0.42);
  ctx.lineWidth = 2;
  for (let ring = 0; ring < 3; ring += 1) {
    const radius = 338 + ring * 30 + beat * (10 + ring * 5);
    ctx.globalAlpha = value.opacity * (0.44 - ring * 0.11);
    ctx.beginPath();
    ctx.arc(792, 428, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(674, 860);
  ctx.rotate(-0.205 + drift * 0.015);
  ctx.fillStyle = rgba(color, 0.16);
  ctx.fillRect(-180, -54, 660, 108);
  ctx.strokeStyle = rgba(color, 0.72);
  ctx.lineWidth = 2;
  ctx.strokeRect(-180, -54, 660, 108);
  ctx.restore();

  ctx.save();
  ctx.translate(792, 428);
  ctx.rotate((time / DURATION) * Math.PI * 0.35);
  ctx.strokeStyle = rgba("#0e0e0f", 0.65);
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(0, 0, 210, -0.45, 0.62);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 210, Math.PI - 0.2, Math.PI + 0.72);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(74, 1002 + drift * 8);
  ctx.fillStyle = rgba(color, 0.95);
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      if ((row + column) % 2 === 0) {
        ctx.fillRect(column * 31, row * 31, 27, 27);
      }
    }
  }
  ctx.restore();

  ctx.save();
  ctx.translate(991, 95);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = rgba("#f2eee3", 0.54);
  setFont(ctx, 500, 14, MONO, "1.5px");
  ctx.fillText("FREQUENCY / FORM / MOTION / 120 BPM", 0, 0);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = rgba("#f2eee3", 0.18);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(62, 960);
  ctx.lineTo(410, 960);
  ctx.stroke();
  ctx.fillStyle = rgba("#f2eee3", 0.62);
  setFont(ctx, 500, 12, MONO, "1.6px");
  ctx.fillText("SUB / BASS / LOOP", 62, 944);
  ctx.restore();

  ctx.restore();
}

function drawTitleLayer(ctx, layer, time) {
  if (!layer.visible) return;
  const value = evaluateLayer(layer, time);
  const color = value.color;
  const titlePulse = Math.exp(-(((time * 2) % 1) * 10));

  ctx.save();
  ctx.globalAlpha = value.opacity;
  ctx.translate(value.position.x, value.position.y);

  ctx.fillStyle = rgba("#f2eee3", 0.64);
  setFont(ctx, 600, 17, MONO, "3.1px");
  ctx.fillText("SOUND / MOTION / AFTER DARK", 66, 265);

  ctx.fillStyle = rgba(color, 0.9);
  ctx.fillRect(66, 288, 104 + titlePulse * 36, 5);
  ctx.fillStyle = rgba("#f2eee3", 0.22);
  setFont(ctx, 400, 12, MONO, "1.1px");
  ctx.fillText("01 — 24 / LIVE TRANSMISSION", 66, 318);

  ctx.save();
  ctx.translate(47, 0);
  ctx.fillStyle = color;
  setFont(ctx, 900, 224, DISPLAY, "-9px");
  ctx.fillText("NIGHT", 0, 582);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.strokeText("SIGNAL", 0, 792);
  ctx.globalAlpha *= 0.16;
  ctx.fillStyle = "#0e0e0f";
  ctx.fillRect(0, 812, 884, 4);
  ctx.restore();

  ctx.save();
  ctx.translate(66, 850);
  ctx.fillStyle = rgba("#f2eee3", 0.6);
  setFont(ctx, 500, 14, MONO, "1.7px");
  ctx.fillText("AN AUDIOVISUAL LOOP IN THREE MOVEMENTS", 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(66, 907);
  ctx.strokeStyle = rgba(color, 0.85);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 18);
  ctx.lineTo(240 + titlePulse * 24, 18);
  ctx.stroke();
  ctx.fillStyle = rgba(color, 0.95);
  ctx.beginPath();
  ctx.moveTo(254 + titlePulse * 24, 11);
  ctx.lineTo(276 + titlePulse * 24, 18);
  ctx.lineTo(254 + titlePulse * 24, 25);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

function drawInfoLayer(ctx, layer, time) {
  if (!layer.visible) return;
  const value = evaluateLayer(layer, time);
  const color = value.color;
  const barcodeOffset = Math.floor(normalizeTime(time) * 2) % 3;

  ctx.save();
  ctx.globalAlpha = value.opacity;
  ctx.translate(value.position.x, value.position.y);

  ctx.strokeStyle = rgba(color, 0.48);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(64, 1084);
  ctx.lineTo(1016, 1084);
  ctx.stroke();

  ctx.fillStyle = rgba(color, 0.9);
  setFont(ctx, 700, 15, MONO, "2.6px");
  ctx.fillText("21—22 NOV 2026", 64, 1127);
  ctx.fillStyle = rgba("#f2eee3", 0.34);
  ctx.fillText("EAST BUND / SHANGHAI", 64, 1152);

  ctx.fillStyle = color;
  setFont(ctx, 800, 49, DISPLAY, "-1.4px");
  ctx.fillText("PULSE FESTIVAL", 64, 1210);

  ctx.fillStyle = rgba("#f2eee3", 0.8);
  setFont(ctx, 500, 18, MONO, "0.8px");
  ctx.fillText("DOORS 21:00  /  LIVE 22:00", 66, 1251);
  ctx.fillStyle = rgba("#f2eee3", 0.35);
  setFont(ctx, 400, 13, MONO, "1.1px");
  ctx.fillText("LIMITED CAPACITY · 18+ · ONE NIGHT ONLY", 66, 1281);

  ctx.save();
  ctx.translate(876, 1103);
  ctx.fillStyle = rgba(color, 0.9);
  const widths = [8, 3, 12, 4, 7, 2, 10, 5, 3, 11, 6, 2, 9, 4, 12, 3, 8, 2, 6, 10, 4, 8, 3, 11];
  let cursor = barcodeOffset * 2;
  widths.forEach((width, index) => {
    if (index % 2 === 0) {
      ctx.fillRect(cursor, 0, width, 76);
    }
    cursor += width + 4;
  });
  ctx.restore();

  ctx.fillStyle = rgba(color, 0.96);
  setFont(ctx, 700, 24, MONO, "1.1px");
  ctx.textAlign = "right";
  ctx.fillText("12 SEC", 1016, 1202);
  ctx.fillStyle = rgba("#f2eee3", 0.46);
  setFont(ctx, 400, 11, MONO, "1.2px");
  ctx.fillText("1080 × 1350 / 30 FPS", 1016, 1224);
  ctx.fillText("AUDIO: SUB BASS / 120 BPM", 1016, 1243);
  ctx.fillText("LOOP: SEAMLESS", 1016, 1262);
  ctx.textAlign = "left";

  ctx.restore();
}

export function drawPoster(canvas, project, time, options = {}) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const current = Number(time) || 0;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  drawBackdrop(ctx, current);

  const ordered = [...project.layers].sort((a, b) => {
    if (a.kind === "shapes") return -1;
    if (b.kind === "shapes") return 1;
    if (a.kind === "info") return 1;
    if (b.kind === "info") return -1;
    return 0;
  });

  ordered.forEach((layer) => {
    if (layer.kind === "shapes") drawGeometryLayer(ctx, layer, current);
    if (layer.kind === "title") drawTitleLayer(ctx, layer, current);
    if (layer.kind === "info") drawInfoLayer(ctx, layer, current);
  });

  if (options.showSafeFrame) {
    ctx.strokeStyle = "rgba(255, 92, 53, 0.55)";
    ctx.setLineDash([9, 9]);
    ctx.strokeRect(59, 74, 962, 1202);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

export function renderThumbnail(canvas, project, time = 2.4) {
  drawPoster(canvas, project, time);
}
