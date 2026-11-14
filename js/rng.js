/* Seeded RNG (mulberry32) — deterministic worlds for a fixed seed. */
(function (global) {
  function makeRng(seed) {
    let s = seed >>> 0;
    const rng = function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.range = function (min, max) { return min + rng() * (max - min); };
    rng.int = function (min, max) {
      return Math.floor(rng.range(min, max + 1));
    };
    rng.pick = function (arr) { return arr[Math.floor(rng() * arr.length)]; };
    return rng;
  }

  const api = { makeRng, DEFAULT_SEED: 20261115 };
  globalThis.IceRng = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
