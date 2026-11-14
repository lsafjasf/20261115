// Canvas 渲染：草原起伏地形、风羽、接收圈、热气球与邮件投递轨迹。
import { TARGETS, WORLD, terrainHeight, windAt } from "./sim.js";

const SCALE = 3.0; // 1 米对应 3 像素

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.w = canvas.width;
    this.h = canvas.height;
    this.rngSeed = 7;
  }

  // 世界坐标 -> 屏幕坐标（相机跟随气球，垂直方向留出地形空间）
  _project(x, z, cam) {
    return {
      px: (x - cam.x) * SCALE + this.w * 0.42,
      py: this.h * 0.72 - (z - cam.z) * SCALE,
    };
  }

  draw(sim, prevTrail) {
    const { ctx, w, h } = this;
    const cam = { x: sim.x, z: sim.z };
    ctx.clearRect(0, 0, w, h);
    this._drawSky(sim);
    this._drawWindField(sim, cam);
    this._drawTerrain(sim, cam);
    this._drawTargets(sim, cam);
    this._drawBalloonTrail(sim, cam, prevTrail);
    this._drawMail(sim, cam);
    this._drawBalloon(sim, cam);
    this._drawVignette(sim);
  }

  _drawSky(sim) {
    const { ctx, w, h } = this;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#5fa8d6");
    grad.addColorStop(0.55, "#a8d5ec");
    grad.addColorStop(1, "#d8eef7");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 太阳
    ctx.fillStyle = "rgba(255, 236, 170, 0.9)";
    ctx.beginPath();
    ctx.arc(w - 90, 78, 34, 0, Math.PI * 2);
    ctx.fill();

    // 远处云（位置随相机缓慢移动，产生视差）
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    for (let i = 0; i < 6; i++) {
      const baseX = i * 380 - (sim.x * 0.35) % 380;
      const cx = ((baseX % (w + 300)) + w + 300) % (w + 300) - 150;
      const cy = 70 + (i % 3) * 42;
      this._cloud(cx, cy, 26 + (i % 2) * 10);
    }
  }

  _cloud(x, y, r) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 0.9, y + 6, r * 0.8, 0, Math.PI * 2);
    ctx.arc(x - r * 0.9, y + 7, r * 0.7, 0, Math.PI * 2);
    ctx.arc(x + r * 0.2, y - r * 0.5, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawWindField(sim, cam) {
    const { ctx } = this;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.4;
    const cols = 9;
    const rows = 5;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const sx = (i + 0.5) * (this.w / cols);
        const sy = 60 + j * 88;
        // 反推该屏幕点对应的世界坐标
        const wx = (sx - this.w * 0.42) / SCALE + cam.x;
        const wz = (this.h * 0.72 - sy) / SCALE + cam.z;
        if (wx < 0 || wx > WORLD.width) continue;
        const wind = windAt(wx, wz, sim.t);
        const len = Math.max(6, Math.min(34, wind * 3.2));
        ctx.beginPath();
        ctx.moveTo(sx - len / 2, sy);
        ctx.lineTo(sx + len / 2, sy);
        ctx.lineTo(sx + len / 2 - 5, sy - 3.2);
        ctx.moveTo(sx + len / 2, sy);
        ctx.lineTo(sx + len / 2 - 5, sy + 3.2);
        ctx.stroke();
      }
    }
  }

  _drawTerrain(sim, cam) {
    const { ctx, w, h } = this;
    const left = cam.x - (w * 0.42) / SCALE - 20;
    const right = cam.x + (w - w * 0.42) / SCALE + 20;
    ctx.beginPath();
    const first = this._project(left, terrainHeight(left), cam);
    ctx.moveTo(first.px, first.py);
    for (let wx = left; wx <= right; wx += 6) {
      const p = this._project(wx, terrainHeight(wx), cam);
      ctx.lineTo(p.px, p.py);
    }
    const last = this._project(right, terrainHeight(right), cam);
    ctx.lineTo(last.px, h);
    ctx.lineTo(first.px, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, h * 0.55, 0, h);
    grad.addColorStop(0, "#7fbf5a");
    grad.addColorStop(1, "#4f8f3a");
    ctx.fillStyle = grad;
    ctx.fill();

    // 草丛点缀（确定性）
    ctx.strokeStyle = "rgba(46, 96, 40, 0.55)";
    ctx.lineWidth = 1;
    for (let wx = Math.max(0, Math.floor(left / 14) * 14); wx < right; wx += 14) {
      const gz = terrainHeight(wx);
      const p = this._project(wx, gz, cam);
      const k = Math.sin(wx * 12.9898) * 43758.5453;
      const rnd = k - Math.floor(k);
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.px + (rnd - 0.5) * 6, p.py - 5 - rnd * 5);
      ctx.stroke();
    }
  }

  _drawTargets(sim, cam) {
    const { ctx } = this;
    TARGETS.forEach((target, idx) => {
      const gz = terrainHeight(target.x);
      const center = this._project(target.x, gz + 1, cam);
      const rPx = target.radius * SCALE;
      const delivered = sim.delivered > idx;
      const isNext = sim.delivered === idx;
      if (center.px < -rPx || center.px > this.w + rPx) return;

      // 接收圈
      ctx.save();
      ctx.lineWidth = isNext ? 4 : 2.5;
      ctx.strokeStyle = delivered
        ? "rgba(60, 200, 120, 0.95)"
        : isNext
          ? "rgba(255, 170, 60, 0.95)"
          : "rgba(255, 255, 255, 0.7)";
      ctx.fillStyle = delivered
        ? "rgba(60, 200, 120, 0.22)"
        : "rgba(255, 255, 255, 0.14)";
      ctx.setLineDash(isNext ? [] : [8, 6]);
      ctx.beginPath();
      ctx.ellipse(center.px, center.py, rPx, rPx * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // 旗杆与标签
      ctx.strokeStyle = "#5b4632";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(center.px, center.py);
      ctx.lineTo(center.px, center.py - 46);
      ctx.stroke();
      ctx.fillStyle = delivered ? "#36c478" : isNext ? "#ffaa3c" : "#e8eef4";
      ctx.beginPath();
      ctx.moveTo(center.px, center.py - 46);
      ctx.lineTo(center.px + 26, center.py - 40);
      ctx.lineTo(center.px, center.py - 32);
      ctx.closePath();
      ctx.fill();

      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#23313f";
      const [lo, hi] = target.altWindow;
      const label = `${idx + 1}号圈 ${lo}-${hi}m · 限速${target.maxGroundSpeed}`;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(label, center.px, center.py + 22);
      ctx.restore();
    });
  }

  _drawBalloonTrail(sim, cam, prevTrail) {
    const { ctx } = this;
    if (prevTrail.length < 2) return;
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    prevTrail.forEach((pt, i) => {
      const p = this._project(pt.x, pt.z, cam);
      if (i === 0) ctx.moveTo(p.px, p.py);
      else ctx.lineTo(p.px, p.py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawMail(sim, cam) {
    const { ctx } = this;
    for (const bag of sim.mail) {
      // 轨迹
      if (bag.trail.length > 1) {
        ctx.strokeStyle = "rgba(220, 90, 60, 0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        bag.trail.forEach((pt, i) => {
          const p = this._project(pt.x, pt.z, cam);
          if (i === 0) ctx.moveTo(p.px, p.py);
          else ctx.lineTo(p.px, p.py);
        });
        const head = this._project(bag.x, bag.z, cam);
        ctx.lineTo(head.px, head.py);
        ctx.stroke();
      }
      const p = this._project(bag.x, bag.z, cam);
      ctx.save();
      ctx.translate(p.px, p.py);
      ctx.rotate(Math.max(-0.6, Math.min(0.6, bag.vx * 0.05)));
      ctx.fillStyle = "#c9743a";
      ctx.fillRect(-7, -5, 14, 10);
      ctx.strokeStyle = "#7c441f";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-7, -5, 14, 10);
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(0, 5);
      ctx.moveTo(-7, 0);
      ctx.lineTo(7, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawBalloon(sim, cam) {
    const { ctx } = this;
    const p = this._project(sim.x, sim.z, cam);
    const tilt = Math.max(-0.18, Math.min(0.18, (sim.vx - sim.wind) * 0.03));

    ctx.save();
    ctx.translate(p.px, p.py);
    ctx.rotate(tilt);

    // 球囊
    const envelopeW = 26;
    const envelopeH = 34;
    const grad = ctx.createLinearGradient(-envelopeW, 0, envelopeW, 0);
    grad.addColorStop(0, "#b8332c");
    grad.addColorStop(0.5, "#e85a44");
    grad.addColorStop(1, "#9e2722");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -envelopeH - 12);
    ctx.bezierCurveTo(envelopeW + 6, -envelopeH - 6, envelopeW + 4, -6, 10, 2);
    ctx.bezierCurveTo(6, 8, -6, 8, -10, 2);
    ctx.bezierCurveTo(-envelopeW - 4, -6, -envelopeW - 6, -envelopeH - 6, 0, -envelopeH - 12);
    ctx.fill();

    // 球囊条纹
    ctx.strokeStyle = "rgba(255, 220, 120, 0.8)";
    ctx.lineWidth = 2;
    for (const off of [-12, 0, 12]) {
      ctx.beginPath();
      ctx.moveTo(off * 0.35, -envelopeH - 9);
      ctx.quadraticCurveTo(off, -20, off * 0.6, 2);
      ctx.stroke();
    }

    // 排气阀开口指示
    if (sim.controls.vent) {
      ctx.fillStyle = "rgba(200, 220, 235, 0.9)";
      ctx.beginPath();
      ctx.arc(0, 4, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 燃烧器火焰
    if (sim.controls.burn && sim.fuel > 0) {
      const flick = 8 + Math.sin(sim.t * 30) * 3;
      const flame = ctx.createLinearGradient(0, 6, 0, 6 + flick + 8);
      flame.addColorStop(0, "#fff3a8");
      flame.addColorStop(0.5, "#ff9d3c");
      flame.addColorStop(1, "rgba(225, 70, 30, 0.1)");
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(-4, 6);
      ctx.quadraticCurveTo(0, 6 + flick + 6, 4, 6);
      ctx.closePath();
      ctx.fill();
    }

    // 绳索 + 吊篮
    ctx.strokeStyle = "#4a3826";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-9, 4);
    ctx.lineTo(-8, 20);
    ctx.moveTo(9, 4);
    ctx.lineTo(8, 20);
    ctx.stroke();
    ctx.fillStyle = "#8a5a33";
    ctx.fillRect(-10, 20, 20, 13);
    ctx.strokeStyle = "#5b3a1e";
    ctx.strokeRect(-10, 20, 20, 13);

    // 吊篮里的邮件袋
    for (let i = 0; i < sim.bagsLeft; i++) {
      ctx.fillStyle = "#d8b06a";
      ctx.fillRect(-8 + i * 5, 22, 4, 6);
    }

    // 风向舵
    const rud = sim.controls.rudder;
    if (Math.abs(rud) > 0.05) {
      ctx.strokeStyle = "rgba(40, 70, 110, 0.9)";
      ctx.lineWidth = 2.4;
      const dir = Math.sign(rud);
      ctx.beginPath();
      ctx.moveTo(dir * 12, 26);
      ctx.lineTo(dir * (22 + 6 * Math.abs(rud)), 26);
      ctx.stroke();
      ctx.fillStyle = "rgba(40, 70, 110, 0.9)";
      ctx.beginPath();
      ctx.moveTo(dir * (22 + 6 * Math.abs(rud)), 26);
      ctx.lineTo(dir * (15 + 6 * Math.abs(rud)), 22);
      ctx.lineTo(dir * (15 + 6 * Math.abs(rud)), 30);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  _drawVignette(sim) {
    const { ctx, w, h } = this;
    // 世界边界箭头
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    if (sim.x < 120) {
      ctx.fillText("起 飞 点 →", 70, 40);
    }
    const remain = WORLD.width - sim.x;
    if (remain < 220) {
      ctx.fillText("← 航 线 终 点", w - 70, 40);
    }
    // 低空警告
    if (sim.altitude < 35 && sim.status === "flying") {
      ctx.fillStyle = sim.vz < -6 ? "rgba(220,60,50,0.9)" : "rgba(200,140,40,0.85)";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(sim.vz < -6 ? "⚠ 下降过快！拉起燃烧器" : "⚠ 接近地面", w / 2, 36);
    }
  }
}
