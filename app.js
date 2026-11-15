/* Tidal barrage interactive app: renderer, audio, controls. */
(function () {
  'use strict';
  const CFG = TidalSim.CFG;

  // ---------- Web Audio: flow-driven water + turbine ambience ----------
  const AudioEngine = {
    ctx: null,
    master: null,
    muted: false,
    started: false,
    init() {
      if (this.started) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);

      // Looping water noise from a short white-noise buffer.
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      this.waterGain = this.ctx.createGain();
      this.waterGain.gain.value = 0;
      this.waterFilter = this.ctx.createBiquadFilter();
      this.waterFilter.type = 'lowpass';
      this.waterFilter.frequency.value = 500;
      const noise = this.ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      noise.connect(this.waterFilter).connect(this.waterGain).connect(this.master);
      noise.start();

      // Two turbine hums (triangle oscillators).
      this.turbGain = [this.ctx.createGain(), this.ctx.createGain()];
      this.turbOsc = [0, 1].map((i) => {
        const g = this.turbGain[i];
        g.gain.value = 0;
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 90 + i * 35;
        osc.connect(g).connect(this.master);
        osc.start();
        return osc;
      });
      this.started = true;
    },
    update(flows, turbines, warn) {
      if (!this.started || this.muted) return;
      const t = this.ctx.currentTime;
      const totalFlow = Math.min(1, (Math.abs(flows[0]) + Math.abs(flows[1])) / 6);
      this.waterGain.gain.setTargetAtTime(0.05 + totalFlow * 0.22, t, 0.15);
      this.waterFilter.frequency.setTargetAtTime(350 + totalFlow * 1100, t, 0.2);
      for (let i = 0; i < 2; i++) {
        const mode = turbines[i];
        const target = mode === 0 ? 0 : mode === 1 ? 0.05 : 0.11;
        this.turbGain[i].gain.setTargetAtTime(target, t, 0.1);
        const f = 90 + i * 35 + (mode === 2 ? 55 : 0) + Math.abs(flows[i]) * 12;
        this.turbOsc[i].frequency.setTargetAtTime(f, t, 0.1);
      }
      if (warn && !this.warnOn) this.beep();
      this.warnOn = warn;
    },
    beep() {
      if (!this.started || this.muted) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'square';
      o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, this.ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.25);
      o.connect(g).connect(this.master);
      o.start();
      o.stop(this.ctx.currentTime + 0.27);
    },
    setMuted(m) {
      this.muted = m;
      if (this.started) this.master.gain.value = m ? 0 : 0.9;
    }
  };

  // ---------- Canvas renderer ----------
  const Renderer = {
    particles: [],
    spin: [0, 0],
    draw(canvas, sim) {
      const s = sim.state;
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      const horizon = 150;
      const seaBaseY = horizon + 40;
      const scaleY = 26;                       // px per metre
      const seaY = seaBaseY - s.sea * scaleY;
      const basinY = seaBaseY - s.basin * scaleY;

      ctx.clearRect(0, 0, W, H);
      // Sky
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, '#0b2a3d');
      sky.addColorStop(1, '#174b63');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, horizon);
      // Distant hills
      ctx.fillStyle = '#0d3446';
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      for (let x = 0; x <= W; x += 60) {
        ctx.lineTo(x, horizon - 24 - 18 * Math.sin(x * 0.02 + 1.4));
      }
      ctx.lineTo(W, horizon);
      ctx.fill();

      // Sea water (left)
      this.water(ctx, 0, seaY, W * 0.36, H, '#1a6f8e', '#0e4a63', s.t, 0.6);
      // Basin water (right)
      this.water(ctx, W * 0.64, basinY, W, H, '#1f7f96', '#10536a', s.t, 1.4);

      const wallX1 = W * 0.36, wallX2 = W * 0.64;
      const wallTop = horizon - 30;
      this.updateParticles(sim);
      this.drawBarrage(ctx, sim, wallX1, wallX2, wallTop, H, seaY, basinY);
      this.drawShips(ctx, sim, wallX1, wallX2, seaBaseY, scaleY);
      this.drawTideScale(ctx, sim, 24, horizon, seaBaseY, scaleY);
      this.drawLabels(ctx, W, H, sim);
    },

    water(ctx, x0, y, x1, H, c1, c2, t, phase) {
      const g = ctx.createLinearGradient(0, y, 0, H);
      g.addColorStop(0, c1);
      g.addColorStop(1, c2);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      for (let x = x0; x <= x1; x += 14) {
        ctx.lineTo(x, y + Math.sin(x * 0.03 + t * 2 + phase) * 3);
      }
      ctx.lineTo(x1, H);
      ctx.lineTo(x0, H);
      ctx.closePath();
      ctx.fill();
      // shimmer lines
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        for (let x = x0; x <= x1; x += 20) {
          const yy = y + 14 + k * 16 + Math.sin(x * 0.04 + t * 3 + k + phase) * 2;
          if (x === x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    },

    drawBarrage(ctx, sim, x1, x2, top, H, seaY, basinY) {
      const s = sim.state;
      const slots = [(x1 + x2) / 2 - 55, (x1 + x2) / 2 + 55];
      // concrete structure
      ctx.fillStyle = '#2b4a5c';
      ctx.fillRect(x1 - 14, top, 28, H - top);
      ctx.fillRect(x2 - 14, top, 28, H - top);
      ctx.fillStyle = '#355a6f';
      ctx.fillRect(x1 - 20, top, x2 - x1 + 40, 22);

      slots.forEach((cx, i) => {
        const opening = s.gates[i];
        const slotTop = top + 30;
        const slotH = H - slotTop - 30;
        // slot background
        ctx.fillStyle = '#08222f';
        ctx.fillRect(cx - 26, slotTop, 52, slotH);
        // gate (drops from top; opening = fraction clear at bottom)
        const gateH = slotH * (1 - opening);
        ctx.fillStyle = '#c98a3a';
        ctx.fillRect(cx - 26, slotTop, 52, gateH);
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        for (let yy = slotTop + 6; yy < slotTop + gateH; yy += 12) {
          ctx.fillRect(cx - 26, yy, 52, 2);
        }
        // flow particles
        this.flowParticles(ctx, sim, cx, i, slotTop, slotH, seaY, basinY);
        // turbine at slot bottom
        this.drawTurbine(ctx, sim, cx, slotTop + slotH - 6, i);
        // label
        ctx.fillStyle = '#9fc3d6';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('闸 ' + (i + 1), cx, top - 8);
      });
    },

    updateParticles(sim) {
      const s = sim.state;
      this.particles = this.particles.filter((p) => {
        if (Math.abs(p.x - p.slot) > 40) return false;
        p.x += p.vx;
        p.life -= 0.03;
        if (p.life <= 0) return false;
        return true;
      });
    },

    flowParticles(ctx, sim, cx, i, slotTop, slotH) {
      const s = sim.state;
      const q = s.flows[i];
      if (Math.abs(q) >= 0.02) {
        const dir = q > 0 ? 1 : -1;   // +: sea -> basin (left to right)
        if (Math.random() < Math.min(0.9, Math.abs(q) * 0.8)) {
          this.particles.push({
            x: cx,
            y: slotTop + 20 + Math.random() * (slotH - 50),
            vx: dir * (1 + Math.abs(q) * 2.2),
            life: 1,
            slot: cx
          });
        }
      }
      ctx.fillStyle = s.turbines[i] === 2 ? 'rgba(240,180,67,.85)' : 'rgba(140,220,240,.8)';
      this.particles.forEach((p) => {
        if (p.slot !== cx) return;
        ctx.globalAlpha = p.life;
        ctx.fillRect(p.x - 2, p.y, 4, 2);
      });
      ctx.globalAlpha = 1;
    },

    drawTurbine(ctx, sim, cx, cy, i) {
      const s = sim.state;
      const mode = s.turbines[i];
      const speed = mode === 0 ? 0.4 : mode === 1 ? 6 : 12;
      this.spin[i] = (this.spin[i] + speed * 0.05) % (Math.PI * 2);
      const r = 16;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = '#0a2633';
      ctx.beginPath();
      ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(this.spin[i]);
      const blade = mode === 2 ? '#f0b443' : '#7fd6ea';
      ctx.fillStyle = blade;
      for (let k = 0; k < 4; k++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(5, -6, 2, -r);
        ctx.quadraticCurveTo(-4, -8, 0, 0);
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = '#d8ecf7';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      if (mode === 2) {
        ctx.fillStyle = '#f0b443';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('过载', cx, cy - 26);
      }
    },

    drawShips(ctx, sim, x1, x2, baseY, scaleY) {
      sim.state.ships.forEach((ship, i) => {
        if (ship.state === 'done') return;
        let x;
        const laneY = baseY - 40 - i * 8;
        if (ship.state === 'waiting') {
          x = 60 + i * 30;
        } else {
          const p = Math.min(1, ship.progress / CFG.TRANSIT_TIME);
          x = x1 - 30 + p * (x2 - x1 + 80);
        }
        ctx.fillStyle = ship.state === 'transiting' ? '#f0b443' : '#cfe2ec';
        ctx.beginPath();
        ctx.moveTo(x - 18, laneY);
        ctx.lineTo(x + 18, laneY);
        ctx.lineTo(x + 12, laneY + 12);
        ctx.lineTo(x - 12, laneY + 12);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#8fb2c4';
        ctx.fillRect(x - 6, laneY - 8, 12, 8);
        ctx.fillStyle = '#06202f';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), x, laneY + 9);
      });
    },

    drawTideScale(ctx, sim, x, horizon, baseY, scaleY) {
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.beginPath();
      ctx.moveTo(x, horizon - 90);
      ctx.lineTo(x, baseY + 90);
      ctx.stroke();
      for (let m = -3; m <= 3; m++) {
        const y = baseY - m * scaleY;
        ctx.strokeStyle = 'rgba(255,255,255,.3)';
        ctx.beginPath();
        ctx.moveTo(x - 5, y);
        ctx.lineTo(x + 5, y);
        ctx.stroke();
        ctx.fillStyle = '#7fa6bd';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(m + 'm', x - 8, y + 3);
      }
      ctx.fillStyle = '#37c0d6';
      ctx.beginPath();
      ctx.arc(x, baseY - sim.state.sea * scaleY, 4, 0, Math.PI * 2);
      ctx.fill();
    },

    drawLabels(ctx, W, H, sim) {
      const s = sim.state;
      ctx.textAlign = 'left';
      ctx.font = '13px sans-serif';
      ctx.fillStyle = '#9fc3d6';
      ctx.fillText('外海  潮位 ' + s.sea.toFixed(2) + ' m', 16, H - 16);
      ctx.textAlign = 'right';
      ctx.fillText('港池  水位 ' + s.basin.toFixed(2) + ' m', W - 16, H - 16);
    }
  };

  // ---------- App controller ----------
  const els = {};
  [
    'btnStart', 'btnReset', 'btnAutoCons', 'btnAutoAgg', 'btnManual',
    'btnSpeed', 'btnMute', 'hudTime', 'hudPower', 'hudStorage',
    'hudHead', 'storageFill', 'band', 'modePill', 'ships', 'log',
    'modalBack', 'modalBody', 'btnReplay', 'scene', 'ctrl0', 'ctrl1'
  ].forEach((id) => { els[id] = document.getElementById(id); });

  const SPEEDS = [1, 2, 4];
  let sim = TidalSim.createSim();
  let mode = 'manual';          // manual | conservative | aggressive
  let running = false;
  let speedIdx = 0;
  let lastFrame = null;

  els.band.style.left = (CFG.BAND_LO * 100) + '%';
  els.band.style.width = ((CFG.BAND_HI - CFG.BAND_LO) * 100) + '%';

  function buildChannelControls() {
    for (let i = 0; i < 2; i++) {
      const wrap = els['ctrl' + i];
      wrap.innerHTML =
        '<div class="title"><span>潮闸 / 涡轮 ' + (i + 1) + '</span>' +
        '<span class="mode-pill" id="mode' + i + '">停机</span></div>' +
        '<div class="btnrow">' +
          '<button data-i="' + i + '" data-g="0">关闸</button>' +
          '<button data-i="' + i + '" data-g="0.5">半开</button>' +
          '<button data-i="' + i + '" data-g="1">开闸</button>' +
        '</div>' +
        '<div class="gate-track"><div class="fill" id="gateFill' + i + '" style="width:0%"></div></div>' +
        '<div class="btnrow" style="margin-top:8px">' +
          '<button data-i="' + i + '" data-t="0">涡轮停</button>' +
          '<button data-i="' + i + '" data-t="1">常规</button>' +
          '<button data-i="' + i + '" data-t="2">过载</button>' +
        '</div>';
    }
  }
  function bindChannelButtons() {
    document.querySelectorAll('button[data-g]').forEach((b) => {
      b.addEventListener('click', () => {
        if (mode !== 'manual') return;
        sim.commandGate(+b.dataset.i, +b.dataset.g);
      });
    });
    document.querySelectorAll('button[data-t]').forEach((b) => {
      b.addEventListener('click', () => {
        if (mode !== 'manual') return;
        sim.commandTurbine(+b.dataset.i, +b.dataset.t);
      });
    });
  }
  buildChannelControls();
  bindChannelButtons();

  function setMode(m) {
    mode = m;
    const names = { manual: '手动', conservative: '自动驾驶 · 保守', aggressive: '自动驾驶 · 激进' };
    els.modePill.textContent = names[m];
    document.querySelectorAll('button[data-g],button[data-t]').forEach((b) => {
      b.disabled = (m !== 'manual');
    });
    els.btnManual.classList.toggle('active', m === 'manual');
    els.btnAutoCons.classList.toggle('active', m === 'conservative');
    els.btnAutoAgg.classList.toggle('active', m === 'aggressive');
  }
  els.btnManual.addEventListener('click', () => setMode('manual'));
  els.btnAutoCons.addEventListener('click', () => setMode('conservative'));
  els.btnAutoAgg.addEventListener('click', () => setMode('aggressive'));
  els.btnStart.addEventListener('click', () => {
    AudioEngine.init();
    if (AudioEngine.ctx && AudioEngine.ctx.state === 'suspended') AudioEngine.ctx.resume();
    running = !running;
    els.btnStart.textContent = running ? '暂停' : '开始 / 暂停';
  });
  els.btnReset.addEventListener('click', reset);
  els.btnSpeed.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    els.btnSpeed.textContent = '速度 ×' + SPEEDS[speedIdx];
  });
  els.btnMute.addEventListener('click', () => {
    AudioEngine.setMuted(!AudioEngine.muted);
    els.btnMute.textContent = AudioEngine.muted ? '🔇 音效关' : '🔊 音效开';
  });
  els.btnReplay.addEventListener('click', () => {
    els.modalBack.classList.remove('show');
    reset();
  });

  function reset() {
    sim = TidalSim.createSim();
    running = false;
    els.btnStart.textContent = '开始 / 暂停';
    els.modalBack.classList.remove('show');
    Renderer.particles.length = 0;
  }

  function fmtTime(t) {
    const left = Math.max(0, CFG.DURATION - t);
    const m = Math.floor(left / 60);
    const sec = Math.floor(left % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  function updateHud() {
    const s = sim.state;
    els.hudTime.textContent = fmtTime(s.t);
    els.hudPower.textContent = s.power.toFixed(1);
    const frac = s.energy / CFG.BATTERY_CAP;
    els.hudStorage.textContent = (frac * 100).toFixed(1);
    els.storageFill.style.width = (frac * 100) + '%';
    els.storageFill.style.background =
      (frac < CFG.BAND_LO || frac > CFG.BAND_HI) ? 'var(--bad)' : 'var(--good)';
    els.hudHead.textContent = (s.sea - s.basin).toFixed(2);
    for (let i = 0; i < 2; i++) {
      document.getElementById('gateFill' + i).style.width = (s.gates[i] * 100) + '%';
      const modeName = ['停机', '常规', '过载'][s.turbines[i]];
      const tag = document.getElementById('mode' + i);
      tag.textContent = modeName;
      tag.style.color = s.turbines[i] === 2 ? 'var(--warn)' : 'var(--accent)';
    }
    // ships panel
    els.ships.innerHTML = s.ships.map((sh) => {
      const label = { waiting: '等待', transiting: '通航中', done: '完成' }[sh.state];
      const info = sh.state === 'done'
        ? '延误 ' + sh.delay.toFixed(0) + 's'
        : '窗口 ' + sh.release + '–' + sh.deadline + 's';
      return '<div class="ship"><span>船 ' + (sh.id + 1) + ' · ' + info + '</span>' +
        '<span class="state ' + sh.state + '">' + label + '</span></div>';
    }).join('');
    // log
    els.log.innerHTML = s.events.slice(-8).reverse()
      .map((e) => '<div>[' + Math.round(e.t) + 's] ' + e.msg + '</div>').join('');
  }

  function showResults() {
    const mine = sim.results();
    // Re-run both autopilots headlessly inside the page for the comparison.
    const cons = TidalStrategies.run(TidalStrategies.conservative).results();
    const agg = TidalStrategies.run(TidalStrategies.aggressive).results();
    const row = (label, r, highlight) =>
      '<tr' + (highlight ? ' style="background:rgba(55,192,214,.08)"' : '') + '>' +
      '<td>' + label + '</td>' +
      '<td class="num">' + r.generatedKWh.toFixed(3) + '</td>' +
      '<td class="num">' + r.finalStoragePct.toFixed(1) + '%</td>' +
      '<td class="num">' + r.outOfBandS.toFixed(0) + ' s</td>' +
      '<td class="num">' + r.delayS.toFixed(0) + ' s</td>' +
      '<td class="num">' + r.wearPct.toFixed(1) + '%</td>' +
      '<td class="num">' + r.completed + '/3</td>' +
      '<td class="num"><span class="verdict ' + (r.passed ? 'pass' : 'fail') + '">' +
        (r.passed ? '达标' : '未达标') + '</span></td></tr>';
    els.modalBody.innerHTML =
      '<table><thead><tr><th>策略</th><th class="num">发电量 kWh</th>' +
      '<th class="num">最终储能</th><th class="num">出区时长</th><th class="num">通航延误</th>' +
      '<th class="num">叶片损耗</th><th class="num">通航</th><th class="num">结论</th>' +
      '</tr></thead><tbody>' +
      row('你这一局（' + ({ manual: '手动', conservative: '保守', aggressive: '激进' }[mode]) + '）', mine, true) +
      row('保守策略（基准）', cons, false) +
      row('激进策略（基准）', agg, false) +
      '</tbody></table>' +
      '<p class="note">三艘船延误（秒）——你这一局：[' +
        mine.shipDelays.map((d) => d.toFixed(0)).join(', ') + ']；保守：[' +
        cons.shipDelays.map((d) => d.toFixed(0)).join(', ') + ']；激进：[' +
        agg.shipDelays.map((d) => d.toFixed(0)).join(', ') + ']。</p>' +
      '<p class="note">达标条件：完成三次通航且最终储能位于 55%–85% 区间。' +
      '过载涡轮可提高瞬时功率与流量，但叶片损耗显著上升；储能超过 85% 即脱离目标区间。</p>';
    els.modalBack.classList.add('show');
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (lastFrame === null) lastFrame = now;
    const realDt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (running && !sim.state.finished) {
      const simDt = realDt * SPEEDS[speedIdx];
      if (mode !== 'manual') TidalStrategies[mode](sim, sim.state);
      sim.step(simDt);
      if (sim.state.finished) {
        running = false;
        els.btnStart.textContent = '开始 / 暂停';
        showResults();
      }
    }
    const s = sim.state;
    const frac = s.energy / CFG.BATTERY_CAP;
    const warn = frac < CFG.BAND_LO || frac > CFG.BAND_HI;
    AudioEngine.update(s.flows, s.turbines, warn && running);
    Renderer.draw(els.scene, sim);
    updateHud();
  }
  requestAnimationFrame(frame);
})();
