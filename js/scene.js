import { clamp, lerp } from './utils.js';

// 场景离屏渲染：夜景城市 + 半分辨率深度缓冲（供雨线做像素级遮挡）
export class SceneRenderer {
  constructor(camera, city) {
    this.camera = camera;
    this.city = city;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.depthScale = 0.75;
    this.depth = null;
    this.dw = 0;
    this.dh = 0;
    this.lightStreaks = [];
  }

  resize() {
    const { width, height } = this.camera;
    this.canvas.width = width;
    this.canvas.height = height;
    this.dw = Math.max(1, Math.round(width * this.depthScale));
    this.dh = Math.max(1, Math.round(height * this.depthScale));
    this.depth = new Float32Array(this.dw * this.dh).fill(Infinity);
  }

  // 长方体 8 个角点（本地坐标，底面 y=0）
  _corners(b) {
    const hw = b.width / 2;
    const hd = b.depth / 2;
    return [
      [b.x - hw, 0, b.z - hd],
      [b.x + hw, 0, b.z - hd],
      [b.x + hw, 0, b.z + hd],
      [b.x - hw, 0, b.z + hd],
      [b.x - hw, b.height, b.z - hd],
      [b.x + hw, b.height, b.z - hd],
      [b.x + hw, b.height, b.z + hd],
      [b.x - hw, b.height, b.z + hd],
    ];
  }

  // 半分辨率深度查询，返回该像素处最近建筑深度（无建筑为 Infinity）
  sampleDepth(px, py) {
    const ix = clamp((px * this.depthScale) | 0, 0, this.dw - 1);
    const iy = clamp((py * this.depthScale) | 0, 0, this.dh - 1);
    return this.depth[iy * this.dw + ix];
  }

  // 地面在屏幕上的 y（世界 y=0 平面，按相机投影）
  groundY() {
    const p = this.camera.project(0, 0, -10);
    return p ? p.y : this.camera.height;
  }

  render() {
    const { ctx, camera } = this;
    const W = camera.width;
    const H = camera.height;
    this.depth.fill(Infinity);
    this.lightStreaks = [];
    this._paintSky(ctx, W, H);
    this._paintGround(ctx, W, H);

    // 远 -> 近排序，配合 painter 算法
    const ordered = [...this.city.buildings].sort((a, b) => b.z - a.z);
    for (const b of ordered) this._paintBuilding(b);
    return this.canvas;
  }

  _paintSky(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#04060f');
    g.addColorStop(0.45, '#0a1230');
    g.addColorStop(0.7, '#13204a');
    g.addColorStop(1, '#1a2a55');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 月光辉光与星点（视差由固定世界点投影得到）
    const moon = this.camera.project(26, 34, -60);
    if (moon) {
      const rg = ctx.createRadialGradient(moon.x, moon.y, 2, moon.x, moon.y, 90);
      rg.addColorStop(0, 'rgba(210,225,255,0.85)');
      rg.addColorStop(0.25, 'rgba(150,180,255,0.25)');
      rg.addColorStop(1, 'rgba(150,180,255,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(moon.x, moon.y, 90, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8eeff';
      ctx.beginPath();
      ctx.arc(moon.x, moon.y, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(200,215,255,0.7)';
    for (let i = 0; i < 90; i++) {
      const sx = ((i * 137.5) % 120) - 60;
      const sy = 22 + ((i * 53.7) % 26);
      const sz = -55 - ((i * 29.3) % 40);
      const p = this.camera.project(sx, sy, sz);
      if (p && p.x > 0 && p.x < W && p.y < this.groundY()) {
        ctx.globalAlpha = 0.25 + (i % 5) * 0.15;
        ctx.fillRect(p.x, p.y, 1.4, 1.4);
      }
    }
    ctx.globalAlpha = 1;
  }

  _paintGround(ctx, W, H) {
    const gy = this.groundY();
    const g = ctx.createLinearGradient(0, gy, 0, H);
    g.addColorStop(0, '#0a1024');
    g.addColorStop(0.35, '#070b18');
    g.addColorStop(1, '#03050c');
    ctx.fillStyle = g;
    ctx.fillRect(0, gy, W, H - gy);
  }

  _projectFace(b, faceIndex) {
    const faces = [
      [0, 1, 5, 4], // 前（-Z）
      [1, 2, 6, 5], // 右（+X）
      [2, 3, 7, 6], // 后（+Z）
      [3, 0, 4, 7], // 左（-X）
      [4, 5, 6, 7], // 顶
    ];
    const corners = this._corners(b);
    const pts = [];
    for (const ci of faces[faceIndex]) {
      const p = this.camera.project(...corners[ci]);
      if (!p) return null;
      pts.push(p);
    }
    return pts;
  }

  _paintBuilding(b) {
    const { ctx } = this;
    const faceColors = [b.baseColor, b.sideColor, b.sideColor, b.baseColor, b.roofColor];
    const cam = this.camera;
    const visible = [];
    for (let f = 0; f < 5; f++) {
      const pts = this._projectFace(b, f);
      if (!pts) continue;
      // 背面剔除：屏幕空间绕序
      const area =
        (pts[1].x - pts[0].x) * (pts[2].y - pts[0].y) -
        (pts[2].x - pts[0].x) * (pts[1].y - pts[0].y);
      if (Math.abs(area) < 1) continue;
      visible.push({ f, pts, facing: area > 0 });
    }
    // 远面先画
    visible.sort((a, c) => {
      const da = a.pts.reduce((s, p) => s + p.depth, 0) / 4;
      const dc = c.pts.reduce((s, p) => s + p.depth, 0) / 4;
      return dc - da;
    });
    for (const { f, pts } of visible) {
      this._rasterizeDepth(pts);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = faceColors[f];
      ctx.fill();
      if (f < 4) this._paintWindows(b, f, pts);
      if (f === 0 && b.neon) this._paintNeon(b, pts);
    }
  }

  // 深度缓冲按半分辨率扫描线光栅化凸四边形
  _rasterizeDepth(pts) {
    const ds = this.depthScale;
    const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y)) * ds));
    const maxY = Math.min(this.dh - 1, Math.ceil(Math.max(...pts.map((p) => p.y)) * ds));
    for (let iy = minY; iy <= maxY; iy++) {
      const sy = (iy + 0.5) / ds;
      const hits = [];
      for (let e = 0; e < 4; e++) {
        const a = pts[e];
        const c = pts[(e + 1) % 4];
        if ((a.y <= sy && c.y > sy) || (c.y <= sy && a.y > sy)) {
          const t = (sy - a.y) / (c.y - a.y);
          hits.push({
            x: lerp(a.x, c.x, t),
            depth: lerp(a.depth, c.depth, t),
          });
        }
      }
      if (hits.length < 2) continue;
      hits.sort((a, c) => a.x - c.x);
      const left = hits[0];
      const right = hits[hits.length - 1];
      const x0 = clamp(Math.floor(left.x * ds), 0, this.dw - 1);
      const x1 = clamp(Math.ceil(right.x * ds), 0, this.dw - 1);
      for (let ix = x0; ix <= x1; ix++) {
        const sx = (ix + 0.5) / ds;
        const t = (sx - left.x) / Math.max(0.0001, right.x - left.x);
        const d = lerp(left.depth, right.depth, t);
        const idx = iy * this.dw + ix;
        if (d < this.depth[idx]) this.depth[idx] = d;
      }
    }
  }

  // 把建筑本地窗口坐标投到对应可见面，并裁剪在面内
  _paintWindows(b, face, facePts) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(facePts[0].x, facePts[0].y);
    for (let i = 1; i < facePts.length; i++) ctx.lineTo(facePts[i].x, facePts[i].y);
    ctx.closePath();
    ctx.clip();

    for (const win of b.windows) {
      if (win.face === 'front' && face !== 0) continue;
      if (win.face === 'right' && face !== 1) continue;
      let corners;
      if (win.face === 'front') {
        const z = b.z - b.depth / 2 - 0.02;
        corners = [
          [b.x + win.lx - win.w / 2, win.ly - win.h / 2, z],
          [b.x + win.lx + win.w / 2, win.ly - win.h / 2, z],
          [b.x + win.lx + win.w / 2, win.ly + win.h / 2, z],
          [b.x + win.lx - win.w / 2, win.ly + win.h / 2, z],
        ];
      } else {
        const x = b.x + b.width / 2 + 0.02;
        const z0 = b.z - b.depth / 2;
        corners = [
          [x, win.ly - win.h / 2, z0 + win.lx - win.w / 2],
          [x, win.ly - win.h / 2, z0 + win.lx + win.w / 2],
          [x, win.ly + win.h / 2, z0 + win.lx + win.w / 2],
          [x, win.ly + win.h / 2, z0 + win.lx - win.w / 2],
        ];
      }
      const pts = corners.map((c) => this.camera.project(...c));
      if (pts.some((p) => !p)) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = win.color;
      ctx.fill();
      if (win.color.includes('hsl') && win.face === 'front' && this.lightStreaks.length < 140) {
        this.lightStreaks.push({
          x: (pts[0].x + pts[1].x) / 2,
          y: Math.max(pts[2].y, pts[3].y),
          color: win.color,
        });
      }
    }
    ctx.restore();
  }

  _paintNeon(b, facePts) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = b.neon;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = b.neon;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    const top = facePts[3];
    const top2 = facePts[2];
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top2.x, top2.y);
    ctx.stroke();
    ctx.restore();
  }
}
