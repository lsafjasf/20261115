/* 海上风电-储能调度仿真核心：浏览器与 Node 共用 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WindSim = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DT = 0.5;               // 仿真步长（秒）
  var DURATION = 600;         // 一局时长：10 分钟
  var RHO = 1.225;            // 空气密度 kg/m^3
  var ROTOR_R = 63;           // 叶轮半径 m
  var AREA = Math.PI * ROTOR_R * ROTOR_R;
  var RATED_POWER = 5000;     // 单机额定 kW
  var CUT_IN = 3, RATED_V = 12, CUT_OUT = 25; // m/s

  var BAT_CAP = 20000;        // 电池容量 kWh
  var BAT_MIN = 0.15;         // 储能下限（SOC）
  var BAT_MAX_CHARGE = 8000;  // 最大安全充电功率 kW，超过损伤电池
  var BAT_MAX_DISCHARGE = 9000;

  // 三次用电高峰：起始秒、持续秒、功率 kW
  var PEAKS = [
    { start: 150, dur: 60, kw: 10000 },
    { start: 330, dur: 60, kw: 11000 },
    { start: 510, dur: 60, kw: 10500 },
  ];
  var BASE_LOAD = 4000;

  // 三台风机沿海岸线排布（与主导风向垂直）
  var TURBINES = [
    { x: 0, y: -260 },
    { x: 0, y: 0 },
    { x: 0, y: 260 },
  ];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createState(seed) {
    var rng = mulberry32(seed || 12345);
    return {
      t: 0,
      rng: rng,
      wind: { speed: 8, dir: 0, base: 8, gust: 0, gustT: 0, lull: 0, lullT: 0, nextGust: 20 + rng() * 30, nextLull: 60 + rng() * 60 },
      turbines: TURBINES.map(function (p, i) {
        return { id: i, x: p.x, y: p.y, yaw: 0, pitch: 4, power: 0, windEff: 0, rpm: 0 };
      }),
      battery: { soc: 0.5, health: 1.0, chargeKw: 0, mode: "auto" },
      demand: BASE_LOAD,
      unmetKw: 0,
      stats: {
        peakUnmet: PEAKS.map(function () { return 0; }),
        peakTotal: PEAKS.map(function (p) { return p.kw * p.dur / 3600; }),
        damageEvents: 0,
        blackoutSeconds: 0,
        energyGenerated: 0,
        energyCharged: 0,
        energyDischarged: 0,
      },
      events: [],
      over: false,
      success: false,
      failReason: null,
    };
  }

  // 功率曲线：桨距越大 Cp 越低；额定以上顺桨限功率（保护）
  function powerCurve(v, pitch) {
    if (v < CUT_IN || v >= CUT_OUT) return 0;
    var cpBase = 0.42 - 0.012 * pitch;
    if (cpBase < 0.05) cpBase = 0.05;
    var p = 0.5 * RHO * AREA * cpBase * v * v * v / 1000; // kW
    var cap = RATED_POWER * (1 - Math.max(0, pitch - 2) * 0.045);
    if (cap < RATED_POWER * 0.25) cap = RATED_POWER * 0.25;
    if (p > cap) p = cap;
    return p;
  }

  // 简化 Jensen 尾流：下游风机处在上游尾流锥内时风速亏损
  function applyWake(state, dirRad) {
    var dx = Math.cos(dirRad), dy = Math.sin(dirRad);
    var order = state.turbines.map(function (tb, i) {
      return { i: i, along: -(tb.x * dx + tb.y * dy) };
    }).sort(function (a, b) { return a.along - b.along; });
    var vEff = state.turbines.map(function () { return state.wind.speed; });
    var k = 0.075, ct = 0.8;
    for (var a = 0; a < order.length; a++) {
      var up = state.turbines[order[a].i];
      for (var b = a + 1; b < order.length; b++) {
        var dn = state.turbines[order[b].i];
        var dist = (dn.x - up.x) * -dx + (dn.y - up.y) * -dy;
        if (dist <= 2 * ROTOR_R) continue;
        var lat = Math.abs((dn.x - up.x) * -dy - (dn.y - up.y) * -dx);
        var wakeR = ROTOR_R + k * dist;
        if (lat < wakeR) {
          var overlap = 1 - lat / wakeR;
          var deficit = (1 - Math.sqrt(1 - ct)) * Math.pow(ROTOR_R / wakeR, 2) * overlap;
          vEff[order[b].i] *= (1 - deficit);
        }
      }
    }
    return vEff;
  }

  function stepWind(state) {
    var w = state.wind, rng = state.rng;
    w.base += (rng() - 0.5) * 0.06 + Math.sin(state.t / 90) * 0.004;
    w.base = Math.max(4, Math.min(13, w.base));
    w.dir += (rng() - 0.5) * 0.5;
    w.dir = Math.max(-35, Math.min(35, w.dir));
    w.gustT -= DT;
    if (w.gustT <= 0) {
      w.nextGust -= DT;
      if (w.nextGust <= 0) {
        w.gust = 3.5 + rng() * 3.5;
        w.gustT = 8 + rng() * 14;
        w.nextGust = 25 + rng() * 45;
        state.events.push({ t: state.t, type: "gust", msg: "阵风来袭 +" + w.gust.toFixed(1) + " m/s" });
      } else if (w.gust > 0) {
        w.gust = 0;
      }
    }
    w.lullT -= DT;
    if (w.lullT <= 0) {
      w.nextLull -= DT;
      if (w.nextLull <= 0) {
        w.lull = 3 + rng() * 2.5;
        w.lullT = 15 + rng() * 20;
        w.nextLull = 90 + rng() * 90;
        state.events.push({ t: state.t, type: "lull", msg: "风力骤减 -" + w.lull.toFixed(1) + " m/s" });
      } else if (w.lull > 0) {
        w.lull = 0;
      }
    }
    var target = w.base + w.gust - w.lull + (rng() - 0.5) * 0.5;
    w.speed += (target - w.speed) * 0.15;
    w.speed = Math.max(0.5, Math.min(24, w.speed));
  }

  function currentPeak(t) {
    for (var i = 0; i < PEAKS.length; i++) {
      if (t >= PEAKS[i].start && t < PEAKS[i].start + PEAKS[i].dur) return i;
    }
    return -1;
  }

  // controls: { yaw:[deg,deg,deg], pitch:[deg,deg,deg], batteryMode:"auto"|"charge"|"discharge"|"idle", batteryKw: 目标充放功率 }
  function step(state, controls) {
    if (state.over) return state;
    state.t += DT;
    stepWind(state);

    var dirRad = state.wind.dir * Math.PI / 180;
    var vEff = applyWake(state, dirRad);
    var totalGen = 0;
    for (var i = 0; i < state.turbines.length; i++) {
      var tb = state.turbines[i];
      if (controls && controls.yaw) tb.yaw = Math.max(-45, Math.min(45, controls.yaw[i]));
      if (controls && controls.pitch) tb.pitch = Math.max(0, Math.min(25, controls.pitch[i]));
      // 偏航误差按 cos^2 损失
      var yawErr = (tb.yaw - state.wind.dir) * Math.PI / 180;
      var yawFactor = Math.pow(Math.cos(yawErr), 2);
      tb.windEff = vEff[i];
      tb.power = powerCurve(vEff[i], tb.pitch) * yawFactor;
      tb.rpm = tb.power > 0 ? 6 + (tb.power / RATED_POWER) * 12 : 0;
      totalGen += tb.power;
    }
    state.stats.energyGenerated += totalGen * DT / 3600;

    var peakIdx = currentPeak(state.t);
    state.demand = peakIdx >= 0 ? PEAKS[peakIdx].kw : BASE_LOAD;

    // 能量平衡：发电 - 需求 = 盈余(充) 或 缺口(放)
    var net = totalGen - state.demand;
    var bat = state.battery;
    var chargeKw = 0, dischargeKw = 0;
    var mode = (controls && controls.batteryMode) || "auto";
    if (mode === "auto") {
      if (net > 0) chargeKw = net;
      else dischargeKw = -net;
    } else if (mode === "charge") {
      // 充电优先：电池按目标功率充电，剩余发电供负荷，缺口断电
      chargeKw = Math.min(controls.batteryKw || BAT_MAX_CHARGE, BAT_MAX_CHARGE);
    } else if (mode === "discharge") {
      // 放电：电池按目标功率输出，发电盈余弃电
      dischargeKw = Math.min(controls.batteryKw || BAT_MAX_DISCHARGE, BAT_MAX_DISCHARGE);
    } // idle：电池不动作，盈余弃电，缺口断电

    // 过充损伤：充电功率超过安全上限
    if (chargeKw > BAT_MAX_CHARGE) {
      var over = chargeKw - BAT_MAX_CHARGE;
      bat.health -= (over / BAT_MAX_CHARGE) * 0.004 * DT;
      state.stats.damageEvents += DT;
      if (state.stats.damageEvents % 5 < DT) {
        state.events.push({ t: state.t, type: "damage", msg: "过充损伤！充电功率 " + Math.round(chargeKw) + " kW" });
      }
      chargeKw = BAT_MAX_CHARGE + over * 0.5; // 部分能量硬灌进电池
    }
    if (chargeKw > BAT_MAX_CHARGE * 1.5) chargeKw = BAT_MAX_CHARGE * 1.5;
    dischargeKw = Math.min(dischargeKw, BAT_MAX_DISCHARGE);

    // SOC 更新
    var capNow = BAT_CAP * bat.health;
    bat.soc += (chargeKw - dischargeKw) * DT / 3600 / capNow;
    if (bat.soc > 1) bat.soc = 1;
    state.stats.energyCharged += chargeKw * DT / 3600;
    state.stats.energyDischarged += dischargeKw * DT / 3600;
    bat.chargeKw = chargeKw - dischargeKw;

    // 未满足负荷
    var served = totalGen - chargeKw + dischargeKw;
    state.unmetKw = Math.max(0, state.demand - served);
    if (state.unmetKw > 0) {
      state.stats.blackoutSeconds += DT;
      if (peakIdx >= 0) state.stats.peakUnmet[peakIdx] += state.unmetKw * DT / 3600;
    }

    // 失败判定
    if (bat.soc < BAT_MIN) {
      state.over = true;
      state.failReason = "储能低于下限 " + (BAT_MIN * 100) + "%（断电保护）";
    } else if (bat.health <= 0.2) {
      state.over = true;
      state.failReason = "电池健康度耗尽（过充损坏）";
    } else if (state.t >= DURATION) {
      state.over = true;
      var ok = true;
      for (var p = 0; p < PEAKS.length; p++) {
        if (state.stats.peakUnmet[p] > state.stats.peakTotal[p] * 0.05) ok = false;
      }
      state.success = ok;
      if (!ok) state.failReason = "有用电高峰未能满足";
    }
    return state;
  }

  return {
    DT: DT, DURATION: DURATION, PEAKS: PEAKS, BASE_LOAD: BASE_LOAD,
    BAT_CAP: BAT_CAP, BAT_MIN: BAT_MIN, BAT_MAX_CHARGE: BAT_MAX_CHARGE,
    BAT_MAX_DISCHARGE: BAT_MAX_DISCHARGE, RATED_POWER: RATED_POWER,
    TURBINES: TURBINES, CUT_IN: CUT_IN, RATED_V: RATED_V, CUT_OUT: CUT_OUT,
    createState: createState, powerCurve: powerCurve, applyWake: applyWake,
    stepWind: stepWind, currentPeak: currentPeak, step: step,
  };
});
