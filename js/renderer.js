/* 池塘 Canvas 渲染器：水体分层 / 藻团 / 气泡 / 光照 / 底泥 / 鱼群 / 设备 */
(function (global) {
  "use strict";

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function PondRenderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.W = canvas.width;
    this.H = canvas.height;
    this.waterTop = 46;
    this.waterBottom = this.H - 64;
    this.rnd = mulberry32(20261115);
    this.frame = 0;
    this._initParticles();
  }

  PondRenderer.prototype._initParticles = function () {
    var r = this.rnd;
    this.algae = [];
    for (var i = 0; i < 90; i++) {
      this.algae.push({
        x: 20 + r() * (this.W - 40),
        y: this.waterTop + 18 + r() * (this.waterBottom - this.waterTop - 40),
        r: 4 + r() * 10,
        drift: 0.2 + r() * 0.7,
        phase: r() * Math.PI * 2
      });
    }
    this.sediment = [];
    for (var s = 0; s < 70; s++) {
      this.sediment.push({
        x: 10 + r() * (this.W - 20),
        y: this.waterBottom + 6 + r() * 46,
        r: 2 + r() * 5,
        lifted: 0
      });
    }
    this.fish = [];
    for (var f = 0; f < 7; f++) {
      this.fish.push({
        x: 60 + r() * (this.W - 120),
        y: this.waterTop + 90 + r() * (this.waterBottom - this.waterTop - 130),
        speed: 0.5 + r() * 0.8,
        dir: r() > 0.5 ? 1 : -1,
        phase: r() * Math.PI * 2
      });
    }
    this.plants = [];
    for (var p = 0; p < 8; p++) {
      this.plants.push({
        x: 40 + p * ((this.W - 80) / 7) + (r() * 18 - 9),
        h: 26 + r() * 22,
        lean: r() * Math.PI * 2
      });
    }
    this.bubbles = [];
  };

  PondRenderer.prototype.draw = function (snap) {
    this.frame++;
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this._drawSky(snap);
    this._drawWaterLayers(snap);
    this._drawLight(snap);
    this._drawShadeNet(snap);
    this._drawAlgae(snap);
    this._drawPlants(snap);
    this._drawSediment(snap);
    this._drawBubbles(snap);
    this._drawFish(snap);
    this._drawDevices(snap);
    this._drawSurface(snap);
  };

  PondRenderer.prototype._drawSky = function (snap) {
    var ctx = this.ctx;
    var g = ctx.createLinearGradient(0, 0, 0, this.waterTop);
    var dim = 0.25 + 0.75 * (1 - snap.controls.shade / 100);
    g.addColorStop(0, "rgb(" + Math.round(180 * dim) + "," + Math.round(205 * dim) + "," + Math.round(225 * dim) + ")");
    g.addColorStop(1, "rgb(" + Math.round(120 * dim) + "," + Math.round(160 * dim) + "," + Math.round(180 * dim) + ")");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.waterTop);
    // 太阳
    ctx.globalAlpha = 0.35 + 0.65 * dim;
    ctx.fillStyle = "#ffe680";
    ctx.beginPath();
    ctx.arc(this.W - 64, 22, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  PondRenderer.prototype._drawWaterLayers = function (snap) {
    var ctx = this.ctx;
    var top = this.waterTop;
    var bottom = this.waterBottom;
    var mud = snap.turbidity / 100;
    var bands = [
      { from: top, to: top + (bottom - top) * 0.35, depth: 0 },
      { from: top + (bottom - top) * 0.35, to: top + (bottom - top) * 0.7, depth: 1 },
      { from: top + (bottom - top) * 0.7, to: bottom, depth: 2 }
    ];
    bands.forEach(function (b) {
      var r = 18 + b.depth * 10 + mud * 40;
      var g = 78 - b.depth * 14 + mud * 22;
      var bl = 102 - b.depth * 18 - mud * 30;
      ctx.fillStyle = "rgb(" + (r | 0) + "," + (g | 0) + "," + (bl | 0) + ")";
      ctx.fillRect(0, b.from, this.W, b.to - b.from);
    }, this);
    // 温跃层分界线
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(0, top + (bottom - top) * 0.35);
    ctx.lineTo(this.W, top + (bottom - top) * 0.35);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  PondRenderer.prototype._drawLight = function (snap) {
    var ctx = this.ctx;
    var intensity = (1 - snap.controls.shade / 100) * (1 - snap.turbidity / 160);
    if (intensity <= 0.05) return;
    ctx.save();
    ctx.globalAlpha = 0.12 * intensity;
    ctx.fillStyle = "#fff3b0";
    for (var i = 0; i < 6; i++) {
      var x = 90 + i * 105 + Math.sin(this.frame * 0.01 + i) * 10;
      ctx.beginPath();
      ctx.moveTo(x - 14, this.waterTop);
      ctx.lineTo(x + 14, this.waterTop);
      ctx.lineTo(x + 46, this.waterBottom);
      ctx.lineTo(x - 30, this.waterBottom);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  PondRenderer.prototype._drawShadeNet = function (snap) {
    var ctx = this.ctx;
    var coverage = snap.controls.shade / 100;
    if (coverage <= 0.01) return;
    var netW = this.W * coverage;
    ctx.save();
    ctx.fillStyle = "rgba(20, 28, 34, 0.55)";
    ctx.fillRect(0, 0, netW, this.waterTop - 6);
    ctx.strokeStyle = "rgba(180, 200, 210, 0.35)";
    ctx.lineWidth = 1;
    for (var x = 0; x < netW; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.waterTop - 6);
      ctx.stroke();
    }
    for (var y = 0; y < this.waterTop - 6; y += 10) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(netW, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  PondRenderer.prototype._drawAlgae = function (snap) {
    var ctx = this.ctx;
    var amount = snap.algae / 100;
    if (amount <= 0.02) return;
    var visible = Math.round(this.algae.length * amount);
    ctx.save();
    for (var i = 0; i < visible; i++) {
      var a = this.algae[i];
      var wob = Math.sin(this.frame * 0.02 * a.drift + a.phase) * 6;
      var x = a.x + wob;
      var y = a.y + Math.cos(this.frame * 0.015 + a.phase) * 4;
      var radius = a.r * (0.6 + amount * 0.6);
      ctx.globalAlpha = 0.18 + amount * 0.35;
      ctx.fillStyle = i % 3 === 0 ? "#3f8f2d" : i % 3 === 1 ? "#5aa83a" : "#7cc14a";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  PondRenderer.prototype._drawPlants = function (snap) {
    var ctx = this.ctx;
    var health = snap.plantHealth / 100;
    var baseColor = Math.round(90 + health * 110);
    ctx.save();
    this.plants.forEach(function (p, idx) {
      var sway = Math.sin(this.frame * 0.02 + p.lean) * 6;
      var h = p.h * (0.35 + health * 0.65);
      ctx.strokeStyle = "rgb(34," + baseColor + ",52)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x, this.waterBottom + 2);
      ctx.quadraticCurveTo(p.x + sway * 0.5, this.waterBottom - h * 0.5,
        p.x + sway, this.waterBottom - h);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      for (var k = 1; k <= 3; k++) {
        var ly = this.waterBottom - (h * k) / 4;
        var lx = p.x + sway * (k / 4);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + (idx % 2 ? 7 : -7), ly - 5);
        ctx.stroke();
      }
    }, this);
    ctx.restore();
  };

  PondRenderer.prototype._drawSediment = function (snap) {
    var ctx = this.ctx;
    var g = ctx.createLinearGradient(0, this.waterBottom, 0, this.H);
    g.addColorStop(0, "#5d4a33");
    g.addColorStop(1, "#3a2d1f");
    ctx.fillStyle = g;
    ctx.fillRect(0, this.waterBottom, this.W, this.H - this.waterBottom);
    var disturb = snap.disturbanceTicks || 0;
    ctx.save();
    this.sediment.forEach(function (pt, i) {
      var active = disturb > 0 && i < Math.min(this.sediment.length, disturb + 10);
      var lift = active ? Math.min(46, (this.frame * 0.6 + pt.r * 4) % 46) : 0;
      ctx.globalAlpha = active ? 0.55 : 0.8;
      ctx.fillStyle = active ? "#8a7354" : "#6b563b";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y - lift, pt.r, 0, Math.PI * 2);
      ctx.fill();
    }, this);
    ctx.restore();
  };

  PondRenderer.prototype._drawBubbles = function (snap) {
    var ctx = this.ctx;
    var rate = snap.controls.aeration / 100;
    if (rate > 0.02 && this.frame % Math.max(1, Math.round(6 - rate * 5)) === 0) {
      var count = 1 + Math.round(rate * 3);
      for (var i = 0; i < count; i++) {
        this.bubbles.push({
          x: 120 + (this.W - 240) * this.rnd(),
          y: this.waterBottom - 10,
          r: 2 + this.rnd() * 4,
          vy: 1.1 + rate * 2.2 + this.rnd()
        });
      }
    }
    ctx.save();
    ctx.strokeStyle = "rgba(220, 245, 255, 0.7)";
    ctx.fillStyle = "rgba(200, 235, 250, 0.25)";
    this.bubbles = this.bubbles.filter(function (b) {
      b.y -= b.vy;
      b.x += Math.sin(this.frame * 0.1 + b.r) * 0.4;
      if (b.y < this.waterTop + 4) return false;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return true;
    }, this);
    ctx.restore();
  };

  PondRenderer.prototype._drawFish = function (snap) {
    if ((snap.status === "lost" && snap.loseReason && snap.loseReason.indexOf("窒息") >= 0)
      || snap.dissolvedOxygen < 2) {
      this._drawDeadFish();
      return;
    }
    var ctx = this.ctx;
    var stress = snap.dissolvedOxygen < 4 ? 0.6 : 0;
    ctx.save();
    this.fish.forEach(function (f) {
      f.x += f.dir * f.speed * (stress ? 0.5 : 1);
      if (f.x > this.W - 30) f.dir = -1;
      if (f.x < 30) f.dir = 1;
      var fy = f.y + Math.sin(this.frame * 0.05 + f.phase) * 5;
      ctx.fillStyle = stress ? "#d98c5f" : "#f2a65a";
      ctx.beginPath();
      ctx.ellipse(f.x, fy, 11, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(f.x + f.dir * 10, fy);
      ctx.lineTo(f.x + f.dir * 18, fy - 5);
      ctx.lineTo(f.x + f.dir * 18, fy + 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#222";
      ctx.beginPath();
      ctx.arc(f.x - f.dir * 6, fy - 1, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }, this);
    ctx.restore();
  };

  PondRenderer.prototype._drawDeadFish = function () {
    var ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "#e8e8e0";
    this.fish.forEach(function (f, i) {
      var fx = 70 + i * 88;
      var fy = this.waterTop + 70 + (i % 3) * 46;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(Math.PI / 2 + (i % 2 ? 0.12 : -0.12));
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c9c9bf";
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(22, -6);
      ctx.lineTo(22, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e8e8e0";
      ctx.restore();
    }, this);
    ctx.restore();
  };

  PondRenderer.prototype._drawDevices = function (snap) {
    var ctx = this.ctx;
    // 曝气机（底部左侧圆盘）
    var aerOn = snap.controls.aeration > 0;
    ctx.fillStyle = aerOn ? "#4fd1c5" : "#5a7380";
    ctx.beginPath();
    ctx.ellipse(120, this.waterBottom - 6, 26, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0e1a22";
    ctx.font = "11px sans-serif";
    ctx.fillText("曝气机 " + snap.controls.aeration + "%", 78, this.waterBottom + 24);
    // 循环泵（底部右侧管道）
    var pumpOn = snap.controls.pump > 0;
    ctx.fillStyle = pumpOn ? "#7aa8e8" : "#5a7380";
    ctx.fillRect(this.W - 150, this.waterBottom - 18, 44, 22);
    ctx.fillStyle = "#0e1a22";
    ctx.fillText("循环泵 " + snap.controls.pump + "%", this.W - 158, this.waterBottom + 24);
    if (pumpOn) {
      ctx.strokeStyle = "rgba(160,210,255,0.5)";
      ctx.lineWidth = 2;
      for (var k = 0; k < 3; k++) {
        var px = this.W - 100 + k * 22 - (this.frame * (1 + snap.controls.pump / 40) % 22);
        ctx.beginPath();
        ctx.moveTo(px, this.waterBottom - 7);
        ctx.lineTo(px - 14, this.waterBottom - 14);
        ctx.stroke();
      }
    }
  };

  PondRenderer.prototype._drawSurface = function (snap) {
    var ctx = this.ctx;
    ctx.strokeStyle = "rgba(220, 245, 255, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var x = 0; x <= this.W; x += 8) {
      var y = this.waterTop + Math.sin(x * 0.05 + this.frame * 0.06) * 2.5;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  global.PondRenderer = PondRenderer;
})(typeof window !== "undefined" ? window : globalThis);
