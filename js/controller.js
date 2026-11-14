/*
 * 确定性脚本控制器：演示“可以送达”的完整三批运输策略。
 * 纯函数式，每步根据模拟状态返回控制目标，无外部依赖。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sim.js'));
  } else {
    global.ShaftController = factory(global.ShaftSim);
  }
})(typeof self !== 'undefined' ? self : this, function (ShaftSim) {
  'use strict';

  const C = ShaftSim.CONFIG;
  const SAFE_INLET = 0.38;

  function createController() {
    return { phase: 'rise', log: [] };
  }

  // 返回 { inlet, overflow, brake } 目标值
  function decide(ctrl, s) {
    const input = { inlet: 0, overflow: 0, brake: 0 };
    if (s.status !== 'running' || s.paused) return input;

    if (s.loaded) {
      const atDock = s.basketY >= C.PLATFORM_Y - C.DOCK_BAND;
      if (!atDock) {
        // 上升阶段：半开进水阀抬升水位，溢流全关以避免流量平衡卡死
        ctrl.phase = 'rise';
        // 压力进入警戒带时短暂开溢流泄压（同时减速水流、抑制摆倾）
        const venting = s.pressure >= 80;
        // 泄压时保留小开度进水、溢流只开到中等，做平顺减速而非方向猛切
        input.inlet = venting ? 0.12 : SAFE_INLET;
        input.overflow = venting ? 0.35 : 0;
        input.brake = 0;
      } else {
        // 对接阶段：溢流减速、锁定制动器、保持姿态
        ctrl.phase = 'dock';
        input.inlet = 0;
        input.overflow = s.basketY <= C.PLATFORM_Y ? 0.5 : 1.0;
        input.brake = 1;
      }
    } else {
      // 返程：打开溢流排水，让吊篮落回底部装货位
      ctrl.phase = 'descend';
      input.inlet = 0;
      input.overflow = 1;
      input.brake = 0;
    }
    return input;
  }

  return { createController, decide, SAFE_INLET };
});
