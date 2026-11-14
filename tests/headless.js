import { Sim, TOTAL_PASSENGERS } from '../js/sim.js';

// 标准处置预案：先把闸门口设为只出不进（单向向上），第 25 秒开启排烟机
// 延迟开风扇可让烟感先真实触发报警，再验证排烟能阻止烟雾侵入安全区
function applyPlaybook(sim) {
  for (const gate of sim.layout.gates) sim.setDirection(gate.id, 'up');
  sim._fanStartTick = 250;
}

// 逐帧采样某通道 3x3 区域占用与排队长度
function instrument(sim, channelId) {
  const ctl = sim.controlById(channelId);
  const samples = [];
  const origStep = sim.step.bind(sim);
  sim.step = () => {
    origStep();
    let area = 0;
    for (let r = ctl.row - 1; r <= ctl.row + 1; r++) {
      for (let c = ctl.col - 1; c <= ctl.col + 1; c++) {
        if (r < 0 || c < 0 || r >= sim.layout.rows || c >= sim.layout.cols) continue;
        area += sim.occupancy[r][c] || 0;
      }
    }
    samples.push({ t: sim.time, area, onCell: sim.occupancy[ctl.row][ctl.col] || 0 });
  };
  return samples;
}

function runScenario(seed, closeChannel) {
  const sim = new Sim(seed);
  applyPlaybook(sim);
  if (closeChannel) {
    sim.setDirection(closeChannel, 'closed');
    sim.log(`对照实验：关闭通道 ${closeChannel}`);
  }
  const samplesC2 = instrument(sim, 'C2');
  const samplesC1 = instrument(sim, 'C1');
  const origStep2 = sim.step.bind(sim);
  sim.step = () => {
    if (sim.tick === sim._fanStartTick) {
      sim.toggleFan('F0');
      sim.toggleFan('F1');
    }
    origStep2();
  };
  const result = sim.run();
  const sum = (arr, key) => arr.reduce((acc, s) => acc + s[key], 0);
  const peak = (arr, key) => Math.max(...arr.map((s) => s[key]));
  return {
    result,
    sim,
    c2: {
      meanArea: +(sum(samplesC2, 'area') / samplesC2.length).toFixed(2),
      peakArea: peak(samplesC2, 'area'),
      meanOnCell: +(sum(samplesC2, 'onCell') / samplesC2.length).toFixed(2),
      peakOnCell: peak(samplesC2, 'onCell'),
    },
    c1: {
      meanArea: +(sum(samplesC1, 'area') / samplesC1.length).toFixed(2),
      peakArea: peak(samplesC1, 'area'),
      meanOnCell: +(sum(samplesC1, 'onCell') / samplesC1.length).toFixed(2),
      peakOnCell: peak(samplesC1, 'onCell'),
    },
  };
}

function pct(a, b) {
  if (b === 0) return a === 0 ? '0%' : '∞';
  return `${(((a - b) / b) * 100).toFixed(1)}%`;
}

console.log('========== 场景一：完整处置一局（标准预案） ==========');
const full = runScenario(20261115, null);
console.log('结果：', full.result);
console.log('烟感报警：', full.sim.layout.sensors.map((s) => `${s.id}=${s.alarm ? '报警' : '正常'}(${s.level})`).join('  '));
console.log('排烟机：', full.sim.layout.fans.map((f) => `${f.id}=${f.on ? '开' : '关'}`).join('  '));
console.log('安全区烟雾峰值：', Math.max(...full.sim.layout.safeZone.map((z) => full.sim.smoke[z.row][z.col])).toFixed(3));

console.log('\n========== 场景二：通道 C2 关闭前/后拥堵对照（同种子） ==========');
const seed = 7777;
const before = runScenario(seed, null);
const after = runScenario(seed, 'C2');
console.log('关闭前疏散：', before.result.win, `${before.result.time}s`, '峰值占用', before.result.maxOccupancy);
console.log('关闭后疏散：', after.result.win, `${after.result.time}s`, '峰值占用', after.result.maxOccupancy);
console.log('\n-- C2（被关闭通道）周边 3x3 区域 --');
console.log('关闭前 平均占用', before.c2.meanArea, ' 峰值', before.c2.peakArea);
console.log('关闭后 平均占用', after.c2.meanArea, ' 峰值', after.c2.peakArea);
console.log('\n-- C1（相邻通道，承接改道客流）--');
console.log('关闭前 平均占用', before.c1.meanArea, ' 峰值', before.c1.peakArea, ' 格内峰值', before.c1.peakOnCell);
console.log('关闭后 平均占用', after.c1.meanArea, ' 峰值', after.c1.peakArea, ' 格内峰值', after.c1.peakOnCell);
console.log('C1 平均拥堵变化：', pct(after.c1.meanArea, before.c1.meanArea));
console.log('\n-- 全局指标 --');
console.log('关闭前 拥挤人秒', before.result.congestionSeconds, ' 踩踏风险帧', before.result.riskTicks);
console.log('关闭后 拥挤人秒', after.result.congestionSeconds, ' 踩踏风险帧', after.result.riskTicks);

// 断言
const ok = full.result.win
  && full.result.evacuated === TOTAL_PASSENGERS
  && !full.result.safeBreached
  && after.c1.meanArea >= before.c1.meanArea
  && after.c2.peakArea <= before.c2.peakArea;
console.log('\n断言：', ok ? 'PASS ✅' : 'FAIL ❌');
if (!ok) process.exit(1);
