// 端到端场景：真实驱动物理引擎，演示重箱转运成功与极限外伸侧翻失败。

import {
  CRANE,
  PONTOON,
  createState,
  drainEvents,
  getLoadRatio,
  hookPoint,
  solveForTarget,
  step,
} from "../src/engine.js";

const DT = 1 / 60;

function moveToward(state, target, tolerance) {
  let frames = 0;
  let peakTilt = 0;
  while (frames < 3600) {
    const solution = solveForTarget(state, target.x, target.y);
    const input = { boom: 0, trolley: 0, hook: false };
    const guarding = Math.abs(state.tilt) > 0.22;
    if (!guarding) {
      if (Math.abs(solution.boom - state.boom) > 0.01) {
        input.boom = Math.sign(solution.boom - state.boom);
      }
      if (Math.abs(solution.trolley - state.trolley) > 0.03) {
        input.trolley = Math.sign(solution.trolley - state.trolley);
      }
    }
    step(state, input, DT);
    peakTilt = Math.max(peakTilt, Math.abs(state.tilt));
    const hook = hookPoint(state);
    if (Math.hypot(hook.x - target.x, hook.y - target.y) < tolerance) {
      return { frames, peakTilt };
    }
    if (state.status !== "running") {
      return { frames, peakTilt, interrupted: state.status };
    }
    frames += 1;
  }
  throw new Error("移动超时");
}

function scenarioFullDelivery() {
  const state = createState({ wave: { on: false } });
  const log = [];
  for (const boxId of ["light", "medium", "heavy"]) {
    const box = state.boxes.find((item) => item.id === boxId);
    moveToward(state, { x: box.x, y: box.y }, 0.4);
    step(state, { hook: true }, DT);
    drainEvents(state);

    const loadBefore = getLoadRatio(state);
    const result = moveToward(
      state,
      { x: 5.35, y: 1.6 },
      1.0
    );
    step(state, { hook: true }, DT);
    const events = drainEvents(state);
    log.push({
      boxId,
      loadRatio: loadBefore.toFixed(2),
      peakTiltDeg: ((result.peakTilt * 180) / Math.PI).toFixed(1),
      delivered: events.some((event) => event.type === "delivered"),
    });
  }

  for (let index = 0; index < 480 && Math.abs(state.tilt) > 0.05; index += 1) {
    step(state, undefined, DT);
  }
  return { status: state.status, finalTiltDeg: ((state.tilt * 180) / Math.PI).toFixed(1), log };
}

function scenarioCapsize() {
  const state = createState({ wave: { on: false } });
  const box = state.boxes.find((item) => item.id === "heavy");
  moveToward(state, { x: box.x, y: box.y }, 0.4);
  step(state, { hook: true }, DT);
  drainEvents(state);

  state.boom = CRANE.boomMin;
  state.trolley = CRANE.trolleyMax;
  state.swing = 0;
  state.swingVel = 0;

  let frames = 0;
  while (state.status === "running" && frames < 1500) {
    step(state, undefined, DT);
    frames += 1;
  }
  const events = drainEvents(state);
  return {
    status: state.status,
    tiltDeg: ((state.tilt * 180) / Math.PI).toFixed(1),
    thresholdDeg: ((PONTOON.capsizeAngle * 180) / Math.PI).toFixed(1),
    capsizeEvent: events.some((event) => event.type === "capsize"),
    seconds: (frames * DT).toFixed(2),
  };
}

console.log("== 场景一：三只货箱（含重箱）完整转运 ==");
const delivery = scenarioFullDelivery();
console.table(delivery.log);
console.log("终局：", delivery.status, "最终倾角：", delivery.finalTiltDeg, "°\n");

console.log("== 场景二：重箱极限外伸导致侧翻 ==");
console.table(scenarioCapsize());
