import { isStarVisible } from './core.js';
import { constellationCenter, hasEdge, isConstellationInRange } from './project.js';

// Draw one frame. `ctx` is a CanvasRenderingContext2D in the browser, or any
// object recording the same calls in tests. All geometry is derived from the
// camera so lines stay attached to their stars at any zoom/pan level.
export function renderScene(ctx, {
  stars,
  constellations,
  camera,
  magnitudeThreshold,
  selectedConstellationId = null,
  hoveredStarId = null,
  width,
  height,
  dpr = 1,
}) {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, width, height);

  const visibleStars = new Set();
  for (const star of stars) {
    if (isStarVisible(star, magnitudeThreshold)) visibleStars.add(star.id);
  }

  const active = constellations.filter((c) =>
    isConstellationInRange(c, magnitudeThreshold));

  // Constellation lines first, then stars on top.
  for (const constellation of active) {
    const isSelected = constellation.id === selectedConstellationId;
    ctx.strokeStyle = constellation.color;
    ctx.lineWidth = isSelected ? 2 : 1.2;
    ctx.globalAlpha = isSelected ? 0.95 : 0.6;
    for (const [aId, bId] of constellation.edges) {
      const a = stars.find((s) => s.id === aId);
      const b = stars.find((s) => s.id === bId);
      if (!a || !b) continue;
      const p1 = camera.worldToScreen(a.x, a.y);
      const p2 = camera.worldToScreen(b.x, b.y);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Stars. Annotation membership is shown with a coloured ring even when the
  // star itself is faint; threshold changes hide stars but never annotations.
  for (const star of stars) {
    if (!visibleStars.has(star.id)) continue;
    const point = camera.worldToScreen(star.x, star.y);
    if (point.x < -20 || point.x > width + 20 || point.y < -20 || point.y > height + 20) {
      continue;
    }
    const radius = starRadius(star, camera.scale);
    const owner = active.find((c) => c.starIds.includes(star.id));
    if (owner) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = owner.color;
      ctx.lineWidth = owner.id === selectedConstellationId ? 2 : 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = star.id === hoveredStarId ? '#ffffff' : brightnessColor(star.magnitude);
    ctx.fill();
  }

  // Name labels sit at the constellation centroid, transformed like everything
  // else so they move with the stars instead of jumping under zoom.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const constellation of active) {
    const center = constellationCenter(constellation, stars);
    if (!center) continue;
    const point = camera.worldToScreen(center.x, center.y);
    const fontSize = clampFont(13 * Math.sqrt(camera.scale));
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    const label = constellation.name;
    const metrics = ctx.measureText ? ctx.measureText(label) : { width: label.length * fontSize * 0.6 };
    const padding = 6;
    ctx.fillStyle = 'rgba(5, 7, 15, 0.72)';
    ctx.fillRect(
      point.x - metrics.width / 2 - padding,
      point.y - fontSize / 2 - padding,
      metrics.width + padding * 2,
      fontSize + padding * 2,
    );
    ctx.fillStyle = constellation.color;
    ctx.fillText(label, point.x, point.y);
  }
  ctx.restore();
}

export function starRadius(star, scale) {
  // Brighter stars (small magnitude) draw larger.
  const base = clamp(4.2 - star.magnitude * 0.45, 0.8, 5);
  return clamp(base * (0.7 + 0.3 * Math.sqrt(scale)), 0.6, 9);
}

function brightnessColor(magnitude) {
  if (magnitude <= 0) return '#eaf2ff';
  if (magnitude <= 2.5) return '#cdd9ec';
  if (magnitude <= 4.5) return '#9fb0c8';
  return '#6f7f99';
}

function clampFont(size) {
  return Math.min(28, Math.max(9, size));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Re-export for app/tests convenience.
export { hasEdge };
