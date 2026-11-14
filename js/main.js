/*
 * 游戏入口：固定步长主循环 + 玩家输入 + 暂停 / 重置 / 自动演示。
 * 模拟核心保持纯函数，所有 DOM / 音频耦合只出现在这里。
 */
(function () {
  'use strict';

  const canvas = document.getElementById('game');
  const ShaftSim = window.ShaftSim;
  const C = ShaftSim.CONFIG;
  const renderer = new window.ShaftRenderer(canvas);
  const audio = new window.ShaftAudio();

  let state = ShaftSim.createState();
  let controller = null;       // 非 null 时启用自动演示
  let accumulator = 0;
  let lastTs = 0;
  let lastDelivered = 0;
  const currentInput = { inlet: 0, overflow: 0, brake: 0 };
  const wallDemoState = { active: false, tick: 0 };

  const el = (id) => document.getElementById(id);
  const statusText = el('status');

  function applyPlayerInput() {
    if (!controller) return null;
    return window.ShaftController.decide(controller, state);
  }

  function frame(ts) {
    if (!lastTs) lastTs = ts;
    let frameDt = (ts - lastTs) / 1000;
    lastTs = ts;
    frameDt = Math.min(frameDt, 0.1);

    if (!state.paused && state.status === 'running') {
      accumulator += frameDt;
      while (accumulator >= C.DT) {
        if (wallDemoState.active) driveWallDemo();
        const input = controller ? applyPlayerInput() : currentInput;
        ShaftSim.step(state, input);
        accumulator -= C.DT;
      }
      handleEvents();
    }

    const m = ShaftSim.metrics(state);
    renderer.draw(state, C, m);
    audio.update(state.lastFlowSpeed, state.tension, state.levelRate, {
      pressure: m.ruptureRatio > 0.85,
      tilt: m.tiltRatio > 0.85
    });
    updateStatus(m);
    requestAnimationFrame(frame);
  }

  function handleEvents() {
    if (state.delivered > lastDelivered) {
      audio.event('deliver');
      lastDelivered = state.delivered;
    }
    if (state.status === 'failed') {
      audio.event(state.failReason === 'rupture' ? 'rupture' : 'wall');
    } else if (state.status === 'won') {
      audio.event('win');
    }
  }

  function updateStatus(m) {
    const labels = {
      running: state.paused ? '已暂停（状态冻结）' : '运行中',
      won: '胜利：三批物资全部送达',
      failed: state.failReason === 'rupture' ? '失败：超压裂管' : '失败：吊篮撞壁'
    };
    statusText.textContent =
      `${labels[state.status]} ｜ 压力 ${(m.ruptureRatio * 100).toFixed(0)}% ` +
      `｜ 失衡 ${(m.tiltRatio * 100).toFixed(0)}% ｜ 已送达 ${state.delivered}/${C.BATCHES}`;
  }

  const keyHeld = {};

  function setControl(name, value) {
    currentInput[name] = ShaftSim.clamp(value, 0, 1);
    syncButtons();
  }

  function togglePause() {
    if (state.status !== 'running') return;
    ShaftSim.setPaused(state, !state.paused);
    syncButtons();
  }

  function reset() {
    wallDemoState.active = false;
    wallDemoState.tick = 0;
    state = ShaftSim.createState();
    controller = null;
    accumulator = 0;
    lastDelivered = 0;
    currentInput.inlet = currentInput.overflow = currentInput.brake = 0;
    Object.keys(keyHeld).forEach((k) => { keyHeld[k] = false; });
    syncButtons();
  }

  function startDemo() {
    reset();
    controller = window.ShaftController.createController();
  }

  function failDemo() {
    reset();
    // 固定的过压失败脚本：进水阀满开、溢流关闭
    currentInput.inlet = 1;
    currentInput.overflow = 0;
    currentInput.brake = 0;
  }

  function wallDemo() {
    reset();
    // 固定的失衡脚本：在进水与溢流之间高频反向猛切，扰动累积直至撞壁
    wallDemoState.active = true;
    wallDemoState.tick = 0;
  }

  function driveWallDemo() {
    const drain = Math.floor(wallDemoState.tick / 4) % 2 === 1;
    currentInput.inlet = drain ? 0 : 1;
    currentInput.overflow = drain ? 1 : 0;
    currentInput.brake = 0;
    wallDemoState.tick += 1;
  }

  function syncButtons() {
    el('btnInlet').classList.toggle('on', currentInput.inlet > 0);
    el('btnOverflow').classList.toggle('on', currentInput.overflow > 0);
    el('btnBrake').classList.toggle('on', currentInput.brake > 0);
    el('btnPause').textContent = state.paused ? '继续' : '暂停';
    el('btnDemo').classList.toggle('on', !!controller);
  }

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    audio.init();
    if (e.code === 'Space') { e.preventDefault(); togglePause(); return; }
    if (e.code === 'KeyR') { reset(); return; }
    if (e.code === 'KeyD') { startDemo(); return; }
    keyHeld[e.code] = true;
  });
  document.addEventListener('keyup', (e) => { keyHeld[e.code] = false; });

  // 持续按键：每帧微调开度（同样受模拟内部滞后约束）
  setInterval(() => {
    if (state.paused || state.status !== 'running' || controller) return;
    const step = 0.08;
    if (keyHeld.KeyQ) setControl('inlet', currentInput.inlet + step);
    if (keyHeld.KeyA) setControl('inlet', currentInput.inlet - step);
    if (keyHeld.KeyW) setControl('overflow', currentInput.overflow + step);
    if (keyHeld.KeyS) setControl('overflow', currentInput.overflow - step);
  }, 90);

  el('btnInlet').addEventListener('click', () => { audio.init(); setControl('inlet', currentInput.inlet > 0 ? 0 : 1); controller = null; syncButtons(); });
  el('btnOverflow').addEventListener('click', () => { audio.init(); setControl('overflow', currentInput.overflow > 0 ? 0 : 1); controller = null; syncButtons(); });
  el('btnBrake').addEventListener('click', () => { audio.init(); setControl('brake', currentInput.brake > 0 ? 0 : 1); controller = null; syncButtons(); });
  el('btnPause').addEventListener('click', () => { audio.init(); togglePause(); });
  el('btnReset').addEventListener('click', reset);
  el('btnDemo').addEventListener('click', () => { audio.init(); startDemo(); });
  el('btnFail').addEventListener('click', () => { audio.init(); failDemo(); });
  el('btnWall').addEventListener('click', () => { audio.init(); wallDemo(); });
  el('btnMute').addEventListener('click', () => {
    audio.init();
    const muted = !audio.muted;
    audio.setMuted(muted);
    el('btnMute').textContent = muted ? '取消静音' : '静音';
  });

  syncButtons();
  window.__game = { get state() { return state; } };
  requestAnimationFrame(frame);
})();
