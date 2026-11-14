/* 数值平衡冒烟测试：node tests/balance.js */
const assert = require("assert");
const PondSimulation = require("../js/simulation.js");

function run(strategy, maxTicks = 240) {
  return runWith(new PondSimulation(), strategy, maxTicks);
}

function runContinue(strategy, maxTicks = 240) {
  return runWith(new PondSimulation({ continueAfterFinish: true }), strategy, maxTicks);
}

function runWith(sim, strategy, maxTicks) {
  const s = sim;
  s.status = "running";
  for (let t = 0; t < maxTicks && s.status === "running"; t++) {
    s.setControls(strategy(t, s));
    s.step();
  }
  return s;
}

const strategyA = (t) =>
  t < 150
    ? { aeration: 55, pump: 85, shade: 95 }
    : { aeration: 45, pump: 75, shade: 40 };

const strategyB = (t) =>
  t < 120
    ? { aeration: 60, pump: 87, shade: 98 }
    : t < 180
    ? { aeration: 50, pump: 80, shade: 60 }
    : { aeration: 40, pump: 70, shade: 35 };

const winA = run(strategyA);
console.log("A 强压方案:", winA.status, JSON.stringify(winA.snapshot(), null, 0));
assert.strictEqual(winA.status, "won", "强压方案应在 4 分钟内净化成功");
assert(winA.plantHealth > 60, "合理策略下植物不应大面积死亡");
assert(winA.turbidity < 45, "净化后浊度应明显回落");

const winB = run(strategyB);
assert.strictEqual(winB.status, "won", "三段式方案也应成功");

// 全程极限遮光：植物应受损严重（失败或濒临崩溃）
const extremeShade = runContinue(() => ({ aeration: 55, pump: 85, shade: 98 }));
console.log("全程极限遮光(继续到240s):", extremeShade.finalStatus,
  "plant =", extremeShade.plantHealth.toFixed(1));
assert(extremeShade.plantHealth <= 0,
  "全程 98% 遮光最终必须让水生植物死亡");
assert(extremeShade.events.some((e) => e.level === "warn"),
  "遮光损伤应产生预警事件");

// 完全不干预：应失败（鱼群或超时）
const idle = run(() => ({ aeration: 0, pump: 0, shade: 0 }));
assert.strictEqual(idle.status, "lost", "不干预必然失败");
console.log("不干预结果:", idle.loseReason);

// 底泥翻起：持续强曝气应造成浊度显著反弹
const overAer = run(() => ({ aeration: 100, pump: 20, shade: 30 }), 60);
assert(overAer.turbidity > 55, `强曝气 60 秒后浊度应反弹，实际 ${overAer.turbidity.toFixed(1)}`);
assert(overAer.disturbanceTicks > 30, "底泥扰动秒数应累计");
assert(overAer.sedimentStability < 85, "底泥稳定度应下降");
console.log("强曝气扰动: turb =", overAer.turbidity.toFixed(1),
  "disturbTicks =", overAer.disturbanceTicks,
  "sediment =", overAer.sedimentStability.toFixed(1));

console.log("\n所有平衡测试通过 ✔");
