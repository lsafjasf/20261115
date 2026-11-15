export const DEFAULTS = {
  feedDuration: 0.82,
  countdownDuration: 3.0,
  tolerance: 0.025,
  trimSpeed: 0.19,
  triggerGrace: 0.2,
  weldDuration: 1.35,
  settleDuration: 1.05,
  groupsToWin: 3,
  spareSets: 2
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class AssemblyEngine {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...options };
    this.random = options.random || Math.random;
    this.e2e = Boolean(options.e2e);
    this.events = [];
    this.reset();
  }

  reset() {
    this.phase = "feed";
    this.phaseElapsed = 0;
    this.clock = 0;
    this.countdown = 3;
    this.completed = 0;
    this.spares = this.config.spareSets;
    this.round = 1;
    this.weldProgress = 0;
    this.weldError = 0;
    this.failure = null;
    this.trim = { fixture: 0, torch: 0 };
    this.held = { fixture: false, torch: false };
    this.pressedAt = { fixture: null, torch: null };
    this.base = {
      fixture: 0.5 + this.feedOffset(),
      torch: 0.5 + this.feedOffset()
    };
    this.events = [];
  }

  feedOffset() {
    if (this.e2e) return Math.random() > 0.5 ? 0.052 : -0.052;
    const direction = this.random() > 0.5 ? 1 : -1;
    return direction * (0.038 + this.random() * 0.03);
  }

  setE2EOffsets(fixture, torch) {
    this.base.fixture = 0.5 + fixture;
    this.base.torch = 0.5 + torch;
  }

  get vibration() {
    if (this.phase === "countdown") return 0.0062;
    if (this.phase === "align") return 0.0017;
    if (this.phase === "feed") return 0.0007;
    if (this.phase === "welding") return 0.0011;
    return 0;
  }

  get fixturePosition() {
    const wave =
      Math.sin(this.clock * 29.7) * 0.68 +
      Math.sin(this.clock * 51.1 + 1.3) * 0.32;
    return clamp(this.base.fixture + wave * this.vibration, 0.35, 0.65);
  }

  get torchPosition() {
    const wave =
      Math.sin(this.clock * 33.1 + 2.4) * 0.7 +
      Math.sin(this.clock * 46.3 + 0.8) * 0.3;
    return clamp(this.base.torch + wave * this.vibration, 0.35, 0.65);
  }

  get fixtureError() {
    return this.fixturePosition - 0.5;
  }

  get torchError() {
    return this.torchPosition - 0.5;
  }

  get sync() {
    const error = Math.abs(this.fixtureError - this.torchError);
    return clamp(1 - error / 0.105, 0, 1);
  }

  get alignment() {
    const worst = Math.max(
      Math.abs(this.fixtureError),
      Math.abs(this.torchError)
    );
    return clamp(1 - worst / (this.config.tolerance * 2.6), 0, 1);
  }

  get inTolerance() {
    return (
      Math.abs(this.fixtureError) <= this.config.tolerance &&
      Math.abs(this.torchError) <= this.config.tolerance
    );
  }

  setTrim(side, direction) {
    if (side !== "fixture" && side !== "torch") return;
    this.trim[side] = clamp(Math.sign(direction), -1, 1);
  }

  pressTrigger(side) {
    if (side !== "fixture" && side !== "torch") return;
    if (this.held[side]) return;
    if (["failed", "success"].includes(this.phase)) return;

    if (this.phase === "feed" || this.phase === "countdown") {
      this.fail(
        "EARLY_TRIGGER",
        "提前触发",
        "进料/倒计时尚未结束，单侧触发已损坏零件。"
      );
      return;
    }

    if (this.phase !== "align") return;

    this.held[side] = true;
    this.pressedAt[side] = this.clock;
    this.events.push({ type: "trigger", side });

    const other = side === "fixture" ? "torch" : "fixture";
    if (!this.held[other]) return;

    const gap = Math.abs(this.pressedAt[side] - this.pressedAt[other]);
    if (gap > this.config.triggerGrace) {
      this.fail(
        "ONE_SIDE_LATE",
        "单侧提前触发",
        "另一侧未在同步窗口内到位，零件局部熔穿。"
      );
      return;
    }

    if (!this.inTolerance) {
      this.fail(
        "OFFSET_FAULT",
        "定位偏差超限",
        "两侧触发已同步，但至少一侧未进入 ±25 μm 定位带。"
      );
      return;
    }

    this.beginWeld();
  }

  releaseTrigger(side) {
    if (side !== "fixture" && side !== "torch") return;
    const wasHeld = this.held[side];
    this.held[side] = false;
    this.pressedAt[side] = null;
    const other = side === "fixture" ? "torch" : "fixture";
    if (this.phase === "align" && wasHeld && !this.held[other]) {
      this.fail(
        "SINGLE_OPERATOR",
        "单侧提前触发",
        "同步窗口内没有检测到另一侧触发，零件已损坏。"
      );
      return;
    }
    if (this.phase === "welding") {
      this.fail(
        "TRIGGER_RELEASED",
        "焊接中断",
        "焊接保持被释放，电弧离开焊缝。"
      );
    }
  }

  beginWeld() {
    this.phase = "welding";
    this.phaseElapsed = 0;
    this.weldProgress = 0;
    this.weldError = Math.max(
      Math.abs(this.fixtureError),
      Math.abs(this.torchError)
    );
    this.events.push({ type: "weld-start", sync: this.sync, error: this.weldError });
  }

  fail(code, title, text) {
    if (this.phase === "failed") return;
    this.phase = "failed";
    this.phaseElapsed = 0;
    this.spares = Math.max(0, this.spares - 1);
    this.failure = { code, title, text };
    this.held = { fixture: false, torch: false };
    this.pressedAt = { fixture: null, torch: null };
    this.events.push({ type: "fail", code, title });
  }

  completeRound() {
    this.completed += 1;
    this.phase = "complete";
    this.phaseElapsed = 0;
    this.events.push({
      type: "weld-complete",
      completed: this.completed,
      sync: this.sync
    });
  }

  nextRound() {
    if (this.completed >= this.config.groupsToWin) {
      this.phase = "success";
      this.phaseElapsed = 0;
      this.events.push({
        type: "success",
        completed: this.completed,
        spares: this.spares
      });
      return;
    }

    this.round = this.completed + 1;
    this.phase = "feed";
    this.phaseElapsed = 0;
    this.countdown = 3;
    this.weldProgress = 0;
    this.weldError = 0;
    this.trim = { fixture: 0, torch: 0 };
    this.held = { fixture: false, torch: false };
    this.pressedAt = { fixture: null, torch: null };
    this.base = {
      fixture: 0.5 + this.feedOffset(),
      torch: 0.5 + this.feedOffset()
    };
    this.events.push({ type: "round-start", round: this.round });
  }

  update(deltaSeconds) {
    const dt = clamp(deltaSeconds, 0, 0.05);
    this.clock += dt;
    this.phaseElapsed += dt;

    if (this.phase === "feed") {
      this.updateTrim(dt);
      if (this.phaseElapsed >= this.config.feedDuration) {
        this.phase = "countdown";
        this.phaseElapsed = 0;
        this.events.push({ type: "countdown-start", round: this.round });
      }
      return;
    }

    if (this.phase === "countdown") {
      this.updateTrim(dt);
      this.countdown = Math.max(
        0,
        Math.ceil(3 - (this.phaseElapsed / this.config.countdownDuration) * 3)
      );
      if (this.phaseElapsed >= this.config.countdownDuration) {
        this.phase = "align";
        this.phaseElapsed = 0;
        this.countdown = 0;
        this.events.push({ type: "align-start", round: this.round });
      }
      return;
    }

    if (this.phase === "align") {
      this.updateTrim(dt);
      const onlySide =
        this.held.fixture && !this.held.torch
          ? "fixture"
          : this.held.torch && !this.held.fixture
            ? "torch"
            : null;
      if (onlySide) {
        const heldFor = this.clock - this.pressedAt[onlySide];
        if (heldFor >= this.config.triggerGrace) {
          this.fail(
            "SINGLE_OPERATOR",
            "单侧提前触发",
            "同步窗口内没有检测到另一侧触发，零件已损坏。"
          );
        }
      }
      return;
    }

    if (this.phase === "welding") {
      if (!this.held.fixture || !this.held.torch) {
        this.fail(
          "TRIGGER_RELEASED",
          "焊接中断",
          "焊接过程中触发被释放，电弧偏离焊缝。"
        );
        return;
      }
      this.weldProgress = clamp(
        this.weldProgress + dt / this.config.weldDuration,
        0,
        1
      );
      if (this.weldProgress >= 1) this.completeRound();
      return;
    }

    if (this.phase === "complete") {
      if (this.phaseElapsed >= this.config.settleDuration) this.nextRound();
    }
  }

  updateTrim(dt) {
    this.base.fixture = clamp(
      this.base.fixture + this.trim.fixture * this.config.trimSpeed * dt,
      0.36,
      0.64
    );
    this.base.torch = clamp(
      this.base.torch + this.trim.torch * this.config.trimSpeed * dt,
      0.36,
      0.64
    );
  }

  consumeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  snapshot() {
    return {
      phase: this.phase,
      phaseElapsed: this.phaseElapsed,
      countdown: this.countdown,
      completed: this.completed,
      spares: this.spares,
      round: this.round,
      fixtureError: this.fixtureError,
      torchError: this.torchError,
      fixturePosition: this.fixturePosition,
      torchPosition: this.torchPosition,
      inTolerance: this.inTolerance,
      sync: this.sync,
      alignment: this.alignment,
      weldProgress: this.weldProgress,
      held: { ...this.held },
      failure: this.failure,
      vibration: this.vibration,
      groupsToWin: this.config.groupsToWin,
      spareSets: this.config.spareSets
    };
  }
}
