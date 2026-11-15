import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { makeGeneratedFrame } from "../src/frame-factory.js";
import { encodePNG } from "./png-node.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = `${root}assets/frames`;
const labels = [
  "ember-gem",
  "cryo-crystal",
  "verdant-core",
  "sun-token",
  "void-sigil",
  "rose-shard",
  "bone-rune",
  "tide-pearl",
  "ember-diamond",
  "cryo-square",
  "verdant-ring",
  "sun-cross",
  "void-vial",
  "rose-orbit",
  "bone-star",
  "tide-diamond",
];

await mkdir(output, { recursive: true });
const frames = [];

for (let index = 0; index < labels.length; index += 1) {
  const serial = String(index + 1).padStart(2, "0");
  const label = labels[index];
  const frame = makeGeneratedFrame({
    id: `builtin-${serial}`,
    name: `${label}.png`,
    seed: 8301 + index * 613,
  });
  const file = `${label}.png`;
  await writeFile(
    `${output}/${file}`,
    encodePNG(frame.width, frame.height, frame.pixels),
  );
  frames.push({
    id: frame.id,
    name: frame.name,
    file,
    width: frame.width,
    height: frame.height,
  });
}

await writeFile(
  `${output}/manifest.json`,
  `${JSON.stringify({ frames }, null, 2)}\n`,
);
console.log(`Generated ${frames.length} built-in PNG frames in assets/frames.`);
