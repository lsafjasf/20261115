export const SIZE = 512;
export const TAU = Math.PI * 2;

export const MATERIALS = {
  stone: {
    id: "stone",
    name: "石纹",
    title: "暖灰岩层",
    code: "STONE-01",
    description: "细密矿物颗粒与层理，适合石材、微水泥与建筑表面。",
    defaults: { scale: 34, direction: 18, contrast: 56 },
  },
  wood: {
    id: "wood",
    name: "木纹",
    title: "烟熏橡木",
    code: "WOOD-02",
    description: "拉伸年轮与细纤维，带有自然节疤与暖色深浅变化。",
    defaults: { scale: 28, direction: 4, contrast: 62 },
  },
  fabric: {
    id: "fabric",
    name: "布纹",
    title: "靛蓝亚麻",
    code: "FABRIC-03",
    description: "平纹经纬组织与纤维毛羽，适合织物与软包材质。",
    defaults: { scale: 17, direction: 38, contrast: 52 },
  },
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h + Math.imul(seed | 0, 1442695041), 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(x, y, frequency, size, seed) {
  const px = (x * frequency) / size;
  const py = (y * frequency) / size;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = mod(ix, frequency);
  const y0 = mod(iy, frequency);
  const x1 = mod(ix + 1, frequency);
  const y1 = mod(iy + 1, frequency);

  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

function fbm(x, y, frequency, octaves, size, seed, gain = 0.5) {
  let amplitude = 1;
  let total = 0;
  let normalization = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    const octaveFrequency = Math.max(1, frequency * 2 ** octave);
    total += valueNoise(x, y, octaveFrequency, size, seed + octave * 101) * amplitude;
    normalization += amplitude;
    amplitude *= gain;
  }

  return total / normalization;
}

function mix(a, b, t) {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

function paletteColor(stops, value) {
  const t = clamp(value) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(t));
  return mix(stops[index][1], stops[index + 1][1], t - index);
}

function directionVector(angle, frequency, parity = false) {
  let x = Math.round(frequency * Math.cos(angle));
  let y = Math.round(frequency * Math.sin(angle));
  if (x === 0 && y === 0) x = 1;
  if (parity && (Math.abs(x) + Math.abs(y)) % 2 !== 0) {
    if (Math.abs(x) > Math.abs(y)) x += x > 0 ? 1 : -1;
    else y += y > 0 ? 1 : -1;
  }
  return [x, y];
}

function wrappedDelta(value, size) {
  return ((value + size / 2) % size + size) % size - size / 2;
}

function applyContrast(value, contrast) {
  const factor = 0.42 + (contrast / 100) * 1.25;
  return clamp(0.5 + (value - 0.5) * factor);
}

const STONE_PALETTE = [
  [0.0, [45, 48, 46]],
  [0.34, [86, 90, 87]],
  [0.58, [132, 134, 129]],
  [0.8, [178, 176, 167]],
  [1.0, [220, 214, 202]],
];

const WOOD_PALETTE = [
  [0.0, [39, 25, 17]],
  [0.26, [77, 45, 28]],
  [0.5, [112, 68, 42]],
  [0.74, [149, 96, 59]],
  [0.92, [187, 132, 83]],
  [1.0, [212, 165, 112]],
];

const FABRIC_PALETTE = [
  [0.0, [31, 37, 47]],
  [0.3, [55, 64, 79]],
  [0.56, [84, 96, 114]],
  [0.78, [120, 132, 148]],
  [1.0, [168, 175, 184]],
];

function stoneSample(x, y, size, grain, angle, contrast, seed) {
  const base = fbm(x, y, 2, 5, size, seed + 11);
  const medium = fbm(
    x,
    y,
    Math.max(3, Math.round(size / (grain * 2.2))),
    4,
    size,
    seed + 37,
  );
  const fine = fbm(
    x,
    y,
    Math.max(8, Math.round(size / (grain * 0.32))),
    3,
    size,
    seed + 73,
  );
  const grit = valueNoise(
    x,
    y,
    Math.max(18, Math.round(size / (grain * 0.19))),
    size,
    seed + 109,
  );
  const bandCount = Math.max(2, Math.round(size / (grain * 3.2)));
  const [waveX, waveY] = directionVector(angle + Math.PI / 2, bandCount);
  const bandPhase =
    (TAU * (waveX * x + waveY * y)) / size +
    (base - 0.5) * 5.1 +
    (medium - 0.5) * 1.8;
  const band = Math.sin(bandPhase);
  const fineBand = Math.sin(bandPhase * 2 + fine * 2.4);
  const veinMask = smoothstep(0.48, 0.82, medium + (base - 0.5) * 0.35);
  const vein =
    (1 - Math.abs(Math.sin(bandPhase + (medium - 0.5) * 1.4))) ** 25 *
    veinMask;
  const pore = grit > 0.84 ? -(grit - 0.84) * 0.82 : 0;
  const quartz = grit < 0.14 ? (0.14 - grit) * 0.5 : 0;

  let value =
    0.48 +
    (base - 0.5) * 0.26 +
    (medium - 0.5) * 0.22 +
    (fine - 0.5) * 0.19 +
    band * 0.038 +
    fineBand * 0.018 +
    vein * 0.1 +
    pore +
    quartz;
  value = applyContrast(value, contrast);
  return paletteColor(STONE_PALETTE, value);
}

function woodSample(x, y, size, grain, angle, contrast, seed) {
  const coarse = fbm(x, y, 2, 4, size, seed + 211);
  const medium = fbm(
    x,
    y,
    Math.max(4, Math.round(size / (grain * 3.1))),
    3,
    size,
    seed + 229,
  );
  const fine = fbm(
    x,
    y,
    Math.max(14, Math.round(size / (grain * 0.3))),
    3,
    size,
    seed + 251,
  );
  const ringCount = Math.max(5, Math.round(size / (grain * 0.86)));
  const [crossX, crossY] = directionVector(angle + Math.PI / 2, ringCount);
  const ringPhase = (TAU * (crossX * x + crossY * y)) / size;
  const warp =
    (coarse - 0.5) * 6.4 +
    (medium - 0.5) * 2.2 +
    Math.sin(ringPhase + fine * 3.2) * 0.22;
  const rings = 0.5 + 0.5 * Math.sin(ringPhase + warp);
  const sharpRings = rings ** 2.35;

  const [fiberX, fiberY] = directionVector(angle, Math.max(6, ringCount * 2));
  const fiberPhase =
    (TAU * (fiberX * x + fiberY * y)) / size +
    warp * 0.72 +
    fine * 3.5;
  const fiber = Math.sin(fiberPhase);
  const pore = fine > 0.68 ? -(fine - 0.68) * 0.17 : 0;

  let knot = 0;
  const knots = [
    [0.68, 0.31, 0.064, 0.43],
    [0.29, 0.73, 0.041, 0.61],
  ];
  for (let i = 0; i < knots.length; i += 1) {
    const [cx, cy, radiusScale, squash] = knots[i];
    const dx = wrappedDelta(x - cx * size, size);
    const dy = wrappedDelta(y - cy * size, size);
    const distance = Math.hypot(dx, dy * (1 / squash));
    const radius = radiusScale * size;
    const ringWave = Math.exp(-(((distance - radius) / (radius * 0.23)) ** 2));
    const core = Math.exp(-((distance / (radius * 0.52)) ** 2));
    knot += ringWave * 0.18 - core * 0.09;
  }

  let value =
    0.37 +
    sharpRings * 0.27 +
    (coarse - 0.5) * 0.15 +
    (medium - 0.5) * 0.08 +
    (fine - 0.5) * 0.14 +
    fiber * 0.045 +
    pore +
    knot;
  value = applyContrast(value, contrast);
  return paletteColor(WOOD_PALETTE, value);
}

function fabricSample(x, y, size, grain, angle, contrast, seed) {
  const threadCount = Math.max(8, Math.round(size / grain));
  const [threadX, threadY] = directionVector(angle, threadCount, true);
  const warpPhase = (TAU * (threadX * x + threadY * y)) / size;
  const weftPhase = (TAU * (-threadY * x + threadX * y)) / size;
  const warpYarn = (0.5 + 0.5 * Math.cos(warpPhase)) ** 1.85;
  const weftYarn = (0.5 + 0.5 * Math.cos(weftPhase)) ** 1.85;

  const warpCell = Math.floor((threadX * x + threadY * y) / size + 0.5);
  const weftCell = Math.floor((-threadY * x + threadX * y) / size + 0.5);
  const warpOver = mod(warpCell + weftCell, 2) === 0;

  const topYarn = warpOver ? warpYarn : weftYarn;
  const underYarn = warpOver ? weftYarn : warpYarn;
  const crossing = Math.abs(Math.sin(warpPhase) * Math.sin(weftPhase));
  const weaveHeight = 0.19 + topYarn * 0.5 + underYarn * 0.29 + crossing * 0.07;

  const dye = fbm(x, y, 3, 4, size, seed + 331);
  const slub = fbm(
    x,
    y,
    Math.max(4, Math.round(size / (grain * 3.4))),
    3,
    size,
    seed + 347,
  );
  const fuzz = valueNoise(
    x,
    y,
    Math.max(20, Math.round(size / (grain * 0.22))),
    size,
    seed + 359,
  );
  const shadow = warpOver
    ? (1 - weftYarn) * 0.036
    : (1 - warpYarn) * 0.036;

  let value =
    0.35 +
    weaveHeight * 0.29 +
    (dye - 0.5) * 0.2 +
    (slub - 0.5) * 0.1 +
    (fuzz - 0.5) * 0.14 -
    shadow;
  value = applyContrast(value, contrast);
  return paletteColor(FABRIC_PALETTE, value);
}

export function generateTexture({
  material = "stone",
  size = SIZE,
  grain,
  direction,
  contrast,
  seed = 266,
} = {}) {
  const meta = MATERIALS[material] ?? MATERIALS.stone;
  const scale = grain ?? meta.defaults.scale;
  const angle = ((direction ?? meta.defaults.direction) * Math.PI) / 180;
  const contrastValue = contrast ?? meta.defaults.contrast;
  const grainPixels = Math.max(2, scale * (size / SIZE));
  const data = new Uint8ClampedArray(size * size * 4);
  const sampler =
    material === "wood"
      ? woodSample
      : material === "fabric"
        ? fabricSample
        : stoneSample;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color = sampler(x, y, size, grainPixels, angle, contrastValue, seed);
      const dither = (hash2(x, y, seed + 509) - 0.5) * 1.8;
      const index = (y * size + x) * 4;
      data[index] = color[0] + dither;
      data[index + 1] = color[1] + dither;
      data[index + 2] = color[2] + dither;
      data[index + 3] = 255;
    }
  }

  return data;
}

function wrappedPixel(source, size, x, y) {
  const px = mod(Math.round(x), size);
  const py = mod(Math.round(y), size);
  const index = (py * size + px) * 4;
  return [source[index], source[index + 1], source[index + 2]];
}

export function repairAt(
  target,
  size,
  centerX,
  centerY,
  radius,
  {
    tool = "heal",
    source = target,
    angle = 0,
    strength = 0.92,
    seed = 1,
  } = {},
) {
  const targetCx = mod(Math.round(centerX), size);
  const targetCy = mod(Math.round(centerY), size);
  const sourceAngle = angle;
  const sourceX = targetCx + Math.cos(sourceAngle) * radius * 2;
  const sourceY = targetCy + Math.sin(sourceAngle) * radius * 2;
  const maxDistanceSq = radius * radius;

  for (let oy = -radius; oy <= radius; oy += 1) {
    for (let ox = -radius; ox <= radius; ox += 1) {
      const distanceSq = ox * ox + oy * oy;
      if (distanceSq > maxDistanceSq) continue;

      const distance = Math.sqrt(distanceSq) / Math.max(1, radius);
      const feather = smoothstep(1, 0.18, distance);
      const influence = feather * strength;
      if (influence <= 0) continue;

      const px = mod(targetCx + ox, size);
      const py = mod(targetCy + oy, size);
      const index = (py * size + px) * 4;

      let replacement;
      if (tool === "clone") {
        replacement = wrappedPixel(source, size, sourceX + ox, sourceY + oy);
      } else {
        const ring = radius * 1.28;
        const points = [
          wrappedPixel(source, size, targetCx + ox + ring, targetCy + oy),
          wrappedPixel(source, size, targetCx + ox - ring, targetCy + oy),
          wrappedPixel(source, size, targetCx + ox, targetCy + oy + ring),
          wrappedPixel(source, size, targetCx + ox, targetCy + oy - ring),
        ];
        const average = points.reduce(
          (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]],
          [0, 0, 0],
        );
        average[0] /= points.length;
        average[1] /= points.length;
        average[2] /= points.length;
        const cloned = wrappedPixel(source, size, sourceX + ox, sourceY + oy);
        replacement = [
          lerp(cloned[0], average[0], 0.48),
          lerp(cloned[1], average[1], 0.48),
          lerp(cloned[2], average[2], 0.48),
        ];
      }

      const jitter = (hash2(px, py, seed) - 0.5) * 3;
      target[index] = lerp(target[index], replacement[0] + jitter, influence);
      target[index + 1] = lerp(target[index + 1], replacement[1] + jitter, influence);
      target[index + 2] = lerp(target[index + 2], replacement[2] + jitter, influence);
      target[index + 3] = 255;
    }
  }
}

export function touchedEdges(centerX, centerY, radius, size) {
  const crossesHorizontal = centerX - radius < 0 || centerX + radius > size - 1;
  const crossesVertical = centerY - radius < 0 || centerY + radius > size - 1;
  return {
    left: crossesHorizontal,
    right: crossesHorizontal,
    top: crossesVertical,
    bottom: crossesVertical,
  };
}

function rgbAverage(data, index) {
  return (data[index] + data[index + 1] + data[index + 2]) / 3;
}

function wrappedSecondDifference(data, size, x, y, axis) {
  const xPrev = axis === "x" ? mod(x - 1, size) : x;
  const xNext = axis === "x" ? mod(x + 1, size) : x;
  const yPrev = axis === "y" ? mod(y - 1, size) : y;
  const yNext = axis === "y" ? mod(y + 1, size) : y;
  const center = rgbAverage(data, (y * size + x) * 4);
  const previous = rgbAverage(data, (yPrev * size + xPrev) * 4);
  const next = rgbAverage(data, (yNext * size + xNext) * 4);
  return Math.abs(next - 2 * center + previous);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageSeamSecondDifference(data, size, axis) {
  const values = [];
  for (let i = 0; i < size; i += 1) {
    values.push(
      axis === "x"
        ? wrappedSecondDifference(data, size, 0, i, "x")
        : wrappedSecondDifference(data, size, i, 0, "y"),
    );
    values.push(
      axis === "x"
        ? wrappedSecondDifference(data, size, size - 1, i, "x")
        : wrappedSecondDifference(data, size, i, size - 1, "y"),
    );
  }
  return average(values);
}

function averageInnerSecondDifference(data, size, axis) {
  let total = 0;
  let count = 0;
  for (let y = 1; y < size - 1; y += 2) {
    for (let x = 1; x < size - 1; x += 2) {
      total += wrappedSecondDifference(data, size, x, y, axis);
      count += 1;
    }
  }
  return total / count;
}

function averageSeamDifference(data, size, axis) {
  let total = 0;
  for (let i = 0; i < size; i += 1) {
    const a = axis === "x" ? (i * size) * 4 : i * 4;
    const b = axis === "x" ? (i * size + size - 1) * 4 : ((size - 1) * size + i) * 4;
    total +=
      (Math.abs(data[a] - data[b]) +
        Math.abs(data[a + 1] - data[b + 1]) +
        Math.abs(data[a + 2] - data[b + 2])) /
      3;
  }
  return total / size;
}

export function seamReport(data, size = SIZE) {
  const innerX = averageInnerSecondDifference(data, size, "x");
  const innerY = averageInnerSecondDifference(data, size, "y");
  const seamX = averageSeamSecondDifference(data, size, "x");
  const seamY = averageSeamSecondDifference(data, size, "y");
  const ratio = (seamX + seamY) / (innerX + innerY);

  return {
    verticalFirstDiff: averageSeamDifference(data, size, "x"),
    horizontalFirstDiff: averageSeamDifference(data, size, "y"),
    innerSecondDiff: (innerX + innerY) / 2,
    seamSecondDiff: (seamX + seamY) / 2,
    ratio,
    passed: ratio >= 0.72 && ratio <= 1.32,
  };
}

export function buildBrokenControl(data, size = SIZE) {
  const broken = new Uint8ClampedArray(data);
  for (let y = 0; y < size; y += 1) {
    const target = y * size * 4;
    const source = (y * size + size / 4) * 4;
    broken[target] = data[source];
    broken[target + 1] = data[source + 1];
    broken[target + 2] = data[source + 2];
    broken[target + 3] = 255;
  }
  return broken;
}

export function tileTexture(data, size = SIZE) {
  const tileSize = size * 2;
  const tiled = new Uint8ClampedArray(tileSize * tileSize * 4);

  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      const sourceX = x % size;
      const sourceY = y % size;
      const source = (sourceY * size + sourceX) * 4;
      const target = (y * tileSize + x) * 4;
      tiled[target] = data[source];
      tiled[target + 1] = data[source + 1];
      tiled[target + 2] = data[source + 2];
      tiled[target + 3] = 255;
    }
  }

  return { data: tiled, size: tileSize };
}
