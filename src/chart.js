import { PX_PER_M, CONFIG } from "./physics.js";

export function drawTelemetryChart(ctx, frames, width = 720, height = 200) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0a1220";
  ctx.fillRect(0, 0, width, height);

  const pad = { left: 46, right: 46, top: 18, bottom: 28 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxSpeed = Math.max(2, ...frames.map((f) => f.speed / PX_PER_M));
  const maxTension = Math.max(CONFIG.maxTension, ...frames.map((f) => f.tension));

  ctx.strokeStyle = "#22344f";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  drawLine(ctx, frames, pad, plotW, plotH, (f) => f.speed / PX_PER_M, maxSpeed, "#57c7ff", "速度 m/s");
  drawLine(ctx, frames, pad, plotW, plotH, (f) => f.tension, maxTension, "#ffb35c", "张力 N");

  ctx.strokeStyle = "rgba(255,107,107,0.7)";
  const ratedY = pad.top + plotH * (1 - CONFIG.maxTension / maxTension);
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(pad.left, ratedY);
  ctx.lineTo(width - pad.right, ratedY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#ff9b9b";
  ctx.font = "11px sans-serif";
  ctx.fillText(`额定 ${CONFIG.maxTension}N`, width - pad.right - 90, ratedY - 4);

  ctx.fillStyle = "#8fa6c6";
  ctx.font = "11px sans-serif";
  ctx.fillText("时间 →", width / 2 - 16, height - 8);
  ctx.fillStyle = "#57c7ff";
  ctx.fillText("● 速度", pad.left, 12);
  ctx.fillStyle = "#ffb35c";
  ctx.fillText("● 张力", pad.left + 70, 12);
}

function drawLine(ctx, frames, pad, plotW, plotH, valueOf, max, color) {
  if (frames.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  frames.forEach((frame, i) => {
    const x = pad.left + (plotW * i) / (frames.length - 1);
    const y = pad.top + plotH * (1 - valueOf(frame) / max);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

export function drawBrakeCurve(ctx, curve, width = 300, height = 140, dragIndex = -1) {
  const pad = { left: 34, right: 12, top: 14, bottom: 26 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxV = Math.max(3, ...curve.map((p) => p.v));

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0e1726";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#243757";
  ctx.strokeRect(pad.left, pad.top, plotW, plotH);

  ctx.strokeStyle = "#7fd0ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  curve.forEach((point, i) => {
    const x = pad.left + (plotW * point.v) / maxV;
    const y = pad.top + plotH * (1 - point.b);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  curve.forEach((point, i) => {
    const x = pad.left + (plotW * point.v) / maxV;
    const y = pad.top + plotH * (1 - point.b);
    ctx.fillStyle = i === dragIndex ? "#ffe08a" : "#ffb35c";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#8fa6c6";
  ctx.font = "10px sans-serif";
  ctx.fillText("摆速 rad/s", width / 2 - 28, height - 8);
  ctx.save();
  ctx.translate(12, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("刹车", -12, 0);
  ctx.restore();
}

export function pointFromEvent(event, canvas, curve) {
  const rect = canvas.getBoundingClientRect();
  const pad = { left: 34, right: 12, top: 14, bottom: 26 };
  const plotW = canvas.width - pad.left - pad.right;
  const plotH = canvas.height - pad.top - pad.bottom;
  const maxV = Math.max(3, ...curve.map((p) => p.v));
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  const v = Math.max(0, Math.min(maxV, ((x - pad.left) / plotW) * maxV));
  const b = Math.max(0, Math.min(1, 1 - (y - pad.top) / plotH));
  return { v, b };
}
