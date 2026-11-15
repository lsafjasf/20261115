import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildAtlasDocument,
  validateAtlasDocument,
} from "../src/atlas-format.js";
import {
  buildGeneratedFrames,
  recolorFrame,
  resizeFrame,
} from "../src/frame-factory.js";
import { IncrementalPacker } from "../src/packer.js";
import { composeAtlas, extractSourceFrame } from "../src/raster.js";
import { runIncrementalSelfTest } from "../src/self-test.js";
import { decodePNG, encodePNG } from "../scripts/png-node.mjs";

const sha256 = async (pixels) =>
  createHash("sha256").update(pixels).digest("hex");

function snapshot(packer) {
  return new Map(
    [...packer.items.values()].map((item) => [
      item.id,
      {
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        rotated: item.rotated,
      },
    ]),
  );
}

function assertUnmoved(before, after, excluded = new Set()) {
  for (const [id, layout] of before) {
    if (excluded.has(id)) continue;
    const current = after.get(id);
    assert.ok(current, `${id} should still exist`);
    assert.deepEqual(current, layout, `${id} moved unexpectedly`);
  }
}

test("60-frame add/delete keeps coordinates and reloads every slice", async () => {
  const result = await runIncrementalSelfTest({
    hashFrame: sha256,
    roundTripAtlas: async (pixels, width, height) => {
      const decoded = decodePNG(encodePNG(width, height, pixels));
      return {
        width: decoded.width,
        height: decoded.height,
        pixels: decoded.pixels,
      };
    },
  });

  assert.equal(result.report.ok, true);
  assert.equal(result.report.finalFrames, 60);
  assert.equal(result.report.coordinatesStable, true);
  assert.equal(result.report.noOverlap, true);
  assert.equal(result.report.atlasDidNotDouble, true);
  assert.equal(result.report.fullRepackCount, 0);
  assert.equal(result.report.reload.valid, true);
  assert.equal(result.report.reload.framesChecked, 60);
  assert.equal(result.report.updateGrowthEvents.length, 0);
  assert.deepEqual(result.report.finalDimensions, {
    width: 304,
    height: 256,
  });

  const rotated = Object.values(result.document.frames).filter(
    (entry) => entry.rotated,
  );
  assert.ok(rotated.length > 0, "test set should exercise rotation");
  for (const entry of Object.values(result.document.frames)) {
    assert.equal(entry.trimmed, true);
    assert.ok(entry.sourceSize.w > 0);
    assert.ok(entry.sourceSize.h > 0);
    assert.match(entry.contentHash, /^sha256:[0-9a-f]{64}$/);
  }

  const png = encodePNG(
    result.atlas.width,
    result.atlas.height,
    result.atlas.pixels,
  );
  const decoded = decodePNG(png);
  const validation = await validateAtlasDocument({
    document: result.document,
    atlas: decoded.pixels,
    width: decoded.width,
    height: decoded.height,
    hashFrame: sha256,
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.framesChecked, 60);

  for (const [id, entry] of Object.entries(result.document.frames)) {
    const expected = result.packer.getFrame(id).frame.pixels;
    const actual = extractSourceFrame(
      decoded.pixels,
      decoded.width,
      decoded.height,
      entry,
    );
    assert.deepEqual(actual.pixels, expected, `${id} slice pixels differ`);
  }
});

test("single add, delete and modify preserve unrelated placements", () => {
  const packer = new IncrementalPacker({
    initialWidth: 192,
    initialHeight: 192,
    padding: 2,
    growthAlign: 16,
  });
  for (const frame of buildGeneratedFrames(60)) packer.addFrame(frame);
  assert.deepEqual(packer.validate(), []);
  const initial = snapshot(packer);
  const repackBefore = packer.repackCount;
  const added = buildGeneratedFrames(1, {
    prefix: "extra",
    seed: 8181,
  })[0];
  packer.addFrame(added);
  assertUnmoved(initial, snapshot(packer));
  assert.equal(packer.repackCount, repackBefore + 1);
  assert.deepEqual(packer.validate(), []);

  const beforeDelete = snapshot(packer);
  packer.removeFrame("frame-010");
  assertUnmoved(
    beforeDelete,
    snapshot(packer),
    new Set(["frame-010"]),
  );
  assert.deepEqual(packer.validate(), []);

  const target = packer.getFrame("frame-020");
  const position = { x: target.x, y: target.y, rotated: target.rotated };
  const contentRepacks = packer.repackCount;
  packer.modifyFrame(recolorFrame(target.frame));
  assert.equal(packer.repackCount, contentRepacks);
  assert.equal(packer.getFrame("frame-020").x, position.x);
  assert.equal(packer.getFrame("frame-020").y, position.y);

  const beforeResize = snapshot(packer);
  packer.modifyFrame(resizeFrame(packer.getFrame("frame-020").frame, 1.2));
  assertUnmoved(
    beforeResize,
    snapshot(packer),
    new Set(["frame-020"]),
  );
  assert.deepEqual(packer.validate(), []);
  assert.equal(packer.fullRepackCount, 0);
});

test("atlas JSON contains trim, clockwise rotation and source size", async () => {
  const packer = new IncrementalPacker({
    initialWidth: 64,
    initialHeight: 64,
    padding: 0,
  });
  const frames = buildGeneratedFrames(4, { seed: 31 });
  for (const frame of frames) packer.addFrame(frame);
  const documentData = await buildAtlasDocument(packer, {
    imageName: "atlas.png",
    hashFrame: sha256,
  });
  assert.equal(documentData.meta.rotation, "clockwise-90");
  assert.equal(documentData.meta.format, "RGBA8888");
  assert.equal(documentData.meta.frameCount, 4);
  for (const id of packer.items.keys()) {
    const entry = documentData.frames[id];
    assert.ok(entry.frame);
    assert.ok(entry.spriteSourceSize);
    assert.ok(entry.sourceSize);
    assert.equal(
      entry.frame.w,
      entry.rotated ? entry.spriteSourceSize.h : entry.spriteSourceSize.w,
    );
    assert.equal(
      entry.frame.h,
      entry.rotated ? entry.spriteSourceSize.w : entry.spriteSourceSize.h,
    );
  }
});
