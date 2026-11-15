import { renderLens } from './sampler.js';

const CELL = 380;
const PAD = 24;
const HEADER = 62;
const LENS = 300;

function drawCellHeader(ctx, x, y, width, text, accent) {
  ctx.fillStyle = '#1a222d';
  ctx.fillRect(x, y, width, HEADER);
  ctx.fillStyle = accent;
  ctx.font = '600 14px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const [line1, line2] = text.split('\n');
  ctx.fillText(line1, x + 14, y + 25);
  ctx.fillStyle = '#9fb2c6';
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText(line2, x + 14, y + 47);
}

function drawRim(ctx, cx, cy, r) {
  ctx.strokeStyle = '#33455a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.stroke();
}

export function buildComparisonImage(sourceData, pins, zoom) {
  const canvas = document.createElement('canvas');
  canvas.width = PAD * 3 + CELL * 2;
  canvas.height = PAD * 2 + HEADER + CELL * 2;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#10151c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cols = [
    { mode: 'nearest', title: 'NEAREST NEIGHBOR', accent: '#ffb86b' },
    { mode: 'smooth', title: 'BILINEAR (SMOOTH)', accent: '#7ee0a3' },
  ];
  const rows = [
    { slot: 'A', pin: pins.A },
    { slot: 'B', pin: pins.B },
  ];

  rows.forEach((row, ri) => {
    cols.forEach((col, ci) => {
      const x = PAD + ci * (CELL + PAD);
      const y = PAD + ri * (CELL + HEADER + PAD);

      ctx.fillStyle = '#141c26';
      ctx.fillRect(x, y, CELL, CELL + HEADER);
      const pinText = row.pin
        ? `POINT ${row.slot} (${row.pin.x.toFixed(1)}, ${row.pin.y.toFixed(1)})  zoom ${zoom.toFixed(1)}x`
        : `POINT ${row.slot} NOT PINNED`;
      drawCellHeader(ctx, x, y, CELL, `${pinText}\n${col.title}`, col.accent);

      if (!row.pin) {
        ctx.fillStyle = '#5d6d7e';
        ctx.font = '14px ui-sans-serif, "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('请先固定该观察点', x + CELL / 2, y + HEADER + CELL / 2);
        return;
      }

      const frame = renderLens(sourceData, LENS, {
        center: row.pin,
        zoom,
        mode: col.mode,
      });
      const cellCx = x + CELL / 2;
      const cellCy = y + HEADER + CELL / 2;
      ctx.putImageData(frame, cellCx - LENS / 2, cellCy - LENS / 2);
      drawRim(ctx, cellCx, cellCy, LENS / 2);

      // Center marker consistent with the live lens.
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cellCx - 12, cellCy);
      ctx.lineTo(cellCx + 12, cellCy);
      ctx.moveTo(cellCx, cellCy - 12);
      ctx.lineTo(cellCx, cellCy + 12);
      ctx.stroke();
    });
  });

  return canvas;
}

// Side-by-side comparison of one center point under both sampling modes.
export function buildSideBySide(sourceData, center, zoom) {
  const width = 760;
  const height = 440;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#10151c';
  ctx.fillRect(0, 0, width, height);

  const modes = [
    { mode: 'nearest', title: 'NEAREST (nearest neighbor)', color: '#ffb86b', x: 20 },
    { mode: 'smooth', title: 'BILINEAR (smooth)', color: '#7ee0a3', x: 400 },
  ];
  modes.forEach((m) => {
    ctx.fillStyle = '#1a222d';
    ctx.fillRect(m.x, 16, 340, 408);
    ctx.fillStyle = m.color;
    ctx.font = '600 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(m.title, m.x + 16, 44);
    ctx.fillStyle = '#9fb2c6';
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(
      `center (${center.x.toFixed(1)}, ${center.y.toFixed(1)})  zoom ${zoom.toFixed(1)}x`,
      m.x + 16, 64,
    );
    const frame = renderLens(sourceData, 320, { center, zoom, mode: m.mode });
    const top = 80;
    ctx.putImageData(frame, m.x + 10, top);
    drawRim(ctx, m.x + 10 + 160, top + 160, 160);
  });
  return canvas;
}
