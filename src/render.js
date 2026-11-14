/**
 * Canvas 渲染：山峰峡谷、哨塔、太阳、云层、光束、镜片、阴影与 HUD 仪表。
 * 画布逻辑尺寸 960x600，按 devicePixelRatio 适配清晰度。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'));
  } else {
    root.CanyonRender = factory(root.CanyonEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const W = 960, H = 600;
  const { LAYOUT } = E;

  // 固定的山脊折线（远处深色 / 近处浅色两层）
  const FAR_RIDGE = [[0, 470], [90, 380], [180, 430], [300, 300], [420, 400],
    [540, 330], [660, 410], [780, 350], [900, 420], [960, 390], [960, 600], [0, 600]];
  const NEAR_RIDGE = [[0, 540], [120, 470], [240, 510], [380, 440], [520, 500],
    [680, 450], [820, 500], [960, 470], [960, 600], [0, 600]];

  function path(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  function drawSky(ctx, sun) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1d2b53');
    g.addColorStop(0.45, '#4a5d8f');
    g.addColorStop(0.8, '#c98a5b');
    g.addColorStop(1, '#e8b878');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 太阳光晕
    const halo = ctx.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 90);
    halo.addColorStop(0, 'rgba(255,244,200,0.95)');
    halo.addColorStop(0.25, 'rgba(255,214,120,0.55)');
    halo.addColorStop(1, 'rgba(255,200,100,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawClouds(ctx, clouds) {
    for (const c of clouds) {
      ctx.save();
      ctx.globalAlpha = 0.82;
      const g = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, c.w * 0.55);
      g.addColorStop(0, 'rgba(226,228,236,0.95)');
      g.addColorStop(1, 'rgba(226,228,236,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.w * 0.5, c.w * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawMountains(ctx) {
    // 远山
    ctx.fillStyle = '#3a4463';
    path(ctx, FAR_RIDGE);
    ctx.fill();
    // 远山受光面高光
    ctx.fillStyle = 'rgba(255,205,140,0.14)';
    ctx.beginPath();
    ctx.moveTo(300, 300);
    ctx.lineTo(360, 372);
    ctx.lineTo(300, 360);
    ctx.closePath();
    ctx.fill();
    // 近山峡谷
    ctx.fillStyle = '#232a3f';
    path(ctx, NEAR_RIDGE);
    ctx.fill();
    // 谷底
    ctx.fillStyle = '#171c2c';
    ctx.fillRect(0, 520, W, 80);
  }

  // 塔在地面上的投影：背向太阳方向偏移
  function drawShadow(ctx, x, baseY, sun) {
    const dx = x - sun.x;
    const dy = baseY - sun.y;
    const l = Math.hypot(dx, dy) || 1;
    const sx = x + (dx / l) * 46;
    const sy = baseY + (dy / l) * 14 + 6;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,18,0.4)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 34, 8, Math.atan2(dy, dx), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTower(ctx, x, topY, baseY) {
    ctx.save();
    // 塔身
    const g = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
    g.addColorStop(0, '#4d5468');
    g.addColorStop(0.5, '#7b8296');
    g.addColorStop(1, '#3a4052');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 11, baseY);
    ctx.lineTo(x - 7, topY);
    ctx.lineTo(x + 7, topY);
    ctx.lineTo(x + 11, baseY);
    ctx.closePath();
    ctx.fill();
    // 塔顶平台与围栏
    ctx.fillStyle = '#5b6378';
    ctx.fillRect(x - 18, topY - 8, 36, 8);
    ctx.strokeStyle = '#8b93a8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 18, topY - 8);
    ctx.lineTo(x - 18, topY - 18);
    ctx.moveTo(x + 18, topY - 8);
    ctx.lineTo(x + 18, topY - 18);
    ctx.moveTo(x - 18, topY - 18);
    ctx.lineTo(x + 18, topY - 18);
    ctx.stroke();
    ctx.restore();
  }

  function drawMirror(ctx, m, selected) {
    ctx.save();
    ctx.translate(m.x, m.y);
    // 支架
    ctx.strokeStyle = '#9aa2b6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.stroke();
    // 镜片沿法线方向旋转（镜面与法线垂直）
    ctx.rotate(m.angle * E.DEG + Math.PI / 2);
    const heatGlow = m.heat / LAYOUT.overheatAt;
    if (heatGlow > 0.55) {
      ctx.shadowColor = `rgba(255,${Math.round(120 - heatGlow * 90)},40,0.9)`;
      ctx.shadowBlur = 8 + heatGlow * 16;
    }
    const mg = ctx.createLinearGradient(-16, 0, 16, 0);
    mg.addColorStop(0, '#cfe6ff');
    mg.addColorStop(0.5, '#f4fbff');
    mg.addColorStop(1, '#8fb4d8');
    ctx.fillStyle = mg;
    ctx.fillRect(-16, -3.5, 32, 7);
    ctx.strokeStyle = m.locked ? '#ff5a4e' : (selected ? '#ffd34d' : '#dfe8f5');
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.strokeRect(-16, -3.5, 32, 7);
    ctx.restore();

    // 锁定标识
    if (m.locked) {
      ctx.save();
      ctx.fillStyle = '#ff5a4e';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('🔒 锁定', m.x, m.y - 22);
      ctx.restore();
    }
  }

  function drawReceiver(ctx, r, lit) {
    ctx.save();
    // 窗框
    ctx.fillStyle = '#2c3242';
    ctx.fillRect(r.x - 20, r.y - 24, 40, 48);
    const g = ctx.createRadialGradient(r.x, r.y, 2, r.x, r.y, 22);
    if (lit) {
      g.addColorStop(0, '#fff7c8');
      g.addColorStop(0.6, '#ffcf5c');
      g.addColorStop(1, 'rgba(255,160,40,0.15)');
      ctx.shadowColor = '#ffcf5c';
      ctx.shadowBlur = 22;
    } else {
      g.addColorStop(0, '#3a4a63');
      g.addColorStop(1, '#1c2230');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBeams(ctx, trace) {
    if (!trace) return;
    // 入射段：太阳 -> M1
    const first = trace.segments[0];
    strokeBeam(ctx, first.incoming.from, first.incoming.to, 0.95, '#ffe9a8');
    trace.segments.forEach((seg) => {
      const alpha = 0.35 + 0.6 * Math.max(0, seg.visibility);
      const color = seg.hit ? '#ffe27a' : 'rgba(255,120,90,1)';
      strokeBeam(ctx, seg.from, seg.to, alpha, color);
      // 命中点闪光
      if (seg.hit) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,240,180,0.9)';
        ctx.beginPath();
        ctx.arc(seg.to.x, seg.to.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
  }

  function strokeBeam(ctx, a, b, alpha, color) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fffbe6';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  return {
    W, H, FAR_RIDGE, NEAR_RIDGE,
    drawSky, drawClouds, drawMountains, drawShadow,
    drawTower, drawMirror, drawReceiver, drawBeams, strokeBeam, path
  };
});
