// Canvas 矢量渲染：固定场景（风车、转轮、水车泵、渠道、三层高程田块）
import { CONFIG, FIELDS } from './engine.js';

const COLORS = {
  sky: '#cfe6f2',
  ground: '#d9c08f',
  hill: '#b8c98a',
  tower: '#8a6f4d',
  blade: '#f4f1e8',
  bladeEdge: '#5b6b73',
  water: '#4aa3d6',
  pipe: '#7d8a94',
  field: ['#cfe8a9', '#b5d684', '#9cc466'],
  wet: '#3f7fbf',
  gate: '#c25b4e',
  text: '#27333a',
  alarm: '#d8452f',
};

export function drawScene(ctx, state, width, height) {
  ctx.clearRect(0, 0, width, height);
  drawSky(ctx, width, height, state);
  drawFields(ctx, width, height, state);
  drawChannels(ctx, width, height, state);
  drawWindmill(ctx, width, height, state);
  drawPumpHouse(ctx, width, height, state);
  drawHud(ctx, width, height, state);
  if (state.alarmActive) drawAlarmFlash(ctx, width, height);
}

function drawSky(ctx, w, h, state) {
  const g = ctx.createLinearGradient(0, 0, 0, h * 0.6);
  g.addColorStop(0, '#a9d2ea');
  g.addColorStop(1, COLORS.sky);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h * 0.62);
  // 风羽飘带：随风速变化
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const y = 36 + i * 22;
    const len = 24 + state.wind * 6;
    ctx.beginPath();
    ctx.moveTo(28, y);
    ctx.quadraticCurveTo(28 + len * 0.5, y - 6, 28 + len, y);
    ctx.stroke();
  }
}

function fieldRects(w, h) {
  const baseY = h * 0.82;
  const fw = w * 0.17;
  const gap = w * 0.035;
  const startX = w * 0.42;
  return FIELDS.map((f, i) => {
    const top = baseY - f.elevation * 16 - 70;
    return {
      x: startX + i * (fw + gap),
      y: top,
      w: fw,
      h: baseY - top,
      field: f,
    };
  });
}

function drawFields(ctx, w, h, state) {
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  const rects = fieldRects(w, h);
  for (const r of rects) {
    const i = r.field.id;
    ctx.fillStyle = COLORS.field[i];
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#6d7b46';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    // 土壤湿度：蓝色从底部浸润
    const wetH = (state.moisture[i] / 100) * r.h;
    ctx.fillStyle = COLORS.wet;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(r.x, r.y + r.h - wetH, r.w, wetH);
    ctx.globalAlpha = 1;
    // 湿度阈值刻度线
    const ty = r.y + r.h * (1 - CONFIG.targetMoisture / 100);
    ctx.strokeStyle = COLORS.alarm;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(r.x, ty);
    ctx.lineTo(r.x + r.w, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.text;
    ctx.font = '13px sans-serif';
    ctx.fillText(
      `${r.field.name} 高程${r.field.elevation}m`,
      r.x,
      r.y - 8
    );
    ctx.fillText(`${state.moisture[i].toFixed(0)}%`, r.x + 6, r.y + 16);
  }
}

function drawChannels(ctx, w, h, state) {
  const rects = fieldRects(w, h);
  const pumpX = w * 0.3;
  const pumpY = h * 0.74;
  ctx.lineWidth = 7;
  ctx.strokeStyle = COLORS.pipe;
  ctx.beginPath();
  ctx.moveTo(pumpX, pumpY);
  ctx.lineTo(rects[0].x - 14, pumpY);
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const r = rects[i];
    const branchX = r.x - 14;
    ctx.strokeStyle = COLORS.pipe;
    ctx.beginPath();
    ctx.moveTo(branchX, pumpY);
    ctx.lineTo(branchX, r.y + 10);
    ctx.lineTo(r.x, r.y + 10);
    ctx.stroke();
    // 渠中水流：流量越大蓝色越实、动画越快
    const flow = state.flow[i];
    if (flow > 0.02) {
      ctx.strokeStyle = COLORS.water;
      ctx.lineWidth = 3 + Math.min(4, flow);
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -((state.t * 60 * Math.min(1, flow / 3)) % 18);
      ctx.beginPath();
      ctx.moveTo(branchX, pumpY);
      ctx.lineTo(branchX, r.y + 10);
      ctx.lineTo(r.x, r.y + 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 7;
    }
    drawGate(ctx, branchX, pumpY - 26, state.gate[i], i);
  }
}

function drawGate(ctx, x, y, open, index) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#6b4a3d';
  ctx.fillRect(-3, 0, 6, 26);
  // 闸板随开度上提
  const lift = open * 16;
  ctx.fillStyle = COLORS.gate;
  ctx.fillRect(-10, 8 - lift, 20, 6);
  ctx.strokeStyle = '#7c2f26';
  ctx.strokeRect(-10, 8 - lift, 20, 6);
  ctx.fillStyle = COLORS.text;
  ctx.font = '11px sans-serif';
  ctx.fillText(`闸${index + 1} ${(open * 100).toFixed(0)}%`, -16, 28);
  ctx.restore();
}

function drawWindmill(ctx, w, h, state) {
  const cx = w * 0.16;
  const cy = h * 0.3;
  // 塔架
  ctx.strokeStyle = COLORS.tower;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx - 26, h * 0.78);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + 26, h * 0.78);
  ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 1; i < 5; i++) {
    const y = cy + ((h * 0.78 - cy) * i) / 5;
    const half = 6 + i * 4.5;
    ctx.beginPath();
    ctx.moveTo(cx - half, y);
    ctx.lineTo(cx + half, y);
    ctx.stroke();
  }
  // 转轮（泵速驱动旋转角）
  const angle = state.rotorAngle || 0;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const blades = 8;
  for (let i = 0; i < blades; i++) {
    ctx.rotate((Math.PI * 2) / blades);
    ctx.save();
    ctx.translate(0, -6);
    ctx.rotate(state.pitch * 0.6); // 迎角可视化
    ctx.fillStyle = COLORS.blade;
    ctx.strokeStyle = COLORS.bladeEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(5, 0);
    ctx.lineTo(9, -46);
    ctx.lineTo(-2, -46);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  ctx.fillStyle = COLORS.bladeEdge;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawPumpHouse(ctx, w, h, state) {
  const x = w * 0.3 - 34;
  const y = h * 0.66;
  ctx.fillStyle = '#cbb79a';
  ctx.fillRect(x, y, 68, 48);
  ctx.strokeStyle = '#8a7355';
  ctx.strokeRect(x, y, 68, 48);
  ctx.fillStyle = '#8a6f4d';
  ctx.beginPath();
  ctx.moveTo(x - 6, y);
  ctx.lineTo(x + 34, y - 22);
  ctx.lineTo(x + 74, y);
  ctx.closePath();
  ctx.fill();
  // 水车转轮
  ctx.save();
  ctx.translate(x + 34, y + 24);
  ctx.rotate((state.rotorAngle || 0) * 0.8);
  ctx.strokeStyle = '#5b6b73';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -15);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHud(ctx, w, h, state) {
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fillRect(12, h - 92, 330, 80);
  ctx.strokeStyle = '#9aa8b0';
  ctx.strokeRect(12, h - 92, 330, 80);
  ctx.fillStyle = COLORS.text;
  ctx.font = '13px sans-serif';
  const lines = [
    `时间 ${state.t.toFixed(1)} / ${CONFIG.duration}s   风速 ${state.wind.toFixed(1)} m/s`,
    `迎角 ${((state.pitch * 180) / Math.PI).toFixed(0)}°   转速 ${state.pumpSpeed.toFixed(1)} rad/s`,
    `泵压 ${state.pressure.toFixed(1)}m ${state.overPressure ? '⚠偏高' : ''}  峰值 ${state.peakTransient.toFixed(1)}m`,
    `耗水 ${state.totalPumped.toFixed(1)} / ${CONFIG.budgetLitres} L`,
  ];
  lines.forEach((line, i) => ctx.fillText(line, 22, h - 72 + i * 18));
}

function drawAlarmFlash(ctx, w, h) {
  ctx.fillStyle = `rgba(216,69,47,${0.18 + 0.12 * Math.sin(performance.now() / 90)})`;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = COLORS.alarm;
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('⚠ 水锤报警 Water Hammer', w / 2 - 150, 48);
}
