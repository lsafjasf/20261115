import { gradientLine, objectBounds, pathToData } from "./geometry.js";

export function fontString(object) {
  return `${object.fontWeight || 400} ${object.fontSize}px ${object.fontFamily || "sans-serif"}`;
}

export function textMetrics(ctx, object) {
  ctx.save();
  ctx.font = fontString(object);
  const lines = object.text.split("\n");
  const widths = lines.map((line) => ctx.measureText(line).width);
  const lineHeight = object.fontSize * 1.22;
  const width = Math.max(1, ...widths);
  const height = Math.max(object.fontSize, lines.length * lineHeight);
  ctx.restore();
  return {
    lines,
    widths,
    lineHeight,
    width,
    height,
    bounds: objectBounds(object, { width, height })
  };
}

function paintStyle(ctx, paint, bounds) {
  if (!paint) return null;
  if (paint.type === "solid") return paint.color;
  const line = gradientLine(bounds, paint.angle);
  const gradient = ctx.createLinearGradient(line.x1, line.y1, line.x2, line.y2);
  paint.stops
    .slice()
    .sort((left, right) => left.offset - right.offset)
    .forEach((stop) => gradient.addColorStop(stop.offset, stop.color));
  return gradient;
}

function roundedRectPath(ctx, object) {
  const radius = Math.min(object.radius || 0, object.width / 2, object.height / 2);
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(object.x, object.y, object.width, object.height, radius);
    return;
  }
  ctx.moveTo(object.x + radius, object.y);
  ctx.lineTo(object.x + object.width - radius, object.y);
  ctx.quadraticCurveTo(object.x + object.width, object.y, object.x + object.width, object.y + radius);
  ctx.lineTo(object.x + object.width, object.y + object.height - radius);
  ctx.quadraticCurveTo(
    object.x + object.width,
    object.y + object.height,
    object.x + object.width - radius,
    object.y + object.height
  );
  ctx.lineTo(object.x + radius, object.y + object.height);
  ctx.quadraticCurveTo(object.x, object.y + object.height, object.x, object.y + object.height - radius);
  ctx.lineTo(object.x, object.y + radius);
  ctx.quadraticCurveTo(object.x, object.y, object.x + radius, object.y);
  ctx.closePath();
}

function drawPath(ctx, object, bounds) {
  ctx.beginPath();
  object.points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (object.closed) ctx.closePath();
  const fill = paintStyle(ctx, object.fill, bounds);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (object.stroke?.width > 0) {
    ctx.strokeStyle = object.stroke.color;
    ctx.lineWidth = object.stroke.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
}

function drawText(ctx, object, bounds) {
  const metrics = textMetrics(ctx, object);
  ctx.font = fontString(object);
  ctx.textAlign = object.align;
  ctx.textBaseline = "top";
  const fill = paintStyle(ctx, object.fill, bounds);
  metrics.lines.forEach((line, index) => {
    const y = object.y + index * metrics.lineHeight;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillText(line, object.x, y);
    }
    if (object.stroke?.width > 0) {
      ctx.strokeStyle = object.stroke.color;
      ctx.lineWidth = object.stroke.width;
      ctx.strokeText(line, object.x, y);
    }
  });
}

export function drawObject(ctx, object, options = {}) {
  ctx.save();
  ctx.globalAlpha = options.opacity ?? object.opacity ?? 1;
  const metrics = object.type === "text" ? textMetrics(ctx, object) : null;
  const bounds = metrics?.bounds || objectBounds(object);
  const fill = paintStyle(ctx, object.fill, bounds);

  if (object.type === "rect") {
    roundedRectPath(ctx, object);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (object.stroke?.width > 0) {
      ctx.strokeStyle = object.stroke.color;
      ctx.lineWidth = object.stroke.width;
      ctx.stroke();
    }
  } else if (object.type === "circle") {
    ctx.beginPath();
    ctx.arc(object.x, object.y, object.r, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (object.stroke?.width > 0) {
      ctx.strokeStyle = object.stroke.color;
      ctx.lineWidth = object.stroke.width;
      ctx.stroke();
    }
  } else if (object.type === "path") {
    drawPath(ctx, object, bounds);
  } else {
    drawText(ctx, object, bounds);
  }
  ctx.restore();
}

function drawSelection(ctx, object, metrics) {
  const bounds = metrics?.bounds || objectBounds(object);
  const padding = 4;
  const x = bounds.x - padding;
  const y = bounds.y - padding;
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;

  ctx.save();
  ctx.strokeStyle = "#5b5bd6";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);

  const handles = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
    [x + width / 2, y],
    [x + width, y + height / 2],
    [x + width / 2, y + height],
    [x, y + height / 2]
  ];
  handles.forEach(([handleX, handleY]) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(handleX - 3, handleY - 3, 6, 6);
    ctx.strokeStyle = "#5b5bd6";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(handleX - 3, handleY - 3, 6, 6);
  });

  const label = object.name || object.type;
  ctx.font = "600 10px 'Avenir Next', 'Segoe UI', sans-serif";
  const labelWidth = ctx.measureText(label).width + 14;
  const labelY = y > 19 ? y - 18 : y + 8;
  ctx.fillStyle = "#5b5bd6";
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, labelY, labelWidth, 17, 4);
    ctx.fill();
  } else {
    ctx.fillRect(x, labelY, labelWidth, 17);
  }
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 7, labelY + 8.5);
  ctx.restore();
}

export function drawScene(ctx, scene, options = {}) {
  const width = scene.canvas.width;
  const height = scene.canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = scene.canvas.background;
  ctx.fillRect(0, 0, width, height);

  scene.objects.forEach((object) => drawObject(ctx, object));

  if (options.selectedId) {
    const selected = scene.objects.find((object) => object.id === options.selectedId);
    if (selected) {
      const metrics = selected.type === "text" ? textMetrics(ctx, selected) : null;
      drawSelection(ctx, selected, metrics);
    }
  }
}

export function hitTest(ctx, scene, point) {
  for (let index = scene.objects.length - 1; index >= 0; index -= 1) {
    const object = scene.objects[index];
    if (object.type === "path") {
      if (pointNearPath(object, point, 8)) return object;
      continue;
    }
    const metrics = object.type === "text" ? textMetrics(ctx, object) : null;
    const bounds = metrics?.bounds || objectBounds(object);
    if (
      point.x >= bounds.x - 4 &&
      point.x <= bounds.x + bounds.width + 4 &&
      point.y >= bounds.y - 4 &&
      point.y <= bounds.y + bounds.height + 4
    ) {
      return object;
    }
  }
  return null;
}

function pointNearPath(object, point, threshold) {
  const points = object.closed ? [...object.points, object.points[0]] : object.points;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    const distance = Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
    if (distance <= threshold + (object.stroke?.width || 0) / 2) return true;
  }
  return false;
}

export function pathPreview(object) {
  return pathToData(object);
}
