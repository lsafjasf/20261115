// 脚本化吊装场景：不依赖鼠标/时钟，逐帧生成确定性命令，供测试与页面演示共用。

import { DT, CONFIG } from "./physics.js";
import { createRecording, recordFrame } from "./recorder.js";

function sec(v) {
  return Math.round(v / DT);
}

export function buildSuccessRecording() {
  const recording = createRecording({ name: "标准成功吊装", createdAt: null });
  const total = sec(17);
  for (let frame = 0; frame < total; frame++) {
    const t = frame * DT;
    const input = { boomTargetVel: 0, cableTargetVel: 0, brake: 0.55 };

    if (t < 1.1) {
      input.cableTargetVel = -55; // 垂直起升，越过障碍
    } else if (t >= 1.1 && t < 2.0) {
      input.brake = 0.9;
    } else if (t >= 2.0 && t < 4.7) {
      input.boomTargetVel = -0.15; // 回摆到目标上方，慢速抑制摆动
    } else if (t >= 4.4 && t < 5.4) {
      input.brake = 1.0;
    } else if (t >= 5.4 && t < 13.6) {
      input.cableTargetVel = 26; // 放缆下降
    } else {
      input.brake = 1.0;
    }
    recordFrame(recording, frame, input);
  }
  return recording;
}

export function buildOverloadRecording() {
  const recording = createRecording({ name: "急停超载演示", createdAt: null });
  for (let frame = 0; frame < sec(6); frame++) {
    const t = frame * DT;
    const input = { boomTargetVel: 0, cableTargetVel: 0, brake: 0 };
    if (t < 0.8) input.cableTargetVel = -CONFIG.maxCableSpeed;
    else if (t < 1.6) input.boomTargetVel = CONFIG.maxBoomSpeed;
    else if (t < 2.6) input.boomTargetVel = -CONFIG.maxBoomSpeed;
    else input.boomTargetVel = 0;
    recordFrame(recording, frame, input);
  }
  return recording;
}

export function buildCollisionRecording() {
  const recording = createRecording({ name: "碰撞演示", createdAt: null });
  for (let frame = 0; frame < sec(8); frame++) {
    const t = frame * DT;
    const input = { boomTargetVel: 0, cableTargetVel: 0, brake: 0 };
    if (t < 1.6) input.cableTargetVel = 42;
    else if (t < 4.5) input.boomTargetVel = CONFIG.maxBoomSpeed * 0.4;
    recordFrame(recording, frame, input);
  }
  return recording;
}
