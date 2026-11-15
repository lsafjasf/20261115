import { test } from "node:test";
import assert from "node:assert/strict";
import { Clock } from "../js/clock.js";
import { TOTAL_STEPS } from "../js/constants.js";

test("BPM 决定步长秒数：117 BPM 时一步约 0.1282 秒", () => {
  const clock = new Clock(117);
  assert.ok(Math.abs(clock.secondsPerStep() - 15 / 117) < 1e-9);
});

test("播放中改变 BPM 立即影响后续步进节奏", () => {
  const clock = new Clock(60);
  clock.start();
  // 60 BPM：一步 0.25s，推进 0.25s 跨 1 步
  assert.deepEqual(clock.advance(0.25), [1]);
  clock.setBpm(180);
  // 180 BPM：一步 15/180 ≈ 0.08333s，再推进 0.25s 应跨 3 步
  const crossed = clock.advance(0.25);
  assert.deepEqual(crossed, [2, 3, 4]);
});

test("循环模式到结尾回到第 0 步", () => {
  const clock = new Clock(60);
  clock.loop = true;
  clock.start();
  clock.seek(TOTAL_STEPS - 1);
  const crossed = clock.advance(0.25);
  assert.ok(crossed.includes(0));
  assert.equal(clock.currentStep(), 0);
  assert.equal(clock.playing, true);
});

test("非循环模式到结尾自动停止", () => {
  const clock = new Clock(300);
  clock.loop = false;
  clock.start();
  clock.seek(TOTAL_STEPS - 1);
  clock.advance(0.2);
  assert.equal(clock.playing, false);
  assert.equal(clock.currentStep(), TOTAL_STEPS);
});

test("暂停后推进不产生步进，恢复后继续", () => {
  const clock = new Clock(60);
  clock.start();
  clock.advance(0.25);
  clock.pause();
  assert.deepEqual(clock.advance(1), []);
  assert.equal(clock.currentStep(), 1);
  clock.start();
  assert.deepEqual(clock.advance(0.25), [2]);
});
