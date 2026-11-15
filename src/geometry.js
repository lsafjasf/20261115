export function objectBounds(object, textMetrics = null) {
  if (object.type === "rect") {
    return {
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height
    };
  }
  if (object.type === "circle") {
    return {
      x: object.x - object.r,
      y: object.y - object.r,
      width: object.r * 2,
      height: object.r * 2
    };
  }
  if (object.type === "path") {
    const xs = object.points.map((point) => point.x);
    const ys = object.points.map((point) => point.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys))
    };
  }
  const width = textMetrics?.width ?? Math.max(20, object.text.length * object.fontSize * 0.54);
  const height = textMetrics?.height ?? Math.max(object.fontSize, object.text.split("\n").length * object.fontSize * 1.22);
  let x = object.x;
  if (object.align === "center") x -= width / 2;
  if (object.align === "right") x -= width;
  return { x, y: object.y, width, height };
}

export function gradientLine(bounds, angle) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const halfSpan = (Math.abs(dx) * bounds.width + Math.abs(dy) * bounds.height) / 2;
  return {
    x1: cx - dx * halfSpan,
    y1: cy - dy * halfSpan,
    x2: cx + dx * halfSpan,
    y2: cy + dy * halfSpan
  };
}

export function pointInBounds(point, bounds, padding = 0) {
  return (
    point.x >= bounds.x - padding &&
    point.x <= bounds.x + bounds.width + padding &&
    point.y >= bounds.y - padding &&
    point.y <= bounds.y + bounds.height + padding
  );
}

export function pathToData(object) {
  if (!object.points.length) return "";
  const parts = [`M ${round(object.points[0].x)} ${round(object.points[0].y)}`];
  for (let index = 1; index < object.points.length; index += 1) {
    parts.push(`L ${round(object.points[index].x)} ${round(object.points[index].y)}`);
  }
  if (object.closed) parts.push("Z");
  return parts.join(" ");
}

export function round(value) {
  return Math.round(value * 1000) / 1000;
}
