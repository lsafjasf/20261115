// End-to-end scenario: trigger all four fault classes, pause/step, recover, export.
import { writeFileSync } from 'node:fs';
import { SensorTestbed, FAULT_LABEL } from '../src/engine.js';

let wall = 1_700_000_000_000;
const bench = new SensorTestbed(() => (wall += 3));

for (let i = 0; i < 4; i += 1) bench.tick();
console.log('基线采样完成，步号 =', bench.stepIndex);

bench.setFault('s3', 'missing', true);
bench.tick(); bench.tick();

bench.setFault('s2', 'spike', true);
bench.tick();

bench.setFault('s1', 'delay', true);
bench.tick(); bench.tick(); bench.tick();

bench.setFault('s2', 'out_of_order', true);
bench.tick(); bench.tick();

bench.setPaused(true);
const blocked = bench.tick();
console.log('暂停态普通 tick 事件数 =', blocked.length, '(应为 0)');
const stepped = bench.tick(true);
console.log('单步 force tick 事件数 =', stepped.length, '(应 > 0)');
bench.setPaused(false);

const cleared = bench.recoverAll();
console.log('一键恢复清除故障 =', cleared.map((item) => `${item.sensorId}:${FAULT_LABEL[item.fault]}`).join(', '));
for (let i = 0; i < 3; i += 1) bench.tick();

const csv = bench.exportLogs();
writeFileSync(new URL('../artifacts/fault-injection-log.csv', import.meta.url), csv);

const seq = bench.logs.map((log) => log.seq);
const monotonic = seq.every((value, index) => index === 0 || value > seq[index - 1]);
console.log('\n日志条数 =', bench.logs.length, '| seq 严格递增 =', monotonic);
for (const type of ['missing', 'spike', 'delay_hold', 'delay_release', 'out_of_order', 'pause', 'resume', 'recover', 'alarm', 'alarm_clear']) {
  console.log(`  ${type.padEnd(14)} ${bench.logs.filter((log) => log.type === type).length} 条`);
}
const clean = bench.sensors.every((sensor) =>
  sensor.faults.size === 0 && sensor.delayBuffer.length === 0 &&
  sensor.series.slice(-3).every((point) => Number.isFinite(point.value) && !point.isSpike && !point.outOfOrder));
console.log('\n恢复后三传感器全部干净数据 =', clean);
