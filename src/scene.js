import { FLASHES, PROJECT } from "./project.js";

const TAU = Math.PI * 2;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function deterministicNoise(index) {
  const value = Math.sin(index * 91.731 + 17.417) * 43758.5453;
  return value - Math.floor(value);
}

function getFlashState(time) {
  let active = null;
  for (const flash of FLASHES) {
    const delta = time - flash.timeSec;
    if (delta >= 0 && delta < 1.35 && (!active || delta < active.delta)) {
      active = { flash, delta };
    }
  }
  if (!active) {
    return {
      index: -1,
      intensity: 0,
      age: Infinity,
      color: "#5ce1e6",
    };
  }
  const intensity = Math.exp(-active.delta * 12.5);
  return {
    index: active.flash.index,
    intensity,
    age: active.delta,
    color: active.flash.color,
    flash: active.flash,
  };
}

export function getSceneDebug(time) {
  const flash = getFlashState(time);
  return {
    flashIndex: flash.index,
    flashIntensity: Number(flash.intensity.toFixed(5)),
    flashAge: Number.isFinite(flash.age) ? Number(flash.age.toFixed(5)) : null,
    flashColor: flash.color,
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawBackdrop(ctx, width, height, time, flash, pulse) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#080d15");
  gradient.addColorStop(0.52, "#0b111b");
  gradient.addColorStop(1, "#05070b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const aura = ctx.createRadialGradient(
    width * 0.5,
    height * 0.46,
    0,
    width * 0.5,
    height * 0.46,
    width * 0.52,
  );
  aura.addColorStop(0, `rgba(48, 117, 130, ${0.13 + pulse * 0.04})`);
  aura.addColorStop(0.45, "rgba(18, 45, 55, 0.055)");
  aura.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(118, 165, 182, 0.08)";
  ctx.lineWidth = 1;
  const horizon = height * 0.63;
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.lineTo(width, horizon);
  ctx.stroke();

  for (let index = -12; index <= 12; index += 1) {
    ctx.beginPath();
    ctx.moveTo(width / 2 + index * 13, horizon);
    ctx.lineTo(width / 2 + index * 118, height);
    ctx.stroke();
  }
  const gridShift = (time * 0.38) % 1;
  for (let index = 0; index < 11; index += 1) {
    const progress = (index + gridShift) / 11;
    const y = horizon + Math.pow(progress, 2.4) * (height - horizon);
    ctx.globalAlpha = 0.16 + progress * 0.62;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  for (let index = 0; index < 58; index += 1) {
    const x = deterministicNoise(index + 5) * width;
    const drift = (time * (4 + deterministicNoise(index + 12) * 12)) % height;
    const y = (deterministicNoise(index + 21) * height + drift) % height;
    const size = deterministicNoise(index + 36) > 0.84 ? 1.4 : 0.65;
    ctx.fillStyle = `rgba(166, 209, 220, ${0.08 + deterministicNoise(index) * 0.23})`;
    ctx.fillRect(x, y, size, size);
  }

  ctx.save();
  ctx.globalAlpha = 0.14 + flash.intensity * 0.15;
  ctx.strokeStyle = "rgba(164, 207, 218, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.45, 160 + pulse * 9, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.45, 222 + pulse * 4, -0.8, 2.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.45, 292, 2.5, 5.8);
  ctx.stroke();
  ctx.restore();
}

function drawCore(ctx, width, height, time, flash, pulse) {
  const cx = width * 0.5;
  const cy = height * 0.45;
  const rotation = time * 0.13;
  const radius = 93 + pulse * 7;
  const accent = flash.index >= 0 ? flash.color : "#5ce1e6";

  ctx.save();
  ctx.translate(cx, cy);

  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = "rgba(215, 255, 69, 0.18)";
  ctx.setLineDash([2, 8]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 138 + Math.sin(time * 1.4) * 3, rotation, rotation + TAU * 0.77);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let index = 0; index < 18; index += 1) {
    const angle = rotation * 1.7 + (index / 18) * TAU;
    const inner = 151 + (index % 3) * 9;
    const outer = 165 + deterministicNoise(index) * 25 + pulse * 3;
    ctx.strokeStyle =
      index % 3 === 0 ? "rgba(215, 255, 69, 0.48)" : "rgba(128, 167, 176, 0.2)";
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    ctx.stroke();
  }

  const orb = ctx.createRadialGradient(-24, -31, 6, 0, 0, radius);
  orb.addColorStop(0, "rgba(226, 255, 238, 0.95)");
  orb.addColorStop(0.2, "rgba(132, 233, 219, 0.92)");
  orb.addColorStop(0.56, "rgba(31, 111, 119, 0.75)");
  orb.addColorStop(1, "rgba(4, 11, 17, 0)");
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.46 + pulse * 0.24;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 3, -0.9, 2.2);
  ctx.stroke();

  ctx.globalAlpha = 0.86;
  ctx.fillStyle = "rgba(5, 12, 18, 0.58)";
  ctx.beginPath();
  ctx.arc(0, 0, 61, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 61, 0, TAU);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(238, 247, 246, 0.95)";
  ctx.font = "300 42px ui-monospace, monospace";
  ctx.fillText(String((flash.index + 1) || 8).padStart(2, "0"), 0, 10);
  ctx.fillStyle = "rgba(221, 235, 234, 0.42)";
  ctx.font = "8px ui-monospace, monospace";
  ctx.letterSpacing = "2px";
  ctx.fillText(flash.index >= 0 ? "FLASH LOCK" : "AWAITING", 0, 30);

  ctx.restore();
}

function drawWaveform(ctx, width, height, time, flash, pulse) {
  const baseline = height - 50;
  const bars = 56;
  const available = width - 120;
  const startX = 60;
  ctx.save();
  ctx.globalAlpha = 0.7;
  for (let index = 0; index < bars; index += 1) {
    const x = startX + (index / (bars - 1)) * available;
    const phase = time * 2.2 + index * 0.44;
    const idle = 2 + Math.abs(Math.sin(phase)) * 4 + deterministicNoise(index + 8) * 3;
    const beatLift = pulse * (3 + deterministicNoise(index + 25) * 10);
    const flashLift = flash.intensity * (2 + deterministicNoise(index + 40) * 21);
    const barHeight = idle + beatLift + flashLift;
    ctx.fillStyle =
      index % 7 === 0
        ? `rgba(215, 255, 69, ${0.3 + flash.intensity * 0.35})`
        : `rgba(117, 177, 186, ${0.16 + pulse * 0.23})`;
    ctx.fillRect(x, baseline - barHeight, 2, barHeight);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.fillRect(startX, baseline + 1, available, 1);
  ctx.restore();
}

function drawHud(ctx, width, height, time) {
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = "rgba(224, 240, 239, 0.42)";
  ctx.font = "8px ui-monospace, monospace";
  ctx.letterSpacing = "1.4px";
  ctx.fillText("SYNTHETIC AV STUDY / 30.000 SEC", 31, 36);
  ctx.fillText("EIGHT / FLASH", 31, height - 28);
  ctx.textAlign = "right";
  ctx.fillText("AUDIO LOCK  ·  GLOBAL TRACK", width - 31, height - 28);
  ctx.fillStyle = "rgba(215, 255, 69, 0.62)";
  ctx.fillText("READY", width - 31, 36);

  ctx.globalAlpha = 0.24;
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  for (let index = 0; index < 8; index += 1) {
    const active = Math.floor(time / (PROJECT.durationSec / 8)) === index;
    ctx.fillRect(31 + index * 19, 46, active ? 13 : 7, 2);
  }
  ctx.restore();
}

function drawFlash(ctx, width, height, time, flash) {
  if (flash.index < 0) return;

  const burst = easeOutCubic(clamp(flash.age / 0.65));
  const ringRadius = 115 + burst * 510;
  const cx = width * 0.5;
  const cy = height * 0.45;

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = clamp(flash.intensity * 0.68);
  ctx.strokeStyle = flash.color;
  ctx.lineWidth = 2 + flash.intensity * 3;
  ctx.beginPath();
  ctx.arc(cx, cy, ringRadius, 0, TAU);
  ctx.stroke();

  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * TAU + 0.13;
    const inner = 88 + burst * 52;
    const outer = 108 + burst * (160 + deterministicNoise(index) * 125);
    ctx.globalAlpha = clamp(flash.intensity * 0.58) * (index % 2 ? 0.4 : 1);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }

  ctx.globalAlpha = clamp(flash.intensity * 0.78);
  ctx.fillStyle = flash.color;
  ctx.beginPath();
  ctx.arc(cx, cy, 6 + flash.intensity * 24, 0, TAU);
  ctx.fill();
  ctx.restore();

  const white = clamp(Math.exp(-flash.age * 21) * 0.86 + Math.exp(-flash.age * 5) * 0.08);
  if (white > 0.003) {
    ctx.save();
    ctx.globalAlpha = white;
    ctx.fillStyle = "#f5fff9";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = clamp(flash.intensity * 0.8);
  ctx.fillStyle = "rgba(5, 12, 15, 0.63)";
  roundedRect(ctx, 31, height * 0.5 + 108, 182, 50, 2);
  ctx.fill();
  ctx.fillStyle = flash.color;
  ctx.font = "8px ui-monospace, monospace";
  ctx.letterSpacing = "1.8px";
  ctx.fillText(`FLASH ${String(flash.index + 1).padStart(2, "0")} / 08`, 43, height * 0.5 + 128);
  ctx.fillStyle = "rgba(241, 249, 245, 0.8)";
  ctx.font = "500 12px ui-monospace, monospace";
  ctx.fillText(FLASHES[flash.index].title, 43, height * 0.5 + 147);
  ctx.restore();
}

export function drawScene(ctx, time, options = {}) {
  const width = options.width || PROJECT.width;
  const height = options.height || PROJECT.height;
  const safeTime = clamp(time, 0, PROJECT.durationSec);
  const beatPhase = (safeTime % PROJECT.beatIntervalSec) / PROJECT.beatIntervalSec;
  const pulse = Math.exp(-beatPhase * 8.5);
  const flash = getFlashState(safeTime);

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawBackdrop(ctx, width, height, safeTime, flash, pulse);
  drawCore(ctx, width, height, safeTime, flash, pulse);
  drawWaveform(ctx, width, height, safeTime, flash, pulse);
  drawHud(ctx, width, height, safeTime);
  drawFlash(ctx, width, height, safeTime, flash);
  ctx.restore();

  return getSceneDebug(safeTime);
}
