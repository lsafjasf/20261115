import {
  CRANE,
  PONTOON,
  centerOfMass,
  createState,
  effectiveBoom,
  hookPoint,
  solveForTarget,
  step,
} from "../src/engine.js";

function settle(state, seconds = 20) {
  for (let index = 0; index < seconds * 60; index += 1) {
    step(state, undefined, 1 / 60);
    if (state.status !== "running") break;
  }
}

for (const waveOn of [false, true]) {
  const state = createState({ wave: { on: waveOn } });
  settle(state);
  const com = centerOfMass(state);
  console.log(
    `wave=${waveOn} 空载: status=${state.status} tilt=${state.tilt.toFixed(3)} comX=${com.x.toFixed(2)}`
  );
}

for (const boxId of ["light", "medium", "heavy"]) {
  const state = createState({ wave: { on: false } });
  const box = state.boxes.find((item) => item.id === boxId);
  const solution = solveForTarget(state, box.x, box.y);
  state.boom = solution.boom;
  state.trolley = solution.trolley;
  state.swing = solution.swing;
  step(state, { hook: true }, 1 / 60);
  settle(state, 12);
  const hook = hookPoint(state);
  console.log(
    `${boxId} 驳船处挂钩: status=${state.status} tilt=${state.tilt.toFixed(3)} hook=(${hook.x.toFixed(2)},${hook.y.toFixed(2)}) sag=${(state.boom - effectiveBoom(state)).toFixed(3)}`
  );
}

for (const travel of [4, 5.5, 7.2]) {
  const state = createState({ wave: { on: false } });
  const box = state.boxes.find((item) => item.id === "heavy");
  const solution = solveForTarget(state, box.x, box.y);
  state.boom = solution.boom;
  state.trolley = solution.trolley;
  state.swing = solution.swing;
  step(state, { hook: true }, 1 / 60);
  state.boom = CRANE.boomMin; // 负角度 = 吊臂压向岸侧（右）
  state.trolley = travel;
  state.swing = 0;
  state.swingVel = 0;
  settle(state, 12);
  const com = centerOfMass(state);
  console.log(
    `重箱外伸 ${travel}: status=${state.status} tilt=${state.tilt.toFixed(3)} comX=${com.x.toFixed(2)}`
  );
}

const cap = PONTOON.capsizeAngle;
console.log(`侧翻阈值=${cap} rad (${(cap * 180 / Math.PI).toFixed(1)}°)`);
