// scene.js — 2D 动画世界模型。所有元素位置都是世界时间 t(秒) 的纯函数,
// 切镜/转场不会重置 t。该模块同时被演播页面(index.html)与验证页面(verify.html)使用。
(function (global) {
  const WORLD = { width: 2400, height: 1350 };

  // 音频节拍参数(与 audio.js 保持一致)
  const AUDIO = { bpm: 120, beatsPerBar: 4, duration: 15 };

  // ---- 元素位置:全部为世界时间 t 的确定性函数 ----

  // 红色弹跳球:水平匀速 + 抛物线弹跳
  function ballPos(t) {
    const x = 300 + ((t * 160) % 1800);
    const period = 1.0;
    const ph = (t % period) / period;
    const y = 980 - 420 * (1 - Math.pow(2 * ph - 1, 2));
    return { x, y, r: 46 };
  }

  // 绿色行星:绕固定中心公转
  function planetPos(t) {
    const cx = 1750, cy = 420, orbit = 230;
    const a = t * 0.9;
    return { x: cx + Math.cos(a) * orbit, y: cy + Math.sin(a) * orbit * 0.55, r: 40 };
  }

  // 蓝色月亮:缓慢漂移
  function moonPos(t) {
    return { x: 2150 + Math.sin(t * 0.35) * 60, y: 240 + Math.cos(t * 0.22) * 40, r: 60 };
  }

  // 舞者:沿路径往返行走
  function dancerPos(t) {
    const x = 900 + Math.sin(t * 0.5) * 350;
    return { x, y: 1000, bob: Math.abs(Math.sin(t * 6)) * 18 };
  }

  // 节拍脉冲环:跟随音频节拍收缩(视觉与节拍同步)
  function beatPulse(t) {
    const beat = AUDIO.bpm / 60;
    const ph = (t * beat) % 1;
    return { radius: 30 + 90 * ph, alpha: 1 - ph };
  }

  const MARKERS = {
    red: { name: 'ball', pos: ballPos, test: (r, g, b) => r > 150 && g < 110 && b < 110 },
    green: { name: 'planet', pos: planetPos, test: (r, g, b) => g > 140 && r < 110 && b < 110 },
    blue: { name: 'moon', pos: moonPos, test: (r, g, b) => b > 150 && r < 110 && g < 120 },
  };

  // ---- 世界绘制(与相机无关,在世界坐标系中绘制) ----
  function drawWorld(ctx, t) {
    const grad = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    grad.addColorStop(0, '#0b1030');
    grad.addColorStop(1, '#1d2440');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.fillStyle = '#cfd8ff';
    for (let i = 0; i < 90; i++) {
      const sx = (i * 761) % WORLD.width;
      const sy = (i * 389) % 700;
      const tw = 0.5 + 0.5 * Math.sin(t * 2 + i);
      ctx.globalAlpha = 0.3 + 0.5 * tw;
      ctx.fillRect(sx, sy, 4, 4);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#2c3a2e';
    ctx.fillRect(0, 1050, WORLD.width, WORLD.height - 1050);
    ctx.fillStyle = '#3a4d3d';
    ctx.fillRect(0, 1050, WORLD.width, 14);

    const moon = moonPos(t);
    ctx.fillStyle = '#2244ff';
    ctx.beginPath(); ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a33cc';
    ctx.beginPath(); ctx.arc(moon.x - 18, moon.y - 12, 12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(moon.x + 14, moon.y + 16, 9, 0, Math.PI * 2); ctx.fill();

    const pl = planetPos(t);
    ctx.strokeStyle = 'rgba(120,200,120,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(1750, 420, 230, 230 * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#22cc44';
    ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r, 0, Math.PI * 2); ctx.fill();

    const pulse = beatPulse(t);
    ctx.strokeStyle = 'rgba(255,220,80,' + pulse.alpha.toFixed(3) + ')';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(1200, 620, pulse.radius, 0, Math.PI * 2); ctx.stroke();

    const d = dancerPos(t);
    ctx.strokeStyle = '#ffcf9e';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    const hipY = d.y - 90 - d.bob;
    ctx.beginPath(); ctx.moveTo(d.x, hipY); ctx.lineTo(d.x, hipY - 110); ctx.stroke();
    const swing = Math.sin(t * 6) * 40;
    ctx.beginPath(); ctx.moveTo(d.x, hipY - 100); ctx.lineTo(d.x - 50, hipY - 40 + swing); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d.x, hipY - 100); ctx.lineTo(d.x + 50, hipY - 40 - swing); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d.x, hipY); ctx.lineTo(d.x - 35, d.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d.x, hipY); ctx.lineTo(d.x + 35, d.y); ctx.stroke();
    ctx.fillStyle = '#ffcf9e';
    ctx.beginPath(); ctx.arc(d.x, hipY - 140, 34, 0, Math.PI * 2); ctx.fill();

    const b = ballPos(t);
    ctx.fillStyle = '#ee2222';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(b.x - 14, b.y - 16, 12, 0, Math.PI * 2); ctx.fill();
  }

  global.Scene = { WORLD, AUDIO, MARKERS, ballPos, planetPos, moonPos, dancerPos, beatPulse, drawWorld };
})(typeof window !== 'undefined' ? window : globalThis);
