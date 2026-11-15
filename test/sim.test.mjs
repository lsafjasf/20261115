// Node 侧逻辑测试：node test/sim.test.mjs
import { GEARS, gearById } from '../js/data.js';
import {
  verifyTrain, verifyOk, createSim, stepSim,
  startRecording, rpmOf, computePhases,
} from '../js/sim.js';

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

// 1) 预设故障（三轮 64T）应校验失败
let results = verifyTrain();
check('故障状态校验失败', !verifyOk());
check('故障信息指出中心距矛盾', results.some((r) => !r.ok && r.msg.includes('中心距')));

// 2) 换成 60T 后全部闭合
gearById('third').wheel = 60;
results = verifyTrain();
for (const r of results) console.log(`   [${r.ok ? 'ok' : 'err'}] ${r.msg}`);
check('修复后校验全部通过', verifyOk());

// 3) 错误替换件（56T）仍失败
gearById('third').wheel = 56;
check('56T 替换件校验失败', !verifyOk());
gearById('third').wheel = 60;

// 4) 仿真步进：速比连续、记录 10 秒
const sim = createSim();
sim.running = true;
sim.timeScale = 20;
startRecording(sim);
for (let i = 0; i < 60 * 30 && !sim.recording.done; i++) stepSim(sim, 1 / 60);
check('10 秒记录完成', sim.recording.done);
check('记录样本约 100 行', sim.recording.samples.length >= 99 && sim.recording.samples.length <= 102);
const rpmSec = Math.abs(rpmOf(sim, 'fourth'));
const rpmMin = Math.abs(rpmOf(sim, 'center'));
const rpmHour = Math.abs(rpmOf(sim, 'hour'));
check(`秒针约 1rpm（实际 ${rpmSec.toFixed(3)}）`, Math.abs(rpmSec - 1) < 0.1);
check(`秒:分 = 60（实际 ${(rpmSec / rpmMin).toFixed(2)}）`, Math.abs(rpmSec / rpmMin - 60) < 0.01);
check(`分:时 = 12（实际 ${(rpmMin / rpmHour).toFixed(2)}）`, Math.abs(rpmMin / rpmHour - 12) < 0.01);

// 5) 相位计算覆盖所有零件
const phases = computePhases();
check('相位覆盖全部零件', GEARS.every((g) => g.id in phases));

// 6) 暂停时不推进
sim.running = false;
const t0 = sim.time;
stepSim(sim, 1 / 60);
check('暂停时不推进', sim.time === t0);

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
