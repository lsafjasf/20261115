import test from "node:test";
import assert from "node:assert/strict";

import {
  BARGE,
  BOX_SPEC,
  CRANE,
  PONTOON,
  SHORE,
  centerOfMass,
  createState,
  drainEvents,
  effectiveBoom,
  getHangingBox,
  hookPoint,
  isOverloaded,
  solveForTarget,
  step,
} from "../src/engine.js";

const DT = 1 / 60;

function runUntil(state, predicate, maxSeconds = 60) {
  let frames = Math.round(maxSeconds / DT);
  while (frames > 0 && !predicate(state)) {
    step(state, undefined, DT);
    frames -= 1;
  }
  assert.ok(predicate(state), `条件在 ${maxSeconds}s 内未达成（status=${state.status}）`);
}

function moveToward(state, target, tolerance = 0.4, maxSeconds = 30) {
  let frames = Math.round(maxSeconds / DT);
  let stuckFrames = 0;
  let lastDistance = Infinity;
  while (frames > 0) {
    const solution = solveForTarget(state, target.x, target.y);
    const input = { boom: 0, trolley: 0, hook: false };
    // 倾角保护：接近侧翻阈值时暂停水平移动，让浮筏回稳后再继续。
    const tiltGuard = Math.abs(state.tilt) > 0.22;
    if (!tiltGuard) {
      if (Math.abs(solution.boom - state.boom) > 0.01) {
        input.boom = Math.sign(solution.boom - state.boom);
      }
      if (Math.abs(solution.trolley - state.trolley) > 0.03) {
        input.trolley = Math.sign(solution.trolley - state.trolley);
      }
    }
    const hook = hookPoint(state);
    const distance = Math.hypot(hook.x - target.x, hook.y - target.y);
    const settled = distance < tolerance;
    if (settled) {
      return;
    }
    const idle = input.boom === 0 && input.trolley === 0;
    if (!tiltGuard && idle && Math.abs(distance - lastDistance) < 0.0005) {
      stuckFrames += 1;
    } else {
      stuckFrames = 0;
    }
    lastDistance = distance;
    if (stuckFrames > 120) {
      throw new Error(
        `控制器在目标附近卡死：distance=${distance.toFixed(2)} phi=${state.boom.toFixed(2)} travel=${state.trolley.toFixed(2)}`
      );
    }
    step(state, input, DT);
    if (state.status !== "running") {
      throw new Error(`移动途中浮筏进入终局：${state.status}`);
    }
    frames -= 1;
  }
  throw new Error("移动到目标超时");
}

function attachBox(state, boxId) {
  const box = state.boxes.find((item) => item.id === boxId);
  moveToward(state, { x: box.x, y: box.y }, 0.4);
  const before = hookPoint(state);
  assert.ok(
    Math.hypot(before.x - box.x, before.y - box.y) <= CRANE.attachRadius,
    "挂钩位置必须在吸附半径内"
  );
  step(state, { hook: true }, DT);
  assert.equal(box.location, "hook");
  assert.equal(getHangingBox(state).id, boxId);
}

function deliverBox(state, boxId) {
  attachBox(state, boxId);
  const target = { x: SHORE.x + 0.35, y: SHORE.deckY + 1.4 };
  moveToward(state, target, 1.0);
  assert.ok(hookPoint(state).x > SHORE.x - 0.4, "脱钩前应位于岸台上空");
  step(state, { hook: true }, DT);
  const box = state.boxes.find((item) => item.id === boxId);
  assert.equal(box.location, "delivered");
}

test("初始状态：三只货箱在驳船，浮筏水平，无载荷", () => {
  const state = createState({ wave: { on: false } });
  assert.equal(state.boxes.length, 3);
  assert.ok(state.boxes.every((box) => box.location === "barge"));
  assert.equal(state.status, "running");
  assert.equal(Math.abs(state.tilt) < 0.001, true);
  assert.equal(getHangingBox(state), null);
  assert.equal(isOverloaded(state), false);
});

test("场景一：自动操作员依次完成三只货箱（含重箱）转运并获胜", () => {
  const state = createState({ wave: { on: false } });
  const deliveredOrder = [];

  for (const boxId of ["light", "medium", "heavy"]) {
    deliverBox(state, boxId);
    deliveredOrder.push(boxId);
    if (boxId === "heavy") {
      // 重箱在钩时验证过载与吊臂下垂确实发生。
    }
    const events = drainEvents(state);
    assert.ok(events.some((event) => event.type === "delivered"));
    assert.ok(
      state.status === "running" || state.status === "won",
      `交货后状态应为 running 或 won，实际为 ${state.status}`
    );
  }

  assert.deepEqual(deliveredOrder, ["light", "medium", "heavy"]);
  assert.equal(state.status, "won");
  assert.ok(
    state.boxes.every((box) => box.location === "delivered"),
    "三箱均应位于岸台"
  );
  runUntil(state, (current) => Math.abs(current.tilt) < 0.05, 8);
  assert.ok(Math.abs(state.tilt) < 0.12, "完成后浮筏应恢复平稳");
});

test("重箱载荷导致吊臂下垂且触发过载状态", () => {
  const state = createState({ wave: { on: false } });
  attachBox(state, "heavy");
  assert.equal(isOverloaded(state), true);
  assert.ok(effectiveBoom(state) < state.boom, "重箱应使吊臂角度下垂");

  const lightState = createState({ wave: { on: false } });
  attachBox(lightState, "light");
  assert.equal(isOverloaded(lightState), false);
  assert.ok(
    state.boom - effectiveBoom(state) >
      lightState.boom - effectiveBoom(lightState),
    "重箱下垂量应明显大于轻箱"
  );
});

test("场景二：重箱外伸到极限，重心越过恢复能力后侧翻失败", () => {
  const state = createState({ wave: { on: false } });
  attachBox(state, "heavy");

  // 直接把小车推到最大行程、吊臂压到最低，制造最陡的侧倾力矩。
  state.boom = CRANE.boomMin;
  state.trolley = CRANE.trolleyMax;
  state.swing = 0;
  state.swingVel = 0;

  const com = centerOfMass(state);
  assert.ok(com.x > 1.5, "重箱极限外伸时重心应显著偏向吊臂一侧");

  runUntil(state, (current) => current.status === "capsized", 25);
  assert.equal(state.status, "capsized");
  assert.ok(Math.abs(state.tilt) >= PONTOON.capsizeAngle - 1e-9);
  assert.ok(
    state.events.some((event) => event.type === "capsize"),
    "应发出侧翻事件供 UI/音频反馈"
  );
});

test("浪涌会周期性推动浮筏，但平稳操作不侧翻", () => {
  const state = createState({
    wave: { on: true, amp: 26000, period: 6, phase: 0 },
  });
  runUntil(state, (current) => current.time > 8, 9);
  assert.equal(state.status, "running");
  assert.ok(Math.abs(state.tilt) > 0.01, "浪涌应产生可测倾角");
  assert.ok(Math.abs(state.tilt) < PONTOON.capsizeAngle);
});

test("在水面上空脱钩会导致货箱落水失败", () => {
  const state = createState({ wave: { on: false } });
  attachBox(state, "medium");
  moveToward(state, { x: 4.4, y: -0.2 });
  step(state, { hook: true }, DT);
  const box = state.boxes.find((item) => item.id === "medium");
  assert.equal(box.location, "sunk");
  assert.equal(
    state.boxes.filter((item) => item.location === "delivered").length,
    0
  );
});

test("货箱数据覆盖轻/中/重三档", () => {
  assert.deepEqual(BOX_SPEC.map((spec) => spec.id), ["light", "medium", "heavy"]);
  assert.ok(BOX_SPEC[2].mass > BOX_SPEC[1].mass);
  assert.ok(BOX_SPEC[1].mass > BOX_SPEC[0].mass);
  assert.ok(BARGE.x < -PONTOON.width / 2);
  assert.ok(SHORE.x > PONTOON.width / 2);
});
