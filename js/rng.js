// 固定 seed 的确定性随机源：mulberry32 + 二维 value noise
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise2D(rng) {
  const SIZE = 256;
  const grid = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < grid.length; i++) grid[i] = rng() * 2 - 1;
  const fade = (t) => t * t * (3 - 2 * t);
  return function noise2D(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % SIZE) + SIZE) % SIZE;
    const y0 = ((yi % SIZE) + SIZE) % SIZE;
    const x1 = (x0 + 1) % SIZE;
    const y1 = (y0 + 1) % SIZE;
    const a = grid[y0 * SIZE + x0];
    const b = grid[y0 * SIZE + x1];
    const c = grid[y1 * SIZE + x0];
    const d = grid[y1 * SIZE + x1];
    const u = fade(xf);
    const v = fade(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
