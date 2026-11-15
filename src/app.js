// 前端控制器：状态管理、交互、重放与参数持久化。
import {
  TOLERANCES,
  N_SAMPLES,
  generateDataset,
  evenlySpacedIndices,
  buildCalibrationPoints,
  applyCalibration,
  evaluateSensor,
  isOverCalibrated,
  calibrateSensor
} from './calibration.js';
import { drawTrack, drawChart, canvasToIndex } from './chart.js';

const STORAGE_KEY = 'triple-sensor-calibration-v1';

const dataset = generateDataset();

// 初始：未校准（gain=1, bias=0），让用户先看到发散的三条原始曲线
const params = Object.fromEntries(
  dataset.sensors.map((s) => [s.id, { gain: 1, bias: 0 }])
);

let pointIndices = evenlySpacedIndices(8);
let points = buildCalibrationPoints(dataset, pointIndices);
let replayIndex = -1; // -1 表示展示完整曲线
let replayTimer = null;
let chartGeometry = null;

const els = {
  track: document.getElementById('track-canvas'),
  chart: document.getElementById('chart-canvas'),
  legend: document.getElementById('track-legend'),
  controls: document.getElementById('sensor-controls'),
  status: document.getElementById('status-board'),
  pointList: document.getElementById('point-list'),
  pointCount: document.getElementById('point-count'),
  pointCountVal: document.getElementById('point-count-val'),
  saveMsg: document.getElementById('save-msg')
};

function currentSeries() {
  return dataset.sensors.map((sensor) => {
    const { gain, bias } = params[sensor.id];
    return {
      id: sensor.id,
      color: sensor.color,
      raw: sensor.raw,
      calibrated: applyCalibration(sensor.raw, gain, bias)
    };
  });
}

function currentReports() {
  return dataset.sensors.map((sensor) => {
    const { gain, bias } = params[sensor.id];
    const calibrated = applyCalibration(sensor.raw, gain, bias);
    const metrics = evaluateSensor(calibrated, dataset.truth);
    return {
      sensor,
      gain,
      bias,
      metrics,
      overCalibrated: isOverCalibrated(gain, metrics)
    };
  });
}

function buildSensorCards() {
  els.controls.innerHTML = '';
  dataset.sensors.forEach((sensor) => {
    const card = document.createElement('div');
    card.className = 'sensor-card';
    card.dataset.id = sensor.id;
    card.innerHTML = `
      <h3><span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${sensor.color}"></span>${sensor.name}（${sensor.id} · ${sensor.position}m）</h3>
      <label>增益 gain
        <input type="range" min="0.5" max="1.5" step="0.001" data-field="gain" />
        <input type="number" step="0.001" data-field="gain-num" />
      </label>
      <label>偏置 bias
        <input type="range" min="-6" max="6" step="0.01" data-field="bias" />
        <input type="number" step="0.01" data-field="bias-num" />
      </label>
      <div class="metric"><span>均值误差</span><b data-metric="mean"></b></div>
      <div class="metric"><span>峰值误差</span><b data-metric="peak"></b></div>
      <div class="metric"><span>RMSE / 极端区</span><b data-metric="rmse"></b></div>
      <div class="metric"><span>判定</span><b data-metric="verdict"></b></div>
    `;
    els.controls.appendChild(card);

    const rangeGain = card.querySelector('[data-field="gain"]');
    const numGain = card.querySelector('[data-field="gain-num"]');
    const rangeBias = card.querySelector('[data-field="bias"]');
    const numBias = card.querySelector('[data-field="bias-num"]');

    const wire = (rangeEl, numEl, field) => {
      const apply = (value) => {
        params[sensor.id][field] = Number(value);
        rangeEl.value = params[sensor.id][field];
        numEl.value = params[sensor.id][field].toFixed(field === 'gain' ? 3 : 2);
        renderAll();
      };
      rangeEl.addEventListener('input', () => apply(rangeEl.value));
      numEl.addEventListener('change', () => apply(numEl.value));
    };
    wire(rangeGain, numGain, 'gain');
    wire(rangeBias, numBias, 'bias');
  });
}

function buildLegend() {
  els.legend.innerHTML = dataset.sensors
    .map((s) => `<span><span class="dot" style="background:${s.color}"></span>${s.id} @ ${s.position}m</span>`)
    .join('') + '<span><span class="dot" style="background:#f2f5f9"></span>温度源真值</span>';
}

function renderTrack() {
  drawTrack(
    els.track,
    dataset.sensors,
    dataset.sensors.map((s) => s.position)
  );
}

function renderChart() {
  chartGeometry = drawChart(els.chart, {
    time: dataset.time,
    truth: dataset.truth,
    series: currentSeries(),
    points,
    replayIndex,
    xRange: [0, N_SAMPLES - 1]
  });
}

function renderCards(reports) {
  reports.forEach((report) => {
    const card = els.controls.querySelector(`[data-id="${report.sensor.id}"]`);
    card.querySelector('[data-field="gain"]').value = report.gain;
    card.querySelector('[data-field="gain-num"]').value = report.gain.toFixed(3);
    card.querySelector('[data-field="bias"]').value = report.bias;
    card.querySelector('[data-field="bias-num"]').value = report.bias.toFixed(2);
    card.querySelector('[data-metric="mean"]').textContent =
      `${report.metrics.meanError.toFixed(3)}°C ${report.metrics.passMean ? '✓' : '✗'}`;
    card.querySelector('[data-metric="peak"]').textContent =
      `${report.metrics.peakError.toFixed(3)}°C ${report.metrics.passPeak ? '✓' : '✗'}`;
    card.querySelector('[data-metric="rmse"]').textContent =
      `${report.metrics.rmse.toFixed(3)} / ${report.metrics.tailRmse.toFixed(3)}°C`;
    const verdictEl = card.querySelector('[data-metric="verdict"]');
    if (report.overCalibrated) {
      verdictEl.textContent = '⚠ 过度校准';
      verdictEl.style.color = 'var(--warn)';
    } else if (report.metrics.passMean && report.metrics.passPeak) {
      verdictEl.textContent = '通过';
      verdictEl.style.color = 'var(--ok)';
    } else {
      verdictEl.textContent = '未通过';
      verdictEl.style.color = 'var(--bad)';
    }
  });
}

function renderStatus(reports) {
  const allOk = reports.every((r) => r.metrics.passMean && r.metrics.passPeak && !r.overCalibrated);
  els.status.innerHTML = reports.map((r) => {
    const ok = r.metrics.passMean && r.metrics.passPeak && !r.overCalibrated;
    const meanBadge = r.metrics.passMean
      ? '<span class="badge ok">均值达标</span>'
      : '<span class="badge bad">均值超标</span>';
    const peakBadge = r.metrics.passPeak
      ? '<span class="badge ok">峰值达标</span>'
      : '<span class="badge bad">峰值超标</span>';
    const overBadge = r.overCalibrated
      ? '<span class="badge warn">极端值失真</span>'
      : '';
    return `
      <div class="status-card">
        <div class="title">${r.sensor.id}<span class="badge ${ok ? 'ok' : 'bad'}">${ok ? '收敛' : '未收敛'}</span></div>
        <div class="metric"><span>增益 / 偏置</span><b>${r.gain.toFixed(3)} / ${r.bias.toFixed(2)}</b></div>
        <div class="metric"><span>均值误差（容差 ${TOLERANCES.mean}°C）</span><b>${r.metrics.meanError.toFixed(3)}°C</b></div>
        <div class="metric"><span>峰值误差（容差 ${TOLERANCES.peak}°C）</span><b>${r.metrics.peakError.toFixed(3)}°C</b></div>
        <div class="metric"><span>极端区 RMSE</span><b>${r.metrics.tailRmse.toFixed(3)}°C</b></div>
        <div style="margin-top:8px">${meanBadge}${peakBadge}${overBadge}</div>
      </div>`;
  }).join('') + `
    <div class="status-card">
      <div class="title">总体判定<span class="badge ${allOk ? 'ok' : 'bad'}">${allOk ? '全部通过' : '待调整'}</span></div>
      <p class="hint" style="margin-top:8px">
        均值容差 ${TOLERANCES.mean}°C 与峰值容差 ${TOLERANCES.peak}°C 必须同时满足；
        增益偏离 1 超过 35% 或极端区 RMSE 异常升高时判为过度校准。
      </p>
    </div>`;
}

function renderPointList() {
  els.pointList.innerHTML = points
    .map((p) => `<span class="chip">t=<b>${p.tMin.toFixed(1)}</b>min · 参考 <b>${p.reference.toFixed(2)}</b>°C</span>`)
    .join('');
}

function renderAll() {
  const reports = currentReports();
  renderTrack();
  renderChart();
  renderCards(reports);
  renderStatus(reports);
  renderPointList();
}

function refreshPoints() {
  pointIndices.sort((a, b) => a - b);
  points = buildCalibrationPoints(dataset, pointIndices);
  renderAll();
}

function runAutoCalibration() {
  if (points.length < 2) {
    els.saveMsg.textContent = '至少需要 2 个校准点';
    els.saveMsg.style.color = 'var(--bad)';
    return;
  }
  dataset.sensors.forEach((sensor) => {
    const fit = calibrateSensor(sensor.raw, points);
    params[sensor.id] = { gain: fit.gain, bias: fit.bias };
  });
  stopReplay();
  replayIndex = -1;
  renderAll();
  els.saveMsg.textContent = '已按最小二乘完成自动校准，请查看容差判定。';
  els.saveMsg.style.color = 'var(--ok)';
}

function togglePointAt(clientX) {
  const index = canvasToIndex(
    els.chart,
    chartGeometry,
    dataset.time,
    [0, N_SAMPLES - 1],
    clientX
  );
  const existing = pointIndices.indexOf(index);
  if (existing >= 0) {
    pointIndices.splice(existing, 1);
  } else {
    pointIndices.push(index);
  }
  refreshPoints();
}

function stopReplay() {
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
  }
}

function startReplay() {
  stopReplay();
  if (replayIndex < 0 || replayIndex >= N_SAMPLES - 1) replayIndex = 0;
  const speed = Number(document.getElementById('replay-speed').value);
  const intervalMs = Math.max(20, 120 / speed);
  replayTimer = setInterval(() => {
    replayIndex += 1;
    if (replayIndex >= N_SAMPLES - 1) {
      replayIndex = N_SAMPLES - 1;
      stopReplay();
    }
    renderChart();
  }, intervalMs);
}

function buildPayload() {
  const reports = currentReports();
  return {
    savedAt: new Date().toISOString(),
    seed: 20261115,
    sampleCount: N_SAMPLES,
    calibrationPointIndices: [...pointIndices].sort((a, b) => a - b),
    tolerances: TOLERANCES,
    passed: reports.every((r) => r.metrics.passMean && r.metrics.passPeak && !r.overCalibrated),
    sensors: reports.map((r) => ({
      id: r.sensor.id,
      position: r.sensor.position,
      gain: r.gain,
      bias: r.bias,
      meanError: r.metrics.meanError,
      peakError: r.metrics.peakError,
      rmse: r.metrics.rmse,
      tailRmse: r.metrics.tailRmse,
      overCalibrated: r.overCalibrated
    }))
  };
}

function saveParams() {
  const payload = buildPayload();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  els.saveMsg.textContent = payload.passed
    ? `已保存（${new Date().toLocaleTimeString()}），三线均满足容差。`
    : '已保存，但当前参数尚未全部通过容差。';
  els.saveMsg.style.color = payload.passed ? 'var(--ok)' : 'var(--warn)';
}

function exportParams() {
  const blob = new Blob([`${JSON.stringify(buildPayload(), null, 2)}\n`], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'calibration-params.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

function loadSavedParams() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.sensors)) return false;
    saved.sensors.forEach((entry) => {
      if (params[entry.id]) params[entry.id] = { gain: entry.gain, bias: entry.bias };
    });
    if (Array.isArray(saved.calibrationPointIndices)) {
      pointIndices = saved.calibrationPointIndices.filter((i) => i >= 0 && i < N_SAMPLES);
      points = buildCalibrationPoints(dataset, pointIndices);
      els.pointCount.value = pointIndices.length;
      els.pointCountVal.textContent = pointIndices.length;
    }
    return true;
  } catch {
    return false;
  }
}

function wireEvents() {
  document.getElementById('btn-auto').addEventListener('click', runAutoCalibration);
  document.getElementById('btn-even-points').addEventListener('click', () => {
    pointIndices = evenlySpacedIndices(Number(els.pointCount.value));
    refreshPoints();
  });
  els.pointCount.addEventListener('input', () => {
    els.pointCountVal.textContent = els.pointCount.value;
  });
  els.chart.addEventListener('click', (event) => togglePointAt(event.clientX));
  document.getElementById('btn-replay').addEventListener('click', startReplay);
  document.getElementById('btn-replay-reset').addEventListener('click', () => {
    stopReplay();
    replayIndex = -1;
    renderChart();
  });
  document.getElementById('btn-save').addEventListener('click', saveParams);
  document.getElementById('btn-export').addEventListener('click', exportParams);
  window.addEventListener('resize', renderAll);
}

buildSensorCards();
buildLegend();
loadSavedParams();
wireEvents();
renderAll();
