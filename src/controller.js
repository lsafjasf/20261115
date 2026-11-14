// 自动调水控制器：PI 迎角调压 + 低→高田顺序轮灌
import { CONFIG, setPitch, setGate, clamp } from './engine.js';

export function createController(targetPressure = 15) {
  return {
    targetPressure,
    integral: 0,
    active: 0,
    switchedAt: 0,
  };
}

export function control(state, ctl) {
  // 1) 轮灌：当前田块达到阈值+2% 余量即切换，防止边界抖动
  if (ctl.active < 3) {
    const i = ctl.active;
    if (state.moisture[i] >= CONFIG.targetMoisture + 2) {
      setGate(state, i, 0);
      ctl.active += 1;
      ctl.switchedAt = state.t;
    }
  }
  if (ctl.active < 3) setGate(state, ctl.active, 1);

  // 2) PI 调压：压力高收迎角，压力低放迎角
  const err = state.pressure - ctl.targetPressure;
  ctl.integral = clamp(ctl.integral + err * CONFIG.dt, -3, 3);
  const kp = 0.045;
  const ki = 0.012;
  const softStart = clamp(state.t / 6, 0, 1); // 前 6 秒缓慢起桨
  const beta =
    (0.35 - (kp * err + ki * ctl.integral)) * softStart;
  setPitch(state, beta);
}
