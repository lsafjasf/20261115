/* Canvas 俯视火场渲染器：仓库、泵站、水带、火点、烟层、压力与特效 */
(function (root) {
  'use strict';

  const W = 900, H = 560;
  const PUMP = { x: 70, y: H / 2 };
  const MANIFOLD = { x: 170, y: H / 2 };
  const FONT = '"Noto Sans SC Local", "PingFang SC", "Microsoft YaHei", sans-serif';
  const HOSE_COLORS = ['#38bdf8', '#22d3ee', '#60a5fa', '#818cf8'];

  // roundRect 兼容补丁（部分旧版浏览器无此方法）
  if (typeof CanvasRenderingContext2D !== 'undefined' &&
      !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const radius = Math.min(r, w / 2, h / 2);
      this.moveTo(x + radius, y);
      this.arcTo(x + w, y, x + w, y + h, radius);
      this.arcTo(x + w, y + h, x, y + h, radius);
      this.arcTo(x, y + h, x, y, radius);
      this.arcTo(x, y, x + w, y, radius);
      this.closePath();
      return this;
    };
  }

  // 四条水带终点（仓库内四个火点），距离递增
  const ENDPOINTS = [
    { x: 360, y: 130 },
    { x: 520, y: 180 },
    { x: 660, y: 300 },
    { x: 780, y: 420 },
  ];

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.sparks = [];
      this.lastSparks = 0;
    }

    hosePath(i) {
      const end = ENDPOINTS[i];
      const start = { x: MANIFOLD.x, y: MANIFOLD.y - 60 + i * 40 };
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 30 };
      return { start, mid, end };
    }

    draw(sim, timeMs) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, W, H);
      this.drawWarehouse(ctx);
      this.drawPumps(ctx, sim);
      this.drawManifold(ctx, sim);
      sim.hoses.forEach((hose, i) => this.drawHose(ctx, hose, i, timeMs));
      sim.hoses.forEach((hose, i) => this.drawFire(ctx, hose, i, timeMs));
      this.drawSmoke(ctx, sim, timeMs);
      this.drawPressureBadge(ctx, sim);
    }

    drawWarehouse(ctx) {
      // 地面网格
      ctx.fillStyle = '#101722';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      // 仓库墙体
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 6;
      ctx.strokeRect(250, 60, 600, 440);
      ctx.fillStyle = 'rgba(71,85,105,0.08)';
      ctx.fillRect(250, 60, 600, 440);
      // 货架示意
      ctx.strokeStyle = 'rgba(148,163,184,0.25)';
      ctx.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        ctx.strokeRect(300 + k * 130, 90, 90, 380);
      }
      ctx.fillStyle = '#94a3b8';
      ctx.font = `12px ${FONT}`;
      ctx.fillText('仓库', 262, 50);
    }

    drawPumps(ctx, sim) {
      sim.pumps.forEach((pump, i) => {
        const x = PUMP.x, y = PUMP.y - 90 + i * 90;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 26, 0, Math.PI * 2);
        ctx.fillStyle = pump.on ? '#0e7490' : '#1f2937';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = pump.on ? '#22d3ee' : '#374151';
        ctx.stroke();
        if (pump.on) {
          // 旋转叶轮
          const a = performance.now() / 140 + i;
          ctx.strokeStyle = 'rgba(224,242,254,0.8)';
          ctx.lineWidth = 2;
          for (let k = 0; k < 3; k++) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(a + k * 2.09) * 16,
              y + Math.sin(a + k * 2.09) * 16);
            ctx.stroke();
          }
        }
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `bold 12px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(pump.id, x, y + 42);
        ctx.restore();
      });
    }

    drawManifold(ctx, sim) {
      ctx.fillStyle = '#0b2f3a';
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(MANIFOLD.x - 14, MANIFOLD.y - 80, 28, 160, 8);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7dd3fc';
      ctx.font = `11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('分水器', MANIFOLD.x, MANIFOLD.y + 105);
    }

    drawHose(ctx, hose, i, timeMs) {
      const { start, mid, end } = this.hosePath(i);
      const color = HOSE_COLORS[i];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      // 底座（暗管）
      ctx.strokeStyle = 'rgba(15,23,42,0.9)';
      ctx.lineWidth = 12;
      ctx.stroke();
      // 水带本体：透明度随阀门开度
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.25 + hose.valve * 0.65;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 流动水滴
      if (hose.flow > 0.3 && !hose.ruptured) {
        const speed = 0.25 + hose.flow / 12;
        for (let k = 0; k < 4; k++) {
          const u = ((timeMs * 0.00025 * speed + k / 4) % 1);
          const p = this.quadPoint(start, mid, end, u);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#e0f2fe';
          ctx.fill();
        }
      }

      // 阀门标记
      const vp = this.quadPoint(start, mid, end, 0.18);
      ctx.beginPath();
      ctx.arc(vp.x, vp.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = hose.valve > 0.05 ? color : '#475569';
      ctx.fill();
      ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2; ctx.stroke();

      // 破裂特效：破口喷射 + 红色闪烁
      if (hose.ruptured) {
        const rp = this.quadPoint(start, mid, end, 0.62);
        const pulse = 0.5 + 0.5 * Math.sin(timeMs / 90);
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, 10 + pulse * 6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(248,113,113,${0.35 + pulse * 0.4})`;
        ctx.fill();
        ctx.strokeStyle = '#fca5a5'; ctx.lineWidth = 2;
        ctx.stroke();
        if (hose.valve > 0.05) {
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + timeMs / 300;
            ctx.beginPath();
            ctx.moveTo(rp.x, rp.y);
            ctx.lineTo(rp.x + Math.cos(a) * (14 + pulse * 8),
              rp.y + Math.sin(a) * (14 + pulse * 8));
            ctx.strokeStyle = 'rgba(125,211,252,0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    quadPoint(a, b, c, u) {
      const v = 1 - u;
      return {
        x: v * v * a.x + 2 * v * u * b.x + u * u * c.x,
        y: v * v * a.y + 2 * v * u * b.y + u * u * c.y,
      };
    }

    drawFire(ctx, hose, i, timeMs) {
      const { end } = this.hosePath(i);
      ctx.save();
      if (hose.out) {
        // 扑灭：暗色余烬 + 对勾
        ctx.beginPath();
        ctx.arc(end.x, end.y, 16, 0, Math.PI * 2);
        ctx.fillStyle = '#1f2937';
        ctx.fill();
        ctx.strokeStyle = '#34d399'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(end.x - 7, end.y);
        ctx.lineTo(end.x - 1, end.y + 6);
        ctx.lineTo(end.x + 8, end.y - 6);
        ctx.stroke();
      } else {
        const heat = (hose.temp - 60) / 900;
        const flicker = 0.75 + 0.25 * Math.sin(timeMs / (80 + i * 20) + i);
        const r = 14 + heat * 16 * flicker;
        const grad = ctx.createRadialGradient(end.x, end.y, 2, end.x, end.y, r * 1.8);
        grad.addColorStop(0, 'rgba(254,240,138,0.95)');
        grad.addColorStop(0.4, 'rgba(251,146,60,0.8)');
        grad.addColorStop(1, 'rgba(220,38,38,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(end.x, end.y, r * 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(end.x, end.y, r * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = '#fde68a';
        ctx.fill();
      }
      // 标签
      ctx.fillStyle = hose.ruptured ? '#fca5a5' : '#cbd5e1';
      ctx.font = `bold 12px ${FONT}`;
      ctx.textAlign = 'center';
      const tag = hose.ruptured ? `${hose.name} 破裂`
        : hose.out ? `${hose.name} 已扑灭` : `${hose.name} ${Math.round(hose.temp)}℃`;
      ctx.fillText(tag, end.x, end.y + 34);
      ctx.restore();
    }

    drawSmoke(ctx, sim) {
      if (sim.smoke <= 0.02) return;
      ctx.save();
      ctx.globalAlpha = sim.smoke * 0.55;
      const grad = ctx.createLinearGradient(0, 60, 0, 200);
      grad.addColorStop(0, 'rgba(71,85,105,0.9)');
      grad.addColorStop(1, 'rgba(71,85,105,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(250, 60, 600, 180);
      ctx.restore();
    }

    drawPressureBadge(ctx, sim) {
      ctx.save();
      ctx.fillStyle = 'rgba(13,17,23,0.8)';
      ctx.strokeStyle = sim.hammerWarn ? '#fbbf24' : '#22d3ee';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(620, 480, 250, 60, 10);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.font = `12px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText('实时管网压力 / 水锤附加', 636, 502);
      ctx.fillStyle = sim.hammerWarn ? '#fbbf24' : '#e0f2fe';
      ctx.font = `bold 22px ${FONT}`;
      ctx.fillText(`${Math.round(sim.pressure)} / +${Math.round(sim.hammer)} kPa`, 636, 528);
      ctx.restore();
    }
  }

  root.FireRenderer = Renderer;
})(typeof self !== 'undefined' ? self : this);
