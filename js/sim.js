/*
 * 纯模拟核心：与 DOM / Canvas / Audio 完全解耦，固定时间步长，确定性。
 * 同时支持浏览器（window.ShaftSim）与 Node（module.exports）。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.ShaftSim = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONFIG = {
    DT: 1 / 60,              // 固定步长（秒），保证确定性
    SHAFT_H: 100,            // 井筒高度单位
    INIT_LEVEL: 12,          // 固定初始水位
    PLATFORM_Y: 84,          // 上层平台高度
    DOCK_BAND: 2.0,          // 对接容差
    DOCK_TIME: 2.0,          // 稳定对接所需秒数
    RELOAD_Y: 16,            // 回到底部自动装货高度
    TIDE_INFLOW: 0.5,        // 潮水持续灌入（不可关闭）
    INLET_MAX: 2.6,          // 进水阀满开额外流量
    OVERFLOW_MAX: 2.2,       // 溢流闸最大泄流量
    VALVE_RATE: 0.7,         // 阀门开度变化速率（惯性 / 滞后）
    BRAKE_RATE: 2.5,         // 制动器啮合速率
    PRESSURE_RATE: 6.0,      // 进水阀造成的压力上升速率
    OVERFLOW_RELIEF: 5.5,    // 溢流闸泄压速率
    HYDRO_K: 0.0025,         // 静压系数 p = K * h^2
    PRESSURE_RUPTURE: 100,   // 裂管压力
    TILT_LIMIT: 14,          // 撞壁倾角（度）
    TILT_K: 1.2,             // 水流速度 -> 摆倾（稳定水流只产生小角度）
    TILT_EDDY: 1.0,          // 涡流扰动幅度
    AGITATION_DECAY: 2.4,    // 扰动自然衰减（停手约 1 秒回稳）
    AGITATION_TOGGLE: 3.2,   // 每次“进/排水方向反向”指令带来的扰动冲击
    AGITATION_ADJUST: 0.6,   // 同向微调带来的轻微扰动
    AGITATION_LIMIT: 16.0,   // 撞壁对应的累积扰动水平
    TILT_DAMP: 6.0,          // 摆倾跟随扰动的平滑系数
    BUOY_K: 0.10,            // 浮力对缆绳张力的影响
    TENSION_D: 0.06,
    BASKET_SPRING: 2.2,
    BASKET_DAMP: 1.8,
    BASKET_OFFSET: 2,        // 吊篮浮在水位之上的高度
    BATCHES: 3
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function hydrostatic(level) {
    return CONFIG.HYDRO_K * level * level;
  }

  return {
    CONFIG, clamp, hydrostatic, createState, step, snapshot, restore,
    metrics, setPaused, isPaused
  };

  function createState() {
    const level = CONFIG.INIT_LEVEL;
    return {
      time: 0,
      level,
      levelRate: 0,
      inletTarget: 0,          // 阀门指令（玩家输入）
      inlet: 0,                // 阀门实际开度（滞后值）
      overflowTarget: 0,
      overflow: 0,
      brakeTarget: 0,
      brake: 0,                // 0 = 随水浮动，1 = 锁定制动
      pressure: hydrostatic(level),
      basketY: level + CONFIG.BASKET_OFFSET,
      basketV: 0,
      tilt: 0,
      tiltV: 0,
      tension: 1,
      delivered: 0,
      remaining: CONFIG.BATCHES,
      loaded: 1,
      dockTimer: 0,
      status: 'running',       // running | won | failed
      failReason: null,
      lastFlowSpeed: 0,
      agitation: 0,
      prevInletTarget: 0,
      prevOverflowTarget: 0
    };
  }

  // 一步固定步长推进；input 为玩家在本步给出的目标控制量（可省略）
  function step(state, input) {
    const C = CONFIG;
    if (state.status !== 'running' || state.paused) {
      return state;
    }
    if (input) {
      if (Number.isFinite(input.inlet)) state.inletTarget = clamp(input.inlet, 0, 1);
      if (Number.isFinite(input.overflow)) state.overflowTarget = clamp(input.overflow, 0, 1);
      if (Number.isFinite(input.brake)) state.brakeTarget = clamp(input.brake, 0, 1);
    }
    updateAgitation(state);

    // 1) 阀门 / 制动器的惯性滞后：实际开度向目标缓变
    approach(state, 'inlet', state.inletTarget, C.VALVE_RATE * C.DT);
    approach(state, 'overflow', state.overflowTarget, C.VALVE_RATE * C.DT);
    approach(state, 'brake', state.brakeTarget, C.BRAKE_RATE * C.DT);

    // 2) 水量平衡：潮水 + 进水阀 - 溢流闸
    const inflow = C.TIDE_INFLOW + C.INLET_MAX * state.inlet;
    const outflow = C.OVERFLOW_MAX * state.overflow;
    const rate = inflow - outflow;
    const prevLevel = state.level;
    state.level = clamp(state.level + rate * C.DT, 0, C.SHAFT_H);
    state.levelRate = (state.level - prevLevel) / C.DT;
    state.lastFlowSpeed = inflow + outflow;

    // 3) 压力：静压 + 进水阀持续增压，溢流闸释放压力；有压力时才可能泄压
    const hydro = hydrostatic(state.level);
    const buildUp = C.PRESSURE_RATE * state.inlet * C.DT;
    const relief = C.OVERFLOW_RELIEF * state.overflow * C.DT;
    state.pressure = Math.max(hydro, state.pressure + buildUp - relief);

    updateBasket(state);
    updateTilt(state);
    updateTension(state);
    updateDocking(state);
    state.time += C.DT;
    return state;
  }

  function updateBasket(state) {
    const C = CONFIG;
    // 制动器啮合程度平滑混合“随水浮动”与“缆绳锁定”
    const floatY = state.level + C.BASKET_OFFSET;
    let target;
    if (state.brake < 0.5) {
      target = floatY;
    } else {
      target = state.basketY + (floatY - state.basketY) * (1 - state.brake) * 0.5;
    }
    const accel = C.BASKET_SPRING * (target - state.basketY) - C.BASKET_DAMP * state.basketV;
    state.basketV += accel * C.DT;
    state.basketY += state.basketV * C.DT;
    state.basketY = clamp(state.basketY, 0, C.SHAFT_H);
  }

  function updateTilt(state) {
    const C = CONFIG;
    // 摆倾主要由累积扰动决定，叠加小幅交变使画面自然；阈值与扰动水平直接对应
    const wobble = (state.agitation / C.AGITATION_LIMIT) * C.TILT_LIMIT
      * (0.9 + 0.1 * Math.sin(state.time * 0.6));
    const eddy = C.TILT_EDDY * Math.sin(state.time * 1.7);
    const targetTilt = C.TILT_K * state.levelRate + wobble
      + eddy * Math.abs(state.levelRate) / 2;
    // 倾角以一阶惯性跟随目标，保留摆动惯性同时不吞掉高频扰动
    state.tiltV = (targetTilt - state.tilt) / C.DT;
    state.tilt += (targetTilt - state.tilt) * Math.min(1, C.TILT_DAMP * C.DT);
    if (Math.abs(state.tilt) >= C.TILT_LIMIT) {
      state.status = 'failed';
      state.failReason = 'wall';
      state.tilt = Math.sign(state.tilt) * C.TILT_LIMIT;
    }
  }

  // 扰动累积：检测玩家目标指令的变化。
  // 同向微调只产生轻微扰动；进水与排水指令反向切换（猛切）产生强冲击。
  // 扰动随时间衰减，因此偶发、从容的操作安全，只有反复猛切才会累积到撞壁。
  function updateAgitation(state) {
    const C = CONFIG;
    const decayFactor = Math.exp(-C.AGITATION_DECAY * C.DT);
    let impulse = 0;
    const inletUp = state.inletTarget > state.prevInletTarget;
    const overflowUp = state.overflowTarget > state.prevOverflowTarget;
    if (inletUp || overflowUp) {
      impulse = (inletUp && overflowUp) ? C.AGITATION_TOGGLE
        : (inletUp !== overflowUp ? C.AGITATION_TOGGLE : C.AGITATION_ADJUST);
      // 进水与溢流方向对撞（一边开进水、一边仍在排水）按反向猛切处理
      if (inletUp && state.overflowTarget > 0.2) impulse = C.AGITATION_TOGGLE;
      if (overflowUp && state.inletTarget > 0.2) impulse = C.AGITATION_TOGGLE;
    } else if (state.inletTarget !== state.prevInletTarget
      || state.overflowTarget !== state.prevOverflowTarget) {
      impulse = C.AGITATION_ADJUST;
    }
    state.prevInletTarget = state.inletTarget;
    state.prevOverflowTarget = state.overflowTarget;
    state.agitation = Math.max(0, state.agitation * decayFactor + impulse);
  }

  function updateTension(state) {
    const C = CONFIG;
    // 载有物资更重；浮力随浸水深度卸载；加速度与流速进一步影响张力
    const load = state.loaded ? 1.25 : 0.85;
    const immersion = clamp(state.level - state.basketY + C.BASKET_OFFSET, 0, 12);
    const buoyancy = C.BUOY_K * immersion;
    const dynamic = C.TENSION_D * (Math.abs(state.basketV) * 4 + state.lastFlowSpeed);
    state.tension = Math.max(0.05, load - buoyancy + dynamic);
  }

  function updateDocking(state) {
    const C = CONFIG;
    const inBand = Math.abs(state.basketY - C.PLATFORM_Y) <= C.DOCK_BAND;
    const stable = inBand && state.brake >= 0.8 && Math.abs(state.tilt) < C.TILT_LIMIT * 0.6;
    if (stable) {
      state.dockTimer += C.DT;
      if (state.dockTimer >= C.DOCK_TIME && state.loaded && state.status === 'running') {
        state.delivered += 1;
        state.remaining -= 1;
        state.loaded = 0;
        state.dockTimer = 0;
        if (state.remaining <= 0) {
          state.status = 'won';
        }
      }
    } else {
      state.dockTimer = 0;
    }
    // 吊篮落回底部装货位且已卸货 -> 自动装上下一批
    if (!state.loaded && state.status === 'running' && state.basketY <= C.RELOAD_Y) {
      state.loaded = 1;
    }
    // 超压裂管判定
    if (state.pressure >= C.PRESSURE_RUPTURE && state.status === 'running') {
      state.status = 'failed';
      state.failReason = 'rupture';
    }
  }

  function snapshot(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function restore(snap) {
    return JSON.parse(JSON.stringify(snap));
  }

  function metrics(state) {
    return {
      ruptureRatio: state.pressure / CONFIG.PRESSURE_RUPTURE,
      tiltRatio: Math.abs(state.tilt) / CONFIG.TILT_LIMIT,
      waterPct: state.level / CONFIG.SHAFT_H
    };
  }
  function approach(state, key, target, maxDelta) {
    const diff = target - state[key];
    const d = clamp(diff, -maxDelta, maxDelta);
    state[key] += d;
  }

  function setPaused(state, paused) {
    state.paused = !!paused;
    return state;
  }

  function isPaused(state) {
    return !!state.paused;
  }
});
