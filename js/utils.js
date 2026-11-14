// 确定性伪随机数生成器，保证重置后城市布局一致
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

export const PRESETS = {
  light: { rainfall: 20, wind: -10, focal: 35, reflection: 35 },
  storm: { rainfall: 95, wind: 45, focal: 28, reflection: 85 },
};

export const DEFAULTS = {
  rainfall: 45,
  wind: 12,
  focal: 35,
  yaw: 0,
  reflection: 55,
};
