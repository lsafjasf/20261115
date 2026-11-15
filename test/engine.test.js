import assert from 'node:assert/strict';
import { SensorTestbed, FAULTS, FAULT_LABEL } from '../src/engine.js';

let passed = 0;
function test(name, fn) {
  const bench = new SensorTestbed((() => { let wall = 1_700_000_000_000; return () => (wall += 7); })());
  for (let i = 0; i < 4; i += 1) bench.tick();
  fn(bench);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('引擎故障注入测试:');

test('缺失值：无采样提交，缺失计数与告警正确', (bench) => {
  const sensor = bench.sensors[0];
  const before = sensor.series.length;
  bench.setFault('s1', 'missing', true);
  bench.tick();
  bench.tick();
  assert.equal(sensor.series.length, before, '缺失期间不应新增曲线点');
  assert.equal(sensor.missingStreak, 2);
  assert.equal(sensor.alarm, 'missing');
  assert.ok(bench.logs.some((log) => log.type === 'missing' && log.sensorId === 's1' && log.detail.streak === 2));
  bench.setFault('s1', 'missing', false);
  bench.tick();
  assert.equal(sensor.missingStreak, 0);
  assert.equal(sensor.series.length, before + 1, '恢复后立即产生新采样');
  assert.equal(sensor.alarm, 'ok', '干净采样必须清除 missing 告警');
  assert.ok(bench.logs.some((log) => log.type === 'alarm_clear' && log.sensorId === 's1'));
});

test('尖峰：产生越界值并触发 critical/error 告警，曲线带 isSpike 标记', (bench) => {
  const sensor = bench.sensors[1];
  bench.setFault('s2', 'spike', true);
  bench.tick();
  const point = sensor.series.at(-1);
  assert.equal(point.isSpike, true);
  assert.ok(['critical', 'error'].includes(sensor.alarm), `告警级别异常: ${sensor.alarm}`);
  assert.ok(bench.logs.some((log) => log.type === 'spike' && Number.isFinite(log.detail.value)));
});

test('延迟：先 hold 后 release，释放时间戳早于当前仿真时间', (bench) => {
  const sensor = bench.sensors[2];
  bench.setFault('s3', 'delay', true);
  const baseline = sensor.series.length;
  bench.tick(); // 仅缓存，不投递
  assert.equal(sensor.series.length, baseline, '第一拍只应缓存');
  assert.equal(sensor.delayBuffer.length, 1);
  assert.ok(bench.logs.some((log) => log.type === 'delay_hold'));
  bench.tick(); // 缓存第二拍，释放第一拍
  assert.equal(sensor.delayBuffer.length, 1);
  const release = bench.logs.filter((log) => log.type === 'delay_release').at(-1);
  assert.ok(release.detail.ageMs >= bench.intervalMs, '延迟释放应体现 ageMs');
  assert.equal(sensor.series.length, baseline + 1);
  bench.setFault('s3', 'delay', false);
  assert.equal(sensor.delayBuffer.length, 0, '关闭延迟后缓冲区必须清空');
});

test('乱序：新采样时间戳回退，事件带 outOfOrder 标记且产生日志', (bench) => {
  const sensor = bench.sensors[0];
  bench.setFault('s1', 'out_of_order', true);
  bench.tick();
  bench.tick();
  const log = bench.logs.filter((entry) => entry.type === 'out_of_order').at(-1);
  assert.ok(log, '应存在 out_of_order 日志');
  assert.ok(log.detail.skewMs >= bench.intervalMs, '时间戳必须回退至少一个采样间隔');
  assert.ok(sensor.series.some((point) => point.outOfOrder));
});

test('日志顺序：seq 严格递增，同一 tick 内故障事件先于 tick 汇总', (bench) => {
  bench.setFault('s1', 'spike', true);
  bench.setFault('s2', 'missing', true);
  bench.tick();
  const seqList = bench.logs.map((log) => log.seq);
  assert.deepEqual(seqList, [...seqList].sort((a, b) => a - b), 'seq 必须递增');
  assert.equal(new Set(seqList).size, seqList.length, 'seq 不允许重复');
  const stepLogs = bench.logs.filter((log) => log.step === bench.stepIndex);
  assert.equal(stepLogs.at(-1).type, 'tick', '每个 tick 的最后一条日志必须是 tick 汇总');
  const orderedTypes = stepLogs.map((log) => log.type);
  assert.ok(orderedTypes.indexOf('spike') < orderedTypes.indexOf('tick'));
  assert.ok(orderedTypes.indexOf('missing') < orderedTypes.indexOf('tick'));
});

test('暂停：pause 后 tick 不推进；单步仍可精确注入一次', (bench) => {
  bench.setPaused(true);
  const step = bench.stepIndex;
  const events = bench.tick();
  assert.deepEqual(events, []);
  assert.equal(bench.stepIndex, step, '暂停时普通 tick 不应推进');
  bench.setFault('s1', 'spike', true);
  const stepped = bench.tick();
  assert.equal(stepped.length, 0, '暂停态单步需通过 force，普通 tick 仍被拦截（由 UI 层保证）');
  const forced = bench.tick(true);
  assert.ok(forced.length > 0, 'force 单步在暂停态必须精确推进一拍');
  assert.equal(bench.stepIndex, step + 1);
  bench.setPaused(false);
});

test('一键恢复：清除全部故障、刷新干净数据、告警归位', (bench) => {
  for (const fault of FAULTS) bench.setFault('s1', fault, true);
  bench.setFault('s2', 'spike', true);
  for (let i = 0; i < 3; i += 1) bench.tick();
  const cleared = bench.recoverAll();
  assert.ok(cleared.length >= 4, `应清理全部激活故障，实际 ${cleared.length}`);
  assert.ok(bench.sensors.every((sensor) => sensor.faults.size === 0), '所有传感器故障集合必须为空');
  const recoverLog = bench.logs.find((log) => log.type === 'recover');
  assert.ok(recoverLog, '必须记录 recover 日志');
  for (const sensor of bench.sensors) {
    assert.equal(sensor.missingStreak, 0);
    assert.equal(sensor.spikeActive, false);
    assert.equal(sensor.delayActive, false);
    assert.equal(sensor.outOfOrderActive, false);
    assert.equal(sensor.delayBuffer.length, 0);
    assert.ok(Number.isFinite(sensor.latest.value), '恢复后每个传感器都有有效读数');
  }
  bench.tick();
  assert.ok(bench.sensors.every((sensor) => sensor.alarm === 'ok' || sensor.alarm === 'warning'), '干净数据下不应残留 missing 告警');
  assert.ok(!bench.logs.some((log) => ['missing', 'spike', 'out_of_order'].includes(log.type) && log.step > recoverLog.step));
});

test('恢复后连续采样：全部为正常数据，无尖峰/乱序/缺失标记', (bench) => {
  bench.setFault('s1', 'spike', true);
  bench.setFault('s2', 'out_of_order', true);
  bench.setFault('s3', 'missing', true);
  bench.tick();
  bench.recoverAll();
  for (let i = 0; i < 5; i += 1) bench.tick();
  for (const sensor of bench.sensors) {
    const recent = sensor.series.slice(-5);
    assert.equal(recent.length, 5);
    assert.ok(recent.every((point) => !point.isSpike && !point.outOfOrder && Number.isFinite(point.value)));
  }
});

test('CSV 导出：表头完整、行数与日志一致、含 recover 记录', (bench) => {
  bench.setFault('s1', 'missing', true);
  bench.tick();
  bench.recoverAll();
  const csv = bench.exportLogs().trim().split('\n');
  assert.equal(csv[0], 'seq,wallMs,simMs,step,type,sensorId,fault,detail');
  assert.equal(csv.length, bench.logs.length + 1, 'CSV 数据行应与日志条数一致');
  assert.ok(csv.some((line) => line.includes(',recover,')));
  assert.ok(csv.every((line) => line.split(',').length >= 7));
});

test('健壮性：NaN/极端噪声不破坏引擎状态，每拍传感器数量恒定', (bench) => {
  for (let i = 0; i < 20; i += 1) {
    bench.tick();
    assert.equal(bench.sensors.length, 3);
    for (const sensor of bench.sensors) {
      assert.ok(Number.isFinite(sensor.latest.value));
      assert.ok(sensor.series.length <= 240, '历史窗口必须受控');
    }
  }
});

console.log(`\n全部 ${passed} 项引擎测试通过 ✔  (故障类型: ${FAULTS.map((f) => FAULT_LABEL[f]).join(' / ')})`);
