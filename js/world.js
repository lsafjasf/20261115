import { mulberry32, makeNoise2D } from './rng.js';
import { SEED, WORLD } from './config.js';

// 固定 seed 生成：起伏地形 + 5 个陨坑 + 着陆器 + 3 罐样本。
export function createWorld(seed = SEED) {
  const rng = mulberry32(seed);
  const noise = makeNoise2D(rng);
  const heightAt = (x, y) => {
    let h = noise(x * 0.075, y * 0.075) * 1.1
      + noise(x * 0.22 + 40, y * 0.22 + 40) * 0.32;
    for (const c of craters) {
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < c.rim) {
        const t = d / c.rim;
        h += c.depth * (t * t - 1);                 // 坑内下凹
      } else if (d < c.rim + c.band) {
        const t = (d - c.rim) / c.band;
        h += c.rimH * Math.cos(t * Math.PI / 2);    // 边缘隆起的环形脊
      }
    }
    return h;
  };

  const lander = { x: 9, y: WORLD.height / 2 };
  const craters = [
    { x: 30, y: 20, rim: 5.2, band: 2.4, depth: 3.0, rimH: 1.15, triggered: false },
    { x: 46, y: 47, rim: 6.6, band: 2.8, depth: 3.8, rimH: 1.35, triggered: false },
    { x: 58, y: 16, rim: 4.4, band: 2.0, depth: 2.6, rimH: 1.05, triggered: false },
    { x: 72, y: 38, rim: 5.8, band: 2.6, depth: 3.4, rimH: 1.25, triggered: false },
    { x: 40, y: 33, rim: 3.4, band: 1.7, depth: 2.2, rimH: 0.9, triggered: false }
  ];

  // 样本点在右半场，且与所有陨坑边缘保持安全距离，保证固定 seed 下路线可达。
  const spots = [
    { x: 24, y: 50 },
    { x: 63, y: 55 },
    { x: 81, y: 12 }
  ];
  const samples = spots.map((p, i) => ({ id: i, x: p.x, y: p.y, collected: false }));
  for (const s of samples) {
    let guard = 0;
    while (craters.some((c) => Math.hypot(s.x - c.x, s.y - c.y) < c.rim + c.band + 3) && guard++ < 50) {
      s.x += 1.5;
    }
  }

  return {
    seed,
    rng,
    width: WORLD.width,
    height: WORLD.height,
    lander,
    craters,
    samples,
    heightAt,
    slopeAt(x, y) {
      const e = 0.5;
      const dx = (heightAt(x + e, y) - heightAt(x - e, y)) / (2 * e);
      const dy = (heightAt(x, y + e) - heightAt(x, y - e)) / (2 * e);
      return { dx, dy, mag: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
    }
  };
}
