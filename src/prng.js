/* Deterministic PRNG + value noise. Shared by browser (App namespace) and Node (module.exports). */
(function (global) {
  const App = (global.App = global.App || {});

  function hashSeed(str) {
    const s = String(str);
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function mulberry32(seedUint) {
    let a = seedUint >>> 0;
    return function next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function lattice(ix, iy, seed) {
    let h = (seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function valueNoise2D(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const v00 = lattice(ix, iy, seed);
    const v10 = lattice(ix + 1, iy, seed);
    const v01 = lattice(ix, iy + 1, seed);
    const v11 = lattice(ix + 1, iy + 1, seed);
    const sx = smooth(fx);
    const sy = smooth(fy);
    const a = v00 + (v10 - v00) * sx;
    const b = v01 + (v11 - v01) * sx;
    return a + (b - a) * sy;
  }

  function fbm2D(x, y, seed, octaves, lacunarity, gain) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * valueNoise2D(x * freq, y * freq, seed + o * 1013);
      norm += amp;
      amp *= gain || 0.5;
      freq *= lacunarity || 2;
    }
    return sum / norm;
  }

  App.PRNG = { hashSeed, mulberry32, valueNoise2D, fbm2D, lattice };
  if (typeof module !== 'undefined' && module.exports) module.exports = App.PRNG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
