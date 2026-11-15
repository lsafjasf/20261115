// Deterministic procedural heightfield used by every other module.
// World units: x / z range in [-1, 1], heights normalized to [0, 1].

const TERRAIN_SIZE = 2;

// Fixed landmarks so tests can target a known summit and valley.
const PEAKS = [
  { x: -0.55, z: -0.45, amp: 0.42, sigma: 0.2 },
  { x: 0.48, z: -0.28, amp: 0.34, sigma: 0.16 },
  { x: 0.18, z: 0.52, amp: 0.26, sigma: 0.22 },
];

const VALLEYS = [
  { x: -0.12, z: 0.12, amp: -0.34, sigma: 0.24 },
  { x: 0.62, z: 0.42, amp: -0.22, sigma: 0.18 },
];

// Smooth, tileable value noise built from a fixed hash. No RNG state.
function hash2(ix, iz) {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoothstep(x - ix);
  const fz = smoothstep(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fz;
}

// Smooth raw elevation in an arbitrary range; normalized afterwards.
function rawHeight(x, z) {
  let h = 0;
  h += (valueNoise(x * 2.1 + 4, z * 2.1 - 7) - 0.5) * 0.28;
  h += (valueNoise(x * 5.4 - 2, z * 5.4 + 3) - 0.5) * 0.14;
  h += (valueNoise(x * 11.0 + 9, z * 11.0 + 1) - 0.5) * 0.06;
  for (const p of PEAKS) {
    const dx = x - p.x;
    const dz = z - p.z;
    h += p.amp * Math.exp(-(dx * dx + dz * dz) / (2 * p.sigma * p.sigma));
  }
  for (const v of VALLEYS) {
    const dx = x - v.x;
    const dz = z - v.z;
    h += v.amp * Math.exp(-(dx * dx + dz * dz) / (2 * v.sigma * v.sigma));
  }
  return h;
}

// Cache normalization bounds once (pure function of constants).
let cached = null;

function sampleBounds(resolution) {
  if (cached && cached.resolution === resolution) return cached;
  let min = Infinity;
  let max = -Infinity;
  const grid = new Float64Array((resolution + 1) * (resolution + 1));
  for (let j = 0; j <= resolution; j++) {
    for (let i = 0; i <= resolution; i++) {
      const x = -1 + (TERRAIN_SIZE * i) / resolution;
      const z = -1 + (TERRAIN_SIZE * j) / resolution;
      const value = rawHeight(x, z);
      grid[j * (resolution + 1) + i] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  cached = { resolution, grid, min, max };
  return cached;
}

export const TERRAIN_EXTENT = TERRAIN_SIZE;
export { PEAKS, VALLEYS };

// Height in [0, 1] at any world-space (x, z).
export function sampleHeight(x, z) {
  const bounds = sampleBounds(120);
  const value = rawHeight(x, z);
  return (value - bounds.min) / (bounds.max - bounds.min);
}

export function heightBounds() {
  const bounds = sampleBounds(120);
  return { min: 0, max: 1, rawMin: bounds.min, rawMax: bounds.max };
}

// Build the regular grid. rows/cols share the same resolution.
export function buildHeightfield(resolution) {
  const bounds = sampleBounds(resolution);
  const n = resolution + 1;
  const heights = new Float32Array(n * n);
  const span = bounds.max - bounds.min;
  for (let k = 0; k < bounds.grid.length; k++) {
    heights[k] = (bounds.grid[k] - bounds.min) / span;
  }
  return {
    resolution,
    size: TERRAIN_SIZE,
    n,
    heights,
  };
}

export function gridPoint(field, i, j) {
  const x = -1 + (TERRAIN_SIZE * i) / field.resolution;
  const z = -1 + (TERRAIN_SIZE * j) / field.resolution;
  const y = field.heights[j * field.n + i];
  return [x, y, z];
}

export function indexAt(field, i, j) {
  return j * field.n + i;
}
