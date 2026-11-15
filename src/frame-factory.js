const PALETTES = [
  ["#ff8a5b", "#ffc46b", "#8f3d2a"],
  ["#7ee8fa", "#4a9cf7", "#173c7a"],
  ["#b8ff63", "#55c981", "#1d633e"],
  ["#ffd166", "#ff8fab", "#8b3f68"],
  ["#c9a7ff", "#7c6cf2", "#382f8f"],
  ["#ff6b9e", "#ffb3c8", "#7c2346"],
  ["#f4f1de", "#c8c1a8", "#5c5749"],
  ["#71f5c7", "#22b8a1", "#0d5d55"],
];

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

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function shapeInside(type, nx, ny) {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  switch (type) {
    case 0:
      return nx * nx + ny * ny <= 1;
    case 1:
      return ax + ay <= 1.08;
    case 2:
      return ax <= 0.9 && ay <= 0.9;
    case 3:
      return ax + ay <= 0.78 || (ax <= 0.2 && ay <= 1);
    case 4:
      return (nx * nx) / 0.7 + (ny * ny) / 1.05 <= 1;
    case 5: {
      const radius = Math.sqrt(nx * nx + ny * ny);
      return radius <= 1 && radius >= 0.55;
    }
    default:
      return ax <= 0.22 || ay <= 0.22;
  }
}

function writeColor(pixels, offset, rgb, alpha = 255) {
  pixels[offset] = rgb[0];
  pixels[offset + 1] = rgb[1];
  pixels[offset + 2] = rgb[2];
  pixels[offset + 3] = alpha;
}

export function makeGeneratedFrame({
  id,
  name = id,
  seed = 1,
  scale = 1,
  padding = null,
} = {}) {
  const random = mulberry32(seed);
  random();
  const contentWidth = Math.round((18 + random() * 28) * scale);
  const contentHeight = Math.round((16 + random() * 26) * scale);
  const paddingX = padding ?? Math.floor(2 + random() * 5);
  const paddingY = Math.floor(2 + random() * 5);
  const width = contentWidth + paddingX * 2;
  const height = contentHeight + paddingY * 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const palette = PALETTES[Math.floor(random() * PALETTES.length)];
  const [main, light, dark] = palette.map(hexToRgb);
  const type = Math.floor(random() * 7);
  const inset = Math.max(1, Math.round((random() * 2.4 + 0.7) * scale));
  const innerWidth = contentWidth - inset * 2;
  const innerHeight = contentHeight - inset * 2;
  const highlightX = (random() * 2 - 1) * 0.45;
  const highlightY = (random() * 2 - 1) * 0.45;

  for (let y = 0; y < contentHeight; y += 1) {
    for (let x = 0; x < contentWidth; x += 1) {
      const nx = (x - (contentWidth - 1) / 2) / (innerWidth / 2);
      const ny = (y - (contentHeight - 1) / 2) / (innerHeight / 2);
      if (!shapeInside(type, nx, ny)) continue;
      const edge =
        !shapeInside(type, nx + 1.7 / innerWidth, ny) ||
        !shapeInside(type, nx, ny + 1.7 / innerHeight);
      const dist =
        (nx - highlightX) * (nx - highlightX) +
        (ny - highlightY) * (ny - highlightY);
      const color = edge ? dark : dist < 0.2 ? light : main;
      const offset = ((paddingY + y) * width + paddingX + x) * 4;
      writeColor(pixels, offset, color);
    }
  }

  return {
    id,
    name,
    width,
    height,
    pixels,
    paletteIndex: PALETTES.indexOf(palette),
    shape: type,
  };
}

export function buildGeneratedFrames(
  count,
  { prefix = "frame", seed = 100, scale = 1, start = 0 } = {},
) {
  const frames = [];
  for (let index = start; index < start + count; index += 1) {
    const serial = String(index + 1).padStart(3, "0");
    frames.push(
      makeGeneratedFrame({
        id: `${prefix}-${serial}`,
        name: `${prefix}-${serial}.png`,
        seed: seed + index * 7919,
        scale,
      }),
    );
  }
  return frames;
}

export function resizeFrame(frame, factor) {
  const width = Math.max(1, Math.round(frame.width * factor));
  const height = Math.max(1, Math.round(frame.height * factor));
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(frame.height - 1, Math.floor(y / factor));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(frame.width - 1, Math.floor(x / factor));
      const sourceOffset = (sourceY * frame.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      pixels[targetOffset] = frame.pixels[sourceOffset];
      pixels[targetOffset + 1] = frame.pixels[sourceOffset + 1];
      pixels[targetOffset + 2] = frame.pixels[sourceOffset + 2];
      pixels[targetOffset + 3] = frame.pixels[sourceOffset + 3];
    }
  }
  return { ...frame, width, height, pixels };
}

export function recolorFrame(frame) {
  const pixels = new Uint8ClampedArray(frame.pixels);
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    pixels[index] = 255 - pixels[index];
    pixels[index + 1] = 255 - pixels[index + 1];
    pixels[index + 2] = 255 - pixels[index + 2];
  }
  return { ...frame, pixels };
}

export function makeModifiedFrame(frame, variant = 1) {
  const source = recolorFrame(
    resizeFrame(frame, 1.12 + (variant % 4) * 0.035),
  );
  return {
    ...source,
    id: frame.id,
    name: frame.name,
  };
}
