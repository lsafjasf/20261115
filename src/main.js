/**
 * 主控制器：固定场景装配、游戏循环、键盘/按钮输入、HUD 仪表与音频接线。
 */
(function () {
  'use strict';

  const E = window.CanyonEngine;
  const { CanyonGame } = window.CanyonGame;
  const R = window.CanyonRender;
  const { SoundFX } = window.CanyonAudio;
  const { LAYOUT, TARGET_ANGLES } = E;

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = R.W * dpr;
  canvas.height = R.H * dpr;
  ctx.scale(dpr, dpr);

  const game = new CanyonGame();
  const sfx = new SoundFX();
  let selected = 0;
  let last = performance.now();

  // 动态生成三片镜片的选择按钮与温度行（保证在绑定事件前就绪）
  const mirrorList = document.getElementById('mirror-list');
  const heatList = document.getElementById('heat-list');
  for (let i = 0; i < 3; i++) {
    const btn = document.createElement('button');
    btn.className = 'mirror-btn';
    btn.dataset.mirror = i;
    btn.innerHTML = `<span>镜片 M${i + 1}</span>
      <span><span class="sig m-dot">○</span><small class="m-ang">0°</small></span>`;
    mirrorList.appendChild(btn);

    const row = document.createElement('div');
    row.className = 'heat-row';
    row.innerHTML = `<span>M${i + 1}</span>
      <span class="bar"><span class="bar-fill" id="heat-${i}" style="width:0%"></span></span>
      <span id="heat-txt-${i}" style="width:34px;text-align:right">0</span>
      <small id="ang-${i}" style="width:34px;text-align:right">0°</small>`;
    heatList.appendChild(row);
  }

  // 调试/自动化测试钩子
  window.__canyon = { game, sfx, canvas, select: (i) => { selected = i; } };

  const ui = {
    signalDots: [0, 1, 2].map((i) => document.getElementById('sig-' + i)),
    heatBars: [0, 1, 2].map((i) => document.getElementById('heat-' + i)),
    heatText: [0, 1, 2].map((i) => document.getElementById('heat-txt-' + i)),
    angleText: [0, 1, 2].map((i) => document.getElementById('ang-' + i)),
    wind: document.getElementById('wind'),
    status: document.getElementById('status'),
    winBanner: document.getElementById('win-banner')
  };

  function rotateSelected(dir) {
    sfx.ensure();
    game.rotate(selected, dir);
  }

  document.querySelectorAll('[data-mirror]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selected = Number(btn.dataset.mirror);
      sfx.ensure();
      updateSelection();
    });
  });
  document.getElementById('btn-left').addEventListener('click', () => rotateSelected(-1));
  document.getElementById('btn-right').addEventListener('click', () => rotateSelected(1));
  document.getElementById('btn-reset').addEventListener('click', () => {
    game.reset();
    ui.winBanner.classList.add('hidden');
    sfx.ensure();
  });
  document.getElementById('btn-mute').addEventListener('click', (e) => {
    sfx.ensure();
    sfx.setMuted(!sfx.muted);
    e.target.textContent = sfx.muted ? '🔇 已静音' : '🔊 声音开';
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') { e.preventDefault(); rotateSelected(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'd') { e.preventDefault(); rotateSelected(1); }
    else if (e.key >= '1' && e.key <= '3') { selected = Number(e.key) - 1; updateSelection(); }
  });

  function updateSelection() {
    document.querySelectorAll('[data-mirror]').forEach((btn, i) =>
      btn.classList.toggle('active', i === selected));
  }

  function render() {
    const trace = game.lastTrace;
    R.drawSky(ctx, LAYOUT.sun);
    R.drawClouds(ctx, game.clouds);
    R.drawMountains(ctx);

    // 塔与阴影（镜片所在位置）
    LAYOUT.mirrors.forEach((m) => {
      R.drawShadow(ctx, m.x, m.y + 26, LAYOUT.sun);
      R.drawTower(ctx, m.x, m.y + 8, m.y + 30);
    });
    // 接收窗所在塔
    R.drawShadow(ctx, LAYOUT.receiver.x, LAYOUT.receiver.y + 40, LAYOUT.sun);
    R.drawTower(ctx, LAYOUT.receiver.x, LAYOUT.receiver.y + 22, LAYOUT.receiver.y + 44);

    R.drawBeams(ctx, trace);
    game.mirrors.forEach((m, i) => R.drawMirror(ctx, m, i === selected));
    R.drawReceiver(ctx, LAYOUT.receiver, trace ? trace.receiverHit : false);
  }

  function syncHud() {
    game.signals.forEach((on, i) => {
      ui.signalDots[i].classList.toggle('on', on);
      ui.signalDots[i].textContent = on ? '●' : '○';
      const miniDot = mirrorList.querySelectorAll('.m-dot')[i];
      if (miniDot) {
        miniDot.classList.toggle('on', on);
        miniDot.textContent = on ? '●' : '○';
      }
    });
    game.mirrors.forEach((m, i) => {
      const pct = Math.round(m.heat);
      ui.heatBars[i].style.width = pct + '%';
      ui.heatBars[i].className = 'bar-fill' +
        (m.locked ? ' locked' : pct >= 80 ? ' hot' : '');
      ui.heatText[i].textContent = m.locked ? '锁定' : String(pct);
      ui.angleText[i].textContent = Math.round(m.angle) + '°';
      const miniAng = mirrorList.querySelectorAll('.m-ang')[i];
      if (miniAng) miniAng.textContent = Math.round(m.angle) + '°';
    });
    const windPct = Math.round((game.wind * 0.5 + 0.5) * 100);
    ui.wind.style.width = windPct + '%';
    const count = game.lockedCount;
    ui.status.textContent = game.won
      ? '通信建立完成'
      : `信号 ${count}/3 · 步长 ${LAYOUT.stepDeg}° · 容差 ${LAYOUT.toleranceDeg}°`;
    if (game.won) ui.winBanner.classList.remove('hidden');
  }

  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    if (!game.paused) {
      game.update(dt);
      sfx.handle(game.events);
    }
    render();
    syncHud();
    requestAnimationFrame(frame);
  }

  // 自动化测试：暂停实时循环，由测试脚本手动驱动 update（渲染仍继续）
  window.__canyon.setPaused = (p) => { game.paused = p; };
  window.__canyon.render = render;
  window.__canyon.syncHud = syncHud;

  updateSelection();
  requestAnimationFrame(frame);
})();
