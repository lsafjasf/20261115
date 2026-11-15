// Deterministic, high-density technical drawing rendered once into an
// offscreen source canvas. The magnifier only ever reads its pixels.

export const SOURCE_WIDTH = 1600;
export const SOURCE_HEIGHT = 1000;

export function createSourceCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = SOURCE_WIDTH;
  canvas.height = SOURCE_HEIGHT;
  drawTechnicalScene(canvas.getContext('2d'));
  return canvas;
}

function label(ctx, text, x, y, size = 10, align = 'left') {
  ctx.font = `${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#1c2733';
  ctx.fillText(text, x, y);
}

function drawGrid(ctx) {
  for (let x = 0; x <= SOURCE_WIDTH; x += 20) {
    ctx.strokeStyle = x % 100 === 0
      ? 'rgba(20,32,45,0.18)'
      : 'rgba(20,32,45,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, SOURCE_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= SOURCE_HEIGHT; y += 20) {
    ctx.strokeStyle = y % 100 === 0
      ? 'rgba(20,32,45,0.18)'
      : 'rgba(20,32,45,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(SOURCE_WIDTH, y + 0.5);
    ctx.stroke();
  }
  // Axis tick labels, always one decimal.
  for (let x = 100; x < SOURCE_WIDTH; x += 100) {
    label(ctx, (x / 10).toFixed(1), x + 3, SOURCE_HEIGHT - 6, 9, 'left');
  }
  for (let y = 100; y < SOURCE_HEIGHT; y += 100) {
    label(ctx, (y / 10).toFixed(1), 6, y - 3, 9);
  }
}

function drawWaves(ctx) {
  const colors = ['#1d6fb8', '#b8341d', '#1d8a4f'];
  colors.forEach((color, k) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = k === 1 ? 0.75 : 1;
    ctx.beginPath();
    for (let x = 60; x <= SOURCE_WIDTH - 60; x += 2) {
      const y = 220 + k * 90
        + Math.sin((x + k * 40) / 55) * (28 - k * 5)
        + Math.cos(x / (23 + k * 7)) * 6;
      if (x === 60) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    label(ctx, `ch.${k + 1}  amp=${(2.8 - k * 0.4).toFixed(1)} mm`, 70, 172 + k * 90, 10);
  });
}

function drawDimension(ctx, x1, y, x2) {
  ctx.strokeStyle = '#33414f';
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  const arrow = (x, dir) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dir * 9, y - 4);
    ctx.lineTo(x + dir * 9, y + 4);
    ctx.closePath();
    ctx.fillStyle = '#33414f';
    ctx.fill();
  };
  arrow(x1, 1);
  arrow(x2, -1);
  for (let x = x1; x <= x2; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x, y + 3);
    ctx.stroke();
  }
  const mid = (x1 + x2) / 2;
  label(ctx, `${((x2 - x1) / 10).toFixed(1)} mm`, mid, y - 8, 10, 'center');
}

function drawBoard(ctx, ox, oy) {
  ctx.strokeStyle = '#0f5e3a';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, 520, 300);
  // Thin PCB traces on sub-pixel offsets, with pads and vias.
  for (let i = 0; i < 9; i++) {
    const ty = oy + 30 + i * 27 + (i % 2) * 0.5;
    ctx.beginPath();
    ctx.moveTo(ox + 20, ty);
    ctx.lineTo(ox + 180 + i * 13, ty);
    ctx.lineTo(ox + 180 + i * 13, ty + 14);
    ctx.lineTo(ox + 500, ty + 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ox + 500, ty + 14, 3.2, 0, Math.PI * 2);
    ctx.stroke();
    label(ctx, `net-${i}_${(0.15 + i * 0.03).toFixed(2)}`, ox + 24, ty - 5, 9);
  }
  for (let i = 0; i < 6; i++) {
    const cx = ox + 60 + i * 80 + 0.3;
    const cy = oy + 260 + 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    label(ctx, `R${i + 1}`, cx, cy + 22, 9, 'center');
    label(ctx, `${(1.2 + i * 0.7).toFixed(1)}k`, cx, cy + 34, 9, 'center');
  }
  label(ctx, 'PCB-REV 4.2  tolerance 0.1', ox + 8, oy - 10, 11);
}

function drawGauges(ctx) {
  const points = [
    { x: 1180.4, y: 620.8, r: 52, name: 'P1' },
    { x: 1360.7, y: 760.2, r: 64, name: 'P2' },
    { x: 1080.1, y: 820.6, r: 38, name: 'P3' },
  ];
  points.forEach((p, i) => {
    ctx.strokeStyle = '#5a2d82';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 0.55, 0.2, Math.PI * 1.6);
    ctx.strokeStyle = '#8a4fc0';
    ctx.stroke();
    // Radial ticks every 15 degrees.
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      const inner = p.r - (a % 45 === 0 ? 9 : 5);
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(rad) * inner, p.y + Math.sin(rad) * inner);
      ctx.lineTo(p.x + Math.cos(rad) * p.r, p.y + Math.sin(rad) * p.r);
      ctx.strokeStyle = '#5a2d82';
      ctx.stroke();
    }
    label(ctx, `${p.name}(${p.x.toFixed(1)},${p.y.toFixed(1)})`, p.x, p.y - p.r - 8, 10, 'center');
    label(ctx, `θ=${(i * 12.5 + 3.4).toFixed(1)}°`, p.x, p.y + 4, 9, 'center');
  });
}

function drawAnnotations(ctx) {
  const notes = [
    [120.3, 720.6, 'load 99.7% · Δt=0.4 ms'],
    [120.3, 748.2, 'jitter 1.3 ns @25.0 °C'],
    [120.3, 775.8, 'gain x3.2, offset -0.6'],
    [120.3, 803.4, 'trace width 0.2 mm (min)'],
    [120.3, 831.0, 'via drill 0.3 mm, ann 0.5'],
    [120.3, 858.6, 'sample 48.0 kHz · 24.0 bit'],
    [120.3, 886.2, 'ref U=3.30 V ±0.1 V'],
  ];
  notes.forEach(([x, y, text], i) => {
    ctx.fillStyle = i % 2 ? '#7a4a00' : '#33414f';
    label(ctx, text, x, y, 10);
  });
  // Hairline diagonal stress lines.
  ctx.strokeStyle = 'rgba(184,52,29,0.85)';
  ctx.lineWidth = 0.75;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.moveTo(700 + i * 41 + 0.3, 620 + 0.7);
    ctx.lineTo(760 + i * 41 + 0.3, 920 + 0.7);
    ctx.stroke();
  }
}

export function drawTechnicalScene(ctx) {
  ctx.fillStyle = '#f6f8fb';
  ctx.fillRect(0, 0, SOURCE_WIDTH, SOURCE_HEIGHT);
  drawGrid(ctx);
  drawWaves(ctx);
  drawDimension(ctx, 120, 560, 640);
  drawDimension(ctx, 760, 560, 1120);
  drawBoard(ctx, 120, 610);
  drawGauges(ctx);
  drawAnnotations(ctx);
  label(ctx, 'HIGH-DENSITY TECHNICAL SHEET · sheet 01 · scale 10.0 px/mm', 120, 48, 13);
}
