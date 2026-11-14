// 自动驾驶：管理燃烧器/排气阀/风向舵，在满足高度与速度窗口时自动投递。
// 高度控制采用“悬停热量前馈 + 高度误差修正 + 速度预判”，适配大热惯性。
import { CONFIG, TARGETS, terrainHeight, windAt, WORLD } from "./sim.js";

// 快速预演邮件弹道，返回预测落点 x
function predictLandingX(sim) {
  let x = sim.x;
  let z = sim.z - 6;
  let vx = sim.vx;
  let vz = sim.vz - 1.5;
  const dt = WORLD.dt;
  for (let i = 0; i < CONFIG.bagLifetime / dt; i++) {
    const wind = windAt(x, z, sim.t);
    vx += (wind - vx) * Math.min(1, dt * 0.7);
    vz += (-9.81 - 0.17 * vz * Math.abs(vz)) * dt;
    x += vx * dt;
    z += vz * dt;
    if (z <= terrainHeight(x)) break;
  }
  return x;
}

export class Autopilot {
  constructor() {
    this.dropCooldown = 0;
  }

  reset() {
    this.dropCooldown = 0;
  }

  update(sim, dt) {
    const target = TARGETS[sim.results.length];
    const c = sim.controls;
    this.dropCooldown = Math.max(0, this.dropCooldown - dt);

    if (sim.status !== "flying") {
      c.burn = false;
      c.vent = false;
      c.rudder = 0;
      return null;
    }

    // 所有邮件已投出（仍有在途）：维持 60m 安全悬停，等待落地判定
    if (!target) {
      const safeAlt = 60;
      const err = safeAlt - sim.altitude;
      const hoverHeat = sim.mass / CONFIG.maxLift;
      const heatDemand = hoverHeat + err * 0.0016;
      const safetyBurn = sim.altitude < 30 && sim.vz < -2;
      const overshooting = err < -6 && sim.vz > 1.5;
      c.burn = ((sim.heat < heatDemand && !overshooting) || safetyBurn) && sim.fuel > 0;
      c.vent = err < -18 && sim.vz > 2.5;
      c.rudder = Math.max(-1, Math.min(1, -sim.vx / 8));
      return null;
    }

    // —— 高度控制 ——
    const targetAlt = (target.altWindow[0] + target.altWindow[1]) / 2;
    const err = targetAlt - sim.altitude;
    const hoverHeat = sim.mass / CONFIG.maxLift;          // 当前重量的悬停热量
    const heatDemand = hoverHeat + err * 0.0016;          // 高度误差转热量需求
    const safetyBurn = sim.altitude < 30 && sim.vz < -2;  // 低空保命
    const overshooting = err < -6 && sim.vz > 1.5;        // 高于目标且上冲，停止加热
    c.burn = ((sim.heat < heatDemand && !overshooting) || safetyBurn) && sim.fuel > 0;
    c.vent = err < -18 && sim.vz > 2.5;

    // —— 横向控制：以邮件预测落点为瞄准点，自动补偿风偏 ——
    const predictedX = predictLandingX(sim);
    const dx = target.x - sim.x;
    const aimErr = target.x - predictedX;
    const toward = dx * sim.vx; // >0 表示正在靠近，<0 表示远离
    const stopDistance = Math.max(0, sim.vx * sim.vx) / (2 * 3.0);
    let rudder = 0;
    if (toward > 0 && Math.abs(aimErr) <= stopDistance + 10) {
      // 靠近中且剩余距离不足以按当前速度停下：全力逆风刹车
      rudder = -Math.sign(sim.vx);
    } else if (Math.abs(aimErr) > stopDistance + 10) {
      rudder = Math.sign(aimErr) * Math.min(1, 0.3 + Math.abs(aimErr) / 260);
    } else if (Math.abs(aimErr) > 4) {
      rudder = Math.sign(aimErr) * 0.5;
    } else {
      rudder = Math.max(-1, Math.min(1, -sim.vx / 6));
    }
    c.rudder = rudder;

    // —— 投递：高度窗口留余量，位置取内圈，速度要温和 ——
    const [lo, hi] = target.altWindow;
    const inAlt = sim.altitude >= lo + 4 && sim.altitude <= hi - 4;
    const inX = Math.abs(predictedX - target.x) <= target.radius * 0.5;
    const speedOK = Math.hypot(sim.vx, sim.vz) <= target.maxGroundSpeed - 1.5;
    const vertOK = Math.abs(sim.vz) <= 2.4;
    if (inAlt && inX && speedOK && vertOK && this.dropCooldown === 0) {
      const res = sim.dropMail();
      if (res.ok) {
        this.dropCooldown = 1.2;
        return res;
      }
    }
    return null;
  }
}
