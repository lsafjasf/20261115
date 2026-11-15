// 三传感器温度校准核心：纯函数，无 DOM 依赖，浏览器与 Node 共用。
// 数据全部由本模块按固定种子生成，保证可复现。

export const N_SAMPLES = 240; // 2 小时，每 30 秒一个采样
export const DT_MIN = 0.5;
export const CALIB_SIGMA = 0.04; // 校准点参考值的仪表噪声（远小于传感器噪声）

export const TOLERANCES = {
  mean: 0.5, // 均值容差 |°C|
  peak: 1.5 // 峰值容差 |°C|
};

// 固定轨道上的三个传感器位置（轨道坐标，米）
export const SENSOR_DEFS = [
  { id: 'S1', name: '传感器 1', position: 8, gainErr: 1.08, offset: 2.6, driftPerH: 0.45, noiseSigma: 0.18, color: '#e05260' },
  { id: 'S2', name: '传感器 2', position: 30, gainErr: 0.94, offset: -1.8, driftPerH: -0.7, noiseSigma: 0.15, color: '#3f8cff' },
  { id: 'S3', name: '传感器 3', position: 52, gainErr: 1.02, offset: 0.9, driftPerH: 0.25, noiseSigma: 0.12, color: '#28a96c' }
];

// 确定性伪随机（mulberry32），避免每次刷新数据不同
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 高斯噪声：Box-Muller
function gaussian(rand) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 同一温度源（地面真值）：基线 + 日周期 + 升温斜坡 + 高温段非线性凸起
export function trueSource(tMin) {
  const hours = tMin / 60;
  const base = 22;
  const diurnal = 5 * Math.sin((2 * Math.PI * tMin) / 90);
  const ramp = 0.06 * tMin;
  const bump = 4 * Math.exp(-((tMin - 85) ** 2) / (2 * 12 ** 2));
  return base + diurnal + ramp + bump;
}

// 生成三路原始读数与真值
export function generateDataset(seed = 20261115) {
  const rand = mulberry32(seed);
  const time = [];
  const truth = [];
  for (let i = 0; i < N_SAMPLES; i += 1) {
    const t = i * DT_MIN;
    time.push(t);
    truth.push(trueSource(t));
  }

  const sensors = SENSOR_DEFS.map((def) => {
    const raw = truth.map((value, i) => {
      const hours = time[i] / 60;
      const drift = def.driftPerH * hours;
      const noise = gaussian(rand) * def.noiseSigma;
      return def.gainErr * value + def.offset + drift + noise;
    });
    return { ...def, raw };
  });

  return { time, truth, sensors };
}

// 等间距选取 n 个样本下标作为校准点
export function evenlySpacedIndices(count, total = N_SAMPLES) {
  if (count <= 1) return [Math.floor(total / 2)];
  const indices = [];
  for (let k = 0; k < count; k += 1) {
    indices.push(Math.round((k * (total - 1)) / (count - 1)));
  }
  return [...new Set(indices)];
}

// 在选定的校准点上生成“仪表参考读数”：真值 + 小幅仪表噪声
export function buildCalibrationPoints(dataset, indices, seed = 77) {
  const rand = mulberry32(seed);
  return indices.map((index) => ({
    index,
    tMin: dataset.time[index],
    reference: dataset.truth[index] + gaussian(rand) * CALIB_SIGMA
  }));
}

// 一元最小二乘：reference = gain * reading + bias
// 返回 { gain, bias, rmse, n }
export function fitLeastSquares(readings, references) {
  const n = readings.length;
  if (n < 2) {
    throw new Error('至少需要 2 个校准点才能拟合增益与偏置');
  }
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    const x = readings[i];
    const y = references[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  const gain = (n * sumXY - sumX * sumY) / denom;
  const bias = (sumY - gain * sumX) / n;
  let sq = 0;
  for (let i = 0; i < n; i += 1) {
    const residual = references[i] - (gain * readings[i] + bias);
    sq += residual * residual;
  }
  return { gain, bias, rmse: Math.sqrt(sq / n), n };
}

// 按当前 gain/bias 校准整条曲线
export function applyCalibration(raw, gain, bias) {
  return raw.map((value) => gain * value + bias);
}

function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

// 评估单只传感器校准结果：均值误差、峰值误差、极端值失真
export function evaluateSensor(calibrated, truth) {
  const errors = calibrated.map((value, i) => value - truth[i]);
  const meanError = mean(errors);
  const peakError = Math.max(...errors.map((e) => Math.abs(e)));
  const rmse = Math.sqrt(mean(errors.map((e) => e * e)));

  // 极端值失真：取真值最高/最低各 5% 区间，看校准后是否反而偏离
  const order = truth.map((v, i) => i).sort((a, b) => truth[a] - truth[b]);
  const tailCount = Math.max(1, Math.floor(truth.length * 0.05));
  const tailIdx = [...order.slice(0, tailCount), ...order.slice(-tailCount)];
  const tailRmse = Math.sqrt(
    mean(tailIdx.map((i) => errors[i] * errors[i]))
  );

  return {
    meanError,
    peakError,
    rmse,
    tailRmse,
    passMean: Math.abs(meanError) <= TOLERANCES.mean,
    passPeak: peakError <= TOLERANCES.peak
  };
}

// 过度校准判定：增益偏离 1 过多（>35%）或极端区 RMSE 明显高于整体 RMSE
export function isOverCalibrated(gain, metrics) {
  const gainAbuse = gain <= 0.65 || gain >= 1.35;
  const tailDistortion = metrics.tailRmse > metrics.rmse * 1.6 && metrics.tailRmse > TOLERANCES.peak * 0.8;
  return gainAbuse || tailDistortion;
}

// 对单只传感器执行一次完整自动校准，返回参数与评估
export function calibrateSensor(raw, points) {
  const readings = points.map((p) => raw[p.index]);
  const references = points.map((p) => p.reference);
  const fit = fitLeastSquares(readings, references);
  return fit;
}

export function allPass(reportList) {
  return reportList.every((r) => r.metrics.passMean && r.metrics.passPeak && !r.overCalibrated);
}
