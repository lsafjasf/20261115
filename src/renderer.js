import {
  ACTOR_PATH,
  FOCUS,
  LIGHT_FIXTURES,
  STAGE,
  WORLD,
  getCameraProjection,
  unprojectPoint,
} from "./engine.js";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

function rgba(hex, alpha) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width: rect.width, height: rect.height, ratio };
}

function worldRectFromScreen(target, camera) {
  return [
    unprojectPoint(target.x[0], target.y[0], camera),
    unprojectPoint(target.x[1], target.y[0], camera),
    unprojectPoint(target.x[1], target.y[1], camera),
    unprojectPoint(target.x[0], target.y[1], camera),
  ];
}

function worldFrameFromScreen(camera) {
  return [
    unprojectPoint(0, 0, camera),
    unprojectPoint(1, 0, camera),
    unprojectPoint(1, 1, camera),
    unprojectPoint(0, 1, camera),
  ];
}

function polygon(ctx, points, close = true) {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (close) ctx.closePath();
}

function drawCornerMarks(ctx, x, y, width, height, color) {
  const length = 11;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + length);
  ctx.lineTo(x, y);
  ctx.lineTo(x + length, y);
  ctx.moveTo(x + width - length, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + length);
  ctx.moveTo(x, y + height - length);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x + length, y + height);
  ctx.moveTo(x + width - length, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width, y + height - length);
  ctx.stroke();
}

export class StudioRenderer {
  constructor(stageCanvas, monitorCanvas) {
    this.stageCanvas = stageCanvas;
    this.monitorCanvas = monitorCanvas;
    this.stageCtx = stageCanvas.getContext("2d");
    this.monitorCtx = monitorCanvas.getContext("2d");
    this.lastStageSize = { width: 0, height: 0 };
    this.lastMonitorSize = { width: 0, height: 0 };
  }

  render(engine, now = performance.now()) {
    this.renderStage(engine, now);
    this.renderMonitor(engine, now);
  }

  renderStage(engine, now) {
    const fitted = fitCanvas(this.stageCanvas);
    const ctx = this.stageCtx;
    if (!fitted.width || !fitted.height) return;
    const scale = fitted.width / WORLD.width;
    ctx.setTransform(fitted.ratio * scale, 0, 0, fitted.ratio * scale, 0, 0);
    this.lastStageSize = fitted;
    this.drawStageBackground(ctx, engine, now);
    this.drawTrajectory(ctx, engine);
    this.drawViewfinder(ctx, engine);
    this.drawLights(ctx, engine);
    this.drawActor(ctx, engine, now);
    this.drawCamera(ctx, engine);
    this.drawStageLabels(ctx, engine);
  }

  drawStageBackground(ctx, engine, now) {
    const background = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
    background.addColorStop(0, "#10191a");
    background.addColorStop(0.52, "#0d1415");
    background.addColorStop(1, "#121819");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.strokeStyle = "rgba(172, 206, 198, 0.035)";
    ctx.lineWidth = 1;
    for (let x = 32; x < WORLD.width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD.height);
      ctx.stroke();
    }
    for (let y = 26; y < WORLD.height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.width, y);
      ctx.stroke();
    }

    ctx.save();
    ctx.strokeStyle = "rgba(203, 227, 219, 0.11)";
    for (const x of [88, 240, 720, 875]) {
      ctx.beginPath();
      ctx.moveTo(x, -12);
      ctx.lineTo(x + (x - 480) * 0.18, 128);
      ctx.stroke();
    }
    ctx.setLineDash([3, 8]);
    ctx.strokeStyle = "rgba(203, 227, 219, 0.06)";
    ctx.beginPath();
    ctx.ellipse(480, 88, 325, 42, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(STAGE.x, STAGE.y + 18);
    ctx.scale(1, 0.86);
    const shadow = ctx.createRadialGradient(0, 0, 20, 0, 0, STAGE.radiusX);
    shadow.addColorStop(0, "rgba(0, 0, 0, 0.74)");
    shadow.addColorStop(0.7, "rgba(0, 0, 0, 0.4)");
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, STAGE.radiusX + 18, 0, TAU);
    ctx.fill();
    ctx.restore();

    const floor = ctx.createRadialGradient(440, 296, 26, 480, 354, STAGE.radiusX);
    floor.addColorStop(0, "#273536");
    floor.addColorStop(0.58, "#1c292a");
    floor.addColorStop(1, "#111b1c");
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.ellipse(STAGE.x, STAGE.y, STAGE.radiusX, STAGE.radiusY, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(196, 226, 217, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(STAGE.x, STAGE.y, STAGE.radiusX, STAGE.radiusY, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(196, 226, 217, 0.055)";
    ctx.beginPath();
    ctx.ellipse(STAGE.x, STAGE.y, STAGE.radiusX - 18, STAGE.radiusY - 18, 0, 0, TAU);
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = "rgba(244, 187, 104, 0.075)";
    ctx.setLineDash([2, 13]);
    ctx.beginPath();
    ctx.moveTo(480, 194);
    ctx.lineTo(480, 514);
    ctx.moveTo(222, 354);
    ctx.lineTo(738, 354);
    ctx.stroke();
    ctx.restore();

    const pulse = engine.paused ? 0 : Math.max(0, 1 - engine.beatProgress * 4);
    if (pulse > 0.01) {
      ctx.save();
      ctx.strokeStyle = `rgba(132, 225, 194, ${pulse * 0.18})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(STAGE.x, STAGE.y, STAGE.radiusX + 5, STAGE.radiusY + 5, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawTrajectory(ctx, engine) {
    const analysis = engine.analyze();
    const actor = analysis.actor ?? engine.actor;
    ctx.save();
    ctx.strokeStyle = "rgba(148, 183, 175, 0.18)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 8]);
    polygon(ctx, ACTOR_PATH);
    ctx.stroke();
    ctx.setLineDash([]);

    ACTOR_PATH.forEach((point, index) => {
      const active = index === actor.currentIndex;
      const next = index === actor.nextIndex;
      if (active || next) return;
      ctx.fillStyle = "rgba(154, 186, 178, 0.22)";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.5, 0, TAU);
      ctx.fill();
    });

    const current = ACTOR_PATH[actor.currentIndex];
    const upcoming = ACTOR_PATH[actor.nextIndex];
    ctx.strokeStyle = "rgba(244, 187, 104, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(current.x, current.y);
    ctx.lineTo(upcoming.x, upcoming.y);
    ctx.stroke();
    ctx.fillStyle = "rgba(244, 187, 104, 0.34)";
    ctx.beginPath();
    ctx.arc(current.x, current.y, 3.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(244, 187, 104, 0.5)";
    ctx.beginPath();
    ctx.arc(upcoming.x, upcoming.y, 2.7, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawViewfinder(ctx, engine) {
    const analysis = engine.analyze();
    if (!analysis.shot || !analysis.projection) return;
    const frame = worldFrameFromScreen(engine.camera);
    const target = worldRectFromScreen(analysis.shot.target, engine.camera);
    const ready = analysis.windowOpen;
    const color = ready ? "#84e1c2" : "#9bbbc8";

    ctx.save();
    polygon(ctx, frame);
    ctx.fillStyle = ready ? "rgba(116, 217, 190, 0.055)" : "rgba(139, 180, 198, 0.028)";
    ctx.fill();
    ctx.strokeStyle = ready ? "rgba(132, 225, 194, 0.72)" : "rgba(155, 190, 200, 0.34)";
    ctx.lineWidth = ready ? 1.5 : 1;
    ctx.setLineDash(ready ? [] : [5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    polygon(ctx, target);
    ctx.fillStyle = ready ? "rgba(244, 187, 104, 0.14)" : "rgba(244, 187, 104, 0.055)";
    ctx.fill();
    ctx.strokeStyle = ready ? "rgba(244, 187, 104, 0.88)" : "rgba(244, 187, 104, 0.36)";
    ctx.lineWidth = ready ? 1.6 : 1;
    ctx.stroke();

    const center = unprojectPoint(
      (analysis.shot.target.x[0] + analysis.shot.target.x[1]) / 2,
      (analysis.shot.target.y[0] + analysis.shot.target.y[1]) / 2,
      engine.camera,
    );
    ctx.strokeStyle = ready ? "rgba(244, 187, 104, 0.92)" : "rgba(244, 187, 104, 0.38)";
    ctx.beginPath();
    ctx.moveTo(center.x - 7, center.y);
    ctx.lineTo(center.x + 7, center.y);
    ctx.moveTo(center.x, center.y - 7);
    ctx.lineTo(center.x, center.y + 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(center.x, center.y, 3, 0, TAU);
    ctx.stroke();

    const projection = analysis.projection;
    const actorScreen = {
      x: projection.x,
      y: projection.y,
    };
    const anchor = unprojectPoint(actorScreen.x, actorScreen.y, engine.camera);
    const labelX = Math.max(24, Math.min(WORLD.width - 82, center.x - 30));
    const labelY = Math.max(44, center.y - 46);
    ctx.fillStyle = ready ? "#f4bb68" : "rgba(244, 187, 104, 0.62)";
    ctx.font = "700 8px 'Arial Narrow', 'Noto Sans SC Variable', sans-serif";
    ctx.letterSpacing = "1px";
    ctx.fillText(ready ? "WINDOW / OPEN" : "TARGET / WAIT", labelX, labelY);
    ctx.strokeStyle = "rgba(244, 187, 104, 0.2)";
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(center.x, center.y);
    ctx.stroke();

    ctx.fillStyle = "rgba(203, 226, 219, 0.38)";
    ctx.font = "600 8px 'Arial Narrow', 'Noto Sans SC Variable', sans-serif";
    ctx.letterSpacing = "0.8px";
    ctx.fillText(
      `FRAME ${String(analysis.shot.id).padStart(2, "0")} · ${Math.round(engine.camera.focal)}MM`,
      Math.max(26, frame[0].x + 10),
      Math.max(40, frame[0].y + 17),
    );
    ctx.restore();
  }

  drawLights(ctx, engine) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(STAGE.x, STAGE.y, STAGE.radiusX - 4, STAGE.radiusY - 4, 0, 0, TAU);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";

    engine.lights.forEach((light, index) => {
      const fixture = LIGHT_FIXTURES[index];
      const angle = light.angle * DEG;
      const halfCone = 46 * DEG;
      const length = 520;
      const gradient = ctx.createRadialGradient(
        fixture.x,
        fixture.y,
        4,
        fixture.x,
        fixture.y,
        length,
      );
      gradient.addColorStop(0, rgba(fixture.color, 0.24));
      gradient.addColorStop(0.4, rgba(fixture.color, 0.09));
      gradient.addColorStop(1, rgba(fixture.color, 0.01));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(fixture.x, fixture.y);
      ctx.arc(fixture.x, fixture.y, length, angle - halfCone, angle + halfCone);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();

    engine.lights.forEach((light, index) => {
      const fixture = LIGHT_FIXTURES[index];
      const angle = light.angle * DEG;
      const tipX = fixture.x + Math.cos(angle) * 36;
      const tipY = fixture.y + Math.sin(angle) * 36;
      ctx.save();
      ctx.strokeStyle = rgba(fixture.color, 0.28);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fixture.x, fixture.y);
      ctx.lineTo(fixture.x + Math.cos(angle) * 530, fixture.y + Math.sin(angle) * 530);
      ctx.stroke();

      ctx.translate(fixture.x, fixture.y);
      ctx.fillStyle = "#11191a";
      ctx.strokeStyle = rgba(fixture.color, 0.65);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, TAU);
      ctx.fillStyle = fixture.color;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(tipX - fixture.x, tipY - fixture.y);
      ctx.strokeStyle = rgba(fixture.color, 0.9);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "rgba(221, 235, 230, 0.48)";
      ctx.font = "700 8px 'Arial Narrow', 'Noto Sans SC Variable', sans-serif";
      ctx.letterSpacing = "0.8px";
      ctx.fillText(fixture.id, fixture.x - 3, fixture.y - 23);
    });
  }

  drawActor(ctx, engine, now) {
    const analysis = engine.analyze();
    const actor = analysis.actor ?? engine.actor;
    const pulse = engine.paused ? 0 : Math.max(0, 1 - engine.beatProgress * 4.5);
    const halo = analysis.overexposed ? "rgba(255, 225, 198, 0.4)" : "rgba(255, 118, 101, 0.2)";

    ctx.save();
    ctx.translate(actor.x, actor.y);

    if (pulse > 0) {
      ctx.strokeStyle = `rgba(132, 225, 194, ${pulse * 0.34})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(0, 0, 24 + (1 - pulse) * 16, 0, TAU);
      ctx.stroke();
    }

    if (analysis.overexposed) {
      const glow = ctx.createRadialGradient(0, 0, 3, 0, 0, 43);
      glow.addColorStop(0, "rgba(255, 237, 209, 0.5)");
      glow.addColorStop(0.55, "rgba(255, 183, 121, 0.16)");
      glow.addColorStop(1, "rgba(255, 140, 105, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 43, 0, TAU);
      ctx.fill();
    }

    ctx.scale(1, 0.58);
    ctx.fillStyle = "rgba(0, 0, 0, 0.44)";
    ctx.beginPath();
    ctx.arc(0, 15, 19, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(actor.x, actor.y);
    ctx.strokeStyle = analysis.subjectInFrame ? halo : "rgba(255, 93, 86, 0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, TAU);
    ctx.stroke();
    drawCornerMarks(ctx, -22, -22, 44, 44, analysis.subjectInFrame ? "rgba(255, 255, 255, 0.32)" : "rgba(255, 93, 86, 0.72)");

    ctx.fillStyle = "#d45548";
    ctx.beginPath();
    ctx.ellipse(0, 4, 10, 13, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ff8b78";
    ctx.beginPath();
    ctx.ellipse(0, -3, 8.5, 10, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#f0c8ae";
    ctx.beginPath();
    ctx.arc(0, -11, 5.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#25211f";
    ctx.beginPath();
    ctx.arc(0, -12.8, 5.4, Math.PI, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 229, 212, 0.62)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(-12, 9);
    ctx.moveTo(7, 0);
    ctx.lineTo(12, 9);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(222, 236, 230, 0.48)";
    ctx.font = "600 7px 'Arial Narrow', 'Noto Sans SC Variable', sans-serif";
    ctx.letterSpacing = "0.8px";
    ctx.fillText(engine.paused ? "ACTOR / HOLD" : "ACTOR / 01", actor.x + 22, actor.y + 24);
  }

  drawCamera(ctx, engine) {
    const projection = getCameraProjection(engine.camera);
    const { x, y } = engine.camera;
    ctx.save();
    ctx.strokeStyle = "rgba(132, 225, 194, 0.13)";
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(FOCUS.x, FOCUS.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(132, 225, 194, 0.06)";
    ctx.beginPath();
    ctx.arc(STAGE.x, STAGE.y, 255, Math.PI * 1.07, Math.PI * 1.93);
    ctx.stroke();

    ctx.translate(x, y);
    const direction = Math.atan2(projection.forward.y, projection.forward.x);
    ctx.rotate(direction);
    ctx.fillStyle = "rgba(11, 19, 20, 0.9)";
    ctx.strokeStyle = "rgba(132, 225, 194, 0.64)";
    ctx.lineWidth = 1;
    roundedRect(ctx, -19, -12, 31, 24, 4);
    ctx.fill();
    ctx.stroke();
    roundedRect(ctx, 8, -8, 18, 16, 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(31, 0, 8, 0, TAU);
    ctx.fillStyle = "#172425";
    ctx.fill();
    ctx.strokeStyle = "rgba(132, 225, 194, 0.9)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(31, 0, 4, 0, TAU);
    ctx.fillStyle = "#84e1c2";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(132, 225, 194, 0.72)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 27, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgba(132, 225, 194, 0.75)";
    ctx.font = "700 8px 'Arial Narrow', 'Noto Sans SC Variable', sans-serif";
    ctx.letterSpacing = "1px";
    ctx.fillText("CAM", x - 12, y + 42);
    ctx.restore();
  }

  drawStageLabels(ctx, engine) {
    const beat = engine.beatIndex;
    const phase = engine.beatProgress;
    const totalBeats = ACTOR_PATH.length;
    ctx.save();
    ctx.fillStyle = "rgba(225, 238, 232, 0.34)";
    ctx.font = "600 7px 'Arial Narrow', 'Noto Sans SC Variable', sans-serif";
    ctx.letterSpacing = "1.2px";
    ctx.fillText("TOP / STAGE PLAN", 24, WORLD.height - 29);

    const startX = 24;
    const y = WORLD.height - 17;
    for (let index = 0; index < totalBeats; index += 1) {
      const active = index === beat % totalBeats;
      ctx.fillStyle = active ? "#f4bb68" : "rgba(164, 192, 184, 0.16)";
      ctx.fillRect(startX + index * 13, y, 8, 3);
    }
    ctx.fillStyle = "rgba(244, 187, 104, 0.6)";
    ctx.fillRect(startX + (beat % totalBeats) * 13 + 8, y, 5 * phase, 3);

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(225, 238, 232, 0.28)";
    ctx.fillText("拖动机位 · 拖动灯头 · SPACE 快门", WORLD.width - 24, WORLD.height - 16);
    ctx.restore();
  }

  renderMonitor(engine, now) {
    const fitted = fitCanvas(this.monitorCanvas);
    const ctx = this.monitorCtx;
    if (!fitted.width || !fitted.height) return;
    const logicalWidth = 360;
    const logicalHeight = 202.5;
    const scale = fitted.width / logicalWidth;
    ctx.setTransform(fitted.ratio * scale, 0, 0, fitted.ratio * scale, 0, 0);
    this.lastMonitorSize = fitted;
    const analysis = engine.analyze();
    const shot = analysis.shot;

    ctx.fillStyle = "#0a1011";
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    const ground = ctx.createLinearGradient(0, 0, 0, logicalHeight);
    ground.addColorStop(0, "#273032");
    ground.addColorStop(0.42, "#1b2526");
    ground.addColorStop(1, "#0d1415");
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    const horizon = ctx.createRadialGradient(180, 82, 4, 180, 104, 180);
    horizon.addColorStop(0, "rgba(115, 141, 133, 0.28)");
    horizon.addColorStop(1, "rgba(13, 19, 20, 0)");
    ctx.fillStyle = horizon;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    const exposure = analysis.exposure ?? 0;
    engine.lights.forEach((light, index) => {
      const fixture = LIGHT_FIXTURES[index];
      const localX = clampNumber(((fixture.x - 180) / 540) * logicalWidth, -40, 400);
      const glow = ctx.createRadialGradient(localX, 110, 2, localX, 110, 150);
      const strength = 0.06 + (analysis.exposureResult?.individual[index]?.amount ?? 0) * 0.42;
      glow.addColorStop(0, rgba(fixture.color, strength));
      glow.addColorStop(0.55, rgba(fixture.color, strength * 0.3));
      glow.addColorStop(1, rgba(fixture.color, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 30, logicalWidth, logicalHeight - 30);
    });

    ctx.fillStyle = "rgba(8, 13, 14, 0.5)";
    ctx.fillRect(0, logicalHeight - 21, logicalWidth, 21);

    ctx.strokeStyle = "rgba(232, 241, 236, 0.12)";
    ctx.lineWidth = 0.7;
    for (let index = 1; index < 3; index += 1) {
      ctx.beginPath();
      ctx.moveTo((logicalWidth / 3) * index, 7);
      ctx.lineTo((logicalWidth / 3) * index, logicalHeight - 24);
      ctx.moveTo(7, 36 + index * 43);
      ctx.lineTo(logicalWidth - 7, 36 + index * 43);
      ctx.stroke();
    }

    if (shot) {
      const x = shot.target.x[0] * logicalWidth;
      const y = shot.target.y[0] * logicalHeight;
      const right = shot.target.x[1] * logicalWidth;
      const bottom = shot.target.y[1] * logicalHeight;
      ctx.fillStyle = analysis.windowOpen
        ? "rgba(244, 187, 104, 0.14)"
        : "rgba(244, 187, 104, 0.055)";
      ctx.fillRect(x, y, right - x, bottom - y);
      ctx.strokeStyle = analysis.windowOpen
        ? "rgba(244, 187, 104, 0.95)"
        : "rgba(244, 187, 104, 0.38)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, right - x, bottom - y);
      drawCornerMarks(ctx, x, y, right - x, bottom - y, "rgba(244, 187, 104, 0.9)");
      ctx.fillStyle = "rgba(244, 187, 104, 0.9)";
      ctx.font = "700 6px 'Arial Narrow', 'Noto Sans SC Variable', sans-serif";
      ctx.letterSpacing = "0.7px";
      ctx.fillText("TARGET", x + 4, Math.max(30, y - 5));
    }

    const projection = analysis.projection ?? { x: 0.5, y: 0.5 };
    const actorX = projection.x * logicalWidth;
    const actorY = projection.y * logicalHeight;
    const inFrame = analysis.subjectInFrame;
    const zoom = (engine.camera.focal / 50);
    const bodyHeight = clampNumber(42 / zoom, 22, 66);

    ctx.save();
    ctx.globalAlpha = inFrame ? 1 : 0.42;
    ctx.translate(actorX, actorY);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.beginPath();
    ctx.ellipse(0, bodyHeight * 0.44, bodyHeight * 0.22, bodyHeight * 0.065, 0, 0, TAU);
    ctx.fill();
    const coat = ctx.createLinearGradient(0, -bodyHeight * 0.4, 0, bodyHeight * 0.4);
    coat.addColorStop(0, analysis.overexposed ? "#ffe4c8" : "#ff8875");
    coat.addColorStop(0.52, analysis.overexposed ? "#fff1df" : "#dc5c4e");
    coat.addColorStop(1, "#8e3731");
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.moveTo(-bodyHeight * 0.19, -bodyHeight * 0.19);
    ctx.quadraticCurveTo(0, -bodyHeight * 0.33, bodyHeight * 0.19, -bodyHeight * 0.19);
    ctx.lineTo(bodyHeight * 0.24, bodyHeight * 0.33);
    ctx.quadraticCurveTo(0, bodyHeight * 0.42, -bodyHeight * 0.24, bodyHeight * 0.33);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#eec3a7";
    ctx.beginPath();
    ctx.ellipse(0, -bodyHeight * 0.4, bodyHeight * 0.1, bodyHeight * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#292320";
    ctx.beginPath();
    ctx.arc(0, -bodyHeight * 0.43, bodyHeight * 0.11, Math.PI, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 228, 207, 0.62)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-bodyHeight * 0.19, -bodyHeight * 0.14);
    ctx.lineTo(-bodyHeight * 0.29, bodyHeight * 0.06);
    ctx.moveTo(bodyHeight * 0.19, -bodyHeight * 0.14);
    ctx.lineTo(bodyHeight * 0.29, bodyHeight * 0.06);
    ctx.stroke();
    ctx.restore();

    if (analysis.overexposed) {
      ctx.fillStyle = "rgba(255, 210, 177, 0.11)";
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    }

    const status = analysis.complete
      ? "ROLL COMPLETE"
      : analysis.overexposed
        ? "OVER / CLIP"
        : analysis.windowOpen
          ? "TARGET LOCK"
          : "SEARCHING";
    const statusColor = analysis.overexposed
      ? "#ff7665"
      : analysis.windowOpen
        ? "#f4bb68"
        : "rgba(220, 235, 229, 0.38)";
    ctx.fillStyle = "rgba(7, 12, 13, 0.52)";
    roundedRect(ctx, 10, 9, 96, 19, 3);
    ctx.fill();
    ctx.fillStyle = "#ff7665";
    ctx.beginPath();
    ctx.arc(19, 18.5, 2.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(239, 245, 240, 0.78)";
    ctx.font = "700 6px 'Arial Narrow', 'Noto Sans SC Variable', sans-serif";
    ctx.letterSpacing = "0.9px";
    ctx.fillText("CAM 01 / REC", 27, 21);

    ctx.textAlign = "right";
    ctx.fillStyle = statusColor;
    ctx.fillText(status, logicalWidth - 11, 21);
    ctx.fillStyle = "rgba(239, 245, 240, 0.54)";
    ctx.font = "600 6px 'Arial Narrow', 'Noto Sans SC Variable', sans-serif";
    ctx.fillText(
      `${Math.round(engine.camera.focal)}MM  ·  ${Math.round(exposure * 100)}%`,
      logicalWidth - 11,
      logicalHeight - 8,
    );
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(239, 245, 240, 0.38)";
    ctx.fillText("16:9 · 100 BPM", 11, logicalHeight - 8);

    ctx.strokeStyle = analysis.ready
      ? "rgba(132, 225, 194, 0.82)"
      : "rgba(220, 236, 230, 0.15)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, logicalWidth - 1, logicalHeight - 1);
    drawCornerMarks(ctx, 5, 5, logicalWidth - 10, logicalHeight - 10, "rgba(230, 241, 235, 0.28)");

    if (engine.paused && !engine.roundComplete) {
      ctx.fillStyle = "rgba(7, 11, 12, 0.32)";
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);
      ctx.fillStyle = "rgba(244, 187, 104, 0.86)";
      ctx.font = "700 8px 'Arial Narrow', 'Noto Sans SC Variable', sans-serif";
      ctx.textAlign = "center";
      ctx.letterSpacing = "1.2px";
      ctx.fillText("FRAME HOLD", logicalWidth / 2, logicalHeight / 2);
      ctx.textAlign = "left";
    }

    if (engine.flash > 0) {
      ctx.fillStyle = `rgba(255, 245, 228, ${Math.min(0.82, engine.flash * 0.72)})`;
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    }

    ctx.fillStyle = `rgba(255, 255, 255, ${0.018 + (now % 700) / 700 * 0.012})`;
    for (let y = 0; y < logicalHeight; y += 3) ctx.fillRect(0, y, logicalWidth, 1);
  }
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
