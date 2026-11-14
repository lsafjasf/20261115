// 主控制器：连接模拟引擎、Canvas 渲染、Web Audio 与玩家参数面板。
(function () {
  'use strict';

  var SEED = 239;
  var S = window.MaglevSim;
  var Q = window.MaglevSolver;
  var canvas = document.getElementById('canvas');
  var renderer = new window.MaglevRenderer(canvas, S);
  var audio = new window.MaglevAudio();

  var els = {
    status: document.getElementById('hudStatus'),
    done: document.getElementById('hudDone'),
    time: document.getElementById('hudTime'),
    fault: document.getElementById('hudFault'),
    list: document.getElementById('missionList'),
    log: document.getElementById('log')
  };

  var world = null;
  var settings = null;
  var running = false;
  var mode = 'normal';      // normal | conflict
  var lastTime = 0;
  var acc = 0;
  var seenEvents = 0;
  var rafId = null;

  function freshSettings() {
    var s = {};
    S.generateMissions(SEED).forEach(function (m) {
      s[m.id + ':' + m.index] = { accel: 40, brakePoint: -100, switchLead: 0.5 };
    });
    return s;
  }

  function buildWorld() {
    world = new S.World({ seed: SEED, settings: settings });
    seenEvents = 0;
    els.log.innerHTML = '';
    if (mode === 'conflict') armConflict();
  }

  // 冲突演示：等首车锁定并进入保护区后，注入第二辆强制请求切换的托盘
  function armConflict() {
    var missions = S.generateMissions(SEED);
    var second = missions[1];
    world.queue = world.queue.filter(function (m) { return m.index !== second.index; });
    var injected = {
      id: second.id, mission: second, s: -210, v: 45,
      mode: 'coast', enterZone: false, switchDone: false, switchAt: null,
      waiting: false, phase: 'outbound', departAt: 0,
      cfg: { accel: 42, brakePoint: 200, switchLead: 0.5 },
      result: null, x: 0, y: 0, arm: second.enters, magnet: 0
    };
    world.pallets.push(injected);
    var baseStep = world.step.bind(world);
    var armed = false, frozen = false;
    world.step = function () {
      if (!armed && world.zoneOccupant && world.zoneOccupant !== injected) {
        armed = true; frozen = true;
        injected.cfg.switchLead = 9;
        world.log('test-arm', injected.id, '冲突演示：保护区占用中，强制 ' + injected.id + ' 请求道岔切换');
      }
      if (frozen) {
        var ss = injected.s, vv = injected.v;
        baseStep();
        if (injected.mode !== 'estop') { injected.s = ss; injected.v = vv; }
        world._refreshPose(injected);
        return world.status === 'running';
      }
      return baseStep();
    };
  }

  function renderMissions() {
    var missions = S.generateMissions(SEED);
    els.list.innerHTML = '';
    missions.forEach(function (m, idx) {
      var key = m.id + ':' + m.index;
      var cfg = settings[key];
      var div = document.createElement('div');
      div.className = 'mission';
      div.innerHTML =
        '<div class="title"><b>#' + (idx + 1) + ' ' + m.id + '</b>' +
        '<span>' + m.enters + '→' + m.exits + '（' + m.lineFrom + '→' + m.lineTo + '号线）</span></div>' +
        '<div class="cargo">货物：' + m.cargo + ' · 质量 ' + m.mass + ' t</div>' +
        slider('accel', '加速度', 10, 90, 1, cfg.accel, key) +
        slider('brakePoint', '制动点', -240, 300, 1, cfg.brakePoint, key) +
        slider('switchLead', '道岔提前', 0.1, 3, 0.05, cfg.switchLead, key);
      els.list.appendChild(div);
    });
    els.list.querySelectorAll('input').forEach(function (input) {
      input.addEventListener('input', function () {
        var k = input.dataset.key, field = input.dataset.field;
        settings[k][field] = parseFloat(input.value);
        input.parentElement.querySelector('.val').textContent = input.value;
      });
    });
  }

  function slider(field, label, min, max, step, value, key) {
    return '<div class="row"><label>' + label + '</label>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value +
      '" data-field="' + field + '" data-key="' + key + '"><span class="val">' + value + '</span></div>';
  }

  function setStatus() {
    if (world.status === 'success') {
      els.status.innerHTML = '<span class="badge ok">成功</span>';
    } else if (world.status === 'failed') {
      els.status.innerHTML = '<span class="badge bad">失败</span>';
    } else {
      els.status.innerHTML = '<span class="badge run">' + (running ? '运行中' : '已暂停') + '</span>';
    }
    els.done.textContent = world.completed + ' / 6';
    els.time.textContent = world.t.toFixed(1) + ' s';
    els.fault.textContent = world.stats.collisions + ' / ' + world.stats.conflicts;
  }

  function flushLog() {
    while (seenEvents < world.events.length) {
      var e = world.events[seenEvents++];
      var line = document.createElement('div');
      line.className = 'e-' + e.type;
      line.textContent = e.t.toFixed(2) + 's  ' + e.msg;
      els.log.appendChild(line);
      els.log.scrollTop = els.log.scrollHeight;
      if (e.type === 'switch') audio.blip('switch');
      else if (e.type === 'stop' || e.type === 'home') audio.blip('stop');
      else if (e.type === 'conflict' || e.type === 'fail' || e.type === 'collision') audio.blip('crash');
    }
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (!running || !world) return;
    if (!lastTime) lastTime = now;
    var frame = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    acc += frame;
    var stepDur = world.dt;
    while (acc >= stepDur && world.status === 'running') {
      world.step();
      acc -= stepDur;
    }
    var active = world.pallets.filter(function (p) {
      return p.mode !== 'stop' && p.mode !== 'estop' && p.mode !== 'idle';
    })[0];
    if (active) {
      audio.update(active.v / S.MAX_SPEED, active.magnet, true);
    } else {
      audio.update(0, 0, false);
    }
    renderer.draw(world, now / 1000);
    flushLog();
    setStatus();
    if (world.status !== 'running') {
      running = false;
      audio.update(0, 0, false);
    }
  }

  function start() {
    audio.ensure();
    if (!world || world.status !== 'running') buildWorld();
    running = true;
    lastTime = 0;
    setStatus();
  }

  function reset(normalMode) {
    running = false;
    mode = normalMode ? 'normal' : mode;
    settings = freshSettings();
    buildWorld();
    renderMissions();
    renderer.draw(world, 0);
    setStatus();
    audio.update(0, 0, false);
  }

  document.getElementById('btnStart').addEventListener('click', start);
  document.getElementById('btnPause').addEventListener('click', function () {
    running = false;
    audio.suspend();
    setStatus();
  });
  document.getElementById('btnReset').addEventListener('click', function () { reset(true); });
  document.getElementById('btnAuto').addEventListener('click', function () {
    settings = Q.solveSettings(SEED);
    mode = 'normal';
    buildWorld();
    renderMissions();
    start();
  });
  document.getElementById('btnConflict').addEventListener('click', function () {
    settings = Q.solveSettings(SEED);
    mode = 'conflict';
    buildWorld();
    renderMissions();
    start();
  });

  settings = freshSettings();
  buildWorld();
  renderMissions();
  renderer.draw(world, 0);
  setStatus();
  rafId = requestAnimationFrame(loop);
})();
