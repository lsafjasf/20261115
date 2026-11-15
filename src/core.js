// Pure, DOM-free domain logic. Safe to import from Node tests and the browser.

export const FORMAT_VERSION = 1;

// Deterministic PRNG (mulberry32). The whole star field is regenerated from a
// seed, so saved projects never need to embed thousands of star records.
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate stars in a square world of `worldSize` units centred on the origin.
// Magnitude follows an astronomical-like distribution: many more dim stars
// than bright ones. Range [-1.5, 7.0]; smaller numbers are brighter.
export function generateStars({ seed = 42, count = 1400, worldSize = 2000 } = {}) {
  const rand = mulberry32(seed);
  const half = worldSize / 2;
  const stars = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const x = (rand() * 2 - 1) * half;
    const y = (rand() * 2 - 1) * half;
    // Cube the uniform sample so faint stars dominate.
    const magnitude = -1.5 + Math.pow(rand(), 1 / 3) * 8.5;
    stars[i] = { id: `s${i}`, x, y, magnitude: Number(magnitude.toFixed(3)) };
  }
  return stars;
}

export function findStar(stars, id) {
  return stars.find((star) => star.id === id) || null;
}

// A star is shown at a given global magnitude threshold when it is at least
// as bright as the threshold (magnitude <= threshold).
export function isStarVisible(star, magnitudeThreshold) {
  return star.magnitude <= magnitudeThreshold;
}

// ---- Camera: converts between world units and CSS pixels -------------------

export class Camera {
  constructor({ x = 0, y = 0, scale = 1, viewWidth = 800, viewHeight = 600 } = {}) {
    this.x = x; // world coordinate at the viewport centre
    this.y = y;
    this.scale = scale; // pixels per world unit
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
  }

 worldToScreen(worldX, worldY) {
    return {
      x: (worldX - this.x) * this.scale + this.viewWidth / 2,
      y: (worldY - this.y) * this.scale + this.viewHeight / 2,
    };
  }

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.viewWidth / 2) / this.scale + this.x,
      y: (screenY - this.viewHeight / 2) / this.scale + this.y,
    };
  }

  pan(dxPixels, dyPixels) {
    this.x -= dxPixels / this.scale;
    this.y -= dyPixels / this.scale;
  }

  // Zoom while keeping the world point under `screenX/screenY` fixed.
  zoomAt(screenX, screenY, factor) {
    const before = this.screenToWorld(screenX, screenY);
    this.scale = clamp(this.scale * factor, 0.08, 12);
    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  toJSON() {
    return { x: this.x, y: this.y, scale: this.scale };
  }

  static fromJSON(json, viewWidth, viewHeight) {
    return new Camera({
      x: json?.x ?? 0,
      y: json?.y ?? 0,
      scale: json?.scale ?? 1,
      viewWidth,
      viewHeight,
    });
  }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Pick the nearest star within `tolerance` world units of a world point.
export function pickStar(stars, worldX, worldY, tolerance = 14) {
  let best = null;
  let bestDistance = tolerance;
  for (const star of stars) {
    const distance = Math.hypot(star.x - worldX, star.y - worldY);
    if (distance <= bestDistance) {
      best = star;
      bestDistance = distance;
    }
  }
  return best;
}
