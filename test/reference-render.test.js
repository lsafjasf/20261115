'use strict';
// 与 water-renderer.js GLSL 等价的纯 JS 参考实现（低分辨率软光栅），
// 仅用于验证自检阈值（色相 <=2°、低档抖动不更高）在真实数学下成立。
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/water-core.js');

function waveHeight(px, pz, t, dirRad, octaves) {
  let h = 0, amp = 1, freq = 1;
  for (let i = 0; i < 4; i++) {
    const w = i <= octaves - 0.5 ? 1 : 0;
    const a = dirRad + i * 0.9;
    const dX = Math.cos(a), dZ = Math.sin(a);
    const phase = (px * dX + pz * dZ) * freq * 1.6 + t * (0.9 + 0.25 * i);
    h += (Math.sin(phase) + 0.35 * Math.sin(phase * 1.7 + i * 2.1)) * amp * w;
    amp *= 0.5;
    freq *= 2.1;
  }
  return h;
}

function renderFrame(params, octaves, timeSec, W, H) {
  const waterObj = C.hexToRgb(params.waterColor);
  const fogObj = C.hexToRgb(params.fogColor);
  const water = [waterObj.r, waterObj.g, waterObj.b];
  const fog = [fogObj.r, fogObj.g, fogObj.b];
  const dirRad = params.direction * Math.PI / 180;
  const ro = [0, 1.6, -2.2], ta = [0, 0.55, 0];
  const ww = norm(sub(ta, ro));
  const uu = norm(cross(ww, [0, 1, 0]));
  const vv = cross(uu, ww);
  const sun = norm([-0.4, 0.55, 0.6]);
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = ((x + 0.5) * 2 - W) / H;
      const sy = (H - (y + 0.5) * 2) / H;
      let rd = norm(add(add(scale(uu, sx), scale(vv, sy)), scale(ww, 1.2)));
      let color;
      if (rd[1] >= 0) {
        color = sky(rd, sun, fog);
      } else {
        const tHit = -ro[1] / rd[1];
        const pos = add(ro, scale(rd, tHit));
        const wx = pos[0] * params.rippleScale;
        const wz = pos[2] * params.rippleScale;
        const h = waveHeight(wx, wz, timeSec, dirRad, octaves);
        const e = 0.08;
        const hx = waveHeight(wx + e, wz, timeSec, dirRad, octaves) - h;
        const hz = waveHeight(wx, wz + e, timeSec, dirRad, octaves) - h;
        const n = norm([-hx, 2 * e, -hz]);
        const fres = Math.pow(1 - Math.max(dot(n, scale(rd, -1)), 0), 3);
        const reflDir = reflect(rd, n);
        const refl = sky(reflDir, sun, fog);
        const spec = Math.pow(Math.max(dot(reflDir, sun), 0), 90);
        const mixK = Math.min(Math.max(fres * 0.7 + 0.08, 0), 1) * params.reflection;
        color = mix3(water, refl, mixK);
        const boost = [1.0, 0.95, 0.8].map((v, i) => color[i] + spec * v * params.reflection * 0.8);
        color = boost.map((v) => v * (0.85 + 0.15 * Math.max(dot(n, sun), 0)));
        const f = 1 - Math.exp(-params.fogDensity * tHit);
        color = mix3(color, fog, Math.min(Math.max(f, 0), 1));
      }
      const o = (y * W + x) * 4;
      px[o] = clamp255(color[0] * 255);
      px[o + 1] = clamp255(color[1] * 255);
      px[o + 2] = clamp255(color[2] * 255);
      px[o + 3] = 255;
    }
  }
  return px;
}

function sky(rd, sun, fog) {
  const up = Math.min(Math.max(rd[1] * 0.5 + 0.5, 0), 1);
  const tint = [0.30, 0.50, 0.72];
  const s = mix3(fog, tint, Math.pow(up, 1.4));
  const sunK = Math.pow(Math.max(dot(rd, sun), 0), 64);
  return add(s, scale([1, 0.92, 0.75], sunK * 0.6));
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len > 1e-9 ? scale(a, 1 / len) : [0, 1, 0];
};
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const clamp255 = (v) => Math.min(255, Math.max(0, v));
function reflect(i, n) { const d = 2 * dot(i, n); return sub(i, scale(n, d)); }

const W = 80, H = 48, T = 3.21;
test('三组预设：跨质量档色相偏差 <= 2°，低档帧抖动不高于高档（软光栅等价验证）', () => {
  for (const preset of C.makePresets()) {
  const p = C.normalizeParams(preset.params);
  const hues = {};
  const deltas = {};
  for (const tier of C.TIER_ORDER) {
    const oct = C.QUALITY_TIERS[tier].octaves;
    hues[tier] = C.frameHue(renderFrame(p, oct, T, W, H));
    const f1 = renderFrame(p, oct, 1.0, W, H);
    const f2 = renderFrame(p, oct, 1.0 + 1 / 60, W, H);
    deltas[tier] = C.compareFrames(f1, f2).meanAbsDiff;
  }
  const spread = Math.max(C.hueDistance(hues.high, hues.medium), C.hueDistance(hues.high, hues.low));
  const flickerOk = deltas.low <= deltas.high + 0.15;
  assert.ok(spread <= 2, preset.name + ' 色相偏差 ' + spread.toFixed(3) + '° 超过 2°');
  assert.ok(flickerOk, preset.name + ' 低档抖动高于高档');
  console.log(preset.name,
    'hue 高/中/低 =', hues.high.toFixed(2), hues.medium.toFixed(2), hues.low.toFixed(2),
    'spread =', spread.toFixed(3),
    '| delta 高/中/低 =', deltas.high.toFixed(3), deltas.medium.toFixed(3), deltas.low.toFixed(3),
    flickerOk ? 'OK' : 'BAD');
  }
});
