import { SensorTestbed, SENSOR_META, FAULTS, FAULT_LABEL } from './engine.js';
import { drawGauge, drawChart } from './canvas.js';

const testbed = new SensorTestbed(() => Date.now());
let timer = null;
let intervalMs = 500;

const $ = (id) => document.getElementById(id);

function showError(message) {
  const banner = $('errorBanner');
  banner.style.display = 'block';
  banner.textContent = `捕获到异常（页面保持运行）：${message}`;
}

// Global guards: no fault, bad data, or rendering error may crash the page.
window.addEventListener('error', (event) => {
  showError(event.message || '未知错误');
  event.preventDefault?.();
});
window.addEventListener('unhandledrejection', (event) => {
  showError(event.reason?.message || String(event.reason));
  event.preventDefault?.();
});

function buildSensorCards() {
  const grid = $('sensorGrid');
  grid.innerHTML = '';
  for (const meta of SENSOR_META) {
    const card = document.createElement('section');
    card.className = 'card';
    card.dataset.sensor = meta.id;
    const chips = FAULTS.map((fault) =>
      `<button class="fault-chip" data-fault="${fault}" title="切换${FAULT_LABEL[fault]}">${FAULT_LABEL[fault]}</button>`
    ).join('');
    card.innerHTML = `
      <h2><span>${meta.name} (${meta.id})</span><span class="muted">量程 ${meta.range[0]}–${meta.range[1]} ${meta.unit}</span></h2>
      <div class="fault-row">${chips}</div>
      <canvas class="gauge"></canvas>
      <canvas class="chart"></canvas>
    `;
    grid.appendChild(card);
    for (const chip of card.querySelectorAll('.fault-chip')) {
      chip.addEventListener('click', () => toggleFault(meta.id, chip.dataset.fault, chip));
    }
  }
}

function toggleFault(sensorId, fault, chip) {
  try {
    const sensor = testbed.sensors.find((item) => item.meta.id === sensorId);
    const enabling = !sensor.faults.has(fault);
    testbed.setFault(sensorId, fault, enabling);
    chip.classList.toggle('active', enabling);
    renderAll();
  } catch (error) {
    showError(error.message);
  }
}

function startTimer() {
  stopTimer();
  timer = window.setInterval(() => {
    try {
      testbed.tick();
      renderAll();
    } catch (error) {
      showError(error.message);
    }
  }, intervalMs);
}

function stopTimer() {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function setPaused(paused) {
  testbed.setPaused(paused);
  $('btnPause').textContent = paused ? '继续' : '暂停';
  $('runState').textContent = paused ? '已暂停' : '运行中';
  if (paused) stopTimer();
  else startTimer();
  renderAll();
}

function bindControls() {
  $('btnPause').addEventListener('click', () => {
    try { setPaused(!testbed.paused); } catch (error) { showError(error.message); }
  });
  $('btnStep').addEventListener('click', () => {
    try {
      if (!testbed.paused) setPaused(true);
      testbed.tick(true);
      renderAll();
    } catch (error) { showError(error.message); }
  });
  $('btnRecover').addEventListener('click', () => {
    try {
      testbed.recoverAll();
      document.querySelectorAll('.fault-chip.active').forEach((chip) => chip.classList.remove('active'));
      renderAll();
    } catch (error) { showError(error.message); }
  });
  $('btnExport').addEventListener('click', () => {
    try {
      const csv = testbed.exportLogs();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `fault-injection-log-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) { showError(error.message); }
  });
  $('speedSel').addEventListener('change', (event) => {
    intervalMs = Number(event.target.value) || 500;
    if (!testbed.paused) startTimer();
  });
}

function renderAll() {
  try {
    for (const sensor of testbed.sensors) {
      const card = document.querySelector(`[data-sensor="${sensor.meta.id}"]`);
      if (!card) continue;
      const gauge = card.querySelector('canvas.gauge');
      const chart = card.querySelector('canvas.chart');
      drawGauge(gauge, sensor);
      drawChart(chart, sensor);
    }
    renderStatus();
    renderLogs();
    renderAlarms();
  } catch (error) {
    showError(error.message);
  }
}

function renderStatus() {
  $('stepCount').textContent = String(testbed.stepIndex);
  $('simTime').textContent = String(testbed.clock);
  $('logCount').textContent = String(testbed.logs.length);
}

function renderLogs() {
  const body = $('logBody');
  const rows = testbed.logs.slice(-150).reverse().map((entry) => {
    const detail = entry.type === 'tick'
      ? `事件 ${entry.detail.eventCount}`
      : entry.detail.fault
        ? FAULT_LABEL[entry.detail.fault] || entry.detail.fault
        : entry.detail.message || JSON.stringify(entry.detail);
    return `<tr>
      <td>${entry.seq}</td>
      <td>${entry.step}</td>
      <td><span class="tag ${entry.type}">${entry.type}</span></td>
      <td>${entry.sensorId}</td>
      <td>${escapeHtml(detail)}</td>
    </tr>`;
  });
  body.innerHTML = rows.join('');
}

function renderAlarms() {
  const alarms = testbed.sensors.flatMap((sensor) =>
    sensor.alarms.map((alarm) => ({ ...alarm, sensorId: sensor.meta.id, name: sensor.meta.name }))
  ).slice(0, 50);
  $('alarmCount').textContent = `${alarms.length} 条`;
  $('alarmBody').innerHTML = alarms.map((alarm) => `
    <tr>
      <td>${alarm.name}</td>
      <td><span class="tag ${alarm.level}">${alarm.level}</span></td>
      <td>${escapeHtml(alarm.message)}</td>
      <td>${alarm.ts}</td>
    </tr>`).join('');
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

function boot() {
  try {
    buildSensorCards();
    bindControls();
    for (let i = 0; i < 6; i += 1) testbed.tick();
    renderAll();
    startTimer();
  } catch (error) {
    showError(error.message);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
