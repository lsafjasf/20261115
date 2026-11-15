/* 红蓝套准调准训练台 —— Canvas 渲染与交互 */
(function () {
  'use strict';

  const canvas = document.getElementById('pressCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const C = PrintSim.CONSTANTS;
  const SCALE = 0.35;                 // μm → 画布像素（蓝版偏移的可视缩放）
  const RED = [214, 48, 49];
  const BLUE = [30, 110, 220];

  let sim = PrintSim.createSimulator();
  let currentSheet = null;
  let pending = { dx: 0, dy: 0 };
  let targetDensity = { red: 0.78, blue: 1.24 };
  let soundOn = true;
  let mouse = { x: -999, y: -999, inside: false };
  let cutting = 0;

  /* ---------------- 音效（Web Audio 合成，无外部资源） ---------------- */
  let audioCtx = null;
  function audio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, dur, type, gain, when) {
    if (!soundOn) return;
    const ac = audio();
    const t0 = ac.currentTime + (when || 0);
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(gain || 0.05, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }
  function noiseBurst(dur, gain) {
    if (!soundOn) return;
    const ac = audio();
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain();
    g.gain.value = gain || 0.08;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    src.connect(filter).connect(g).connect(ac.destination);
    src.start();
  }
  const sfx = {
    press() { noiseBurst(0.35, 0.12); tone(90, 0.3, 'sawtooth', 0.06); },
    click() { tone(660, 0.05, 'square', 0.03); },
    good() { tone(660, 0.09, 'sine', 0.05); tone(880, 0.12, 'sine', 0.05, 0.09); },
    bad() { tone(180, 0.18, 'sawtooth', 0.05); },
    cut() { noiseBurst(0.18, 0.15); tone(1400, 0.08, 'triangle', 0.04, 0.16); },
    complete() {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone(f, 0.18, 'sine', 0.06, i * 0.13);
      });
    },
  };

  /* ---------------- 日志与读数 ---------------- */
  const logEl = document.getElementById('eventLog');
  function addLog(text, cls) {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    logEl.prepend(li);
    while (logEl.children.length > 40) logEl.removeChild(logEl.lastChild);
  }

  /* ---------------- 纸张底纹（一次性生成后缓存） ---------------- */
  const paperCanvas = document.createElement('canvas');
  paperCanvas.width = W;
  paperCanvas.height = H;
  (function buildPaper() {
    const p = paperCanvas.getContext('2d');
    p.fillStyle = '#f2ecdd';
    p.fillRect(0, 0, W, H);
    const img = p.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
    }
    p.putImageData(img, 0, 0);
    p.globalAlpha = 0.08;
    for (let i = 0; i < 260; i += 1) {
      p.strokeStyle = Math.random() > 0.5 ? '#8a7a55' : '#ffffff';
      p.lineWidth = Math.random() * 1.2;
      const x = Math.random() * W;
      const y = Math.random() * H;
      p.beginPath();
      p.moveTo(x, y);
      p.bezierCurveTo(x + 40, y + 6, x + 90, y - 6, x + 150, y + 3);
      p.stroke();
    }
    p.globalAlpha = 1;
  })();

  /* ---------------- 网点绘制（红版 15° / 蓝版 75° 网线角） ---------------- */
  function drawHalftone(c, color, angle, density, ox, oy, alpha) {
    const spacing = 13;
    const radius = Math.max(0.8, spacing * 0.34 * density);
    c.save();
    c.translate(W / 2 + ox, H / 2 + oy);
    c.rotate(angle);
    c.fillStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + alpha + ')';
    const span = Math.max(W, H);
    for (let gx = -span; gx <= span; gx += spacing) {
      for (let gy = -span; gy <= span; gy += spacing) {
        c.beginPath();
        c.arc(gx, gy, radius, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
  }

  /* ---------------- 套准标记（四角 + 中心） ---------------- */
  const MARGIN = 64;
  const MARK_POINTS = [
    { x: MARGIN, y: MARGIN },
    { x: W - MARGIN, y: MARGIN },
    { x: MARGIN, y: H - MARGIN },
    { x: W - MARGIN, y: H - MARGIN },
    { x: W / 2, y: H / 2 },
  ];

  function drawCross(c, px, py, color, alpha, size) {
    const s = size || 26;
    c.strokeStyle = 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + alpha + ')';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(px - s, py); c.lineTo(px + s, py);
    c.moveTo(px, py - s); c.lineTo(px, py + s);
    c.stroke();
    c.beginPath();
    c.arc(px, py, s - 9, 0, Math.PI * 2);
    c.stroke();
  }

  function drawRegistration(c, offsetPx, alpha) {
    MARK_POINTS.forEach(function (pt) {
      drawCross(c, pt.x, pt.y, RED, alpha);
      drawCross(c, pt.x + offsetPx.x, pt.y + offsetPx.y, BLUE, alpha);
    });
  }

  function drawGhostLayer(offsetPx, ghost) {
    if (ghost < 0.02) return;
    const st = sim.getState();
    [0, 1, 2].forEach(function (layer) {
      const spread = ghost * (18 + layer * 16);
      const gx = offsetPx.x + 8 + spread;
      const gy = offsetPx.y - 6 - spread * 0.7;
      ctx.save();
      ctx.globalAlpha = Math.min(0.45, ghost) * (1 - layer * 0.28);
      drawHalftone(ctx, BLUE, Math.PI / 2.4, st.density.blue, gx, gy, 0.5);
      drawHalftone(ctx, RED, Math.PI / 12, st.density.red, -gx * 0.4, -gy * 0.4, 0.4);
      ctx.restore();
    });
  }

  /* ---------------- 放大镜 ---------------- */
  const LENS_R = 92;
  const ZOOM = 3;
  function drawMagnifier() {
    if (!mouse.inside) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, LENS_R, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(mouse.x, mouse.y);
    ctx.scale(ZOOM, ZOOM);
    ctx.translate(-mouse.x, -mouse.y);
    renderScene(true);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(40,48,58,0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, LENS_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, LENS_R - 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- 整幅画面 ---------------- */
  function renderScene(inLens) {
    const st = sim.getState();
    const err = currentSheet ? currentSheet.trueError : st.netError;
    const offsetPx = { x: err.x * SCALE, y: err.y * SCALE };
    const baseAlpha = 0.55;

    if (!inLens) ctx.drawImage(paperCanvas, 0, 0);

    if (!currentSheet) {
      if (!inLens) {
        ctx.fillStyle = 'rgba(70,60,40,0.55)';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('纸已上胶印机 —— 应用修正后输出第一张样张', W / 2, H / 2 - 40);
      }
      return;
    }

    drawGhostLayer(offsetPx, st.ghost);
    drawHalftone(ctx, RED, Math.PI / 12, st.density.red, 0, 0, baseAlpha);
    drawHalftone(ctx, BLUE, Math.PI / 2.4, st.density.blue, offsetPx.x, offsetPx.y, baseAlpha);
    drawRegistration(ctx, offsetPx, 0.95);

    if (!inLens && st.ghost >= C.GHOST_LIMIT) {
      ctx.fillStyle = 'rgba(138,47,53,0.92)';
      ctx.fillRect(W / 2 - 150, 18, 300, 34);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('重影超差：过度调整，请减小修正幅度', W / 2, 40);
    }
  }

  function drawCutter() {
    if (cutting <= 0) return;
    const y = H * (1 - cutting);
    ctx.save();
    ctx.strokeStyle = 'rgba(220,60,60,0.85)';
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 8]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    renderScene(false);
    drawCutter();
    drawMagnifier();
  }

  /* ---------------- 面板读数 ---------------- */
  const $ = function (id) { return document.getElementById(id); };
  function cls(v, good, warn) {
    return good ? 'good' : (warn ? 'warn' : 'fail');
  }
  function setMetric(id, text, level) {
    const el = $(id);
    el.textContent = text;
    el.className = level || '';
  }
  function refreshPanel() {
    const st = sim.getState();
    $('dxVal').textContent = pending.dx + ' μm';
    $('dyVal').textContent = pending.dy + ' μm';
    $('redVal').textContent = targetDensity.red.toFixed(3);
    $('blueVal').textContent = targetDensity.blue.toFixed(3);
    $('undoBtn').disabled = !sim.canUndo();

    if (currentSheet) {
      const m = currentSheet.measured;
      const k = currentSheet.checks;
      setMetric('mX', m.x.toFixed(1) + ' μm',
        cls(m.x, Math.abs(m.x) <= C.TOLERANCE_UM));
      setMetric('mY', m.y.toFixed(1) + ' μm',
        cls(m.y, Math.abs(m.y) <= C.TOLERANCE_UM));
      setMetric('mRed', currentSheet.density.red.toFixed(3),
        cls(0, k.ink));
      setMetric('mBlue', currentSheet.density.blue.toFixed(3),
        cls(0, k.ink));
      setMetric('mGhost', st.ghost.toFixed(3),
        cls(0, k.ghost, st.ghost >= C.GHOST_LIMIT * 0.6));
      setMetric('mVerdict', currentSheet.qualified ? '合格 ✓' : '不合格 ✗',
        currentSheet.qualified ? 'good' : 'fail');
    }

    $('streakText').textContent = st.streak + ' / ' + C.STREAK_TARGET;
    $('streakBar').style.width = (st.streak / C.STREAK_TARGET * 100) + '%';

    const pill = $('statusPill');
    if (st.complete) {
      pill.textContent = '调准完成 · 待裁切';
      pill.className = 'status-pill done';
    } else if (currentSheet && currentSheet.qualified) {
      pill.textContent = '本张合格';
      pill.className = 'status-pill ok';
    } else if (currentSheet) {
      pill.textContent = '本张不合格';
      pill.className = 'status-pill bad';
    } else {
      pill.textContent = '待印刷';
      pill.className = 'status-pill';
    }
  }

  /* ---------------- 动作 ---------------- */
  function applyAndReprint() {
    const st = sim.getState();
    const delta = {
      dx: pending.dx,
      dy: pending.dy,
      dRed: +(targetDensity.red - st.density.red).toFixed(3),
      dBlue: +(targetDensity.blue - st.density.blue).toFixed(3),
    };
    const moved = delta.dx !== 0 || delta.dy !== 0 ||
      delta.dRed !== 0 || delta.dBlue !== 0;
    if (!moved) {
      addLog('未做任何参数修改，请先调节滑块');
      return false;
    }
    sim.applyCorrection(delta);
    sfx.click();
    pending = { dx: 0, dy: 0 };
    $('dxSlider').value = 0;
    $('dySlider').value = 0;
    doReprint('修正后重印');
    return true;
  }

  function doReprint(tag) {
    sfx.press();
    currentSheet = sim.reprint();
    const m = currentSheet.measured;
    const verdict = currentSheet.qualified ? '合格' : '不合格';
    addLog(
      '第' + currentSheet.index + '张[' + tag + '] X=' + m.x.toFixed(1) +
      'μm Y=' + m.y.toFixed(1) + 'μm 重影=' + currentSheet.ghost.toFixed(3) +
      ' → ' + verdict + '，连续合格 ' + currentSheet.streak,
      currentSheet.qualified ? 'good' : 'bad'
    );
    if (currentSheet.qualified) sfx.good(); else sfx.bad();
    refreshPanel();
    draw();

    if (currentSheet.complete) {
      sfx.complete();
      addLog('连续 10 张稳定合格，调准完成，进入裁切工序', 'good');
      setTimeout(function () { runCutter(); }, 700);
    }
  }

  function runCutter() {
    cutting = 0.02;
    sfx.cut();
    addLog('裁切刀落下：机械进刀与裁切提示音', 'good');
    const timer = setInterval(function () {
      cutting += 0.08;
      draw();
      if (cutting >= 1) {
        clearInterval(timer);
        cutting = 0;
        draw();
      }
    }, 40);
  }

  function undoAndReprint() {
    if (!sim.canUndo()) return;
    sim.undo();
    sfx.click();
    doReprint('撤销上一次修正后重印');
    const err = currentSheet.trueError;
    if (!currentSheet.checks.registration) {
      addLog('套偏重新出现：X=' + err.x.toFixed(1) + 'μm Y=' +
        err.y.toFixed(1) + 'μm，已超出 ±' + C.TOLERANCE_UM + 'μm 容差', 'bad');
    }
  }

  function resetAll() {
    sim = PrintSim.createSimulator();
    currentSheet = null;
    pending = { dx: 0, dy: 0 };
    targetDensity = { red: 0.78, blue: 1.24 };
    $('dxSlider').value = 0;
    $('dySlider').value = 0;
    $('redSlider').value = 0.78;
    $('blueSlider').value = 1.24;
    logEl.innerHTML = '';
    addLog('训练台已重置，红蓝两版回到初始错位状态');
    refreshPanel();
    draw();
  }

  /* ---------------- 自动调准演示（含过度调整与撤销验证） ---------------- */
  let autoRunning = false;
  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  async function autoDemo() {
    if (autoRunning) return;
    autoRunning = true;
    resetAll();
    addLog('自动演示开始：先出一张原始样张');
    doReprint('自动-原始样张');
    await wait(900);

    addLog('演示过度调整：一次性大幅反向修正，观察重影');
    const os0 = sim.getState();
    pending = { dx: -420, dy: 260 };
    targetDensity = {
      red: +(os0.density.red + 0.3).toFixed(3),
      blue: +(os0.density.blue - 0.35).toFixed(3),
    };
    $('redSlider').value = targetDensity.red;
    $('blueSlider').value = targetDensity.blue;
    applyAndReprint();
    await wait(1100);

    let guard = 0;
    while (!sim.getState().complete && guard < 60) {
      guard += 1;
      const sheet = sim.getState().lastSheet;
      if (!sheet.qualified) {
        const m = sheet.measured;
        pending = {
          dx: Math.abs(m.x) > C.TOLERANCE_UM ? -Math.round(m.x * 0.8) : 0,
          dy: Math.abs(m.y) > C.TOLERANCE_UM ? -Math.round(m.y * 0.8) : 0,
        };
        targetDensity = {
          red: sheet.density.red < C.DENSITY_MIN || sheet.density.red > C.DENSITY_MAX
            ? +(sheet.density.red + (C.DENSITY_TARGET - sheet.density.red) * 0.45).toFixed(3)
            : sheet.density.red,
          blue: sheet.density.blue < C.DENSITY_MIN || sheet.density.blue > C.DENSITY_MAX
            ? +(sheet.density.blue + (C.DENSITY_TARGET - sheet.density.blue) * 0.45).toFixed(3)
            : sheet.density.blue,
        };
        $('redSlider').value = targetDensity.red;
        $('blueSlider').value = targetDensity.blue;
        applyAndReprint();
      } else {
        doReprint('自动-稳定性验证');
      }
      await wait(650);
    }

    if (sim.getState().complete) {
      await wait(1400);
      addLog('验证撤销：回退上一次修正并重印，套偏应当复现');
      undoAndReprint();
      addLog('自动演示结束，可手动重新调准');
    }
    autoRunning = false;
  }

  /* ---------------- 事件绑定 ---------------- */
  $('dxSlider').addEventListener('input', function (e) {
    pending.dx = Number(e.target.value);
    refreshPanel();
  });
  $('dySlider').addEventListener('input', function (e) {
    pending.dy = Number(e.target.value);
    refreshPanel();
  });
  $('redSlider').addEventListener('input', function (e) {
    targetDensity.red = Number(e.target.value);
    refreshPanel();
  });
  $('blueSlider').addEventListener('input', function (e) {
    targetDensity.blue = Number(e.target.value);
    refreshPanel();
  });
  $('reprintBtn').addEventListener('click', applyAndReprint);
  $('reprintOnlyBtn').addEventListener('click', function () {
    if (!currentSheet) {
      addLog('尚未印出第一张样张');
      return;
    }
    doReprint('仅重印');
  });
  $('undoBtn').addEventListener('click', undoAndReprint);
  $('resetBtn').addEventListener('click', resetAll);
  $('autoBtn').addEventListener('click', autoDemo);
  $('soundBtn').addEventListener('click', function () {
    soundOn = !soundOn;
    this.textContent = '音效：' + (soundOn ? '开' : '关');
    this.className = soundOn ? 'on' : '';
    if (soundOn) sfx.click();
  });

  canvas.addEventListener('mousemove', function (e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (W / rect.width);
    mouse.y = (e.clientY - rect.top) * (H / rect.height);
    mouse.inside = true;
    draw();
  });
  canvas.addEventListener('mouseleave', function () {
    mouse.inside = false;
    draw();
  });

  refreshPanel();
  draw();
  addLog('系统就绪：红蓝两版初始错位 X≈+240μm Y≈−160μm，红墨偏淡、蓝墨偏浓');
})();
