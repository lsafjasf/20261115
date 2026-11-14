/* Browser entry point: game loop, input, autopilot toggle, HUD, audio. */
(function () {
  const seed = window.IceRng.DEFAULT_SEED;
  const world = window.IceWorld.generate(seed);
  const sim = window.IceSim.create(world);
  const canvas = document.getElementById('lake');
  const renderer = window.IceRenderer.create(canvas, world);
  const audio = window.IceAudio.createAudio();
  const pilot = window.IcePilot.createPilot(world, sim);

  const el = {
    status: document.getElementById('status'),
    speed: document.getElementById('speed'),
    stress: document.getElementById('stress'),
    progress: document.getElementById('progress'),
    thrusts: document.getElementById('thrusts'),
    points: document.getElementById('points'),
    auto: document.getElementById('auto'),
    seed: document.getElementById('seed')
  };
  el.seed.textContent = seed;

  let autoMode = false;
  let last = performance.now();
  let prevMeasured = world.points.map(() => false);

  function localStress() {
    const c = world.cellAt(sim.x, sim.y);
    return c ? world.stress[c.index] || 0 : 0;
  }

  function fireImpulse(dx, dy) {
    audio.ensure();
    window.IceSim.thrust(sim, dx, dy);
  }

  /* Keyboard: WASD / arrows apply an instantaneous impulse in that axis. */
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    let dx = 0, dy = 0;
    if (k === 'a' || k === 'arrowleft') dx -= 1;
    if (k === 'd' || k === 'arrowright') dx += 1;
    if (k === 'w' || k === 'arrowup') dy -= 1;
    if (k === 's' || k === 'arrowdown') dy += 1;
    if (dx || dy) {
      e.preventDefault();
      fireImpulse(dx, dy);
    }
    if (k === ' ') { e.preventDefault(); toggleAuto(); }
    if (k === 'r') location.reload();
  });

  /* Mouse / touch: one click fires an impulse toward that point. */
  function pointerImpulse(e) {
    audio.ensure();
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    fireImpulse(px - sim.x, py - sim.y);
  }
  canvas.addEventListener('click', pointerImpulse);

  function toggleAuto() {
    audio.ensure();
    autoMode = !autoMode;
    el.auto.textContent = autoMode ? '自动驾驶：开' : '自动驾驶：关';
    el.auto.classList.toggle('on', autoMode);
  }
  document.getElementById('autoBtn').addEventListener('click', toggleAuto);
  document.getElementById('resetBtn').addEventListener('click', () => location.reload());

  function updateHud() {
    const spd = window.IceSim.speed(sim);
    el.speed.textContent = spd.toFixed(0);
    el.stress.textContent = (localStress() * 100).toFixed(0) + '%';
    el.thrusts.textContent = sim.thrusts;
    const done = world.points.filter((p) => p.measured).length;
    el.points.textContent = done + ' / ' + world.points.length;
    el.status.textContent =
      sim.status === 'won' ? '任务完成 ✓ 已回营'
        : sim.status === 'failed' ? '失败：' + sim.failReason
          : autoMode ? '自动驾驶中…' : '手动控制';
    el.status.className = sim.status;
    if (sim.activePoint >= 0) {
      el.progress.textContent = (sim.measureProgress / 2 * 100).toFixed(0) + '%';
    } else {
      el.progress.textContent = '—';
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (sim.status === 'playing') {
      if (autoMode) pilot.update(dt);
      window.IceSim.step(sim, dt);
    }
    world.points.forEach((p, i) => {
      if (p.measured && !prevMeasured[i]) audio.measure();
      prevMeasured[i] = p.measured;
    });
    if (sim.status === 'failed') audio.crack();
    if (sim.status === 'won') audio.win();
    audio.update(localStress(), window.IceSim.speed(sim), dt);
    renderer.render(sim);
    updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* Expose for headless verification of the real browser bundle. */
  window.__ice = { world, sim, pilot, get autoMode() { return autoMode; } };
})();
