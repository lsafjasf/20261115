// Canvas 渲染：世界坐标（米，y 向上）映射到屏幕（y 向下）。

import {
  BARGE,
  BOX_SPEC,
  CRANE,
  PONTOON,
  SHORE,
  centerOfMass,
  effectiveBoom,
  getLoadRatio,
  hookPoint,
  isOverloaded,
  mastPoint,
  rotateWorld,
  trolleyPoint,
} from "./engine.js";

export class Camera {
  constructor(canvas) {
    this.scale = 34;
    this.centerX = 0;
    this.centerY = 1.5;
    this.resize(canvas);
  }

  resize(canvas) {
    this.width = canvas.width;
    this.height = canvas.height;
  }

  toScreen(point) {
    return {
      x: this.width / 2 + (point.x - this.centerX) * this.scale,
      y: this.height / 2 - (point.y - this.centerY) * this.scale,
    };
  }
}

function path(ctx, camera, points) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const screen = camera.toScreen(point);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.closePath();
}

export function drawWater(ctx, camera, time) {
  const grad = ctx.createLinearGradient(0, 0, 0, camera.height);
  grad.addColorStop(0, "#bfe3f2");
  grad.addColorStop(0.45, "#7fb8d6");
  grad.addColorStop(1, "#2f6f93");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, camera.width, camera.height);

  const waterY = camera.toScreen({ x: 0, y: 0 }).y;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.5;
  for (let row = 0; row < 3; row += 1) {
    ctx.beginPath();
    for (let x = 0; x <= camera.width; x += 8) {
      const worldX = (x - camera.width / 2) / camera.scale + camera.centerX;
      const wave =
        Math.sin(worldX * 1.7 + time * 1.6 + row * 1.3) * (0.06 + row * 0.03);
      const y = waterY + row * 16 + wave * camera.scale * 0.4;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

export function drawPlatforms(ctx, camera) {
  // 驳船（左）
  drawDock(ctx, camera, BARGE.x, BARGE.deckY, 3.4, "#6b5842", "#4a3c2c");
  // 岸台（右）
  drawDock(ctx, camera, SHORE.x, SHORE.deckY, 3.6, "#7d7468", "#575047");
}

function drawDock(ctx, camera, centerX, deckY, width, fill, edge) {
  const half = width / 2;
  path(ctx, camera, [
    { x: centerX - half, y: deckY - 0.7 },
    { x: centerX + half, y: deckY - 0.7 },
    { x: centerX + half, y: deckY },
    { x: centerX - half, y: deckY },
  ]);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.stroke();

  const left = camera.toScreen({ x: centerX - half, y: deckY });
  const right = camera.toScreen({ x: centerX + half, y: deckY });
  ctx.strokeStyle = edge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(left.x, left.y + 26);
  ctx.moveTo(right.x, right.y);
  ctx.lineTo(right.x, right.y + 26);
  ctx.stroke();
}

export function drawPontoon(ctx, camera, state) {
  const half = PONTOON.width / 2;
  const corners = [
    rotateWorld(state, -half, PONTOON.deckY),
    rotateWorld(state, half, PONTOON.deckY),
    rotateWorld(state, half, PONTOON.deckY - 0.7),
    rotateWorld(state, -half, PONTOON.deckY - 0.7),
  ];
  path(ctx, camera, corners);
  const grad = ctx.createLinearGradient(0, camera.height * 0.3, 0, camera.height);
  grad.addColorStop(0, "#d98b3a");
  grad.addColorStop(1, "#a85f1f");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#7c4515";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 甲板中心线，帮助观察倾斜
  const center = rotateWorld(state, 0, PONTOON.deckY + 0.02);
  const left = rotateWorld(state, -half + 0.2, PONTOON.deckY + 0.02);
  const right = rotateWorld(state, half - 0.2, PONTOON.deckY + 0.02);
  ctx.strokeStyle = "rgba(255,240,210,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const a = camera.toScreen(left);
  const b = camera.toScreen(right);
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  void center;
}

export function drawCrane(ctx, camera, state) {
  const mastBase = rotateWorld(state, CRANE.baseX, PONTOON.deckY);
  const mastTop = mastPoint(state);
  const trolley = trolleyPoint(state);
  const hook = hookPoint(state);
  const ratio = getLoadRatio(state);

  // 桅杆
  line(ctx, camera, mastBase, mastTop, "#33414f", 7);
  const baseScreen = camera.toScreen(mastBase);
  ctx.fillStyle = "#26313c";
  ctx.fillRect(baseScreen.x - 12, baseScreen.y - 8, 24, 10);

  // 吊臂：用直线段画，下垂通过 effectiveBoom 体现为整体下压。
  const angle = effectiveBoom(state);
  const color = isOverloaded(state) ? "#c0392b" : "#3d566e";
  line(ctx, camera, mastTop, trolley, color, 5);

  // 吊臂下沿的斜拉筋，表现桁架结构
  const braceLocal = {
    x: CRANE.baseX - state.trolley * 0.55 * Math.sin(angle),
    y:
      PONTOON.deckY +
      CRANE.mastHeight * 0.55 +
      state.trolley * 0.55 * Math.cos(angle),
  };
  const brace = rotateWorld(state, braceLocal.x, braceLocal.y);
  line(ctx, camera, mastTop, brace, "#5d7488", 2);
  line(ctx, camera, brace, trolley, "#5d7488", 2);

  // 小车
  const trolleyScreen = camera.toScreen(trolley);
  ctx.fillStyle = "#222c35";
  ctx.beginPath();
  ctx.arc(trolleyScreen.x, trolleyScreen.y, 6, 0, Math.PI * 2);
  ctx.fill();

  // 吊索
  line(ctx, camera, trolley, hook, "#1f2a33", 2);
  const hookScreen = camera.toScreen(hook);
  ctx.strokeStyle = state.hookOpen ? "#1f2a33" : "#d35400";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(hookScreen.x, hookScreen.y + 4, 5, 0, Math.PI * 1.4);
  ctx.stroke();
}

function line(ctx, camera, from, to, color, width) {
  const a = camera.toScreen(from);
  const b = camera.toScreen(to);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function drawBoxes(ctx, camera, state) {
  for (const box of state.boxes) {
    if (box.location === "sunk") continue;
    const half = box.size / 2;
    let corners;
    if (box.location === "hook") {
      const hook = hookPoint(state);
      corners = [
        { x: hook.x - half, y: hook.y - half },
        { x: hook.x + half, y: hook.y - half },
        { x: hook.x + half, y: hook.y + half },
        { x: hook.x - half, y: hook.y + half },
      ];
    } else {
      const baseY = box.y;
      corners = [
        { x: box.x - half, y: baseY - half },
        { x: box.x + half, y: baseY - half },
        { x: box.x + half, y: baseY + half },
        { x: box.x - half, y: baseY + half },
      ];
    }
    path(ctx, camera, corners);
    ctx.fillStyle = box.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const label = camera.toScreen({ x: box.x, y: box.y });
    ctx.fillStyle = "#1d2730";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${box.mass}kg`, label.x, label.y + 4);

    if (box.location === "delivered") {
      const mark = camera.toScreen({ x: box.x, y: box.y + half + 0.25 });
      ctx.fillStyle = "#1e8449";
      ctx.fillText("✓", mark.x, mark.y);
    }
  }
}

export function drawCenterOfMass(ctx, camera, state) {
  const com = centerOfMass(state);
  const screen = camera.toScreen(com);
  // 重心到浮筏中心的重力力臂
  const pivot = camera.toScreen({ x: 0, y: PONTOON.deckY });
  ctx.strokeStyle = "rgba(192,57,43,0.5)";
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pivot.x, pivot.y);
  ctx.lineTo(screen.x, screen.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#c0392b";
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(screen.x - 4, screen.y);
  ctx.lineTo(screen.x + 4, screen.y);
  ctx.moveTo(screen.x, screen.y - 4);
  ctx.lineTo(screen.x, screen.y + 4);
  ctx.stroke();
  ctx.fillStyle = "#c0392b";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("重心", screen.x + 9, screen.y - 7);
}

export function drawHud(ctx, camera, state) {
  const delivered = state.boxes.filter((box) => box.location === "delivered").length;
  const ratio = getLoadRatio(state);
  const tiltDeg = (state.tilt * 180) / Math.PI;

  ctx.fillStyle = "rgba(20,30,40,0.72)";
  ctx.fillRect(12, 12, 236, 118);
  ctx.fillStyle = "#eef4f8";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`已转运货箱：${delivered}/${BOX_SPEC.length}`, 24, 36);
  ctx.fillText(`当前负载：${Math.round(ratio * 100)}%`, 24, 58);
  ctx.fillText(`浮筏倾角：${tiltDeg.toFixed(1)}°`, 24, 80);

  // 倾角表
  const meterX = 24;
  const meterY = 100;
  const meterW = 200;
  ctx.fillStyle = "#dfe7ec";
  ctx.fillRect(meterX, meterY, meterW, 8);
  const danger = Math.min(1, Math.abs(state.tilt) / PONTOON.capsizeAngle);
  ctx.fillStyle = danger > 0.8 ? "#c0392b" : danger > 0.55 ? "#e67e22" : "#27ae60";
  const fillW = (meterW / 2) * danger;
  if (state.tilt >= 0) ctx.fillRect(meterX + meterW / 2, meterY, fillW, 8);
  else ctx.fillRect(meterX + meterW / 2 - fillW, meterY, fillW, 8);
  ctx.strokeStyle = "#33414f";
  ctx.lineWidth = 1;
  ctx.strokeRect(meterX, meterY, meterW, 8);

  if (isOverloaded(state)) {
    ctx.fillStyle = "#ff7665";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("⚠ 载荷过大，吊臂下垂！", 24, 146);
  }

  if (state.status === "capsized") {
    overlay(ctx, camera, "浮筏侧翻！任务失败", "按 R 重新开始");
  } else if (state.status === "won") {
    overlay(ctx, camera, "三箱转运完成，浮筏平稳！", "按 R 再来一次");
  }
}

function overlay(ctx, camera, title, hint) {
  ctx.fillStyle = "rgba(15,22,30,0.62)";
  ctx.fillRect(0, 0, camera.width, camera.height);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText(title, camera.width / 2, camera.height / 2 - 8);
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#cfe0ec";
  ctx.fillText(hint, camera.width / 2, camera.height / 2 + 26);
}

export function drawControlsHint(ctx, camera) {
  ctx.fillStyle = "rgba(20,30,40,0.62)";
  ctx.fillRect(camera.width - 250, camera.height - 92, 238, 80);
  ctx.fillStyle = "#eef4f8";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("A / D：旋转吊臂", camera.width - 238, camera.height - 68);
  ctx.fillText("W / S：移动小车", camera.width - 238, camera.height - 48);
  ctx.fillText("空格：挂钩 / 脱钩", camera.width - 238, camera.height - 28);
  ctx.fillText("R：重开　M：静音", camera.width - 118, camera.height - 28);
}
