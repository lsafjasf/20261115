// 实际执行一次三传感器校准（Node 环境，无浏览器依赖）。
// 用法：
//   node scripts/run-calibration.mjs           运行并保存校准参数
//   node scripts/run-calibration.mjs --assert  额外断言容差必须全部通过
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOLERANCES,
  generateDataset,
  evenlySpacedIndices,
  buildCalibrationPoints,
  applyCalibration,
  evaluateSensor,
  isOverCalibrated,
  calibrateSensor,
  allPass
} from '../src/calibration.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assertMode = process.argv.includes('--assert');

const fmt = (x) => (Math.abs(x) < 1e-9 ? '0.000' : x.toFixed(3));

const dataset = generateDataset();

// 用户选择校准点：等间距 8 个点，覆盖整条轨道采集时段
const pointCount = 8;
const indices = evenlySpacedIndices(pointCount);
const points = buildCalibrationPoints(dataset, indices);

console.log('=== 三传感器温度校准（数据由代码生成，固定种子可复现）===');
console.log(`样本数: ${dataset.time.length}，时长: ${dataset.time.at(-1)} 分钟`);
console.log(`校准点: ${pointCount} 个，下标 ${indices.join(', ')}`);
console.log(`容差: 均值 <= ${TOLERANCES.mean}°C，峰值 <= ${TOLERANCES.peak}°C\n`);

const reports = dataset.sensors.map((sensor) => {
  const fit = calibrateSensor(sensor.raw, points);
  const calibrated = applyCalibration(sensor.raw, fit.gain, fit.bias);
  const before = evaluateSensor(sensor.raw, dataset.truth);
  const metrics = evaluateSensor(calibrated, dataset.truth);
  const overCalibrated = isOverCalibrated(fit.gain, metrics);
  return {
    id: sensor.id,
    name: sensor.name,
    position: sensor.position,
    fit,
    before,
    metrics,
    overCalibrated
  };
});

for (const r of reports) {
  console.log(`--- ${r.name}（轨道位置 ${r.position} m）---`);
  console.log(
    `校准参数: gain=${fmt(r.fit.gain)}  bias=${fmt(r.fit.bias)}  拟合点RMSE=${fmt(r.fit.rmse)}°C`
  );
  console.log(
    `校准前: 均值误差=${fmt(r.before.meanError)}°C  峰值误差=${fmt(r.before.peakError)}°C  RMSE=${fmt(r.before.rmse)}°C`
  );
  console.log(
    `校准后: 均值误差=${fmt(r.metrics.meanError)}°C  峰值误差=${fmt(r.metrics.peakError)}°C  RMSE=${fmt(r.metrics.rmse)}°C  极端区RMSE=${fmt(r.metrics.tailRmse)}°C`
  );
  const status =
    r.metrics.passMean && r.metrics.passPeak
      ? r.overCalibrated
        ? '过度校准（极端值失真）'
        : '通过'
      : '未通过';
  console.log(
    `判定: ${status}（均值${r.metrics.passMean ? '✓' : '✗'} 峰值${r.metrics.passPeak ? '✓' : '✗'} 过度校准${r.overCalibrated ? '⚠' : '无'})\n`
  );
}

const passed = allPass(reports);
console.log(passed ? '总体结果: 三线收敛，全部通过均值与峰值容差。' : '总体结果: 存在未通过项。');

const payload = {
  generatedAt: new Date().toISOString(),
  seed: 20261115,
  sampleCount: dataset.time.length,
  durationMin: dataset.time.at(-1),
  calibrationPointIndices: indices,
  calibrationPoints: points.map((p) => ({ tMin: p.tMin, reference: p.reference })),
  tolerances: TOLERANCES,
  passed,
  sensors: reports.map((r) => ({
    id: r.id,
    position: r.position,
    gain: r.fit.gain,
    bias: r.fit.bias,
    fitRmse: r.fit.rmse,
    meanError: r.metrics.meanError,
    peakError: r.metrics.peakError,
    rmse: r.metrics.rmse,
    tailRmse: r.metrics.tailRmse,
    overCalibrated: r.overCalibrated
  }))
};

const outPath = resolve(root, 'artifacts/calibration-params.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`\n校准参数已保存: ${outPath}`);

if (assertMode && !passed) {
  process.exitCode = 1;
}
