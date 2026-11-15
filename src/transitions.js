import { renderScene } from "./scenes.js";

export const PRE_ROLL = 3.2;
export const TAIL = 2.2;
export const TRANSITION_TYPES = ["push", "wipe", "fog"];
export const DIRECTIONS = ["ltr", "rtl", "ttb", "btt"];

export function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function sampleTimeline(clock, duration = 2, preRoll = PRE_ROLL) {
  const safeClock = Math.max(0, Number(clock) || 0);
  const transitionStart = preRoll;
  const transitionEnd = preRoll + duration;
  const phase = clamp((safeClock - transitionStart) / duration);
  const inTransition =
    safeClock >= transitionStart && safeClock <= transitionEnd;
  const mode =
    safeClock < transitionStart ? "a" : safeClock > transitionEnd ? "b" : "transition";

  return {
    clock: safeClock,
    phase,
    mode,
    inTransition,
    aTime: safeClock,
    bTime: Math.max(0, safeClock - transitionStart),
    transitionStart,
    transitionEnd,
  };
}

export function timelineLength(duration, preRoll = PRE_ROLL, tail = TAIL) {
  return preRoll + duration + tail;
}

function makeSurface(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  return { canvas, ctx };
}

function fillBackdrop(ctx, width, height) {
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, width, height);
}

export function createTransitionRenderer(width, height) {
  const sourceA = makeSurface(width, height);
  const sourceB = makeSurface(width, height);
  const maskedB = makeSurface(width, height);
  const mask = makeSurface(width, height);

  function drawPush(ctx, progress, direction) {
    if (direction === "ltr" || direction === "rtl") {
      const shift = Math.round(progress * width);
      fillBackdrop(ctx, width, height);
      if (direction === "ltr") {
        ctx.drawImage(sourceA.canvas, shift, 0);
        ctx.drawImage(sourceB.canvas, shift - width, 0);
      } else {
        ctx.drawImage(sourceA.canvas, -shift, 0);
        ctx.drawImage(sourceB.canvas, width - shift, 0);
      }
      return;
    }

    const shift = Math.round(progress * height);
    fillBackdrop(ctx, width, height);
    if (direction === "ttb") {
      ctx.drawImage(sourceA.canvas, 0, shift);
      ctx.drawImage(sourceB.canvas, 0, shift - height);
    } else {
      ctx.drawImage(sourceA.canvas, 0, -shift);
      ctx.drawImage(sourceB.canvas, 0, height - shift);
    }
  }

  function wipePath(ctx, progress, direction) {
    const amplitude = ((direction === "ltr" || direction === "rtl") ? height : width) *
      0.027 *
      Math.sin(Math.PI * progress);
    ctx.beginPath();
    if (direction === "ltr" || direction === "rtl") {
      const edge = width * (direction === "ltr" ? progress : 1 - progress);
      for (let y = 0; y <= height; y += 6) {
        const x = edge + Math.sin(y * 0.026 + progress * 8) * amplitude;
        if (y === 0) ctx.moveTo(direction === "ltr" ? -2 : x, y);
        else ctx.lineTo(x, y);
      }
      if (direction === "ltr") {
        ctx.lineTo(edge, height);
        ctx.lineTo(-2, height);
      } else {
        ctx.lineTo(width + 2, height);
        ctx.lineTo(width + 2, 0);
      }
    } else {
      const edge = height * (direction === "ttb" ? progress : 1 - progress);
      for (let x = 0; x <= width; x += 6) {
        const y = edge + Math.sin(x * 0.022 - progress * 7) * amplitude;
        if (x === 0) ctx.moveTo(x, direction === "ttb" ? -2 : y);
        else ctx.lineTo(x, y);
      }
      if (direction === "ttb") {
        ctx.lineTo(width, edge);
        ctx.lineTo(width, -2);
      } else {
        ctx.lineTo(width, height + 2);
        ctx.lineTo(0, height + 2);
      }
    }
    ctx.closePath();
  }

  function drawWipe(ctx, progress, direction) {
    ctx.drawImage(sourceA.canvas, 0, 0);
    if (progress <= 0) return;
    ctx.save();
    wipePath(ctx, progress, direction);
    ctx.clip();
    ctx.drawImage(sourceB.canvas, 0, 0);
    ctx.restore();
  }

  function fogMask(progress, direction, time) {
    const mctx = mask.ctx;
    mctx.clearRect(0, 0, width, height);
    const horizontal = direction === "ltr" || direction === "rtl";
    const depth = horizontal ? width : height;
    const envelope = Math.sin(Math.PI * progress);
    const feather = depth * 0.19 * envelope;
    const edge = depth * (direction === "ltr" || direction === "ttb" ? progress : 1 - progress);
    let gradient;

    if (horizontal) {
      gradient = mctx.createLinearGradient(edge - feather, 0, edge + feather, 0);
    } else {
      gradient = mctx.createLinearGradient(0, edge - feather, 0, edge + feather);
    }

    const bOnHighSide = direction === "rtl" || direction === "btt";
    gradient.addColorStop(0, bOnHighSide ? "rgba(255,255,255,0)" : "#fff");
    gradient.addColorStop(1, bOnHighSide ? "#fff" : "rgba(255,255,255,0)");
    mctx.fillStyle = gradient;
    mctx.fillRect(0, 0, width, height);

    mctx.save();
    mctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 11; i += 1) {
      const u = (i + 0.5) / 11;
      const offset = Math.sin(i * 7.3 + time * 0.55) * feather * 0.7;
      const radius = depth * (0.06 + 0.025 * Math.sin(i * 2.1 + time * 0.7));
      const x = horizontal ? edge + offset : u * width;
      const y = horizontal ? u * height : edge + offset;
      const hole = mctx.createRadialGradient(x, y, 0, x, y, radius);
      hole.addColorStop(0, `rgba(0,0,0,${0.5 * envelope})`);
      hole.addColorStop(1, "rgba(0,0,0,0)");
      mctx.fillStyle = hole;
      mctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    mctx.restore();
  }

  function drawFogVeil(ctx, progress, direction, time) {
    const envelope = Math.sin(Math.PI * progress);
    if (envelope <= 0) return;
    const horizontal = direction === "ltr" || direction === "rtl";
    const depth = horizontal ? width : height;
    const edge = depth * (direction === "ltr" || direction === "ttb" ? progress : 1 - progress);
    const radius = depth * 0.17;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 7; i += 1) {
      const u = (i + 0.5) / 7;
      const offset = Math.sin(i * 5.7 + time * 0.45) * radius * 0.7;
      const x = horizontal ? edge + offset : u * width;
      const y = horizontal ? u * height : edge + offset;
      const mist = ctx.createRadialGradient(x, y, 0, x, y, radius);
      mist.addColorStop(0, `rgba(195, 235, 255, ${0.1 * envelope})`);
      mist.addColorStop(1, "rgba(195, 235, 255, 0)");
      ctx.fillStyle = mist;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.restore();
  }

  function drawFog(ctx, progress, direction, time) {
    fogMask(progress, direction, time);
    maskedB.ctx.clearRect(0, 0, width, height);
    maskedB.ctx.drawImage(sourceB.canvas, 0, 0);
    maskedB.ctx.globalCompositeOperation = "destination-in";
    maskedB.ctx.drawImage(mask.canvas, 0, 0);
    maskedB.ctx.globalCompositeOperation = "source-over";

    ctx.drawImage(sourceA.canvas, 0, 0);
    ctx.drawImage(maskedB.canvas, 0, 0);
    drawFogVeil(ctx, progress, direction, time);
  }

  function drawClockHud(ctx, state) {
    const text = `A ${state.aTime.toFixed(2)}s  |  B ${
      state.mode === "a" ? "standby" : `${state.bTime.toFixed(2)}s`
    }`;
    ctx.save();
    ctx.font = '600 10px "SFMono-Regular", Consolas, monospace';
    const boxWidth = Math.ceil(ctx.measureText(text).width) + 18;
    const x = (width - boxWidth) / 2;
    const y = height - 29;
    ctx.fillStyle = "rgba(4, 8, 17, 0.68)";
    ctx.fillRect(x, y, boxWidth, 20);
    ctx.strokeStyle = "rgba(210, 232, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, 19);
    ctx.fillStyle = "rgba(225, 239, 255, 0.92)";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 9, y + 10.5);
    ctx.restore();
  }

  return {
    sourceA,
    sourceB,
    renderAt(ctx, { time, duration, preRoll = PRE_ROLL, type, direction }) {
      const state = sampleTimeline(time, duration, preRoll);
      renderScene(sourceA.ctx, "a", state.aTime, width, height);
      renderScene(sourceB.ctx, "b", state.bTime, width, height);
      fillBackdrop(ctx, width, height);

      if (state.mode === "a") {
        ctx.drawImage(sourceA.canvas, 0, 0);
      } else if (state.mode === "b") {
        ctx.drawImage(sourceB.canvas, 0, 0);
      } else if (type === "push") {
        drawPush(ctx, state.phase, direction);
      } else if (type === "wipe") {
        drawWipe(ctx, state.phase, direction);
      } else if (type === "fog") {
        drawFog(ctx, state.phase, direction, time);
      } else {
        throw new Error(`Unknown transition: ${type}`);
      }
      drawClockHud(ctx, state);
      return state;
    },
    renderPhase(ctx, { phase, duration, preRoll = PRE_ROLL, type, direction }) {
      const time = preRoll + clamp(phase) * duration;
      return this.renderAt(ctx, { time, duration, preRoll, type, direction });
    },
  };
}
