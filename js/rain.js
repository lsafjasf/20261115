import { clamp, degToRad } from './utils.js';

const NEAR_Z = -1.8;
const FAR_Z = -48;

export class RainSystem {
  constructor(camera) {
    this.camera = camera;
    this.drops = [];
    this.splashes = [];
    this.rainfall = 45;
    this.windDeg = 12;
    this._randState = 0x9e3779b9;
  }

  _rand() {
    let a = (this._randState = (this._randState + 0x6d2b79f5) | 0);
    a = Math.imul(a ^ (a >>> 15), 1 | a);
    a ^= a + Math.imul(a ^ (a >>> 7), 61 | a);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  }

  setRainfall(value) {
    this.rainfall = clamp(value, 0, 100);
    const target = this.targetCount();
    while (this.drops.length < target) this.drops.push(this._spawn(true));
    if (this.drops.length > target) this.drops.length = target;
  }

  setWind(deg) {
    this.windDeg = deg;
  }

  targetCount() {
    const r = this.rainfall / 100;
    return Math.round(120 + r * r * 1500);
  }

  // 速度场：重力下落 + 世界 X 向风力，风向角度越大横向分量越强
  _velocity() {
    const r = this.rainfall / 100;
    const w = degToRad(this.windDeg);
    const fall = 26 + r * 34;
    return {
      vx: Math.tan(w) * fall * 0.9,
      vy: -fall,
    };
  }

  _spawn(anywhere) {
    const cam = this.camera;
    // 深度分布：45% 落在镜头与前排建筑之间（必然可见），其余按视锥体积分布
    const u = this._rand();
    const near = -NEAR_Z;
    const frontRow = 7;
    let depth;
    if (u < 0.45) {
      depth = near + (u / 0.45) * (frontRow - near);
    } else {
      const v = (u - 0.45) / 0.55;
      depth = Math.sqrt(
        frontRow * frontRow + v * ((-FAR_Z) * (-FAR_Z) - frontRow * frontRow)
      );
    }
    const z = -depth;
    const halfW = (depth * cam.width) / (2 * cam.f);
    const x = -halfW + this._rand() * halfW * 2;
    // 在该深度上，把高度限制在屏幕可见的世界高度区间
    const groundScreen = this._groundScreenY();
    const topWorldY = (cam.cy * depth) / cam.f;
    const bottomWorldY = ((cam.cy - groundScreen) * depth) / cam.f;
    const y = anywhere
      ? bottomWorldY + this._rand() * (topWorldY - bottomWorldY)
      : topWorldY + this._rand() * Math.max(2, topWorldY - bottomWorldY) * 0.12;
    return { x, y, z, seed: this._rand() };
  }

  update(dt) {
    if (this.rainfall <= 0) {
      this.splashes.length = 0;
      return;
    }
    const { vx, vy } = this._velocity();
    const groundY = this._groundScreenY();
    for (const d of this.drops) {
      d.x += vx * dt;
      d.y += vy * dt;
      if (d.y <= 0) this._recycle(d);
      const p = this.camera.project(d.x, d.y, d.z);
      if (!p) {
        this._recycle(d);
        continue;
      }
      if (p.y >= groundY || p.y < -40) {
        if (p.depth < 30 && this.splashes.length < 260) {
          this.splashes.push({ x: p.x, y: groundY, life: 0.35, max: 0.35 });
        }
        this._recycle(d);
      } else if (p.x < -60 || p.x > this.camera.width + 60) {
        this._recycle(d);
      }
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      this.splashes[i].life -= dt;
      if (this.splashes[i].life <= 0) this.splashes.splice(i, 1);
    }
  }

  _recycle(d) {
    const fresh = this._spawn(false);
    d.x = fresh.x;
    d.y = fresh.y;
    d.z = fresh.z;
    d.seed = fresh.seed;
  }

  _groundScreenY() {
    const p = this.camera.project(0, 0, -10);
    return p ? p.y : this.camera.height;
  }

  // 逐雨线做像素级遮挡：雨在建筑之后则跳过，靠近建筑边缘时减弱
  render(ctx, scene) {
    if (this.rainfall <= 0) return;
    const { vx, vy } = this._velocity();
    const r = this.rainfall / 100;
    const tailTime = 0.022 + r * 0.05;
    const cam = this.camera;

    ctx.save();
    ctx.lineCap = 'round';
    for (const d of this.drops) {
      const head = cam.project(d.x, d.y, d.z);
      const tail = cam.project(d.x - vx * tailTime, d.y - vy * tailTime, d.z);
      if (!head || !tail) continue;
      if (
        head.x < -40 || head.x > cam.width + 40 ||
        head.y < -40 || head.y > cam.height + 40
      ) continue;

      const midX = (head.x + tail.x) / 2;
      const midY = (head.y + tail.y) / 2;
      const buildingDepth = scene.sampleDepth(midX, midY);
      if (buildingDepth !== Infinity && buildingDepth < head.depth - 0.4) continue;

      // 边缘软化：与建筑深度接近时降低不透明度，避免穿插闪烁
      let alpha = clamp(0.9 - head.depth / 55, 0.08, 0.7) * (0.25 + r * 0.5);
      if (buildingDepth !== Infinity) {
        const diff = buildingDepth - head.depth;
        alpha *= clamp(diff / 1.5, 0.15, 1);
      }
      const width = clamp(cam.f / head.depth * 0.008, 0.45, 1.8);
      ctx.strokeStyle = `rgba(178,200,235,${alpha.toFixed(3)})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
    }

    // 地面溅点（暴雨更密集），同样受建筑遮挡
    const groundY = this._groundScreenY();
    for (const s of this.splashes) {
      if (scene.sampleDepth(s.x, s.y - 2) !== Infinity) continue;
      const t = s.life / s.max;
      const radius = (1 - t) * (2.5 + r * 3);
      ctx.strokeStyle = `rgba(190,208,240,${(0.35 * t).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(s.x, groundY + 1, radius, radius * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
