/* 主控层：游戏循环、输入、自动演示、音效事件 */
(function () {
  'use strict';
  const C = window.CliffDining;
  const R = window.RenderCliff;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const audio = window.CliffAudio.createAudio();

  let g = C.createGame();
  let last = performance.now();
  let autoMode = false;
  let prevSpill = g.dishes.map((d) => d.spill);
  let prevStatus = g.status;
  let prevDeliveries = 0;
  const keys = {};

  const btnAuto = document.getElementById('btn-auto');
  const btnMute = document.getElementById('btn-mute');
  const btnRestart = document.getElementById('btn-restart');

  function reset() {
    g = C.createGame();
    prevSpill = g.dishes.map((d) => d.spill);
    prevStatus = g.status;
    prevDeliveries = 0;
    autoMode = false;
    btnAuto.textContent = '▶ 自动演示一次投递';
    last = performance.now();
  }

  function readInput() {
    if (autoMode) return C.autopilot(g);
    const input = { throttle: 0, estop: false, deliver: false };
    if (keys['ArrowRight'] || keys['KeyD']) input.throttle += 1;
    if (keys['ArrowLeft'] || keys['KeyA']) input.throttle -= 1;
    if (keys['Space']) input.estop = true;
    if (keys['KeyE']) input.deliver = true;
    return input;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const input = readInput();
    C.step(g, input, dt);

    /* 音效事件 */
    g.dishes.forEach((d, i) => {
      if (d.spill - prevSpill[i] > 0.02) audio.spill();
      prevSpill[i] = d.spill;
    });
    if (g.deliveries.length > prevDeliveries) {
      audio.deliver();
      prevDeliveries = g.deliveries.length;
    }
    if (g.status !== prevStatus) {
      if (g.status === 'won') audio.win();
      if (g.status === 'lost') audio.lose();
      prevStatus = g.status;
    }
    audio.update({
      wind: g.wind, theta: g.theta, omega: g.omega, speed: g.v, estop: g.estopActive,
    });

    R.render(ctx, g);
    requestAnimationFrame(frame);
  }

  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    audio.unlock();
    if (e.code === 'KeyR') reset();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  canvas.addEventListener('pointerdown', audio.unlock.bind(audio));

  btnAuto.addEventListener('click', () => {
    audio.unlock();
    if (g.status !== 'running') reset();
    autoMode = true;
    btnAuto.textContent = '自动演示进行中…';
  });
  btnRestart.addEventListener('click', () => { audio.unlock(); reset(); });
  btnMute.addEventListener('click', () => {
    audio.unlock();
    const m = !audio.isMuted();
    audio.setMuted(m);
    btnMute.textContent = m ? '🔇 已静音' : '🔊 声音开';
  });

  requestAnimationFrame(frame);
})();
