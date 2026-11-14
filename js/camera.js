import { degToRad } from './utils.js';

// 35mm 等效焦距 -> 像素焦距（以全画幅 36mm 宽度归一化）
export function focalPixels(focal35mm, viewWidth) {
  return (focal35mm / 36) * viewWidth;
}

export class Camera {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.yaw = 0;
    this.focal35 = 35;
    this.f = focalPixels(this.focal35, width);
    this.cx = width / 2;
    this.cy = height * 0.42;
    this._cos = 1;
    this._sin = 0;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.cy = height * 0.42;
    this.f = focalPixels(this.focal35, width);
  }

  setYaw(deg) {
    this.yaw = deg;
    this._cos = Math.cos(degToRad(deg));
    this._sin = Math.sin(degToRad(deg));
  }

  setFocal(focal35mm) {
    this.focal35 = focal35mm;
    this.f = focalPixels(focal35mm, this.width);
  }

  // 世界坐标 -> 相机坐标，相机位于原点、看向 -Z
  toCamera(x, y, z) {
    return {
      x: this._cos * x - this._sin * z,
      y,
      z: this._sin * x + this._cos * z,
    };
  }

  // 返回 null 表示落在近裁剪面之后
  project(x, y, z) {
    const cam = this.toCamera(x, y, z);
    if (cam.z >= -0.5) return null;
    const depth = -cam.z;
    const s = this.f / depth;
    return {
      x: this.cx + cam.x * s,
      y: this.cy - cam.y * s,
      depth,
      scale: s,
    };
  }
}
