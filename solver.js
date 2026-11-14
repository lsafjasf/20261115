// 安全参数求解器：根据固定 seed 生成的货物质量，反解每辆车的
// 加速度、制动点与道岔提前量，保证六次换线无碰撞完成。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./sim.js'));
  } else {
    root.MaglevSolver = factory(root.MaglevSim);
  }
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  var SAFE_ACCEL = 42;       // 统一磁力推进档位
  var SAFE_LEAD = 0.45;      // 道岔提前量（秒），尽量晚请求以避开前车占用

  // 给定推进档位与质量，求制动点，使托盘恰好停在 TARGET_S
  function solveBrakePoint(accelReq, mass) {
    var accel = S.effectiveAccel(accelReq, mass);
    var decel = S.effectiveBrake(accelReq, mass); // 同档磁力制动
    var travel = S.TARGET_S - S.SPAWN_S;
    // 全程加速（未达限速）时：v_brake^2 = 2*a*d1；制动距离 d2 = v_brake^2/(2*decel)
    var vAtTargetIfNoBrake = Math.sqrt(2 * accel * travel);
    var brakePoint;
    if (vAtTargetIfNoBrake <= S.MAX_SPEED) {
      var vBrake = Math.sqrt(2 * accel * decel * travel / (accel + decel));
      var d1 = (vBrake * vBrake) / (2 * accel);
      brakePoint = S.SPAWN_S + d1;
    } else {
      // 达到限速后匀速，再制动
      var dAccel = (S.MAX_SPEED * S.MAX_SPEED) / (2 * accel);
      var dBrake = (S.MAX_SPEED * S.MAX_SPEED) / (2 * decel);
      brakePoint = S.TARGET_S - dBrake;
      if (S.SPAWN_S + dAccel > brakePoint) brakePoint = S.SPAWN_S + dAccel; // 防御性回退
    }
    return Math.round(brakePoint * 10) / 10;
  }

  function solveSettings(seed) {
    var missions = S.generateMissions(seed);
    var settings = {};
    missions.forEach(function (m) {
      settings[m.id + ':' + m.index] = {
        accel: SAFE_ACCEL,
        brakePoint: solveBrakePoint(SAFE_ACCEL, m.mass),
        switchLead: SAFE_LEAD
      };
    });
    return settings;
  }

  // 跑完整局并返回汇总（Node/浏览器通用）
  function runFullGame(seed, settings, maxSeconds) {
    var world = new S.World({ seed: seed, settings: settings });
    var cap = (maxSeconds || 90) * (1 / world.dt);
    var n = 0;
    while (world.status === 'running' && n < cap) {
      world.step();
      n++;
    }
    return {
      status: world.status,
      failReason: world.failReason,
      completed: world.completed,
      stats: world.stats,
      duration: Math.round(world.t * 100) / 100,
      events: world.events
    };
  }

  return {
    SAFE_ACCEL: SAFE_ACCEL,
    SAFE_LEAD: SAFE_LEAD,
    solveBrakePoint: solveBrakePoint,
    solveSettings: solveSettings,
    runFullGame: runFullGame
  };
});
