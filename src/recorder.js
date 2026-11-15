// 指令录制：把每个仿真帧的输入保存为带时间戳的命令序列。
// 回放只依赖该序列，不依赖鼠标、时钟或音频，因此可跨页面重载复现同一轨迹。

import { DT } from "./physics.js";

const SCHEMA_VERSION = 1;

export function createRecording(meta = {}) {
  return {
    schema: SCHEMA_VERSION,
    dt: DT,
    createdAt: meta.createdAt ?? null,
    name: meta.name ?? "未命名吊装",
    commands: [],
  };
}

export function recordFrame(recording, frame, input) {
  const command = {
    frame,
    endFrame: frame,
    t: Number((frame * DT).toFixed(6)),
    input: normalizeInput(input),
  };
  const last = recording.commands[recording.commands.length - 1];
  if (last && shallowEqual(last.input, command.input)) {
    last.endFrame = frame;
  } else {
    recording.commands.push(command);
  }
}

function normalizeInput(input) {
  return {
    boomTargetVel: input.boomTargetVel ?? 0,
    cableTargetVel: input.cableTargetVel ?? 0,
    brake: input.brake ?? 0,
    brakeCurve: input.brakeCurve,
  };
}

function shallowEqual(a, b) {
  if (a.boomTargetVel !== b.boomTargetVel) return false;
  if (a.cableTargetVel !== b.cableTargetVel) return false;
  if (a.brake !== b.brake) return false;
  return JSON.stringify(a.brakeCurve) === JSON.stringify(b.brakeCurve);
}

// 展开压缩后的命令序列，按帧取输入（缺失帧沿用上一条）。
export function inputAtFrame(recording, frame) {
  let active = recording.commands[0]?.input;
  for (const command of recording.commands) {
    if (frame > command.endFrame) continue;
    if (frame >= command.frame) active = command.input;
    break;
  }
  return active;
}

export function serializeRecording(recording) {
  return JSON.stringify(recording);
}

export function parseRecording(text) {
  const data = typeof text === "string" ? JSON.parse(text) : text;
  if (data.schema !== SCHEMA_VERSION) {
    throw new Error(`不支持的记录版本: ${data.schema}`);
  }
  if (!Array.isArray(data.commands)) throw new Error("记录缺少 commands 序列");
  return data;
}
