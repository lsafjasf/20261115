/* 生成三张典型场景样张：初始套偏 / 过度调整重影 / 达标对齐 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('/tmp/canvas-test/node_modules/canvas');
const { createSimulator } = require(path.join(__dirname, '..', 'engine'));

const W = 900;
const H = 620;
const SCALE = 0.35;
const RED = [214, 48, 49];
const BLUE = [30, 110, 220];
const MARGIN = 64;
const POINTS = [
  { x: MARGIN, y: MARGIN }, { x: W - MARGIN, y: MARGIN },
  { x: MARGIN, y: H - MARGIN }, { x: W - MARGIN, y: H - MARGIN },
  { x: W / 2, y: H / 2 },
];

function halftone(ctx, color, angle, density, ox, oy, alpha) {
  const spacing = 13;
  const radius = Math.max(0.8, spacing * 0.34 * density);
  ctx.save();
  ctx.translate(W / 2 + ox, H / 2 + oy);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(' + color.join(',') + ',' + alpha + ')';
  const span = Math.max(W, H);
  for (let gx = -span; gx <= span; gx += spacing) {
    for (let gy = -span; gy <= span; gy += spacing) {
      ctx.beginPath();
      ctx.arc(gx, gy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function cross(ctx, px, py, color, alpha) {
  ctx.strokeStyle = 'rgba(' + color.join(',') + ',' + alpha + ')';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px - 26, py); ctx.lineTo(px + 26, py);
  ctx.moveTo(px, py - 26); ctx.lineTo(px, py + 26);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, py, 17, 0, Math.PI * 2);
  ctx.stroke();
}

function paper(ctx) {
  ctx.fillStyle = '#f2ecdd';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 200; i += 1) {
    ctx.strokeStyle = Math.random() > 0.5 ? '#8a7a55' : '#ffffff';
    ctx.lineWidth = Math.random() * 1.2;
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + 40, y + 6, x + 90, y - 6, x + 150, y + 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function render(sheet, ghost, warnText) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paper(ctx);
  const off = {
    x: sheet.trueError.x * SCALE,
    y: sheet.trueError.y * SCALE,
  };
  if (ghost >= 0.02) {
    [0, 1, 2].forEach(function (layer) {
      const spread = ghost * (18 + layer * 16);
      const fade = Math.min(0.45, ghost) * (1 - layer * 0.28);
      ctx.save();
      ctx.globalAlpha = fade;
      halftone(ctx, BLUE, Math.PI / 2.4, sheet.density.blue,
        off.x + 8 + spread, off.y - 6 - spread * 0.7, 0.5);
      halftone(ctx, RED, Math.PI / 12, sheet.density.red,
        -(off.x + spread) * 0.4, -(off.y - spread) * 0.4, 0.4);
      ctx.restore();
    });
  }
  halftone(ctx, RED, Math.PI / 12, sheet.density.red, 0, 0, 0.55);
  halftone(ctx, BLUE, Math.PI / 2.4, sheet.density.blue, off.x, off.y, 0.55);
  POINTS.forEach(function (pt) {
    cross(ctx, pt.x, pt.y, RED, 0.95);
    cross(ctx, pt.x + off.x, pt.y + off.y, BLUE, 0.95);
  });
  if (warnText) {
    ctx.fillStyle = 'rgba(138,47,53,0.92)';
    ctx.fillRect(W / 2 - 170, 18, 340, 34);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(warnText, W / 2, 40);
  }
  return canvas;
}

const outDir = path.join(__dirname, '..', 'artifacts');
const sim = createSimulator(20261115);

const s1 = sim.reprint();
fs.writeFileSync(path.join(outDir, 'scene-1-misregister.png'),
  render(s1, 0).toBuffer('image/png'));

sim.applyCorrection({ dx: -420, dy: 260, dRed: 0.3, dBlue: -0.35 });
const s2 = sim.reprint();
fs.writeFileSync(path.join(outDir, 'scene-2-ghost.png'),
  render(s2, sim.getState().ghost, 'GHOSTING OUT OF TOLERANCE - reduce correction').toBuffer('image/png'));

const aligned = createSimulator(7);
aligned.reprint();
let guard = 0;
while (!aligned.getState().complete && guard < 80) {
  guard += 1;
  const sh = aligned.getState().lastSheet;
  if (!sh.qualified) {
    const m = sh.measured;
    const dens = function (v) {
      if (v < 0.85) return +((1 - v) * 0.45).toFixed(3);
      if (v > 1.15) return -+((v - 1) * 0.45).toFixed(3);
      return 0;
    };
    aligned.applyCorrection({
      dx: Math.abs(m.x) > 50 ? -Math.round(m.x * 0.8) : 0,
      dy: Math.abs(m.y) > 50 ? -Math.round(m.y * 0.8) : 0,
      dRed: dens(sh.density.red),
      dBlue: dens(sh.density.blue),
    });
  }
  aligned.reprint();
}
const s3 = aligned.getState().lastSheet;
fs.writeFileSync(path.join(outDir, 'scene-3-aligned.png'),
  render(s3, aligned.getState().ghost).toBuffer('image/png'));

console.log('已生成三张场景样张:');
console.log('  artifacts/scene-1-misregister.png  套偏 X=' +
  s1.trueError.x.toFixed(1) + ' Y=' + s1.trueError.y.toFixed(1));
console.log('  artifacts/scene-2-ghost.png        重影指数=' +
  sim.getState().ghost.toFixed(3));
console.log('  artifacts/scene-3-aligned.png      连续合格=' +
  aligned.getState().streak + ' 套偏 X=' + s3.trueError.x.toFixed(1) +
  ' Y=' + s3.trueError.y.toFixed(1));
