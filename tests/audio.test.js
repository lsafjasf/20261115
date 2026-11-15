import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../js/audio.js";
import { MASKING_THRESHOLD } from "../js/constants.js";

class MockParam {
  constructor(value) {
    this.value = value;
    this.calls = [];
  }
  setValueAtTime(v) {
    this.value = v;
    this.calls.push(["set", v]);
  }
  exponentialRampToValueAtTime(v) {
    this.value = v;
    this.calls.push(["exp", v]);
  }
  setTargetAtTime(v) {
    this.value = v;
    this.calls.push(["target", v]);
  }
  cancelScheduledValues() {
    this.calls.push(["cancel"]);
  }
}

class MockNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.gain = new MockParam(1);
    this.frequency = new MockParam(440);
    this.delayTime = new MockParam(0);
  }
  connect(dest) {
    this.ctx.edges.push([this, dest]);
    return dest;
  }
  start() {}
  stop() {}
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = "running";
    this.edges = [];
    this.destination = {};
  }
  createGain() {
    return new MockNode(this);
  }
  createOscillator() {
    const n = new MockNode(this);
    n.type = "";
    return n;
  }
  createDelay() {
    return new MockNode(this);
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
}

globalThis.AudioContext = MockAudioContext;

test("每次拨齿增加振动齿片数并回调共鸣状态", () => {
  const engine = new AudioEngine();
  const events = [];
  engine.onResonance = (count, masked) => events.push([count, masked]);
  engine.pluck(74, 1);
  engine.pluck(76, 2);
  engine.pluck(78, 3);
  assert.equal(engine.resonanceCount(engine.now), 3);
  assert.deepEqual(events.map((e) => e[0]), [1, 2, 3]);
  assert.ok(events.every(([, m]) => m === false));
});

test("超过 3 齿同时触发进入掩蔽并自动收束响度", () => {
  const engine = new AudioEngine();
  let masked = false;
  engine.onResonance = (count, m) => {
    masked = m;
  };
  const overload = MASKING_THRESHOLD + 1;
  for (const midi of [74, 76, 78, 81]) {
    engine.ensure();
    engine.ctx.currentTime += 0.01;
    engine.pluck(midi, overload);
  }
  assert.equal(masked, true);
  const ducked = engine.maskGain.gain.calls.some(
    ([kind, v]) => kind === "target" && v < 1,
  );
  assert.ok(ducked);
});

test("齿片振铃到期后从共鸣计数中移除", () => {
  const engine = new AudioEngine();
  engine.pluck(74, 1);
  assert.equal(engine.resonanceCount(0), 1);
  engine.ctx.currentTime = 10; // 远超最长衰减
  assert.equal(engine.resonanceCount(engine.now), 0);
});

test("重复拨同一齿片会重建音头而不是叠加", () => {
  const engine = new AudioEngine();
  engine.pluck(74, 1);
  engine.ctx.currentTime = 0.1;
  engine.pluck(74, 1);
  assert.equal(engine.resonanceCount(engine.now), 1);
});
