/*
 * Canvas 2D 渲染器：井筒剖面、水位 / 波浪、缆绳、吊篮、平台、
 * 阀门开度、压力区与告警、HUD 与暂停 / 失败 / 胜利遮罩。
 */
(function (global) {
  'use strict';

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;
    this.shaft = { x: 90, w: this.W - 180, top: 46, bottom: this.H - 60 };
  }

  // 模拟高度单位(0..SHAFT_H) -> 画布 y（向下为正，需翻转）
  Renderer.prototype.y = function (unit, C) {
    const span = this.shaft.bottom - this.shaft.top;
    return this.shaft.bottom - (unit / C.SHAFT_H) * span;
  };

  Renderer.prototype.draw = function (state, C, metrics) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this._drawBackground();
    this._drawShaft(C);
    this._drawPressureZone(state, C, metrics);
    this._drawWater(state, C);
    this._drawPlatform(C);
    this._drawCableAndBasket(state, C);
    this._drawValves(state, C);
    this._drawHud(state, C, metrics);
    this._drawOverlay(state);
  };

  global.ShaftRenderer = Renderer;

  Renderer.prototype._drawBackground = function () {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, 0, 0, this.H);
    grad.addColorStop(0, '#0e1726');
    grad.addColorStop(1, '#16233b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.W, this.H);
  };

  Renderer.prototype._drawShaft = function (C) {
    const ctx = this.ctx;
    const s = this.shaft;
    ctx.strokeStyle = '#5b6b86';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(s.x, s.top);
    ctx.lineTo(s.x, s.bottom);
    ctx.moveTo(s.x + s.w, s.top);
    ctx.lineTo(s.x + s.w, s.bottom);
    ctx.stroke();
    // 井壁砖纹
    ctx.strokeStyle = 'rgba(120,140,170,0.18)';
    ctx.lineWidth = 1;
    for (let unit = 10; unit < C.SHAFT_H; unit += 10) {
      const yy = this.y(unit, C);
      ctx.beginPath();
      ctx.moveTo(s.x, yy);
      ctx.lineTo(s.x + s.w, yy);
      ctx.stroke();
    }
    // 顶部滑轮
    ctx.fillStyle = '#8aa0c0';
    ctx.beginPath();
    ctx.arc(s.x + s.w / 2, s.top - 8, 9, 0, Math.PI * 2);
    ctx.fill();
  };

  // 压力区：井筒左侧竖直压力条，越接近裂管越红
  Renderer.prototype._drawPressureZone = function (state, C, m) {
    const ctx = this.ctx;
    const s = this.shaft;
    const barX = 26, barW = 18;
    const danger = m.ruptureRatio;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(barX, s.top, barW, s.bottom - s.top);
    const h = (s.bottom - s.top) * Math.min(1, danger);
    const color = danger > 0.85 ? '#ff4d4d' : danger > 0.6 ? '#ffb02e' : '#39d98a';
    ctx.fillStyle = color;
    ctx.fillRect(barX, s.bottom - h, barW, h);
    ctx.strokeStyle = '#ff4d4d';
    ctx.setLineDash([4, 4]);
    const rupY = s.bottom - (s.bottom - s.top) * 0.92;
    ctx.beginPath();
    ctx.moveTo(barX - 4, rupY);
    ctx.lineTo(barX + barW + 4, rupY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#cdd8ea';
    ctx.font = '12px sans-serif';
    ctx.save();
    ctx.translate(barX - 8, (s.top + s.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('压力 ' + state.pressure.toFixed(0) + ' / ' + C.PRESSURE_RUPTURE, 0, 0);
    ctx.restore();
  };

  Renderer.prototype._drawWater = function (state, C) {
    const ctx = this.ctx;
    const s = this.shaft;
    const wy = this.y(state.level, C);
    const grad = ctx.createLinearGradient(0, wy, 0, s.bottom);
    grad.addColorStop(0, 'rgba(56,150,220,0.75)');
    grad.addColorStop(1, 'rgba(20,70,120,0.85)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(s.x + 3, s.bottom);
    ctx.lineTo(s.x + 3, wy);
    // 波浪表面
    for (let px = s.x + 3; px <= s.x + s.w - 3; px += 6) {
      const wave = Math.sin(px * 0.05 + state.time * 3) * 3
                 + Math.sin(px * 0.11 - state.time * 2) * 2;
      ctx.lineTo(px, wy + wave);
    }
    ctx.lineTo(s.x + s.w - 3, s.bottom);
    ctx.closePath();
    ctx.fill();
    // 水流箭头
    if (Math.abs(state.levelRate) > 0.05) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      const dir = state.levelRate > 0 ? 1 : -1;
      for (let i = 0; i < 4; i++) {
        const ax = s.x + 30 + i * (s.w - 60) / 3;
        const ay = wy + 26 + (i % 2) * 22;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 6, ay - 8 * dir);
        ctx.lineTo(ax + 6, ay - 8 * dir);
        ctx.closePath();
        ctx.fill();
      }
    }
  };

  Renderer.prototype._drawPlatform = function (C) {
    const ctx = this.ctx;
    const s = this.shaft;
    const py = this.y(C.PLATFORM_Y, C);
    ctx.fillStyle = '#9a7b4f';
    ctx.fillRect(s.x + s.w - 6, py - 6, 46, 12);
    ctx.fillStyle = '#c9a978';
    for (let i = 0; i < 4; i++) ctx.fillRect(s.x + s.w - 4 + i * 11, py - 4, 6, 8);
    ctx.fillStyle = '#ffd166';
    ctx.font = '13px sans-serif';
    ctx.fillText('上层平台', s.x + s.w + 46, py + 4);
    ctx.strokeStyle = 'rgba(255,209,102,0.5)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(s.x, this.y(C.PLATFORM_Y + C.DOCK_BAND, C));
    ctx.lineTo(s.x + s.w, this.y(C.PLATFORM_Y + C.DOCK_BAND, C));
    ctx.moveTo(s.x, this.y(C.PLATFORM_Y - C.DOCK_BAND, C));
    ctx.lineTo(s.x + s.w, this.y(C.PLATFORM_Y - C.DOCK_BAND, C));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#5b6b86';
    ctx.fillRect(s.x + 4, s.bottom - 10, s.w - 8, 10);
  };

  Renderer.prototype._drawCableAndBasket = function (state, C) {
    const ctx = this.ctx;
    const s = this.shaft;
    const cx = s.x + s.w / 2;
    const by = this.y(state.basketY, C);
    const topY = s.top - 8;
    const tr = Math.min(1, Math.max(0, (state.tension - 0.8) / 0.8));
    ctx.strokeStyle = `rgb(${150 + tr * 105},${160 - tr * 110},${170 - tr * 130})`;
    ctx.lineWidth = 2 + tr * 2;
    ctx.beginPath();
    ctx.moveTo(cx, topY);
    ctx.lineTo(cx, by - 20);
    ctx.stroke();
    ctx.save();
    ctx.translate(cx, by);
    ctx.rotate((state.tilt * Math.PI) / 180);
    const hitWall = Math.abs(state.tilt) >= C.TILT_LIMIT * 0.85;
    ctx.fillStyle = hitWall ? '#ff6b6b' : '#d9b36a';
    ctx.fillRect(-34, -20, 68, 34);
    ctx.strokeStyle = '#6e5726';
    ctx.lineWidth = 3;
    ctx.strokeRect(-34, -20, 68, 34);
    ctx.beginPath();
    ctx.moveTo(-34, -20);
    ctx.lineTo(0, -34);
    ctx.lineTo(34, -20);
    ctx.stroke();
    if (state.loaded) {
      ctx.fillStyle = '#39d98a';
      ctx.fillRect(-18, -34, 36, 14);
      ctx.strokeStyle = '#1c7a4c';
      ctx.strokeRect(-18, -34, 36, 14);
    }
    ctx.restore();
    if (state.dockTimer > 0) {
      ctx.strokeStyle = '#39d98a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, by - 46, 10, -Math.PI / 2, -Math.PI / 2 + (state.dockTimer / C.DOCK_TIME) * Math.PI * 2);
      ctx.stroke();
    }
  };

  Renderer.prototype._drawValves = function (state) {
    const ctx = this.ctx;
    const baseY = this.H - 34;
    const s = this.shaft;
    const items = [
      { label: '进水阀', target: state.inletTarget, actual: state.inlet, x: s.x + 40, color: '#4aa3ff' },
      { label: '溢流闸', target: state.overflowTarget, actual: state.overflow, x: s.x + s.w / 2 - 40, color: '#ffb02e' },
      { label: '制动器', target: state.brakeTarget, actual: state.brake, x: s.x + s.w - 120, color: '#c792ea' }
    ];
    ctx.font = '12px sans-serif';
    for (const it of items) {
      ctx.fillStyle = '#cdd8ea';
      ctx.fillText(it.label, it.x, baseY - 8);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(it.x, baseY, 80, 10);
      ctx.fillStyle = it.color;
      ctx.fillRect(it.x, baseY, 80 * it.actual, 10);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(it.x, baseY, 80, 10);
      ctx.fillStyle = '#fff';
      ctx.fillRect(it.x + 80 * it.target - 1, baseY - 3, 2, 16);
    }
  };

  Renderer.prototype._drawHud = function (state, C, m) {
    const ctx = this.ctx;
    ctx.fillStyle = '#e6eefc';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('潮水升降井 · 吊篮物资运输', 16, 24);
    ctx.font = '13px sans-serif';
    const lines = [
      `水位 ${state.level.toFixed(1)} / ${C.SHAFT_H}（流速 ${state.levelRate.toFixed(2)}）`,
      `已送达 ${state.delivered} / ${C.BATCHES}    吊篮高度 ${state.basketY.toFixed(1)}`,
      `倾角 ${state.tilt.toFixed(1)}° / ${C.TILT_LIMIT}°    缆绳张力 ${state.tension.toFixed(2)}`
    ];
    lines.forEach((txt, i) => ctx.fillText(txt, 16, 56 + i * 18));
    const warn = [];
    if (m.ruptureRatio > 0.7) warn.push('⚠ 超压风险');
    if (m.tiltRatio > 0.7) warn.push('⚠ 失衡风险');
    if (warn.length) {
      ctx.fillStyle = '#ff6b6b';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(warn.join('   '), this.W - 220, 26);
    }
  };

  Renderer.prototype._drawOverlay = function (state) {
    if (!state.paused && state.status === 'running') return;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(8,14,24,0.72)';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.textAlign = 'center';
    let title = '', sub = '', color = '#ffd166';
    if (state.status === 'won') {
      title = '救援成功';
      sub = `三批物资已全部送达上层平台 · 用时 ${state.time.toFixed(1)} 秒`;
      color = '#39d98a';
    } else if (state.status === 'failed') {
      title = state.failReason === 'rupture' ? '管道超压破裂' : '吊篮失衡撞壁';
      sub = '任务失败，点击“重置”重新开始';
      color = '#ff6b6b';
    } else {
      title = '已暂停';
      sub = '按空格或点击“继续”恢复，状态已完整冻结';
    }
    ctx.fillStyle = color;
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(title, this.W / 2, this.H / 2 - 10);
    ctx.fillStyle = '#e6eefc';
    ctx.font = '16px sans-serif';
    ctx.fillText(sub, this.W / 2, this.H / 2 + 26);
    ctx.textAlign = 'left';
  };
})(typeof self !== 'undefined' ? self : this);
