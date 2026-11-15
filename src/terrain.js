export const WORLD_SIZE = 2048;
export const SAMPLE_STEP = 8;
export const LEVELS = [
  { index: 0, grid: 4, label: "L0", name: "区域", tileSize: 512 },
  { index: 1, grid: 8, label: "L1", name: "流域", tileSize: 256 },
  { index: 2, grid: 16, label: "L2", name: "山脊", tileSize: 128 }
];

export const LEVEL_TILE_COUNTS = LEVELS.map((level) => level.grid * level.grid);

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function hash2(ix, iz, seed = 0) {
  let h = ix * 374761393 + iz * 668265263 + seed * 1442695041;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
}

function fbm(x, z, octaves, seed = 0) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i += 1) {
    value += smoothNoise(x * frequency, z * frequency, seed + i * 31) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / total;
}

function ridge(x, z, seed = 0) {
  const n = fbm(x, z, 4, seed);
  return 1 - Math.abs(n * 2 - 1);
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function heightAt(x, z) {
  const nx = (x + WORLD_SIZE * 0.5) / WORLD_SIZE;
  const nz = (z + WORLD_SIZE * 0.5) / WORLD_SIZE;
  const warpX = fbm(nx * 2.7 + 5.4, nz * 2.7 - 1.8, 3, 101) - 0.5;
  const warpZ = fbm(nx * 2.7 - 2.1, nz * 2.7 + 7.3, 3, 131) - 0.5;
  const qx = nx + warpX * 0.16;
  const qz = nz + warpZ * 0.16;
  const continent = fbm(qx * 1.75 + 3.7, qz * 1.75 - 1.2, 5, 7) - 0.46;
  const mountainMask = smoothstep(
    0.39,
    0.7,
    fbm(nx * 1.55 + 8.2, nz * 1.55 - 5.5, 4, 67)
  );
  const ridges = ridge(qx * 3.9 - 8.4, qz * 3.9 + 2.8, 19);
  const secondary = ridge(qx * 8.8 + 1.6, qz * 8.8 - 6.4, 43);
  const detail = fbm(qx * 19.5, qz * 19.5, 4, 91) - 0.5;
  const basin = Math.exp(
    -((nx - 0.61) ** 2 / 0.035 + (nz - 0.57) ** 2 / 0.06)
  );
  const saddle = Math.exp(
    -((nx - 0.31) ** 2 / 0.012 + (nz - 0.38) ** 2 / 0.028)
  );
  const rim = Math.exp(
    -(((nx - 0.18) ** 2 + (nz - 0.2) ** 2) / 0.22)
  );
  const riverCenter = 0.47 + Math.sin(nz * 5.1 + 1.7) * 0.055;
  const river = Math.exp(-((nx - riverCenter) ** 2) / 0.00022);
  const raw =
    24 +
    continent * 148 +
    ridges * mountainMask * 142 +
    secondary * mountainMask * 36 +
    detail * 28 +
    rim * 42 -
    basin * 74 -
    saddle * 20 -
    river * 34;
  return raw;
}

export function slopeAt(x, z) {
  const e = 4;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.sqrt(dx * dx + dz * dz) / (e * 2);
}

const COLOR_STOPS = [
  [0.0, [22, 49, 56]],
  [0.12, [35, 79, 67]],
  [0.28, [57, 96, 64]],
  [0.46, [92, 112, 63]],
  [0.62, [139, 123, 71]],
  [0.75, [156, 111, 77]],
  [0.84, [143, 116, 103]],
  [0.92, [193, 186, 169]],
  [1.0, [237, 236, 225]]
];

export function colorAt(x, z, height = heightAt(x, z), slope = slopeAt(x, z)) {
  const t = clamp((height + 90) / 300);
  let low = COLOR_STOPS[0];
  let high = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i += 1) {
    if (t >= COLOR_STOPS[i][0] && t <= COLOR_STOPS[i + 1][0]) {
      low = COLOR_STOPS[i];
      high = COLOR_STOPS[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, high[0] - low[0]);
  const k = clamp((t - low[0]) / span);
  const shade = clamp(1 - slope * 0.9, 0.6, 1.02);
  return [
    Math.round((low[1][0] + (high[1][0] - low[1][0]) * k) * shade),
    Math.round((low[1][1] + (high[1][1] - low[1][1]) * k) * shade),
    Math.round((low[1][2] + (high[1][2] - low[1][2]) * k) * shade)
  ];
}

export function colorCssAt(x, z) {
  const [r, g, b] = colorAt(x, z);
  return `rgb(${r}, ${g}, ${b})`;
}

export const LEVEL_META = LEVELS.map((level) => ({
  ...level,
  columns: level.grid,
  segments: level.tileSize / SAMPLE_STEP,
  totalTiles: level.grid * level.grid
}));
