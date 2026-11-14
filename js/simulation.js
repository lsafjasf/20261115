/* 池塘蓝藻净化模拟 —— 核心数值引擎（1 tick = 1 秒，纯逻辑，无 DOM 依赖） */
(function (global) {
  "use strict";

  var DURATION = 240;          // 模拟总时长（秒）
  var ALGAE_SAFE = 30;         // 藻密度安全上限
  var DO_SAFE = 5.0;           // 溶氧安全下限 mg/L
  var DO_FISH_KILL = 2.0;      // 鱼类窒息阈值
  var HOLD_TICKS = 3;          // 双指标同时安全需保持的秒数

  var defaults = {
    timeLeft: DURATION,
    algae: 78,                 // 藻密度 0-100（暴发状态）
    dissolvedOxygen: 3.4,      // 溶氧 mg/L
    turbidity: 38,             // 浊度 NTU（量纲缩放至 0-100）
    plantHealth: 95,           // 水生植物活力 0-100
    sedimentStability: 85,     // 底泥稳定度 0-100，越低越易翻起
    lowDoTicks: 0,             // 溶氧低于窒息线的累计秒数
    safeHoldTicks: 0,          // 双安全区保持秒数
    shadeStressTicks: 0,       // 高遮光累计秒数
    disturbanceTicks: 0,       // 底泥受扰动累计秒数
    status: "ready",           // ready | running | paused | won | lost
    loseReason: "",
    lastEvent: null
  };

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function PondSimulation(options) {
    this.continueAfterFinish = !!(options && options.continueAfterFinish);
    this.finalStatus = "";
    this.controls = { aeration: 0, pump: 0, shade: 0 };
    this.reset();
  }

  PondSimulation.prototype.reset = function () {
    for (var key in defaults) {
      if (Object.prototype.hasOwnProperty.call(defaults, key)) {
        this[key] = defaults[key];
      }
    }
    this.events = [];
    this.tickCount = 0;
    this.finished = false;
    return this;
  };

  PondSimulation.prototype.setControls = function (c) {
    if (typeof c.aeration === "number") this.controls.aeration = clamp(c.aeration, 0, 100);
    if (typeof c.pump === "number") this.controls.pump = clamp(c.pump, 0, 100);
    if (typeof c.shade === "number") this.controls.shade = clamp(c.shade, 0, 100);
  };

  PondSimulation.prototype.log = function (text, level) {
    var evt = { tick: this.tickCount, text: text, level: level || "info" };
    this.events.push(evt);
    this.lastEvent = evt;
  };

  PondSimulation.prototype.step = function () {
    if (this.status !== "running") return this;

    var c = this.controls;
    var aer = c.aeration / 100;
    var pump = c.pump / 100;
    var shade = c.shade / 100;
    var lightEff = clamp(1 - shade * 0.9, 0.08, 1); // 遮光网削减光照

    // —— 藻密度：光合增长 vs 循环泵絮凝排出 + 遮光胁迫 ——
    var growth = 0.010 * lightEff * this.algae * (1 - this.algae / 120);
    var pumpRemoval = 0.0030 * pump * this.algae;
    var shadeStress = 0.006 * shade * this.algae;
    this.algae = clamp(this.algae + growth - pumpRemoval - shadeStress, 0, 100);

    // —— 溶氧：曝气复氧 + 植物产氧 + 泵混合，抵消藻类/浊度耗氧 ——
    var aerationGain = 0.05 * aer * Math.max(0, (12 - this.dissolvedOxygen) / 12);
    var plantOxygen = 0.008 * (this.plantHealth / 100) * lightEff;
    var pumpMix = 0.006 * pump;
    var algaeDemand = 0.012 * (this.algae / 100);
    var turbDemand = 0.007 * (this.turbidity / 100);
    this.dissolvedOxygen = clamp(
      this.dissolvedOxygen + aerationGain + plantOxygen + pumpMix - algaeDemand - turbDemand,
      0, 14
    );

    // —— 浊度：向“藻类贡献 + 本底”漂移，泵促进沉降，强曝气翻底泥 ——
    var turbTarget = 18 + this.algae * 0.55;
    var turbDrift = 0.02 * (turbTarget - this.turbidity);
    var pumpSettle = 0.015 * pump * this.turbidity;
    var sedimentLift = 0;
    var aerDisturb = Math.max(0, (c.aeration - 70) / 30);   // >70% 才扰动
    var pumpDisturb = Math.max(0, (c.pump - 88) / 12) * 0.4;
    if (aerDisturb > 0 || pumpDisturb > 0) {
      sedimentLift = 0.35 * Math.max(aerDisturb, pumpDisturb);
      this.sedimentStability = clamp(this.sedimentStability - 0.12 * Math.max(aerDisturb, pumpDisturb), 0, 100);
      this.disturbanceTicks++;
      if (this.disturbanceTicks === 1) this.log("底泥被强流掀起，浊度开始反弹！", "danger");
      else if (this.disturbanceTicks % 20 === 0) this.log("底泥持续翻起，悬浮颗粒增多。", "warn");
    } else {
      this.sedimentStability = clamp(this.sedimentStability + 0.03, 0, 100);
    }
    this.turbidity = clamp(this.turbidity + turbDrift - pumpSettle + sedimentLift, 0, 100);

    // —— 水生植物：遮光过久受损，低遮光时恢复；高浊度也削弱光照 ——
    if (c.shade > 50) {
      this.shadeStressTicks++;
      var stressFactor = (c.shade - 50) / 50;
      // 遮光损伤随持续时间加速：前 60 秒轻微，之后迅速恶化
      var plantDamage = this.shadeStressTicks <= 60
        ? 0.08 * stressFactor
        : 0.35 * stressFactor + 0.0035 * stressFactor * (this.shadeStressTicks - 60);
      this.plantHealth -= plantDamage;
      if (this.shadeStressTicks === 30) this.log("遮光时间偏长，水生植物开始发黄。", "warn");
    } else if (c.shade < 30) {
      this.plantHealth += 0.03;
    }
    if (this.turbidity > 80) this.plantHealth -= 0.01 * ((this.turbidity - 80) / 20);
    this.plantHealth = clamp(this.plantHealth, 0, 100);

    // —— 鱼群窒息判定 ——
    if (this.dissolvedOxygen < DO_FISH_KILL) {
      this.lowDoTicks++;
      if (this.lowDoTicks === 1) this.log("溶氧过低，鱼群开始浮头！", "danger");
      if (this.lowDoTicks >= 5) {
        this.finish(false, "溶氧持续低于 2.0 mg/L，鱼群窒息死亡");
        return this;
      }
    } else {
      this.lowDoTicks = 0;
    }

    if (this.plantHealth <= 0) {
      this.finish(false, "水生植物活力归零，生态系统崩溃");
      return this;
    }

    // —— 双安全区保持判定 ——
    if (this.algae <= ALGAE_SAFE && this.dissolvedOxygen >= DO_SAFE) {
      this.safeHoldTicks++;
      if (this.safeHoldTicks === HOLD_TICKS) {
        this.finish(true, "");
        return this;
      }
    } else {
      this.safeHoldTicks = 0;
    }

    this.timeLeft--;
    this.tickCount++;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.finish(false, "4 分钟内未能让藻密度与溶氧同时进入安全区");
    }
    return this;
  };

  PondSimulation.prototype.finish = function (won, reason) {
    if (this.finished) return;
    this.finished = true;
    this.finalStatus = won ? "won" : "lost";
    this.status = this.continueAfterFinish ? "running" : this.finalStatus;
    this.loseReason = reason;
    this.log(won ? "净化成功，水质达标！" : reason, won ? "info" : "danger");
  };

  PondSimulation.prototype.snapshot = function () {
    return {
      timeLeft: this.timeLeft,
      algae: this.algae,
      dissolvedOxygen: this.dissolvedOxygen,
      turbidity: this.turbidity,
      plantHealth: this.plantHealth,
      sedimentStability: this.sedimentStability,
      safeHoldTicks: this.safeHoldTicks,
      status: this.status,
      finalStatus: this.finalStatus,
      finished: this.finished,
      loseReason: this.loseReason,
      controls: {
        aeration: this.controls.aeration,
        pump: this.controls.pump,
        shade: this.controls.shade
      }
    };
  };

  PondSimulation.DURATION = DURATION;
  PondSimulation.ALGAE_SAFE = ALGAE_SAFE;
  PondSimulation.DO_SAFE = DO_SAFE;

  global.PondSimulation = PondSimulation;
  if (typeof module !== "undefined" && module.exports) module.exports = PondSimulation;
})(typeof window !== "undefined" ? window : globalThis);
