import { DAMAGE_ABORT, MAX_SPEED } from './config.js';
import { mulberry32 } from './rng.js';

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.scale = Math.min(canvas.width / world.width, canvas.height / world.height);
    this.rng = mulberry32(world.seed ^ 0x9e3779b9); // 渲染专用随机流，与物理隔离
    this.off = document.createElement('canvas');
    this.off.width = canvas.width;
    this.off.height = canvas.height;
    this._buildRegolith();
  }

  _buildRegolith() {
    const { ctx, off, world, scale } = this;
    const o = off.getContext('2d');
    o.fillStyle = '#191614';
    o.fillRect(0, 0, off.width, off.height);
    // 月尘颗粒：确定性散点 + 少量亮斑，模拟风化层纹理
    const rng = this.rng;
    const count = 2600;
    for (let i = 0; i < count; i++) {
      const x = rng() * world.width;
      const y = rng() * world.height;
      const shade = 28 + Math.floor(rng() * 46);
      o.fillStyle = `rgba(${shade + 14},${shade + 8},${shade},${0.25 + rng() * 0.5})`;
      const s = rng() < 0.92 ? 1 : 1.8;
      o.fillRect(x, y, s, s);
    }
    for (let i = 0; i < 90; i++) {
      const x = rng() * world.width;
      const y = rng() * world.height;
      o.fillStyle = 'rgba(120,112,100,0.10)';
      o.beginPath();
      o.arc(x, y, 2 + rng() * 6, 0, Math.PI * 2);
      o.fill();
    }
  }

  w2p(x, y) {
    // render() 已对画布做 scale 变换，这里保持世界单位（米）
    return [x, y];
  }

  render(rover, camera = { x: 0, y: 0 }) {
    const { ctx, world, scale, off } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(off, 0, 0);

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-camera.x, -camera.y);
    this._drawCraters(rover);
    this._drawRuts(rover);
    this._drawHopMarks(rover);
    this._drawSamples();
    this._drawLander();
    this._drawDust(rover);
    this._drawRover(rover);
    ctx.restore();

    this._drawHud(rover);
  }

  _drawCraters() {
    const { ctx, world } = this;
    for (const c of world.craters) {
      const [cx, cy] = this.w2p(c.x, c.y);
      const g = ctx.createRadialGradient(cx, cy, c.rim * 0.1, cx, cy, c.rim + c.band);
      g.addColorStop(0, '#0c0b0a');
      g.addColorStop(0.62, '#151210');
      g.addColorStop(0.8, 'rgba(96,86,72,0.55)');
      g.addColorStop(0.92, 'rgba(58,52,44,0.35)');
      g.addColorStop(1, 'rgba(25,22,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, c.rim + c.band, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = c.triggered ? 'rgba(190,90,60,0.8)' : 'rgba(140,126,104,0.5)';
      ctx.lineWidth = c.triggered ? 0.18 : 0.1;
      ctx.beginPath();
      ctx.arc(cx, cy, c.rim, 0, Math.PI * 2);
      ctx.stroke();
      if (c.triggered) {
        ctx.fillStyle = 'rgba(200,110,70,0.85)';
        ctx.font = `${12 / this.scale}px monospace`;
        ctx.fillText('滑坡', cx - 0.9, cy - (c.rim + c.band) - 0.4);
      }
    }
  }

  _drawRuts(rover) {
    const { ctx } = this;
    ctx.lineCap = 'round';
    for (const q of rover.ruts) {
      const fade = Math.max(0.08, 1 - q.age / 120);
      ctx.strokeStyle = q.slip ? `rgba(160,120,90,${0.5 * fade})` : `rgba(90,82,72,${0.42 * fade})`;
      ctx.lineWidth = q.slip ? 0.22 : 0.12;
      const [x, y] = this.w2p(q.x, q.y);
      const [x2, y2] = this.w2p(q.x2, q.y2);
      const [x3, y3] = this.w2p(q.x3, q.y3);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x, y);
      ctx.lineTo(x3, y3);
      ctx.stroke();
    }
  }

  _drawHopMarks(rover) {
    const { ctx } = this;
    for (const m of rover.hopMarks) {
      const [x, y] = this.w2p(m.x, m.y);
      const fade = Math.max(0.15, 1 - m.age / 40);
      ctx.strokeStyle = `rgba(180,160,130,${0.7 * fade})`;
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.ellipse(x, y, m.r * 1.6, m.r * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawSamples() {
    const { ctx, world } = this;
    for (const s of world.samples) {
      if (s.collected) continue;
      const [x, y] = this.w2p(s.x, s.y);
      const pulse = 1 + Math.sin(performance.now() / 300 + s.id) * 0.12;
      ctx.fillStyle = 'rgba(120,200,255,0.18)';
      ctx.beginPath();
      ctx.arc(x, y, 2.1 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6fd0ff';
      ctx.fillRect(x - 0.7, y - 1.0, 1.4, 2.0);
      ctx.strokeStyle = '#bfeaff';
      ctx.lineWidth = 0.08;
      ctx.strokeRect(x - 0.7, y - 1.0, 1.4, 2.0);
      ctx.fillStyle = '#cfeeff';
      ctx.font = `${11 / this.scale}px monospace`;
      ctx.fillText(`罐${s.id + 1}`, x + 1.2, y - 1.2);
    }
  }

  _drawLander() {
    const { ctx, world } = this;
    const [x, y] = this.w2p(world.lander.x, world.lander.y);
    ctx.fillStyle = '#c9c2b4';
    ctx.beginPath();
    ctx.moveTo(x, y - 2.4);
    ctx.lineTo(x + 1.8, y + 1.4);
    ctx.lineTo(x - 1.8, y + 1.4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#7d766a';
    ctx.lineWidth = 0.12;
    ctx.stroke();
    ctx.fillStyle = '#ffb35c';
    ctx.fillRect(x - 0.5, y - 0.6, 1, 1);
    ctx.fillStyle = '#e8e2d4';
    ctx.font = `${12 / this.scale}px monospace`;
    ctx.fillText('着陆器', x - 1.6, y + 3.2);
  }

  _drawDust(rover) {
    const { ctx } = this;
    for (const p of rover.dust) {
      const a = 1 - p.life / p.maxLife;
      ctx.fillStyle = `rgba(150,138,118,${0.5 * a})`;
      const [x, y] = this.w2p(p.x, p.y);
      ctx.beginPath();
      ctx.arc(x, y, p.size * (1 + p.life * 1.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawRover(rover) {
    const { ctx } = this;
    const [x, y] = this.w2p(rover.x, rover.y);
    const lift = rover.airborne ? -rover.z * 2.2 : 0;
    ctx.save();
    ctx.translate(x, y + lift);
    ctx.rotate(rover.heading);
    // 车身 + 六轮示意
    ctx.fillStyle = rover.slip ? '#e0a050' : '#d8d2c4';
    ctx.fillRect(-1.3, -0.9, 2.6, 1.8);
    ctx.strokeStyle = '#5d574d';
    ctx.lineWidth = 0.1;
    ctx.strokeRect(-1.3, -0.9, 2.6, 1.8);
    ctx.fillStyle = '#3a352e';
    for (const wx of [-0.9, 0, 0.9]) {
      ctx.fillRect(wx - 0.25, -1.15, 0.5, 0.3);
      ctx.fillRect(wx - 0.25, 0.85, 0.5, 0.3);
    }
    // 已装载样本罐
    for (let i = 0; i < rover.jars; i++) {
      ctx.fillStyle = '#6fd0ff';
      ctx.fillRect((-0.8 + i * 0.6), -0.35, 0.4, 0.7);
    }
    ctx.restore();
    if (rover.airborne) {
      ctx.fillStyle = 'rgba(180,160,130,0.5)';
      ctx.font = `${11 / this.scale}px monospace`;
      ctx.fillText('腾空', x + 1.4, y - 1.4);
    }
  }

  _drawHud(rover) {
    const { ctx } = this;
    const speed = Math.hypot(rover.vx, rover.vy);
    ctx.fillStyle = 'rgba(10,9,8,0.72)';
    ctx.fillRect(10, 10, 250, 118);
    ctx.strokeStyle = 'rgba(160,148,128,0.6)';
    ctx.strokeRect(10, 10, 250, 118);
    ctx.fillStyle = '#e8e2d4';
    ctx.font = '13px monospace';
    const dmgPct = Math.round((rover.damage / DAMAGE_ABORT) * 100);
    const lines = [
      `时间 ${rover.time.toFixed(1)}s   速度 ${speed.toFixed(1)}/${MAX_SPEED} m/s`,
      `样本罐 ${rover.jars}/3   损伤 ${dmgPct}%${rover.slip ? '   [打滑]' : ''}`,
      `状态 ${rover.status === 'active' ? (rover.airborne ? '腾空' : '行驶') : rover.status}`,
      `制动随载荷增加 · 月面 g=1.62`
    ];
    lines.forEach((l, i) => ctx.fillText(l, 20, 32 + i * 22));
    // 损伤条
    ctx.fillStyle = '#3a352e';
    ctx.fillRect(20, 104, 220, 8);
    ctx.fillStyle = dmgPct > 70 ? '#d9534f' : dmgPct > 35 ? '#e0a050' : '#7bbf7b';
    ctx.fillRect(20, 104, 220 * Math.min(1, rover.damage / DAMAGE_ABORT), 8);
    const last = rover.events[rover.events.length - 1];
    if (last) {
      const label = {
        pickup: `拾取样本 #${last.jar ?? ''}`,
        landslide: `陨坑边缘滑坡！损伤 +${last.damage ?? ''}`,
        'slip-start': '车轮打滑，路径偏移',
        hop: '低重力腾空',
        land: `落地冲击 ${last.impact ? last.impact.toFixed(1) : ''} m/s`,
        return: '三罐样本安全返航！',
        abort: '损伤过高，任务中止'
      }[last.type];
      if (label) {
        ctx.fillStyle = last.type === 'return' ? '#7bd17b' : last.type === 'abort' || last.type === 'landslide' ? '#ff8a7a' : '#ffd58a';
        ctx.font = 'bold 15px monospace';
        ctx.fillText(label, 14, 158);
      }
    }
  }
}
