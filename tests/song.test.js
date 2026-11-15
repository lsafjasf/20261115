import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDemoSong } from "../js/demo.js";
import {
  addNote,
  createSong,
  hasConflict,
  notesAtStep,
  toMidiJSON,
  fromMidiJSON,
} from "../js/song.js";
import { TOTAL_STEPS } from "../js/constants.js";

test("示例曲为 8 小节且恰好 40 个音符", () => {
  const song = buildDemoSong();
  assert.equal(song.notes.length, 40);
  assert.equal(song.bars, 8);
  assert.equal(song.bpm, 117);
  for (const n of song.notes) {
    assert.ok(n.step >= 0 && n.step < TOTAL_STEPS);
    assert.ok(n.step + n.duration <= TOTAL_STEPS);
    assert.equal(typeof n.midi, "number");
  }
  assert.equal(song.notes.filter((n) => n.track === "left").length, 16);
  assert.equal(song.notes.filter((n) => n.track === "right").length, 24);
});

test("示例曲最密处不超过 2 齿同时触发，默认不掩蔽", () => {
  const song = buildDemoSong();
  let maxSim = 0;
  for (let s = 0; s < TOTAL_STEPS; s++) {
    maxSim = Math.max(maxSim, notesAtStep(song, s).length);
  }
  assert.ok(maxSim <= 2);
});

test("同轨时间槽冲突可以被检测", () => {
  const song = createSong();
  addNote(song, { step: 0, midi: 50, duration: 4 });
  assert.equal(
    hasConflict(song, { step: 2, duration: 2, track: "left", midi: 50 }),
    true,
  );
  // 同一步不同音高是和弦，允许共存
  assert.equal(
    hasConflict(song, { step: 0, duration: 4, track: "left", midi: 55 }),
    false,
  );
  assert.equal(
    hasConflict(song, { step: 4, duration: 2, track: "left", midi: 50 }),
    false,
  );
  assert.equal(
    hasConflict(song, { step: 0, duration: 4, track: "right", midi: 67 }),
    false,
  );
});

test("非法 step 与非齿片音高被拒绝", () => {
  const song = createSong();
  assert.throws(() => addNote(song, { step: -1, midi: 50 }));
  assert.throws(() => addNote(song, { step: TOTAL_STEPS, midi: 50 }));
  assert.throws(() => addNote(song, { step: 0, midi: 12 }));
});

test("MIDI 风格 JSON 导出再导入保持音符与 tick", () => {
  const song = buildDemoSong();
  const json = toMidiJSON(song);
  assert.equal(json.ppq, 480);
  assert.equal(json.tracks.length, 2);
  const first = json.tracks[1].events[0];
  assert.equal(first.tick, 0);
  assert.equal(first.durationTicks, 240);
  const restored = fromMidiJSON(JSON.parse(JSON.stringify(json)));
  assert.equal(restored.notes.length, 40);
  assert.equal(restored.bpm, 117);
  const key = (n) => `${n.step}:${n.midi}:${n.duration}`;
  assert.deepEqual(
    restored.notes.map(key).sort(),
    song.notes.map(key).sort(),
  );
});

test("导入坏数据抛出明确错误", () => {
  assert.throws(() => fromMidiJSON({ format: "nope" }));
  assert.throws(() => fromMidiJSON(null));
});
