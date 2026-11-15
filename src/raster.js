export function findTrimBounds(pixels, width, height, alphaThreshold = 1) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha < alphaThreshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

function copyPixel(source, sourceOffset, target, targetOffset) {
  target[targetOffset] = source[sourceOffset];
  target[targetOffset + 1] = source[sourceOffset + 1];
  target[targetOffset + 2] = source[sourceOffset + 2];
  target[targetOffset + 3] = source[sourceOffset + 3];
}

export function composeAtlas(packer) {
  const width = packer.width;
  const height = packer.height;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (const item of packer.items.values()) {
    const source = item.frame.pixels;
    const sourceWidth = item.frame.width;
    const { trim } = item;
    const trimWidth = trim.w;
    const trimHeight = trim.h;

    for (let sy = 0; sy < trimHeight; sy += 1) {
      for (let sx = 0; sx < trimWidth; sx += 1) {
        const sourceOffset =
          ((trim.y + sy) * sourceWidth + trim.x + sx) * 4;
        const atlasX = item.rotated
          ? item.x + trimHeight - 1 - sy
          : item.x + sx;
        const atlasY = item.rotated ? item.y + sx : item.y + sy;
        copyPixel(
          source,
          sourceOffset,
          pixels,
          (atlasY * width + atlasX) * 4,
        );
      }
    }
  }
  return { width, height, pixels };
}

export function extractSourceFrame(atlas, atlasWidth, atlasHeight, entry) {
  if (!entry || !entry.frame || !entry.spriteSourceSize || !entry.sourceSize) {
    throw new Error("Atlas entry is missing frame metadata.");
  }
  const frame = entry.frame;
  const trim = entry.spriteSourceSize;
  const sourceSize = entry.sourceSize;
  const source = new Uint8ClampedArray(
    sourceSize.w * sourceSize.h * 4,
  );
  const trimWidth = trim.w;
  const trimHeight = trim.h;

  if (
    frame.x < 0 ||
    frame.y < 0 ||
    frame.x + frame.w > atlasWidth ||
    frame.y + frame.h > atlasHeight
  ) {
    throw new Error("Atlas frame lies outside the image.");
  }
  if (
    entry.rotated &&
    (frame.w !== trimHeight || frame.h !== trimWidth)
  ) {
    throw new Error("Rotated frame dimensions do not match trim size.");
  }
  if (
    !entry.rotated &&
    (frame.w !== trimWidth || frame.h !== trimHeight)
  ) {
    throw new Error("Frame dimensions do not match trim size.");
  }

  for (let sy = 0; sy < trimHeight; sy += 1) {
    for (let sx = 0; sx < trimWidth; sx += 1) {
      const atlasX = entry.rotated
        ? frame.x + trimHeight - 1 - sy
        : frame.x + sx;
      const atlasY = entry.rotated ? frame.y + sx : frame.y + sy;
      const sourceX = trim.x + sx;
      const sourceY = trim.y + sy;
      if (
        sourceX < 0 ||
        sourceY < 0 ||
        sourceX >= sourceSize.w ||
        sourceY >= sourceSize.h
      ) {
        throw new Error("Trim rectangle lies outside source size.");
      }
      copyPixel(
        atlas,
        (atlasY * atlasWidth + atlasX) * 4,
        source,
        (sourceY * sourceSize.w + sourceX) * 4,
      );
    }
  }
  return { width: sourceSize.w, height: sourceSize.h, pixels: source };
}

export function framesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function makeEntry(item) {
  return {
    frame: { x: item.x, y: item.y, w: item.w, h: item.h },
    rotated: Boolean(item.rotated),
    trimmed: true,
    spriteSourceSize: {
      x: item.trim.x,
      y: item.trim.y,
      w: item.trim.w,
      h: item.trim.h,
    },
    sourceSize: { w: item.sourceWidth, h: item.sourceHeight },
  };
}
