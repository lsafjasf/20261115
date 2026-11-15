import { CONFIG, PX_PER_M, tipPosition, cargoPosition } from "./physics.js";

export function drawScene(ctx, state, input, width = 720, height = 480) {
  ctx.clearRect(0, 0, width, height);
  drawHarbor(ctx, width);
  drawTarget(ctx);
  drawObstacle(ctx);
  drawCrane(ctx, state);
  drawCargo(ctx, state);
  drawHud(ctx, state, input);
}

function drawHarbor(ctx, width) {
  const sky = ctx.createLinearGradient(0, 0, 0, CONFIG.groundY);
  sky.addColorStop(0, "#0b1a33");
  sky.addColorStop(1, "#16324f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, CONFIG.groundY);

  ctx.fillStyle = "#1c2c44";
  for (let i = 0; i < 6; i++) {
    const bx = 40 + i * 120;
    const bh = 40 + (i % 3) * 26;
    ctx.fillRect(bx, CONFIG.groundY - bh, 70, bh);
  }

  ctx.fillStyle = "#20293a";
  ctx.fillRect(0, CONFIG.groundY, width, 480 - CONFIG.groundY);
  ctx.strokeStyle = "#2c3e58";
  ctx.beginPath();
  ctx.moveTo(0, CONFIG.groundY);
  ctx.lineTo(width, CONFIG.groundY);
  ctx.stroke();

  ctx.fillStyle = "#0a1220";
  ctx.fillRect(CONFIG.base.x - 26, CONFIG.groundY - 14, 52, 14);
}

function drawTarget(ctx) {
  const t = CONFIG.target;
  ctx.fillStyle = "rgba(72, 201, 136, 0.25)";
  ctx.fillRect(t.x, t.y - 70, t.w, 70);
  ctx.strokeStyle = "#48c988";
  ctx.lineWidth = 2;
  ctx.strokeRect(t.x, t.y - 70, t.w, 70);
  ctx.fillStyle = "#9ff0c2";
  ctx.font = "12px sans-serif";
  ctx.fillText("目标区", t.x + 12, t.y - 78);
}

function drawObstacle(ctx) {
  const o = CONFIG.obstacle;
  ctx.fillStyle = "#b85c4a";
  ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.strokeStyle = "#e08a78";
  ctx.strokeRect(o.x, o.y, o.w, o.h);
  ctx.fillStyle = "#f3c1b6";
  for (let y = o.y + 8; y < o.y + o.h; y += 14) {
    ctx.fillRect(o.x + 4, y, o.w - 8, 3);
  }
}

function drawCrane(ctx, state) {
  const pivot = CONFIG.boomPivot;
  const tip = tipPosition(state.angle);

  ctx.strokeStyle = "#6b8bb5";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(CONFIG.base.x, CONFIG.groundY);
  ctx.lineTo(pivot.x, pivot.y);
  ctx.stroke();

  ctx.fillStyle = "#33507a";
  ctx.beginPath();
  ctx.arc(pivot.x, pivot.y, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#d7e4f7";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(pivot.x, pivot.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();

  const cargo = cargoPosition(state.angle, state.length, state.swing);
  ctx.strokeStyle = "#9fb4d0";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(cargo.x, cargo.y);
  ctx.stroke();

  ctx.fillStyle = "#d7e4f7";
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawCargo(ctx, state) {
  const x = state.cargoX - CONFIG.boxW / 2;
  const y = state.cargoY - CONFIG.boxH / 2;
  const overload = state.tension > CONFIG.maxTension;
  ctx.fillStyle = overload ? "#ff6b6b" : "#e0a54b";
  ctx.fillRect(x, y, CONFIG.boxW, CONFIG.boxH);
  ctx.strokeStyle = overload ? "#ffd1d1" : "#f4d7a4";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, CONFIG.boxW, CONFIG.boxH);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.moveTo(x, y + CONFIG.boxH / 2);
  ctx.lineTo(x + CONFIG.boxW, y + CONFIG.boxH / 2);
  ctx.moveTo(x + CONFIG.boxW / 2, y);
  ctx.lineTo(x + CONFIG.boxW / 2, y + CONFIG.boxH);
  ctx.stroke();
}

function drawHud(ctx, state, input) {
  ctx.fillStyle = "rgba(10,18,32,0.78)";
  ctx.fillRect(12, 12, 218, 86);
  ctx.fillStyle = "#cfe0f6";
  ctx.font = "12px monospace";
  const lines = [
    `帧 ${state.frame}  t=${state.t.toFixed(2)}s`,
    `臂角 ${state.angle.toFixed(3)} rad  钢索 ${(state.length / PX_PER_M).toFixed(2)} m`,
    `摆角 ${state.swing.toFixed(3)} rad`,
    `输入 臂${input.boomTargetVel.toFixed(2)} 缆${input.cableTargetVel.toFixed(0)} 刹${input.brake.toFixed(2)}`,
  ];
  lines.forEach((line, i) => ctx.fillText(line, 22, 30 + i * 18));

  if (state.finished) {
    ctx.fillStyle = state.result === "success" ? "#48c988" : "#ff6b6b";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(state.result === "success" ? "吊装成功" : `终止：${state.result}`, 300, 60);
  }
}
