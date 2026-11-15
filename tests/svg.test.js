import assert from "node:assert/strict";
import test from "node:test";
import { generateRandomScene } from "../src/scene.js";
import { sceneToSVG } from "../src/svg-renderer.js";

test("SVG export uses live text nodes and contains no raster images", () => {
  const scene = generateRandomScene("svg-editable-text", 20);
  const svg = sceneToSVG(scene);
  const textObjects = scene.objects.filter((object) => object.type === "text");
  const textNodes = svg.match(/<text\b/g) || [];

  assert.equal(textNodes.length, textObjects.length);
  assert.match(svg, /<tspan\b/);
  for (const object of textObjects) {
    const firstLine = object.text.split("\n")[0];
    assert.ok(svg.includes(firstLine), `missing editable text: ${firstLine}`);
  }
  assert.doesNotMatch(svg, /<image\b/);
  assert.doesNotMatch(svg, /data:image\//);
});

test("SVG export covers gradients and all vector primitives", () => {
  const scene = generateRandomScene("svg-primitives", 20);
  const svg = sceneToSVG(scene);
  assert.match(svg, /<rect\b/);
  assert.match(svg, /<circle\b/);
  assert.match(svg, /<path\b/);
  assert.match(svg, /<linearGradient\b/);
  assert.match(svg, /gradientUnits="userSpaceOnUse"/);
});
