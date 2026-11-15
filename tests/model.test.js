import assert from "node:assert/strict";
import test from "node:test";
import {
  COLOR_THRESHOLD,
  COORDINATE_THRESHOLD,
  compareScenes,
  generateRandomScene,
  sceneFromJSON,
  sceneToJSON
} from "../src/scene.js";

test("random scenes contain every supported vector object type", () => {
  const scene = generateRandomScene("coverage", 20);
  const types = new Set(scene.objects.map((object) => object.type));
  assert.deepEqual([...types].sort(), ["circle", "path", "rect", "text"]);
  assert.ok(scene.objects.some((object) => object.fill?.type === "linear"));
  assert.ok(scene.objects.some((object) => object.fill?.type === "solid"));
});

test("two JSON save-load round trips preserve count, coordinates, colors and z-order", () => {
  const original = generateRandomScene("roundtrip-model-01", 24);
  const first = sceneFromJSON(sceneToJSON(original));
  const second = sceneFromJSON(sceneToJSON(first));

  const firstReport = compareScenes(original, first);
  const secondReport = compareScenes(first, second);
  for (const report of [firstReport, secondReport]) {
    assert.equal(report.objectCountMatches, true);
    assert.equal(report.typesMatch, true);
    assert.equal(report.zOrderMatches, true);
    assert.ok(report.maxCoordinateDelta <= COORDINATE_THRESHOLD);
    assert.ok(report.maxColorDelta <= COLOR_THRESHOLD);
    assert.equal(report.passed, true);
  }
  assert.equal(firstReport.objectCountRestored, 24);
  assert.equal(secondReport.objectCountRestored, 24);
  assert.equal(firstReport.maxCoordinateDelta, 0);
  assert.equal(secondReport.maxColorDelta, 0);
});

test("layer ordering survives serialization exactly", () => {
  const scene = generateRandomScene("z-order", 18);
  const restored = sceneFromJSON(sceneToJSON(scene));
  assert.deepEqual(
    restored.objects.map((object) => [object.id, object.z]),
    scene.objects.map((object) => [object.id, object.z])
  );
});

test("invalid JSON and unsupported object data are rejected", () => {
  assert.throws(() => sceneFromJSON("{broken"), /not valid JSON/);
  assert.throws(
    () =>
      sceneFromJSON(
        JSON.stringify({
          version: 1,
          canvas: { width: 960, height: 600, background: "#fff" },
          objects: [{ id: "bad", type: "image", z: 0 }]
        })
      ),
    /unsupported type/
  );
});
