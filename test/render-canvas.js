/* 像素级渲染验证：用真实 node-canvas 复刻 app.js 的绘制原语，
   确认纸纹、双色网点、套准十字、重影层确实产生对应颜色像素 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('/tmp/canvas-test/node_modules/canvas');
const { createSimulator, CONSTANTS } = require(path.join(__dirname, '..', 'engine'));

const W = 900;
const H = 620;
const SCALE = 0.35;
const RED = [214, 48, 49];
const BLUE = [30, 110, 220];
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

function drawHalftone(color, angle, density, ox, oy, alpha) {
  const spacing = 13;
  const radius = Math.max(0.8, spacing * 0.34 * density);
  ctx.save();
  ctx.translate(W / 2 + ox, H / 2 + oy);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + alpha + ')';
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

function drawCross(px, py, color, alpha, size) {
  const s = size || 26;
  ctx.strokeStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + alpha + ')';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px - s, py); ctx.lineTo(px + s, py);
  ctx.moveTo(px, py - s); ctx.lineTo(px, py + s);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, py, s - 9, 0, Math.PI * 2);
  ctx.stroke();
}

/* 1. 纸纹 */
ctx.fillStyle = '#f2ecdd';
ctx.fillRect(0, 0, W, H);
const paperImg = ctx.getImageData(0, 0, W, H);
const paperSample = paperImg.data.slice(0, 4);

const sim = createSimulator(20261115);
const sheet1 = sim.reprint();
const off1 = { x: sheet1.trueError.x * SCALE, y: sheet1.trueError.y * SCALE };

/* 2. 双色网点（初始错位状态） */
drawHalftone(RED, Math.PI / 12, sheet1.density.red, 0, 0, 0.55);
drawHalftone(BLUE, Math.PI / 2.4, sheet1.density.blue, off1.x, off1.y, 0.55);

/* 3. 套准十字（角标 + 中心） */
const MARGIN = 64;
[
  { x: MARGIN, y: MARGIN },
  { x: W - MARGIN, y: MARGIN },
  { x: W / 2, y: H / 2 },
].forEach(function (pt) {
  drawCross(pt.x, pt.y, RED, 0.95);
  drawCross(pt.x + off1.x, pt.y + off1.y, BLUE, 0.95);
});

/* 4. 过度调整后的重影层 */
sim.applyCorrection({ dx: -420, dy: 260, dRed: 0.3, dBlue: -0.35 });
const sheet2 = sim.reprint();
const off2 = { x: sheet2.trueError.x * SCALE, y: sheet2.trueError.y * SCALE };
const ghost = sim.getState().ghost;
ctx.save();
ctx.globalAlpha = Math.min(0.5, ghost);
drawHalftone(BLUE, Math.PI / 2.4, sheet2.density.blue,
  off2.x + 10 + ghost * 26, off2.y - 8 - ghost * 18, 0.5);
ctx.restore();

const img = ctx.getImageData(0, 0, W, H).data;
let redish = 0;
let blueish = 0;
let paperTone = 0;
for (let i = 0; i < img.length; i += 4) {
  const r = img[i];
  const g = img[i + 1];
  const b = img[i + 2];
  if (r > 120 && r > g + 35 && r > b + 35) redish += 1;
  if (b > 120 && b > r + 30 && b > g + 15) blueish += 1;
  if (r > 225 && g > 215 && b > 190 && Math.abs(r - g) < 25) paperTone += 1;
}

const assert = require('assert');
assert.ok(paperSample[0] > 230 && paperSample[1] > 225, '纸面应为米黄色底');
assert.ok(paperTone > 100000, '纸纹底色调像素占主体（' + paperTone + '）');
assert.ok(redish > 500, '红版网点/套准线产生红色像素（' + redish + '）');
assert.ok(blueish > 500, '蓝版网点/套准线产生蓝色像素（' + blueish + '）');
assert.ok(ghost >= CONSTANTS.GHOST_LIMIT, '过度调整后重影指数超差（' + ghost.toFixed(3) + '）');
assert.ok(Math.abs(off1.x) > 20, '初始套偏在画布上形成可见位移（' + off1.x.toFixed(1) + 'px）');

const outPng = path.join(__dirname, '..', 'artifacts', 'render-sample.png');
fs.writeFileSync(outPng, canvas.toBuffer('image/png'));

console.log(JSON.stringify({
  paperTone,
  redish,
  blueish,
  ghost: +ghost.toFixed(3),
  blueOffsetPx: [+off1.x.toFixed(1), +off1.y.toFixed(1)],
  png: outPng,
}, null, 2));
console.log('像素级渲染验证通过 ✔');
