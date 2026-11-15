// Minimal 2D vector helpers. Vectors are plain {x, y} objects.

export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
// 2D cross of scalar with vector: s x v
export const crossSV = (s, v) => ({ x: -s * v.y, y: s * v.x });
export const len = (a) => Math.hypot(a.x, a.y);
export const lenSq = (a) => a.x * a.x + a.y * a.y;

export function normalize(a) {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

// Rotate vector by angle (radians).
export function rotate(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function closestPointOnSegment(p, a, b) {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / Math.max(lenSq(ab), 1e-12), 0, 1);
  return add(a, scale(ab, t));
}

// Perpendicular of a unit direction.
export const perp = (v) => ({ x: -v.y, y: v.x });
