/* 自动驾驶：实际打完一局 10 分钟模拟，并对比两种桨距策略 */
"use strict";
const S = require("./sim.js");

// 通用驾驶：偏航追风；电池自动；高峰前预留电量（少充限充由桨距控制）
function baseControls(state, pitchOf) {
  const yaw = state.turbines.map(() => state.wind.dir);
  const pitch = state.turbines.map((tb, i) => pitchOf(state, tb, i));
  return { yaw, pitch, batteryMode: "auto" };
}

// 策略 A：激进固定低桨距（2°），追求最大捕获，不管阵风
const strategyA = {
  name: "A 激进固定桨距(2°)",
  pitchOf: () => 2,
};

// 策略 B：阵风自适应顺桨——风速高或充电功率逼近 8MW 上限时加大桨距限功率
const strategyB = {
  name: "B 阵风自适应顺桨",
  pitchOf: (state, tb) => {
    const v = tb.windEff || state.wind.speed;
    let pitch = 2;
    if (v > 10.5) pitch = 2 + (v - 10.5) * 3.2;      // 高风速顺桨
    if (state.battery.soc > 0.92) pitch += 6;         // 接近满充再压功率
    return Math.max(0, Math.min(22, pitch));
  },
};

function playGame(strategy, seed) {
  const state = S.createState(seed);
  const trace = [];
  while (!state.over) {
    const ctrl = baseControls(state, strategy.pitchOf);
    if (strategy.batteryMode) {
      ctrl.batteryMode = strategy.batteryMode;
      ctrl.batteryKw = strategy.batteryKw || 10000;
    }
    S.step(state, ctrl);
    if (trace.length === 0 || state.t - trace[trace.length - 1].t >= 30) {
      trace.push({
        t: state.t, wind: state.wind.speed, soc: state.battery.soc,
        gen: state.turbines.reduce((a, tb) => a + tb.power, 0),
      });
    }
  }
  return { state, trace };
}

function summarize(name, results) {
  const n = results.length;
  const wins = results.filter(r => r.state.success).length;
  const avg = f => results.reduce((a, r) => a + f(r.state), 0) / n;
  console.log(`\n=== ${name} ===`);
  console.log(`成功率:        ${wins}/${n}`);
  console.log(`总发电量:      ${avg(s => s.stats.energyGenerated).toFixed(0)} kWh`);
  console.log(`过充损伤时长:  ${avg(s => s.stats.damageEvents).toFixed(1)} s`);
  console.log(`电池健康度:    ${(avg(s => s.battery.health) * 100).toFixed(1)} %`);
  console.log(`断电时长:      ${avg(s => s.stats.blackoutSeconds).toFixed(1)} s`);
  console.log(`结束时 SOC:    ${(avg(s => s.battery.soc) * 100).toFixed(1)} %`);
  const unmet = [0, 1, 2].map(i => avg(s => s.stats.peakUnmet[i]));
  console.log(`高峰缺供电量:  峰1 ${unmet[0].toFixed(1)} / 峰2 ${unmet[1].toFixed(1)} / 峰3 ${unmet[2].toFixed(1)} kWh`);
  const fails = results.filter(r => !r.state.success).map(r => r.state.failReason);
  if (fails.length) console.log(`失败原因:      ${fails.join("；")}`);
}

const SEEDS = [101, 202, 303, 404, 505, 606, 707, 808];

// 对照组 C：激进桨距 + 电池全程强制满功率充电（新手常见错误）
const strategyC = {
  name: "C 无保护满充（对照）",
  pitchOf: () => 2,
  batteryMode: "charge",
  batteryKw: 10000,
};

console.log("===== 单局实况（策略 B，种子 101）=====");
const demo = playGame(strategyB, 101);
demo.trace.forEach(p => {
  console.log(
    `t=${String(Math.floor(p.t)).padStart(3)}s 风=${p.wind.toFixed(1).padStart(4)}m/s ` +
    `发电=${(p.gen / 1000).toFixed(1).padStart(4)}MW SOC=${(p.soc * 100).toFixed(0).padStart(3)}%`
  );
});
demo.state.events.slice(0, 12).forEach(e =>
  console.log(`  [事件 t=${Math.floor(e.t)}s] ${e.msg}`));
console.log(`结果: ${demo.state.success ? "成功 ✓" : "失败 ✗ " + demo.state.failReason}`);

const resA = SEEDS.map(s => playGame(strategyA, s));
const resB = SEEDS.map(s => playGame(strategyB, s));
const resC = SEEDS.map(s => playGame(strategyC, s));
summarize(strategyA.name, resA);
summarize(strategyB.name, resB);
summarize(strategyC.name, resC);
