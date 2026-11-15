import { test } from "node:test";
import assert from "node:assert/strict";
import { SongStore } from "../js/storage.js";
import { buildDemoSong } from "../js/demo.js";
import { STORAGE_KEY } from "../js/constants.js";

class MemoryBackend {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

test("保存后可恢复完整快照（含 BPM 与 40 个音符）", () => {
  const backend = new MemoryBackend();
  const store = new SongStore(backend);
  const song = buildDemoSong();
  assert.equal(store.save(song), true);
  const loaded = store.load();
  assert.ok(loaded.savedAt > 0);
  assert.equal(loaded.snapshot.notes.length, 40);
  assert.equal(loaded.snapshot.bpm, 117);
  assert.equal(loaded.snapshot.title, "苔上星光");
  assert.ok(backend.getItem(STORAGE_KEY).includes("苔上星光"));
});

test("编辑后保存再恢复，改动被持久化；清除后返回 null", () => {
  const backend = new MemoryBackend();
  const store = new SongStore(backend);
  const song = buildDemoSong();
  song.notes.push({ id: "x", step: 100, duration: 2, midi: 69, track: "right" });
  song.bpm = 160;
  store.save(song);
  const restored = store.load().snapshot;
  assert.equal(restored.notes.length, 41);
  assert.equal(restored.bpm, 160);
  store.clear();
  assert.equal(store.load(), null);
});

test("损坏的存储内容安全返回 null", () => {
  const backend = new MemoryBackend();
  backend.setItem(STORAGE_KEY, "{not json");
  const store = new SongStore(backend);
  assert.equal(store.load(), null);
});

test("无后端时降级为不保存而非抛错", () => {
  const store = new SongStore(null);
  assert.equal(store.save({}), false);
  assert.equal(store.load(), null);
});
