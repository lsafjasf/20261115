import { TOTAL_STEPS } from "./constants.js";

// 发条时钟：以累积“步长”驱动，BPM 可在播放中任意改变。
// 1 步 = 1 个 16 分音符，秒长 = 15 / BPM。
export class Clock {
  constructor(bpm) {
    this.bpm = bpm;
    this.playing = false;
    this.loop = true;
    this.step = 0; // 浮点步位置
    this._acc = 0;
  }

setBpm(bpm) {
    this.bpm = bpm;
  }

  secondsPerStep() {
    return 15 / this.bpm;
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this._acc = 0;
  }

  pause() {
    this.playing = false;
  }

  stop() {
    this.playing = false;
    this.step = 0;
    this._acc = 0;
  }

  seek(step) {
    this.step = Math.max(0, Math.min(TOTAL_STEPS, step));
    this._acc = 0;
  }

  // 推进 dt 秒，返回新跨过的整数步列表（会按循环/结束处理）。
  advance(dt) {
    const crossed = [];
    if (!this.playing || dt <= 0) return crossed;
    this._acc += dt;
    let sps = this.secondsPerStep();
    while (this._acc >= sps) {
      this._acc -= sps;
      const next = Math.floor(this.step) + 1;
      if (next >= TOTAL_STEPS) {
        if (this.loop) {
          this.step = 0;
          crossed.push(0);
        } else {
          this.step = TOTAL_STEPS;
          this.playing = false;
          this._acc = 0;
          return crossed;
        }
      } else {
        this.step = next;
        crossed.push(next);
      }
      sps = this.secondsPerStep(); // 每步都重新取，调速立即生效
    }
    return crossed;
  }

  currentStep() {
    return Math.floor(this.step);
  }
}
