import assert from "node:assert/strict";

import {
  buildSuccessRecording,
  buildOverloadRecording,
  buildCollisionRecording,
} from "../src/scenario.js";
import { runRecording, Replayer, snapshot, diffSnapshots } from "../src/replayer.js";
import { serializeRecording, parseRecording, inputAtFrame } from "../src/recorder.js";
import { createInitialState, step, CONFIG, DT } from "../src/physics.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("成功吊装：平稳落入目标区且无超载/碰撞", () => {
  const { state } = runRecording(buildSuccessRecording());
  assert.equal(state.result, "success");
  assert.equal(state.finished, true);
  assert.ok(
    state.cargoX > CONFIG.target.x && state.cargoX < CONFIG.target.x + CONFIG.target.w,
    "货箱应落在目标区内",
  );
  assert.ok(state.maxTensionSeen <= CONFIG.maxTension, "成功吊装不应超载");
  assert.ok(!state.events.some((e) => e.type === "collision"), "成功吊装不应碰撞");
  assert.ok(state.maxAirTime > 3, "应有明显离地时间");
});

test("确定性：同一记录两次运行逐帧轨迹完全一致", () => {
  const recording = buildSuccessRecording();
  const a = runRecording(recording, { collect: true });
  const b = runRecording(recording, { collect: true });
  assert.equal(a.frames.length, b.frames.length);
  for (let i = 0; i < a.frames.length; i++) {
    assert.deepEqual(a.frames[i], b.frames[i], `帧 ${i} 快照不一致`);
  }
});

test("重载记录：序列化后解析得到完全相同轨迹", () => {
  const original = buildSuccessRecording();
  const reloaded = parseRecording(serializeRecording(original));
  const before = runRecording(original, { collect: true }).frames;
  const after = runRecording(reloaded, { collect: true }).frames;
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    const diffs = diffSnapshots(before[i], after[i], 0);
    assert.equal(diffs.length, 0, `重载后帧 ${i} 出现偏差: ${JSON.stringify(diffs[0])}`);
  }
});

test("回放暂停：暂停后状态冻结，恢复后继续", () => {
  const replayer = new Replayer(buildSuccessRecording());
  replayer.advanceFrame();
  replayer.advanceFrame();
  replayer.pause();
  assert.equal(replayer.paused, true);
  const frozen = snapshot(replayer.state);
  for (let i = 0; i < 5; i++) {
    if (!replayer.paused) replayer.advanceFrame();
  }
  assert.deepEqual(snapshot(replayer.state), frozen, "暂停期间状态必须冻结");
  replayer.play();
  assert.equal(replayer.paused, false);
  replayer.advanceFrame();
  assert.equal(replayer.state.frame, frozen.frame + 1, "恢复后应从暂停点继续");
});

test("单帧推进：每次只前进一个固定步长", () => {
  const replayer = new Replayer(buildSuccessRecording());
  const start = replayer.state.frame;
  replayer.stepOnce();
  assert.equal(replayer.paused, true);
  assert.equal(replayer.state.frame, start + 1);
  assert.ok(Math.abs(replayer.state.t - (start + 1) * DT) < 1e-12);
  replayer.stepOnce();
  assert.equal(replayer.state.frame, start + 2);
});

test("seek 后与连续回放的对应帧状态一致", () => {
  const recording = buildSuccessRecording();
  const continuous = runRecording(recording, { collect: true }).frames;
  const replayer = new Replayer(recording);
  replayer.seek(120);
  assert.deepEqual(snapshot(replayer.state), continuous[120]);
});

test("超载场景：张力超过额定值并记录事件", () => {
  const { state } = runRecording(buildOverloadRecording());
  assert.ok(state.maxTensionSeen > CONFIG.maxTension, "应超过额定张力");
  assert.ok(state.events.some((e) => e.type === "overload"), "应记录超载事件");
});

test("碰撞场景：检测到碰撞并终止", () => {
  const { state } = runRecording(buildCollisionRecording());
  assert.equal(state.result, "collision");
  assert.ok(state.events.some((e) => e.type === "collision"));
  assert.equal(state.finished, true);
});

test("离地时间：起吊后累计且落地后归零", () => {
  const { state, frames } = runRecording(buildSuccessRecording(), { collect: true });
  const airborne = frames.filter((f) => !f.onGround);
  assert.ok(airborne.length > 100, "大部分过程应处于离地状态");
  const last = frames[frames.length - 1];
  assert.equal(last.onGround, true);
  assert.ok(state.maxAirTime > 5);
});

test("命令序列带时间戳且可按帧检索", () => {
  const recording = buildSuccessRecording();
  for (const command of recording.commands) {
    assert.equal(typeof command.t, "number");
    assert.equal(command.t, Number((command.frame * DT).toFixed(6)));
    assert.ok(command.endFrame >= command.frame);
  }
  const input = inputAtFrame(recording, 10);
  assert.equal(typeof input.boomTargetVel, "number");
  assert.equal(typeof input.cableTargetVel, "number");
});

test("物理步长固定且初始状态确定", () => {
  const a = createInitialState();
  const b = createInitialState();
  assert.deepEqual(a, b);
  const stepped = step(createInitialState(), { boomTargetVel: 0.3, cableTargetVel: 0, brake: 0 });
  assert.equal(stepped.frame, 1);
  assert.equal(stepped.t, DT);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${tests.length} 项测试通过`);
