import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { runIncrementalSelfTest } from "../src/self-test.js";
import { decodePNG, encodePNG } from "./png-node.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

async function sha256(pixels) {
  return createHash("sha256").update(pixels).digest("hex");
}

async function pngRoundTrip(pixels, width, height) {
  const decoded = decodePNG(encodePNG(width, height, pixels));
  return {
    width: decoded.width,
    height: decoded.height,
    pixels: decoded.pixels,
  };
}

const result = await runIncrementalSelfTest({
  hashFrame: sha256,
  roundTripAtlas: pngRoundTrip,
});
const { report, document, atlas } = result;
const output = `${root}artifacts`;
await mkdir(output, { recursive: true });
await writeFile(
  `${output}/atlas-60.png`,
  encodePNG(atlas.width, atlas.height, atlas.pixels),
);
await writeFile(
  `${output}/atlas-60.json`,
  `${JSON.stringify(document, null, 2)}\n`,
);
await writeFile(
  `${output}/validation-60.json`,
  `${JSON.stringify(report, null, 2)}\n`,
);

console.log(
  JSON.stringify(
    {
      ok: report.ok,
      finalFrames: report.finalFrames,
      atlas: `${report.finalDimensions.width}x${report.finalDimensions.height}`,
      coordinatesStable: report.coordinatesStable,
      noOverlap: report.noOverlap,
      atlasDidNotDouble: report.atlasDidNotDouble,
      repackCount: report.repackCount,
      fullRepackCount: report.fullRepackCount,
      utilization: `${(report.utilization * 100).toFixed(2)}%`,
      reload: report.reload,
      timing: report.timing,
    },
    null,
    2,
  ),
);

if (!report.ok) {
  console.error(JSON.stringify(report.reload.errors, null, 2));
  process.exitCode = 1;
}
