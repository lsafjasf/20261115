/*
 * main.js — 画布渲染、交互与 12 秒循环调度。
 * 音序由 sim.js 确定性预计算；调度器按 AudioContext 时钟前瞻触发，
 * 因此同一参数重载后音序完全一致（视觉粒子不影响音序）。
 */
(function () {
  'use strict';

  var SIM = window.WindSim;
  var W = SIM.STAGE_W, H = SIM.STAGE_H;
  var BAR_Y = SIM.BAR_Y;     // 悬挂横杆高度
  var TUBE_COUNT = SIM.CHIME_FREQS.length;
  var MAX_SOURCES = 6;
  var MASK_WINDOW = 0.22;    // 同管掩盖窗口（秒）
  var MAX_POLYPHONY = 5;     // 0.12s 滑窗内最大声部数

  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');

  // ---------- 管体几何（与 Node 测试共用 sim.js 中的定义） ----------
  var tubes = SIM.defaultTubeGeometry();
  var tubeSamplePoints = tubes.map(function (t) { return { x: t.x, y: t.midY }; });

  var composition = SIM.defaultComposition();
  var events = [];          // 掩盖处理后的触发事件
  var vibrations = [];      // 每根管的振动幅度（视觉）
  var noteTrails = [];      // 音符轨迹
  for (var i = 0; i < TUBE_COUNT; i++) vibrations.push(0);

  function recompute() {
    var raw = SIM.simulateLoop(composition, tubeSamplePoints);
    events = SIM.applyMasking(raw, MASK_WINDOW, MAX_POLYPHONY);
    setStatus('共 ' + events.length + ' 次触发 / 12 秒（原始 ' + raw.length + ' 次，过密被掩盖 ' +
      (raw.length - events.length) + ' 次）');
  }

  // ---------- 播放调度 ----------
  var audioCtx = null;
  var synth = null;
  var playing = false;
  var looping = true;
  var loopStartTime = 0;    // 本轮循环起点的 AudioContext 时间
  var nextEventIdx = 0;
  var schedTimer = null;

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      synth = new window.ChimeSynth(audioCtx, SIM.CHIME_FREQS);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function startPlayback() {
    ensureAudio();
    playing = true;
    loopStartTime = audioCtx.currentTime + 0.1;
    nextEventIdx = 0;
    schedTimer = setInterval(schedule, 40);
  }

  function stopPlayback() {
    playing = false;
    if (schedTimer) clearInterval(schedTimer);
    schedTimer = null;
  }

  function schedule() {
    if (!playing) return;
    var horizon = audioCtx.currentTime + 0.15;
    while (true) {
      if (nextEventIdx >= events.length) {
        if (looping) {
          loopStartTime += SIM.LOOP_SECONDS;
          nextEventIdx = 0;
        } else if (audioCtx.currentTime > loopStartTime + SIM.LOOP_SECONDS) {
          stopPlayback();
          updatePlayButton();
          return;
        } else {
          return;
        }
      }
      var evTime = loopStartTime + events[nextEventIdx].time;
      if (evTime > horizon) return;
      var ev = events[nextEventIdx];
      synth.strike(ev.chime, Math.max(evTime, audioCtx.currentTime), ev.velocity);
      // 视觉反馈安排在事件实际时刻
      scheduleVisual(ev, Math.max(0, (evTime - audioCtx.currentTime) * 1000));
      nextEventIdx++;
    }
  }

  function scheduleVisual(ev, delayMs) {
    setTimeout(function () {
      vibrations[ev.chime] = Math.min(1, vibrations[ev.chime] + ev.velocity);
      noteTrails.push({
        x: tubes[ev.chime].x, y: tubes[ev.chime].top + tubes[ev.chime].len,
        chime: ev.chime, age: 0, velocity: ev.velocity
      });
    }, delayMs);
  }

  function loopProgress() {
    if (!playing || !audioCtx) return 0;
    var t = (audioCtx.currentTime - loopStartTime) / SIM.LOOP_SECONDS;
    return Math.max(0, Math.min(1, t % 1));
  }

  // ---------- 渲染 ----------
  var CHIME_COLORS = ['#ff8a80', '#ffd180', '#ffff8d', '#ccff90',
    '#a7ffeb', '#80d8ff', '#8c9eff', '#ea80fc'];

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // 横杆
    ctx.strokeStyle = '#3a5170';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(50, BAR_Y);
    ctx.lineTo(W - 50, BAR_Y);
    ctx.stroke();

    drawWindSources();
    drawTubes();
    drawNoteTrails();

    document.getElementById('timeline-fill').style.width = (loopProgress() * 100) + '%';
    requestAnimationFrame(draw);
  }

  function drawTubes() {
    var now = performance.now() / 1000;
    for (var i = 0; i < TUBE_COUNT; i++) {
      var t = tubes[i];
      var v = vibrations[i];
      vibrations[i] *= 0.965; // 振动衰减
      var sway = Math.sin(now * (9 + i)) * v * 9;
      var x = t.x + sway;
      // 挂绳
      ctx.strokeStyle = '#54708f';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(t.x, BAR_Y);
      ctx.lineTo(x, t.top + 14);
      ctx.stroke();
      // 管体
      var grad = ctx.createLinearGradient(x - 7, 0, x + 7, 0);
      grad.addColorStop(0, '#7d8ea3');
      grad.addColorStop(0.5, '#d9e4ef');
      grad.addColorStop(1, '#6a7b90');
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.85 + v * 0.15;
      ctx.fillRect(x - 7, t.top + 14, 14, t.len - 14);
      ctx.globalAlpha = 1;
      // 振动光晕
      if (v > 0.03) {
        ctx.strokeStyle = CHIME_COLORS[i];
        ctx.globalAlpha = v * 0.8;
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 9, t.top + 12, 18, t.len - 10);
        ctx.globalAlpha = 1;
      }
      // 音名
      ctx.fillStyle = '#8fb3d9';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(SIM.CHIME_NAMES[i], t.x, t.top + t.len + 18);
    }
  }

  var windParticles = [];
  function drawWindSources() {
    var now = performance.now() / 1000;
    for (var i = 0; i < composition.sources.length; i++) {
      var s = composition.sources[i];
      // 风源本体：旋转箭头
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.fillStyle = i === selectedSource ? '#6ec6ff' : '#3f6ea5';
      ctx.beginPath();
      ctx.moveTo(16, 0); ctx.lineTo(-8, -10); ctx.lineTo(-4, 0); ctx.lineTo(-8, 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // 衰减范围圈
      ctx.strokeStyle = 'rgba(110,198,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.decay, 0, Math.PI * 2);
      ctx.stroke();
      // 风粒子（装饰性，不影响音序）
      if (playing && Math.random() < s.strength * 0.5) {
        windParticles.push({
          x: s.x, y: s.y + (Math.random() - 0.5) * 14,
          vx: Math.cos(s.angle), vy: Math.sin(s.angle),
          speed: (1.5 + Math.random()) * s.strength * 3, life: 0
        });
      }
    }
    ctx.fillStyle = 'rgba(140,200,255,0.5)';
    for (var p = windParticles.length - 1; p >= 0; p--) {
      var pt = windParticles[p];
      pt.x += pt.vx * pt.speed;
      pt.y += pt.vy * pt.speed;
      pt.life += 0.016;
      if (pt.life > 1.6) { windParticles.splice(p, 1); continue; }
      ctx.globalAlpha = Math.max(0, 0.6 - pt.life * 0.4);
      ctx.fillRect(pt.x, pt.y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawNoteTrails() {
    for (var i = noteTrails.length - 1; i >= 0; i--) {
      var n = noteTrails[i];
      n.age += 0.016;
      n.y -= 0.7;
      if (n.age > 2.2) { noteTrails.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, 1 - n.age / 2.2);
      ctx.fillStyle = CHIME_COLORS[n.chime];
      ctx.font = Math.round(13 + n.velocity * 8) + 'px serif';
      ctx.textAlign = 'center';
      ctx.fillText('♪', n.x + Math.sin(n.age * 4) * 6, n.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 交互 ----------
  var selectedSource = -1;
  var placingMode = false;
  var deletingMode = false;
  var dragging = false;

  function canvasPos(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (W / r.width),
      y: (e.clientY - r.top) * (H / r.height)
    };
  }

  function sourceAt(pos) {
    for (var i = composition.sources.length - 1; i >= 0; i--) {
      var s = composition.sources[i];
      var dx = pos.x - s.x, dy = pos.y - s.y;
      if (dx * dx + dy * dy < 24 * 24) return i;
    }
    return -1;
  }

  canvas.addEventListener('pointerdown', function (e) {
    var pos = canvasPos(e);
    if (placingMode) {
      if (composition.sources.length >= MAX_SOURCES) {
        setStatus('最多 ' + MAX_SOURCES + ' 组风源');
        return;
      }
      composition.sources.push({
        x: pos.x, y: pos.y, angle: 0, strength: 0.7, decay: 180
      });
      selectedSource = composition.sources.length - 1;
      placingMode = false;
      syncModeButtons();
      syncSliders();
      recompute();
      return;
    }
    var idx = sourceAt(pos);
    if (deletingMode) {
      if (idx !== -1) {
        composition.sources.splice(idx, 1);
        selectedSource = -1;
        deletingMode = false;
        syncModeButtons();
        recompute();
      }
      return;
    }
    selectedSource = idx;
    dragging = idx !== -1;
    syncSliders();
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!dragging || selectedSource === -1) return;
    var pos = canvasPos(e);
    var s = composition.sources[selectedSource];
    s.x = Math.max(10, Math.min(W - 10, pos.x));
    s.y = Math.max(10, Math.min(H - 10, pos.y));
  });

  canvas.addEventListener('pointerup', function () {
    if (dragging) { dragging = false; recompute(); }
  });

  // ---------- 控件 ----------
  function setStatus(msg) { document.getElementById('status').textContent = msg; }

  function updatePlayButton() {
    document.getElementById('btn-play').textContent = playing ? '⏸ 停止' : '▶ 播放';
  }

  function syncModeButtons() {
    document.getElementById('btn-add').classList.toggle('active', placingMode);
    document.getElementById('btn-del').classList.toggle('active', deletingMode);
  }

  function syncSliders() {
    var has = selectedSource !== -1;
    var s = has ? composition.sources[selectedSource] : { angle: 0, strength: 0.7, decay: 180 };
    document.getElementById('sl-angle').value = Math.round(s.angle * 180 / Math.PI);
    document.getElementById('sl-strength').value = Math.round(s.strength * 100);
    document.getElementById('sl-decay').value = Math.round(s.decay);
    updateSliderLabels();
  }

  function updateSliderLabels() {
    document.getElementById('v-angle').textContent = document.getElementById('sl-angle').value + '°';
    document.getElementById('v-strength').textContent = document.getElementById('sl-strength').value;
    document.getElementById('v-decay').textContent = document.getElementById('sl-decay').value + 'px';
  }

  function bindSlider(id, apply) {
    document.getElementById(id).addEventListener('input', function () {
      updateSliderLabels();
      if (selectedSource === -1) return;
      apply(composition.sources[selectedSource], Number(this.value));
      recompute();
    });
  }

  bindSlider('sl-angle', function (s, v) { s.angle = v * Math.PI / 180; });
  bindSlider('sl-strength', function (s, v) { s.strength = v / 100; });
  bindSlider('sl-decay', function (s, v) { s.decay = v; });

  document.getElementById('btn-play').addEventListener('click', function () {
    if (playing) stopPlayback(); else startPlayback();
    updatePlayButton();
  });

  document.getElementById('btn-loop').addEventListener('click', function () {
    looping = !looping;
    this.classList.toggle('active', looping);
  });

  document.getElementById('btn-add').addEventListener('click', function () {
    placingMode = !placingMode;
    deletingMode = false;
    syncModeButtons();
  });

  document.getElementById('btn-del').addEventListener('click', function () {
    deletingMode = !deletingMode;
    placingMode = false;
    syncModeButtons();
  });

  // ---------- 保存 / 读取 / 导出 ----------
  var STORAGE_KEY = 'windchime.composition.v1';

  function serialize() {
    return JSON.stringify(composition);
  }

  function loadFrom(json) {
    var data = JSON.parse(json);
    if (!data || !Array.isArray(data.sources)) throw new Error('bad format');
    composition = {
      seed: (data.seed >>> 0) || 1,
      sources: data.sources.slice(0, MAX_SOURCES).map(function (s) {
        return {
          x: Number(s.x) || 0, y: Number(s.y) || 0,
          angle: Number(s.angle) || 0,
          strength: Math.max(0, Math.min(1, Number(s.strength) || 0)),
          decay: Math.max(20, Math.min(600, Number(s.decay) || 180))
        };
      })
    };
    selectedSource = -1;
    recompute();
  }

  document.getElementById('btn-save').addEventListener('click', function () {
    localStorage.setItem(STORAGE_KEY, serialize());
    setStatus('已保存到 localStorage（' + events.length + ' 次触发）');
  });

  document.getElementById('btn-load').addEventListener('click', function () {
    var json = localStorage.getItem(STORAGE_KEY);
    if (!json) { setStatus('没有找到已保存的作品'); return; }
    try {
      loadFrom(json);
      setStatus('已读取，音序与保存时完全一致（' + events.length + ' 次触发）');
    } catch (err) {
      setStatus('读取失败：' + err.message);
    }
  });

  document.getElementById('btn-export').addEventListener('click', function () {
    var blob = new Blob([serialize()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'windchime.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- 初始化 ----------
  recompute();
  syncSliders();
  draw();
})();
