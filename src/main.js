/* UI wiring, keyboard input, fixed-timestep loop and autopilot demonstrations. */
(function () {
  const canvas = document.getElementById('scene');
  const seedInput = document.getElementById('seedInput');
  const hudEl = document.getElementById('hud');
  const testOut = document.getElementById('testOut');
  const widthSel = document.getElementById('widthSel');
  const throttleSlider = document.getElementById('throttle');
  const contourChk = document.getElementById('contourAssist');
  const windCompChk = document.getElementById('windComp');
  const sowingChk = document.getElementById('sowingChk');
  const muteBtn = document.getElementById('muteBtn');

  let sim = App.Sim.createSim({ seed: seedInput.value, windCompensation: windCompChk.checked });
  let renderer = App.Render.createRenderer(canvas, sim);
  let audio = null;
  let autopilot = null;
  let autoMode = null;
  const AUTO_ACCEL = 30;
  let accumulator = 0;
  let lastTime = performance.now();

  const keys = {};

  function ensureAudio() {
    if (!audio) {
      audio = App.Audio.createAudio();
      audio.setMuted(muteBtn.dataset.muted === '1');
    }
    audio.resume();
  }

  function rebuild() {
    sim = App.Sim.createSim({ seed: seedInput.value.trim() || 'dune-2026', windCompensation: windCompChk.checked });
    sim.setWidth(parseInt(widthSel.value, 10));
    renderer = App.Render.createRenderer(canvas, sim);
    autopilot = null;
    autoMode = null;
    accumulator = 0;
  }

  function readManualInput() {
    const input = sim.input;
    input.contourAssist = contourChk.checked;
    input.sowing = sowingChk.checked;
    input.throttle = parseInt(throttleSlider.value, 10) / 100;
    let steer = 0;
    if (keys.a || keys.arrowleft) steer -= 1;
    if (keys.d || keys.arrowright) steer += 1;
    input.steer = steer;
    input.brake = !!keys[' '];
    sim.windCompensation = windCompChk.checked;
  }

  function startAutopilot(mode) {
    ensureAudio();
    const compensate = mode === 'cover';
    windCompChk.checked = compensate;
    sowingChk.checked = true;
    rebuild();
    widthSel.value = String(App.Sim.WIDTHS[2]);
    autopilot = App.Autopilot.createAutopilot(sim, { compensate, maxSteps: 30000 });
    autoMode = mode;
    testOut.innerHTML = mode === 'cover'
      ? '运行中：完整覆盖演示（风偏补偿开启）…'
      : '运行中：风偏漏播演示（无补偿，侧风偏移种带）…';
  }

  function finishAutopilot() {
    const snap = sim.snapshot();
    const lines = [];
    if (autoMode === 'cover') {
      lines.push('【完整覆盖】结果：' + (snap.won ? '成功 ✓' : '未达标 ✗'));
    } else {
      lines.push('【风偏漏播】结果：' + (snap.won ? '意外达标' : '出现漏播 ✓'));
    }
    snap.zoneRatios.forEach((r, i) => {
      lines.push('区域' + (i + 1) + ' 覆盖率 ' + (r * 100).toFixed(1) + '%' + (r < 0.8 ? ' <span class="fail">(漏播)</span>' : ''));
    });
    lines.push('种子 ' + Math.round(snap.seedUsed) + ' / ' + snap.stock +
      '，重叠浪费率 ' + (snap.wasteRatio * 100).toFixed(1) + '%');
    testOut.innerHTML = lines.join('\n');
    autopilot = null;
    autoMode = null;
  }

  function renderHud() {
    const s = sim.snapshot();
    const v = s.vehicle;
    const seedPct = Math.max(0, 1 - s.seedUsed / s.stock) * 100;
    const zoneBars = s.zoneRatios
      .map((r, i) => '<div class="metric"><span>区域' + (i + 1) + '</span><span>' + (r * 100).toFixed(1) + '%</span></div>' +
        '<div class="bar"><span style="width:' + Math.min(100, r * 100) + '%;background:' + (r >= 0.8 ? '#8fc26a' : '#d8a04a') + '"></span></div>')
      .join('');
    hudEl.innerHTML =
      '<div class="metric"><span>速度</span><span>' + v.speed.toFixed(1) + ' m/s</span></div>' +
      '<div class="metric"><span>坡度</span><span class="' + (v.sliding ? 'warn' : '') + '">' + (v.slope * 100).toFixed(1) + '%' + (v.sliding ? ' 下滑!' : '') + '</span></div>' +
      '<div class="metric"><span>播幅</span><span>' + s.width + ' m</span></div>' +
      '<div class="metric"><span>风速</span><span>' + sim.wind.baseSpeed.toFixed(1) + ' m/s</span></div>' +
      '<div class="metric"><span>状态</span><span>' + (v.sowing ? '撒播中' : '停播') + '</span></div>' +
      '<div class="metric"><span>剩余种子</span><span>' + seedPct.toFixed(0) + '%</span></div>' +
      '<div class="bar"><span style="width:' + seedPct + '%"></span></div>' +
      zoneBars;
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    if (autopilot) {
      accumulator += dt * AUTO_ACCEL;
    } else {
      accumulator += dt;
    }
    let guard = 0;
    const stepBudget = autopilot ? 5 * AUTO_ACCEL : 5;
    while (accumulator >= sim.dt && guard < stepBudget) {
      if (autopilot) {
        autopilot.update();
        if (autopilot.done || sim.finished) finishAutopilot();
      } else {
        readManualInput();
      }
      sim.step();
      accumulator -= sim.dt;
      guard++;
    }
    renderer.render(dt);
    renderHud();
    if (audio) {
      audio.update({
        throttle: sim.input.throttle,
        speed: sim.vehicle.speed,
        sliding: sim.vehicle.sliding,
        windSpeed: sim.wind.speedAt(sim.vehicle.x, sim.vehicle.y, sim.time),
        sowing: sim.vehicle.sowing,
        width: sim.width,
        sawToggle: Math.floor(sim.time * 6) % 2 === 0,
      });
    }
    requestAnimationFrame(frame);
  }

  window.__app = { get sim() { return sim; }, rebuild };
  document.getElementById('newSeedBtn').addEventListener('click', rebuild);
  document.getElementById('resetBtn').addEventListener('click', () => { sim.reset(); renderer.resetDynamic(); });
  document.getElementById('autoCoverBtn').addEventListener('click', () => startAutopilot('cover'));
  document.getElementById('autoMissBtn').addEventListener('click', () => startAutopilot('miss'));
  document.getElementById('stopAutoBtn').addEventListener('click', () => { autopilot = null; autoMode = null; });
  widthSel.addEventListener('change', () => sim.setWidth(parseInt(widthSel.value, 10)));
  windCompChk.addEventListener('change', () => { sim.windCompensation = windCompChk.checked; });
  muteBtn.addEventListener('click', () => {
    ensureAudio();
    const m = !(muteBtn.dataset.muted === '1');
    muteBtn.dataset.muted = m ? '1' : '0';
    muteBtn.textContent = '声音：' + (m ? '关' : '开');
    audio.setMuted(m);
  });

  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    const k = e.key.toLowerCase();
    if (k === 'b') sowingChk.checked = !sowingChk.checked;
    if (k === 'c') contourChk.checked = !contourChk.checked;
    if (k === 'x') { windCompChk.checked = !windCompChk.checked; sim.windCompensation = windCompChk.checked; }
    if (k === 'r') { sim.reset(); renderer.resetDynamic(); }
    if (k === '1' || k === '2' || k === '3') {
      widthSel.value = App.Sim.WIDTHS[parseInt(k, 10) - 1];
      sim.setWidth(parseInt(widthSel.value, 10));
    }
    if (['w', 'a', 's', 'd', ' '].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  canvas.addEventListener('pointerdown', ensureAudio);

  requestAnimationFrame(frame);
})();
