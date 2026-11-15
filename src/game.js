/* 主装配：键盘双人输入、固定步长循环、渲染与音频联动 */
(function () {
  'use strict';

  var KEYMAP = {
    KeyQ: 'pump',
    KeyA: 'gate1', KeyS: 'gate2', KeyD: 'gate3',
    KeyP: 'breaker',
    KeyJ: 'relay1', KeyK: 'relay2', KeyL: 'relay3'
  };

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var audio = GameAudio.create();
  var sim = null;
  var started = false;
  var seenEvents = 0;
  var logLines = ['按 Enter 开始检修'];

  function reset() {
    sim = Sim.createSim(testOpts());
    seenEvents = 0;
    logLines = ['任务开始：恢复三组设备并保持安全 5 分钟'];
  }

  // 允许 ?restoreTime=&holdTime= 覆盖参数（用于自动化测试）
  function testOpts() {
    var q = new URLSearchParams(location.search);
    var opts = {};
    ['restoreTime', 'holdTime', 'dt', 'gateLag'].forEach(function (k) {
      if (q.has(k)) opts[k] = Number(q.get(k));
    });
    return opts;
  }

  document.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    audio.init();
    if (e.code === 'Enter') {
      if (!started || sim.getState().status !== 'running') {
        reset();
        started = true;
      }
      return;
    }
    if (!started || sim.getState().status !== 'running') return;
    var key = KEYMAP[e.code];
    if (key) {
      sim.press(key);
      e.preventDefault();
    }
  });

  var acc = 0, last = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    var dtReal = Math.min(0.1, (ts - last) / 1000 || 0);
    last = ts;
    if (!started) {
      // 待机画面
      if (!sim) reset();
      Render.draw(ctx, sim.getState(), sim.cfg, ts / 1000, logLines);
      return;
    }
    acc += dtReal;
    while (acc >= sim.cfg.dt) {
      sim.step(sim.cfg.dt);
      acc -= sim.cfg.dt;
    }
    var st = sim.getState();
    // 新事件 → 日志 + 音效
    var evs = st.events;
    for (; seenEvents < evs.length; seenEvents++) {
      var ev = evs[seenEvents];
      logLines.push('[' + ev.t.toFixed(1) + 's] ' + ev.msg);
      if (logLines.length > 4) logLines.shift();
      audio.notify(ev);
    }
    audio.update(st);
    Render.draw(ctx, st, sim.cfg, ts / 1000, logLines);
  }
  requestAnimationFrame(frame);

  // 测试钩子
  window.__game = {
    state: function () { return sim ? sim.getState() : null; }
  };
})();
