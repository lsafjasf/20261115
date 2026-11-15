export const WORLD_SIZE = 1800;
export const HEIGHT_SCALE = 900;
export const DEFAULT_GRID = 160;
export const DEFAULT_PARAMS = Object.freeze({
  seed: "ember-42",
  frequency: 2.35,
  octaves: 5,
  erosion: 0.55,
  seaLevel: 0.4,
});

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function hashSeed(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNoise2D(seed) {
  const random = mulberry32(hashSeed(seed));
  const values = Array.from({ length: 256 }, (_, index) => index);
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  const permutation = new Uint16Array(512);
  for (let i = 0; i < 512; i += 1) permutation[i] = values[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const gradient = (hash, x, y) => {
    switch (hash & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  };

  return (x, y) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = permutation[permutation[xi] + yi];
    const ab = permutation[permutation[xi] + yi + 1];
    const ba = permutation[permutation[xi + 1] + yi];
    const bb = permutation[permutation[xi + 1] + yi + 1];
    const x1 = gradient(aa, xf, yf) + u * (gradient(ba, xf - 1, yf) - gradient(aa, xf, yf));
    const x2 = gradient(ab, xf, yf - 1)
      + u * (gradient(bb, xf - 1, yf - 1) - gradient(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  };
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function fbmFactory(seed, octaves) {
  const octaveNoises = Array.from({ length: octaves }, (_, index) => (
    createNoise2D(`${seed}:octave:${index}`)
  ));
  return (x, y) => {
    let amplitude = 0.58;
    let frequency = 1;
    let sum = 0;
    let normalizer = 0;
    for (let i = 0; i < octaves; i += 1) {
      sum += octaveNoises[i](x * frequency, y * frequency) * amplitude;
      normalizer += amplitude;
      frequency *= 2.03;
      amplitude *= 0.5;
    }
    return sum / normalizer;
  };
}

function erodeHeights(source, grid, strength) {
  if (strength <= 0.001) return source;
  const height = new Float32Array(source);
  const count = grid * grid;
  const passes = 1 + Math.round(strength * 5);
  const indices = Array.from({ length: count }, (_, index) => index);
  const receiver = new Int32Array(count);
  const flow = new Float32Array(count);
  const neigh = [-1, 1, -grid, grid, -grid - 1, -grid + 1, grid - 1, grid + 1];

  for (let pass = 0; pass < passes; pass += 1) {
    indices.sort((a, b) => height[b] - height[a] || a - b);
    receiver.fill(-1);
    flow.fill(1);

    for (const index of indices) {
      const x = index % grid;
      const z = Math.floor(index / grid);
      let best = index;
      let bestHeight = height[index];
      for (const offset of neigh) {
        const next = index + offset;
        if (next < 0 || next >= count) continue;
        const nx = next % grid;
        const nz = Math.floor(next / grid);
        if (Math.abs(nx - x) > 1 || Math.abs(nz - z) > 1) continue;
        if (height[next] < bestHeight) {
          best = next;
          bestHeight = height[next];
        }
      }
      if (best !== index) receiver[index] = best;
    }

    for (const index of indices) {
      const next = receiver[index];
      if (next >= 0) flow[next] += flow[index] * 0.78;
    }

    const flowScale = 1 / Math.log1p(count * 0.78);
    for (const index of indices) {
      const next = receiver[index];
      if (next < 0) continue;
      const drop = height[index] - height[next];
      const flowWeight = Math.log1p(flow[index]) * flowScale;
      const cut = strength * 0.041 * flowWeight * (drop * grid + 0.015);
      height[index] -= cut * 0.72;
      height[next] += cut * 0.22;
    }
  }

  for (let i = 0; i < count; i += 1) height[i] = clamp(height[i]);
  return height;
}

export function normalizeParams(params = {}) {
  return {
    seed: String(params.seed ?? DEFAULT_PARAMS.seed).trim() || DEFAULT_PARAMS.seed,
    frequency: clamp(Number(params.frequency ?? DEFAULT_PARAMS.frequency), 0.6, 6),
    octaves: Math.round(clamp(Number(params.octaves ?? DEFAULT_PARAMS.octaves), 1, 8)),
    erosion: clamp(Number(params.erosion ?? DEFAULT_PARAMS.erosion), 0, 1),
    seaLevel: clamp(Number(params.seaLevel ?? DEFAULT_PARAMS.seaLevel), 0.08, 0.82),
  };
}

export function generateTerrain(rawParams, grid = DEFAULT_GRID) {
  const params = normalizeParams(rawParams);
  const warpA = createNoise2D(`${params.seed}:warp:a`);
  const warpB = createNoise2D(`${params.seed}:warp:b`);
  const baseNoise = fbmFactory(`${params.seed}:base`, params.octaves);
  const ridgeNoise = fbmFactory(`${params.seed}:ridge`, Math.max(2, params.octaves - 1));
  const heights = new Float32Array(grid * grid);

  for (let z = 0; z < grid; z += 1) {
    for (let x = 0; x < grid; x += 1) {
      const u = x / (grid - 1);
      const v = z / (grid - 1);
      const px = (u - 0.5) * 2;
      const pz = (v - 0.5) * 2;
      const warp = warpA(px * 1.3 + 4.7, pz * 1.3 - 8.2);
      const wx = px + warp * 0.32;
      const wz = pz + warpB(px * 1.25 - 2.1, pz * 1.25 + 6.4) * 0.32;
      const base = clamp(baseNoise(wx * params.frequency + 3.6, wz * params.frequency - 1.8) * 0.5 + 0.5);
      const ridge = clamp(1 - Math.abs(ridgeNoise(wx * params.frequency * 1.8, wz * params.frequency * 1.8)));
      const radius = Math.sqrt(px * px + pz * pz);
      const island = 1 - smoothstep(0.44, 1.16, radius);
      const shape = 0.075 + base * 0.69 + Math.pow(ridge, 2.2) * 0.245;
      heights[z * grid + x] = clamp(shape * (0.36 + island * 0.64));
    }
  }

  return {
    heights: erodeHeights(heights, grid, params.erosion),
    grid,
    params,
  };
}

export function analyzeTerrain(heights, grid, seaLevel, worldSize = WORLD_SIZE) {
  let highest = heights[0];
  let highestIndex = 0;
  let landCells = 0;
  let sum = 0;
  for (let i = 0; i < heights.length; i += 1) {
    const height = heights[i];
    if (height > highest) {
      highest = height;
      highestIndex = i;
    }
    if (height > seaLevel) landCells += 1;
    sum += height;
  }
  const cells = heights.length;
  const landFraction = landCells / cells;
  return {
    highest,
    highestIndex,
    highestX: highestIndex % grid,
    highestZ: Math.floor(highestIndex / grid),
    peakElevation: highest * HEIGHT_SCALE,
    waterElevation: seaLevel * HEIGHT_SCALE,
    landFraction,
    landPercent: landFraction * 100,
    landAreaKm2: landFraction * (worldSize * worldSize) / 1_000_000,
    meanHeight: sum / cells,
    grid,
  };
}

export function sampleHeight(heights, grid, x, z) {
  const gx = clamp((x / WORLD_SIZE + 0.5) * (grid - 1), 0, grid - 1);
  const gz = clamp((z / WORLD_SIZE + 0.5) * (grid - 1), 0, grid - 1);
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const x1 = Math.min(grid - 1, x0 + 1);
  const z1 = Math.min(grid - 1, z0 + 1);
  const tx = gx - x0;
  const tz = gz - z0;
  const top = heights[z0 * grid + x0] * (1 - tx) + heights[z0 * grid + x1] * tx;
  const bottom = heights[z1 * grid + x0] * (1 - tx) + heights[z1 * grid + x1] * tx;
  return top * (1 - tz) + bottom * tz;
}

export function gridToWorld(heights, grid, gx, gz) {
  const index = gz * grid + gx;
  return {
    x: (gx / (grid - 1) - 0.5) * WORLD_SIZE,
    y: heights[index] * HEIGHT_SCALE,
    z: (gz / (grid - 1) - 0.5) * WORLD_SIZE,
  };
}

export function worldToGrid(x, z, grid) {
  return {
    x: clamp((x / WORLD_SIZE + 0.5) * (grid - 1), 0, grid - 1),
    z: clamp((z / WORLD_SIZE + 0.5) * (grid - 1), 0, grid - 1),
  };
}
