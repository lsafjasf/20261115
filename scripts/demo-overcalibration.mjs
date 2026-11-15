// 对照演示：合理最小二乘校准 vs 人为过度校准（极端值失真）。
import {
  generateDataset,
  evenlySpacedIndices,
  buildCalibrationPoints,
  applyCalibration,
  evaluateSensor,
  isOverCalibrated,
  calibrateSensor
} from '../src/calibration.js';

const dataset = generateDataset();
const points = buildCalibrationPoints(dataset, evenlySpacedIndices(8));
const sensor = dataset.sensors[0];

const proper = calibrateSensor(sensor.raw, points);
const properMetrics = evaluateSensor(applyCalibration(sensor.raw, proper.gain, proper.bias), dataset.truth);

// 人为把增益推到 1.45（超出 0.65~1.35 的合理区间），演示极端值被放大失真
const abused = { gain: 1.45, bias: -8 };
const abusedMetrics = evaluateSensor(applyCalibration(sensor.raw, abused.gain, abused.bias), dataset.truth);

const row = (label, gain, bias, m) =>
  console.log(
    `${label}: gain=${gain.toFixed(3)} bias=${bias.toFixed(2)} | ` +
    `均值误差=${m.meanError.toFixed(3)}°C 峰值误差=${m.peakError.toFixed(3)}°C ` +
    `整体RMSE=${m.rmse.toFixed(3)}°C 极端区RMSE=${m.tailRmse.toFixed(3)}°C ` +
    `过度校准=${isOverCalibrated(gain, m) ? '是' : '否'}`
  );

console.log(`=== ${sensor.name} 过度校准对照 ===`);
row('合理校准', proper.gain, proper.bias, properMetrics);
row('过度校准', abused.gain, abused.bias, abusedMetrics);
