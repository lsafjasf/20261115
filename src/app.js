/* 应用主控：UI 绑定、固定步长循环、音效/日志联动、自动驾驶 */
(function () {
  'use strict';
  const { Simulation, AutoPilot, P } = window.FireSim;

  const el = id => document.getElementById(id);
  const sim = new Simulation({ ruptureAt: null });
  const audio = new window.AudioEngine();
  const renderer = new window.FireRenderer(el('scene'));

  let running = false;
  let auto = false;
  let pilot = null;
  let last = 0;
  let acc = 0;
  let rafId = null;
  let seenEvents = 0;

  function buildPumps() {
    el('pumps').innerHTML = sim.pumps.map((pump, i) => `
      <div class="pump">
        <div class="meta">
          <b>${pump.name}</b>
          <small>截流 ${pump.p0} kPa · 内阻 ${pump.rp}</small>
        </div>
        <span class="flow" id="pump-flow-${i}">0.0 L/s</span>
        <button class="toggle off" id="pump-btn-${i}">停机</button>
      </div>`).join('');
    sim.pumps.forEach((pump, i) => {
      el(`pump-btn-${i}`).addEventListener('click', () => {
        audio.resume(); audio.click();
        sim.setPump(i, !pump.on);
      });
    });
  }

  function buildHoses() {
    el('hoses').innerHTML = sim.hoses.map((hose, i) => `
      <div class="hose" id="hose-card-${i}">
        <div class="hose-head">
          <b>${hose.name} <small style="color:#64748b">${hose.length}m · 阻力 ${hose.r}</small></b>
          <span class="temp hot" id="hose-temp-${i}">${Math.round(hose.temp)}℃</span>
        </div>
        <div class="hose-row">
          <span>阀门</span>
          <input type="range" min="0" max="100" value="0" id="hose-range-${i}">
          <span class="q" id="hose-flow-${i}">0.0 L/s</span>
        </div>
        <div class="hose-actions">
          <button id="hose-close-${i}">紧急关阀</button>
        </div>
      </div>`).join('');
    sim.hoses.forEach((hose, i) => {
      el(`hose-range-${i}`).addEventListener('input', e => {
        audio.resume();
        sim.setValve(i, Number(e.target.value) / 100);
      });
      el(`hose-close-${i}`).addEventListener('click', () => {
        audio.resume(); audio.click();
        sim.emergencyClose(i);
        el(`hose-range-${i}`).value = 0;
      });
    });
  }

  function setStatusBadge() {
    const badge = el('mission-state');
    badge.className = 'badge ' + (sim.status === 'running' && running ? 'run' : sim.status);
    badge.textContent = sim.status === 'won' ? '灭火成功'
      : sim.status === 'lost' ? '任务失败'
      : running ? (auto ? '自动驾驶中' : '进行中') : '待开始';
  }

  function handleEvents() {
    const fresh = sim.events.slice(seenEvents);
    seenEvents = sim.events.length;
    for (const ev of fresh) {
      appendLog(ev);
      if (ev.type === 'hammer') audio.hammer(sim.hammer);
      if (ev.type === 'rupture') audio.rupture();
      if (ev.type === 'fire') audio.extinguished();
      if (ev.type === 'result') {
        if (sim.status === 'won') audio.win(); else audio.lose();
      }
    }
  }

  function appendLog(ev) {
    const ul = el('log');
    const li = document.createElement('li');
    li.className = ev.type;
    const mm = String(Math.floor(ev.t / 60)).padStart(2, '0');
    const ss = String(Math.floor(ev.t % 60)).padStart(2, '0');
    li.innerHTML = `<span class="t">${mm}:${ss}</span><span>${ev.message}</span>`;
    ul.prepend(li);
  }

  function syncControls() {
    sim.pumps.forEach((pump, i) => {
      const btn = el(`pump-btn-${i}`);
      btn.textContent = pump.on ? '运行中' : '停机';
      btn.className = 'toggle ' + (pump.on ? 'on' : 'off');
      const pf = (sim.pumpFlows && sim.pumpFlows[i]) || 0;
      el(`pump-flow-${i}`).textContent = `${pf.toFixed(1)} L/s`;
    });
    sim.hoses.forEach((hose, i) => {
      const range = el(`hose-range-${i}`);
      if (document.activeElement !== range) range.value = Math.round(hose.valve * 100);
      el(`hose-flow-${i}`).textContent =
        `${hose.flow.toFixed(1)} L/s${hose.ruptured ? ' 泄漏' : ''}`;
      const temp = el(`hose-temp-${i}`);
      temp.className = 'temp ' +
        (hose.ruptured ? 'rupt' : hose.out ? 'out' : 'hot');
      temp.textContent = hose.ruptured ? '破裂'
        : hose.out ? '已扑灭' : `${Math.round(hose.temp)}℃`;
      el(`hose-card-${i}`).style.borderColor =
        hose.ruptured ? '#f87171' : '';
    });
  }

  function updateGauges() {
    el('pressure').textContent = Math.round(sim.pressure);
    el('hammer').textContent = Math.round(sim.hammer);
    el('tank').textContent = Math.round(sim.tank);
    el('smoke').textContent = Math.round(sim.smoke * 100);
    el('pressure-bar').style.width =
      Math.min(100, sim.pressure / 4) + '%';
    el('hammer-bar').style.width =
      Math.min(100, (sim.hammer / P.pressureBurst) * 100) + '%';
    el('tank-bar').style.width =
      (sim.tank / P.tankCapacity) * 100 + '%';
    el('smoke-bar').style.width = sim.smoke * 100 + '%';
    el('clock').textContent =
      `${String(Math.floor(sim.t / 60)).padStart(2, '0')}:` +
      `${String(Math.floor(sim.t % 60)).padStart(2, '0')}`;
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!running) {
      // 任务结束后仍驱动一次音效淡出与画面刷新
      const idleLeak = sim.hoses.reduce((s, h) =>
        s + (h.ruptured ? h.flow : 0), 0);
      const idleTotal = sim.hoses.reduce((s, h) => s + h.flow, 0);
      audio.update(sim.pumps, idleTotal, idleLeak);
      renderer.draw(sim, now);
      return;
    }
    if (!last) last = now;
    let delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += delta;
    while (acc >= P.dt) {
      if (auto && pilot) pilot.update(P.dt);
      sim.step();
      acc -= P.dt;
      if (sim.status !== 'running') {
        running = false;
        el('btn-start').textContent = '开始任务';
        break;
      }
    }
    const leak = sim.hoses.reduce((s, h) =>
      s + (h.ruptured ? h.flow : 0), 0);
    const total = sim.hoses.reduce((s, h) => s + h.flow, 0);
    audio.update(sim.pumps, total, leak);
    handleEvents();
    syncControls();
    updateGauges();
    setStatusBadge();
    renderer.draw(sim, now);
  }

  function reset(useAuto) {
    running = false;
    auto = !!useAuto;
    pilot = auto ? new AutoPilot(sim) : null;
    sim.reset({ ruptureAt: null });
    seenEvents = 0;
    acc = 0; last = 0;
    el('log').innerHTML = '';
    buildPumps();
    buildHoses();
    updateGauges();
    setStatusBadge();
    renderer.draw(sim, performance.now());
  }

  el('btn-start').addEventListener('click', () => {
    audio.resume();
    if (sim.status !== 'running') reset(false);
    running = true;
    last = 0; acc = 0;
    el('btn-start').textContent = '运行中…';
  });
  el('btn-auto').addEventListener('click', () => {
    audio.resume();
    reset(true);
    running = true;
    last = 0; acc = 0;
    el('btn-start').textContent = '运行中…';
  });
  el('btn-rupture').addEventListener('click', () => {
    audio.resume();
    const target = sim.hoses.findIndex(h => !h.ruptured && !h.out);
    if (target >= 0) sim.triggerRupture(target);
  });
  el('btn-reset').addEventListener('click', () => reset(false));
  el('btn-mute').addEventListener('click', e => {
    audio.resume();
    audio.setMuted(!audio.muted);
    e.currentTarget.textContent = audio.muted ? '音效：关' : '音效：开';
  });

  reset(false);
  rafId = requestAnimationFrame(frame);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => renderer.draw(sim, performance.now()));
  }
})();
