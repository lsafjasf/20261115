// 可复现实测：一次完整三罐返航 + 一次受控打滑 + 制动距离对照。
import { writeFileSync } from 'node:fs';
import { createWorld } from '../js/world.js';
import { createRover, step, runEpisode, measureBraking } from '../js/simulation.js';
import { autopilot } from '../js/autopilot.js';
import { SEED, MAX_SPEED, DAMAGE_ABORT } from '../js/config.js';

const report = [];
const line = (s) => { report.push(s); console.log(s); };

line(`# 月面采样车实测报告（seed=${SEED}）\n`);

// --- 任务 1：三罐返航 ---
const world = createWorld(SEED);
const mission = runEpisode(world, autopilot, 60 * 160);
const r = mission.rover;
line('## 任务：三罐尘土返航');
line(`- 结果: ${r.status === 'returned' ? '成功返航 ✅' : '未完成 ❌'}`);
line(`- 用时: ${r.time.toFixed(1)} s，行驶里程: ${r.totalDistance.toFixed(1)} m`);
line(`- 样本: ${r.jars}/3，损伤: ${r.damage.toFixed(0)}/${DAMAGE_ABORT}`);
line(`- 滑坡次数: ${mission.log.filter((e) => e.type === 'landslide').length}，打滑次数: ${mission.log.filter((e) => e.type === 'slip-start').length}，腾空: ${mission.log.filter((e) => e.type === 'hop').length}`);
line('- 事件时间线: ' + mission.log
  .filter((e) => ['pickup', 'return', 'landslide', 'abort'].includes(e.type))
  .map((e) => `${e.type}${e.jar ? '#' + e.jar : ''}@${e.t.toFixed(1)}s`).join(' → '));
line('');

// --- 任务 2：受控打滑 ---
const w2 = createWorld(SEED);
const slip = createRover(w2);
slip.x = 4; slip.y = 27; slip.heading = 0;
const startY = slip.y;
let slipAt = -1;
let maxSide = 0;
for (let i = 0; i < 60 * 10 && slip.status === 'active'; i++) {
  const speed = Math.hypot(slip.vx, slip.vy);
  step(w2, slip, { throttle: 1, brake: 0, steer: speed > 4 ? 1 : 0 });
  const rx = -Math.sin(slip.heading);
  const ry = Math.cos(slip.heading);
  maxSide = Math.max(maxSide, Math.abs(slip.vx * rx + slip.vy * ry));
  if (slip.slip && slipAt < 0) slipAt = slip.time;
}
line('## 测试：高速急转打滑');
line(`- 打滑触发时刻: ${slipAt.toFixed(2)} s（平直跑道全油门后满舵）`);
line(`- 峰值横向速度: ${maxSide.toFixed(2)} m/s，累计滑移: ${slip.slipDistance.toFixed(2)} m`);
line(`- 横向路径偏移: ${(slip.y - startY).toFixed(2)} m（无转向干预下本应接近 0）`);
line(`- 结束状态: 损伤 ${slip.damage.toFixed(0)}，车体完好 ${slip.damage === 0 ? '✅' : '⚠️'}`);
line('');

// --- 制动距离对照 ---
const w3 = createWorld(SEED);
line('## 制动距离对照（6 m/s 全制动）');
for (const jars of [0, 1, 2, 3]) {
  const b = measureBraking(w3, 12, 33, 0, MAX_SPEED, jars);
  line(`- ${jars} 罐: ${b.distance.toFixed(2)} m / ${b.time.toFixed(2)} s`);
}

writeFileSync(new URL('../artifacts/demo-report.md', import.meta.url), report.join('\n') + '\n');
console.log('\n报告已写入 artifacts/demo-report.md');
