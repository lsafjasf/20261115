import {
  extractSourceFrame,
  framesEqual,
  makeEntry,
} from "./raster.js";

async function resolveHash(hashFrame, pixels) {
  if (typeof hashFrame !== "function") {
    throw new Error("hashFrame must be provided.");
  }
  const value = await hashFrame(pixels);
  return String(value);
}

export async function buildAtlasDocument(
  packer,
  { imageName = "atlas.png", hashFrame, generatedAt = null } = {},
) {
  const stats = packer.stats();
  const frames = {};

  for (const item of packer.items.values()) {
    const hash = await resolveHash(hashFrame, item.frame.pixels);
    frames[item.id] = {
      ...makeEntry(item),
      contentHash: `sha256:${hash.replace(/^sha256:/i, "")}`,
    };
  }

  return {
    frames,
    meta: {
      app: "Incremental Sprite Atlas",
      version: "1.0.0",
      image: imageName,
      format: "RGBA8888",
      size: { w: stats.width, h: stats.height },
      scale: "1",
      padding: packer.padding,
      rotation: "clockwise-90",
      packing: "incremental-maxrects",
      utilization: Number(stats.utilization.toFixed(4)),
      frameCount: stats.frameCount,
      repackCount: stats.repackCount,
      fullRepackCount: stats.fullRepackCount,
      contentHashAlgorithm: "sha256",
      ...(generatedAt ? { generatedAt } : {}),
    },
  };
}

function frameArea(entry) {
  return entry.frame.w * entry.frame.h;
}

function rectanglesOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

export async function validateAtlasDocument({
  document,
  atlas,
  width,
  height,
  hashFrame,
  compareTo = null,
}) {
  const errors = [];
  const slices = [];
  if (!document || typeof document !== "object") {
    return { valid: false, errors: ["JSON document is not an object."], slices };
  }
  if (!document.frames || typeof document.frames !== "object") {
    errors.push("JSON has no frames object.");
  }
  const meta = document.meta || {};
  if (meta.size?.w !== width || meta.size?.h !== height) {
    errors.push(
      `Atlas image is ${width}x${height}, but JSON declares ${meta.size?.w}x${meta.size?.h}.`,
    );
  }
  if (!atlas || atlas.length !== width * height * 4) {
    errors.push("Atlas pixel buffer has an unexpected length.");
  }

  const entries = Object.entries(document.frames || {});
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      if (rectanglesOverlap(entries[a][1].frame, entries[b][1].frame)) {
        errors.push(
          `Frames ${entries[a][0]} and ${entries[b][0]} overlap.`,
        );
      }
    }
  }

  for (const [id, entry] of entries) {
    try {
      if (!entry.frame || !entry.sourceSize || !entry.spriteSourceSize) {
        errors.push(`${id} is missing required frame metadata.`);
        continue;
      }
      if (entry.sourceSize.w < entry.spriteSourceSize.x + entry.spriteSourceSize.w) {
        errors.push(`${id} trim width exceeds source width.`);
      }
      if (entry.sourceSize.h < entry.spriteSourceSize.y + entry.spriteSourceSize.h) {
        errors.push(`${id} trim height exceeds source height.`);
      }
      if (frameArea(entry) <= 0) {
        errors.push(`${id} has an empty packed area.`);
      }
      const extracted = extractSourceFrame(atlas, width, height, entry);
      let hashOk = false;
      if (entry.contentHash) {
        const actual = await resolveHash(hashFrame, extracted.pixels);
        hashOk =
          actual.replace(/^sha256:/i, "").toLowerCase() ===
          String(entry.contentHash).replace(/^sha256:/i, "").toLowerCase();
        if (!hashOk) errors.push(`${id} content hash does not match.`);
      } else {
        errors.push(`${id} has no contentHash for verification.`);
      }
      if (
        compareTo &&
        compareTo.has(id) &&
        !framesEqual(extracted.pixels, compareTo.get(id))
      ) {
        errors.push(`${id} pixels differ from the source frame.`);
      }
      slices.push({
        id,
        width: extracted.width,
        height: extracted.height,
        pixels: extracted.pixels,
        hashOk,
      });
    } catch (error) {
      errors.push(`${id}: ${error.message}`);
    }
  }
  if (entries.length === 0) errors.push("JSON contains no frames.");
  return {
    valid: errors.length === 0,
    errors,
    slices,
    framesChecked: entries.length,
    utilization: meta.utilization ?? null,
  };
}
