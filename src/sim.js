/*
 * 地下设施检修 —— 纯仿真核心（浏览器与 Node 测试共用）
 * 双人协作：A 操作液压（泵+闸门），B 操作电气（断路器+继电器）。
 * 液压有延迟，电气决定泵能否启动；恢复三组设备并保持安全即成功。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    dt: 0.1,             // 仿真步长（秒）
    pressureMin: 4.0,    // 安全压力下限 bar
    pressureMax: 8.0,    // 安全压力上限 bar
    pressureBurst: 10.0, // 过压爆裂阈值 bar
    startPressure: 5.0,
    pumpRate: 1.6,       // 泵全速加压 bar/s
    pumpSpinRate: 0.6,   // 泵转速变化 /s（启动延迟）
    gateFlow: 0.75,      // 单闸全开泄压 bar/s
    leak: 0.05,          // 管路泄漏 bar/s
    gateSlew: 0.8,       // 闸门开度变化 /s
    gateLag: 1.2,        // 液压延迟：指令到闸门动作的秒数
    voltMin: 200,        // 安全电压下限 V
    voltMax: 240,        // 安全电压上限 V
    voltBase: 228,
    voltRelayLoad: 3,    // 每个闭合继电器的压降
    voltPumpLoad: 8,     // 泵运行压降
    restoreTime: 20,     // 单组设备恢复所需累计秒数
    holdTime: 300        // 三组恢复后需保持安全的秒数（5 分钟）
  };

  var KEYS = ['pump', 'gate1', 'gate2', 'gate3', 'breaker', 'relay1', 'relay2', 'relay3'];

  function createSim(opts) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});

    var s = {
      t: 0,
      status: 'running',        // running | won | failed
      failReason: null,
      cmd: {
        pump: false,
        gates: [false, false, false],
        breaker: false,
        relays: [false, false, false]
      },
      pumpSpeed: 0,
      gatePos: [0, 0, 0],
      gateDelay: [0, 0, 0],     // 剩余液压延迟
      pressure: cfg.startPressure,
      voltage: 0,
      spikeAmp: 0,              // 电压瞬态幅值
      spikeAge: 99,
      groups: [
        { progress: 0, restored: false },
        { progress: 0, restored: false },
        { progress: 0, restored: false }
      ],
      hold: 0,
      events: []
    };

    var prevVoltOk = true;
    var prevPressOk = true;

    function log(type, msg) {
      s.events.push({ t: Math.round(s.t * 100) / 100, type: type, msg: msg });
    }

    function relaysOn() {
      return s.cmd.relays.filter(Boolean).length;
    }

    function computeVoltage() {
      if (!s.cmd.breaker) return 0;
      var v = cfg.voltBase - cfg.voltRelayLoad * relaysOn();
      if (s.pumpSpeed > 0.5) v -= cfg.voltPumpLoad;
      v += s.spikeAmp * Math.exp(-s.spikeAge / 0.35);
      return v;
    }

    // 带载切换产生电压瞬态
    function switchSpike(amp) {
      if (s.pumpSpeed > 0.3 && s.cmd.breaker) {
        s.spikeAmp = amp;
        s.spikeAge = 0;
        log('spike', '带载切换，电压瞬态 ' + (amp > 0 ? '+' : '') + amp + 'V');
      }
    }

    function press(key) {
      if (s.status !== 'running') return false;
      var c = s.cmd;
      switch (key) {
        case 'pump':
          c.pump = !c.pump;
          log('input', 'A: 液压泵 ' + (c.pump ? '启动指令' : '停止指令'));
          break;
        case 'gate1': case 'gate2': case 'gate3': {
          var gi = Number(key.slice(4)) - 1;
          c.gates[gi] = !c.gates[gi];
          s.gateDelay[gi] = cfg.gateLag; // 液压延迟
          log('input', 'A: 闸门' + (gi + 1) + (c.gates[gi] ? ' 开启指令' : ' 关闭指令'));
          break;
        }
        case 'breaker':
          c.breaker = !c.breaker;
          if (s.pumpSpeed > 0.3) switchSpike(c.breaker ? -70 : 70);
          log('input', 'B: 主断路器 ' + (c.breaker ? '合闸' : '分闸'));
          break;
        case 'relay1': case 'relay2': case 'relay3': {
          var ri = Number(key.slice(5)) - 1;
          var turningOff = c.relays[ri];
          c.relays[ri] = !c.relays[ri];
          switchSpike(turningOff ? 55 : -45);
          log('input', 'B: 继电器' + (ri + 1) + (c.relays[ri] ? ' 吸合' : ' 释放'));
          break;
        }
        default:
          return false;
      }
      return true;
    }

    // 同一拍内施加多个输入（两人同时操作）
    function pressMany(keys) {
      var applied = [];
      for (var i = 0; i < keys.length; i++) {
        if (press(keys[i])) applied.push(keys[i]);
      }
      if (applied.length > 1) log('sync', '同时输入: ' + applied.join(' + '));
      return applied;
    }

    function step(dt) {
      if (s.status !== 'running') return;
      dt = dt || cfg.dt;
      s.t += dt;

      // 泵：需断路器合闸才有电，转速缓慢跟随指令
      var pumpTarget = (s.cmd.pump && s.cmd.breaker) ? 1 : 0;
      s.pumpSpeed += clamp(pumpTarget - s.pumpSpeed, cfg.pumpSpinRate * dt);

      // 闸门：液压延迟后开度缓慢跟随指令
      for (var i = 0; i < 3; i++) {
        if (s.gateDelay[i] > 0) {
          s.gateDelay[i] -= dt;
        } else {
          var target = s.cmd.gates[i] ? 1 : 0;
          s.gatePos[i] += clamp(target - s.gatePos[i], cfg.gateSlew * dt);
          s.gatePos[i] = Math.max(0, Math.min(1, s.gatePos[i]));
        }
      }

      // 压力
      var inflow = cfg.pumpRate * s.pumpSpeed;
      var outflow = cfg.leak;
      for (var g = 0; g < 3; g++) outflow += cfg.gateFlow * s.gatePos[g];
      s.pressure = Math.max(0, s.pressure + (inflow - outflow) * dt);

      // 电压
      s.spikeAge += dt;
      s.voltage = computeVoltage();

      var pressOk = s.pressure >= cfg.pressureMin && s.pressure <= cfg.pressureMax;
      var voltOk = s.voltage >= cfg.voltMin && s.voltage <= cfg.voltMax;

      if (voltOk !== prevVoltOk) {
        log(voltOk ? 'volt_ok' : 'volt_bad',
          voltOk ? '电压恢复安全 (' + Math.round(s.voltage) + 'V)'
                 : '电压越限 (' + Math.round(s.voltage) + 'V)');
        prevVoltOk = voltOk;
      }
      if (pressOk !== prevPressOk) {
        log(pressOk ? 'press_ok' : 'press_bad',
          pressOk ? '压力恢复安全 (' + s.pressure.toFixed(1) + ' bar)'
                  : '压力越限 (' + s.pressure.toFixed(1) + ' bar)');
        prevPressOk = pressOk;
      }

      // 过压 → 爆管失败
      if (s.pressure > cfg.pressureBurst) {
        s.status = 'failed';
        s.failReason = 'overpressure';
        log('overpressure', '过压爆管！压力 ' + s.pressure.toFixed(1) + ' bar > ' + cfg.pressureBurst + ' bar');
        return;
      }

      // 设备组恢复：继电器吸合 + 对应闸门开足 + 压力安全
      for (var k = 0; k < 3; k++) {
        var grp = s.groups[k];
        if (!grp.restored && s.cmd.relays[k] && s.gatePos[k] > 0.8 && pressOk) {
          grp.progress += dt;
          if (grp.progress >= cfg.restoreTime) {
            grp.restored = true;
            log('restored', '设备组 ' + (k + 1) + ' 恢复完成');
          }
        }
      }

      // 全部恢复后保持压力、电压安全
      var allRestored = s.groups.every(function (g) { return g.restored; });
      if (allRestored) {
        if (pressOk && voltOk) {
          s.hold += dt;
          if (s.hold >= cfg.holdTime) {
            s.status = 'won';
            log('won', '安全保持 ' + cfg.holdTime + 's，检修成功！');
          }
        } else if (s.hold > 0) {
          log('hold_reset', '安全计时中断，重新计时');
          s.hold = 0;
        }
      }
    }

    function clamp(delta, maxAbs) {
      if (delta > maxAbs) return maxAbs;
      if (delta < -maxAbs) return -maxAbs;
      return delta;
    }

    function getState() {
      var p = s.pressure;
      var zone = p > cfg.pressureBurst * 0.9 ? 'critical'
        : (p < cfg.pressureMin || p > cfg.pressureMax) ? 'warn' : 'ok';
      return {
        t: s.t,
        status: s.status,
        failReason: s.failReason,
        cmd: s.cmd,
        pumpSpeed: s.pumpSpeed,
        gatePos: s.gatePos.slice(),
        gateDelay: s.gateDelay.slice(),
        pressure: p,
        pressureZone: zone,
        voltage: s.voltage,
        voltageOk: s.voltage >= cfg.voltMin && s.voltage <= cfg.voltMax,
        pressureOk: p >= cfg.pressureMin && p <= cfg.pressureMax,
        groups: s.groups.map(function (g) { return { progress: g.progress, restored: g.restored }; }),
        allRestored: s.groups.every(function (g) { return g.restored; }),
        hold: s.hold,
        events: s.events
      };
    }

    return {
      cfg: cfg,
      KEYS: KEYS,
      press: press,
      pressMany: pressMany,
      step: step,
      getState: getState,
      events: s.events
    };
  }

  return { createSim: createSim, DEFAULTS: DEFAULTS, KEYS: KEYS };
});
