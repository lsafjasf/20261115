export const WORLD = Object.freeze({ width: 960, height: 620 });
export const STAGE = Object.freeze({ x: 480, y: 354, radiusX: 274, radiusY: 176 });
export const FOCUS = Object.freeze({ x: 480, y: 356 });
export const BASE_BEAT_MS = 600;
export const BEAT_MS = BASE_BEAT_MS;
export const OVEREXPOSED_AT = 0.8;

export const CAMERA_LIMITS = Object.freeze({
  x: [200, 760],
  y: [70, 235],
  focal: [28, 85],
});

export const LIGHT_FIXTURES = Object.freeze([
  { id: "A", x: 158, y: 310, label: "主灯 A", color: "#f4bb68" },
  { id: "B", x: 802, y: 292, label: "辅灯 B", color: "#ff7665" },
]);

export const ACTOR_PATH = Object.freeze([
  { x: 480, y: 278 },
  { x: 600, y: 303 },
  { x: 642, y: 358 },
  { x: 590, y: 412 },
  { x: 480, y: 435 },
  { x: 370, y: 410 },
  { x: 320, y: 354 },
  { x: 373, y: 300 },
]);

const SHOT_DEFINITIONS = Object.freeze([
  {
    id: 1,
    title: "右侧三分",
    short: "右三分 · 中近景",
    brief: "中近景。让演员落在画面右三分线内，保持单侧柔光。",
    focal: [50, 64],
    target: { x: [0.65, 0.79], y: [0.4, 0.58] },
    exposure: [0.45, 0.61],
    lens: "中焦",
  },
  {
    id: 2,
    title: "中央全景",
    short: "中央 · 全身",
    brief: "退到广角，把演员钉在画面中心；两盏灯要平衡，但别烧掉高光。",
    focal: [29, 41],
    target: { x: [0.43, 0.57], y: [0.36, 0.64] },
    exposure: [0.59, 0.76],
    lens: "广角",
  },
  {
    id: 3,
    title: "斜线近景",
    short: "左下 · 斜线",
    brief: "拉近并旋转机位，让演员压向左下三分点，用边缘光勾出轮廓。",
    focal: [54, 68],
    target: { x: [0.27, 0.42], y: [0.57, 0.71] },
    exposure: [0.34, 0.49],
    lens: "长焦",
  },
]);

const DEG = Math.PI / 180;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeAngle(degrees) {
  return ((degrees % 360) + 360) % 360;
}

export function angleDifference(a, b) {
  const difference = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(difference, 360 - difference);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function roundShot(definition, round) {
  const shrink = Math.max(0.56, 1 - (round - 1) * 0.12);
  const center = (range) => (range[0] + range[1]) / 2;
  const shrinkRange = (range) => {
    const midpoint = center(range);
    const half = ((range[1] - range[0]) / 2) * shrink;
    return [midpoint - half, midpoint + half];
  };

  return {
    ...definition,
    focal: [...definition.focal],
    exposure: [...definition.exposure],
    target: {
      x: shrinkRange(definition.target.x),
      y: shrinkRange(definition.target.y),
    },
    widthFactor: shrink,
  };
}

export function getShots(round = 1) {
  return SHOT_DEFINITIONS.map((definition) => roundShot(definition, round));
}

export function getBeatMs(round = 1) {
  return Math.max(440, BASE_BEAT_MS - (round - 1) * 38);
}

export function getActorPosition(beatIndex, beatProgress) {
  const current = ACTOR_PATH[beatIndex % ACTOR_PATH.length];
  const next = ACTOR_PATH[(beatIndex + 1) % ACTOR_PATH.length];
  const travelProgress = clamp(beatProgress / 0.34, 0, 1);
  const eased = easeOutCubic(travelProgress);
  return {
    x: lerp(current.x, next.x, eased),
    y: lerp(current.y, next.y, eased),
    step: easeOutCubic(clamp((beatProgress - 0.34) / 0.12, 0, 1)),
    currentIndex: beatIndex % ACTOR_PATH.length,
    nextIndex: (beatIndex + 1) % ACTOR_PATH.length,
  };
}

export function getCameraProjection(camera) {
  const dx = FOCUS.x - camera.x;
  const dy = FOCUS.y - camera.y;
  const distance = Math.hypot(dx, dy) || 1;
  const forward = { x: dx / distance, y: dy / distance };
  const right = { x: forward.y, y: -forward.x };
  const zoom = camera.focal / 50;
  return {
    camera: { x: camera.x, y: camera.y },
    forward,
    right,
    distance,
    zoom,
    halfWidth: 226 / zoom,
    halfDepth: 134 / zoom,
  };
}

export function projectActor(actor, camera) {
  const projection = getCameraProjection(camera);
  const dx = actor.x - FOCUS.x;
  const dy = actor.y - FOCUS.y;
  const localX = dx * projection.right.x + dy * projection.right.y;
  const localY = dx * projection.forward.x + dy * projection.forward.y;
  return {
    ...projection,
    x: 0.5 + localX / (projection.halfWidth * 2),
    y: 0.5 + localY / (projection.halfDepth * 2),
    localX,
    localY,
  };
}

export function unprojectPoint(screenX, screenY, camera) {
  const projection = getCameraProjection(camera);
  const localX = (screenX - 0.5) * projection.halfWidth * 2;
  const localY = (screenY - 0.5) * projection.halfDepth * 2;
  return {
    x: FOCUS.x + projection.right.x * localX + projection.forward.x * localY,
    y: FOCUS.y + projection.right.y * localX + projection.forward.y * localY,
  };
}

export function lightContribution(light, angle, actor) {
  const dx = actor.x - light.x;
  const dy = actor.y - light.y;
  const distance = Math.hypot(dx, dy);
  const actorAngle = (Math.atan2(dy, dx) / DEG + 360) % 360;
  const difference = angleDifference(angle, actorAngle);
  const coneHalf = 46;

  if (difference >= coneHalf || distance > 500) {
    return { amount: 0, difference, distance, inCone: false };
  }

  const alignment = 1 - difference / coneHalf;
  return {
    amount: 0.1 + 0.32 * alignment,
    difference,
    distance,
    inCone: true,
  };
}

export function calculateExposure(lights, actor) {
  const left = lightContribution(LIGHT_FIXTURES[0], lights[0].angle, actor);
  const right = lightContribution(LIGHT_FIXTURES[1], lights[1].angle, actor);
  return {
    amount: 0.07 + left.amount + right.amount,
    individual: [left, right],
  };
}

export function inRange(value, range) {
  return value >= range[0] && value <= range[1];
}

const FAILURE_COPY = {
  paused: "时间已冻结，按 P 继续后再拍摄。",
  outOfFrame: "主体出框：演员已越过取景边界。",
  overexposed: "高光过曝：两盏灯重叠在主体上了。",
  exposure: "曝光偏差：让测光游标落入绿色目标区。",
  composition: "构图窗口未成立：等待演员进入目标框。",
  focal: "焦距不符：先把镜头切换到任务要求的焦段。",
  complete: "这一轮已经完成。",
};

export class StudioEngine {
  constructor({ round = 1 } = {}) {
    this.reset(round);
  }

  reset(round = 1) {
    this.round = round;
    this.elapsedMs = 0;
    this.paused = false;
    this.shotIndex = 0;
    this.roundComplete = false;
    this.completedShots = [];
    this.failCount = 0;
    this.lastResult = null;
    this.flash = 0;
    this.camera = { x: 480, y: 124, focal: 50 };
    this.lights = [
      { angle: 6 },
      { angle: 184 },
    ];
    this.lastBeatIndex = 0;
    this.beatPulses = 0;
  }

  get beatMs() {
    return getBeatMs(this.round);
  }

  get shots() {
    return getShots(this.round);
  }

  get currentShot() {
    return this.shots[Math.min(this.shotIndex, this.shots.length - 1)];
  }

  get beatIndex() {
    return Math.floor(this.elapsedMs / this.beatMs);
  }

  get beatProgress() {
    return (this.elapsedMs % this.beatMs) / this.beatMs;
  }

  get actor() {
    return getActorPosition(this.beatIndex, this.beatProgress);
  }

  setPaused(value) {
    const next = Boolean(value);
    if (this.paused === next) return false;
    this.paused = next;
    return true;
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }

  setCamera(values) {
    if (values.x !== undefined) {
      this.camera.x = clamp(Number(values.x), ...CAMERA_LIMITS.x);
    }
    if (values.y !== undefined) {
      this.camera.y = clamp(Number(values.y), ...CAMERA_LIMITS.y);
    }
    if (values.focal !== undefined) {
      this.camera.focal = clamp(Number(values.focal), ...CAMERA_LIMITS.focal);
    }
  }

  setLightAngle(index, degrees) {
    if (!this.lights[index]) return;
    this.lights[index].angle = normalizeAngle(Number(degrees));
  }

  update(deltaMs) {
    const elapsed = Math.max(0, Number(deltaMs) || 0);
    this.flash = Math.max(0, this.flash - elapsed / 520);
    if (this.paused || this.roundComplete) {
      return { advanced: false, beatChanged: false, beatIndex: this.beatIndex };
    }

    const previousBeat = this.beatIndex;
    this.elapsedMs += elapsed;
    const nextBeat = this.beatIndex;
    const beatChanged = nextBeat !== previousBeat;
    if (beatChanged) {
      this.beatPulses += nextBeat - previousBeat;
      this.lastBeatIndex = nextBeat;
    }
    return { advanced: true, beatChanged, beatIndex: nextBeat };
  }

  analyze() {
    const shot = this.currentShot;
    const actor = this.actor;
    const projection = projectActor(actor, this.camera);
    const exposureResult = calculateExposure(this.lights, actor);
    const exposure = exposureResult.amount;
    const subjectInFrame =
      projection.x >= 0.035 &&
      projection.x <= 0.965 &&
      projection.y >= 0.04 &&
      projection.y <= 0.96;
    const insideTargetX = inRange(projection.x, shot.target.x);
    const insideTargetY = inRange(projection.y, shot.target.y);
    const framingReady = insideTargetX && insideTargetY;
    const focalReady = inRange(this.camera.focal, shot.focal);
    const exposureReady = inRange(exposure, shot.exposure);
    const overexposed = exposure > OVEREXPOSED_AT;
    const windowOpen = framingReady && focalReady && subjectInFrame;
    let ready = windowOpen && exposureReady && !overexposed;

    let reason = "ready";
    let message = "构图与曝光都已到位，现在按快门。";
    if (!subjectInFrame) {
      reason = "outOfFrame";
      message = FAILURE_COPY.outOfFrame;
    } else if (overexposed) {
      reason = "overexposed";
      message = FAILURE_COPY.overexposed;
    } else if (!focalReady) {
      reason = "focal";
      message = `焦距不符：当前 ${Math.round(this.camera.focal)}mm，目标 ${shot.focal[0]}–${shot.focal[1]}mm。`;
    } else if (!framingReady) {
      reason = "composition";
      message = FAILURE_COPY.composition;
    } else if (!exposureReady) {
      reason = "exposure";
      message = FAILURE_COPY.exposure;
    }
    if (this.roundComplete) {
      ready = false;
      reason = "complete";
      message = FAILURE_COPY.complete;
    }

    return {
      ready,
      complete: this.roundComplete,
      reason,
      message,
      shot,
      actor,
      projection,
      exposure,
      exposureResult,
      subjectInFrame,
      insideTargetX,
      insideTargetY,
      framingReady,
      focalReady,
      exposureReady,
      overexposed,
      windowOpen,
    };
  }

  capture() {
    if (this.paused) {
      return {
        ok: false,
        code: "paused",
        message: FAILURE_COPY.paused,
      };
    }

    if (this.roundComplete) {
      return {
        ok: false,
        code: "complete",
        message: FAILURE_COPY.complete,
      };
    }

    const analysis = this.analyze();
    this.flash = 1;
    if (!analysis.ready) {
      this.failCount += 1;
      this.lastResult = {
        ok: false,
        code: analysis.reason,
        message: analysis.message,
        shotId: analysis.shot.id,
      };
      return this.lastResult;
    }

    const result = {
      ok: true,
      code: "passed",
      message: `镜头 ${String(analysis.shot.id).padStart(2, "0")} 通过。`,
      shotId: analysis.shot.id,
      camera: { ...this.camera },
      lights: this.lights.map((light) => ({ ...light })),
      actor: { ...analysis.actor },
      exposure: analysis.exposure,
      projection: { x: analysis.projection.x, y: analysis.projection.y },
    };
    this.completedShots.push(result);
    this.lastResult = result;
    this.shotIndex += 1;

    if (this.shotIndex >= this.shots.length) {
      this.roundComplete = true;
      this.shotIndex = this.shots.length - 1;
      this.paused = true;
      this.lastResult = { ...result, code: "roundComplete" };
    }
    return result;
  }

  nextRound() {
    this.reset(this.round + 1);
    return this.round;
  }

  getClockSnapshot() {
    const actor = this.actor;
    return {
      elapsedMs: this.elapsedMs,
      paused: this.paused,
      beatIndex: this.beatIndex,
      beatProgress: this.beatProgress,
      beatPulses: this.beatPulses,
      beatMs: this.beatMs,
      actor: { x: actor.x, y: actor.y },
      roundComplete: this.roundComplete,
    };
  }

  getPublicState() {
    const analysis = this.analyze();
    return {
      round: this.round,
      shotIndex: this.shotIndex,
      roundComplete: this.roundComplete,
      paused: this.paused,
      completedShots: this.completedShots.map((shot) => ({ ...shot })),
      failCount: this.failCount,
      lastResult: this.lastResult,
      camera: { ...this.camera },
      lights: this.lights.map((light) => ({ ...light })),
      clock: this.getClockSnapshot(),
      analysis: {
        ready: analysis.ready,
        complete: analysis.complete,
        reason: analysis.reason,
        message: analysis.message,
        projection: analysis.projection
          ? { x: analysis.projection.x, y: analysis.projection.y }
          : null,
        exposure: analysis.exposure ?? 0,
        windowOpen: analysis.windowOpen ?? false,
        subjectInFrame: analysis.subjectInFrame ?? false,
        focalReady: analysis.focalReady ?? false,
        exposureReady: analysis.exposureReady ?? false,
        overexposed: analysis.overexposed ?? false,
      },
    };
  }
}
