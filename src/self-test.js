import { buildAtlasDocument, validateAtlasDocument } from "./atlas-format.js";
import {
  buildGeneratedFrames,
  makeModifiedFrame,
} from "./frame-factory.js";
import { IncrementalPacker } from "./packer.js";
import { composeAtlas } from "./raster.js";

const FIELDS = ["x", "y", "w", "h", "rotated"];

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function tintFrame(frame) {
  const pixels = new Uint8ClampedArray(frame.pixels);
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    pixels[index] = 255 - pixels[index];
    pixels[index + 1] = 255 - pixels[index + 1];
    pixels[index + 2] = 255 - pixels[index + 2];
  }
  return { ...frame, pixels };
}

function compareStable(baseline, packer, excluded) {
  const changed = [];
  for (const [id, before] of baseline) {
    if (excluded.has(id)) continue;
    const after = packer.getFrame(id);
    if (!after || FIELDS.some((field) => before[field] !== after[field])) {
      changed.push(id);
    }
  }
  return changed;
}

function dimensionsAt(packer) {
  return { width: packer.width, height: packer.height };
}

export async function runIncrementalSelfTest({
  hashFrame,
  roundTripAtlas = null,
  initialWidth = 256,
  initialHeight = 256,
} = {}) {
  const started = now();
  const packer = new IncrementalPacker({
    initialWidth,
    initialHeight,
    padding: 2,
    growthAlign: 16,
    maxSize: 2048,
  });
  const frames = buildGeneratedFrames(60);
  const loadStarted = now();
  for (const frame of frames) packer.addFrame(frame);
  const loadMs = now() - loadStarted;
  const loadedDimensions = dimensionsAt(packer);
  const loadGrowthCount = packer.growthEvents.length;
  const baseline = new Map(
    packer.snapshotLayout().map((item) => [item.id, item]),
  );

  const deletedIds = [
    "frame-007",
    "frame-015",
    "frame-023",
    "frame-031",
    "frame-039",
    "frame-047",
    "frame-055",
    "frame-060",
  ];
  const contentModifiedIds = ["frame-003"];
  const sizeModifiedIds = ["frame-013", "frame-027", "frame-044"];
  const updateStarted = now();

  for (const id of deletedIds) packer.removeFrame(id);
  for (const frame of buildGeneratedFrames(8, {
    prefix: "add",
    seed: 9041,
    start: 61,
  })) {
    packer.addFrame(frame);
  }
  for (const id of contentModifiedIds) {
    packer.modifyFrame(tintFrame(packer.getFrame(id).frame));
  }
  for (const id of sizeModifiedIds) {
    packer.modifyFrame(makeModifiedFrame(packer.getFrame(id).frame, 3));
  }
  const updateMs = now() - updateStarted;

  const excludedFromStability = new Set([...deletedIds, ...sizeModifiedIds]);
  const changedIds = compareStable(
    baseline,
    packer,
    excludedFromStability,
  );
  const validationErrors = packer.validate();
  const finalDimensions = dimensionsAt(packer);
  const updateGrowthEvents = packer.growthEvents.slice(loadGrowthCount);

  const exportStarted = now();
  const atlas = composeAtlas(packer);
  const document = await buildAtlasDocument(packer, {
    imageName: "atlas-60.png",
    hashFrame,
    generatedAt: new Date().toISOString(),
  });
  const reloaded = roundTripAtlas
    ? await roundTripAtlas(atlas.pixels, atlas.width, atlas.height)
    : atlas;
  const currentPixels = new Map(
    [...packer.items.values()].map((item) => [
      item.id,
      item.frame.pixels,
    ]),
  );
  const reload = await validateAtlasDocument({
    document,
    atlas: reloaded.pixels,
    width: reloaded.width,
    height: reloaded.height,
    hashFrame,
    compareTo: currentPixels,
  });
  const exportMs = now() - exportStarted;
  const stats = packer.stats();
  const atlasDidNotDouble = updateGrowthEvents.every(
    (event) =>
      event.newWidth < event.oldWidth * 2 &&
      event.newHeight < event.oldHeight * 2,
  );
  const ok =
    validationErrors.length === 0 &&
    changedIds.length === 0 &&
    reload.valid &&
    atlasDidNotDouble;

  return {
    ok,
    packer,
    document,
    atlas,
    reloadedAtlas: reloaded,
    reload,
    report: {
      ok,
      test: "60-frame incremental add/delete/modify + JSON/PNG reload",
      initialFrames: 60,
      finalFrames: stats.frameCount,
      deletedIds,
      addedIds: [...packer.items.keys()].filter((id) =>
        id.startsWith("add-"),
      ),
      contentModifiedIds,
      sizeModifiedIds,
      coordinatesStable: changedIds.length === 0,
      changedIds,
      stableFrameCount:
        baseline.size - deletedIds.length - sizeModifiedIds.length,
      noOverlap: validationErrors.length === 0,
      validationErrors,
      atlasDidNotDouble,
      loadedDimensions,
      finalDimensions,
      updateGrowthEvents,
      growthEvents: packer.growthEvents,
      layoutBefore: [...baseline.values()],
      layoutAfter: packer.snapshotLayout(),
      repackCount: stats.repackCount,
      fullRepackCount: stats.fullRepackCount,
      growthCount: stats.growthCount,
      utilization: stats.utilization,
      reload: {
        valid: reload.valid,
        framesChecked: reload.framesChecked,
        errors: reload.errors,
      },
      timing: {
        loadMs: Number(loadMs.toFixed(3)),
        updateMs: Number(updateMs.toFixed(3)),
        exportAndReloadMs: Number(exportMs.toFixed(3)),
        totalMs: Number((now() - started).toFixed(3)),
      },
    },
  };
}
