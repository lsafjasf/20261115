// Canvas 绘制：固定轨道传感器位置、原始/校准曲线、校准点与重放游标。

export function setupHiDpi(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth;
  const cssHeight = Number(canvas.getAttribute('height')) || 300;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: cssWidth, height: cssHeight };
}

// 轨道俯视图：直线轨道 + 三个传感器节点
export function drawTrack(canvas, sensors, positions, selectedId = null) {
  const { ctx, width, height } = setupHiDpi(canvas);
  ctx.clearRect(0, 0, width, height);

  const padX = 48;
  const trackY = height * 0.45;
  const minPos = 0;
  const maxPos = 60;
  const xOf = (pos) => padX + ((pos - minPos) / (maxPos - minPos)) * (width - padX * 2);

  // 轨道
  ctx.strokeStyle = '#3a475a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(padX, trackY);
  ctx.lineTo(width - padX, trackY);
  ctx.stroke();

  // 刻度
  ctx.fillStyle = '#7d8aa0';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  for (let p = 0; p <= 60; p += 10) {
    const x = xOf(p);
    ctx.strokeStyle = '#2a3647';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, trackY - 8);
    ctx.lineTo(x, trackY + 8);
    ctx.stroke();
    ctx.fillText(`${p}m`, x, trackY + 26);
  }

  // 传感器节点
  sensors.forEach((sensor, i) => {
    const x = xOf(positions[i]);
    const active = sensor.id === selectedId;
    ctx.beginPath();
    ctx.arc(x, trackY, active ? 12 : 9, 0, Math.PI * 2);
    ctx.fillStyle = sensor.color;
    ctx.fill();
    ctx.strokeStyle = active ? '#ffffff' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = active ? 3 : 1.5;
    ctx.stroke();
    ctx.fillStyle = '#e6ebf2';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(sensor.id, x, trackY - 18);
  });
}

function drawSeries(ctx, points, color, dashed, lineWidth = 1.6) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  if (dashed) ctx.setLineDash([5, 5]);
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

// 主曲线图：真值、三路原始（虚线）、三路校准（实线）、校准点、重放游标
export function drawChart(canvas, view) {
  const { ctx, width, height } = setupHiDpi(canvas);
  const {
    time,
    truth,
    series,
    points,
    replayIndex,
    xRange
  } = view;
  ctx.clearRect(0, 0, width, height);

  const padL = 52;
  const padR = 18;
  const padT = 16;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const [i0, i1] = xRange;
  const t0 = time[i0];
  const t1 = time[Math.max(i1, i0 + 1)];
  const allValues = truth.slice(i0, i1 + 1);
  series.forEach((s) => allValues.push(...s.raw.slice(i0, i1 + 1), ...s.calibrated.slice(i0, i1 + 1)));
  let yMin = Math.min(...allValues);
  let yMax = Math.max(...allValues);
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;

  const xOf = (t) => padL + ((t - t0) / (t1 - t0)) * plotW;
  const yOf = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // 网格与 Y 轴标签
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  const gridCount = 6;
  for (let g = 0; g <= gridCount; g += 1) {
    const value = yMin + ((yMax - yMin) * g) / gridCount;
    const y = yOf(value);
    ctx.strokeStyle = '#1c2634';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(width - padR, y);
    ctx.stroke();
    ctx.fillStyle = '#7d8aa0';
    ctx.fillText(value.toFixed(1), padL - 8, y + 4);
  }

  // X 轴时间标签（分钟）
  ctx.textAlign = 'center';
  const tickCount = 6;
  for (let g = 0; g <= tickCount; g += 1) {
    const t = t0 + ((t1 - t0) * g) / tickCount;
    const x = xOf(t);
    ctx.strokeStyle = '#1c2634';
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, height - padB);
    ctx.stroke();
    ctx.fillStyle = '#7d8aa0';
    ctx.fillText(`${t.toFixed(0)}min`, x, height - padB + 18);
  }

  // 校准点竖线
  points.forEach((p) => {
    if (p.index < i0 || p.index > i1) return;
    const x = xOf(time[p.index]);
    ctx.strokeStyle = 'rgba(120, 140, 170, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, height - padB);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#9fb0c8';
    ctx.beginPath();
    ctx.arc(x, yOf(p.reference), 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  const range = (arr) => arr.slice(i0, replayIndex >= 0 ? Math.min(i1, replayIndex) + 1 : i1 + 1)
    .map((v, k) => [xOf(time[i0 + k]), yOf(v)]);

  // 原始读数（淡虚线）
  series.forEach((s) => drawSeries(ctx, range(s.raw), s.color, true, 1.2));
  // 真值（黑底白线粗线，在深色背景用浅色）
  drawSeries(ctx, range(truth), '#f2f5f9', false, 2.4);
  // 校准曲线（实线）
  series.forEach((s) => drawSeries(ctx, range(s.calibrated), s.color, false, 1.8));

  // 重放游标
  if (replayIndex >= 0 && replayIndex >= i0 && replayIndex <= i1) {
    const x = xOf(time[replayIndex]);
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, height - padB);
    ctx.stroke();
  }

  return { xOf, yOf, padL, padR, plotW, t0, t1 };
}

// 把画布像素坐标换算成样本下标
export function canvasToIndex(canvas, geometry, time, xRange, clientX) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const [i0, i1] = xRange;
  const ratio = (x - geometry.padL) / geometry.plotW;
  const t = geometry.t0 + ratio * (geometry.t1 - geometry.t0);
  let nearest = i0;
  let best = Infinity;
  for (let i = i0; i <= i1; i += 1) {
    const d = Math.abs(time[i] - t);
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  return nearest;
}
