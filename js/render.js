// Canvas 渲染：齿轮系统 / 擒纵机构 / 指针面板 三层
import {
  GEARS, MESHES, LAYER, ESCAPEMENT, DIAL,
  pitchRadius, gearById, meshTeeth,
} from './data.js';

const TWO_PI = Math.PI * 2;

export function createView(canvas) {
  return { canvas, ctx: canvas.getContext('2d'), scale: 1, ox: 0, oy: 0 };
}

// 依据全部零件包围盒自动缩放居中
export function fitView(view) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const g of GEARS) {
    const r = pitchRadius(Math.max(g.wheel, g.pinion)) + 14;
    minX = Math.min(minX, g.x - r); maxX = Math.max(maxX, g.x + r);
    minY = Math.min(minY, g.y - r); maxY = Math.max(maxY, g.y + r);
  }
  const esc = gearById('escape');
  minY = Math.min(minY, esc.y + ESCAPEMENT.anchorPivot.dy - 30);
  maxY = Math.max(maxY, esc.y + ESCAPEMENT.pendulumLen + 30);
  minX = Math.min(minX, DIAL.cx - DIAL.radius); maxX = Math.max(maxX, DIAL.cx + DIAL.radius);
  minY = Math.min(minY, DIAL.cy - DIAL.radius);
  const { canvas } = view;
  view.scale = Math.min(canvas.width / (maxX - minX), canvas.height / (maxY - minY)) * 0.94;
  view.ox = canvas.width / 2 - ((minX + maxX) / 2) * view.scale;
  view.oy = canvas.height / 2 - ((minY + maxY) / 2) * view.scale;
}

export function toWorld(view, px, py) {
  return { x: (px - view.ox) / view.scale, y: (py - view.oy) / view.scale };
}

export function render(view, sim, phases, layers, selectedId) {
  const { ctx, canvas } = view;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);
  if (layers[LAYER.GEAR]) drawGearLayer(ctx, sim, phases, selectedId);
  if (layers[LAYER.ESC]) drawEscapement(ctx, sim, selectedId);
  if (layers[LAYER.DIAL]) drawDial(ctx, sim);
  ctx.restore();
}

function drawGearLayer(ctx, sim, phases, selectedId) {
  for (const m of MESHES) {
    const ga = gearById(m.a);
    const gb = gearById(m.b);
    ctx.strokeStyle = 'rgba(80, 160, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ga.x, ga.y);
    ctx.lineTo(gb.x, gb.y);
    ctx.stroke();
    const ra = pitchRadius(meshTeeth(m, 'a'));
    const d = Math.hypot(gb.x - ga.x, gb.y - ga.y);
    const t = ra / d;
    ctx.fillStyle = 'rgba(120, 200, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(ga.x + (gb.x - ga.x) * t, ga.y + (gb.y - ga.y) * t, 4, 0, TWO_PI);
    ctx.fill();
  }
  for (const g of GEARS) {
    if (g.layer !== LAYER.GEAR) continue;
    const angle = (sim.angles[g.id] || 0) + (phases[g.id] || 0);
    const fill = g.id === 'hour' ? '#6d7a92' : null;
    if (g.wheel > 0) drawGear(ctx, g.x, g.y, g.wheel, angle, g.id === selectedId, false, fill);
    if (g.pinion > 0) drawGear(ctx, g.x, g.y, g.pinion, angle, g.id === selectedId, true);
  }
}

// 梯形齿齿轮
function drawGear(ctx, x, y, teeth, angle, selected, isPinion, fillOverride) {
  const r = pitchRadius(teeth);
  const rOut = r + (isPinion ? 6 : 8);
  const rIn = r - (isPinion ? 4 : 6);
  const pitch = TWO_PI / teeth;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = i * pitch;
    const pts = [
      [a0, rIn], [a0 + pitch * 0.18, rOut],
      [a0 + pitch * 0.42, rOut], [a0 + pitch * 0.6, rIn],
    ];
    for (const [a, rr] of pts) {
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0 && a === a0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fillStyle = fillOverride || (isPinion ? '#5a6572' : '#7d8894');
  ctx.strokeStyle = selected ? '#ffd166' : '#39424d';
  ctx.lineWidth = selected ? 3 : 1.2;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.stroke();
  if (!isPinion) {
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(6, rIn * 0.18), 0, TWO_PI);
    ctx.fillStyle = '#4a545f';
    ctx.fill();
    ctx.strokeStyle = '#2c333d';
    ctx.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
      ctx.lineTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
      ctx.stroke();
    }
  }
  ctx.restore();
  if (selected) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.5)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, rOut + 6, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }
}

// 擒纵机构层：锯齿擒纵轮 + 锚式擒纵叉 + 摆锤
function drawEscapement(ctx, sim, selectedId) {
  const esc = gearById('escape');
  const px = esc.x + ESCAPEMENT.anchorPivot.dx;
  const py = esc.y + ESCAPEMENT.anchorPivot.dy;
  const T = ESCAPEMENT.beatPeriod;
  const swing = ESCAPEMENT.amplitude * sim.ramp *
    Math.sin((TWO_PI * sim.time) / (2 * T));

  // 摆杆 + 摆锤（画在擒纵轮后面）
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(swing);
  ctx.strokeStyle = selectedId === 'pendulum' ? '#ffd166' : '#8b96a2';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, ESCAPEMENT.pendulumLen);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, ESCAPEMENT.pendulumLen, 22, 0, TWO_PI);
  ctx.fillStyle = '#b08d4f';
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 擒纵轮（锯齿）
  const teeth = 30;
  const r = pitchRadius(teeth);
  const angle = (sim.angles.escape || 0);
  ctx.save();
  ctx.translate(esc.x, esc.y);
  ctx.rotate(angle);
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i * TWO_PI) / teeth;
    const a1 = a0 + (TWO_PI / teeth) * 0.35;
    const a2 = a0 + (TWO_PI / teeth) * 0.9;
    const p = (a, rr) => [Math.cos(a) * rr, Math.sin(a) * rr];
    const [x0, y0] = p(a0, r - 8);
    const [x1, y1] = p(a1, r + 10);
    const [x2, y2] = p(a2, r - 8);
    if (i === 0) ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.closePath();
  ctx.fillStyle = '#b08d4f';
  ctx.strokeStyle = selectedId === 'escape' ? '#ffd166' : '#5d4a26';
  ctx.lineWidth = selectedId === 'escape' ? 3 : 1.2;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, TWO_PI);
  ctx.fillStyle = '#4a545f';
  ctx.fill();
  ctx.restore();

  // 擒纵叉（锚）：支点两臂连接左右叉瓦，随摆动插入轮齿
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(swing * 0.7);
  const span = ESCAPEMENT.anchorSpan;
  ctx.strokeStyle = selectedId === 'anchor' ? '#ffd166' : '#9aa7b4';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-span / 2, 96);
  ctx.moveTo(0, 0);
  ctx.lineTo(span / 2, 96);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, 34, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  // 左右叉瓦
  ctx.fillStyle = '#c0564f';
  ctx.save();
  ctx.translate(-span / 2, 96);
  ctx.rotate(0.5);
  ctx.fillRect(-7, -4, 14, 22);
  ctx.restore();
  ctx.save();
  ctx.translate(span / 2, 96);
  ctx.rotate(-0.5);
  ctx.fillRect(-7, -4, 14, 22);
  ctx.restore();
  ctx.restore();

  // 支点
  ctx.fillStyle = '#6b7684';
  ctx.beginPath();
  ctx.arc(px, py, 6, 0, TWO_PI);
  ctx.fill();
}

// 指针面板层：半透明表盘 + 时分针 + 秒针小盘
function drawDial(ctx, sim) {
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.beginPath();
  ctx.arc(DIAL.cx, DIAL.cy, DIAL.radius, 0, TWO_PI);
  ctx.fillStyle = '#20262e';
  ctx.fill();
  ctx.strokeStyle = '#4a545f';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = 1;
  for (let i = 0; i < 12; i++) {
    const a = (i * TWO_PI) / 12 - Math.PI / 2;
    const r1 = DIAL.radius - 16;
    ctx.strokeStyle = '#9fb7d4';
    ctx.lineWidth = i % 3 === 0 ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(DIAL.cx + Math.cos(a) * r1, DIAL.cy + Math.sin(a) * r1);
    ctx.lineTo(DIAL.cx + Math.cos(a) * (DIAL.radius - 4), DIAL.cy + Math.sin(a) * (DIAL.radius - 4));
    ctx.stroke();
  }
  drawHand(ctx, DIAL.cx, DIAL.cy, sim.angles.hour || 0, 82, 7, '#d8dee6');
  drawHand(ctx, DIAL.cx, DIAL.cy, sim.angles.minute || 0, 128, 5, '#9fb7d4');
  ctx.beginPath();
  ctx.arc(DIAL.cx, DIAL.cy, 7, 0, TWO_PI);
  ctx.fillStyle = '#d8dee6';
  ctx.fill();

  // 秒针小盘
  ctx.beginPath();
  ctx.arc(DIAL.secondCx, DIAL.secondCy, DIAL.secondR, 0, TWO_PI);
  ctx.fillStyle = 'rgba(32, 38, 46, 0.85)';
  ctx.fill();
  ctx.strokeStyle = '#4a545f';
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i * TWO_PI) / 12 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(DIAL.secondCx + Math.cos(a) * (DIAL.secondR - 9), DIAL.secondCy + Math.sin(a) * (DIAL.secondR - 9));
    ctx.lineTo(DIAL.secondCx + Math.cos(a) * (DIAL.secondR - 3), DIAL.secondCy + Math.sin(a) * (DIAL.secondR - 3));
    ctx.stroke();
  }
  drawHand(ctx, DIAL.secondCx, DIAL.secondCy, sim.angles.fourth || 0, 48, 2.5, '#ff7b72');
  ctx.restore();
}

function drawHand(ctx, x, y, angle, len, width, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-width, 8);
  ctx.lineTo(0, -len);
  ctx.lineTo(width, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
