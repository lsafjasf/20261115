// Canvas rendering: gauges and time-series charts. All draw calls are guarded so
// malformed data can never take the page down.

const ALARM_COLOR = { ok: '#16a34a', warning: '#d97706', critical: '#dc2626', error: '#991b1b', missing: '#7c3aed' };

function safeContext(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  try {
    return canvas.getContext('2d');
  } catch (error) {
    return null;
  }
}

function fitCanvas(canvas, ctx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width || canvas.width || 300);
  const height = Math.max(1, rect.height || canvas.height || 180);
  const targetW = Math.round(width * dpr);
  const targetH = Math.round(height * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

export function drawGauge(canvas, sensor) {
  const ctx = safeContext(canvas);
  if (!ctx || !sensor) return;
  let size;
  try {
    size = fitCanvas(canvas, ctx);
  } catch (error) {
    return;
  }
  const { width, height } = size;
  const meta = sensor.meta;
  const cx = width / 2;
  const cy = height * 0.62;
  const radius = Math.min(width, height * 1.35) * 0.36;
  const start = Math.PI * 0.75;
  const end = Math.PI * 2.25;

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';

  // Track arc
  const grad = ctx.createLinearGradient(0, height, width, 0);
  grad.addColorStop(0, '#1e3a8a');
  grad.addColorStop(1, '#38bdf8');
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.lineWidth = Math.max(8, radius * 0.16);
  ctx.strokeStyle = grad;
  ctx.stroke();

  // Warning / critical zone arcs
  const span = end - start;
  const toAngle = (value) => start + span * ((value - meta.range[0]) / (meta.range[1] - meta.range[0]));
  zoneArc(ctx, cx, cy, radius, toAngle(meta.warn[0]), toAngle(meta.warn[1]), 'rgba(217,119,6,0.55)');
  zoneArc(ctx, cx, cy, radius, toAngle(meta.warn[1]), end, 'rgba(220,38,38,0.6)');

  // Tick marks
  for (let i = 0; i <= 10; i += 1) {
    const angle = start + (span * i) / 10;
    const inner = radius * 0.82;
    const outer = radius * 0.98;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#94a3b8';
    ctx.stroke();
  }

  // Needle
  const value = sensor.latest ? sensor.latest.value : null;
  ctx.save();
  if (Number.isFinite(value)) {
    const clamped = Math.min(meta.range[1], Math.max(meta.range[0], value));
    const angle = toAngle(clamped);
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-radius * 0.12, 0);
    ctx.lineTo(radius * 0.82, -2);
    ctx.lineTo(radius * 0.82, 2);
    ctx.closePath();
    ctx.fillStyle = ALARM_COLOR[sensor.alarm] || '#0f172a';
    ctx.fill();
  }
  ctx.restore();

  // Hub
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = '#0f172a';
  ctx.fill();

  // Digital readout
  ctx.textAlign = 'center';
  ctx.font = '600 20px system-ui, sans-serif';
  ctx.fillStyle = Number.isFinite(value) ? '#0f172a' : '#7c3aed';
  const readout = Number.isFinite(value) ? `${value} ${meta.unit}` : sensor.missingStreak ? `缺失 ×${sensor.missingStreak}` : '--';
  ctx.fillText(readout, cx, height - 14);

  // Alarm badge
  const alarmColor = ALARM_COLOR[sensor.alarm] || ALARM_COLOR.ok;
  roundedRect(ctx, 8, 8, width - 16, 22, 6);
  ctx.fillStyle = alarmColor;
  ctx.fill();
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  const badges = [];
  if (sensor.spikeActive) badges.push('尖峰');
  if (sensor.delayActive) badges.push(`延迟${sensor.delayBuffer.length ? `(${sensor.delayBuffer.length})` : ''}`);
  if (sensor.outOfOrderActive) badges.push('乱序');
  if (sensor.missingStreak) badges.push(`缺失${sensor.missingStreak}`);
  ctx.fillText(`${meta.name} · ${alarmText(sensor.alarm)}${badges.length ? ' · ' + badges.join('/') : ''}`, cx, 23);
}

function zoneArc(ctx, cx, cy, radius, a0, a1, color) {
  if (!(a1 > a0)) return;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, a0, a1);
  ctx.lineWidth = Math.max(8, radius * 0.16);
  ctx.strokeStyle = color;
  ctx.stroke();
}

function alarmText(level) {
  return { ok: '正常', warning: '预警', critical: '严重', error: '越界', missing: '数据缺失' }[level] || level;
}

export function drawChart(canvas, sensor) {
  const ctx = safeContext(canvas);
  if (!ctx || !sensor) return;
  let size;
  try {
    size = fitCanvas(canvas, ctx);
  } catch (error) {
    return;
  }
  const { width, height } = size;
  const meta = sensor.meta;
  const padding = { left: 44, right: 12, top: 14, bottom: 24 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  ctx.clearRect(0, 0, width, height);

  // Grid + threshold lines
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (plotH * i) / 4;
    const value = meta.range[1] - ((meta.range[1] - meta.range[0]) * i) / 4;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.fillText(Math.round(value), padding.left - 6, y + 3);
  }
  thresholdLine(ctx, padding, plotW, plotH, meta, meta.warn[0], '#d97706');
  thresholdLine(ctx, padding, plotW, plotH, meta, meta.warn[1], '#dc2626');

  const points = (sensor.series || []).filter((point) => Number.isFinite(point.value) && Number.isFinite(point.ts));
  if (points.length < 2) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('等待数据…', width / 2, height / 2);
    return;
  }

  const minTs = points[0].ts;
  const maxTs = Math.max(...points.map((point) => point.ts), minTs + 1);
  const x = (ts) => padding.left + plotW * ((ts - minTs) / Math.max(1, maxTs - minTs));
  const y = (value) => padding.top + plotH * (1 - (value - meta.range[0]) / (meta.range[1] - meta.range[0]));

  // Line
  ctx.beginPath();
  points.forEach((point, index) => {
    const px = x(point.ts);
    const py = y(point.value);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = '#0369a1';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Markers: spikes (red diamond), out-of-order (purple square)
  for (const point of points) {
    const px = x(point.ts);
    const py = y(point.value);
    if (point.isSpike) diamond(ctx, px, py, '#dc2626');
    if (point.outOfOrder) square(ctx, px, py, '#7c3aed');
  }

  // Missing-sample gaps shown as hatched background blocks
  let gap = sensor.missingStreak || 0;
  if (gap > 0) {
    ctx.fillStyle = 'rgba(124,58,237,0.12)';
    const blockW = Math.min(40, plotW * 0.15);
    ctx.fillRect(width - padding.right - blockW, padding.top, blockW, plotH);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#334155';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`${meta.name}时序 (${meta.unit})`, padding.left, height - 8);
}

function thresholdLine(ctx, padding, plotW, plotH, meta, value, color) {
  const y = padding.top + plotH * (1 - (value - meta.range[0]) / (meta.range[1] - meta.range[0]));
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(padding.left, y);
  ctx.lineTo(padding.left + plotW, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function diamond(ctx, x, y, color) {
  ctx.beginPath();
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x + 4, y);
  ctx.lineTo(x, y + 4);
  ctx.lineTo(x - 4, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function square(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
