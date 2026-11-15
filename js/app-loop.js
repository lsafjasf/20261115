import { advanceSource, currentMetrics, simulateSweep } from './scene-state.js';

const $ = (id) => document.getElementById(id);

export { runSelfTest, startLoop };

function drawMeter(canvas, value) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#111c2e';
  ctx.fillRect(0, 0, w, h);
  const db = value < 1e-5 ? -60 : 20 * Math.log10(value);
  const ratio = Math.max(0, (db + 60) / 60);
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#46d39a');
  grad.addColorStop(0.7, '#f0b45a');
  grad.addColorStop(1, '#ff5d5d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w * ratio, h);
  return db <= -59.5 ? '−∞' : `${db.toFixed(1)} dB`;
}

function updateHud(metrics, sourcePos) {
  $('hudPos').textContent =
    `(${sourcePos.map((n) => n.toFixed(2)).join(', ')})`;
  $('hudDist').textContent = `${metrics.distance.toFixed(2)} m`;
  const gainDb = metrics.gain < 1e-5 ? -60 : 20 * Math.log10(metrics.gain);
  $('hudGain').textContent = `${metrics.gain.toFixed(3)} (${gainDb.toFixed(1)} dB)`;
  const panText = metrics.pan > 0.05 ? `R ${metrics.pan.toFixed(2)}`
    : metrics.pan < -0.05 ? `L ${Math.abs(metrics.pan).toFixed(2)}` : '中 0.00';
  $('hudPan').textContent = panText;
  $('hudRt').textContent = `${metrics.rt60.toFixed(2)} s`;
  $('hudInside').textContent = metrics.inside ? '室内' : '边界外';
  $('hudInside').style.color = metrics.inside ? '#46d39a' : '#ffb020';
}

function drawTestChart(rows) {
  const canvas = $('testChart');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, pad = 22;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#111c2e';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#2b3d57';
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - 6, h - pad);
  ctx.moveTo(pad, 6);
  ctx.lineTo(pad, h - pad);
  ctx.stroke();
  const xOf = (i) => pad + (i / (rows.length - 1)) * (w - pad - 10);
  const yOf = (v) => h - pad - v * (h - pad - 10);
  const series = [
    { key: 'left', color: '#5ea4e9', label: 'L' },
    { key: 'right', color: '#ff8f70', label: 'R' },
    { key: 'gain', color: '#f0b45a', label: '距离增益' },
  ];
  for (const s of series) {
    ctx.beginPath();
    rows.forEach((r, i) => (i ? ctx.lineTo(xOf(i), yOf(r[s.key])) : ctx.moveTo(xOf(i), yOf(r[s.key]))));
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.fillStyle = '#93a4bc';
  ctx.font = '10px sans-serif';
  ctx.fillText('左边界外 → 右边界外', pad, h - 6);
  series.forEach((s, i) => {
    ctx.fillStyle = s.color;
    ctx.fillText(s.label, w - 70 + i * 24, 12);
  });
}

function runSelfTest(state) {
  const result = simulateSweep(state);
  const ul = $('testResult');
  ul.innerHTML = '';
  for (const check of result.checks) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="${check.pass ? 'pass' : 'fail'}">${check.pass ? '✔' : '✘'}</span><span>${check.name}</span>`;
    ul.append(li);
  }
  drawTestChart(result.rows);
  const allPass = result.checks.every((c) => c.pass);
  const li = document.createElement('li');
  li.innerHTML = `<span class="${allPass ? 'pass' : 'fail'}">${allPass ? '✔ 全部通过' : '✗ 存在失败项'}</span>`;
  ul.append(li);
}

function startLoop(state, renderer, engine) {
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const crossed = advanceSource(state, dt);
    const audioInfo = engine.update(state.sourcePos, state.listener);
    const metrics = currentMetrics(state);
    renderer.render({
      room: state.room,
      pathPoints: state.pathPoints,
      sourcePos: state.sourcePos,
      listener: state.listener,
      inside: metrics.inside,
    });
    updateHud(metrics, state.sourcePos);
    const levels = engine.getLevels();
    $('meterLVal').textContent = drawMeter($('meterL'), levels.left);
    $('meterRVal').textContent = drawMeter($('meterR'), levels.right);
    if (crossed && state.playing) {
      $('hudInside').animate(
        [{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }],
        { duration: 300 },
      );
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
