import { writeFile, rm, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { join } from "node:path";

import { buildSuccessRecording } from "../src/scenario.js";
import { serializeRecording, parseRecording } from "../src/recorder.js";
import { runRecording, diffSnapshots } from "../src/replayer.js";

const file = join(process.cwd(), "test", "tmp-recording.json");
const recording = buildSuccessRecording();
await writeFile(file, serializeRecording(recording), "utf8");

const reloaded = parseRecording(await readFile(file, "utf8"));
const originalRun = runRecording(recording, { collect: true });
const reloadedRun = runRecording(reloaded, { collect: true });

assert.equal(reloadedRun.frames.length, originalRun.frames.length);
for (let i = 0; i < originalRun.frames.length; i++) {
  const diffs = diffSnapshots(originalRun.frames[i], reloadedRun.frames[i], 0);
  assert.equal(diffs.length, 0, `文件重载后帧 ${i} 轨迹不一致`);
}
assert.equal(reloadedRun.state.result, "success");
assert.ok(reloadedRun.state.maxAirTime > 5);
await rm(file);

console.log("  ✓ 导出→文件→重载后轨迹逐位一致，且仍为成功吊装");
