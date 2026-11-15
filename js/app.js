/* 山地水力侵蚀模拟 —— UI 层（渲染、交互、统计、对比） */
(function () {
  'use strict';
  const { ErosionSim } = window.ErosionSim;

  const SIZE = 128;
  const $ = (id) => document.getElementById(id);
  const mapCanvas = $('map');
  const mapCtx = mapCanvas.getContext('2d');
  const profileCanvas = $('profile');
  const profileCtx = profileCanvas.getContext('2d');

  const state = {
    sim: null,
    running: false,
    tool: 'rain',
    layers: { river: true, deposit: true, hardness: false },
    profileRow: SIZE >> 1,
    rainIntensity: 0.08,
    hardValue: 0.9,
    brushSize: 8,
    speed: 4,
    frame: 0,
  };

  function newSim(seed) {
    state.sim = new ErosionSim({ size: SIZE, seed: seed >>> 0 });
  }
  newSim(+$('seedInput').value || 20261115);

  /* ---------- 高程色带 ---------- */
  const RAMP = [
    [0.00,  44,  92,  54],
    [0.18,  76, 128,  66],
    [0.35, 122, 148,  78],
    [0.50, 160, 152,  96],
    [0.65, 150, 124,  92],
    [0.80, 128, 116, 110],
    [1.00, 236, 240, 244],
  ];
  const BANDS = 16; // 色带数（量化产生等高线感）
  function rampColor(t) {
    t = Math.min(1, Math.max(0, t));
    const q = Math.floor(t * BANDS) / BANDS + 0.5 / BANDS;
    const mix = 0.35;
    const v = q * (1 - mix) + t * mix;
    for (let k = 1; k < RAMP.length; k++) {
      if (v <= RAMP[k][0]) {
        const p0 = RAMP[k - 1][0], r0 = RAMP[k - 1][1], g0 = RAMP[k - 1][2], b0 = RAMP[k - 1][3];
        const p1 = RAMP[k][0], r1 = RAMP[k][1], g1 = RAMP[k][2], b1 = RAMP[k][3];
        const f = (v - p0) / (p1 - p0 || 1);
        return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
      }
    }
    return [236, 240, 244];
  }

  /* ---------- 地图渲染 ---------- */
  const img = mapCtx.createImageData(SIZE, SIZE);
  function renderMap(sim, ctx, image) {
    const n = SIZE;
    let maxH = 1e-6, minH = Infinity;
    for (let i = 0; i < n * n; i++) {
      if (sim.height[i] > maxH) maxH = sim.height[i];
      if (sim.height[i] < minH) minH = sim.height[i];
    }
    const thr = sim.riverThresholdValue();
    const d = image.data;
    for (let i = 0; i < n * n; i++) {
      const t = (sim.height[i] - minH) / (maxH - minH || 1);
      let r, g, b;
      if (state.layers.hardness) {
        const hd = sim.hardness[i];
        r = 40 + hd * 200; g = 60 + hd * 120; b = 200 - hd * 160;
      } else {
        const c = rampColor(t); r = c[0]; g = c[1]; b = c[2];
      }
      if (state.layers.deposit && sim.deposit[i] > 0.002) {
        const f = Math.min(0.75, sim.deposit[i] * 60);
        r += (214 - r) * f; g += (186 - g) * f; b += (130 - b) * f;
      }
      if (sim.water[i] > 0.01) {
        const f = Math.min(0.5, sim.water[i] * 2);
        r += (60 - r) * f; g += (110 - g) * f; b += (190 - b) * f;
      }
      if (state.layers.river && sim.flux[i] >= thr) {
        const f = Math.min(1, sim.flux[i] / (thr * 4));
        r = 30 + 30 * f; g = 90 + 80 * f; b = 220 + 35 * f;
      }
      const o = i * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  /* ---------- 叠加层：降雨区圈、剖面线 ---------- */
  function renderOverlays() {
    const sim = state.sim;
    mapCtx.save();
    mapCtx.strokeStyle = 'rgba(120,190,255,0.9)';
    mapCtx.setLineDash([3, 2]);
    for (const z of sim.rainZones) {
      mapCtx.beginPath();
      mapCtx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
      mapCtx.stroke();
    }
    mapCtx.setLineDash([]);
    mapCtx.strokeStyle = 'rgba(255,235,120,0.9)';
    mapCtx.beginPath();
    mapCtx.moveTo(0, state.profileRow + 0.5);
    mapCtx.lineTo(SIZE, state.profileRow + 0.5);
    mapCtx.stroke();
    mapCtx.restore();
  }

  /* ---------- 剖面图 ---------- */
  function renderProfile() {
    const sim = state.sim;
    const prof = sim.profile(state.profileRow);
    const W = profileCanvas.width, H = profileCanvas.height;
    const ctx = profileCtx;
    ctx.clearRect(0, 0, W, H);
    let maxH = 1e-6, minH = Infinity;
    for (let i = 0; i < SIZE; i++) {
      if (sim.height[i] > maxH) maxH = sim.height[i];
      if (sim.height[i] < minH) minH = sim.height[i];
    }
    const yOf = (h) => H - 8 - ((h - minH) / (maxH - minH || 1)) * (H - 20);
    // 地形填充
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x < SIZE; x++) ctx.lineTo((x + 0.5) * W / SIZE, yOf(prof.height[x]));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = '#6b5b45';
    ctx.fill();
    ctx.strokeStyle = '#d8c9a3';
    ctx.stroke();
    // 水面
    ctx.beginPath();
    let hasWater = false;
    for (let x = 0; x < SIZE; x++) {
      if (prof.water[x] > 0.005) {
        hasWater = true;
        const px = (x + 0.5) * W / SIZE;
        const py = yOf(prof.height[x] + prof.water[x]);
        ctx.moveTo(px, py);
        ctx.lineTo(px, yOf(prof.height[x]));
      }
    }
    if (hasWater) { ctx.strokeStyle = 'rgba(80,150,255,0.8)'; ctx.stroke(); }
    $('profileCaption').textContent =
      '剖面：第 ' + prof.row + ' 行（高 ' + minH.toFixed(3) + ' ~ ' + maxH.toFixed(3) + '，蓝线为水面）';
  }

  /* ---------- 统计 ---------- */
  function renderStats() {
    const st = state.sim.computeStats();
    $('stStep').textContent = st.step;
    $('stMax').textContent = st.maxHeight.toFixed(3) + ' @ (' + st.maxPos.x + ',' + st.maxPos.y + ')';
    $('stMin').textContent = st.minHeight.toFixed(3) + ' @ (' + st.minPos.x + ',' + st.minPos.y + ')';
    $('stRiverCells').textContent = st.riverCells;
    $('stRiverLen').textContent = st.riverLength + ' 格';
    $('stEroded').textContent = st.erodedVolume.toFixed(1);
    $('stDeposited').textContent = st.depositedVolume.toFixed(1);
  }

  function renderAll() {
    renderMap(state.sim, mapCtx, img);
    renderOverlays();
    renderProfile();
    renderStats();
  }
  /* ---------- 交互 ---------- */
  function canvasPos(ev) {
    const rect = mapCanvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) / rect.width * SIZE,
      y: (ev.clientY - rect.top) / rect.height * SIZE,
    };
  }
  let painting = false;
  function applyTool(ev) {
    const p = canvasPos(ev);
    const sim = state.sim;
    if (state.tool === 'rain') {
      sim.addRainZone(p.x, p.y, state.brushSize, state.rainIntensity);
    } else if (state.tool === 'hard') {
      sim.paintHardness(p.x, p.y, state.brushSize, state.hardValue);
    } else if (state.tool === 'profile') {
      state.profileRow = Math.round(p.y);
    }
    renderAll();
  }
  mapCanvas.addEventListener('pointerdown', (ev) => {
    painting = true;
    mapCanvas.setPointerCapture(ev.pointerId);
    applyTool(ev);
  });
  mapCanvas.addEventListener('pointermove', (ev) => {
    if (!painting) return;
    if (state.tool === 'rain') return; // 降雨区单击放置，避免重复堆叠
    applyTool(ev);
  });
  mapCanvas.addEventListener('pointerup', () => { painting = false; });

  document.querySelectorAll('.tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.tool = btn.dataset.tool;
    });
  });
  document.querySelectorAll('.layer').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.layer;
      state.layers[k] = !state.layers[k];
      btn.classList.toggle('active', state.layers[k]);
      renderAll();
    });
  });

  function bindSlider(id, key, fmt) {
    const el = $(id), val = $(id + 'Val');
    const show = () => { val.textContent = fmt(state[key]); };
    el.addEventListener('input', () => { state[key] = +el.value; show(); });
    el.value = state[key]; show();
  }
  bindSlider('rainIntensity', 'rainIntensity', (v) => v.toFixed(3));
  bindSlider('hardValue', 'hardValue', (v) => v.toFixed(2));
  bindSlider('brushSize', 'brushSize', (v) => v + ' 格');
  bindSlider('speed', 'speed', (v) => v + ' 步/帧');
  $('presetLight').addEventListener('click', () => {
    state.rainIntensity = 0.03; $('rainIntensity').value = 0.03;
    $('rainIntensityVal').textContent = '0.030';
  });
  $('presetHeavy').addEventListener('click', () => {
    state.rainIntensity = 0.20; $('rainIntensity').value = 0.20;
    $('rainIntensityVal').textContent = '0.200';
  });

  /* ---------- 运行控制 ---------- */
  $('btnRun').addEventListener('click', () => {
    state.running = !state.running;
    $('btnRun').textContent = state.running ? '⏸ 暂停' : '▶ 运行';
    $('btnRun').classList.toggle('active', state.running);
    if (!state.running) renderAll(); // 暂停时刷新一次，避免统计显示滞后
  });
  $('btnStep').addEventListener('click', () => {
    state.sim.step();
    renderAll();
  });
  $('btnReset').addEventListener('click', () => {
    const seed = +$('seedInput').value || 0;
    if (seed !== state.sim.seed) newSim(seed);
    else state.sim.reset();
    renderAll();
  });

  function loop() {
    if (state.running) {
      for (let k = 0; k < state.speed; k++) state.sim.step();
      renderMap(state.sim, mapCtx, img);
      renderOverlays();
      if ((state.frame++ & 7) === 0) { renderProfile(); renderStats(); }
    }
    requestAnimationFrame(loop);
  }

  /* ---------- 降雨强度对比 ---------- */
  function runScenario(rainScale, steps) {
    const sim = new ErosionSim({ size: SIZE, seed: state.sim.seed });
    for (const z of state.sim.rainZones) sim.addRainZone(z.x, z.y, z.r, z.intensity);
    for (let k = 0; k < steps; k++) sim.step(rainScale);
    return sim;
  }
  $('btnCompare').addEventListener('click', () => {
    const steps = 150;
    const a = runScenario(0.5, steps);  // 弱降雨
    const b = runScenario(2.0, steps);  // 强降雨
    const imgA = $('cmpA').getContext('2d').createImageData(SIZE, SIZE);
    const imgB = $('cmpB').getContext('2d').createImageData(SIZE, SIZE);
    renderMap(a, $('cmpA').getContext('2d'), imgA);
    renderMap(b, $('cmpB').getContext('2d'), imgB);
    $('cmpATitle').textContent = '弱降雨 ×0.5（' + steps + ' 步）';
    $('cmpBTitle').textContent = '强降雨 ×2.0（' + steps + ' 步）';
    const sa = a.computeStats(), sb = b.computeStats();
    const rows = [
      ['指标', '弱降雨 ×0.5', '强降雨 ×2.0'],
      ['最高点', sa.maxHeight.toFixed(3), sb.maxHeight.toFixed(3)],
      ['最低点', sa.minHeight.toFixed(3), sb.minHeight.toFixed(3)],
      ['河道格数', sa.riverCells, sb.riverCells],
      ['主河道长度', sa.riverLength + ' 格', sb.riverLength + ' 格'],
      ['总侵蚀量', sa.erodedVolume.toFixed(1), sb.erodedVolume.toFixed(1)],
      ['总沉积量', sa.depositedVolume.toFixed(1), sb.depositedVolume.toFixed(1)],
    ];
    $('cmpTable').innerHTML = rows.map((r, i) =>
      '<tr>' + r.map((c) => (i === 0 ? '<th>' : '<td>') + c + (i === 0 ? '</th>' : '</td>')).join('') + '</tr>'
    ).join('');
    $('cmpDialog').showModal();
  });
  $('cmpClose').addEventListener('click', () => $('cmpDialog').close());

  renderAll();
  loop();
})();
