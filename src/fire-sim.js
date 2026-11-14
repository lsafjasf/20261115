/*
 * 消防供水/火场仿真核心（纯 JS，无 DOM 依赖，可在浏览器与 Node 中运行）
 *
 * 模型概要：
 *  - 三台泵并联：每台泵有截流压力 p0 与内阻 rp，泵流量 q = (p0 - p)/rp
 *  - 四条水带支路：支路阻力 Ri 随长度（距离）增大，流量 qi = valve * sqrt(p / Ri)
 *  - 管网压力 p 由“并联泵供水量 = 各支路用水量”在每一步求解（二次方程解析解）
 *  - 阀门瞬时关闭/泵急停产生水锤压力峰值，峰值过高会撑破水带
 *  - 水带破裂后该支路阻力骤降并大量漏水，可用阀门截流后压力重新分配
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FireSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const P = {
    dt: 0.05,                 // 固定步长（秒）
    tankCapacity: 4000,       // 储水（升）
    pressureWarn: 80,         // 水锤告警：附加峰值 kPa
    pressureBurst: 300,       // 水锤爆管：附加峰值 kPa（连续急停累积才达到）
    hammerK: 8,               // 水锤强度系数 kPa·s/L（阶跃流量 -> 压力峰值）
    leakFlow: 10,             // 破口泄放流量校验基准（升/秒）
    ruptureR: 0.12,           // 破口等效阻力（越小泄漏越剧烈）
    valveSlew: 0.25,          // 普通操作下阀门每秒最大变化量
    effectiveFlow: 2.2,       // 喷嘴有效冷却最小流量 L/s
    ambient: 25,              // 环境温度 ℃
    extinguishTemp: 60,       // 低于该温度视为扑灭
    growth: 6,                // 无人处置时每秒温升
    spread: 1.1,              // 相邻火点蔓延贡献
    cooling: 11,              // 有效流量下每秒温降系数
  };

  // 三台泵：截流压力越高越强，内阻越小流量越大
  const DEFAULT_PUMPS = [
    { id: 'P1', name: '1 号泵', p0: 420, rp: 14 },
    { id: 'P2', name: '2 号泵', p0: 380, rp: 12 },
    { id: 'P3', name: '3 号泵', p0: 340, rp: 10 },
  ];

  // 四条水带：长度/抬升不同，距离越远阻力越大
  const DEFAULT_HOSES = [
    { id: 'H1', name: '水带 A', length: 40,  r: 1.6, temp: 640 },
    { id: 'H2', name: '水带 B', length: 70,  r: 2.8, temp: 720 },
    { id: 'H3', name: '水带 C', length: 110, r: 4.6, temp: 800 },
    { id: 'H4', name: '水带 D', length: 160, r: 7.2, temp: 900 },
  ];

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // 求解管网平衡压力：供水量 A - B*p = 需水量 sqrt(p)*S
  // 返回 { pressure, pumpFlows:[], hoseFlows:[], totalFlow, supply, demand }
  function solveHydraulics(state) {
    let A = 0, B = 0;
    for (const pump of state.pumps) {
      if (pump.on) { A += pump.p0 / pump.rp; B += 1 / pump.rp; }
    }
    const S = state.hoses.reduce((sum, h) => {
      if (h.ruptured) {
        // 破口在阀门下游：关阀可逐步节流隔离，开度越大泄漏越严重
        return sum + h.valve / Math.sqrt(P.ruptureR);
      }
      if (h.valve <= 0.001) return sum;
      return sum + h.valve / Math.sqrt(h.r);
    }, 0);

    let pressure = 0;
    if (A <= 0 || S <= 0) {
      pressure = 0;
    } else if (B === 0) {
      pressure = Math.pow(A / S, 2);
    } else {
      // 二分法，稳定且无需处理解析根
      let lo = 0, hi = A / B;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const supply = A - B * mid;
        const demand = S * Math.sqrt(Math.max(0, mid));
        if (supply > demand) lo = mid; else hi = mid;
      }
      pressure = (lo + hi) / 2;
    }

    const pumpFlows = state.pumps.map(pump =>
      pump.on ? Math.max(0, (pump.p0 - pressure) / pump.rp) : 0);
    const hoseFlows = state.hoses.map(h => {
      if (h.ruptured) {
        return h.valve * Math.sqrt(Math.max(0, pressure) / P.ruptureR);
      }
      if (h.valve <= 0.001) return 0;
      return h.valve * Math.sqrt(Math.max(0, pressure) / h.r);
    });
    return {
      pressure,
      pumpFlows,
      hoseFlows,
      totalFlow: hoseFlows.reduce((a, b) => a + b, 0),
      supply: A - B * pressure,
    };
  }

  class Simulation {
    constructor(options = {}) {
      this.config = {
        pumps: DEFAULT_PUMPS.map(p => ({ ...p, on: false })),
        hoses: DEFAULT_HOSES.map(h => ({ ...h })),
      };
      this.reset(options);
    }

    reset(options = {}) {
      const ruptureAt = options.ruptureAt != null ? options.ruptureAt : 35;
      const ruptureHose = options.ruptureHose != null ? options.ruptureHose : 2;
      this.t = 0;
      this.tank = P.tankCapacity;
      this.tankEmpty = false;
      this.status = 'running'; // running | won | lost
      this.events = [];
      this.hoses = this.config.hoses.map(h => ({
        id: h.id, name: h.name, length: h.length, r: h.r,
        valve: 0, target: 0,
        flow: 0, temp: h.temp, out: false,
        ruptured: false, ruptureAt: null, hammer: 0,
      }));
      this.pumps = this.config.pumps.map(p => ({ ...p }));
      this.pressure = 0;
      this.hammer = 0;           // 当前水锤附加压力 kPa
      this.hammerWarn = false;
      this.smoke = 0;            // 烟层厚度 0..1
      this.rupturePlan = { at: ruptureAt, hose: ruptureHose, fired: false };
      this._last = { totalFlow: 0, pressure: 0 };
      return this;
    }

    log(type, message) { this.events.push({ t: this.t, type, message }); }

    setPump(i, on) {
      const pump = this.pumps[i];
      if (!pump || pump.on === !!on || this.status !== 'running') return;
      if (on && this.tankEmpty) return;
      pump.on = !!on;
      this.log('pump', `${pump.name}${pump.on ? '启动' : '停机'}`);
    }

    setValve(i, target) {
      const hose = this.hoses[i];
      if (hose) hose.target = clamp(target, 0, 1);
    }

    // 紧急关阀：立即截断，速度过快会引发水锤
    emergencyClose(i) {
      const hose = this.hoses[i];
      if (!hose || this.status !== 'running') return;
      hose.valve = 0;
      hose.target = 0;
      this.log('valve', `${hose.name}紧急关阀`);
    }

    triggerRupture(i) {
      const hose = this.hoses[i];
      if (!hose || hose.ruptured || this.status !== 'running') return;
      hose.ruptured = true;
      hose.ruptureAt = this.t;
      hose.target = hose.valve; // 维持开度，等待玩家处置
      this.log('rupture', `${hose.name}破裂！大量泄漏，管网压力骤降`);
    }

    step(dt = P.dt) {
      if (this.status !== 'running') return this.snapshot();
      this.t += dt;

      // 计划内破裂（用于演示/验证脚本）
      const plan = this.rupturePlan;
      if (!plan.fired && plan.at != null && this.t >= plan.at) {
        plan.fired = true;
        this.triggerRupture(plan.hose);
      }

      // 阀门按限速向目标开度移动（缓慢操作避免水锤）
      for (const hose of this.hoses) {
        if (Math.abs(hose.valve - hose.target) > 1e-6) {
          const dir = Math.sign(hose.target - hose.valve);
          hose.valve = clamp(
            hose.valve + dir * P.valveSlew * dt,
            Math.min(hose.valve, hose.target),
            Math.max(hose.valve, hose.target));
        }
      }

      const hydro = solveHydraulics(this);
      this.pressure = hydro.pressure;

      hydro.hoseFlows.forEach((q, i) => { this.hoses[i].flow = q; });
      this.pumpFlows = hydro.pumpFlows;

      // 水锤：总流量在单步内骤降 -> 压力峰值（须在流量更新后计算）
      const dFlow = this._last.totalFlow - hydro.totalFlow;
      const spike = Math.max(0, dFlow / dt) * P.hammerK * dt;
      this.hammer = Math.max(0, this.hammer * Math.exp(-0.9 * dt) + spike);
      this.hammerWarn = this.hammer >= P.pressureWarn;
      if (this.hammerWarn && spike > 1) {
        this.log('hammer',
          `水锤冲击 ${Math.round(this.pressure + this.hammer)} kPa`);
      }

      // 水锤峰值过高：撑破当前流量最大的完好支路
      if (this.hammer >= P.pressureBurst) {
        const victim = this.hoses
          .filter(h => !h.ruptured)
          .sort((a, b) => b.flow - a.flow)[0];
        if (victim) this.triggerRupture(this.hoses.indexOf(victim));
        this.hammer = 0;
      }

      // 储水消耗与耗尽
      this.tank = Math.max(0, this.tank - hydro.totalFlow * dt);
      if (this.tank <= 0 && !this.tankEmpty) {
        this.tankEmpty = true;
        this.pumps.forEach(p => { p.on = false; });
        this.log('tank', '储水耗尽，全部泵停机');
      }

      this.updateFires(dt);
      this.updateSmoke(dt);
      this._last = { totalFlow: hydro.totalFlow, pressure: hydro.pressure };
      this.checkEnd();
      return this.snapshot();
    }

    updateFires(dt) {
      const alive = this.hoses.filter(h => !h.out);
      for (const hose of this.hoses) {
        if (hose.out) continue;
        // 有效冷却：流量达到喷嘴门槛才显著吸热
        const effective = Math.max(0, hose.flow - P.effectiveFlow * 0.55);
        // 破裂水带不能再直接灭火；隔离后由其余仍出水的水带协同压制
        const isolated = hose.ruptured && hose.valve <= 0.02;
        const helperFlow = this.hoses
          .filter(other => other !== hose && !other.ruptured)
          .reduce((sum, other) =>
            sum + Math.max(0, other.flow - P.effectiveFlow * 0.55), 0);
        const helperCooling = isolated
          ? P.cooling * 0.55 * helperFlow * dt : 0;
        const cooling = hose.ruptured ? helperCooling
          : P.cooling * effective * dt;
        const growth = P.growth * dt;
        const neighbor = alive.length > 1
          ? P.spread * (alive.length - 1) * dt : 0;
        hose.temp = clamp(hose.temp - cooling + growth + neighbor,
          P.ambient, 1100);
        if (hose.temp <= P.extinguishTemp && (!hose.ruptured || isolated)) {
          hose.out = true;
          hose.temp = P.ambient;
          this.log('fire', `${hose.name}火点扑灭`);
        }
      }
    }

    updateSmoke(dt) {
      const heat = this.hoses.reduce((s, h) =>
        s + (h.out ? 0 : (h.temp - P.ambient) / 900), 0);
      const target = clamp(heat / this.hoses.length, 0, 1);
      this.smoke += (target - this.smoke) * Math.min(1, dt * 0.6);
    }

    checkEnd() {
      if (this.hoses.every(h => h.out)) {
        this.status = 'won';
        this.log('result', `全部火点扑灭，剩余 ${Math.round(this.tank)} 升水`);
      } else if (this.tankEmpty) {
        this.status = 'lost';
        this.log('result', '储水耗尽但仍有火点，灭火失败');
      }
    }

    snapshot() {
      return {
        t: this.t, status: this.status, tank: this.tank,
        tankEmpty: this.tankEmpty, pressure: this.pressure,
        hammer: this.hammer, hammerWarn: this.hammerWarn, smoke: this.smoke,
        pumps: this.pumps.map(p => ({ ...p })),
        hoses: this.hoses.map(h => ({ ...h })),
        events: this.events.slice(-40),
      };
    }
  }

  // 自动驾驶：按“先开泵、远端优先、缓慢调阀、破裂先截流”的策略完成灭火
  class AutoPilot {
    constructor(sim, options = {}) {
      this.sim = sim;
      this.decisionEvery = 0.2;
      this._acc = 0;
      this.ruptureAt = options.ruptureAt != null ? options.ruptureAt : 35;
      this.ruptureHose = options.ruptureHose != null ? options.ruptureHose : 2;
      this._ruptureDone = false;
    }

    update(dt) {
      this._acc += dt;
      if (this._acc < this.decisionEvery) return;
      this._acc = 0;
      const sim = this.sim;
      if (sim.status !== 'running') return;

      // 演示用：任务中段自动制造一次水带破裂
      if (!this._ruptureDone && this.ruptureAt != null &&
          sim.t >= this.ruptureAt && !sim.hoses[this.ruptureHose].ruptured) {
        this._ruptureDone = true;
        sim.triggerRupture(this.ruptureHose);
      }

      // 依次平稳启动三台泵（流量上升不产生水锤）
      sim.pumps.forEach((pump, i) => {
        if (!pump.on && sim.t >= 1 + i * 1.2 && !sim.tankEmpty) {
          sim.setPump(i, true);
        }
      });

      const active = sim.hoses.filter(h => !h.out && !h.ruptured);
      const maxR = Math.max(...sim.hoses.map(h => h.r));
      for (const hose of sim.hoses) {
        const idx = sim.hoses.indexOf(hose);
        if (hose.out) {
          // 保持小开度值守：防止复燃并为破裂火点提供协同流量
          sim.setValve(idx, hose.ruptured ? 0 : 0.16);
          continue;
        }
        if (hose.ruptured) {
          // 先保留 3 秒开度暴露泄漏压降，再缓慢全关隔离（避免误操作水锤）
          const sinceRupture = sim.t - (hose.ruptureAt || sim.t);
          sim.setValve(idx, sinceRupture >= 3 ? 0 : hose.valve);
          continue;
        }
        // 等流量分配：开度与 sqrt(阻力) 成正比，保证远端水带不缺水
        const share = Math.sqrt(hose.r / maxR);
        // 支路越少，剩余水带可适当开大；火点温度高的优先保供
        const loadBoost = clamp(1 + (4 - active.length) * 0.12, 1, 1.3);
        const heatBoost = clamp((hose.temp - 200) / 700, 0.85, 1.15);
        sim.setValve(sim.hoses.indexOf(hose),
          clamp(0.55 * share * loadBoost * heatBoost, 0.18, 1));
      }
    }
  }

  return {
    P, DEFAULT_PUMPS, DEFAULT_HOSES, solveHydraulics, clamp,
    Simulation, AutoPilot,
  };
});
