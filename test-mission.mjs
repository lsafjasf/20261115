// 自动验证：自动驾驶完成整趟邮递任务，检查不同高度的投递是否成功。
import { Simulation, WORLD, TARGETS } from "./sim.js";
import { Autopilot } from "./autopilot.js";

const sim = new Simulation();
const pilot = new Autopilot();
const maxSteps = 60 / WORLD.dt * 4; // 最长 4 分钟模拟时间
let drops = [];

for (let i = 0; i < maxSteps && sim.status === "flying"; i++) {
  const res = pilot.update(sim, WORLD.dt);
  if (res && res.ok) {
    drops.push({
      id: sim.results.length, // dropMail 后 results 尚未写入（落地才写），用 bagsLeft 反推
      t: sim.t,
      x: sim.x,
      alt: sim.altitude,
      vx: sim.vx,
      vz: sim.vz,
    });
  }
  sim.step();
}

// 等所有在途邮件落地
let guard = 0;
while (sim.mail.length > 0 && guard++ < 2000) sim.step();

console.log("=== 任务结束 ===");
console.log("状态:", sim.status, "| 用时:", sim.t.toFixed(1), "s | 剩余燃料:", sim.fuel.toFixed(1), "%");
console.log("\n=== 投出记录 ===");
for (const d of drops) {
  console.log(
    `第${d.id}袋 t=${d.t.toFixed(1)}s x=${d.x.toFixed(0)}m 高度=${d.alt.toFixed(1)}m ` +
      `vx=${d.vx.toFixed(2)} vz=${d.vz.toFixed(2)}`
  );
}
console.log("\n=== 落地判定 ===");
for (const r of sim.results) {
  console.log(`第${r.id + 1}袋 ${r.success ? "✅ 成功" : "❌ 失败"} 投出高度=${r.altitudeAtDrop.toFixed(1)}m | ${r.reason}`);
}

const successes = sim.results.filter((r) => r.success);
const distinctAlts = new Set(successes.map((r) => Math.round(r.altitudeAtDrop / 10) * 10));
let failures = 0;
if (successes.length < 2) { console.error("\n❌ 成功投递不足 2 次"); failures++; }
if (distinctAlts.size < 2) { console.error("❌ 投递高度没有体现不同高度"); failures++; }
if (sim.status !== "won") { console.error(`❌ 任务未胜利（${sim.status}）`); failures++; }
if (sim.fuel <= 0) { console.error("❌ 燃料耗尽"); failures++; }

// 每个接收圈的高度窗口确实不同
const windows = TARGETS.map((t) => t.altWindow.join("-")).filter((v, i, a) => a.indexOf(v) === i);
if (windows.length < 2) { console.error("❌ 目标高度窗口缺少差异"); failures++; }

if (failures === 0) {
  console.log(`\n✅ 验证通过：${successes.length} 次成功投递，覆盖 ${distinctAlts.size} 个不同高度层级，燃料剩余 ${sim.fuel.toFixed(1)}%`);
  process.exit(0);
} else {
  process.exit(1);
}
