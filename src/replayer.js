// 回放引擎：与实时操作共用 step()，通过录制的命令序列确定性重建轨迹。

import { createInitialState, step, cargoSpeed } from "./physics.js";
import { inputAtFrame } from "./recorder.js";

export function snapshot(state) {
  return {
    frame: state.frame,
    t: state.t,
    angle: state.angle,
    angVel: state.angVel,
    length: state.length,
    lenVel: state.lenVel,
    swing: state.swing,
    swingVel: state.swingVel,
    cargoX: state.cargoX,
    cargoY: state.cargoY,
    cargoVx: state.cargoVx,
    cargoVy: state.cargoVy,
    tension: state.tension,
    speed: cargoSpeed(state),
    onGround: state.onGround,
  };
}

export function runRecording(recording, { collect = false, maxFrames = 60 * 60 } = {}) {
  let state = createInitialState();
  const frames = collect ? [snapshot(state)] : null;
  const lastFrame = recording.commands[recording.commands.length - 1]?.endFrame ?? 0;
  while (state.frame <= lastFrame && state.frame < maxFrames && !state.finished) {
    const input = inputAtFrame(recording, state.frame);
    state = step(state, input);
    if (collect) frames.push(snapshot(state));
  }
  return { state, frames, lastFrame };
}

export class Replayer {
  constructor(recording) {
    this.recording = recording;
    this.state = createInitialState();
    this.paused = false;
    this.lastFrame = recording.commands[recording.commands.length - 1]?.endFrame ?? 0;
  }

  advanceFrame() {
    if (this.state.finished || this.state.frame > this.lastFrame) {
      this.paused = true;
      return this.state;
    }
    const input = inputAtFrame(this.recording, this.state.frame);
    this.state = step(this.state, input);
    return this.state;
  }

  play() {
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  // 暂停状态下单帧推进；运行中调用会先自动暂停。
  stepOnce() {
    this.paused = true;
    return this.advanceFrame();
  }

  get ended() {
    return this.state.finished || this.state.frame > this.lastFrame;
  }

  seek(frame) {
    this.state = createInitialState();
    const target = Math.min(frame, this.lastFrame);
    while (this.state.frame < target && !this.state.finished) this.advanceFrame();
    return this.state;
  }
}

export function diffSnapshots(a, b, epsilon = 1e-9) {
  const keys = Object.keys(a).filter((k) => typeof a[k] === "number");
  const diffs = [];
  for (const key of keys) {
    const delta = Math.abs(a[key] - b[key]);
    if (delta > epsilon) diffs.push({ key, a: a[key], b: b[key], delta });
  }
  return diffs;
}
