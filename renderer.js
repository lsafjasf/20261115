// Canvas 渲染：交叉轨道、磁场线、磁浮托盘、中心占用区、侧线停靠站与制动点。
(function (root) {
  'use strict';

  var COLORS = {
    P0: '#4fc3f7',
    P1: '#ffb74d',
    P2: '#81c784'
  };

  function Renderer(canvas, S) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.S = S;
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;
  }

  Renderer.prototype.toCanvas = function (x, y) {
    return { x: this.cx + x, y: this.cy + y };
  };

  Renderer.prototype.draw = function (world, time) {
    var ctx = this.ctx, S = this.S;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._drawGrid();
    this._drawTracks();
    this._drawZone(world, time);
    this._drawSwitch(world, time);
    this._drawDepots(world);
    this._drawBrakeMarkers(world);
    var all = world.pallets.concat(world.parked);
    for (var i = 0; i < all.length; i++) this._drawPallet(all[i], time);
  };

  Renderer.prototype._drawGrid = function () {
    var ctx = this.ctx;
    ctx.strokeStyle = 'rgba(120,160,200,0.08)';
    ctx.lineWidth = 1;
    for (var g = -this.S.ARM; g <= this.S.ARM; g += 35) {
      var p1 = this.toCanvas(g, -this.S.ARM), p2 = this.toCanvas(g, this.S.ARM);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      var q1 = this.toCanvas(-this.S.ARM, g), q2 = this.toCanvas(this.S.ARM, g);
      ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
    }
  };

  Renderer.prototype._drawTracks = function () {
    var ctx = this.ctx, S = this.S, self = this;
    ctx.lineCap = 'round';
    S.ARMS.forEach(function (arm) {
      var v = S.ARM_VEC[arm];
      var a = self.toCanvas(0, 0);
      var b = self.toCanvas(v.x * S.ARM, v.y * S.ARM);
      // 轨道底座
      ctx.strokeStyle = 'rgba(90,110,140,0.55)';
      ctx.lineWidth = 22;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // 两条线路用不同暖色描边
      ctx.strokeStyle = S.LINE_OF[arm] === 1 ? 'rgba(120,180,255,0.35)' : 'rgba(255,170,120,0.35)';
      ctx.lineWidth = 14;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // 臂标签
      var lp = self.toCanvas(v.x * (S.ARM + 22), v.y * (S.ARM + 22));
      ctx.fillStyle = '#9fb4cc';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(arm + '·' + S.LINE_OF[arm] + '号线', lp.x, lp.y);
    });
  };

  Renderer.prototype._drawZone = function (world, time) {
    var ctx = this.ctx, c = this.toCanvas(0, 0);
    var occupied = !!world.zoneOccupant;
    var pulse = 0.5 + 0.5 * Math.sin(time * 6);
    ctx.beginPath();
    ctx.arc(c.x, c.y, this.S.ZONE_R, 0, Math.PI * 2);
    ctx.fillStyle = occupied
      ? 'rgba(255,90,90,' + (0.18 + 0.18 * pulse) + ')'
      : 'rgba(90,200,255,0.10)';
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = occupied ? 'rgba(255,110,110,0.9)' : 'rgba(120,200,255,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = occupied ? '#ff8a80' : '#7fd4ff';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(occupied ? '占用区·' + world.zoneOccupant.id : '占用区', c.x, c.y + 3);
  };

  Renderer.prototype._drawSwitch = function (world, time) {
    if (!world.switchLock) return;
    var ctx = this.ctx, S = this.S;
    var v = S.ARM_VEC[world.switchLock.exits];
    var p = this.toCanvas(v.x * S.SWITCH_S, v.y * S.SWITCH_S);
    var pulse = 0.5 + 0.5 * Math.sin(time * 10);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7 + pulse * 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,230,120,' + (0.6 + 0.4 * pulse) + ')';
    ctx.fill();
  };

  Renderer.prototype._drawDepots = function (world) {
    var ctx = this.ctx, self = this, S = this.S;
    ['P0', 'P1', 'P2'].forEach(function (id) {
      var pose = S.homePose ? S.homePose(id) : null;
      if (!pose) return;
      var p = self.toCanvas(pose.x, pose.y);
      ctx.strokeStyle = 'rgba(140,170,200,0.4)';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, S.PALLET_R + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS[id];
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(id + '库', p.x, p.y - S.PALLET_R - 10);
    });
  };

  Renderer.prototype._drawBrakeMarkers = function (world) {
    var ctx = this.ctx, self = this;
    world.pallets.forEach(function (p) {
      if (p.mode === 'stop' || p.mode === 'estop' || p.mode === 'returning') return;
      var pose = self.S.positionOnPath(p.mission.enters, p.mission.exits, p.cfg.brakePoint);
      var q = self.toCanvas(pose.x, pose.y);
      ctx.strokeStyle = 'rgba(255,160,80,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(q.x - 7, q.y - 7);
      ctx.lineTo(q.x + 7, q.y + 7);
      ctx.moveTo(q.x + 7, q.y - 7);
      ctx.lineTo(q.x - 7, q.y + 7);
      ctx.stroke();
    });
  };

  Renderer.prototype._drawPallet = function (p, time) {
    var ctx = this.ctx, S = this.S;
    var c = this.toCanvas(p.x, p.y);
    var color = COLORS[p.id] || '#cccccc';

    // 磁场光晕：推进为蓝，制动为橙红
    if (p.magnet !== 0 && p.mode !== 'stop' && p.mode !== 'estop') {
      var glow = 0.5 + 0.5 * Math.sin(time * 12);
      var grad = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, S.PALLET_R + 16);
      var gColor = p.magnet > 0 ? '80,180,255' : '255,120,70';
      grad.addColorStop(0, 'rgba(' + gColor + ',' + (0.35 + 0.3 * glow) + ')');
      grad.addColorStop(1, 'rgba(' + gColor + ',0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, S.PALLET_R + 16, 0, Math.PI * 2);
      ctx.fill();
    }

    // 托盘主体
    ctx.beginPath();
    ctx.arc(c.x, c.y, S.PALLET_R, 0, Math.PI * 2);
    ctx.fillStyle = p.mode === 'estop' ? '#ff5252' : color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.mode === 'estop' ? '#b71c1c' : 'rgba(255,255,255,0.85)';
    ctx.stroke();

    // 速度方向小箭头
    if (p.v > 2 && p.mode !== 'estop') {
      var dir = p.phase === 'returning' ? -1 : 1;
      var v0 = S.ARM_VEC[p.arm] || { x: 0, y: 0 };
      var ax = v0.x * dir, ay = v0.y * dir;
      ctx.strokeStyle = '#0b1622';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + ax * (S.PALLET_R - 4), c.y + ay * (S.PALLET_R - 4));
      ctx.stroke();
    }

    ctx.fillStyle = '#0b1622';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.id, c.x, c.y);
  };

  root.MaglevRenderer = Renderer;
})(window);
